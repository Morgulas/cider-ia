import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BlobStore } from './blobs.js';
import { readJson, SerialQueue, writeFileAtomic } from './json-file.js';
import { extractBlobs, findBlobRefs, hasInlineBlobs } from './project-blobs.js';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Incremented on every save, used to detect concurrent edits */
  revision: number;
  /** Size of the saved project, in bytes: its data and the files (images...) it references */
  size: number;
}

/** A saved state of a project, kept so it can be downloaded or restored */
export interface VersionEntry {
  revision: number;
  savedAt: string;
  /** user name of the author of the save */
  by: string;
  /** what the save changed, as described by the application (import, deletion...) */
  label: string;
  size: number;
  /** the state before an important change (import, bulk action, restore): kept longer */
  keep?: boolean;
}

export interface VersionView extends VersionEntry {
  current: boolean;
}

interface VersionHistory {
  version: 1;
  entries: VersionEntry[];
}

/** Who saves and why: recorded in the version history */
export interface SaveInfo {
  by: string;
  label?: string;
  important?: boolean;
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
export const VERSION_LABEL_MAX_LENGTH = 300;

/**
 * Which old versions are kept (the current one always is):
 *  - the 20 most recent;
 *  - states before an important change (import, bulk action, restore), 90 days;
 *  - the last version of each hour for 48 hours, of each day for 60 days.
 * Autosaves are frequent: without thinning, the history would only cover minutes.
 */
export function versionsToKeep(entries: VersionEntry[], current: number, now: Date): Set<number> {
  const keep = new Set<number>([current]);
  const old = entries.filter(e => e.revision !== current).sort((a, b) => b.revision - a.revision);
  old.slice(0, 20).forEach(e => keep.add(e.revision));
  const hours = new Set<string>();
  const days = new Set<string>();
  for (const entry of old) {
    const age = now.getTime() - new Date(entry.savedAt).getTime();
    const hour = entry.savedAt.slice(0, 13);
    const day = entry.savedAt.slice(0, 10);
    if (entry.keep && age < 90 * DAY) {
      keep.add(entry.revision);
    }
    // entries are newest first: the first seen in an hour/day is its last version
    if (age < 48 * HOUR && !hours.has(hour)) {
      keep.add(entry.revision);
    }
    if (age < 60 * DAY && !days.has(day)) {
      keep.add(entry.revision);
    }
    hours.add(hour);
    days.add(day);
  }
  return keep;
}

interface ProjectIndex {
  version: 1;
  projects: ProjectMeta[];
}

export const PROJECT_ID_PATTERN = /^[a-f0-9]{32}$/;
const USER_ID_PATTERN = /^[0-9a-f-]{36}$/;
export const PROJECT_NAME_MAX_LENGTH = 100;

export class ProjectStoreError extends Error {
  constructor(message: string, readonly status: number, readonly revision?: number,
    /** files referenced by the data but not sent yet */
    readonly missing?: string[]) {
    super(message);
  }
}

const MB = 1024 * 1024;

/** A save that would make the project, its files included, larger than the limit */
export class ProjectTooLargeError extends ProjectStoreError {
  constructor(readonly size: number, readonly maxSize: number) {
    super(`the project would weigh ${Math.ceil(size / MB)} MB with its files, `
      + `more than the limit of ${Math.floor(maxSize / MB)} MB`, 413);
  }
}

/** Blobs written less than this long ago are never cleaned up (sent for a save still to come) */
export const BLOB_MIN_AGE_MS = 24 * 3600 * 1000;

export function cleanProjectName(name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ProjectStoreError('project name is required', 400);
  }
  const trimmed = name.trim();
  if (trimmed.length > PROJECT_NAME_MAX_LENGTH) {
    throw new ProjectStoreError(`project name must have at most ${PROJECT_NAME_MAX_LENGTH} characters`, 400);
  }
  return trimmed;
}

/**
 * Projects of each user, one folder per user:
 *   projects/<userId>/index.json        list of the user's projects
 *   projects/<userId>/<projectId>.json  project data (a Dexie database export)
 *   projects/<userId>/versions/<projectId>/history.json, <revision>.json  earlier versions
 * The images and other files of the projects are not in these files: they are
 * stored once in the BlobStore and referenced (see project-blobs.ts).
 * A user can only reach the files of their own folder.
 */
export class ProjectStore {
  private readonly root: string;
  private readonly queues = new Map<string, SerialQueue>();

  /**
   * maxProjectBytes: largest size of a saved project, its files (images...) included.
   * Each request is already limited by the HTTP server, but the files are sent one
   * by one, apart from the data: only the total says how big the project is.
   */
  constructor(dataDir: string, readonly blobs: BlobStore, private readonly maxProjectBytes = Infinity) {
    this.root = path.join(dataDir, 'projects');
  }

  /**
   * Project data as it is stored: inline files are moved to the blob store, and
   * every referenced file must be there. Returns the data and the full size.
   * With checkSize, a project larger than the limit is refused (saves, new projects);
   * data already stored is never refused (conversion of an old project).
   */
  private async prepareData(userId: string, data: Buffer, checkSize = true): Promise<{ data: Buffer; size: number }> {
    const extracted = extractBlobs(data);
    for (const [hash, bytes] of extracted.blobs) {
      await this.blobs.write(userId, hash, bytes);
    }
    let size = extracted.data.length;
    const missing: string[] = [];
    for (const hash of findBlobRefs(extracted.data)) {
      const blobSize = await this.blobs.size(userId, hash);
      if (blobSize === undefined) {
        missing.push(hash);
      } else {
        size += blobSize;
      }
    }
    if (missing.length > 0) {
      throw new ProjectStoreError('some files of the project were not sent', 422, undefined, missing);
    }
    if (checkSize && size > this.maxProjectBytes) {
      throw new ProjectTooLargeError(size, this.maxProjectBytes);
    }
    return { data: extracted.data, size };
  }

  private userDir(userId: string): string {
    if (!USER_ID_PATTERN.test(userId)) {
      throw new ProjectStoreError('invalid user', 400);
    }
    return path.join(this.root, userId);
  }

  private dataFile(userId: string, projectId: string): string {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new ProjectStoreError('project not found', 404);
    }
    return path.join(this.userDir(userId), `${projectId}.json`);
  }

  private versionsDir(userId: string, projectId: string): string {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new ProjectStoreError('project not found', 404);
    }
    return path.join(this.userDir(userId), 'versions', projectId);
  }

  private async readHistory(userId: string, projectId: string): Promise<VersionHistory> {
    return readJson<VersionHistory>(path.join(this.versionsDir(userId, projectId), 'history.json'), { version: 1, entries: [] });
  }

  private writeHistory(userId: string, projectId: string, history: VersionHistory): Promise<void> {
    return writeFileAtomic(path.join(this.versionsDir(userId, projectId), 'history.json'), JSON.stringify(history, null, 1));
  }

  /**
   * Keeps the current data file as a version before it is replaced. A hard link
   * costs no space and survives the atomic replacement; copied if links fail.
   */
  private async keepVersion(userId: string, project: ProjectMeta, history: VersionHistory): Promise<void> {
    const dir = this.versionsDir(userId, project.id);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${project.revision}.json`);
    const source = this.dataFile(userId, project.id);
    await fs.rm(target, { force: true });
    try {
      await fs.link(source, target);
    } catch {
      await fs.copyFile(source, target);
    }
    if (!history.entries.some(e => e.revision === project.revision)) {
      // saved before versions existed
      history.entries.push({ revision: project.revision, savedAt: project.updatedAt, by: '', label: '', size: project.size });
    }
  }

  private async prune(userId: string, project: ProjectMeta, history: VersionHistory): Promise<void> {
    const keep = versionsToKeep(history.entries, project.revision, new Date());
    const removed = history.entries.filter(e => !keep.has(e.revision));
    history.entries = history.entries.filter(e => keep.has(e.revision));
    for (const entry of removed) {
      await fs.rm(path.join(this.versionsDir(userId, project.id), `${entry.revision}.json`), { force: true });
    }
  }

  private queue(userId: string): SerialQueue {
    let queue = this.queues.get(userId);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(userId, queue);
    }
    return queue;
  }

  private async readIndex(userId: string): Promise<ProjectIndex> {
    return readJson<ProjectIndex>(path.join(this.userDir(userId), 'index.json'), { version: 1, projects: [] });
  }

  private writeIndex(userId: string, index: ProjectIndex): Promise<void> {
    return writeFileAtomic(path.join(this.userDir(userId), 'index.json'), JSON.stringify(index, null, 2));
  }

  async list(userId: string): Promise<ProjectMeta[]> {
    const index = await this.readIndex(userId);
    return [...index.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(userId: string, projectId: string): Promise<ProjectMeta> {
    const index = await this.readIndex(userId);
    const project = index.projects.find(candidate => candidate.id === projectId);
    if (!project) {
      throw new ProjectStoreError('project not found', 404);
    }
    return project;
  }

  /** Creates a project, optionally with initial data (an imported or sample project) */
  create(userId: string, name: string, maxProjects: number, data?: Buffer, info?: SaveInfo): Promise<ProjectMeta> {
    return this.queue(userId).run(async () => {
      const index = await this.readIndex(userId);
      if (index.projects.length >= maxProjects) {
        throw new ProjectStoreError(`a user can have at most ${maxProjects} projects`, 409);
      }
      const now = new Date().toISOString();
      const project: ProjectMeta = {
        id: randomBytes(16).toString('hex'),
        name: cleanProjectName(name),
        createdAt: now,
        updatedAt: now,
        revision: 0,
        size: 0,
      };
      if (data !== undefined) {
        const prepared = await this.prepareData(userId, data);
        await writeFileAtomic(this.dataFile(userId, project.id), prepared.data);
        project.revision = 1;
        project.size = prepared.size;
        await this.writeHistory(userId, project.id, { version: 1, entries: [{
          revision: 1, savedAt: now, by: info?.by ?? '', label: info?.label ?? '', size: prepared.size,
        }] });
      }
      index.projects.push(project);
      await this.writeIndex(userId, index);
      return project;
    });
  }

  /**
   * Project data, or null for a project that was never saved (empty project).
   * Read in the write queue: the data and the revision always match.
   * Data saved before the blob store (files inline) is converted on the way:
   * same content and revision, files moved to the blob store.
   */
  readData(userId: string, projectId: string): Promise<{ project: ProjectMeta; data: Buffer | null }> {
    return this.queue(userId).run(async () => {
      const project = await this.get(userId, projectId);
      let data: Buffer;
      try {
        data = await fs.readFile(this.dataFile(userId, projectId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { project, data: null };
        }
        throw error;
      }
      if (hasInlineBlobs(data)) {
        const prepared = await this.prepareData(userId, data, false);
        if (prepared.data !== data) {
          // replaced, not rewritten: a version hard-linked to this file keeps its content
          await writeFileAtomic(this.dataFile(userId, projectId), prepared.data);
          const index = await this.readIndex(userId);
          const entry = index.projects.find(candidate => candidate.id === projectId);
          if (entry) {
            entry.size = prepared.size;
            await this.writeIndex(userId, index);
          }
          return { project: entry ?? project, data: prepared.data };
        }
      }
      return { project, data };
    });
  }

  /**
   * Saves the project data. baseRevision is the revision the client loaded:
   * if someone saved in between (another tab or device), the save is refused
   * with 409 unless force is set.
   */
  writeData(userId: string, projectId: string, data: Buffer, baseRevision: number | undefined, force: boolean,
    info: SaveInfo = { by: '' }): Promise<ProjectMeta> {
    return this.queue(userId).run(async () => {
      const index = await this.readIndex(userId);
      const project = index.projects.find(candidate => candidate.id === projectId);
      if (!project) {
        throw new ProjectStoreError('project not found', 404);
      }
      if (!force && baseRevision !== project.revision) {
        throw new ProjectStoreError('the project was saved from somewhere else in the meantime', 409, project.revision);
      }
      const prepared = await this.prepareData(userId, data);
      const history = await this.readHistory(userId, projectId);
      if (project.revision > 0) {
        await this.keepVersion(userId, project, history);
        if (info.important) {
          const previous = history.entries.find(e => e.revision === project.revision);
          if (previous) {
            previous.keep = true;
          }
        }
      }
      await writeFileAtomic(this.dataFile(userId, projectId), prepared.data);
      project.revision += 1;
      project.size = prepared.size;
      project.updatedAt = new Date().toISOString();
      history.entries.push({
        revision: project.revision,
        savedAt: project.updatedAt,
        by: info.by,
        label: (info.label ?? '').slice(0, VERSION_LABEL_MAX_LENGTH),
        size: prepared.size,
      });
      await this.prune(userId, project, history);
      await this.writeHistory(userId, projectId, history);
      await this.writeIndex(userId, index);
      return project;
    });
  }

  /** The kept versions, newest first (the current one included) */
  listVersions(userId: string, projectId: string): Promise<VersionView[]> {
    return this.queue(userId).run(async () => {
      const project = await this.get(userId, projectId);
      const history = await this.readHistory(userId, projectId);
      const entries = [...history.entries];
      if (project.revision > 0 && !entries.some(e => e.revision === project.revision)) {
        entries.push({ revision: project.revision, savedAt: project.updatedAt, by: '', label: '', size: project.size });
      }
      return entries
        .sort((a, b) => b.revision - a.revision)
        .map(entry => ({ ...entry, current: entry.revision === project.revision }));
    });
  }

  /** Data of a kept version */
  readVersion(userId: string, projectId: string, revision: number): Promise<Buffer> {
    return this.queue(userId).run(async () => {
      const project = await this.get(userId, projectId);
      const file = revision === project.revision
        ? this.dataFile(userId, projectId)
        : path.join(this.versionsDir(userId, projectId), `${revision}.json`);
      if (!Number.isInteger(revision) || revision < 1) {
        throw new ProjectStoreError('version not found', 404);
      }
      try {
        return await fs.readFile(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new ProjectStoreError('version not found', 404);
        }
        throw error;
      }
    });
  }

  rename(userId: string, projectId: string, name: string): Promise<ProjectMeta> {
    return this.queue(userId).run(async () => {
      const index = await this.readIndex(userId);
      const project = index.projects.find(candidate => candidate.id === projectId);
      if (!project) {
        throw new ProjectStoreError('project not found', 404);
      }
      project.name = cleanProjectName(name);
      project.updatedAt = new Date().toISOString();
      await this.writeIndex(userId, index);
      return project;
    });
  }

  delete(userId: string, projectId: string): Promise<void> {
    return this.queue(userId).run(async () => {
      const index = await this.readIndex(userId);
      if (!index.projects.some(candidate => candidate.id === projectId)) {
        throw new ProjectStoreError('project not found', 404);
      }
      index.projects = index.projects.filter(candidate => candidate.id !== projectId);
      await fs.rm(this.dataFile(userId, projectId), { force: true });
      await fs.rm(this.versionsDir(userId, projectId), { recursive: true, force: true });
      await this.writeIndex(userId, index);
    });
  }

  /** Removes every project of a user (account deletion) */
  deleteAll(userId: string): Promise<void> {
    return this.queue(userId).run(async () => {
      await fs.rm(this.userDir(userId), { recursive: true, force: true });
      await this.blobs.deleteAll(userId);
    });
  }

  /**
   * Removes the files (images...) of a user that no project or kept version
   * references any more. Returns the number of files removed.
   */
  collectBlobs(userId: string, minAgeMs = BLOB_MIN_AGE_MS): Promise<number> {
    return this.queue(userId).run(async () => {
      const referenced = new Set<string>();
      const addRefs = async (file: string) => {
        try {
          findBlobRefs(await fs.readFile(file)).forEach(hash => referenced.add(hash));
        } catch {
          // removed meanwhile
        }
      };
      const index = await this.readIndex(userId);
      for (const project of index.projects) {
        await addRefs(this.dataFile(userId, project.id));
        const dir = this.versionsDir(userId, project.id);
        let names: string[] = [];
        try {
          names = await fs.readdir(dir);
        } catch {
          // no versions
        }
        for (const name of names.filter(n => /^\d+\.json$/.test(n))) {
          await addRefs(path.join(dir, name));
        }
      }
      return this.blobs.collect(userId, referenced, minAgeMs);
    });
  }
}

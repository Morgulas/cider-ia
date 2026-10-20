import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readJson, SerialQueue, writeFileAtomic } from './json-file.js';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Incremented on every save, used to detect concurrent edits */
  revision: number;
  /** Size of the saved project data, in bytes */
  size: number;
}

interface ProjectIndex {
  version: 1;
  projects: ProjectMeta[];
}

export const PROJECT_ID_PATTERN = /^[a-f0-9]{32}$/;
const USER_ID_PATTERN = /^[0-9a-f-]{36}$/;
export const PROJECT_NAME_MAX_LENGTH = 100;

export class ProjectStoreError extends Error {
  constructor(message: string, readonly status: number, readonly revision?: number) {
    super(message);
  }
}

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
 * A user can only reach the files of their own folder.
 */
export class ProjectStore {
  private readonly root: string;
  private readonly queues = new Map<string, SerialQueue>();

  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'projects');
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
  create(userId: string, name: string, data?: string): Promise<ProjectMeta> {
    return this.queue(userId).run(async () => {
      const index = await this.readIndex(userId);
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
        await writeFileAtomic(this.dataFile(userId, project.id), data);
        project.revision = 1;
        project.size = Buffer.byteLength(data);
      }
      index.projects.push(project);
      await this.writeIndex(userId, index);
      return project;
    });
  }

  /** Project data, or null for a project that was never saved (empty project) */
  async readData(userId: string, projectId: string): Promise<{ project: ProjectMeta; data: string | null }> {
    const project = await this.get(userId, projectId);
    try {
      return { project, data: await fs.readFile(this.dataFile(userId, projectId), 'utf8') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { project, data: null };
      }
      throw error;
    }
  }

  /**
   * Saves the project data. baseRevision is the revision the client loaded:
   * if someone saved in between (another tab or device), the save is refused
   * with 409 unless force is set.
   */
  writeData(userId: string, projectId: string, data: string, baseRevision: number | undefined, force: boolean): Promise<ProjectMeta> {
    return this.queue(userId).run(async () => {
      const index = await this.readIndex(userId);
      const project = index.projects.find(candidate => candidate.id === projectId);
      if (!project) {
        throw new ProjectStoreError('project not found', 404);
      }
      if (!force && baseRevision !== project.revision) {
        throw new ProjectStoreError('the project was saved from somewhere else in the meantime', 409, project.revision);
      }
      await writeFileAtomic(this.dataFile(userId, projectId), data);
      project.revision += 1;
      project.size = Buffer.byteLength(data);
      project.updatedAt = new Date().toISOString();
      await this.writeIndex(userId, index);
      return project;
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
      await this.writeIndex(userId, index);
    });
  }

  /** Removes every project of a user (account deletion) */
  deleteAll(userId: string): Promise<void> {
    return this.queue(userId).run(async () => {
      await fs.rm(this.userDir(userId), { recursive: true, force: true });
    });
  }
}

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { cardHistory } from '../data-services/indexed-db/card-history';
import { AppDB } from '../data-services/indexed-db/db';
import { findBlobRefs, runLimited } from '../data-services/indexed-db/project-blobs';
import { AuthService } from './auth.service';
import { ProjectsApiService } from './projects-api.service';
import { apiErrorMessage, ProjectMeta } from './server.types';
import { TabCoordinatorService } from './tab-coordinator.service';

/**
 * - saved: the server has every change
 * - pending: changes are waiting for the next automatic save
 * - saving: a save is in progress
 * - error: the last save failed, it will be retried
 * - conflict: the project was saved from elsewhere (another device) since it
 *   was opened here; the user must choose which version to keep
 */
export type SaveState = 'idle' | 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

/** What the last save cost, shown on the save status (finding what slows the page down) */
export interface SaveStats {
  /** reading the local copy and writing the project data */
  exportMs: number;
  /** files (images...) the server did not have, and their size */
  files: number;
  fileBytes: number;
  uploadMs: number;
  /** size of the project data sent */
  dataBytes: number;
  sendMs: number;
  totalMs: number;
  /** page blocked for more than LONG_TASK_MS during the save */
  blockedMs: number;
}

/** A task that blocks the page longer than this is reported in the console */
const LONG_TASK_MS = 200;

interface PendingMarker {
  projectId: string;
  /** revision the local working copy started from */
  revision: number;
}

/**
 * The project being edited. Its content lives on the server; the browser keeps a
 * working copy in IndexedDB (AppDB) that the whole application edits as before.
 * Every local change is saved back to the server shortly after it is made.
 *
 * Safety rules, because one browser has a single working copy:
 * - the copy records its owner (user and project); nothing is ever sent to the
 *   server unless the copy belongs to the user and project being saved
 * - only one tab at a time can have a project open (TabCoordinatorService)
 * - when another user logs in, the previous user's project is closed
 * - if the page is closed before a save finishes, a marker (per user) remembers
 *   it; the changes are sent the next time that user opens a project here
 */
@Injectable({ providedIn: 'root' })
export class CurrentProjectService {
  static readonly SAVE_DELAY_MS = 1500;
  static readonly RETRY_DELAY_MS = 10000;
  /** project files downloaded or sent at the same time */
  static readonly BLOB_CONCURRENCY = 4;

  private readonly db = inject(AppDB);
  private readonly api = inject(ProjectsApiService);
  private readonly auth = inject(AuthService);
  private readonly tabs = inject(TabCoordinatorService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  readonly project = signal<ProjectMeta | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly lastSavedAt = signal<Date | null>(null);
  readonly lastError = signal<string | null>(null);
  /** with the 'error' state: whether the save is tried again by itself */
  readonly willRetry = signal(false);
  readonly lastSaveStats = signal<SaveStats | null>(null);
  /** time the page was blocked by long tasks since the save started */
  private blockedDuringSave = 0;

  /** user the open project belongs to */
  private ownerUserId: string | null = null;
  private revision = 0;
  /** latest server revision reported by a conflict */
  private conflictRevision: number | undefined;
  private loading = false;
  private dirty = false;
  private saving: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.db.onChange().subscribe(() => this.onLocalChange());
    this.tabs.setOpenProjectCheck(() => this.project() !== null);
    // another user logged in (after a session expiry): the open project is not theirs
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        if (user && this.project() && user.id !== this.ownerUserId) {
          this.releaseForOtherUser();
        }
      });
    });
    this.watchLongTasks();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', event => {
        if (this.hasUnsavedChanges()) {
          // ask the browser to confirm leaving the page
          event.preventDefault();
        }
      });
    }
  }

  /**
   * Reports in the console every moment the page stays blocked (frozen) for
   * more than LONG_TASK_MS, saying whether a save was running.
   */
  private watchLongTasks(): void {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      return;
    }
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK_MS) {
            continue;
          }
          const saving = this.saving !== null;
          if (saving) {
            this.blockedDuringSave += entry.duration;
          }
          console.warn(`[cider] page blocked ${Math.round(entry.duration)} ms${saving ? ' during a save' : ''}`
            + ` (state: ${this.saveState()})`);
        }
      }).observe({ type: 'longtask', buffered: false });
    } catch {
      // not supported by this browser
    }
  }

  hasUnsavedChanges(): boolean {
    return this.dirty || this.saving !== null;
  }

  /** true if a project of this user is open */
  isOpenFor(userId: string | undefined): boolean {
    return this.project() !== null && userId !== undefined && this.ownerUserId === userId;
  }

  /*********************************************************************
   * Opening and closing
   *********************************************************************/

  /** Opens a project of the logged-in user (no-op if it is already open) */
  async open(projectId: string): Promise<void> {
    const user = this.auth.user();
    if (!user) {
      throw new Error('not logged in');
    }
    if (this.project()?.id === projectId && this.ownerUserId === user.id) {
      return;
    }
    if (this.project() && !(await this.close())) {
      throw new Error(this.translate.instant('server.save.close-failed'));
    }
    if (await this.tabs.projectOpenInOtherTab()) {
      throw new Error(this.translate.instant('server.projects.other-tab'));
    }
    this.loading = true;
    try {
      const meta = await this.api.get(projectId);
      const pending = this.readPendingMarker();
      if (pending) {
        const owner = await this.db.getOwner();
        const copyHoldsPending = owner?.userId === user.id && owner.projectId === pending.projectId;
        if (!copyHoldsPending) {
          // the copy was replaced since: those changes are gone, forget the marker
          this.clearPendingMarker();
        } else if (pending.projectId === projectId) {
          // the local copy holds changes made before the page was closed: send them
          this.setOpened(meta, user.id, pending.revision);
          this.loading = false;
          this.dirty = true;
          await this.save();
          return;
        } else {
          await this.saveLeftoverChanges(pending);
        }
      }
      const owner = await this.db.getOwner();
      if (owner?.userId === user.id && owner.projectId === projectId && owner.revision === meta.revision) {
        // the local copy already holds this revision (page reload): no download needed
        await this.db.reuseLocalCopy();
        this.setOpened(meta, user.id, meta.revision);
        this.saveState.set('saved');
        return;
      }
      const { data, revision } = await this.api.loadData(projectId);
      const blobs = data ? await this.downloadBlobs(data) : undefined;
      await this.db.loadProject(data, { userId: user.id, projectId, revision }, blobs);
      this.setOpened(meta, user.id, revision);
      this.saveState.set('saved');
    } finally {
      this.loading = false;
    }
  }

  private setOpened(meta: ProjectMeta, userId: string, revision: number): void {
    cardHistory.user = this.auth.user()?.username ?? '';
    this.revision = revision;
    this.conflictRevision = undefined;
    this.dirty = false;
    this.ownerUserId = userId;
    this.project.set(meta);
    this.lastError.set(null);
    this.rememberLastProject(meta.id);
  }

  /**
   * The local copy still holds unsaved changes of another project (page closed
   * before they were saved): send them to that project before replacing the copy.
   * Throws if they cannot be saved, so they are not lost.
   */
  private async saveLeftoverChanges(pending: PendingMarker): Promise<void> {
    try {
      await this.sendProject(pending.projectId, pending.revision);
      this.clearPendingMarker();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        // that project was deleted: nothing to save it to
        this.clearPendingMarker();
        return;
      }
      let name = '';
      try {
        name = (await this.api.get(pending.projectId)).name;
      } catch {
        // keep the name empty
      }
      throw new Error(this.translate.instant('server.save.pending-other', { name }), { cause: error });
    }
  }

  /**
   * Saves pending changes, then empties the local working copy.
   * Returns false (and keeps the project open) if the changes could not be saved.
   */
  async close(discardUnsaved = false): Promise<boolean> {
    if (!this.project()) {
      return true;
    }
    if (!discardUnsaved) {
      await this.flush();
      if (this.dirty) {
        return false;
      }
    }
    this.clearPendingMarker();
    this.forgetLastProject();
    this.resetState();
    this.loading = true;
    try {
      await this.db.loadProject(null);
    } finally {
      this.loading = false;
    }
    return true;
  }

  /**
   * Another user logged in on this browser: stop working on the previous user's
   * project. Its unsaved changes stay in the local copy, with that user's marker:
   * they are sent if that user opens a project here again before anyone else does.
   */
  releaseForOtherUser(): void {
    this.resetState();
  }

  private resetState(): void {
    clearTimeout(this.saveTimer);
    this.dirty = false;
    this.ownerUserId = null;
    this.conflictRevision = undefined;
    this.project.set(null);
    this.saveState.set('idle');
  }

  /** Project to reopen after a page reload, if any */
  lastProjectId(): string | null {
    const user = this.auth.user();
    return user ? localStorage.getItem(this.key('last', user.id)) : null;
  }

  /*********************************************************************
   * Saving
   *********************************************************************/

  private onLocalChange(): void {
    if (!this.project() || this.loading) {
      return;
    }
    this.dirty = true;
    this.writePendingMarker();
    if (this.saveState() !== 'conflict') {
      this.saveState.set('pending');
      this.scheduleSave(CurrentProjectService.SAVE_DELAY_MS);
    }
  }

  private scheduleSave(delay: number): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), delay);
  }

  /** Saves now if there are pending changes; waits for a save already running */
  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.saving) {
      await this.saving;
    }
    if (this.dirty && this.saveState() !== 'conflict') {
      await this.save();
    }
  }

  /**
   * Conflict resolution: saves the local version over the server one. Based on the
   * revision reported by the conflict, so a version saved after the conflict was
   * shown is not overwritten silently (it raises a new conflict instead).
   */
  async keepLocalVersion(): Promise<void> {
    if (this.conflictRevision !== undefined) {
      this.revision = this.conflictRevision;
    }
    this.dirty = true;
    this.saveState.set('pending');
    await this.save();
  }

  /** Conflict resolution: drops the local changes and reloads the server version */
  async reloadServerVersion(): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }
    this.clearPendingMarker();
    this.resetState();
    await this.open(project.id);
  }

  private save(): Promise<void> {
    if (this.saving) {
      // a save is running: run another one after it if changes arrived meanwhile
      return this.saving.then(() => (this.dirty ? this.save() : undefined));
    }
    const project = this.project();
    if (!project || !this.dirty) {
      return Promise.resolve();
    }
    this.saving = this.doSave(project).finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  /** Descriptions of the changes not saved yet, sent with the next save (version history) */
  private changeLabels: string[] = [];
  private changeImportant = false;

  /**
   * Describes a change made to the project (import, bulk action...): recorded
   * with the next save in the version history. Important changes keep the
   * version before them longer.
   */
  describeChange(label: string, important = false): void {
    if (label && !this.changeLabels.includes(label)) {
      this.changeLabels.push(label);
    }
    this.changeImportant ||= important;
  }

  /**
   * Saves the current state before an operation, so it gets its own version
   * that can be restored; then describes the operation for the next save.
   */
  async checkpoint(label: string): Promise<void> {
    await cardHistory.flush();
    await this.flush();
    this.describeChange(label, true);
  }

  private async doSave(project: ProjectMeta): Promise<void> {
    // journal entries still in memory belong to this save
    await cardHistory.flush();
    // changes made during the export mark the project dirty again
    this.dirty = false;
    const change = { label: this.changeLabels.join(' ; '), important: this.changeImportant };
    this.changeLabels = [];
    this.changeImportant = false;
    this.saveState.set('saving');
    try {
      const owner = await this.db.getOwner();
      if (owner?.userId !== this.ownerUserId || owner?.projectId !== project.id) {
        this.copyReplaced();
        return;
      }
      const saved = await this.sendProject(project.id, this.revision, change.label || change.important ? change : undefined);
      if (this.project()?.id !== project.id) {
        return;
      }
      this.revision = saved.revision;
      this.conflictRevision = undefined;
      this.project.set(saved);
      this.lastError.set(null);
      if (this.dirty) {
        this.saveState.set('pending');
        this.scheduleSave(CurrentProjectService.SAVE_DELAY_MS);
      } else {
        // the copy now matches the server: a page reload can reuse it
        await this.db.setOwnerRevision(saved.revision);
        this.clearPendingMarker();
        this.saveState.set('saved');
        this.lastSavedAt.set(new Date());
      }
    } catch (error) {
      if (this.project()?.id !== project.id) {
        return;
      }
      this.dirty = true;
      // described again with the next attempt
      if (change.label) {
        this.changeLabels.unshift(change.label);
      }
      this.changeImportant ||= change.important;
      if (error instanceof HttpErrorResponse && error.status === 409) {
        const revision = (error.error as { revision?: unknown } | null)?.revision;
        this.conflictRevision = typeof revision === 'number' ? revision : undefined;
        this.saveState.set('conflict');
        this.lastError.set(apiErrorMessage(error, 'The project was saved from somewhere else'));
        return;
      }
      if (error instanceof HttpErrorResponse && error.status === 413) {
        // retrying cannot help: saved again with the next change (an image removed...)
        this.saveState.set('error');
        this.willRetry.set(false);
        this.lastError.set(this.tooLargeMessage(error));
        return;
      }
      this.saveState.set('error');
      this.willRetry.set(true);
      this.lastError.set(apiErrorMessage(error, 'The project could not be saved'));
      this.scheduleSave(CurrentProjectService.RETRY_DELAY_MS);
    }
  }

  /** The project is over the size limit of the server (whole project, or one request) */
  private tooLargeMessage(error: HttpErrorResponse): string {
    const body = error.error as { size?: unknown; maxSize?: unknown } | null;
    const mb = (bytes: number, round: (value: number) => number) => round(bytes / (1024 * 1024));
    if (body && typeof body === 'object' && typeof body.size === 'number' && typeof body.maxSize === 'number') {
      return this.translate.instant('server.save.too-large', {
        size: mb(body.size, Math.ceil), max: mb(body.maxSize, Math.floor),
      });
    }
    return this.translate.instant('server.save.too-large-request');
  }

  /*********************************************************************
   * Project files (images, fonts...): stored apart on the server, once each
   *********************************************************************/

  /** Downloads the files referenced by project data (the browser cache serves those already seen) */
  private async downloadBlobs(data: Blob): Promise<Map<string, Blob>> {
    const blobs = new Map<string, Blob>();
    await runLimited(findBlobRefs(await data.text()), CurrentProjectService.BLOB_CONCURRENCY, async hash => {
      blobs.set(hash, await this.api.blob(hash));
    });
    return blobs;
  }

  /** Sends those of these files that the server does not have yet */
  private async uploadBlobs(blobs: Map<string, Blob | ArrayBuffer>, hashes?: string[]): Promise<{ files: number; bytes: number }> {
    const missing = (hashes ?? await this.api.missingBlobs([...blobs.keys()])).filter(hash => blobs.has(hash));
    await runLimited(missing, CurrentProjectService.BLOB_CONCURRENCY, hash => this.api.uploadBlob(hash, blobs.get(hash)!));
    const size = (data: Blob | ArrayBuffer | undefined) => data instanceof Blob ? data.size : data?.byteLength ?? 0;
    return { files: missing.length, bytes: missing.reduce((sum, hash) => sum + size(blobs.get(hash)), 0) };
  }

  /**
   * Saves the local copy to a project: the data with references, after the
   * files the server does not have yet. Only new or changed images are sent.
   */
  private async sendProject(projectId: string, baseRevision: number,
    change?: { label: string; important: boolean }): Promise<ProjectMeta> {
    const started = performance.now();
    this.blockedDuringSave = 0;
    const { data, blobs } = await this.db.exportProjectForServer();
    const exported = performance.now();
    const uploaded = await this.uploadBlobs(blobs);
    const uploadEnd = performance.now();
    const send = () => change
      ? this.api.saveData(projectId, data, baseRevision, false, change)
      : this.api.saveData(projectId, data, baseRevision);
    let saved: ProjectMeta;
    try {
      saved = await send();
    } catch (error) {
      // files removed from the server meanwhile: send them, then try once more
      const missing = error instanceof HttpErrorResponse && error.status === 422
        ? (error.error as { missing?: unknown } | null)?.missing : undefined;
      if (!Array.isArray(missing)) {
        throw error;
      }
      await this.uploadBlobs(blobs, missing as string[]);
      saved = await send();
    }
    const end = performance.now();
    const stats: SaveStats = {
      exportMs: Math.round(exported - started), files: uploaded.files, fileBytes: uploaded.bytes,
      uploadMs: Math.round(uploadEnd - exported), dataBytes: data.size, sendMs: Math.round(end - uploadEnd),
      totalMs: Math.round(end - started), blockedMs: Math.round(this.blockedDuringSave),
    };
    this.lastSaveStats.set(stats);
    console.info(`[cider] save: ${stats.totalMs} ms (reading ${stats.exportMs} ms, ${stats.files} file(s) `
      + `${Math.round(stats.fileBytes / 1024)} KB in ${stats.uploadMs} ms, data ${Math.round(stats.dataBytes / 1024)} KB `
      + `in ${stats.sendMs} ms, page blocked ${stats.blockedMs} ms)`);
    return saved;
  }

  /**
   * The local copy no longer holds this project (replaced from another tab):
   * saving it would overwrite the project with another one. Stop and go back to
   * the project list.
   */
  private copyReplaced(): void {
    this.resetState();
    this.saveState.set('error');
    this.willRetry.set(false);
    this.lastError.set(this.translate.instant('server.save.copy-replaced'));
    void this.router.navigateByUrl('/projects');
  }

  /*********************************************************************
   * Browser storage (per user)
   *********************************************************************/

  private key(kind: 'pending' | 'last', userId: string): string {
    return `cider.${kind}.${userId}`;
  }

  private readPendingMarker(): PendingMarker | null {
    const user = this.auth.user();
    if (!user) {
      return null;
    }
    try {
      return JSON.parse(localStorage.getItem(this.key('pending', user.id)) ?? 'null');
    } catch {
      return null;
    }
  }

  private writePendingMarker(): void {
    const project = this.project();
    if (this.ownerUserId && project) {
      const marker: PendingMarker = { projectId: project.id, revision: this.revision };
      localStorage.setItem(this.key('pending', this.ownerUserId), JSON.stringify(marker));
    }
  }

  private clearPendingMarker(): void {
    const userId = this.ownerUserId ?? this.auth.user()?.id;
    if (userId) {
      localStorage.removeItem(this.key('pending', userId));
    }
  }

  private rememberLastProject(projectId: string): void {
    const user = this.auth.user();
    if (user) {
      localStorage.setItem(this.key('last', user.id), projectId);
    }
  }

  private forgetLastProject(): void {
    const userId = this.ownerUserId ?? this.auth.user()?.id;
    if (userId) {
      localStorage.removeItem(this.key('last', userId));
    }
  }
}

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AppDB } from '../data-services/indexed-db/db';
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
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', event => {
        if (this.hasUnsavedChanges()) {
          // ask the browser to confirm leaving the page
          event.preventDefault();
        }
      });
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
      const { data, revision } = await this.api.loadData(projectId);
      await this.db.loadProject(data, { userId: user.id, projectId });
      this.setOpened(meta, user.id, revision);
      this.saveState.set('saved');
    } finally {
      this.loading = false;
    }
  }

  private setOpened(meta: ProjectMeta, userId: string, revision: number): void {
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
      await this.api.saveData(pending.projectId, await this.db.exportProject(), pending.revision);
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

  private async doSave(project: ProjectMeta): Promise<void> {
    // changes made during the export mark the project dirty again
    this.dirty = false;
    this.saveState.set('saving');
    try {
      const owner = await this.db.getOwner();
      if (owner?.userId !== this.ownerUserId || owner?.projectId !== project.id) {
        this.copyReplaced();
        return;
      }
      const data = await this.db.exportProject();
      const saved = await this.api.saveData(project.id, data, this.revision);
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
        this.clearPendingMarker();
        this.saveState.set('saved');
        this.lastSavedAt.set(new Date());
      }
    } catch (error) {
      if (this.project()?.id !== project.id) {
        return;
      }
      this.dirty = true;
      if (error instanceof HttpErrorResponse && error.status === 409) {
        const revision = (error.error as { revision?: unknown } | null)?.revision;
        this.conflictRevision = typeof revision === 'number' ? revision : undefined;
        this.saveState.set('conflict');
        this.lastError.set(apiErrorMessage(error, 'The project was saved from somewhere else'));
        return;
      }
      this.saveState.set('error');
      this.lastError.set(apiErrorMessage(error, 'The project could not be saved'));
      this.scheduleSave(CurrentProjectService.RETRY_DELAY_MS);
    }
  }

  /**
   * The local copy no longer holds this project (replaced from another tab):
   * saving it would overwrite the project with another one. Stop and go back to
   * the project list.
   */
  private copyReplaced(): void {
    this.resetState();
    this.saveState.set('error');
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

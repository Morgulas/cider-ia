import { HttpClient } from '@angular/common/http';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Button } from 'primeng/button';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { RadioButton } from 'primeng/radiobutton';
import { TableModule } from 'primeng/table';
import { firstValueFrom } from 'rxjs';
import FileUtils from '../../shared/utils/file-utils';
import { CurrentProjectService } from '../current-project.service';
import { ProjectsApiService } from '../projects-api.service';
import { apiErrorMessage, ProjectMeta } from '../server.types';
import { SessionActionsService } from '../session-actions.service';
import { DesktopProjectImporter } from '../project-import/desktop-project-importer.service';
import { isDexieExport, upgradeLegacyExport } from '../project-import/legacy-export';
import { filesFromFolder, filesFromZip, ProjectFile, projectRoot } from '../project-import/project-files';
import { TopbarComponent } from '../topbar/topbar.component';
import { ProjectVersionsDialogComponent } from '../project-versions/project-versions-dialog.component';

const SAMPLE_PROJECT_FILE = 'assets/cosmic-apple.json';

/** The logged-in user's projects: create, import, open, rename, download, delete */
@Component({
  selector: 'app-projects-page',
  templateUrl: './projects-page.component.html',
  styleUrl: './projects-page.component.scss',
  providers: [ConfirmationService],
  imports: [TopbarComponent, FormsModule, TableModule, Button, Dialog, InputText, RadioButton, Message,
    ConfirmDialog, DatePipe, DecimalPipe, TranslatePipe, ProjectVersionsDialogComponent]
})
export class ProjectsPageComponent implements OnInit {
  private readonly api = inject(ProjectsApiService);
  protected readonly currentProject = inject(CurrentProjectService);
  private readonly sessionActions = inject(SessionActionsService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly desktopImporter = inject(DesktopProjectImporter);

  protected readonly projects = signal<ProjectMeta[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  protected importDialogVisible = false;
  protected versionsVisible = false;
  protected versionsProject: ProjectMeta | null = null;

  protected openVersions(project: ProjectMeta): void {
    this.versionsProject = project;
    this.versionsVisible = true;
  }

  protected refreshList(): Promise<void> {
    return this.refresh();
  }

  protected newDialogVisible = false;
  protected newName = '';
  protected newStart: 'empty' | 'sample' = 'empty';

  protected renameDialogVisible = false;
  protected renameTarget: ProjectMeta | null = null;
  protected renameName = '';

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.projects.set(await this.api.list());
    } catch (error) {
      this.error.set(apiErrorMessage(error, this.translate.instant('server.login.server-unreachable')));
    } finally {
      this.loading.set(false);
    }
  }

  /** Runs an action with the busy indicator, showing its error if it fails */
  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(apiErrorMessage(error, error instanceof Error ? error.message : 'Error'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async open(project: ProjectMeta): Promise<void> {
    await this.run(async () => {
      if (this.currentProject.project()?.id !== project.id && !(await this.sessionActions.closeProject())) {
        return;
      }
      await this.currentProject.open(project.id);
      await this.router.navigateByUrl('/project');
    });
  }

  protected openNewDialog(): void {
    this.newName = '';
    this.newStart = 'empty';
    this.newDialogVisible = true;
  }

  protected async create(): Promise<void> {
    await this.run(async () => {
      const project = await this.api.create(this.newName);
      if (this.newStart === 'sample') {
        const sample = await firstValueFrom(this.http.get(SAMPLE_PROJECT_FILE, { responseType: 'blob' }));
        await this.api.saveData(project.id, sample, 0);
      }
      this.newDialogVisible = false;
      await this.refresh();
    });
  }

  /**
   * Imports a database export (web version: database.json) as a new project named
   * after the file. Exports of older versions are brought up to the current tables.
   */
  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    await this.run(async () => {
      let dump: unknown;
      try {
        dump = JSON.parse(await file.text());
      } catch {
        dump = null;
      }
      if (!isDexieExport(dump)) {
        throw new Error(this.translate.instant('server.projects.import-invalid'));
      }
      const data: Blob = upgradeLegacyExport(dump)
        ? new Blob([JSON.stringify(dump)], { type: 'application/json' })
        : file;
      const name = file.name.replace(/\.json$/i, '').slice(0, 100) || 'Import';
      const project = await this.api.create(name);
      await this.api.saveData(project.id, data, 0);
      await this.refresh();
      this.info.set(this.translate.instant('server.projects.import-done', { name: project.name }));
    });
  }

  /** Imports a project folder of the desktop version, chosen with the folder picker */
  protected async importFolder(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = filesFromFolder(Array.from(input.files ?? []));
    input.value = '';
    if (files.length > 0) {
      await this.run(() => this.importDesktopProject(files, ''));
    }
  }

  /** Imports a project folder of the desktop version, compressed in a .zip archive */
  protected async importZip(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    await this.run(async () => {
      let files: ProjectFile[];
      try {
        files = await filesFromZip(file);
      } catch (error) {
        throw new Error(this.translate.instant('server.projects.import-zip-invalid'), { cause: error });
      }
      await this.importDesktopProject(files, file.name.replace(/\.zip$/i, ''));
    });
  }

  /**
   * Creates a project, opens it and reads the desktop folder into it, then saves
   * it. If anything fails, the half-imported project is deleted.
   */
  private async importDesktopProject(files: ProjectFile[], preferredName: string): Promise<void> {
    const root = projectRoot(files);
    if (!root) {
      throw new Error(this.translate.instant('server.projects.import-folder-invalid'));
    }
    if (!(await this.sessionActions.closeProject())) {
      return;
    }
    const name = (preferredName || root.name || 'Import').slice(0, 100);
    const project = await this.api.create(name);
    try {
      await this.currentProject.open(project.id);
      const summary = await this.desktopImporter.import(root.files);
      await this.currentProject.flush();
      if (this.currentProject.hasUnsavedChanges()) {
        throw new Error(this.translate.instant('server.projects.import-not-saved'));
      }
      await this.refresh();
      this.info.set(this.translate.instant('server.projects.import-desktop-done', { name: project.name, ...summary }));
    } catch (error) {
      await this.currentProject.close(true);
      await this.api.delete(project.id).catch(() => undefined);
      await this.refresh();
      throw error;
    }
  }

  protected openRenameDialog(project: ProjectMeta): void {
    this.renameTarget = project;
    this.renameName = project.name;
    this.renameDialogVisible = true;
  }

  protected async rename(): Promise<void> {
    const target = this.renameTarget;
    if (!target) {
      return;
    }
    await this.run(async () => {
      const renamed = await this.api.rename(target.id, this.renameName);
      if (this.currentProject.project()?.id === renamed.id) {
        this.currentProject.project.set({ ...this.currentProject.project()!, name: renamed.name });
      }
      this.renameDialogVisible = false;
      await this.refresh();
    });
  }

  /** Downloads the project as a database.json file (saving pending changes first) */
  protected async download(project: ProjectMeta): Promise<void> {
    await this.run(async () => {
      if (this.currentProject.project()?.id === project.id) {
        await this.currentProject.flush();
      }
      const { data } = await this.api.loadData(project.id);
      if (data) {
        FileUtils.saveAs(data, `${project.name}.json`);
      }
    });
  }

  protected confirmDelete(project: ProjectMeta): void {
    this.confirmation.confirm({
      header: this.translate.instant('server.projects.delete-title'),
      message: this.translate.instant('server.projects.delete-confirm', { name: project.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.run(async () => {
        if (this.currentProject.project()?.id === project.id) {
          await this.currentProject.close(true);
        }
        await this.api.delete(project.id);
        await this.refresh();
      })
    });
  }
}

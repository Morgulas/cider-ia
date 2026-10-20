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
import { TopbarComponent } from '../topbar/topbar.component';

const SAMPLE_PROJECT_FILE = 'assets/cosmic-apple.json';

/** The logged-in user's projects: create, import, open, rename, download, delete */
@Component({
  selector: 'app-projects-page',
  templateUrl: './projects-page.component.html',
  styleUrl: './projects-page.component.scss',
  providers: [ConfirmationService],
  imports: [TopbarComponent, FormsModule, TableModule, Button, Dialog, InputText, RadioButton, Message,
    ConfirmDialog, DatePipe, DecimalPipe, TranslatePipe]
})
export class ProjectsPageComponent implements OnInit {
  private readonly api = inject(ProjectsApiService);
  protected readonly currentProject = inject(CurrentProjectService);
  private readonly sessionActions = inject(SessionActionsService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly projects = signal<ProjectMeta[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

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

  /** Imports a database.json export as a new project named after the file */
  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    await this.run(async () => {
      let valid: boolean;
      try {
        valid = JSON.parse(await file.text())?.formatName === 'dexie';
      } catch {
        valid = false;
      }
      if (!valid) {
        throw new Error(this.translate.instant('server.projects.import-invalid'));
      }
      const name = file.name.replace(/\.json$/i, '').slice(0, 100) || 'Import';
      const project = await this.api.create(name);
      await this.api.saveData(project.id, file, 0);
      await this.refresh();
    });
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

import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, input, model, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Button } from 'primeng/button';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { TableModule } from 'primeng/table';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import FileUtils from '../../shared/utils/file-utils';
import { CurrentProjectService } from '../current-project.service';
import { ProjectsApiService } from '../projects-api.service';
import { apiErrorMessage, ProjectMeta, ProjectVersion } from '../server.types';

/**
 * Versions of a project kept by the server: download one, restore it as the
 * current state (the replaced state stays in the list) or as a new project.
 */
@Component({
  selector: 'app-project-versions-dialog',
  templateUrl: './project-versions-dialog.component.html',
  styleUrl: './project-versions-dialog.component.scss',
  providers: [ConfirmationService],
  imports: [Dialog, Button, ConfirmDialog, Message, TableModule, Tag, Tooltip, DatePipe, DecimalPipe, TranslatePipe]
})
export class ProjectVersionsDialogComponent {
  private readonly api = inject(ProjectsApiService);
  private readonly currentProject = inject(CurrentProjectService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);

  readonly visible = model(false);
  readonly project = input<ProjectMeta | null>(null);
  /** a version was restored (as current state or as a new project) */
  readonly restored = output<ProjectMeta>();

  protected readonly versions = signal<ProjectVersion[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  protected async onShow(): Promise<void> {
    const project = this.project();
    this.error.set(null);
    this.info.set(null);
    if (!project) {
      return;
    }
    this.loading.set(true);
    try {
      if (this.isOpen()) {
        // the latest changes become the current version
        await this.currentProject.flush();
      }
      this.versions.set(await this.api.versions(project.id));
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private isOpen(): boolean {
    return this.currentProject.project()?.id === this.project()?.id;
  }

  protected label(version: ProjectVersion): string {
    const restore = /^restore:(\d+)$/.exec(version.label);
    if (restore) {
      return this.translate.instant('server.versions.restore-label', { revision: restore[1] });
    }
    if (!version.label) {
      return this.translate.instant(version.revision === 1 ? 'server.versions.first' : 'server.versions.edits');
    }
    return version.label;
  }

  protected async download(version: ProjectVersion): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }
    try {
      const data = await this.api.versionData(project.id, version.revision);
      FileUtils.saveAs(data, `${project.name} (v${version.revision}).json`);
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    }
  }

  protected confirmRestore(version: ProjectVersion): void {
    this.confirmation.confirm({
      header: this.translate.instant('server.versions.restore'),
      message: this.translate.instant('server.versions.restore-confirm', { revision: version.revision }),
      icon: 'pi pi-history',
      acceptLabel: this.translate.instant('server.versions.restore'),
      rejectLabel: this.translate.instant('controls.cancel'),
      accept: () => void this.restore(version, false),
    });
  }

  protected restore(version: ProjectVersion, asNew: boolean): Promise<void> {
    const project = this.project();
    if (!project) {
      return Promise.resolve();
    }
    return this.run(async () => {
      if (asNew) {
        const name = this.translate.instant('server.versions.copy-name', { name: project.name, revision: version.revision });
        const created = await this.api.restoreVersion(project.id, version.revision, true, name.slice(0, 100));
        this.info.set(this.translate.instant('server.versions.restored-as-new', { name: created.name }));
        this.restored.emit(created);
        return;
      }
      if (this.isOpen()) {
        await this.currentProject.flush();
      }
      const restored = await this.api.restoreVersion(project.id, version.revision);
      if (this.isOpen()) {
        await this.currentProject.reloadServerVersion();
      }
      this.versions.set(await this.api.versions(project.id));
      this.info.set(this.translate.instant('server.versions.restored', { revision: version.revision }));
      this.restored.emit(restored);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
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
}

import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Dialog } from 'primeng/dialog';
import PackageUtils from '../shared/utils/package-utils';
import { Bind } from 'primeng/bind';
import { Button } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { CurrentProjectService } from '../server/current-project.service';

@Component({
    selector: 'app-site-footer',
    templateUrl: './site-footer.component.html',
    styleUrls: ['./site-footer.component.scss'],
    imports: [Bind, Button, Tooltip, Dialog, DatePipe, TranslatePipe]
})
export class SiteFooterComponent {
  appVersion = '0.0.0';
  protected readonly currentProject = inject(CurrentProjectService);
  /** the conflict dialog stays open until the user picks a version */
  protected readonly conflict = computed(() => this.currentProject.saveState() === 'conflict');
  private readonly translate = inject(TranslateService);

  /** Cost of the last save, on hover of the save status */
  protected saveStatsText(): string {
    const stats = this.currentProject.lastSaveStats();
    if (!stats) {
      return '';
    }
    const kb = (bytes: number) => Math.max(1, Math.round(bytes / 1024));
    return this.translate.instant('server.save.stats', {
      total: stats.totalMs, export: stats.exportMs, files: stats.files, fileKb: kb(stats.fileBytes),
      upload: stats.uploadMs, dataKb: kb(stats.dataBytes), send: stats.sendMs, blocked: stats.blockedMs,
    });
  }
  protected resolving = false;

  constructor() {
    this.appVersion = PackageUtils.getVersion();
  }

  protected async keepLocal(): Promise<void> {
    this.resolving = true;
    try {
      await this.currentProject.keepLocalVersion();
    } finally {
      this.resolving = false;
    }
  }

  protected async reloadServer(): Promise<void> {
    this.resolving = true;
    try {
      await this.currentProject.reloadServerVersion();
    } finally {
      this.resolving = false;
    }
  }

  /** Source of this modified version (AGPL-3.0 section 13): the fork, not the original */
  navigateToGithub() {
    window.open('https://github.com/Morgulas/cider-ia', "_blank");
  }
  navigateToUserGuide() {
    window.open('https://oatear.github.io/cider-docs/docs/overview', "_blank");
  }
  navigateToDiscord() {
    window.open('https://discord.gg/S66xw9Wc9V', "_blank");
  }

}

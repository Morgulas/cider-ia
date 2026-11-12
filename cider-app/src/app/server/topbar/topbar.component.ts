import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MenuItem } from 'primeng/api';
import { Menu } from 'primeng/menu';
import { Button } from 'primeng/button';
import { AuthService } from '../auth.service';
import { CurrentProjectService } from '../current-project.service';
import { SessionActionsService } from '../session-actions.service';

/**
 * Header of every page. Inside a project, the project menu and the breadcrumb
 * are projected into it (see SiteMenuComponent).
 */
@Component({
  selector: 'app-topbar',
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss',
  imports: [RouterLink, RouterLinkActive, Button, Menu, TranslatePipe]
})
export class TopbarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly currentProject = inject(CurrentProjectService);
  private readonly sessionActions = inject(SessionActionsService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  /** changes with the language, so the menu labels follow it */
  private readonly language = toSignal(this.translate.onLangChange);

  /** the page is inside the open project: no "back to project" button */
  readonly inProject = input(false);

  /** Menu of small screens: the links and the logout of the bar */
  protected readonly menuItems = computed<MenuItem[]>(() => {
    this.language();
    const t = (key: string) => this.translate.instant(key);
    const link = (key: string, icon: string, url: string): MenuItem => ({ label: t(key), icon, command: () => this.router.navigateByUrl(url) });
    const project = this.currentProject.project();
    return [
      ...(!this.inProject() && project ? [link('server.topbar.back-to-project', 'pi pi-arrow-left', '/project')] : []),
      link('server.topbar.projects', 'pi pi-folder-open', '/projects'),
      ...(this.auth.isAdmin() ? [
        link('server.topbar.admin', 'pi pi-users', '/admin/users'),
        link('server.topbar.ai-settings', 'pi pi-sparkles', '/admin/ai'),
      ] : []),
      link('server.topbar.account', 'pi pi-user', '/account'),
      { separator: true },
      { label: t('server.topbar.logout') + (this.auth.user() ? ` (${this.auth.user()!.username})` : ''), icon: 'pi pi-sign-out', command: () => this.logout() },
    ];
  });

  protected backToProject(): void {
    this.router.navigateByUrl('/project');
  }

  protected logout(): void {
    void this.sessionActions.logout();
  }
}

import { Component, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
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
  imports: [RouterLink, RouterLinkActive, Button, TranslatePipe]
})
export class TopbarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly currentProject = inject(CurrentProjectService);
  private readonly sessionActions = inject(SessionActionsService);
  private readonly router = inject(Router);

  /** the page is inside the open project: no "back to project" button */
  readonly inProject = input(false);

  protected backToProject(): void {
    this.router.navigateByUrl('/project');
  }

  protected logout(): void {
    void this.sessionActions.logout();
  }
}

import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { AuthService } from '../auth.service';
import { CurrentProjectService } from '../current-project.service';
import { SessionActionsService } from '../session-actions.service';

/** Header of the pages outside a project: projects, users, account */
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

  protected backToProject(): void {
    this.router.navigateByUrl('/project');
  }

  protected logout(): void {
    void this.sessionActions.logout();
  }
}

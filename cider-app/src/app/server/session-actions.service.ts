import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { CurrentProjectService } from './current-project.service';

/** Actions that end or change the session: they must save and close the project first */
@Injectable({ providedIn: 'root' })
export class SessionActionsService {
  private readonly auth = inject(AuthService);
  private readonly currentProject = inject(CurrentProjectService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  /**
   * Saves and closes the open project, then logs out. The local working copy is
   * emptied so the next person using this browser cannot see the project.
   */
  async logout(): Promise<void> {
    if (!(await this.closeProject())) {
      return;
    }
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  /** Saves and closes the open project; asks before losing unsaved changes */
  async closeProject(): Promise<boolean> {
    if (await this.currentProject.close()) {
      return true;
    }
    const leave = window.confirm(this.translate.instant('server.save.unsaved-message'));
    return leave ? this.currentProject.close(true) : false;
  }
}

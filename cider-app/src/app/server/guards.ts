import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { CurrentProjectService } from './current-project.service';

/** Pages that need a logged-in user; otherwise go to login (or first setup) */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.user()) {
    return true;
  }
  if (auth.setupRequired()) {
    return router.createUrlTree(['/setup']);
  }
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Login and setup pages: only when logged out */
export const guestGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.user()) {
    return router.createUrlTree(['/projects']);
  }
  const isSetupPage = route.routeConfig?.path === 'setup';
  if (auth.setupRequired() !== isSetupPage) {
    return router.createUrlTree([auth.setupRequired() ? '/setup' : '/login']);
  }
  return true;
};

/** Administration pages */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAdmin() ? true : inject(Router).createUrlTree(['/projects']);
};

/**
 * Project pages (decks, templates, simulator...): a project must be open.
 * After a page reload, the last opened project is reopened.
 */
export const projectGuard: CanActivateFn = async () => {
  const currentProject = inject(CurrentProjectService);
  const auth = inject(AuthService);
  const router = inject(Router);
  if (currentProject.isOpenFor(auth.user()?.id)) {
    return true;
  }
  if (currentProject.project()) {
    // a project of another user is still open (session expired, someone else logged in)
    currentProject.releaseForOtherUser();
  }
  const lastProjectId = currentProject.lastProjectId();
  if (lastProjectId) {
    try {
      await currentProject.open(lastProjectId);
      return true;
    } catch {
      // deleted or unreachable project: let the user choose another one
    }
  }
  return router.createUrlTree(['/projects']);
};

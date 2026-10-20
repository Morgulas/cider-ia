import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { CSRF_HEADER } from './server.types';
import { AuthService } from './auth.service';

/**
 * For calls to the cider-server API: adds the anti-CSRF header, and sends the
 * user back to the login page when the session has expired.
 */
export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) {
    return next(request);
  }
  const router = inject(Router);
  const auth = inject(AuthService);
  const withHeader = request.clone({ setHeaders: { [CSRF_HEADER]: '1' } });
  return next(withHeader).pipe(
    catchError((error: unknown) => {
      const expired = error instanceof HttpErrorResponse && error.status === 401
        && !request.url.startsWith('/api/auth/');
      if (expired && auth.user()) {
        auth.sessionExpired();
        router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
      }
      return throwError(() => error);
    })
  );
};

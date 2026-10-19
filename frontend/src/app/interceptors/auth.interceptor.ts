import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

/**
 * A 401 outside the auth endpoints means the session cookie expired or was rejected. The auth
 * endpoints are excluded because 401 is an expected answer there: /me before login, /login on
 * bad credentials.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !req.url.startsWith(`${environment.apiUrl}/auth/`)
      ) {
        authService.endSession();
      }
      return throwError(() => error);
    }),
  );
};

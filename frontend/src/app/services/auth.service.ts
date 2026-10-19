import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of, tap } from 'rxjs';
import { OpenAPIDefinitionService } from '../api/generated/nimuairy-api';
import { environment } from '../../environments/environment';
import {
  CurrentUserResponse,
  LoginRequest,
  RegisterRequest,
} from '../api/generated/model';

/**
 * The JWT lives in an HttpOnly cookie that this code can never read. The browser attaches it to
 * /api requests on its own, so the frontend only tracks who is logged in, as the backend reports it.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(OpenAPIDefinitionService);
  private readonly router = inject(Router);

  readonly currentUser = signal<CurrentUserResponse | null>(null);

  readonly isLoggedIn = computed(() => this.currentUser() !== null);

  /**
   * Runs once at startup, before the first route is activated. Asking the backend is the only way
   * to know whether the cookie survived a reload. The response also carries the XSRF-TOKEN cookie
   * that the first POST (login) needs.
   *
   * Uses HttpClient directly because the generated client exposes GET /me only as an httpResource,
   * which cannot be awaited by an app initializer.
   */
  loadSession(): Observable<void> {
    return this.http
      .get<CurrentUserResponse>(`${environment.apiUrl}/auth/me`)
      .pipe(
        tap((user) => this.currentUser.set(user)),
        catchError(() => {
          this.currentUser.set(null);
          return of(null);
        }),
        map(() => undefined),
      );
  }

  register(request: RegisterRequest): Observable<CurrentUserResponse> {
    return this.api
      .register(request)
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  login(request: LoginRequest): Observable<CurrentUserResponse> {
    return this.api
      .login(request)
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  async logout(): Promise<void> {
    try {
      // Only the backend can expire an HttpOnly cookie.
      await firstValueFrom(this.api.logout());
    } finally {
      this.endSession();
    }
  }

  /** Forgets the user locally, e.g. after a 401 shows the cookie has expired. */
  endSession(): void {
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }
}

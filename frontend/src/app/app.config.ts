import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterResources,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { AuthService } from './services/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withRouterResources(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),
    // Angular's built-in XSRF support copies the XSRF-TOKEN cookie into X-XSRF-TOKEN on
    // mutating requests to relative URLs, which is what the backend's csrf.spa() expects.
    provideHttpClient(withInterceptors([authInterceptor])),
    // The router waits for initializers, so the guards see the restored session after a reload.
    provideAppInitializer(() => inject(AuthService).loadSession()),
  ],
};

import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { App } from './app/app';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/core/auth.interceptor';
import { idempotencyInterceptor } from './app/core/idempotency.interceptor';
import { DemoTitleStrategy, mountDemoChrome } from './app/demo/demo-chrome';
import { demoBackendInterceptor } from './app/demo/demo-interceptor';

/*
 * DEMO entry point (angular.json -> configurations.demo.browser). Same app, same routes, same guard and interceptors as
 * the real main.ts; the only differences are the in-browser fake API at the end of the HTTP chain, the demo page titles
 * and the "demo" banner. The real build never imports anything from ./app/demo.
 */
bootstrapApplication(App, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, idempotencyInterceptor, demoBackendInterceptor])),
    { provide: TitleStrategy, useClass: DemoTitleStrategy },
  ],
})
  .then(() => mountDemoChrome())
  .catch((err) => console.error(err));

import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { delay, from, of, switchMap, throwError } from 'rxjs';
import { DemoBackend } from './demo-backend';

/** DEMO ONLY. One in-memory fake server per page; answers every /v1 call so no request ever leaves the browser. */
export const demoBackend = new DemoBackend();

export const demoBackendInterceptor: HttpInterceptorFn = (req) => {
  if (!req.url.startsWith('/v1/')) return of(new HttpResponse({ status: 404, url: req.url }));

  let body: unknown = req.body;
  let file: File | null = null;
  if (typeof FormData !== 'undefined' && req.body instanceof FormData) {
    const f = req.body.get('file');
    file = f instanceof File ? f : null;
    try {
      body = JSON.parse(String(req.body.get('mapping') ?? 'null'));
    } catch {
      body = null;
    }
  }
  const auth = req.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

  return from(demoBackend.handle({ method: req.method, path: req.url, token, body, file })).pipe(
    delay(150),
    switchMap((r) =>
      r.status >= 400
        ? throwError(() => new HttpErrorResponse({ status: r.status, error: r.body, url: req.url }))
        : of(new HttpResponse({ status: r.status, body: r.body, url: req.url })),
    ),
  );
};

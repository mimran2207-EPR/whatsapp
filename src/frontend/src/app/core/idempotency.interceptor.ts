import { HttpContext, HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';

/** The Idempotency-Key for one user action. Unset → the interceptor issues one and pins it to the request. */
export const IDEMPOTENCY_KEY = new HttpContextToken<string | null>(() => null);

const MUTATING = new Set(['POST', 'PUT', 'PATCH']);

export function withIdempotencyKey(key: string, ctx = new HttpContext()): HttpContext {
  return ctx.set(IDEMPOTENCY_KEY, key);
}

/**
 * Adds `Idempotency-Key` to POST/PUT/PATCH (spec §21.4). The key belongs to the user action, not to the HTTP attempt:
 * - an action that may be retried by the user passes its own key (see ActionKey) through the request context;
 * - otherwise a key is generated once and written back into the request's context, so an rxjs `retry()` of the
 *   same request (which re-sends the same HttpRequest object) sends the same key again.
 */
export const idempotencyInterceptor: HttpInterceptorFn = (req, next) => {
  if (!MUTATING.has(req.method)) return next(req);
  let key = req.context.get(IDEMPOTENCY_KEY);
  if (!key) {
    key = crypto.randomUUID();
    req.context.set(IDEMPOTENCY_KEY, key);
  }
  return next(req.clone({ setHeaders: { 'Idempotency-Key': key } }));
};

/**
 * Key holder for one repeatable user action (a button). The same payload gets the same key until the action
 * succeeds (`settle`) or gets a definite answer (`fail`); a double click or a retry after a network error (no response) replays instead of executing twice.
 * A changed payload is a different action and gets a new key (the server answers 409 to a reused key with a new body).
 */
export class ActionKey {
  private key: string | null = null;
  private fingerprint: string | null = null;

  for(fingerprint = ''): string {
    if (this.key === null || this.fingerprint !== fingerprint) {
      this.key = crypto.randomUUID();
      this.fingerprint = fingerprint;
    }
    return this.key;
  }

  /**
   * Key policy after a failed attempt: keep the key only when there was no HTTP response (status 0: network error,
   * timeout, connection reset) — the server may or may not have executed it, and a replay is the safe way to find out.
   * Any definite response (4xx or 5xx) ends the action; the next click is a new action with a new key, so a stored
   * error is never replayed forever. Server state checks guard against double execution.
   */
  fail(err: unknown): void {
    if (!(err instanceof HttpErrorResponse && err.status === 0)) this.settle();
  }

  settle(): void {
    this.key = null;
    this.fingerprint = null;
  }
}

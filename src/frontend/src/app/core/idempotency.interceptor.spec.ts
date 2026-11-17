import { HttpClient, HttpContext, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, retry } from 'rxjs';
import { ActionKey, idempotencyInterceptor, withIdempotencyKey } from './idempotency.interceptor';

describe('idempotencyInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([idempotencyInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('adds an Idempotency-Key on POST, PUT and PATCH', () => {
    http.post('/v1/campaigns', {}).subscribe();
    http.put('/v1/x', {}).subscribe();
    http.patch('/v1/campaigns/1/draft', {}).subscribe();
    for (const r of [ctrl.expectOne('/v1/campaigns'), ctrl.expectOne('/v1/x'), ctrl.expectOne('/v1/campaigns/1/draft')]) {
      expect(r.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
      r.flush({});
    }
  });

  it('does not add the header on GET', () => {
    http.get('/v1/campaigns').subscribe();
    const r = ctrl.expectOne('/v1/campaigns');
    expect(r.request.headers.has('Idempotency-Key')).toBe(false);
    r.flush([]);
  });

  it('gives two separate actions two different keys', () => {
    http.post('/v1/campaigns', {}).subscribe();
    http.post('/v1/campaigns', {}).subscribe();
    const [a, b] = ctrl.match('/v1/campaigns');
    expect(a.request.headers.get('Idempotency-Key')).not.toBe(b.request.headers.get('Idempotency-Key'));
    a.flush({});
    b.flush({});
  });

  it('reuses the same key when the same request is retried (network retry)', async () => {
    const done = firstValueFrom(http.post('/v1/campaigns', { name: 'א' }).pipe(retry(1)));
    const first = ctrl.expectOne('/v1/campaigns');
    const key = first.request.headers.get('Idempotency-Key');
    expect(key).toBeTruthy();
    first.error(new ProgressEvent('error'), { status: 0 });
    const second = ctrl.expectOne('/v1/campaigns');
    expect(second.request.headers.get('Idempotency-Key')).toBe(key);
    second.flush({ campaignId: 'c1' });
    await done;
  });

  it('uses the key the action supplies, so a user retry of the same action reuses it', () => {
    http.post('/v1/campaigns/1/release', {}, { context: withIdempotencyKey('action-key-1') }).subscribe();
    http.post('/v1/campaigns/1/release', {}, { context: withIdempotencyKey('action-key-1') }).subscribe();
    const reqs = ctrl.match('/v1/campaigns/1/release');
    expect(reqs.map((r) => r.request.headers.get('Idempotency-Key'))).toEqual(['action-key-1', 'action-key-1']);
    reqs.forEach((r) => r.flush({}));
  });

  it('leaves a request without context alone otherwise (fresh HttpContext per call)', () => {
    http.post('/v1/a', {}, { context: new HttpContext() }).subscribe();
    const r = ctrl.expectOne('/v1/a');
    expect(r.request.headers.get('Idempotency-Key')).toBeTruthy();
    r.flush({});
  });
});

describe('ActionKey', () => {
  it('reuses the key for the same action until it settles (double click / retry)', () => {
    const a = new ActionKey();
    const k1 = a.for('body-1');
    expect(a.for('body-1')).toBe(k1);
    a.settle();
    expect(a.for('body-1')).not.toBe(k1);
  });

  it('keeps the key after a failure with no response (network error, status 0)', () => {
    const a = new ActionKey();
    const k1 = a.for('body-1');
    a.fail(new HttpErrorResponse({ status: 0 }));
    expect(a.for('body-1')).toBe(k1);
  });

  it.each([400, 409, 422, 500, 503])('ends the action after a definite %s response: the next attempt gets a new key', (status) => {
    const a = new ActionKey();
    const k1 = a.for('body-1');
    a.fail(new HttpErrorResponse({ status, error: { code: 'X' } }));
    expect(a.for('body-1')).not.toBe(k1);
  });

  it('issues a new key when the action payload changes', () => {
    const a = new ActionKey();
    const k1 = a.for('body-1');
    expect(a.for('body-2')).not.toBe(k1);
  });
});

import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { fakeJwt } from './auth.guard.spec';
import { authInterceptor } from './auth.interceptor';
import { AuthService, TOKEN_STORAGE_KEY } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  const token = fakeJwt({ sub: 'dana', name: 'דנה לוי', role: 'creator', exp: Date.now() / 1000 + 3600 });

  beforeEach(() => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    ctrl.verify();
    sessionStorage.clear();
  });

  it('adds the bearer token to /v1 calls but not to the dev login', () => {
    http.get('/v1/campaigns').subscribe();
    http.post('/v1/dev/login', { userId: 'dana' }).subscribe();
    const api = ctrl.expectOne('/v1/campaigns');
    const dev = ctrl.expectOne('/v1/dev/login');
    expect(api.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(dev.request.headers.has('Authorization')).toBe(false);
    api.flush([]);
    dev.flush({ token: 'x' });
  });

  it('signs out and goes to /login on 401', () => {
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http.get('/v1/campaigns').subscribe({ error: () => undefined });
    ctrl.expectOne('/v1/campaigns').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/login'], expect.anything());
  });
});

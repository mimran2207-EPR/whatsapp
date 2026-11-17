import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService, TOKEN_STORAGE_KEY } from './auth.service';

/** Unsigned test JWT: the client only reads the payload (the server verifies the signature). */
export function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`;
}

describe('authGuard', () => {
  const run = (url: string) =>
    TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  });

  it('redirects to /login with the return url when there is no token', () => {
    const r = run('/campaigns');
    expect(r instanceof UrlTree).toBe(true);
    expect(TestBed.inject(Router).serializeUrl(r as UrlTree)).toBe('/login?returnUrl=%2Fcampaigns');
  });

  it('allows navigation with a valid token in sessionStorage', () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, fakeJwt({ sub: 'dana', name: 'דנה לוי', role: 'creator', exp: Date.now() / 1000 + 3600 }));
    expect(run('/campaigns')).toBe(true);
  });

  it('treats an expired token as signed out', () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, fakeJwt({ sub: 'dana', name: 'דנה לוי', role: 'creator', exp: Date.now() / 1000 - 10 }));
    expect(run('/') instanceof UrlTree).toBe(true);
  });

  it('reads the Hebrew name and role from the token', () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, fakeJwt({ sub: 'meir', name: 'מאיר ברק', role: 'approver', exp: Date.now() / 1000 + 3600 }));
    const auth = TestBed.inject(AuthService);
    expect(auth.user()).toEqual({ id: 'meir', name: 'מאיר ברק', role: 'approver' });
  });
});

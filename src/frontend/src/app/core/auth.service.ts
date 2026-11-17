import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, Role } from './api.client';

export const TOKEN_STORAGE_KEY = 'rc.token';

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}

const ROLE_LABEL: Record<Role, string> = {
  creator: 'יוצר/ת משלוחים · כניסה מדומה',
  approver: 'מאשר/ת משלוחים · כניסה מדומה',
  analyst: 'צפייה ונתונים · כניסה מדומה',
};

function readStorage(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Reads (does not verify) the JWT payload — the server verifies the signature on every call. */
function decode(token: string | null): (SessionUser & { exp: number | null }) | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const p = JSON.parse(json) as { sub?: string; name?: string; role?: Role; exp?: number };
    if (!p.sub || !p.role) return null;
    return { id: p.sub, name: p.name ?? p.sub, role: p.role, exp: typeof p.exp === 'number' ? p.exp : null };
  } catch {
    return null;
  }
}

/** Mock dev login (ADR-005). The token lives in sessionStorage only. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly tokenSig = signal<string | null>(readStorage());
  private readonly claims = computed(() => decode(this.tokenSig()));

  readonly token = this.tokenSig.asReadonly();
  readonly user = computed<SessionUser | null>(() => {
    const c = this.claims();
    return c ? { id: c.id, name: c.name, role: c.role } : null;
  });
  readonly roleLabel = computed(() => {
    const u = this.user();
    return u ? (ROLE_LABEL[u.role] ?? u.role) : '';
  });

  isAuthenticated(): boolean {
    const c = this.claims();
    return !!c && (c.exp === null || c.exp * 1000 > Date.now());
  }

  async login(userId: string): Promise<void> {
    const { token } = await firstValueFrom(this.api.devLogin(userId));
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      /* storage blocked: the session lasts until reload */
    }
    this.tokenSig.set(token);
  }

  logout(): void {
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.tokenSig.set(null);
  }
}

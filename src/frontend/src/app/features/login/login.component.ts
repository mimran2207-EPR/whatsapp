import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiClient, DevUser } from '../../core/api.client';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/error-messages';

const ROLE_HE: Record<string, string> = { creator: 'יוצרת משלוחים', approver: 'מאשר משלוחים', analyst: 'צפייה ונתונים' };

type UsersState = { kind: 'loading' } | { kind: 'ok'; users: DevUser[] } | { kind: 'error'; message: string };

/** Mock dev login (Development only): pick one of the synthetic users from /v1/dev/users. */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login">
      <section class="card login__card" aria-labelledby="login-title">
        <h1 id="login-title" class="t-h1-24">כניסה למערכת תקשורת לתושבים</h1>
        <p class="muted">כניסה מדומה לסביבת פיתוח — בחרו משתמש. <span class="sandbox-tag">Sandbox (מדומה)</span></p>
        @switch (state().kind) {
          @case ('loading') {
            <p class="muted" role="status">טוען משתמשים…</p>
          }
          @case ('error') {
            <p class="error-text" role="alert">{{ errorText() }}</p>
          }
          @case ('ok') {
            <ul class="login__users">
              @for (u of usersList(); track u.id) {
                <li>
                  <button type="button" class="login__user" [disabled]="busy() !== null" (click)="pick(u)">
                    <span class="login__name">{{ u.name }}</span>
                    <span class="login__role">{{ roleHe(u.role) }}</span>
                    @if (busy() === u.id) {
                      <span class="login__role" role="status">נכנס…</span>
                    }
                  </button>
                </li>
              }
            </ul>
          }
        }
        @if (loginError()) {
          <p class="error-text" role="alert">{{ loginError() }}</p>
        }
      </section>
    </main>
  `,
  styles: `
    .login {
      display: grid;
      place-items: center;
      min-block-size: 100vh;
      padding: var(--space-16);
    }
    .login__card {
      display: flex;
      flex-direction: column;
      gap: var(--space-16);
      inline-size: min(100%, 480px);
    }
    .login__card h1,
    .login__card p {
      margin: 0;
    }
    .login__users {
      display: flex;
      flex-direction: column;
      gap: var(--space-8);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .login__user {
      display: flex;
      align-items: center;
      gap: var(--space-12);
      inline-size: 100%;
      min-block-size: var(--row-height);
      padding-inline: var(--space-16);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-bg-surface);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .login__user:hover:not(:disabled) {
      background: var(--color-bg-subtle);
      border-color: var(--color-border-brand);
    }
    .login__user:focus-visible {
      outline: none;
      box-shadow: var(--shadow-focus-ring);
    }
    .login__name {
      font-weight: 700;
      color: var(--color-text-primary);
    }
    .login__role {
      color: var(--color-text-secondary);
    }
  `,
})
export class LoginComponent {
  readonly returnUrl = input<string | undefined>();

  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly busy = signal<string | null>(null);
  protected readonly loginError = signal<string | null>(null);
  protected readonly state = toSignal(
    this.api.devUsers().pipe(
      map((users): UsersState => ({ kind: 'ok', users })),
      catchError((e: unknown) => of<UsersState>({ kind: 'error', message: apiError(e).messageHe })),
    ),
    { initialValue: { kind: 'loading' } as UsersState },
  );

  constructor() {
    // Arriving here (including "התנתקות" in the shell) ends the current session.
    this.auth.logout();
  }

  protected usersList(): DevUser[] {
    const s = this.state();
    return s.kind === 'ok' ? s.users : [];
  }

  protected errorText(): string {
    const s = this.state();
    return s.kind === 'error' ? `לא ניתן לטעון משתמשים: ${s.message}` : '';
  }

  protected roleHe(role: string): string {
    return ROLE_HE[role] ?? role;
  }

  protected async pick(u: DevUser): Promise<void> {
    this.busy.set(u.id);
    this.loginError.set(null);
    try {
      await this.auth.login(u.id);
      const target = this.returnUrl();
      // Only same-app paths: never navigate to an absolute or protocol-relative URL from the query string.
      await this.router.navigateByUrl(target && target.startsWith('/') && !target.startsWith('//') ? target : '/');
    } catch (e) {
      this.loginError.set(apiError(e).messageHe);
    } finally {
      this.busy.set(null);
    }
  }
}

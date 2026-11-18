import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { AppShellComponent, NavKey } from '../../ui/app-shell/app-shell.component';

/** Signed-in layout: the Muni app shell around the routed screen; the active nav item comes from route data. */
@Component({
  selector: 'app-shell-layout',
  imports: [AppShellComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rc-app-shell [activeNav]="nav()" [userName]="auth.user()?.name ?? ''" [userRole]="auth.roleLabel()">
      <router-outlet />
    </rc-app-shell>
  `,
})
export class ShellLayoutComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly nav = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => {
        let r = this.router.routerState.snapshot.root;
        while (r.firstChild) r = r.firstChild;
        return (r.data['nav'] as NavKey | undefined) ?? null;
      }),
    ),
    { initialValue: null },
  );
}

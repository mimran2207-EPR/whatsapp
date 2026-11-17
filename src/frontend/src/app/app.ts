import { DOCUMENT } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, inject, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Root. Route-change accessibility (WCAG 2.4.3 / 4.1.3): after every navigation to a different page the focus moves to
 * the page's main heading (made programmatically focusable with tabindex=-1) and the document title (set by the router's
 * title strategy) is kept in sync. No separate live region: focusing the heading is what screen readers announce. The very first navigation (page load) is left alone: the
 * browser and screen reader already announce a freshly loaded page.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
  `,
})
export class App {
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly title = inject(Title);

  constructor() {
    let first = true;
    let lastPath: string | null = null;
    inject(Router)
      .events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        const path = e.urlAfterRedirects.split(/[?#]/)[0];
        const changed = path !== lastPath;
        lastPath = path;
        if (first) {
          first = false;
          return;
        }
        if (!changed) return; // query/fragment-only navigation keeps the user where they are
        afterNextRender(() => this.moveFocus(true), { injector: this.injector });
      });
  }

  private moveFocus(retry: boolean): void {
    const heading = this.doc.querySelector<HTMLElement>('main h1') ?? this.doc.querySelector<HTMLElement>('h1');
    if (!heading) {
      // The heading is not rendered yet (late content): one more try shortly after.
      if (retry) setTimeout(() => this.moveFocus(false), 100);
      return;
    }
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    // Focusing the heading is the announcement (screen readers read the focused h1); a live region on top would read it twice.
    heading.focus();
    this.doc.title = this.title.getTitle();
  }
}

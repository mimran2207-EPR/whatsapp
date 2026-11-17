import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-paths';

export type NavKey = 'home' | 'campaigns' | 'audiences' | 'templates' | 'documents' | 'reports' | 'exceptions' | 'admin';

/** Main navigation, spec §2. */
export const NAV_ITEMS: readonly { key: NavKey; label: string; icon: IconName; route: string }[] = [
  { key: 'home', label: 'בית', icon: 'home', route: '/' },
  { key: 'campaigns', label: 'משלוחים', icon: 'megaphone', route: '/campaigns' },
  { key: 'audiences', label: 'קהלים ומקורות', icon: 'users', route: '/audiences' },
  { key: 'templates', label: 'תבניות', icon: 'template', route: '/templates' },
  { key: 'documents', label: 'מסמכים', icon: 'document', route: '/documents' },
  { key: 'reports', label: 'דוחות ונתונים', icon: 'chart', route: '/reports' },
  { key: 'exceptions', label: 'חריגים', icon: 'alert-circle', route: '/exceptions' },
  { key: 'admin', label: 'ניהול', icon: 'settings', route: '/admin' },
];

/**
 * App shell (Figma 04 App Shell, 12:301). Sidebar on the start (right) edge, 258px; below 1100px it collapses
 * to an 88px icon rail. Top bar: search and notifications (both disabled, "בקרוב", until built), "Sandbox (מדומה)" tag and the user chip.
 * A skip-to-content link is the first focusable element; it is visible only while focused.
 */
@Component({
  selector: 'rc-app-shell',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css',
})
export class AppShellComponent {
  readonly activeNav = input<NavKey | null>(null);
  readonly userName = input('משתמש פיתוח');
  readonly userRole = input('יוצר משלוח · כניסה מדומה');

  protected readonly nav = NAV_ITEMS;

  /** Skip link: a plain #fragment would resolve against <base href="/"> and navigate, so move focus directly. */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    const main = document.getElementById('rc-main');
    main?.focus();
    main?.scrollIntoView?.({ block: 'start' });
  }

  protected readonly initials = computed(() =>
    this.userName()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join(''),
  );
}

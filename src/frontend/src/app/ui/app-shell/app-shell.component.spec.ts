import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppShellComponent, NAV_ITEMS } from './app-shell.component';

describe('AppShell', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('renders the spec §2 nav items, the active item, the new-send button and the sandbox tag', () => {
    const f = TestBed.createComponent(AppShellComponent);
    f.componentRef.setInput('activeNav', 'campaigns');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    const labels = [...el.querySelectorAll('nav a')].map((a) => a.textContent!.trim());
    expect(labels).toEqual(['בית', 'משלוחים', 'קהלים ומקורות', 'תבניות', 'מסמכים', 'דוחות ונתונים', 'חריגים', 'ניהול']);
    expect(NAV_ITEMS.length).toBe(8);
    const active = el.querySelector('nav a[aria-current="page"]')!;
    expect(active.textContent).toContain('משלוחים');
    expect(el.textContent).toContain('משלוח חדש');
    expect(el.textContent).toContain('Sandbox (מדומה)');
  });

  it('search and notifications are disabled placeholders labelled "בקרוב", not tab stops or landmarks', () => {
    const f = TestBed.createComponent(AppShellComponent);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('[role="search"]')).toBeNull();
    const search = el.querySelector<HTMLInputElement>('#rc-shell-search')!;
    expect(search.disabled).toBe(true);
    expect(search.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('label[for="rc-shell-search"]')!.textContent).toContain('בקרוב');
    const bell = el.querySelector<HTMLButtonElement>('button.icon-btn')!;
    expect(bell.disabled).toBe(true);
    expect(bell.getAttribute('aria-disabled')).toBe('true');
    expect(bell.getAttribute('aria-label')).toContain('בקרוב');
  });

  it('has a skip link as the first focusable element that moves focus to the main landmark without navigating', () => {
    const f = TestBed.createComponent(AppShellComponent);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    document.body.appendChild(el);
    const link = el.querySelector<HTMLAnchorElement>('a.skip-link')!;
    expect(link).toBe(el.querySelector('a, button:not([disabled]), input:not([disabled])'));
    const main = el.querySelector<HTMLElement>('main#rc-main')!;
    expect(main.getAttribute('tabindex')).toBe('-1');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(main);
    el.remove();
  });
});

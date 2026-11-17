import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppShellComponent, NAV_ITEMS } from './app-shell.component';

describe('AppShell', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('renders the spec §2 nav items, the active item, the new-send button, search and the sandbox tag', () => {
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
    expect(el.querySelector('[role="search"]')).not.toBeNull();
  });
});

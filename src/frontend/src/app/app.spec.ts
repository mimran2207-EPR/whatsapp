import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';

@Component({ template: '<main><h1>דף ראשון</h1></main>' })
class PageA {}
@Component({ template: '<main><h1>דף שני</h1></main>' })
class PageB {}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: 'a', title: 'כותרת א', component: PageA },
          { path: 'b', title: 'כותרת ב', component: PageB },
        ]),
      ],
    }).compileComponents();
  });

  it('renders a router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });

  it('moves focus to the main heading and moves focus (no live region) after a route change (not on first load)', async () => {
    const fixture = TestBed.createComponent(App);
    document.body.appendChild(fixture.nativeElement);
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/a');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement?.tagName).not.toBe('H1');

    await router.navigateByUrl('/b');
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const h1 = fixture.nativeElement.querySelector('h1') as HTMLElement;
    expect(h1.textContent).toBe('דף שני');
    expect(h1.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(h1);
    expect(fixture.nativeElement.querySelector('[aria-live]')).toBeNull(); // focus move only: no second announcement
    expect(document.title).toBe('כותרת ב');
    fixture.nativeElement.remove();
  });
});

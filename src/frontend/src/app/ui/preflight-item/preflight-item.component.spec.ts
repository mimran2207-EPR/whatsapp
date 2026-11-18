import { TestBed } from '@angular/core/testing';
import { PreflightItemComponent } from './preflight-item.component';

describe('PreflightItem', () => {
  it('renders blocker with title, meta and an action that emits', () => {
    const f = TestBed.createComponent(PreflightItemComponent);
    f.componentRef.setInput('kind', 'blocker');
    f.componentRef.setInput('title', 'שדה דינמי חסר');
    f.componentRef.setInput('meta', 'שלב 3 · מה');
    f.componentRef.setInput('actionLabel', 'תקן');
    let clicked = 0;
    f.componentInstance.action.subscribe(() => clicked++);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement.querySelector('.pf');
    expect(el.classList).toContain('pf--blocker');
    expect(el.textContent).toContain('שדה דינמי חסר');
    expect(el.textContent).toContain('שלב 3 · מה');
    (el.querySelector('button') as HTMLButtonElement).click();
    expect(clicked).toBe(1);
  });

  it('renders passed without an action button', () => {
    const f = TestBed.createComponent(PreflightItemComponent);
    f.componentRef.setInput('kind', 'passed');
    f.componentRef.setInput('title', 'תקין');
    f.detectChanges();
    expect(f.nativeElement.querySelector('button')).toBeNull();
    expect(f.nativeElement.querySelector('svg')).not.toBeNull();
  });
});

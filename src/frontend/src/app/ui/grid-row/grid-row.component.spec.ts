import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GridRowComponent } from './grid-row.component';

@Component({
  imports: [GridRowComponent],
  template: `<rc-grid-row density="compact" [selected]="selected()"><span class="cell">050-***-**12</span></rc-grid-row>`,
})
class Host {
  selected = signal(true);
}

describe('GridRow', () => {
  it('projects cells and reflects density and selection', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const row: HTMLElement = f.nativeElement.querySelector('.row');
    expect(row.getAttribute('data-density')).toBe('compact');
    expect(row.classList).toContain('row--selected');
    expect(row.querySelector('.cell')!.textContent).toContain('050');
  });

  it('carries no grid ARIA roles of its own (the container owns the semantics)', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('[role="row"]')).toBeNull();
    expect(el.querySelector('[aria-selected]')).toBeNull();
  });

  it('shows a non-colour selected cue: a check icon and the text "נבחר"', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const cue: HTMLElement = f.nativeElement.querySelector('.row__selected');
    expect(cue).not.toBeNull();
    expect(cue.querySelector('svg')).not.toBeNull();
    expect(cue.textContent).toContain('נבחר');

    f.componentInstance.selected.set(false);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.row__selected')).toBeNull();
  });
});

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GridRowComponent } from './grid-row.component';

@Component({
  imports: [GridRowComponent],
  template: `<rc-grid-row density="compact" [selected]="true"><span class="cell">050-***-**12</span></rc-grid-row>`,
})
class Host {}

describe('GridRow', () => {
  it('projects cells and reflects density and selection', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const row: HTMLElement = f.nativeElement.querySelector('.row');
    expect(row.getAttribute('role')).toBe('row');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.getAttribute('data-density')).toBe('compact');
    expect(row.classList).toContain('row--selected');
    expect(row.querySelector('.cell')!.textContent).toContain('050');
  });
});

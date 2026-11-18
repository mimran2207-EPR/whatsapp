import { TestBed } from '@angular/core/testing';
import { KpiCardComponent } from './kpi-card.component';

describe('KpiCard', () => {
  it('shows "לא ניתן לחישוב" when value is null', () => {
    const f = TestBed.createComponent(KpiCardComponent);
    f.componentRef.setInput('title', 'שיעור מסירה');
    f.componentRef.setInput('value', null);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('לא ניתן לחישוב');
  });

  it('renders value, definition and data-as-of, and marks unknown with a dashed card', () => {
    const f = TestBed.createComponent(KpiCardComponent);
    f.componentRef.setInput('kind', 'unknown');
    f.componentRef.setInput('title', 'לא ידוע');
    f.componentRef.setInput('value', '312');
    f.componentRef.setInput('definition', 'מתוך 3,180 הודעות');
    f.componentRef.setInput('dataAsOf', '10:42');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.kpi')!.classList).toContain('kpi--unknown');
    expect(el.querySelector('.kpi__value')!.textContent).toContain('312');
    expect(el.textContent).toContain('מתוך 3,180 הודעות');
    expect(el.textContent).toContain('10:42');
  });
});

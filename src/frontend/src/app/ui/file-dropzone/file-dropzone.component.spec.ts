import { TestBed } from '@angular/core/testing';
import { FileDropzoneComponent } from './file-dropzone.component';

describe('FileDropzone', () => {
  it('offers a keyboard-accessible "בחרו קובץ" button bound to a file input with the accept list', () => {
    const f = TestBed.createComponent(FileDropzoneComponent);
    f.componentRef.setInput('accept', '.xlsx,.csv');
    f.detectChanges();
    const btn: HTMLButtonElement = f.nativeElement.querySelector('button');
    expect(btn.textContent).toContain('בחרו קובץ');
    expect(btn.type).toBe('button');
    const input: HTMLInputElement = f.nativeElement.querySelector('input[type=file]');
    expect(input.accept).toBe('.xlsx,.csv');
  });

  it('emits the dropped file', () => {
    const f = TestBed.createComponent(FileDropzoneComponent);
    f.detectChanges();
    const got: File[] = [];
    f.componentInstance.file.subscribe((x: File) => got.push(x));
    const file = new File(['a,b'], 'list.csv', { type: 'text/csv' });
    const zone: HTMLElement = f.nativeElement.querySelector('.dropzone');
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    zone.dispatchEvent(ev);
    expect(got).toEqual([file]);
  });
});

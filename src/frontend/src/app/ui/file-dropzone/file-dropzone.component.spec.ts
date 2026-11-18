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

  function drop(f: { nativeElement: HTMLElement }, file: File) {
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    f.nativeElement.querySelector('.dropzone')!.dispatchEvent(ev);
  }

  it('rejects a wrong extension with role="alert" and does not emit', () => {
    const f = TestBed.createComponent(FileDropzoneComponent);
    f.detectChanges();
    const got: File[] = [];
    f.componentInstance.file.subscribe((x: File) => got.push(x));
    drop(f, new File(['x'], 'virus.exe'));
    f.detectChanges();
    expect(got).toEqual([]);
    expect(f.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('סוג הקובץ');
  });

  it('rejects a file over maxBytes with role="alert" and does not emit', () => {
    const f = TestBed.createComponent(FileDropzoneComponent);
    f.componentRef.setInput('maxBytes', 4);
    f.detectChanges();
    const got: File[] = [];
    f.componentInstance.file.subscribe((x: File) => got.push(x));
    drop(f, new File(['123456'], 'big.csv'));
    f.detectChanges();
    expect(got).toEqual([]);
    expect(f.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('גדול');
  });

  it('defaults maxBytes to 25MB', () => {
    const f = TestBed.createComponent(FileDropzoneComponent);
    expect(f.componentInstance.maxBytes()).toBe(25 * 1024 * 1024);
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

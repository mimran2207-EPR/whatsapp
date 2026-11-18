import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { DEMO_MARKER } from './demo-backend';
import { demoBackend } from './demo-interceptor';

export const DEMO_BANNER_TEXT = 'דמו — נתונים מדומים, אין שרת אמיתי';
const TITLE_SUFFIX = ' · דמו';

/** DEMO ONLY. Every page title carries the demo suffix. */
@Injectable()
export class DemoTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(`${this.buildTitle(snapshot) ?? 'תקשורת לתושבים'}${TITLE_SUFFIX}`);
  }
}

/** Persistent "demo" banner above the app on every screen (login included) with the "איפוס דמו" action. Plain DOM: no real component is touched. */
export function mountDemoChrome(doc: Document = document): void {
  doc.documentElement.setAttribute('data-demo-backend', DEMO_MARKER); // machine-readable proof that this is the demo build
  if (!doc.title.endsWith(TITLE_SUFFIX)) doc.title += TITLE_SUFFIX;
  if (doc.getElementById('rc-demo-banner')) return;

  const style = doc.createElement('style');
  style.textContent = `
    #rc-demo-banner{position:sticky;top:0;z-index:2000;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;
      box-sizing:border-box;min-height:36px;padding:4px 12px;background:#fff4cc;color:#4a3b00;border-bottom:1px solid #e2c25a;
      font:600 14px/1.3 Rubik,system-ui,sans-serif}
    #rc-demo-banner button{font:inherit;font-weight:500;padding:2px 10px;border:1px solid #8a6d00;border-radius:6px;background:#fff;color:#4a3b00;cursor:pointer}
    #rc-demo-banner button:hover{background:#fff9e0}
    #rc-demo-banner button:focus-visible{outline:2px solid #1b4fd8;outline-offset:2px}`;
  doc.head.appendChild(style);

  const bar = doc.createElement('div');
  bar.id = 'rc-demo-banner';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'הודעת דמו');
  const text = doc.createElement('span');
  text.textContent = DEMO_BANNER_TEXT;
  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.textContent = 'איפוס דמו';
  reset.title = 'מוחק את כל מה שנעשה בלשונית הזו וטוען מחדש את נתוני הדוגמה';
  reset.addEventListener('click', () => {
    demoBackend.reset();
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    location.assign('/login');
  });
  bar.append(text, reset);
  doc.body.insertBefore(bar, doc.body.firstChild);
}

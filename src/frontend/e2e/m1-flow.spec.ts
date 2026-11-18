import { expect, Page, test } from '@playwright/test';
import { m1Fixture } from './xlsx';

/**
 * M1 acceptance flow, all through the real UI, API, Worker and SQL Server (throwaway database), mock SMS provider.
 * Synthetic data only. Serial: the second test only exercises S10, the first one the whole flow.
 */
test.describe.configure({ mode: 'serial' });

const xlsx = { name: 'הזנה-נובמבר-מדומה.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: m1Fixture() };

async function loginAs(page: Page, name: string) {
  await page.goto('/login');
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('link', { name: 'משלוח חדש' }).first()).toBeVisible();
}

async function startWizard(page: Page, campaignName: string) {
  await page.getByRole('link', { name: 'משלוח חדש' }).first().click();
  await expect(page.getByRole('heading', { name: 'למי שולחים?' })).toBeVisible();
  await page.getByLabel('שם המשלוח').fill(campaignName);
}

test('M1: creator imports and submits, approver approves and sends, tracking converges', async ({ page }) => {
  await loginAs(page, 'דנה לוי');
  await startWizard(page, 'הזנה — נובמבר (E2E)');

  // S10 - audience: XLSX with 12 rows, 2 of them invalid.
  await page.locator('input[type=file]').setInputFiles(xlsx);
  await expect(page.getByText('קובץ נבחר:')).toBeVisible();
  await page.getByLabel('מזהה נמען (ת.ז) · חובה').selectOption('ת.ז');
  await page.getByLabel('שם הנמען').selectOption('שם הורה');
  await page.getByLabel('טלפון נייד · חובה').selectOption('טל נייד הורה');
  await page.getByRole('button', { name: 'ייבוא הקובץ' }).click();
  const counts = page.locator('dl.counts');
  await expect(counts.locator('div', { hasText: 'שורות' }).locator('dd')).toHaveText('12');
  await expect(counts.locator('div', { hasText: 'תקינות' }).locator('dd')).toHaveText('10');
  await expect(counts.locator('div', { hasText: 'פסולות' }).locator('dd')).toHaveText('2');

  // S11 - channel (SMS only in M1), S12 - content.
  await page.getByRole('button', { name: 'המשך לבחירת ערוץ' }).click();
  await expect(page.getByRole('heading', { name: 'איך שולחים?' })).toBeVisible();
  await page.getByRole('button', { name: 'המשך לכתיבת התוכן' }).click();
  await expect(page.getByRole('heading', { name: 'מה כותבים?' })).toBeVisible();
  await page.getByLabel('תוכן הודעת ה-SMS').fill('הודעת בדיקה מדומה (Sandbox) לאימות המערכת');

  // S14 - preflight, S15 - submit.
  await page.getByRole('button', { name: 'המשך לבדיקה' }).click();
  await expect(page.getByRole('heading', { name: 'בדיקה לפני הגשה' })).toBeVisible();
  const toSubmit = page.getByRole('button', { name: 'המשך לאישור ושליחה' });
  await expect(toSubmit).toBeEnabled();
  await toSubmit.click();
  await expect(page.getByRole('heading', { name: 'סיכום מחייב והגשה לאישור' })).toBeVisible();
  await page.getByRole('button', { name: 'הגשה לאישור · 10 הודעות' }).click();
  await expect(page.getByText(/המשלוח הוגש לאישור. חבילת אישור/)).toBeVisible();

  // Approver: the button text is exactly "אישור ושליחת 10 הודעות".
  await loginAs(page, 'מאיר ברק');
  await page.goto('/approvals');
  await page.getByRole('button', { name: /הזנה — נובמבר \(E2E\)/ }).click();
  const approve = page.locator('.actions button');
  await expect(approve).toHaveText('אישור ושליחת 10 הודעות');
  await approve.click();

  // Tracking: all 10 messages are accounted for, the banner copy and the Sandbox tag are shown.
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}\/tracking$/);
  await expect(page.getByText('Sandbox (מדומה)').first()).toBeVisible();
  const legend = page.locator('ul.legend li');
  const read = async () => {
    const n = async (label: string) => Number(await legend.filter({ hasText: label }).locator('strong').innerText());
    const [delivered, pending, unknown, failed] = [await n('נמסרו'), await n('טרם התקבל אישור מסירה.'), await n('לא ידוע'), await n('נכשלו')];
    return { delivered, pending, unknown, failed, total: delivered + pending + unknown + failed };
  };
  await expect.poll(async () => (await read()).total, { timeout: 60_000 }).toBe(10);
  // The mock is deterministic here (accept and deliver everything), so the delivery axis converges to 10 delivered.
  await expect.poll(async () => (await read()).delivered, { timeout: 90_000 }).toBe(10);
  expect(await read()).toEqual({ delivered: 10, pending: 0, unknown: 0, failed: 0, total: 10 });

  const banner = page.locator('rc-banner').first();
  await expect(banner).toHaveText(/^\s*\d+ הודעות התקבלו אצל הספק\. תוצאות המסירה ממשיכות להתעדכן\.\s*$/);
  await expect(banner).toContainText('10 הודעות התקבלו אצל הספק');
  await expect(page.getByText('Sandbox (מדומה)').first()).toBeVisible();
});

test('S10 primary action works with the keyboard only (Tab to "בחרו קובץ", Enter)', async ({ page }) => {
  await loginAs(page, 'דנה לוי');
  await page.getByRole('link', { name: 'משלוח חדש' }).first().click();
  await expect(page.getByRole('heading', { name: 'למי שולחים?' })).toBeVisible();

  const choose = page.getByRole('button', { name: 'בחרו קובץ' });
  for (let i = 0; i < 40 && !(await choose.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(choose).toBeFocused();

  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles(xlsx);
  await expect(page.getByText('קובץ נבחר:')).toBeVisible();
  await expect(page.getByLabel('מזהה נמען (ת.ז) · חובה')).toBeVisible();
});

import { expect, Page, test } from '@playwright/test';

/**
 * The built demo, end to end through the real UI, with the in-browser fake API (no server). Synthetic data only.
 * Each test starts with a fresh browser context (empty sessionStorage), so the demo is freshly seeded every time.
 */
test.describe.configure({ mode: 'serial' });

const DEMO_BANNER = 'דמו — נתונים מדומים, אין שרת אמיתי';

const csv = {
  name: 'נמענים-דמו.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(
    ['ת.ז,שם הורה,טל נייד הורה,כיתה', '301000001,דנה כהן,0521110001,א1', '301000002,רונית לוי,0521110002,א2', '301000003,יעל בר,0521110003,א1', '301000004,אורי גל,0521110004,א3', '301000005,משה פרץ,123,א2'].join('\n'),
    'utf8',
  ),
};

async function loginAs(page: Page, name: string) {
  await page.goto('/login');
  await expect(page.getByText(DEMO_BANNER)).toBeVisible();
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('link', { name: 'משלוח חדש' }).first()).toBeVisible();
}

async function readLegend(page: Page) {
  const legend = page.locator('ul.legend li');
  const n = async (label: string) => Number(await legend.filter({ hasText: label }).locator('strong').innerText());
  const [delivered, pending, unknown, failed] = [await n('נמסרו'), await n('טרם התקבל אישור מסירה.'), await n('לא ידוע'), await n('נכשלו')];
  return { delivered, pending, unknown, failed, total: delivered + pending + unknown + failed };
}

test('login screen and every page are labelled as a demo', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText(DEMO_BANNER)).toBeVisible();
  await expect(page.getByText('Sandbox (מדומה)').first()).toBeVisible();
  await expect(page).toHaveTitle(/· דמו$/);
  await page.getByRole('button', { name: 'דנה לוי' }).click();
  await expect(page.getByText(DEMO_BANNER)).toBeVisible();
  await expect(page).toHaveTitle(/· דמו$/);
});

test('meir sees the waiting campaign on /approvals, approves it, and tracking reaches its final counts', async ({ page }) => {
  await loginAs(page, 'מאיר ברק');
  await page.goto('/approvals'); // deep link + full reload: the SPA fallback, the token and the demo state all survive
  await page.getByRole('button', { name: /טיול שנתי — אישור הורים/ }).click();
  const approve = page.locator('.actions button');
  await expect(approve).toHaveText('אישור ושליחת 6 הודעות');
  await expect(page.getByText('שלום דנה כ.')).toBeVisible(); // the server-rendered, masked preview
  await approve.click();

  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}\/tracking$/);
  await expect(page.getByText(DEMO_BANNER)).toBeVisible();
  await expect.poll(async () => (await readLegend(page)).total, { timeout: 30_000 }).toBe(6);
  // live movement: not everything is delivered right away ...
  expect((await readLegend(page)).delivered).toBeLessThan(4);
  // ... and it converges: 4 delivered, 1 timeout (לא ידוע), 1 rejected (counted as failed).
  await expect.poll(() => readLegend(page), { timeout: 60_000, intervals: [2000] }).toEqual({ delivered: 4, pending: 0, unknown: 1, failed: 1, total: 6 });
  await expect(page.locator('rc-banner').first()).toContainText('הודעות התקבלו אצל הספק');
});

test('dana walks the wizard with a small CSV and submits; meir then sees it', async ({ page }) => {
  await loginAs(page, 'דנה לוי');
  await page.getByRole('link', { name: 'משלוח חדש' }).first().click();
  await expect(page.getByRole('heading', { name: 'למי שולחים?' })).toBeVisible();
  await page.getByLabel('שם המשלוח').fill('הזנה — דמו (E2E)');

  await page.locator('input[type=file]').setInputFiles(csv);
  await expect(page.getByText('קובץ נבחר:')).toBeVisible();
  await page.getByLabel('מזהה נמען (ת.ז) · חובה').selectOption('ת.ז');
  await page.getByLabel('שם הנמען').selectOption('שם הורה');
  await page.getByLabel('טלפון נייד · חובה').selectOption('טל נייד הורה');
  await page.getByRole('button', { name: 'ייבוא הקובץ' }).click();
  const counts = page.locator('dl.counts');
  await expect(counts.locator('div', { hasText: 'שורות' }).locator('dd')).toHaveText('5');
  await expect(counts.locator('div', { hasText: 'תקינות' }).locator('dd')).toHaveText('4');
  await expect(counts.locator('div', { hasText: 'פסולות' }).locator('dd')).toHaveText('1');

  await page.getByRole('button', { name: 'המשך לבחירת ערוץ' }).click();
  await expect(page.getByRole('heading', { name: 'איך שולחים?' })).toBeVisible();
  await page.getByRole('button', { name: 'המשך לכתיבת התוכן' }).click();
  await expect(page.getByRole('heading', { name: 'מה כותבים?' })).toBeVisible();
  await page.getByLabel('תוכן הודעת ה-SMS').fill('הודעת בדיקה מדומה (דמו) לאימות המערכת');

  await page.getByRole('button', { name: 'המשך לבדיקה' }).click();
  await expect(page.getByRole('heading', { name: 'בדיקה לפני הגשה' })).toBeVisible();
  const toSubmit = page.getByRole('button', { name: 'המשך לאישור ושליחה' });
  await expect(toSubmit).toBeEnabled();
  await toSubmit.click();
  await expect(page.getByRole('heading', { name: 'סיכום מחייב והגשה לאישור' })).toBeVisible();
  await page.getByRole('button', { name: 'הגשה לאישור · 4 הודעות' }).click();
  await expect(page.getByText(/המשלוח הוגש לאישור. חבילת אישור/)).toBeVisible();

  await loginAs(page, 'מאיר ברק');
  await page.goto('/approvals');
  await expect(page.getByRole('button', { name: /הזנה — דמו \(E2E\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /טיול שנתי — אישור הורים/ })).toBeVisible();
});

test('"איפוס דמו" clears what was done and reseeds', async ({ page }) => {
  await loginAs(page, 'מאיר ברק');
  await page.goto('/approvals');
  await page.getByRole('button', { name: /טיול שנתי — אישור הורים/ }).click();
  await page.locator('.actions button').click();
  await expect(page).toHaveURL(/\/tracking$/);

  await page.getByRole('button', { name: 'איפוס דמו' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, 'מאיר ברק');
  await page.goto('/approvals');
  await expect(page.getByRole('button', { name: /טיול שנתי — אישור הורים/ })).toBeVisible();
});

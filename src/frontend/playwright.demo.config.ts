import { defineConfig } from '@playwright/test';

/**
 * E2E against the BUILT demo (dist/demo, produced by `npm run demo:build`), served by a tiny static server with SPA
 * fallback. No backend, no database: the app talks to the in-browser fake API. Not part of `npm test`; run `npm run e2e:demo`.
 * (Point DEMO_DIR at another folder, e.g. ../../public, to test the committed output instead.)
 */
const PORT = 4290;
const DIR = process.env['DEMO_DIR'] ?? 'dist/demo';

export default defineConfig({
  testDir: './e2e-demo',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-demo',
  webServer: { command: `node scripts/serve-static.mjs ${DIR} ${PORT}`, url: `http://127.0.0.1:${PORT}/login`, reuseExistingServer: false, timeout: 30_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: 'he-IL', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

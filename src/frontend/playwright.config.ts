import { defineConfig } from '@playwright/test';

/**
 * M1 end-to-end. Loading this file has NO side effects (so `playwright test --list` and editor test discovery are
 * safe): the throwaway database, the API, the Worker and `ng serve` are created in e2e/global-setup.ts and removed in
 * e2e/global-teardown.ts (guarded: only ResidentComms_Test_<hex> is ever dropped).
 */
const WEB_PORT = 4280;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  outputDir: 'test-results',
  use: { baseURL: `http://localhost:${WEB_PORT}`, locale: 'he-IL', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

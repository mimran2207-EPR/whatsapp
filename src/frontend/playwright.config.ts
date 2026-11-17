import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * M1 end-to-end: a throwaway database ResidentComms_Test_<guid> (never `whatsapp`, never any other database),
 * the API (Development, port 5180), the Worker (deterministic mock) and `ng serve` (port 4280) are all started
 * by this config. The database is dropped in e2e/global-teardown.ts; Playwright stops the processes.
 *
 * Signing keys are generated per run and only passed through process environment: nothing is stored or committed.
 */
const repo = path.resolve(__dirname, '..', '..');
const API_PORT = 5180;
const WEB_PORT = 4280;
const SERVER = process.env['RESIDENTCOMMS_SQLSERVER'] ?? 'localhost';

// The config is evaluated again in every worker process; the environment (set below) carries the state over.
if (!process.env['RC_E2E_DB']) {
  const db = `ResidentComms_Test_${randomUUID().replace(/-/g, '')}`;
  const opts = { cwd: repo, stdio: 'inherit' as const };
  console.log(`[e2e] building backend, creating ${db}`);
  for (const p of ['src/backend/ResidentComms.Api', 'src/backend/ResidentComms.Worker', 'src/backend/tools/ResidentComms.DbMigrator'])
    execFileSync('dotnet', ['build', p, '--nologo', '-v', 'q', '-clp:ErrorsOnly'], opts);
  process.env['RC_E2E_DB'] = db; // set first so that a failure below still lets the teardown drop the database
  execFileSync('dotnet', ['run', '--no-build', '--project', 'src/backend/tools/ResidentComms.DbMigrator', '--', '--database', db], opts);
  // Dev seed on the throwaway database (the migrator's --seed-dev is whatsapp-only), and a 24h send window so the
  // test does not depend on the time of day (release re-checks the window with the real clock).
  execFileSync('sqlcmd', ['-S', SERVER, '-E', '-C', '-b', '-d', db, '-i', path.join(repo, 'db', 'seed', 'dev-seed.sql')], opts);
  execFileSync(
    'sqlcmd',
    ['-S', SERVER, '-E', '-C', '-b', '-d', db, '-Q', "UPDATE TenantPolicy SET send_window_start = '00:00', send_window_end = '23:59'"],
    opts,
  );
  process.env['RC_E2E_API_KEY'] = randomBytes(32).toString('hex');
  process.env['RC_E2E_MOCK_KEY'] = randomBytes(32).toString('hex');
}

const db = process.env['RC_E2E_DB']!;
const connection = `Server=${SERVER};Database=${db};Integrated Security=true;TrustServerCertificate=true`;
const apiUrl = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalTeardown: './e2e/global-teardown.ts',
  outputDir: 'test-results',
  use: { baseURL: `http://localhost:${WEB_PORT}`, locale: 'he-IL', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      name: 'api',
      command: 'dotnet run --no-build --no-launch-profile --project src/backend/ResidentComms.Api',
      cwd: repo,
      url: `${apiUrl}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        ASPNETCORE_URLS: apiUrl,
        ConnectionStrings__Default: connection,
        Auth__DevSigningKey: process.env['RC_E2E_API_KEY']!,
        Providers__MockSms__SigningKey: process.env['RC_E2E_MOCK_KEY']!,
      },
    },
    {
      name: 'worker',
      command: 'dotnet run --no-build --project src/backend/ResidentComms.Worker',
      cwd: repo,
      wait: { stdout: /Application started/ },
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        DOTNET_ENVIRONMENT: 'Development',
        ConnectionStrings__Default: connection,
        Providers__MockSms__SigningKey: process.env['RC_E2E_MOCK_KEY']!,
        Providers__MockSms__CallbackBaseUrl: apiUrl,
        // Deterministic mock: every message is accepted, then "sent" and "delivered" exactly once, within ~2 s.
        Providers__MockSms__AcceptRate: '1',
        Providers__MockSms__RejectRate: '0',
        Providers__MockSms__TimeoutRate: '0',
        Providers__MockSms__DeliverRate: '1',
        Providers__MockSms__FailRate: '0',
        Providers__MockSms__DuplicateEventRate: '0',
        Providers__MockSms__MaxEventDelaySeconds: '2',
      },
    },
    {
      name: 'web',
      command: `npx ng serve --port ${WEB_PORT} --proxy-config e2e/proxy.e2e.json`,
      cwd: __dirname,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});

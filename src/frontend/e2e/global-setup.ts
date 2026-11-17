import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { repo, startProcess, stopStack } from './stack';
import { assertTestDbName, dropTestDb, SQL_SERVER } from './test-db';

const API_PORT = 5180;
const WEB_PORT = 4280;

/**
 * M1 end-to-end stack: a throwaway database ResidentComms_Test_<guid> (never `whatsapp`, never any other database),
 * the API (Development, port 5180), the Worker (deterministic mock) and `ng serve` (port 4280).
 *
 * Everything with side effects happens here, not while the Playwright config loads (so `playwright test --list` and
 * editor test discovery create nothing). On any failure this function stops what it started and drops the database it
 * created before rethrowing; on success e2e/global-teardown.ts does the same after the run.
 * Signing keys are generated per run and only passed through process environment: nothing is stored or committed.
 */
export default async function globalSetup(): Promise<void> {
  const db = `ResidentComms_Test_${randomUUID().replace(/-/g, '')}`;
  assertTestDbName(db);
  const opts = { cwd: repo, stdio: 'inherit' as const };
  let created = false;
  try {
    // Preflight before anything is created: without sqlcmd neither the seed nor the cleanup could work.
    execFileSync('sqlcmd', ['-?'], { stdio: 'ignore' });
    console.log('[e2e] building backend');
    for (const p of ['src/backend/ResidentComms.Api', 'src/backend/ResidentComms.Worker', 'src/backend/tools/ResidentComms.DbMigrator'])
      execFileSync('dotnet', ['build', p, '--nologo', '-v', 'q', '-clp:ErrorsOnly'], opts);

    console.log(`[e2e] creating ${db}`);
    created = true; // from here on a failure must drop the database (the migrator may create it before failing)
    process.env['RC_E2E_DB'] = db;
    execFileSync('dotnet', ['run', '--no-build', '--project', 'src/backend/tools/ResidentComms.DbMigrator', '--', '--database', db], opts);
    // Dev seed on the throwaway database (the migrator's --seed-dev is whatsapp-only), and a 24h send window so the
    // test does not depend on the time of day (release re-checks the window with the real clock).
    execFileSync('sqlcmd', ['-S', SQL_SERVER, '-E', '-C', '-b', '-d', db, '-i', path.join(repo, 'db', 'seed', 'dev-seed.sql')], opts);
    execFileSync(
      'sqlcmd',
      ['-S', SQL_SERVER, '-E', '-C', '-b', '-d', db, '-Q', "UPDATE TenantPolicy SET send_window_start = '00:00', send_window_end = '23:59'"],
      opts,
    );

    const apiKey = randomBytes(32).toString('hex');
    const mockKey = randomBytes(32).toString('hex');
    const connection = `Server=${SQL_SERVER};Database=${db};Integrated Security=true;TrustServerCertificate=true`;
    const apiUrl = `http://localhost:${API_PORT}`;

    await startProcess({
      name: 'api',
      command: 'dotnet',
      args: ['run', '--no-build', '--no-launch-profile', '--project', 'src/backend/ResidentComms.Api'],
      cwd: repo,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        ASPNETCORE_URLS: apiUrl,
        ConnectionStrings__Default: connection,
        Auth__DevSigningKey: apiKey,
        Providers__MockSms__SigningKey: mockKey,
      },
      url: `${apiUrl}/health`,
      timeoutMs: 120_000,
    });
    await startProcess({
      name: 'worker',
      command: 'dotnet',
      args: ['run', '--no-build', '--project', 'src/backend/ResidentComms.Worker'],
      cwd: repo,
      env: {
        DOTNET_ENVIRONMENT: 'Development',
        ConnectionStrings__Default: connection,
        Providers__MockSms__SigningKey: mockKey,
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
      stdout: /Application started/,
      timeoutMs: 120_000,
    });
    await startProcess({
      name: 'web',
      command: `npx ng serve --port ${WEB_PORT} --proxy-config e2e/proxy.e2e.json`,
      args: [],
      shell: true,
      cwd: path.join(repo, 'src', 'frontend'),
      env: {},
      url: `http://localhost:${WEB_PORT}`,
      timeoutMs: 240_000,
    });
  } catch (e) {
    stopStack();
    if (created) {
      try {
        await dropTestDb(db);
      } catch (dropError) {
        console.error(`[e2e] could not drop ${db}; drop it manually:`, dropError);
      }
    }
    delete process.env['RC_E2E_DB'];
    throw e;
  }
}

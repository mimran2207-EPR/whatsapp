import { execFileSync } from 'node:child_process';

/** Drops the throwaway database. Guarded: only a name of the form ResidentComms_Test_<hex> is ever dropped. */
export default async function globalTeardown(): Promise<void> {
  const db = process.env['RC_E2E_DB'];
  if (!db) return;
  if (!/^ResidentComms_Test_[0-9a-f]{32}$/.test(db)) throw new Error(`Refusing to drop unexpected database name: ${db}`);
  const server = process.env['RESIDENTCOMMS_SQLSERVER'] ?? 'localhost';
  const sql = `IF DB_ID('${db}') IS NOT NULL BEGIN ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${db}]; END`;
  // The Worker may still hold a connection for a moment; retry a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('sqlcmd', ['-S', server, '-E', '-C', '-b', '-Q', sql], { stdio: 'inherit' });
      console.log(`[e2e] dropped ${db}`);
      return;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

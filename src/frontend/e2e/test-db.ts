import { execFileSync } from 'node:child_process';

export const SQL_SERVER = process.env['RESIDENTCOMMS_SQLSERVER'] ?? 'localhost';
const NAME = /^ResidentComms_Test_[0-9a-f]{32}$/;

/** Only a name of the form ResidentComms_Test_<hex> is ever created or dropped. Never `whatsapp`, never anything else. */
export function assertTestDbName(db: string): void {
  if (!NAME.test(db)) throw new Error(`Refusing to touch unexpected database name: ${db}`);
}

/** Drops the throwaway database (idempotent, guarded). The Worker may still hold a connection; retry a few times. */
export async function dropTestDb(db: string): Promise<void> {
  assertTestDbName(db);
  const sql = `IF DB_ID('${db}') IS NOT NULL BEGIN ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${db}]; END`;
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('sqlcmd', ['-S', SQL_SERVER, '-E', '-C', '-b', '-Q', sql], { stdio: 'inherit' });
      console.log(`[e2e] dropped ${db}`);
      return;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

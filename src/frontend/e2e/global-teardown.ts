import { stopStack } from './stack';
import { dropTestDb } from './test-db';

/** Stops the stack, then drops the throwaway database (guarded: only ResidentComms_Test_<hex>). */
export default async function globalTeardown(): Promise<void> {
  stopStack();
  const db = process.env['RC_E2E_DB'];
  if (!db) return;
  await dropTestDb(db);
}

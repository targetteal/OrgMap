import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { Pool } from 'pg';

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

/** Private host-owned authorization, reread for every request so removal takes
 * effect without changing a session or granting any organization role. */
export async function readDeletionReceiptOperators(path: string): Promise<ReadonlySet<string>> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())) throw Error('DELETION_OPERATOR_FILE_UNSAFE');
    const value = JSON.parse(await file.readFile('utf8'));
    if (!value || Object.keys(value).sort().join(',') !== 'accountIds,schemaVersion' ||
        value.schemaVersion !== 1 || !Array.isArray(value.accountIds) || value.accountIds.length > 128 ||
        value.accountIds.some((id: unknown) => typeof id !== 'string' || !uuid.test(id)) ||
        new Set(value.accountIds).size !== value.accountIds.length) throw Error('DELETION_OPERATOR_FILE_INVALID');
    return new Set<string>(value.accountIds);
  } finally { await file.close(); }
}

/** The login has only EXECUTE on the narrow receipt function. Its SQL guard
 * independently rejects the application, migrator and teardown authorities. */
export function createOrganizationDeletionOperatorReceipt(pool: Pool, operatorsFile: string) {
  return async (accountId: string, jobId: string): Promise<Record<string, unknown> | null> => {
    if (!uuid.test(accountId) || !uuid.test(jobId)) throw Error('DELETION_OPERATOR_INPUT_INVALID');
    if (!(await readDeletionReceiptOperators(operatorsFile)).has(accountId)) return null;
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
      const row = (await c.query('SELECT public.orgmap_deletion_operator_receipt($1) AS result', [jobId])).rows[0];
      await c.query('COMMIT');
      return row?.result ?? null;
    } catch (error) { await c.query('ROLLBACK').catch(() => {}); throw error; }
    finally { c.release(); }
  };
}

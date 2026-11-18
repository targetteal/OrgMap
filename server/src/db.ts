import pg from "pg";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
  max: 10,
});
export async function transaction<T>(
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  let begun = false;
  try {
    // Programmatic app entry points must obey the same managed-host boundary
    // as main/CLI. Metadata is checked before any transaction-local lock.
    const { assertManagedWriter } = await import('./managed-writer.js');
    await assertManagedWriter(c);
    await c.query("BEGIN");
    begun = true;
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    if (begun) await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

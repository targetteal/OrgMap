// Isolated QA only: foundation, Work link dependencies and goals; never migrates the shared database.
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.startsWith("/orgmap_goals_"))
  throw Error("Isolated goals database required");
const pool = new pg.Pool({ connectionString: url });
const c = await pool.connect();
try {
  await c.query(
    "BEGIN; CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now(),checksum text)",
  );
  const root = new URL("../../migrations/", import.meta.url);
  for (const name of (await readdir(root))
    .filter(
      (n) =>
        /^(00\d|01\d|2\d\d)_.*\.sql$/.test(n) &&
        Number(n.slice(0, 3)) <= Number(process.env.GOALS_MIGRATION_CUT ?? 299),
    )
    .sort()) {
    const source = await readFile(new URL(name, root), "utf8"),
      checksum = createHash("sha256").update(source).digest("hex");
    const prior = (
      await c.query("SELECT checksum FROM schema_migrations WHERE name=$1", [
        name,
      ])
    ).rows[0];
    if (prior) {
      if (prior.checksum !== checksum)
        throw Error("Checksum mismatch: " + name);
    } else {
      await c.query(source);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
    }
  }
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}

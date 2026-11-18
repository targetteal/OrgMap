import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool } from "./db.js";
import { selectMigrationNames, validateMigrationSelection, type MigrationSelection } from "./migration-selection.js";
import { loadMigrationPlan, hasReviewedReceiptReconciliation, receiptAttestation, integratedAttestation } from "./migration-plan.js";
export async function readiness(selection: number | MigrationSelection = { scope: "foundation" }) {
  const selected = validateMigrationSelection(typeof selection === "number" ? { maxPrefix: selection } : selection);
  try {
    const role = (
      await pool.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    if (role.rolsuper || role.rolbypassrls)
      return { status: "not_ready", code: "UNSAFE_DATABASE_ROLE" };
    if (
      (
        await pool.query(
          "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('entities','members','organizations') AND pg_has_role(current_user::regrole,c.relowner,'USAGE')",
        )
      ).rowCount
    )
      return { status: "not_ready", code: "UNSAFE_DATABASE_OWNERSHIP" };
    await pool.query(
      "SELECT id FROM organizations LIMIT 0; SELECT id FROM members LIMIT 0; SELECT id,node_id,parent_id,version FROM entities LIMIT 0; SELECT id FROM sessions LIMIT 0",
    );
    const names = selectMigrationNames(await readdir(new URL("../migrations/", import.meta.url)), selected);
    const applied = new Map(
      (
        await pool.query("SELECT name,checksum FROM schema_migrations")
      ).rows.map((x) => [x.name, x.checksum]),
    );
    let reconciled = false;
    if (names.includes(receiptAttestation) && !applied.has(receiptAttestation))
      reconciled = await hasReviewedReceiptReconciliation(pool, await loadMigrationPlan(selected), applied, "readiness");
    for (const name of names) {
      const hash = createHash("sha256")
        .update(
          await readFile(new URL("../migrations/" + name, import.meta.url)),
        )
        .digest("hex");
      if (applied.get(name) !== hash && !(name === receiptAttestation && !applied.has(name) && reconciled))
        return { status: "not_ready", code: "MIGRATION_MISMATCH" };
    }
    if (names.includes(integratedAttestation) && !(await pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0]?.ready)
      return { status: "not_ready", code: "SCHEMA_ATTESTATION_REQUIRED" };
    return { status: "ok", migrations: names.length };
  } catch {
    return {
      status: "not_ready",
      code: "DATABASE_UNAVAILABLE_OR_INCOMPATIBLE",
    };
  }
}

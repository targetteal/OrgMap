import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
/** Existing report-publication migration is needed by current saveReportVersion.
 * Lifecycle 900+ audits are outside this focal harness; execute the exact 931 SQL,
 * recording its checksum, only on our explicitly named disposable database. */
export async function supplementPanelFixture(connectionString: string) {
  const url = new URL(connectionString);
  if (!url.pathname.startsWith("/orgmap_o2panel_"))
    throw Error("DISPOSABLE_O2_PANEL_DATABASE_REQUIRED");
  const p = new pg.Pool({ connectionString });
  try {
    const source = await readFile(
      new URL(
        "../../migrations/931_meeting_report_publication.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await p.query(source);
    await p.query(
      "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
      [
        "931_meeting_report_publication.sql",
        createHash("sha256").update(source).digest("hex"),
      ],
    );
  } finally {
    await p.end();
  }
}

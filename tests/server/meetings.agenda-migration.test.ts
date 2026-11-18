import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

test("AG06 migration: real SQL300→304 preserves legacy placements, unknown authorship and report bytes", async () => {
  const source =
    process.env.MIGRATION_DATABASE_URL ??
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
  const admin = new pg.Pool({ connectionString: source });
  const name =
    "orgmap_meetings_migration_test_" + randomBytes(8).toString("hex");
  const url = new URL(source);
  url.pathname = "/" + name;
  let db: pg.Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    db = new pg.Pool({ connectionString: url.href });
    // Minimal Foundation keys only; all Meetings DDL is the actual historical and additive SQL.
    await db.query(
      "CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE members(organization_id uuid,id uuid,PRIMARY KEY(organization_id,id)); CREATE TABLE entities(organization_id uuid,id uuid,PRIMARY KEY(organization_id,id))",
    );
    await db.query(
      await readFile("server/migrations/300_meetings.sql", "utf8"),
    );
    const org = randomUUID(),
      actor = randomUUID(),
      circle = randomUUID(),
      series = randomUUID(),
      live = randomUUID(),
      closed = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.query("INSERT INTO organizations VALUES($1)", [org]);
    await db.query("INSERT INTO members VALUES($1,$2)", [org, actor]);
    await db.query("INSERT INTO entities VALUES($1,$2)", [org, circle]);
    await db.query(
      `INSERT INTO meeting_series(organization_id,id,title,circle_id,local_start,time_zone,duration_minutes,recurrence,template_snapshot,participants,policy) VALUES($1,$2,'Legacy',$3,'2020-01-01T10:00','UTC',60,'{}','{}','[]','{}')`,
      [org, series, circle],
    );
    for (const [mid, sequence, state] of [
      [live, 0, "SCHEDULED"],
      [closed, 1, "CLOSED"],
    ])
      await db.query(
        `INSERT INTO meeting_occurrences(organization_id,id,series_id,sequence,start_at,local_start,time_zone,duration_minutes,title,circle_id,state,sections,method,policy,facilitator_id) VALUES($1,$2,$3,$4,'2020-01-01T10:00Z','2020-01-01T10:00','UTC',60,'Original',$5,$6,'[{"id":"agenda","kind":"AGENDA","title":"Agenda"}]','CUSTOM','{}',$7)`,
        [org, mid, series, sequence, circle, state, actor],
      );
    for (const [i, status, mid, from] of [
      [0, "OPEN", live, null],
      [1, "COMPLETED", closed, null],
      [2, "TRANSFERRED", closed, ids[0]],
      [3, "OPEN", closed, null],
    ])
      await db.query(
        "INSERT INTO meeting_agenda(organization_id,id,meeting_id,title,presenter_id,duration_minutes,status,transferred_from) VALUES($1,$2,$3,$4,$5,0,$6,$7)",
        [org, ids[i as number], mid, "Legado " + i, actor, status, from],
      );
    const rid = randomUUID();
    await db.query(
      "INSERT INTO meeting_reports(organization_id,id,meeting_id,window_days) VALUES($1,$2,$3,7)",
      [org, rid, closed],
    );
    await db.query(
      "INSERT INTO meeting_report_versions(organization_id,report_id,version,epoch,snapshot,actor_id,reason) VALUES($1,$2,1,1,$3,$4,'Published')",
      [
        org,
        rid,
        JSON.stringify({
          original: true,
          placementId: ids[2],
          authorUnknown: null,
        }),
        actor,
      ],
    );
    const before = (
      await db.query(
        "SELECT snapshot::text AS bytes FROM meeting_report_versions",
      )
    ).rows[0].bytes;
    await db.query(
      await readFile("server/migrations/304_meetings_agenda_items.sql", "utf8"),
    );
    const roots = (
      await db.query("SELECT * FROM meeting_agenda_items ORDER BY title")
    ).rows;
    assert.deepEqual(
      roots.map((x) => x.state),
      ["ASSIGNED", "COMPLETED", "ARCHIVED", "NEEDS_RESCHEDULE"],
    );
    for (let i = 0; i < roots.length; i++) {
      assert.equal(roots[i].id, ids[i]);
      assert.equal(roots[i].creator_id, null);
      assert.equal(roots[i].owner_id, null);
      assert.equal(roots[i].created_at, null);
      assert.equal(roots[i].identity_coverage, "LEGACY_PLACEMENT");
      assert.equal(roots[i].creator_coverage, "UNKNOWN");
      assert.equal(roots[i].expected_duration_minutes, 0);
    }
    const placements = (
      await db.query("SELECT * FROM meeting_agenda ORDER BY title")
    ).rows;
    assert.deepEqual(
      placements.map((x) => x.id),
      ids,
    );
    assert.deepEqual(
      placements.map((x) => x.is_active),
      [true, false, false, false],
    );
    assert.equal(placements[2].transferred_from, ids[0]);
    assert.equal(
      (
        await db.query(
          "SELECT snapshot::text AS bytes FROM meeting_report_versions",
        )
      ).rows[0].bytes,
      before,
    );
  } finally {
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});

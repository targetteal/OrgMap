import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import * as Y from "yjs";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import {
  LEGACY_PROTOCOL,
  RICH_TEXT_PROTOCOL,
} from "../../server/modules/meetings/documents.js";
import {
  readRichSnapshot,
  RICH_TEXT_FRAGMENT,
} from "@orgmap/content/collaboration";
import { toPlainText, renderHTML } from "@orgmap/content";
if (
  !/^\/orgmap_(?:meetings_)?test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname,
  )
)
  throw Error("Disposable meetings DB required");
const available = new Map<string, boolean>();
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    core.registerModuleScope({
      module: "meetings",
      routePrefixes: [],
      resourceTypes: ["meeting", "report"],
    });
    core.registerOrganizationSettings(async (ctx) => ({
      version: 1,
      settings: {
        name: ctx.org.name,
        locale: ctx.org.locale,
        timezone: ctx.org.time_zone,
        modules: {
          structure: true,
          meetings: available.get(ctx.org.id) ?? true,
        },
      },
    }));
    await createMeetings({
      validateMembers: (ctx, ids) => core.validateActiveMembers(ctx, ids),
    })(app, core);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  payload: any = undefined,
  u?: User,
  v?: number,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": key,
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...(v !== undefined ? { "if-match": `"${v}"` } : {}),
    },
  });
}
function data(r: any) {
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return r.json().data;
}
async function user() {
  const r = await call("POST", "/auth/register", {
      email: randomUUID() + "@example.test",
      displayName: "Pessoa editor",
      password: "richtext-test-password-123",
    }),
    d = data(r);
  return {
    id: d.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
const encoded = (d: Y.Doc) =>
  Buffer.from(Y.encodeStateAsUpdate(d)).toString("base64");
const plain = (snapshot: string) => {
  const d = new Y.Doc();
  try {
    Y.applyUpdate(d, Buffer.from(snapshot, "base64"));
    return d.getText("notes").toString();
  } finally {
    d.destroy();
  }
};
function fork(snapshot: string) {
  const d = new Y.Doc();
  Y.applyUpdate(d, Buffer.from(snapshot, "base64"));
  return d;
}
const richText = (d: Y.Doc) =>
  (d.getXmlFragment(RICH_TEXT_FRAGMENT).get(0) as Y.XmlElement).get(
    0,
  ) as Y.XmlText;
function messages(ws: any) {
  const queue: any[] = [],
    waiters: { match: (v: any) => boolean; resolve: (v: any) => void }[] = [];
  ws.on("message", (raw: any) => {
    const value = JSON.parse(raw.toString()),
      i = waiters.findIndex((w) => w.match(value));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(value);
    else queue.push(value);
  });
  return (match: (v: any) => boolean) =>
    new Promise<any>((resolve, reject) => {
      const i = queue.findIndex(match);
      if (i >= 0) return resolve(queue.splice(i, 1)[0]);
      const timer = setTimeout(
        () => reject(Error("WS response timeout " + JSON.stringify(queue))),
        5000,
      );
      waiters.push({
        match,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
      });
    });
}
async function connect(
  route: string,
  u: User,
  epoch: number,
  protocol = LEGACY_PROTOCOL,
) {
  const ticket = data(
    await call(
      "POST",
      route + "/collaboration/tickets",
      { sectionId: "notes", epoch, protocol, schemaVersion: 1 },
      u,
    ),
  );
  const ws = await app.injectWS("/api/v1" + route + "/collaboration/socket", {
      headers: { cookie: u.cookie, origin: "http://localhost:5173" },
    }),
    next = messages(ws);
  ws.send(
    JSON.stringify({
      type: "hello",
      ticket: ticket.ticket,
      protocol,
      schemaVersion: 1,
    }),
  );
  const synced = await next((m) => m.type === "sync");
  return { ws, next, synced };
}
test("PG: explicit lossless migration, versioned negotiation, rich merge/ACK/reconnect/barrier/restore and reader revoke", async () => {
  const a = await user(),
    b = await user(),
    c = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Editor durável" }, a),
    ),
    p = "/organizations/" + A.organization.id;
  const B = data(
      await call("POST", p + "/members", { accountId: b.id }, a),
    ).membership,
    C = data(
      await call("POST", p + "/members", { accountId: c.id }, a),
    ).membership;
  const created = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Legado e editor",
          circleId: A.rootCircle.id,
          localStart: "2031-08-01T12:00",
          timeZone: "UTC",
          durationMinutes: 60,
          recurrence: { frequency: "ONCE" },
          sections: [
            { id: "notes", title: "Notas", kind: "CUSTOM" },
            { id: "agenda", title: "Agenda", kind: "AGENDA" },
          ],
          participants: [
            { memberId: B.id, access: "READ" },
            {
              memberId: C.id,
              access: "EDIT",
              canManage: true,
              canPublish: true,
              canRestore: true,
            },
          ],
          policy: {},
        },
        a,
      ),
    ),
    mid = created.occurrenceIds[0],
    route = p + "/meetings/" + mid;
  let d = data(await call("POST", route + "/actions/start", {}, a, 1));
  const source = new Y.Doc(),
    original = "  Olá 👩🏽‍💻\r\n\n漢字\r\n";
  source.getText("notes").insert(0, original);
  const sourceBytes = encoded(source);
  data(
    await call(
      "POST",
      route + "/collaboration/updates",
      {
        sectionId: "notes",
        epoch: 1,
        updateId: randomUUID(),
        update: sourceBytes,
      },
      a,
    ),
  );
  source.destroy();
  d = data(await call("GET", route, undefined, a));
  d = data(
    await call("POST", route + "/actions/close", {}, a, d.meeting.version),
  );
  const historyBefore = data(
    await call("GET", route + "/report/versions", undefined, a),
  );
  assert.equal(
    historyBefore.items[0].snapshot.documents.find(
      (x: any) => x.sectionId === "notes",
    ).sequence,
    1,
  );
  const oldReader = await connect(route, b, 1);
  const expected = d.documents.map((x: any) => ({
    sectionId: x.sectionId,
    epoch: x.epoch,
    sequence: x.sequence,
  }));
  const migration = {
      protocol: RICH_TEXT_PROTOCOL,
      documents: expected,
      reason: "Converter sem perda de notas confirmadas",
    },
    migrationKey = randomUUID();
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/actions/migrate",
        { ...migration, documents: expected.slice(0, 1) },
        a,
        d.meeting.version,
      )
    ).statusCode,
    409,
  );
  const beforeVersion = d.meeting.version,
    [first, second] = await Promise.all([
      call(
        "POST",
        route + "/collaboration/actions/migrate",
        migration,
        a,
        beforeVersion,
        migrationKey,
      ),
      call(
        "POST",
        route + "/collaboration/actions/migrate",
        migration,
        a,
        beforeVersion,
      ),
    ]);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 409, second.body);
  d = first.json().data;
  assert.equal(
    data(
      await call(
        "POST",
        route + "/collaboration/actions/migrate",
        migration,
        a,
        beforeVersion,
        migrationKey,
      ),
    ).report.version,
    d.report.version,
  );
  assert.equal(d.report.epoch, 2);
  assert.ok(
    d.documents.every(
      (x: any) =>
        x.protocol === RICH_TEXT_PROTOCOL &&
        x.schemaVersion === 1 &&
        x.epoch === 2 &&
        x.sequence === 0,
    ),
  );
  const notes = d.documents.find((x: any) => x.sectionId === "notes");
  assert.equal(toPlainText(notes.document), original);
  assert.equal(
    toPlainText(readRichSnapshot(Buffer.from(notes.snapshot, "base64"))),
    original,
  );
  const archived = data(
    await call("GET", route + "/collaboration/epochs", undefined, a),
  ).items;
  assert.equal(archived.length, 2);
  const old = archived.find((x: any) => x.sectionId === "notes");
  assert.equal(old.epoch, 1);
  assert.equal(old.sequence, 1);
  assert.equal(plain(old.snapshot), original);
  assert.equal(
    old.sha256,
    createHash("sha256")
      .update(Buffer.from(old.snapshot, "base64"))
      .digest("hex"),
  );
  const invalidated = await oldReader.next((m) => m.type === "error");
  assert.equal(invalidated.recoveryRequired, true);
  assert.equal(invalidated.code, "STALE_EPOCH_RECOVERY_REQUIRED");
  oldReader.ws.terminate();
  const payload = (update: string, updateId = randomUUID()) => ({
    sectionId: "notes",
    epoch: 2,
    protocol: RICH_TEXT_PROTOCOL,
    schemaVersion: 1,
    updateId,
    update,
  });
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        {
          sectionId: "notes",
          epoch: 2,
          updateId: randomUUID(),
          update: sourceBytes,
        },
        a,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/tickets",
        { sectionId: "notes", epoch: 2 },
        a,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        { ...payload(sourceBytes), schemaVersion: 99 },
        a,
      )
    ).statusCode,
    409,
  );
  const left = fork(notes.snapshot),
    right = fork(notes.snapshot),
    vector = Y.encodeStateVector(left);
  richText(left).insert(0, "α ", { bold: {} });
  richText(right).insert(0, "β ", { italic: {} });
  const ua = Buffer.from(Y.encodeStateAsUpdate(left, vector)).toString(
      "base64",
    ),
    ub = Buffer.from(Y.encodeStateAsUpdate(right, vector)).toString("base64");
  const updateId = randomUUID(),
    updateKey = randomUUID(),
    pa = payload(ua, updateId);
  const [ackA, ackB] = await Promise.all([
    call("POST", route + "/collaboration/updates", pa, a, undefined, updateKey),
    call("POST", route + "/collaboration/updates", payload(ub), c),
  ]);
  assert.equal(data(ackA).durable, true);
  assert.equal(data(ackB).durable, true);
  assert.equal(
    data(await call("POST", route + "/collaboration/updates", pa, a)).sequence,
    data(ackA).sequence,
  );
  d = data(await call("GET", route, undefined, a));
  let confirmed = d.documents.find((x: any) => x.sectionId === "notes");
  assert.equal(confirmed.sequence, 2);
  assert.match(toPlainText(confirmed.document), /α/);
  assert.match(toPlainText(confirmed.document), /β/);
  assert.match(renderHTML(confirmed.document), /<strong>/);
  assert.match(renderHTML(confirmed.document), /<em>/);
  const malicious = fork(confirmed.snapshot),
    badVector = Y.encodeStateVector(malicious);
  richText(malicious).format(0, 1, { link: { href: "javascript:alert(1)" } });
  const bad = Buffer.from(Y.encodeStateAsUpdate(malicious, badVector)).toString(
    "base64",
  );
  assert.equal(
    (await call("POST", route + "/collaboration/updates", payload(bad), a))
      .statusCode,
    422,
  );
  assert.equal(
    (await call("POST", route + "/collaboration/updates", payload(ua), b))
      .statusCode,
    403,
  );
  assert.equal(
    data(await call("GET", route, undefined, a)).documents.find(
      (x: any) => x.sectionId === "notes",
    ).snapshot,
    confirmed.snapshot,
  );
  malicious.destroy();
  const reader = await connect(route, b, 2, RICH_TEXT_PROTOCOL),
    writer = await connect(route, a, 2, RICH_TEXT_PROTOCOL);
  assert.deepEqual(reader.synced.document.document, confirmed.document);
  writer.ws.terminate();
  const reconnected = await connect(route, a, 2, RICH_TEXT_PROTOCOL);
  assert.equal(reconnected.synced.document.sequence, 2);
  reconnected.ws.terminate();
  d = data(
    await call(
      "POST",
      route + "/report/actions/publish",
      {},
      a,
      d.report.version,
    ),
  );
  const history = data(
    await call("GET", route + "/report/versions", undefined, a),
  );
  const atBarrier = history.items[0].snapshot.documents.find(
    (x: any) => x.sectionId === "notes",
  );
  assert.equal(atBarrier.sequence, 2);
  assert.deepEqual(atBarrier.document, confirmed.document);
  d = data(
    await call(
      "POST",
      route + "/report/actions/restore",
      {
        restoreVersion: 1,
        reason: "Restaurar versão legada em nova época rica",
      },
      a,
      d.report.version,
    ),
  );
  assert.equal(d.report.epoch, 3);
  assert.ok(
    d.documents.every(
      (x: any) => x.protocol === RICH_TEXT_PROTOCOL && x.epoch === 3,
    ),
  );
  assert.equal(
    toPlainText(d.documents.find((x: any) => x.sectionId === "notes").document),
    original,
  );
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        pa,
        a,
        undefined,
        updateKey,
      )
    ).statusCode,
    409,
  );
  const recovered = data(
    await call(
      "GET",
      route + "/collaboration/epochs?sectionId=notes",
      undefined,
      a,
    ),
  ).items;
  assert.equal(recovered.length, 2);
  assert.equal(
    recovered.find((x: any) => x.epoch === 2).snapshot,
    confirmed.snapshot,
  );
  assert.deepEqual(
    data(
      await call("GET", route + "/report/versions", undefined, a),
    ).items.find((x: any) => x.version === 1),
    historyBefore.items[0],
  );
  reader.ws.terminate();
  const liveReader = await connect(route, b, 3, RICH_TEXT_PROTOCOL);
  d = data(
    await call(
      "POST",
      route + "/actions/participants",
      { participants: [{ memberId: B.id, access: "DENY" }] },
      a,
      d.meeting.version,
    ),
  );
  assert.equal(
    (await liveReader.next((m) => m.type === "error")).code,
    "RESOURCE_NOT_FOUND",
  );
  liveReader.ws.terminate();
  assert.equal(
    (await call("GET", route + "/collaboration/epochs", undefined, b))
      .statusCode,
    404,
  );
  available.set(A.organization.id, false);
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        { ...payload(ua), epoch: 3 },
        a,
      )
    ).statusCode,
    403,
  );
  available.set(A.organization.id, true);
  left.destroy();
  right.destroy();
});
test("PG: pending legacy blocks migration; injected archive failure rolls back all sections and preserves source ACK bytes", async () => {
  const a = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Migração atômica" }, a),
    ),
    p = "/organizations/" + A.organization.id;
  const created = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Pendências e rollback",
          circleId: A.rootCircle.id,
          localStart: "2031-09-01T12:00",
          timeZone: "UTC",
          durationMinutes: 60,
          recurrence: { frequency: "ONCE" },
          sections: [{ id: "notes", title: "Notas", kind: "CUSTOM" }],
          policy: {},
        },
        a,
      ),
    ),
    mid = created.occurrenceIds[0],
    route = p + "/meetings/" + mid;
  let d = data(await call("POST", route + "/actions/start", {}, a, 1));
  const doc = new Y.Doc(),
    updates: Uint8Array[] = [];
  doc.on("update", (u) => updates.push(u));
  doc.getText("notes").insert(0, "one");
  doc.getText("notes").insert(3, "two");
  data(
    await call(
      "POST",
      route + "/collaboration/updates",
      {
        sectionId: "notes",
        epoch: 1,
        updateId: randomUUID(),
        update: Buffer.from(updates[1]).toString("base64"),
      },
      a,
    ),
  );
  d = data(await call("GET", route, undefined, a));
  const request = () => ({
    protocol: RICH_TEXT_PROTOCOL,
    documents: d.documents.map((x: any) => ({
      sectionId: x.sectionId,
      epoch: x.epoch,
      sequence: x.sequence,
    })),
    reason: "Migração explícita",
  });
  const blocked = await call(
    "POST",
    route + "/collaboration/actions/migrate",
    request(),
    a,
    d.meeting.version,
  );
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.code, "PENDING_UPDATES_REQUIRE_RESOLUTION");
  assert.equal(
    (await call("POST", route + "/actions/close", {}, a, d.meeting.version))
      .statusCode,
    409,
  );
  assert.equal(
    data(await call("GET", route + "/collaboration/epochs", undefined, a)).items
      .length,
    0,
  );
  data(
    await call(
      "POST",
      route + "/collaboration/updates",
      {
        sectionId: "notes",
        epoch: 1,
        updateId: randomUUID(),
        update: Buffer.from(updates[0]).toString("base64"),
      },
      a,
    ),
  );
  d = data(await call("GET", route, undefined, a));
  const before = d.documents[0],
    admin = new pg.Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    }),
    key = randomUUID();
  try {
    await admin.query(
      `CREATE FUNCTION meetings_archive_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${A.organization.id}'::uuid THEN RAISE EXCEPTION 'test-only archive failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER meetings_fail_archive BEFORE INSERT ON meeting_document_epochs FOR EACH ROW EXECUTE FUNCTION meetings_archive_failure()`,
    );
    assert.equal(
      (
        await call(
          "POST",
          route + "/collaboration/actions/migrate",
          request(),
          a,
          d.meeting.version,
          key,
        )
      ).statusCode,
      500,
    );
    assert.deepEqual(
      data(await call("GET", route, undefined, a)).documents[0],
      before,
    );
    assert.equal(
      data(await call("GET", route + "/collaboration/epochs", undefined, a))
        .items.length,
      0,
    );
  } finally {
    await admin.query(
      "DROP TRIGGER IF EXISTS meetings_fail_archive ON meeting_document_epochs; DROP FUNCTION IF EXISTS meetings_archive_failure()",
    );
    await admin.end();
  }
  const migrated = data(
    await call(
      "POST",
      route + "/collaboration/actions/migrate",
      request(),
      a,
      d.meeting.version,
      key,
    ),
  );
  assert.equal(toPlainText(migrated.documents[0].document), "onetwo");
  assert.equal(migrated.documents[0].sequence, 0);
  assert.equal(
    data(await call("GET", route + "/collaboration/epochs", undefined, a))
      .items[0].snapshot,
    before.snapshot,
  );
  doc.destroy();
});

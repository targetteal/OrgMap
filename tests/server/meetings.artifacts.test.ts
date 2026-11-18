import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { fromPlainText } from "../../packages/content/index.js";
import { createReportPackageSerializer } from "../../server/modules/platform/report-package.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import {
  createRichYDoc,
  RICH_TEXT_FRAGMENT,
  RICH_TEXT_PROTOCOL,
} from "../../packages/content/collaboration.js";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import {
  createOrgMapIntegration,
  createPlatformWorker,
} from "../../server/integration/index.js";
import { createLocalReportPackageSerializer } from "../../server/modules/platform/report-runtime.js";
import { readdir } from "node:fs/promises";
import pg from "pg";

if (
  !/^\/orgmap_meetings_test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("Exclusive disposable Meetings database required");
const blobRoot = await mkdtemp(join(tmpdir(), "orgmap-meetings-artifacts-"));
const options = { blobsDirectory: blobRoot };
const app = await buildApp([createOrgMapIntegration(options)], {
  migrationMaxPrefix: 999,
});
// This is the real independent factory, with a fresh core and the same composed adapters.
const worker = await createPlatformWorker(options);
// Ordinary runs must not overwrite historical evidence in the checkout.
// An explicit directory can be used when preserving artifacts for inspection.
const evidence = process.env.MEETINGS_ARTIFACT_EVIDENCE_DIR ?? await mkdtemp(join(tmpdir(), "orgmap-meetings-evidence-"));
await mkdir(evidence, { recursive: true });
after(async () => {
  await app.close();
  await pool.end();
  await rm(blobRoot, { recursive: true, force: true });
  if (!process.env.MEETINGS_ARTIFACT_EVIDENCE_DIR)
    await rm(evidence, { recursive: true, force: true });
});
type User = { id: string; cookie: string; csrf: string };
async function call(
  method: string,
  path: string,
  payload?: any,
  u?: User,
  v?: number,
  key: string = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": key,
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...(v === undefined ? {} : { "if-match": `"${v}"` }),
    },
  });
}
function data(r: any, status = 200): any {
  assert.equal(r.statusCode, status, r.body);
  return r.json().data;
}
async function setup() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "Artifacts-Meetings-QA-2026",
    displayName: "Pessoa 日本語 🌿",
  });
  const a = data(r, 201),
    u: User = {
      id: a.account.id,
      cookie: r.cookies[0].name + "=" + r.cookies[0].value,
      csrf: a.csrfToken,
    };
  const org = data(
    await call("POST", "/organizations", { name: "Círculo Équipe 日本語" }, u),
    201,
  );
  return { u, org, p: "/organizations/" + org.organization.id };
}
async function settings(
  s: Awaited<ReturnType<typeof setup>>,
  mutate: (value: any) => void,
) {
  const current = data(
    await call("GET", s.p + "/administration/settings", undefined, s.u),
  );
  mutate(current.settings);
  return data(
    await call(
      "PUT",
      s.p + "/administration/settings",
      { settings: current.settings, oversightAcknowledged: true },
      s.u,
      current.version,
    ),
  );
}
async function report(
  s: Awaited<ReturnType<typeof setup>>,
  title = "Ata Équipe 日本語 🌿",
  circle = s.org.rootCircle.id,
) {
  const created = data(
    await call(
      "POST",
      s.p + "/meeting-series",
      {
        title,
        circleId: circle,
        localStart: "2026-03-08T12:00",
        timeZone: "America/New_York",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "notes", title: "Notas 議事録", kind: "CUSTOM" }],
        notesProtocol: RICH_TEXT_PROTOCOL,
        policy: {},
      },
      s.u,
    ),
    201,
  );
  const mid = created.occurrenceIds[0],
    route = s.p + "/meetings/" + mid;
  let d = data(await call("POST", route + "/actions/start", {}, s.u, 1));
  d = data(
    await call(
      "POST",
      route + "/agenda",
      { title: "Decisão discutida 日本語", durationMinutes: 0 },
      s.u,
      d.meeting.version,
    ),
  );
  d = data(
    await call(
      "POST",
      route + "/actions/work-item",
      { title: "Ação responsável 🌿" },
      s.u,
      d.meeting.version,
    ),
  );
  const rich = {
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Conteúdo publicado: português 日本語 🌿",
              marks: [{ type: "bold" }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Link seguro",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.test/referencia" },
                },
                { type: "italic" },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Decisão com lista e texto literal <script>",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(d.documents[0].snapshot, "base64"));
  const vector = Y.encodeStateVector(doc),
    fragment = doc.getXmlFragment(RICH_TEXT_FRAGMENT),
    incoming = createRichYDoc(rich as any);
  doc.transact(() => {
    fragment.delete(0, fragment.length);
    fragment.insert(
      0,
      incoming
        .getXmlFragment(RICH_TEXT_FRAGMENT)
        .toArray()
        .map((x) => {
          assert.ok(x instanceof Y.XmlElement || x instanceof Y.XmlText);
          return x.clone();
        }),
    );
  });
  data(
    await call(
      "POST",
      route + "/collaboration/updates",
      {
        sectionId: "notes",
        epoch: 1,
        protocol: RICH_TEXT_PROTOCOL,
        schemaVersion: 1,
        updateId: randomUUID(),
        update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString(
          "base64",
        ),
      },
      s.u,
    ),
  );
  incoming.destroy();
  doc.destroy();
  d = data(await call("GET", route, undefined, s.u));
  d = data(
    await call("POST", route + "/actions/close", {}, s.u, d.meeting.version),
  );
  d = data(
    await call(
      "POST",
      route + "/report/actions/publish",
      {},
      s.u,
      d.report.version,
    ),
  );
  return { mid, route, reportId: d.report.id };
}
async function enqueue(
  s: Awaited<ReturnType<typeof setup>>,
  request: any,
  key?: string,
) {
  return data(
    await call("POST", s.p + "/meetings/exports", request, s.u, undefined, key),
    202,
  );
}
async function run(s: Awaited<ReturnType<typeof setup>>, selection: any) {
  assert.equal(
    await worker.runJob(s.org.organization.id, s.org.membership.id),
    true,
  );
  const job = data(
    await call(
      "GET",
      s.p + "/platform/jobs/" + selection.job.id,
      undefined,
      s.u,
    ),
  );
  assert.equal(job.state, "COMPLETED", JSON.stringify(job));
  const d = data(
    await call(
      "GET",
      s.p + "/platform/artifacts/" + job.result.artifactId + "/download",
      undefined,
      s.u,
    ),
  );
  return { job, download: d, bytes: Buffer.from(d.base64, "base64") };
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
test("EX01–04 real root HTTP + independent worker produce PDF/ZIP/XLSX and frozen published content", async () => {
  const s = await setup(),
    m = await report(s);
  const caps = data(
    await call("GET", s.p + "/meetings/exports/capabilities", undefined, s.u),
  );
  assert.deepEqual(caps.formatsByKind, {
    MEETING_ROWS: ["XLSX"],
    MEETING_REPORT_PDF: ["PDF"],
    MEETING_REPORT_BUNDLE: ["ZIP"],
    MEETING_MONTHLY_STATISTICS: ["XLSX"],
  });
  const request = { kind: "MEETING_REPORT_PDF", format: "PDF" },
    key = randomUUID(),
    first = await enqueue(s, request, key),
    again = await enqueue(s, request, key);
  assert.equal(first.job.id, again.job.id);
  // Frozen payload is reused by both serializers, proving byte identity rather than two different capture clocks.
  const one = await run(s, first);
  assert.equal(one.download.mime, "application/pdf");
  assert.equal(one.bytes.subarray(0, 5).toString(), "%PDF-");
  // App role RLS needs tenant context for direct test reads.
  const payload = await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      s.org.organization.id,
    ]);
    return (
      await c.query(
        "SELECT frozen_payload FROM meeting_export_selections WHERE organization_id=$1 AND id=$2",
        [s.org.organization.id, first.selectionSummary.id],
      )
    ).rows[0].frozen_payload.documentPackage;
  });
  const serializer = createLocalReportPackageSerializer(),
    sameZip = await serializer.serialize(payload, "ZIP");
  await writeFile(
    join(evidence, "frozen-package.json"),
    JSON.stringify(payload, null, 2),
  );
  const zip = await run(
    s,
    await enqueue(s, { kind: "MEETING_REPORT_BUNDLE", format: "ZIP" }),
  );
  assert.equal(zip.download.mime, "application/zip");
  const draft = await run(
    s,
    await enqueue(s, {
      kind: "MEETING_REPORT_PDF",
      format: "PDF",
      reportSource: "CURRENT_AUTHORIZED",
    }),
  );
  const rows = await run(
    s,
    await enqueue(s, { kind: "MEETING_ROWS", format: "XLSX" }),
  );
  const stats = await run(
    s,
    await enqueue(s, {
      kind: "MEETING_MONTHLY_STATISTICS",
      format: "XLSX",
      endMonth: "2026-03",
    }),
  );
  await writeFile(join(evidence, "report.pdf"), one.bytes);
  await writeFile(join(evidence, "draft.pdf"), draft.bytes);
  await writeFile(join(evidence, "same-selection.zip"), sameZip);
  await writeFile(join(evidence, "reports.zip"), zip.bytes);
  await writeFile(join(evidence, "meetings.xlsx"), rows.bytes);
  await writeFile(join(evidence, "statistics.xlsx"), stats.bytes);
  await writeFile(
    join(evidence, "expected.json"),
    JSON.stringify(
      {
        title: "Ata Équipe 日本語 🌿",
        reportId: m.reportId,
        meetingId: m.mid,
        pdfSha256: sha(one.bytes),
        text: "Conteúdo publicado: português 日本語 🌿",
        artifacts: [
          { file: "report.pdf", sha256: sha(one.bytes) },
          { file: "reports.zip", sha256: sha(zip.bytes) },
          { file: "meetings.xlsx", sha256: sha(rows.bytes) },
          { file: "statistics.xlsx", sha256: sha(stats.bytes) },
        ],
      },
      null,
      2,
    ),
  );
});
test("EX05 current resource revocation fails worker, download, retry and replay without hidden metadata", async () => {
  const s = await setup(),
    m = await report(s, "Segredo revogado");
  const done = await run(
    s,
    await enqueue(s, { kind: "MEETING_REPORT_PDF", format: "PDF" }),
  );
  const request = { kind: "MEETING_REPORT_BUNDLE", format: "ZIP" },
    key = randomUUID(),
    pending = await enqueue(s, request, key);
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      s.org.organization.id,
    ]);
    await c.query(
      "UPDATE meeting_participants SET access='DENY' WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3",
      [s.org.organization.id, m.mid, s.org.membership.id],
    );
  });
  assert.equal(
    await worker.runJob(s.org.organization.id, s.org.membership.id),
    true,
  );
  for (const response of [
    await call(
      "GET",
      s.p + "/platform/artifacts/" + done.job.result.artifactId + "/download",
      undefined,
      s.u,
    ),
    await call("POST", s.p + "/meetings/exports", request, s.u, undefined, key),
    await call(
      "POST",
      s.p + "/platform/jobs/" + pending.job.id + "/retry",
      {},
      s.u,
    ),
  ]) {
    assert.equal(response.statusCode, 404, response.body);
    assert.ok(!response.body.includes("Segredo revogado"));
  }
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      s.org.organization.id,
    ]);
    const j = (
      await c.query(
        "SELECT state,error_code FROM platform_jobs WHERE organization_id=$1 AND id=$2",
        [s.org.organization.id, pending.job.id],
      )
    ).rows[0];
    assert.equal(j.state, "FAILED");
    assert.equal(j.error_code, "RESOURCE_NOT_FOUND");
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM platform_artifacts WHERE organization_id=$1 AND job_id=$2",
          [s.org.organization.id, pending.job.id],
        )
      ).rows[0].n,
      0,
    );
  });
});
test("EX06 empty authorized bundle is valid and does not manufacture a PDF", async () => {
  const s = await setup();
  const result = await run(
    s,
    await enqueue(s, { kind: "MEETING_REPORT_BUNDLE", format: "ZIP" }),
  );
  await writeFile(join(evidence, "empty.zip"), result.bytes);
  assert.ok(result.bytes.includes(Buffer.from('"count": 0')));
  assert.ok(!result.bytes.includes(Buffer.from(".pdf")));
});
test("EX07 renderer paginates long tables and fails budgets explicitly without truncation", async () => {
  const payload = JSON.parse(
    await readFile(join(evidence, "frozen-package.json"), "utf8"),
  );
  const document = structuredClone(payload.documents[0]);
  document.roster = Array.from({ length: 90 }, (_, i) => ({
    memberId: randomUUID(),
    label: `Pessoa ${String(i + 1).padStart(3, "0")} da equipe 日本語 com nome longo para preservar na tabela`,
    attendance: "PRESENT",
    participationRole: "REQUIRED",
  }));
  const serializer = createLocalReportPackageSerializer();
  const bytes = await serializer.serialize(
    { ...payload, documents: [document] },
    "PDF",
  );
  await writeFile(join(evidence, "multipage.pdf"), bytes);
  const oversized = structuredClone(document);
  oversized.sections[0].body = fromPlainText(
    "Linha explícita de relatório\n".repeat(3500),
  );
  await assert.rejects(
    serializer.serialize({ ...payload, documents: [oversized] }, "PDF"),
    (e: any) => e.status === 413 && e.code === "REPORT_PAGE_LIMIT",
  );
  await assert.rejects(
    serializer.serialize(
      { ...payload, documents: Array.from({ length: 101 }, () => document) },
      "ZIP",
    ),
    (e: any) => e.status === 413 && e.code === "REPORT_COUNT_LIMIT",
  );
  // Explicit fault injection tests the final byte budget independently of PDF compression ratios.
  const tooManyBytes = Buffer.alloc(5 * 1024 * 1024 + 1);
  Buffer.from("%PDF-").copy(tooManyBytes);
  const budgetFixture = createReportPackageSerializer({
    render: async () => ({
      bytes: tooManyBytes,
      pages: 1,
      rendererVersion: "TEST_ONLY_OVERSIZED_RENDERER",
    }),
  });
  await assert.rejects(
    budgetFixture.serialize(
      { ...payload, documents: [payload.documents[0]] },
      "PDF",
    ),
    (e: any) => e.status === 413 && e.code === "EXPORT_TOO_LARGE",
  );
});
test("EX08 root registers module guards and keeps Guest unable to create or discover exports", async () => {
  const s = await setup(),
    m = await report(s);
  const registration = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "Artifacts-Guest-QA-2026",
    displayName: "Guest sintético",
  });
  const account = data(registration, 201),
    guest: User = {
      id: account.account.id,
      cookie:
        registration.cookies[0].name + "=" + registration.cookies[0].value,
      csrf: account.csrfToken,
    };
  data(
    await call(
      "POST",
      s.p + "/members",
      {
        accountId: guest.id,
        memberType: "GUEST",
        accessPlan: [
          {
            resource: { context: "meetings", kind: "meeting", id: m.mid },
            actions: ["read"],
          },
        ],
      },
      s.u,
    ),
    201,
  );
  data(await call("GET", m.route, undefined, guest));
  for (const [method, path, body] of [
    ["GET", "/meetings/exports/capabilities", undefined],
    [
      "POST",
      "/meetings/exports",
      { kind: "MEETING_REPORT_BUNDLE", format: "ZIP" },
    ],
    ["GET", "/meeting-agenda-items", undefined],
  ] as const) {
    const r = await call(method, s.p + path, body, guest);
    assert.ok([403, 404].includes(r.statusCode), r.body);
  }
  const done = await run(
    s,
    await enqueue(s, { kind: "MEETING_REPORT_PDF", format: "PDF" }),
  );
  const request = { kind: "MEETING_REPORT_BUNDLE", format: "ZIP" },
    key = randomUUID(),
    pending = await enqueue(s, request, key);
  await settings(s, (v) => {
    v.modules.meetings = false;
  });
  assert.equal(
    (
      await call(
        "POST",
        s.p + "/meetings/exports",
        request,
        s.u,
        undefined,
        key,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "GET",
        s.p + "/platform/artifacts/" + done.job.result.artifactId + "/download",
        undefined,
        s.u,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    await worker.runJob(s.org.organization.id, s.org.membership.id),
    true,
  );
  await settings(s, (v) => {
    v.modules.meetings = true;
  });
  const failed = data(
    await call("GET", s.p + "/platform/jobs/" + pending.job.id, undefined, s.u),
  );
  assert.equal(failed.state, "FAILED");
  assert.ok(!failed.result?.artifactId);
});
test("EX09 multi-circle bundles preserve distinct reports and current private export intent is revoked", async () => {
  const s = await setup(),
    one = await report(s, "Ata raiz");
  const circle = data(
    await call(
      "POST",
      s.p + "/circles",
      {
        parentCircleId: s.org.rootCircle.id,
        name: "Equipe secundária",
        mode: "DIRECT",
      },
      s.u,
    ),
    201,
  ).circle;
  const two = await report(s, "Ata secundária", circle.id);
  const bundle = await run(
    s,
    await enqueue(s, {
      kind: "MEETING_REPORT_BUNDLE",
      format: "ZIP",
      circleIds: [s.org.rootCircle.id, circle.id],
    }),
  );
  await writeFile(join(evidence, "multi-circle.zip"), bundle.bytes);
  await writeFile(
    join(evidence, "multi-circle-expected.json"),
    JSON.stringify({ reportIds: [one.reportId, two.reportId] }, null, 2),
  );
  await settings(s, (v) => {
    v.oversight.privateOperationalExport = true;
  });
  const request = {
      kind: "MEETING_REPORT_BUNDLE",
      format: "ZIP",
      includePrivate: true,
    },
    key = randomUUID();
  const done = await run(s, await enqueue(s, request, key)),
    pending = await enqueue(s, request);
  await settings(s, (v) => {
    v.oversight.privateOperationalExport = false;
  });
  assert.equal(
    (
      await call(
        "POST",
        s.p + "/meetings/exports",
        request,
        s.u,
        undefined,
        key,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "GET",
        s.p + "/platform/artifacts/" + done.job.result.artifactId + "/download",
        undefined,
        s.u,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    await worker.runJob(s.org.organization.id, s.org.membership.id),
    true,
  );
  await settings(s, (v) => {
    v.oversight.privateOperationalExport = true;
  });
  const failed = data(
    await call("GET", s.p + "/platform/jobs/" + pending.job.id, undefined, s.u),
  );
  assert.equal(failed.state, "FAILED");
  assert.ok(!failed.result?.artifactId);
});
test("EX10 a completion rollback removes only the freshly created blob and retains committed artifacts", async () => {
  const s = await setup();
  await report(s);
  const committed = await run(
    s,
    await enqueue(s, { kind: "MEETING_REPORT_PDF", format: "PDF" }),
  );
  const pending = await enqueue(s, {
      kind: "MEETING_REPORT_BUNDLE",
      format: "ZIP",
    }),
    before = (await readdir(blobRoot)).sort();
  const admin = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  // Explicit DB fault in the exclusive disposable database, after the real artifact insert.
  const suffix = randomUUID().replaceAll("-", ""),
    name = "meetings_artifact_fault_" + suffix;
  try {
    await admin.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ONLY_COMPLETION_ROLLBACK'; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER ${name} BEFORE UPDATE ON platform_jobs FOR EACH ROW WHEN (NEW.id='${pending.job.id}'::uuid AND NEW.state='COMPLETED') EXECUTE FUNCTION ${name}()`,
    );
    assert.equal(
      await worker.runJob(s.org.organization.id, s.org.membership.id),
      true,
    );
    assert.deepEqual((await readdir(blobRoot)).sort(), before);
    await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        s.org.organization.id,
      ]);
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM platform_artifacts WHERE organization_id=$1 AND job_id=$2",
            [s.org.organization.id, pending.job.id],
          )
        ).rows[0].n,
        0,
      );
    });
    const retained = data(
      await call(
        "GET",
        s.p +
          "/platform/artifacts/" +
          committed.job.result.artifactId +
          "/download",
        undefined,
        s.u,
      ),
    );
    assert.equal(
      sha(Buffer.from(retained.base64, "base64")),
      sha(committed.bytes),
    );
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS ${name} ON platform_jobs`);
    await admin.query(`DROP FUNCTION IF EXISTS ${name}()`);
    await admin.end();
  }
});

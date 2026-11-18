import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import administration, {
  oversight,
} from "../../server/modules/administration/index.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import { createMeetingResourceAdapters } from "../../server/modules/meetings/platform.js";
import { createMeetingCalendarPort } from "../../server/modules/meetings/calendar-port.js";
import { Y } from "../../server/modules/meetings/realtime.js";
import type { ResourceAction } from "../../server/modules/platform/ports.js";
import {
  createPlatform,
  ResourceRegistry,
  FilesystemBlobStore,
  PlatformWorker,
} from "../../server/modules/platform/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (
  !/^\/orgmap_(?:meetings_)?test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname,
  )
)
  throw Error("Disposable test DB required");
const policy = { oversight },
  adapters = createMeetingResourceAdapters(policy);
const blobsRoot = await mkdtemp(join(tmpdir(), "orgmap-meeting-oversight-")),
  blobs = new FilesystemBlobStore(blobsRoot),
  registry = new ResourceRegistry()
    .registerResourceAdapter("meeting", adapters.meeting)
    .registerResourceAdapter("report", adapters.report);
let worker: PlatformWorker;
const workerDiagnostics: any[] = [];
assert.equal(
  createMeetingResourceAdapters().meeting.supportsPrivateExport,
  false,
);
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  administration,
  async (app, core) => {
    worker = new PlatformWorker({
      onDiagnostic: (value) => workerDiagnostics.push(value),
      registry,
      blobs,
      withContext: (org, member, fn) => core.withWorkerContext(org, member, fn),
    });
    await createMeetings({
      validateMembers: (ctx, ids) => core.validateActiveMembers(ctx, ids),
      readPolicy: policy,
    })(app, core);
    await createPlatform({ registry, blobs })(app, core);
    app.get(
      "/api/v1/organizations/:organizationId/test-privacy/:kind/:action",
      (r) =>
        core.tenant(r, { mode: "read" }, async (ctx) => {
          const p = r.params as any,
            q = r.query as any;
          if (p.kind === "calendar")
            return createMeetingCalendarPort(policy).list(
              ctx,
              q.includePrivate === "true"
                ? { includePrivate: true }
                : undefined,
            );
          const a = adapters[p.kind as "meeting" | "report"],
            intent =
              q.includePrivate === "true"
                ? { includePrivate: true }
                : undefined;
          const allowed = await a.authorize(
            ctx,
            q.id,
            p.action as ResourceAction,
            intent,
          );
          return {
            allowed,
            items: await a.search!(ctx, "Privada", 100),
            ...(allowed && p.action === "export"
              ? { output: await a.export(ctx, [q.id], "RESOURCES", intent) }
              : {}),
          };
        }),
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
  await rm(blobsRoot, { recursive: true, force: true });
});
type User = { id: string; cookie: string; csrf: string };
async function call(
  method: string,
  path: string,
  payload: any = undefined,
  u?: User,
  version?: number,
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
      ...(version !== undefined ? { "if-match": `"${version}"` } : {}),
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
      password: "oversight-local-password-123",
      displayName: "Pessoa supervisão",
    }),
    d = data(r);
  return {
    id: d.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
test("actual admin policy OFF→ON→OFF: read-only supervision, explicit deny, private export intent and WS revocation", async () => {
  const owner = await user(),
    facilitator = await user(),
    other = await user(),
    A = data(
      await call(
        "POST",
        "/organizations",
        { name: "Supervisão explícita" },
        owner,
      ),
    ),
    p = "/organizations/" + A.organization.id;
  const B = data(
    await call("POST", p + "/members", { accountId: facilitator.id }, owner),
  ).membership;
  data(await call("POST", p + "/members", { accountId: other.id }, owner));
  const created = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Privada supervisionada",
          circleId: A.rootCircle.id,
          localStart: "2031-05-01T12:00",
          timeZone: "UTC",
          durationMinutes: 60,
          recurrence: { frequency: "ONCE" },
          sections: [{ id: "notes", title: "Notas", kind: "CUSTOM" }],
          participants: [
            {
              memberId: B.id,
              access: "EDIT",
              canManage: true,
              canPublish: true,
              canRestore: true,
            },
          ],
          policy: { notesOnlyNoter: true, windowDays: 7 },
        },
        owner,
      ),
    ),
    mid = created.occurrenceIds[0],
    route = p + "/meetings/" + mid;
  let d = data(await call("POST", route + "/actions/start", {}, owner, 1));
  d = data(
    await call("POST", route + "/actions/close", {}, owner, d.meeting.version),
  );
  const rid = d.report.id;
  data(
    await call(
      "POST",
      route + "/actions/participants/remove",
      { memberId: A.membership.id },
      facilitator,
      d.meeting.version,
    ),
  );
  const resource = (kind: string, action: string, u: User, intent = false) =>
    call(
      "GET",
      p +
        `/test-privacy/${kind}/${action}?id=${kind === "report" ? rid : mid}${intent ? "&includePrivate=true" : ""}`,
      undefined,
      u,
    );
  assert.equal((await call("GET", route, undefined, owner)).statusCode, 404);
  assert.equal(data(await resource("meeting", "read", owner)).allowed, false);
  let settings = data(
    await call("GET", p + "/administration/settings", undefined, owner),
  );
  const configure = async (
    readMeeting: boolean,
    privateOperationalExport: boolean,
  ) => {
    settings = data(
      await call("GET", p + "/administration/settings", undefined, owner),
    );
    settings.settings.oversight = { readMeeting, privateOperationalExport };
    return data(
      await call(
        "PUT",
        p + "/administration/settings",
        { settings: settings.settings, oversightAcknowledged: true },
        owner,
        settings.version,
      ),
    );
  };
  await configure(true, false);
  d = data(await call("GET", route, undefined, owner));
  assert.equal(d.accessMode, "SUPERVISED_READ");
  for (const capability of ["edit", "notes", "manage", "publish", "restore"])
    assert.equal(d.capabilities[capability], false);
  assert.equal(data(await resource("report", "read", owner)).allowed, true);
  assert.ok(
    data(await resource("meeting", "read", owner)).items.some(
      (x: any) => x.id === mid,
    ),
  );
  assert.equal(
    data(await call("GET", p + "/meetings", undefined, owner)).items.length,
    1,
  );
  assert.equal(
    data(await call("GET", p + "/test-privacy/calendar/read", undefined, owner))
      .length,
    0,
  );
  assert.equal((await call("GET", route, undefined, other)).statusCode, 404);
  assert.equal(data(await resource("meeting", "read", other)).items.length, 0);
  assert.equal(
    data(await call("GET", p + "/test-privacy/calendar/read", undefined, other))
      .length,
    0,
  );
  for (const [suffix, body] of [
    ["/report/actions/publish", {}],
    ["/report/actions/restore", { restoreVersion: 1, reason: "Sem grant" }],
    [
      "/actions/notetaker",
      { memberId: A.membership.id, notesOnlyNoter: false },
    ],
  ] as const)
    assert.equal(
      (await call("POST", route + suffix, body, owner, d.report.version))
        .statusCode,
      403,
    );
  const doc = new Y.Doc();
  doc.getText("notes").insert(0, "Não autorizado");
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        {
          sectionId: "notes",
          epoch: 1,
          updateId: randomUUID(),
          update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
        },
        owner,
      )
    ).statusCode,
    403,
  );
  doc.destroy();
  assert.equal(data(await resource("meeting", "export", owner)).allowed, false);
  assert.equal(
    data(await resource("meeting", "export", owner, true)).allowed,
    false,
  );
  await configure(true, true);
  assert.equal(
    data(
      await call(
        "GET",
        p + "/test-privacy/calendar/read?includePrivate=true",
        undefined,
        owner,
      ),
    ).length,
    1,
  );
  assert.equal(data(await resource("meeting", "export", owner)).allowed, false);
  assert.equal(
    data(await resource("meeting", "export", owner, true)).output.records
      .length,
    1,
  );
  assert.equal(
    data(await resource("meeting", "export-private", owner)).allowed,
    true,
  );
  const exportBody = {
    resourceType: "meeting",
    resourceIds: [mid],
    kind: "RESOURCES",
    format: "JSON",
    includePrivate: true,
  };
  assert.equal(
    (
      await call(
        "POST",
        p + "/platform/exports",
        { ...exportBody, includePrivate: false },
        owner,
      )
    ).statusCode,
    403,
  );
  const queued = await call("POST", p + "/platform/exports", exportBody, owner);
  assert.equal(queued.statusCode, 202, queued.body);
  const exportJob = queued.json().data.id;
  await worker.runJob(A.organization.id, A.membership.id);
  const completed = data(
    await call("GET", p + "/platform/jobs/" + exportJob, undefined, owner),
  );
  assert.equal(completed.state, "COMPLETED");
  const downloadPath =
    p + "/platform/artifacts/" + completed.result.artifactId + "/download";
  assert.equal(
    (await call("GET", downloadPath, undefined, owner)).statusCode,
    200,
  );
  await configure(true, false);
  assert.equal(
    (await call("GET", downloadPath, undefined, owner)).statusCode,
    404,
  );
  await configure(true, true);
  let manager = data(await call("GET", route, undefined, facilitator));
  data(
    await call(
      "POST",
      route + "/report/actions/access",
      { memberId: A.membership.id, canRead: false, canEdit: false },
      facilitator,
      manager.report.version,
    ),
  );
  assert.equal((await call("GET", route, undefined, owner)).statusCode, 404);
  assert.equal(data(await resource("report", "read", owner)).allowed, false);
  assert.equal(
    data(await call("GET", p + "/test-privacy/calendar/read", undefined, owner))
      .length,
    0,
  );
  manager = data(await call("GET", route, undefined, facilitator));
  data(
    await call(
      "POST",
      route + "/report/actions/access",
      { memberId: A.membership.id, canRead: true, canEdit: true },
      facilitator,
      manager.report.version,
    ),
  );
  assert.equal(
    data(await call("GET", route, undefined, owner)).capabilities.notes,
    false,
  );
  manager = data(await call("GET", route, undefined, facilitator));
  data(
    await call(
      "POST",
      route + "/actions/participants",
      { participants: [{ memberId: A.membership.id, access: "DENY" }] },
      facilitator,
      manager.meeting.version,
    ),
  );
  assert.equal((await call("GET", route, undefined, owner)).statusCode, 404);
  manager = data(await call("GET", route, undefined, facilitator));
  data(
    await call(
      "POST",
      route + "/actions/participants/remove",
      { memberId: A.membership.id },
      facilitator,
      manager.meeting.version,
    ),
  );
  const ticketKey = randomUUID(),
    ticketBody = { sectionId: "notes", epoch: 1 },
    ticket = data(
      await call(
        "POST",
        route + "/collaboration/tickets",
        ticketBody,
        owner,
        undefined,
        ticketKey,
      ),
    );
  const ws = await app.injectWS("/api/v1" + route + "/collaboration/socket", {
    headers: { cookie: owner.cookie, origin: "http://localhost:5173" },
  });
  let sync: (v: unknown) => void = () => {};
  const ready = new Promise((resolve) => {
    sync = resolve;
  });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "sync") sync(m);
  });
  ws.send(JSON.stringify({ type: "hello", ticket: ticket.ticket }));
  await ready;
  const revoked = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Oversight socket was not revoked")),
      5000,
    );
    ws.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  const pendingKey = randomUUID(),
    pendingExport = await call(
      "POST",
      p + "/platform/exports",
      exportBody,
      owner,
      undefined,
      pendingKey,
    );
  assert.equal(pendingExport.statusCode, 202, pendingExport.body);
  await configure(false, true);
  await revoked;
  assert.equal((await call("GET", route, undefined, owner)).statusCode, 404);
  assert.equal(data(await resource("meeting", "export", owner)).allowed, false);
  assert.equal(
    data(await resource("meeting", "export-private", owner)).allowed,
    true,
  );
  assert.equal(
    (await call("GET", downloadPath, undefined, owner)).statusCode,
    200,
  );
  assert.equal(
    data(
      await call(
        "GET",
        p + "/test-privacy/calendar/read?includePrivate=true",
        undefined,
        owner,
      ),
    ).length,
    1,
  );
  await worker.runJob(A.organization.id, A.membership.id);
  assert.equal(
    data(
      await call(
        "GET",
        p + "/platform/jobs/" + pendingExport.json().data.id,
        undefined,
        owner,
      ),
    ).state,
    "COMPLETED",
  );
  // Explicit denies also override the independent export-only permission (read OFF/export ON).
  manager = data(await call("GET", route, undefined, facilitator));
  data(
    await call(
      "POST",
      route + "/report/actions/access",
      { memberId: A.membership.id, canRead: false, canEdit: false },
      facilitator,
      manager.report.version,
    ),
  );
  assert.equal(
    data(await resource("report", "export-private", owner)).allowed,
    false,
  );
  assert.equal(
    (await call("GET", downloadPath, undefined, owner)).statusCode,
    404,
  );
  assert.equal(
    data(
      await call(
        "GET",
        p + "/test-privacy/calendar/read?includePrivate=true",
        undefined,
        owner,
      ),
    ).length,
    0,
  );
  manager = data(await call("GET", route, undefined, facilitator));
  data(
    await call(
      "POST",
      route + "/report/actions/access",
      { memberId: A.membership.id, canRead: true, canEdit: false },
      facilitator,
      manager.report.version,
    ),
  );
  manager = data(await call("GET", route, undefined, facilitator));
  data(
    await call(
      "POST",
      route + "/actions/participants",
      { participants: [{ memberId: A.membership.id, access: "DENY" }] },
      facilitator,
      manager.meeting.version,
    ),
  );
  assert.equal(
    data(await resource("meeting", "export-private", owner)).allowed,
    false,
  );
  assert.equal(
    (await call("GET", downloadPath, undefined, owner)).statusCode,
    404,
  );
  manager = data(await call("GET", route, undefined, facilitator));
  data(
    await call(
      "POST",
      route + "/actions/participants/remove",
      { memberId: A.membership.id },
      facilitator,
      manager.meeting.version,
    ),
  );
  assert.equal(
    data(await resource("report", "export-private", owner)).allowed,
    true,
  );
  assert.equal((await call("GET", route, undefined, owner)).statusCode, 404);
  const revocationKey = randomUUID(),
    revocationJob = await call(
      "POST",
      p + "/platform/exports",
      exportBody,
      owner,
      undefined,
      revocationKey,
    );
  assert.equal(revocationJob.statusCode, 202, revocationJob.body);
  await configure(false, false);
  assert.equal(
    (
      await call(
        "POST",
        p + "/platform/exports",
        exportBody,
        owner,
        undefined,
        revocationKey,
      )
    ).statusCode,
    403,
  );
  await worker.runJob(A.organization.id, A.membership.id);
  assert.ok(
    workerDiagnostics.some(
      (d) =>
        d.stage === "RESOURCE_AUTHORIZATION" && d.code === "RESOURCE_NOT_FOUND",
    ),
  );
  assert.equal(
    (await call("GET", downloadPath, undefined, owner)).statusCode,
    404,
  );
  assert.equal((await call("GET", route, undefined, owner)).statusCode, 404);
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/tickets",
        ticketBody,
        owner,
        undefined,
        ticketKey,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    data(await resource("meeting", "export", owner, true)).allowed,
    false,
  );
  assert.equal(data(await resource("report", "read", owner)).items.length, 0);
  assert.equal(
    data(await call("GET", p + "/test-privacy/calendar/read", undefined, owner))
      .length,
    0,
  );
  assert.equal(
    data(await call("GET", route, undefined, facilitator)).documents[0]
      .sequence,
    0,
  );
});

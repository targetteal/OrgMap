import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import {
  createOrgMapIntegration,
  createPlatformWorker,
} from "../../server/integration/index.js";
if (
  !/^\/orgmap_(?:(?:meetings_)?test_[a-f0-9]+|integration_[a-f0-9]{32})$/.test(
    new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname,
  )
)
  throw Error("Exclusive disposable DB required");
const rootBlobs = await mkdtemp(join(tmpdir(), "orgmap-meetings-root-"));
const app = await buildApp(
  [createOrgMapIntegration({ blobsDirectory: rootBlobs })],
  {
    migrationMaxPrefix: 999,
  },
);
after(async () => {
  await app.close();
  await pool.end();
  await rm(rootBlobs, { recursive: true, force: true });
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  payload: any = undefined,
  u?: User,
  version?: number,
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
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
      password: "integration-test-password-123",
      displayName: "Pessoa integrada",
    }),
    d = data(r);
  return {
    id: d.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
test("composition: real roster/member port, authorized linked subcircle items and platform search", async () => {
  const a = await user(),
    b = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Aurora integrada" }, a),
    ),
    p = "/organizations/" + A.organization.id;
  const member = data(
    await call("POST", p + "/members", { accountId: b.id }, a),
  ).membership;
  data(
    await call(
      "POST",
      p + `/circles/${A.rootCircle.id}/memberships`,
      { memberId: member.id },
      a,
    ),
  );
  data(
    await call(
      "POST",
      p + `/circles/${A.rootCircle.id}/memberships`,
      { memberId: A.membership.id },
      a,
    ),
  );
  const child = data(
    await call(
      "POST",
      p + "/circles",
      {
        parentCircleId: A.rootCircle.id,
        name: "Subcírculo integrado",
        mode: "DIRECT",
      },
      a,
    ),
  ).circle;
  const rootPublic = data(
    await call(
      "POST",
      p + "/work/projects",
      {
        title: "Projeto público raiz",
        circleId: A.rootCircle.id,
        visibility: "PUBLIC",
      },
      a,
    ),
  ).project;
  const childPublic = data(
    await call(
      "POST",
      p + "/work/projects",
      {
        title: "Projeto público filho",
        circleId: child.id,
        visibility: "PUBLIC",
      },
      a,
    ),
  ).project;
  const privateProject = data(
    await call(
      "POST",
      p + "/work/projects",
      { title: "Segredo privado", circleId: child.id, visibility: "PRIVATE" },
      a,
    ),
  ).project;
  const payload = {
    title: "Reunião integrada Aurora",
    circleId: A.rootCircle.id,
    localStart: "2030-03-01T12:00",
    timeZone: "UTC",
    durationMinutes: 60,
    recurrence: { frequency: "ONCE" },
    sections: [
      { id: "projects", title: "Projetos", kind: "PROJECTS" },
      { id: "agenda", title: "Agenda", kind: "AGENDA" },
    ],
    roster: { includeSubcircles: true, roleIds: [] },
    policy: {},
  };
  const created = data(await call("POST", p + "/meeting-series", payload, a)),
    mid = created.occurrenceIds[0],
    route = p + "/meetings/" + mid;
  const read = data(await call("GET", route, undefined, b));
  const rosterMember = read.participants.find(
    (x: any) => x.memberId === member.id,
  );
  assert.equal(rosterMember.participationRole, "OPTIONAL");
  assert.equal(rosterMember.access, "READ");
  assert.equal(
    (
      await call(
        "POST",
        route + "/agenda",
        { title: "Sem grant" },
        b,
        read.meeting.version,
      )
    ).statusCode,
    403,
  );
  const own = data(await call("GET", route, undefined, a));
  assert.equal(own.capabilities.manage, true);
  assert.equal(
    own.participants.filter((x: any) => x.memberId === A.membership.id).length,
    1,
  );
  const local = data(
    await call(
      "GET",
      route + "/linked-items?includeSubcircles=false",
      undefined,
      b,
    ),
  );
  assert.ok(local.items.some((x: any) => x.id === rootPublic.id));
  assert.equal(
    local.items.some((x: any) => x.id === childPublic.id),
    false,
  );
  const umbrella = data(
    await call(
      "GET",
      route + "/linked-items?includeSubcircles=true",
      undefined,
      b,
    ),
  );
  assert.ok(umbrella.items.some((x: any) => x.id === childPublic.id));
  assert.equal(
    umbrella.items.some((x: any) => x.id === privateProject.id),
    false,
  );
  const denied = data(
    await call(
      "POST",
      p + "/meeting-series",
      {
        ...payload,
        title: "Reunião secreta Aurora",
        participants: [{ memberId: member.id, access: "DENY" }],
      },
      a,
    ),
  );
  assert.equal(
    (
      await call(
        "GET",
        p + "/meetings/" + denied.occurrenceIds[0],
        undefined,
        b,
      )
    ).statusCode,
    404,
  );
  const search = data(
    await call(
      "GET",
      p + "/platform/search?q=Aurora&type=meeting",
      undefined,
      b,
    ),
  );
  assert.ok(search.items.some((x: any) => x.id === mid));
  assert.equal(
    search.items.some((x: any) => x.id === denied.occurrenceIds[0]),
    false,
  );
  const agenda = data(
    await call(
      "POST",
      route + "/agenda",
      {
        title: childPublic.title,
        sourceId: childPublic.id,
        includeSubcircles: true,
        presenterId: A.membership.id,
      },
      a,
      own.meeting.version,
    ),
  );
  // This source is selected from a typed, currently authorized linked item.
  assert.equal(agenda.agenda[0].sourceId, childPublic.id);
  const origin = data(await call('GET',route+'/agenda/'+agenda.agenda[0].id+'/origin',undefined,a)).origin;
  assert.equal(origin?.id, childPublic.id);
  assert.equal(origin?.kind, 'PROJECT');
  const contextual = data(await call(
    "POST", route + "/agenda",
    { title: "Assunto com contexto", description: "Premissa e decisão esperada do círculo." },
    a, agenda.meeting.version,
  ));
  const contextualItem = contextual.agenda.find((item: any) => item.title === "Assunto com contexto");
  assert.ok(contextualItem);
  assert.equal(contextualItem.descriptionRich?.doc?.content?.[0]?.content?.[0]?.text,
    "Premissa e decisão esperada do círculo.");
});
test("root composition wires administrative read policy and export intent through its actual adapters/worker", async () => {
  const a = await user(),
    b = await user(),
    c = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Supervisão raiz" }, a),
    ),
    p = "/organizations/" + A.organization.id;
  const B = data(
    await call("POST", p + "/members", { accountId: b.id }, a),
  ).membership;
  data(await call("POST", p + "/members", { accountId: c.id }, a));
  const created = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Privada integrada supervisão",
          circleId: A.rootCircle.id,
          localStart: "2031-06-01T12:00",
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
          policy: {},
        },
        a,
      ),
    ),
    mid = created.occurrenceIds[0],
    route = p + "/meetings/" + mid;
  let detail = data(await call("POST", route + "/actions/start", {}, a, 1));
  detail = data(
    await call("POST", route + "/actions/close", {}, a, detail.meeting.version),
  );
  data(
    await call(
      "POST",
      route + "/actions/participants/remove",
      { memberId: A.membership.id },
      b,
      detail.meeting.version,
    ),
  );
  assert.equal((await call("GET", route, undefined, a)).statusCode, 404);
  async function configure(
    readMeeting: boolean,
    privateOperationalExport: boolean,
    organizationPath = p,
  ) {
    const current = data(
      await call(
        "GET",
        organizationPath + "/administration/settings",
        undefined,
        a,
      ),
    );
    current.settings.oversight = { readMeeting, privateOperationalExport };
    data(
      await call(
        "PUT",
        organizationPath + "/administration/settings",
        { settings: current.settings, oversightAcknowledged: true },
        a,
        current.version,
      ),
    );
  }
  await configure(true, false);
  const supervised = await call("GET", route, undefined, a);
  assert.equal(
    supervised.statusCode,
    200,
    "Root must inject readPolicy into createMeetings: " + supervised.body,
  );
  detail = supervised.json().data;
  assert.equal(detail.accessMode, "SUPERVISED_READ");
  assert.equal(detail.capabilities.edit, false);
  assert.equal(detail.capabilities.restore, false);
  // Same account is Owner in two organizations with different current policies.
  const Other = data(
      await call(
        "POST",
        "/organizations",
        { name: "Outro tenant de supervisão" },
        a,
      ),
    ),
    q = "/organizations/" + Other.organization.id;
  const OtherB = data(
    await call("POST", q + "/members", { accountId: b.id }, a),
  ).membership;
  const second = data(
    await call(
      "POST",
      q + "/meeting-series",
      {
        title: "Privada do outro tenant",
        circleId: Other.rootCircle.id,
        localStart: "2031-07-01T12:00",
        timeZone: "UTC",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "notes", title: "Notas", kind: "CUSTOM" }],
        participants: [
          { memberId: OtherB.id, access: "EDIT", canManage: true },
        ],
        policy: {},
      },
      a,
    ),
  );
  const otherMid = second.occurrenceIds[0],
    otherRoute = q + "/meetings/" + otherMid;
  data(
    await call(
      "POST",
      otherRoute + "/actions/participants/remove",
      { memberId: Other.membership.id },
      b,
      1,
    ),
  );
  assert.equal((await call("GET", otherRoute, undefined, a)).statusCode, 404);
  assert.equal(
    (await call("GET", p + "/meetings/" + otherMid, undefined, a)).statusCode,
    404,
  );
  await configure(true, false, q);
  assert.equal(
    data(await call("GET", otherRoute, undefined, a)).accessMode,
    "SUPERVISED_READ",
  );
  assert.equal(
    (await call("GET", q + "/meetings/" + mid, undefined, a)).statusCode,
    404,
  );
  await configure(false, false, q);
  assert.equal((await call("GET", otherRoute, undefined, a)).statusCode, 404);
  assert.equal((await call("GET", route, undefined, a)).statusCode, 200);
  const calendarRoute = p + "/interoperability/calendar.ics";
  const normalICS = await call("GET", calendarRoute, undefined, b);
  assert.equal(normalICS.statusCode, 200, normalICS.body);
  assert.ok(normalICS.body.includes(mid + "@orgmap"));
  assert.equal(
    (await call("GET", calendarRoute, undefined, a)).body.includes(
      mid + "@orgmap",
    ),
    false,
  );
  assert.equal(
    (await call("GET", calendarRoute + "?includePrivate=true", undefined, a))
      .statusCode,
    403,
    "ICS must propagate explicit export intent and deny when its flag is OFF",
  );
  assert.equal((await call("GET", route, undefined, c)).statusCode, 404);
  assert.ok(
    data(
      await call(
        "GET",
        p + "/platform/search?q=Privada&type=meeting",
        undefined,
        a,
      ),
    ).items.some((r: any) => r.id === mid),
  );
  const body = {
    resourceType: "report",
    resourceIds: [detail.report.id],
    kind: "RESOURCES",
    format: "JSON",
    includePrivate: true,
  };
  assert.equal(
    (await call("POST", p + "/platform/exports", body, a)).statusCode,
    403,
  );
  await configure(true, true);
  const privateICS = await call(
    "GET",
    calendarRoute + "?includePrivate=true",
    undefined,
    a,
  );
  assert.equal(privateICS.statusCode, 200, privateICS.body);
  assert.ok(
    privateICS.body.includes(mid + "@orgmap"),
    "ICS endpoint must pass includePrivate to the owning calendar port",
  );
  assert.equal(
    (await call("GET", calendarRoute + "?includePrivate=true", undefined, c))
      .statusCode,
    403,
  );
  const queued = await call("POST", p + "/platform/exports", body, a);
  assert.equal(queued.statusCode, 202, queued.body);
  const worker = await createPlatformWorker({ blobsDirectory: rootBlobs });
  await worker.runJob(A.organization.id, A.membership.id);
  const job = data(
    await call(
      "GET",
      p + "/platform/jobs/" + queued.json().data.id,
      undefined,
      a,
    ),
  );
  assert.equal(
    job.state,
    "COMPLETED",
    "Root availableAdapter must forward export options: " + JSON.stringify(job),
  );
  const artifact =
    p + "/platform/artifacts/" + job.result.artifactId + "/download";
  assert.equal((await call("GET", artifact, undefined, a)).statusCode, 200);
  await configure(false, true);
  assert.equal((await call("GET", route, undefined, a)).statusCode, 404);
  assert.ok(
    (
      await call("GET", calendarRoute + "?includePrivate=true", undefined, a)
    ).body.includes(mid + "@orgmap"),
  );
  assert.equal((await call("GET", artifact, undefined, a)).statusCode, 200);
  await configure(false, false);
  assert.equal(
    (await call("GET", calendarRoute + "?includePrivate=true", undefined, a))
      .statusCode,
    403,
  );
  assert.equal((await call("GET", artifact, undefined, a)).statusCode, 404);
  assert.equal(
    data(
      await call(
        "GET",
        p + "/platform/search?q=Privada&type=report",
        undefined,
        a,
      ),
    ).items.length,
    0,
  );
});

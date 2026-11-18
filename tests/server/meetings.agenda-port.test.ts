import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { fail } from "../../server/src/core.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import { selfOnlyPorts } from "../../server/modules/meetings/service.js";
import { createMeetingAgendaCommandPort } from "../../server/modules/meetings/agenda-port.js";
if (
  !/^\/orgmap_meetings_test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("Disposable DB required");
const disabled = new Set<string>();
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (_app, core) => {
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
        modules: { structure: true, meetings: !disabled.has(ctx.org.id) },
      },
    }));
  },
  createMeetings(selfOnlyPorts),
  async (app, core) => {
    const port = createMeetingAgendaCommandPort(core, selfOnlyPorts);
    // Test-only source adapter. Real Governance owns source ACL/linkage and root wiring.
    app.post(
      "/api/v1/organizations/:organizationId/test-tension-dispatch",
      (r) => {
        const b = r.body as any;
        return core.tenant(
          r,
          {
            mode: "write",
            authorize: async (ctx) => {
              await port.authorize(ctx, b.meetingId);
              return true;
            },
          },
          async (ctx) => {
            const result = await port.addTension(ctx, r, b);
            if (b.rollback) fail(409, "TEST_SOURCE_ROLLBACK");
            return result;
          },
        );
      },
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
async function call(
  method: string,
  path: string,
  body?: any,
  u?: any,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload: body,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": key,
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
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
    password: "agenda-port-test-123",
    displayName: "Pessoa",
  });
  const d = data(r);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
test("destination port: current ACL/module/state before replay, same-transaction rollback and source link", async () => {
  const a = await user(),
    b = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Agenda destino" }, a),
  );
  const B = data(
    await call("POST", "/organizations", { name: "Outra organização" }, b),
  );
  const p = "/organizations/" + A.organization.id;
  const created = data(
    await call(
      "POST",
      p + "/meeting-series",
      {
        title: "Reunião destino",
        circleId: A.rootCircle.id,
        localStart: "2030-01-01T10:00",
        timeZone: "America/Sao_Paulo",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
        participants: [],
        policy: { notesOnlyNoter: false, windowDays: 7 },
      },
      a,
    ),
  );
  const mid = created.occurrenceIds[0],
    initial = data(await call("GET", p + "/meetings/" + mid, undefined, a));
  const input = {
    meetingId: mid,
    expectedMeetingVersion: initial.meeting.version,
    source: {
      kind: "TENSION",
      id: randomUUID(),
      circleId: A.rootCircle.id,
      title: "Tensão sintética",
    },
  };
  const endpoint = p + "/test-tension-dispatch";
  assert.equal(
    (await call("POST", endpoint, { ...input, rollback: true }, a)).statusCode,
    409,
  );
  assert.equal(
    data(await call("GET", p + "/meetings/" + mid, undefined, a)).agenda.length,
    0,
  );
  assert.equal(
    (
      await call(
        "POST",
        endpoint,
        { ...input, source: { ...input.source, circleId: B.rootCircle.id } },
        a,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/organizations/" + B.organization.id + "/test-tension-dispatch",
        input,
        b,
      )
    ).statusCode,
    404,
  );
  const key = randomUUID(),
    result = data(await call("POST", endpoint, input, a, key));
  assert.equal(result.sourceId, input.source.id);
  assert.equal(
    data(await call("POST", endpoint, input, a, key)).agendaId,
    result.agendaId,
  );
  const detail = data(await call("GET", p + "/meetings/" + mid, undefined, a));
  assert.equal(detail.agenda.length, 1);
  // This isolated port fixture has no trusted trace reader; it cannot disclose
  // the source ID merely because the write-side callback received it.
  assert.equal(detail.agenda[0].sourceId, null);
  assert.equal(
    (
      await call(
        "POST",
        endpoint,
        { ...input, expectedMeetingVersion: result.meetingVersion },
        a,
      )
    ).statusCode,
    409,
  );
  disabled.add(A.organization.id);
  assert.equal((await call("POST", endpoint, input, a, key)).statusCode, 403);
  disabled.delete(A.organization.id);
  // Close via owning command; replay must re-check current destination state.
  const closed = await app.inject({
    method: "POST",
    url: "/api/v1" + p + "/meetings/" + mid + "/actions/cancel",
    payload: { scope: "THIS", reason: "Teste" },
    headers: {
      origin: "http://localhost:5173",
      cookie: a.cookie,
      "x-csrf-token": a.csrf,
      "idempotency-key": randomUUID(),
      "if-match": `"${result.meetingVersion}"`,
    },
  });
  data(closed);
  assert.equal((await call("POST", endpoint, input, a, key)).statusCode, 409);
});

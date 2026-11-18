import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import { createMeetingCalendarPort } from "../../server/modules/meetings/calendar-port.js";
import { createInteroperability } from "../../server/modules/interoperability/index.js";
import { localCalendarAdapter } from "../../server/modules/interoperability/local-calendar-adapter.js";
const app = await buildApp([foundationDefaultAdmissionPolicy,
  createMeetings(),
  createInteroperability(
    {},
    {
      secrets: {},
      ports: {
        externalChange: localCalendarAdapter,
        calendar: createMeetingCalendarPort(),
      },
    },
  ),
]);
after(async () => {
  await app.close();
  await pool.end();
});
async function request(
  method: string,
  path: string,
  user?: any,
  payload?: any,
  headers: any = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...headers,
    },
    payload,
  });
}
async function user() {
  const r = await request("POST", "/auth/register", undefined, {
    email: randomUUID() + "@example.test",
    password: "scoped-port-synthetic-123",
    displayName: "Calendar port synthetic",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    id: r.json().data.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: r.json().data.csrfToken,
  };
}
test("composed meeting calendar port exports authorized real meeting to ICS/MCP and hides it from same-tenant nonparticipant", async () => {
  const owner = await user(),
    reader = await user(),
    org = await request("POST", "/organizations", owner, {
      name: "Meeting calendar port",
    });
  assert.equal(org.statusCode, 201, org.body);
  const data = org.json().data,
    p = "/organizations/" + data.organization.id,
    base = p + "/interoperability";
  const member = await request("POST", p + "/members", owner, {
    accountId: reader.id,
  });
  assert.ok([200, 201].includes(member.statusCode), member.body);
  const series = await request("POST", p + "/meeting-series", owner, {
    title: "Reunião reservada do participante",
    circleId: data.rootCircle.id,
    localStart: "2030-10-20T13:00",
    timeZone: "UTC",
    durationMinutes: 60,
    recurrence: { frequency: "WEEKLY", count: 1 },
    sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
    policy: {},
  });
  assert.equal(series.statusCode, 201, series.body);
  const meetingId = series.json().data.occurrenceIds[0];
  const allowed = await request("GET", base + "/calendar.ics", owner);
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.match(allowed.body, /Reunião reservada/);
  assert.ok(allowed.body.includes("UID:" + meetingId + "@orgmap"));
  const hidden = await request("GET", base + "/calendar.ics", reader);
  assert.equal(hidden.statusCode, 200, hidden.body);
  assert.ok(!hidden.body.includes(meetingId));
  assert.ok(!hidden.body.includes("Reunião reservada"));
  const status = await request("GET", base, owner);
  assert.deepEqual(status.json().data.missingPorts, []);
  const key = await request("POST", base + "/credentials", owner, {
    label: "Meeting MCP",
    kind: "API",
    scopes: ["interop.read", "calendar.read"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(key.statusCode, 200, key.body);
  const exported = await request(
    "POST",
    base + "/mcp",
    undefined,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "orgmap_calendar_export", arguments: {} },
    },
    {
      authorization: "Bearer " + key.json().data.secret,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
  );
  assert.equal(exported.statusCode, 200, exported.body);
  assert.match(exported.json().result.content[0].text, /Reunião reservada/);
});

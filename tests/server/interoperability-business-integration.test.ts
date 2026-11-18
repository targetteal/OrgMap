import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createOrgMapIntegration } from "../../server/integration/index.js";
const directory = await mkdtemp(join(tmpdir(), "orgmap-interop-business-"));
const app = await buildApp(
  [createOrgMapIntegration({ blobsDirectory: directory })],
  { migrationMaxPrefix: 999 },
);
after(async () => {
  await app.close();
  await pool.end();
  await rm(directory, { recursive: true, force: true });
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
    password: "integrated-agent-test-123",
    displayName: "Integrated agent synthetic",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    id: r.json().data.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: r.json().data.csrfToken,
  };
}
test("composed named agent commands evolve work/goals/governance/meetings through real services and preserve private work ACL", async () => {
  const owner = await user(),
    reader = await user(),
    org = await request("POST", "/organizations", owner, {
      name: "Integrated agent synthetic",
    });
  assert.equal(org.statusCode, 201, org.body);
  const data = org.json().data,
    p = "/organizations/" + data.organization.id,
    base = p + "/interoperability";
  const currentSettings = await request("GET", p + "/administration/settings", owner);
  assert.equal(currentSettings.statusCode, 200, currentSettings.body);
  const initialModuleSettings = currentSettings.json().data;
  initialModuleSettings.settings.modules.goals = true;
  const enabledGoals = await request("PUT", p + "/administration/settings", owner,
    { settings: initialModuleSettings.settings }, { "if-match": '"' + initialModuleSettings.version + '"' });
  assert.equal(enabledGoals.statusCode, 200, enabledGoals.body);
  const scopes = [
    "interop.read",
    "work.read",
    "work.project.create",
    "work.task.create",
    "work.task.update",
    "goals.read",
    "goals.period.create",
    "goals.create",
    "goals.progress.record",
    "goals.progress.configure",
    "governance.read",
    "governance.tension.create",
    "governance.tension.close",
    "meetings.read",
    "meetings.schedule",
    "meetings.start",
    "meetings.close",
  ];
  const issued = await request("POST", base + "/credentials", owner, {
    label: "Integrated business agent",
    kind: "API",
    scopes,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(issued.statusCode, 200, issued.body);
  const headers = {
    authorization: "Bearer " + issued.json().data.secret,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  async function tool(name: string, args: unknown, h = headers) {
    const r = await request(
      "POST",
      base + "/mcp",
      undefined,
      {
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      },
      h,
    );
    assert.equal(r.statusCode, 200, r.body);
    const result = r.json().result;
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text).data;
  }
  const projectArguments = {
    title: "Private agent project",
    visibility: "PRIVATE",
    circleId: data.rootCircle.id,
    idempotencyKey: randomUUID(),
  };
  const project = await tool("orgmap_project_create", projectArguments);
  const task = await tool("orgmap_task_create", {
    title: "Agent task",
    projectId: project.project.id,
    idempotencyKey: randomUUID(),
  });
  const updated = await tool("orgmap_task_update", {
    taskId: task.task.id,
    title: "Changed by MCP",
    version: task.task.version,
  });
  assert.equal(updated.task.title, "Changed by MCP");
  const periods = await tool("orgmap_goal_period_create", {
    title: "Agent period",
    startsOn: "2030-01-01",
    endsOn: "2030-12-31",
    idempotencyKey: randomUUID(),
  });
  const createdGoal = await tool("orgmap_goal_create", {
    title: "Agent goal",
    ownerType: "CIRCLE",
    ownerId: data.rootCircle.id,
    periodIds: [periods.id],
    idempotencyKey: randomUUID(),
  });
  const manual = await tool("orgmap_goal_progress_configure", {
    goalId: createdGoal.id,
    version: createdGoal.version,
    idempotencyKey: randomUUID(),
    source: "MANUAL",
    manualProgress: "0",
    krWeight: "100",
    childWeight: "0",
    keyResults: [],
    children: [],
  });
  const progress = await tool("orgmap_goal_progress_record", {
    goalId: createdGoal.id,
    version: manual.version,
    idempotencyKey: randomUUID(),
    value: "25",
    comment: "Recorded by scoped agent",
  });
  assert.equal(progress.manualProgress, "25");
  assert.equal(progress.progress.display, 25);
  assert.ok(
    JSON.stringify(await tool("orgmap_goals_list", {})).includes("Agent goal"),
  );
  const tension = await tool("orgmap_tension_create", {
    title: "Agent tension",
    circleId: data.rootCircle.id,
    idempotencyKey: randomUUID(),
  });
  assert.ok(tension.id);
  assert.ok(
    JSON.stringify(await tool("orgmap_tensions_list", {})).includes(
      "Agent tension",
    ),
  );
  const meeting = await tool("orgmap_meeting_schedule", {
    title: "Agent meeting",
    circleId: data.rootCircle.id,
    localStart: "2030-10-20T13:00",
    timeZone: "UTC",
    durationMinutes: 60,
    frequency: "WEEKLY",
    count: 1,
    idempotencyKey: randomUUID(),
  });
  const detail = await tool("orgmap_meeting_get", {
    meetingId: meeting.occurrenceIds[0],
  });
  await tool("orgmap_meeting_start", {
    meetingId: detail.meeting.id,
    version: detail.meeting.version,
    idempotencyKey: randomUUID(),
  });
  const added = await request("POST", p + "/members", owner, {
    accountId: reader.id,
  });
  assert.ok([200, 201].includes(added.statusCode), added.body);
  const readKey = await request("POST", base + "/credentials", reader, {
    label: "Limited reader",
    kind: "API",
    scopes: ["interop.read", "work.read", "structure.create", "structure.read"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(readKey.statusCode, 200, readKey.body);
  const denied = await request(
    "GET",
    p + "/work/projects/" + project.project.id,
    undefined,
    undefined,
    { authorization: "Bearer " + readKey.json().data.secret },
  );
  assert.equal(denied.statusCode, 404, denied.body);
  assert.ok(!denied.body.includes("Private agent project"));
  const deniedWrite = await request(
    "POST",
    p + "/circles",
    undefined,
    { parentCircleId: data.rootCircle.id, name: "No grant", mode: "DIRECT" },
    { authorization: "Bearer " + readKey.json().data.secret },
  );
  assert.equal(deniedWrite.statusCode, 403, deniedWrite.body);
  const settings = await request("GET", p + "/administration/settings", owner);
  assert.equal(settings.statusCode, 200, settings.body);
  const current = settings.json().data;
  const disabled = await request(
    "PUT",
    p + "/administration/settings",
    owner,
    {
      settings: {
        ...current.settings,
        modules: { ...current.settings.modules, work: false },
      },
    },
    { "if-match": `"${current.version}"` },
  );
  assert.equal(disabled.statusCode, 200, disabled.body);
  const unavailable = await request(
    "GET",
    p + "/work/projects",
    undefined,
    undefined,
    headers,
  );
  assert.equal(unavailable.statusCode, 403, unavailable.body);
  assert.equal(unavailable.json().error.code, "MODULE_DISABLED");
  const replayDisabled = await request(
    "POST",
    base + "/mcp",
    undefined,
    {
      jsonrpc: "2.0",
      id: "disabled-replay",
      method: "tools/call",
      params: { name: "orgmap_project_create", arguments: projectArguments },
    },
    headers,
  );
  assert.equal(replayDisabled.statusCode, 200, replayDisabled.body);
  assert.equal(replayDisabled.json().result.isError, true);
  assert.equal(
    JSON.parse(replayDisabled.json().result.content[0].text).error.code,
    "MODULE_DISABLED",
  );
});

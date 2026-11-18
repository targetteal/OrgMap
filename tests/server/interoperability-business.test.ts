import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { interoperability } from "../../server/modules/interoperability/index.js";
const app = await buildApp([foundationDefaultAdmissionPolicy,interoperability]);
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
async function fixture() {
  const registered = await request("POST", "/auth/register", undefined, {
    email: randomUUID() + "@example.test",
    password: "business-command-test-123",
    displayName: "Agent business synthetic",
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const u = {
    cookie: registered.cookies[0].name + "=" + registered.cookies[0].value,
    csrf: registered.json().data.csrfToken,
  };
  const created = await request("POST", "/organizations", u, {
    name: "Agent business synthetic",
  });
  assert.equal(created.statusCode, 201, created.body);
  return { u, ...created.json().data };
}
async function issue(a: any, scopes: string[]) {
  const r = await request(
    "POST",
    "/organizations/" + a.organization.id + "/interoperability/credentials",
    a.u,
    {
      label: "Scoped business agent",
      kind: "API",
      scopes,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json().data;
}
test("MCP named structure commands and direct business bearer preserve closed schema, real persistence, IDOR, versions, idempotency and revocation", async () => {
  const a = await fixture(),
    b = await fixture(),
    p = "/organizations/" + a.organization.id,
    base = p + "/interoperability";
  const credential = await issue(a, [
    "interop.read",
    "structure.read",
    "structure.create",
    "structure.update",
    "structure.move",
    "structure.archive",
  ]);
  const headers = {
    authorization: "Bearer " + credential.secret,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  async function tool(name: string, args: unknown) {
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
      headers,
    );
    assert.equal(r.statusCode, 200, r.body);
    return r.json().result;
  }
  const listing = await request(
    "POST",
    base + "/mcp",
    undefined,
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    headers,
  );
  assert.equal(listing.statusCode, 200, listing.body);
  const tools = listing.json().result.tools;
  assert.ok(
    tools.some(
      (t: any) =>
        t.name === "orgmap_circle_create" &&
        t.inputSchema.additionalProperties === false,
    ),
  );
  const command = {
    parentCircleId: a.rootCircle.id,
    name: "Agent circle",
    idempotencyKey: randomUUID(),
  };
  const created = await tool("orgmap_circle_create", command);
  assert.ok(!created.isError, JSON.stringify(created));
  const circle = JSON.parse(created.content[0].text).data.circle;
  const replay = await tool("orgmap_circle_create", command);
  assert.equal(JSON.parse(replay.content[0].text).data.circle.id, circle.id);
  const conflict = await tool("orgmap_circle_create", {
    ...command,
    name: "Changed request",
  });
  assert.equal(conflict.isError, true);
  assert.equal(
    JSON.parse(conflict.content[0].text).error.code,
    "IDEMPOTENCY_CONFLICT",
  );
  const closed = await tool("orgmap_circle_create", {
    ...command,
    idempotencyKey: randomUUID(),
    sql: "SELECT * FROM accounts",
  });
  assert.equal(closed.isError, true);
  assert.equal(
    JSON.parse(closed.content[0].text).error.code,
    "INVALID_COMMAND_ARGUMENTS",
  );
  const idor = await tool("orgmap_circle_create", {
    ...command,
    parentCircleId: b.rootCircle.id,
    idempotencyKey: randomUUID(),
  });
  assert.equal(idor.isError, true);
  assert.equal(
    JSON.parse(idor.content[0].text).error.code,
    "RESOURCE_NOT_FOUND",
  );
  const updated = await tool("orgmap_circle_update", {
    entityId: circle.id,
    name: "Updated by agent",
    version: 1,
  });
  assert.ok(!updated.isError, JSON.stringify(updated));
  assert.equal(JSON.parse(updated.content[0].text).data.entity.version, 2);
  const stale = await tool("orgmap_circle_update", {
    entityId: circle.id,
    name: "Stale overwrite",
    version: 1,
  });
  assert.equal(stale.isError, true);
  assert.equal(
    JSON.parse(stale.content[0].text).error.code,
    "VERSION_CONFLICT",
  );
  const direct = await request(
    "GET",
    p + "/structure",
    undefined,
    undefined,
    headers,
  );
  assert.equal(direct.statusCode, 200, direct.body);
  assert.ok(
    direct
      .json()
      .data.circles.some(
        (x: any) => x.id === circle.id && x.name === "Updated by agent",
      ),
  );
  const deniedTenant = await request(
    "GET",
    "/organizations/" + b.organization.id + "/structure",
    undefined,
    undefined,
    headers,
  );
  assert.equal(deniedTenant.statusCode, 401, deniedTenant.body);
  const unknownRoute = await request(
    "GET",
    p + "/audit-events",
    undefined,
    undefined,
    headers,
  );
  assert.equal(unknownRoute.statusCode, 401, unknownRoute.body);
  const limited = await issue(a, ["interop.read", "structure.read"]);
  const rawDenied = await request(
    "POST",
    p + "/circles",
    undefined,
    { parentCircleId: a.rootCircle.id, name: "Forbidden", mode: "DIRECT" },
    { authorization: "Bearer " + limited.secret },
  );
  assert.equal(rawDenied.statusCode, 401, rawDenied.body);
  const revoke = await request(
    "POST",
    base + "/credentials/" + credential.credential.id + "/revoke",
    a.u,
    {},
    { "if-match": '"1"' },
  );
  assert.equal(revoke.statusCode, 200, revoke.body);
  assert.equal(
    (await request("GET", p + "/structure", undefined, undefined, headers))
      .statusCode,
    401,
  );
  const revokedMcp = await request(
    "POST",
    base + "/mcp",
    undefined,
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "orgmap_structure_list", arguments: {} },
    },
    headers,
  );
  assert.equal(revokedMcp.statusCode, 401, revokedMcp.body);
});

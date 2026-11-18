import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { lockAndCheckOrganizationAuthContinuity } from "../../server/src/organization-lifecycle.js";
import { createLifecycleAuthMethodsPort } from "../../server/modules/interoperability/lifecycle.js";
import { createInteroperability } from "../../server/modules/interoperability/index.js";
import { type FederationConfiguration } from "../../server/modules/interoperability/federation.js";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { pkceChallenge, validateOidcConfiguration } from "../../server/modules/interoperability/oidc.js";
import { signWebhook } from "../../server/modules/interoperability/webhook.js";
import { localCalendarAdapter } from "../../server/modules/interoperability/local-calendar-adapter.js";
import { type DeliveryConfigurations } from "../../server/modules/interoperability/delivery.js";
import { verifyWebhook } from "../../server/modules/interoperability/webhook.js";
import { calendar } from "../../server/modules/interoperability/calendar.js";
const federationConfiguration: FederationConfiguration = {};
test("OIDC HTTP exception remains explicit and restricted to loopback hosts", () => {
  const config = {
    issuer: "http://127.0.0.1:1234",
    authorizationEndpoint: "http://127.0.0.1:1234/authorize",
    tokenEndpoint: "http://127.0.0.1:1234/token",
    jwksUri: "http://127.0.0.1:1234/jwks",
    redirectUri: "http://interoperability.localhost:5197/callback",
    clientId: "synthetic",
    allowLocalHttp: true,
  };
  assert.doesNotThrow(() => validateOidcConfiguration(config));
  assert.throws(() => validateOidcConfiguration({ ...config, allowLocalHttp: false }));
  assert.throws(() => validateOidcConfiguration({ ...config, redirectUri: "http://localhost.example.test/callback" }));
  assert.throws(() => validateOidcConfiguration({ ...config, tokenEndpoint: "http://provider.example.test/token" }));
});
const webhookSecrets: Record<string, string> = {};
const deliveryConfigurations: DeliveryConfigurations = {};
const app = await buildApp([foundationDefaultAdmissionPolicy,
  createInteroperability(
    federationConfiguration,
    {
      secrets: webhookSecrets,
      ports: { externalChange: localCalendarAdapter },
    },
    {},
    deliveryConfigurations,
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
async function fixture() {
  const r = await request("POST", "/auth/register", undefined, {
    email: randomUUID() + "@example.test",
    password: "test-passphrase-12345",
    displayName: "Interop test",
  });
  assert.equal(r.statusCode, 201, r.body);
  const u = {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: r.json().data.csrfToken,
  };
  const org = await request("POST", "/organizations", u, {
    name: "Interop synthetic",
  });
  assert.equal(org.statusCode, 201, org.body);
  return {
    u,
    accountId: r.json().data.account.id,
    org: org.json().data.organization.id,
  };
}
test("credentials persist digest only, one-time response, isolation, expiry validation and revoke concurrency", async () => {
  const a = await fixture(),
    b = await fixture(),
    path = "/organizations/" + a.org + "/interoperability";
  const payload = {
    label: "Calendar local",
    kind: "CALENDAR",
    scopes: ["calendar.read"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const key = randomUUID();
  const create = await request("POST", path + "/credentials", a.u, payload, {
    "idempotency-key": key,
  });
  assert.equal(create.statusCode, 200, create.body);
  const data = create.json().data;
  assert.match(data.secret, /^[a-f0-9]{64}$/);
  const replay = await request("POST", path + "/credentials", a.u, payload, {
    "idempotency-key": key,
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().data.secret, undefined);
  assert.equal(replay.json().data.secretUnavailable, true);
  const list = await request("GET", path, a.u);
  assert.equal(list.statusCode, 200);
  assert.ok(!list.body.includes(data.secret));
  assert.ok(!list.body.includes("tokenHash"));
  const bearer = { authorization: "Bearer " + data.secret };
  assert.equal(
    (await request("GET", path + "/calendar.ics", undefined, undefined, bearer))
      .statusCode,
    200,
  );
  assert.equal(
    (await request("GET", path, undefined, undefined, bearer)).statusCode,
    401,
  );
  assert.equal((await request("GET", path, b.u)).statusCode, 404);
  assert.equal(
    (
      await request("POST", path + "/credentials", a.u, {
        ...payload,
        scopes: ["admin"],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("POST", path + "/credentials", a.u, {
        ...payload,
        expiresAt: "2020-01-01T00:00:00Z",
      })
    ).statusCode,
    400,
  );
  await transaction(async (c) => {
    assert.equal(
      (await c.query("SELECT * FROM interop_credentials")).rowCount,
      0,
    );
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      a.org,
    ]);
    const rows = await c.query("SELECT * FROM interop_credentials");
    assert.equal(rows.rowCount, 1);
    assert.notEqual(rows.rows[0].token_hash, data.secret);
    const saved = await c.query(
      "SELECT result FROM command_results WHERE organization_id=$1 AND key=$2",
      [a.org, key],
    );
    assert.ok(!JSON.stringify(saved.rows).includes(data.secret));
  });
  const results = await Promise.all(
    [1, 2].map(() =>
      request(
        "POST",
        path + "/credentials/" + data.credential.id + "/revoke",
        a.u,
        {},
        { "if-match": '"1"' },
      ),
    ),
  );
  assert.deepEqual(results.map((x) => x.statusCode).sort(), [200, 409]);
  assert.equal(
    (await request("GET", path + "/calendar.ics", undefined, undefined, bearer))
      .statusCode,
    401,
  );
});
test("calendar persistent UID sequence/cancellation, no cross tenant read, connection never claims connected", async () => {
  const { u, org } = await fixture(),
    path = "/organizations/" + org + "/interoperability";
  const event = {
    uid: "meeting@example.test",
    sequence: 0,
    summary: "Reunião, ação; teste\nlinha",
    startsAt: "2026-10-20T10:00:00Z",
    endsAt: "2026-10-20T11:00:00Z",
    source: "LOCAL",
    cancelled: false,
  };
  const created = await request("POST", path + "/calendar-events", u, event);
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(
    (await request("POST", path + "/calendar-events", u, event)).statusCode,
    409,
  );
  const updated = await request("POST", path + "/calendar-events", u, {
    ...event,
    sequence: 1,
    cancelled: true,
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().data.event.id, created.json().data.event.id);
  const ics = await request("GET", path + "/calendar.ics", u);
  assert.equal(ics.statusCode, 200, ics.body);
  assert.match(ics.headers["content-type"]!, /text\/calendar/);
  assert.match(ics.body, /SEQUENCE:1\r\n/);
  assert.match(ics.body, /STATUS:CANCELLED/);
  assert.match(ics.body, /SUMMARY:Reunião\\, ação\\; teste\\nlinha/);
  const conn = await request("POST", path + "/connections", u, {
    provider: "GOOGLE",
    label: "Calendar",
  });
  assert.equal(conn.statusCode, 200, conn.body);
  assert.equal(
    conn.json().data.connection.state,
    "EXTERNAL_CONFIGURATION_REQUIRED",
  );
});
test("RFC5545 escaping and UTF8 octet folding", () => {
  const ics = calendar([
    {
      uid: "a",
      sequence: 1,
      summary: "á".repeat(100) + "\nEND:VEVENT",
      starts_at: new Date(),
      ends_at: new Date(Date.now() + 1000),
      cancelled: false,
    },
  ]);
  for (const line of ics.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(ics.match(/^END:VEVENT$/gm)?.length, 1);
});
test("SCIM credentials require a connection and never interpret an Account UUID as enrollment identity", async () => {
  const owner = await fixture(),
    person = await fixture(),
    path = "/organizations/" + owner.org + "/interoperability";
  const missing = await request("POST", path + "/credentials", owner.u, {
    label: "Unbound provisioning",
    kind: "SCIM",
    scopes: ["members.provision"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(missing.statusCode, 400, missing.body);
  const connection = await request("POST", path + "/connections", owner.u, {
    provider: "OIDC",
    label: "Unconfigured IdP",
  });
  assert.equal(connection.statusCode, 200, connection.body);
  const key = await request("POST", path + "/credentials", owner.u, {
    label: "Bound provisioning",
    kind: "SCIM",
    connectionId: connection.json().data.connection.id,
    scopes: ["members.provision"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(key.statusCode, 200, key.body);
  const denied = await request(
    "POST",
    path + "/scim/v2/Users",
    undefined,
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: person.accountId,
      userName: "opaque-user",
      emails: [{ value: "synthetic@example.test", primary: true }],
      active: true,
    },
    { authorization: "Bearer " + key.json().data.secret },
  );
  assert.equal(denied.statusCode, 503, denied.body);
  assert.equal(denied.json().detail, "PROVISIONING_MAPPING_REQUIRED");
  assert.equal(
    (
      await request(
        "GET",
        "/organizations/" + owner.org + "/structure",
        person.u,
      )
    ).statusCode,
    404,
  );
});
test("official MCP HTTP initialize, named tool/schema and revoked credential revalidation", async () => {
  const owner = await fixture(),
    path = "/organizations/" + owner.org + "/interoperability";
  const issued = await request("POST", path + "/credentials", owner.u, {
    label: "MCP",
    kind: "API",
    scopes: ["interop.read"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(issued.statusCode, 200, issued.body);
  const headers = {
    authorization: "Bearer " + issued.json().data.secret,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const init = await request(
    "POST",
    path + "/mcp",
    undefined,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "local-test", version: "1" },
      },
    },
    headers,
  );
  assert.equal(init.statusCode, 200, init.body);
  assert.equal(init.json().result.serverInfo.name, "orgmap-interoperability");
  const tools = await request(
    "POST",
    path + "/mcp",
    undefined,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    headers,
  );
  assert.equal(tools.statusCode, 200, tools.body);
  assert.equal(tools.json().result.tools[0].name, "orgmap_integration_status");
  const call = await request(
    "POST",
    path + "/mcp",
    undefined,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "orgmap_integration_status", arguments: {} },
    },
    headers,
  );
  assert.equal(call.statusCode, 200, call.body);
  assert.deepEqual(JSON.parse(call.json().result.content[0].text), {
    connections: [],
  });
  const missingScope = await request(
    "POST",
    path + "/mcp",
    undefined,
    {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: { name: "orgmap_calendar_export", arguments: {} },
    },
    headers,
  );
  assert.ok(!missingScope.body.includes("BEGIN:VCALENDAR"));
  const calendarKey = await request("POST", path + "/credentials", owner.u, {
    label: "Scoped calendar MCP",
    kind: "API",
    scopes: ["interop.read", "calendar.read"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(calendarKey.statusCode, 200, calendarKey.body);
  const exported = await request(
    "POST",
    path + "/mcp",
    undefined,
    {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: { name: "orgmap_calendar_export", arguments: {} },
    },
    { ...headers, authorization: "Bearer " + calendarKey.json().data.secret },
  );
  assert.equal(exported.statusCode, 200, exported.body);
  assert.match(exported.json().result.content[0].text, /BEGIN:VCALENDAR/);
  await request(
    "POST",
    path + "/credentials/" + issued.json().data.credential.id + "/revoke",
    owner.u,
    {},
    { "if-match": '"1"' },
  );
  assert.equal(
    (
      await request(
        "POST",
        path + "/mcp",
        undefined,
        { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} },
        headers,
      )
    ).statusCode,
    401,
  );
});
test("OIDC real local HTTP token/JWKS roundtrip, PKCE, nonce, explicit link, session issuance and replay denial", async () => {
  const keys = await generateKeyPair("RS256"),
    publicJwk = await exportJWK(keys.publicKey);
  publicJwk.kid = "local-test";
  let issuer = "";
  let linkGate: Promise<void> | null = null, linkEntered: (() => void) | null = null;
  const codes = new Map<
    string,
    { nonce: string; challenge: string; subject: string }
  >();
  const idp = createServer(async (req, res) => {
    try {
      if (req.url === "/jwks") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (req.url === "/token") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const f = new URLSearchParams(raw),
          code = codes.get(f.get("code") ?? "");
        assert.ok(code);
        assert.equal(pkceChallenge(f.get("code_verifier")!), code.challenge);
        assert.equal(f.get("client_id"), "local-client");
        if (linkGate) { const gate = linkGate; linkEntered?.(); await gate; }
        const token = await new SignJWT({ nonce: code.nonce })
          .setProtectedHeader({ alg: "RS256", kid: "local-test" })
          .setIssuer(issuer)
          .setAudience("local-client")
          .setSubject(code.subject)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(keys.privateKey);
        codes.delete(f.get("code")!);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ id_token: token }));
        return;
      }
      res.writeHead(404).end();
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  issuer = "http://127.0.0.1:" + (idp.address() as any).port;
  try {
    const owner = await fixture(),
      path = "/organizations/" + owner.org + "/interoperability";
    const conn = await request("POST", path + "/connections", owner.u, {
      provider: "OIDC",
      label: "Local IdP",
    });
    const cid = conn.json().data.connection.id;
    federationConfiguration[owner.org + ":" + cid] = {
      issuer,
      clientId: "local-client",
      authorizationEndpoint: issuer + "/authorize",
      tokenEndpoint: issuer + "/token",
      jwksUri: issuer + "/jwks",
      redirectUri:
        "http://localhost:3001/api/v1" +
        path +
        "/connections/" +
        cid +
        "/oidc/callback",
      allowLocalHttp: true,
    };
    const prefix = path + "/connections/" + cid + "/oidc";
    async function callback(start: any, code: string, accountCookie?: string, target = prefix) {
      assert.equal(start.statusCode, 200, start.body);
      const url = new URL((start.json().data ?? start.json()).authorizationUrl);
      codes.set(code, {
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
        subject: "stable-subject",
      });
      const browserCookie = start.cookies.find(
        (x: any) => x.name === "orgmap_oidc_flow",
      );
      return request(
        "GET",
        target +
          "/callback?state=" +
          url.searchParams.get("state") +
          "&code=" +
          code,
        undefined,
        undefined,
        { cookie: browserCookie.name + "=" + browserCookie.value + (accountCookie ? "; " + accountCookie : "") },
      );
    }
    const staleEpoch = await request("POST", prefix + "/link", owner.u, {});
    // Persisted Account epoch fixture models A→B→A without accepting the same email string as proof.
    await pool.query("UPDATE accounts SET email_revision=email_revision+2 WHERE id=$1", [owner.accountId]);
    const epochDenied = await callback(staleEpoch, "stale-email-epoch", owner.u.cookie);
    assert.equal(epochDenied.statusCode, 403, epochDenied.body);
    assert.equal(epochDenied.json().error.code, "ACCOUNT_PROOF_STALE");
    const start = await request("POST", prefix + "/link", owner.u, {});
    const linked = await callback(start, "link-code", owner.u.cookie);
    assert.equal(linked.statusCode, 200, linked.body);
    assert.equal(linked.json().data.account.id, owner.accountId);
    assert.ok(linked.cookies.some((x) => x.name === "orgmap_session"));
    const linkedCookie = linked.cookies.find((c:any) => c.name === "orgmap_session")!;
    const linkedUser = { cookie: linkedCookie.name + "=" + linkedCookie.value, csrf: linked.json().data.csrfToken };
    const staleSession = await request("POST", prefix + "/link", linkedUser, {});
    assert.equal((await request("POST", "/auth/logout", linkedUser, {})).statusCode, 200);
    const sessionDenied = await callback(staleSession, "stale-link-session", linkedUser.cookie);
    assert.equal(sessionDenied.statusCode, 403, sessionDenied.body);
    assert.equal(sessionDenied.json().error.code, "ACCOUNT_PROOF_STALE");
    const login = await request("GET", prefix + "/login");
    const loggedIn = await callback(login, "login-code");
    assert.equal(loggedIn.statusCode, 200, loggedIn.body);
    assert.equal(loggedIn.json().data.account.id, owner.accountId);
    const sessionCookie = loggedIn.cookies.find(
      (x) => x.name === "orgmap_session",
    )!;
    const activeUser = {
      cookie: sessionCookie.name + "=" + sessionCookie.value,
      csrf: loggedIn.json().data.csrfToken,
    };
    const pendingDuringIo = await request("POST", prefix + "/link", activeUser, {});
    let releaseLink!: () => void;
    linkGate = new Promise<void>(resolve => { releaseLink = resolve; });
    const providerEntered = new Promise<void>(resolve => { linkEntered = resolve; });
    const pendingCallback = callback(pendingDuringIo, "epoch-changed-during-provider-io", activeUser.cookie);
    await providerEntered;
    try { await pool.query("UPDATE accounts SET email_revision=email_revision+1 WHERE id=$1", [owner.accountId]); }
    finally { linkGate = null; linkEntered = null; releaseLink(); }
    const afterIoDenied = await pendingCallback;
    assert.equal(afterIoDenied.statusCode, 403, afterIoDenied.body);
    assert.equal(afterIoDenied.json().error.code, "ACCOUNT_PROOF_STALE");
    const account = await request("GET", "/account", activeUser);
    assert.equal(account.statusCode, 200, account.body);
    assert.ok(
      account
        .json()
        .data.authMethods.some(
          (method: any) => method.kind === "OIDC" && method.enabled,
        ),
    );
    const disabled = await request(
      "POST",
      "/auth/password/disable",
      activeUser,
      { currentPassword: "test-passphrase-12345" },
      { "if-match": `"${account.json().data.account.version}"` },
    );
    assert.equal(disabled.statusCode, 200, disabled.body);
    const revokeLast = await request(
      "POST",
      path + "/connections/" + cid + "/revoke",
      activeUser,
      {},
      { "if-match": '"1"' },
    );
    assert.equal(revokeLast.statusCode, 422, revokeLast.body);
    assert.equal(revokeLast.json().error.code, "LAST_LOGIN_METHOD_PROTECTED");
    // Real identity from the signed local OIDC flow, not a synthetic port result.
    const lifecyclePort = createLifecycleAuthMethodsPort((org, connection, provider) =>
      provider === "OIDC" && !!federationConfiguration[org + ":" + connection]);
    await assert.rejects(transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [owner.org]);
      await lockAndCheckOrganizationAuthContinuity(c, owner.org, lifecyclePort);
    }), (error: any) => error?.code === "AUTH_CONTINUITY_REQUIRED");
    // A second actual signed OIDC link makes A independently recoverable.
    const secondOrg = await request("POST", "/organizations", activeUser, { name: "Second OIDC org" });
    assert.equal(secondOrg.statusCode, 201, secondOrg.body);
    const orgB = secondOrg.json().data.organization.id;
    const pathB = "/organizations/" + orgB + "/interoperability";
    const connB = await request("POST", pathB + "/connections", activeUser, { provider: "OIDC", label: "Other IdP" });
    assert.equal(connB.statusCode, 200, connB.body);
    const cidB = connB.json().data.connection.id;
    federationConfiguration[orgB + ":" + cidB] = {
      ...federationConfiguration[owner.org + ":" + cid],
      redirectUri: "http://localhost:3001/api/v1" + pathB + "/connections/" + cidB + "/oidc/callback",
    };
    const prefixB = pathB + "/connections/" + cidB + "/oidc";
    const startB = await request("POST", prefixB + "/link", activeUser, {});
    const linkedB = await callback(startB, "second-org-link", activeUser.cookie, prefixB);
    assert.equal(linkedB.statusCode, 200, linkedB.body);
    await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [owner.org]);
      assert.equal((await lockAndCheckOrganizationAuthContinuity(c, owner.org, lifecyclePort)).affectedCount, 1);
    });
    const newCookie = linkedB.cookies.find((entry) => entry.name === "orgmap_session")!;
    const linkedBUser = { cookie: newCookie.name + "=" + newCookie.value, csrf: linkedB.json().data.csrfToken };
    const revokeB = await request("POST", pathB + "/connections/" + cidB + "/revoke", linkedBUser, {}, { "if-match": '"1"' });
    assert.equal(revokeB.statusCode, 200, revokeB.body);
    await assert.rejects(transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [owner.org]);
      await lockAndCheckOrganizationAuthContinuity(c, owner.org, lifecyclePort);
    }), (error: any) => error?.code === "AUTH_CONTINUITY_REQUIRED");
    const replay = await callback(login, "replay-code");
    assert.equal(replay.statusCode, 401, replay.body);
    const beforeCut = await request("GET", prefix + "/login");
    assert.equal(beforeCut.statusCode, 200, beforeCut.body);
    const operator = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
    const maintenance = await operator.connect();
    try {
      await maintenance.query("BEGIN");
      await maintenance.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [owner.org]);
      await maintenance.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=fence+1 WHERE organization_id=$1", [owner.org]);
      await maintenance.query("COMMIT");
    } finally {
      await maintenance.query("ROLLBACK").catch(() => {});
      maintenance.release();
      await operator.end();
    }
    assert.equal((await request("GET", prefix + "/login")).statusCode, 404);
    assert.equal((await callback(beforeCut, "closed-flow")).statusCode, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      idp.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
test("signed webhook exact bytes, durable dedup, rollback on apply failure, origin loop and revoked connection", async () => {
  const owner = await fixture(),
    path = "/organizations/" + owner.org + "/interoperability";
  const conn = await request("POST", path + "/connections", owner.u, {
      provider: "LOCAL",
      label: "Local signed calendar",
    }),
    cid = conn.json().data.connection.id;
  webhookSecrets[owner.org + ":" + cid] = "synthetic-webhook-signing-secret";
  const key = await request("POST", path + "/credentials", owner.u, {
    label: "Inbound webhook",
    kind: "API",
    scopes: ["webhooks.receive"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(key.statusCode, 200, key.body);
  const timestamp = Math.floor(Date.now() / 1000),
    payload = {
      command: "calendar.upsert",
      origin: "local-idp",
      data: {
        uid: "signed@example.test",
        sequence: 0,
        summary: "Signed event",
        startsAt: "2026-10-20T10:00:00Z",
        endsAt: "2026-10-20T11:00:00Z",
        cancelled: false,
      },
    };
  async function send(eventId: string, data: any, signature?: string) {
    const bytes = Buffer.from(JSON.stringify(data));
    return request(
      "POST",
      path + "/connections/" + cid + "/webhook",
      undefined,
      bytes,
      {
        authorization: "Bearer " + key.json().data.secret,
        "content-type": "application/vnd.orgmap.webhook+json",
        "x-orgmap-event-id": eventId,
        "x-orgmap-timestamp": String(timestamp),
        "x-orgmap-signature":
          signature ??
          signWebhook(
            webhookSecrets[owner.org + ":" + cid],
            eventId,
            timestamp,
            bytes,
          ),
      },
    );
  }
  const first = await send("event1", payload);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().data.duplicate, false);
  const replay = await send("event1", payload);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().data.duplicate, true);
  assert.equal(
    (
      await send("event1", {
        ...payload,
        data: { ...payload.data, summary: "changed" },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await send("bad-signature", payload, "0".repeat(64))).statusCode,
    401,
  );
  assert.equal(
    (await send("loop", { ...payload, origin: "orgmap" })).statusCode,
    400,
  );
  const failed = await send("retryable", {
    ...payload,
    data: {
      ...payload.data,
      uid: "next@example.test",
      endsAt: "2020-01-01T00:00:00Z",
    },
  });
  assert.equal(failed.statusCode, 400, failed.body);
  const corrected = await send("retryable", {
    ...payload,
    data: { ...payload.data, uid: "next@example.test" },
  });
  assert.equal(corrected.statusCode, 200, corrected.body);
  await request(
    "POST",
    path + "/connections/" + cid + "/revoke",
    owner.u,
    {},
    { "if-match": '"1"' },
  );
  assert.equal(
    (
      await send("after-revoke", {
        ...payload,
        data: { ...payload.data, sequence: 1 },
      })
    ).statusCode,
    404,
  );
});
test("durable outbound delivery confirms only remote success, retries with same signed event and revocation blocks pending send", async () => {
  let attempts = 0;
  const received = new Set<string>(),
    signingSecret = "outbound-local-synthetic-secret";
  const receiver = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks),
        eventId = String(req.headers["x-orgmap-event-id"]);
      verifyWebhook(
        signingSecret,
        eventId,
        Number(req.headers["x-orgmap-timestamp"]),
        bytes,
        String(req.headers["x-orgmap-signature"]),
      );
      const event = JSON.parse(bytes.toString());
      assert.equal(event.command, "calendar.upsert");
      attempts++;
      if (attempts === 1) {
        res.writeHead(503).end();
        return;
      }
      received.add(eventId);
      res.writeHead(204).end();
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  try {
    const owner = await fixture(),
      path = "/organizations/" + owner.org + "/interoperability";
    const conn = await request("POST", path + "/connections", owner.u, {
        provider: "LOCAL",
        label: "Outbound signed receiver",
      }),
      cid = conn.json().data.connection.id;
    deliveryConfigurations[owner.org + ":" + cid] = {
      endpoint:
        "http://127.0.0.1:" + (receiver.address() as any).port + "/receiver",
      secret: signingSecret,
      allowLocalHttp: true,
    };
    const event = await request("POST", path + "/calendar-events", owner.u, {
      uid: "outbound@example.test",
      sequence: 0,
      summary: "Outbound synthetic",
      startsAt: "2026-10-20T10:00:00Z",
      endsAt: "2026-10-20T11:00:00Z",
      source: "LOCAL",
      cancelled: false,
    });
    assert.equal(event.statusCode, 200, event.body);
    const queuePath = path + "/connections/" + cid + "/deliveries",
      queued = await request("POST", queuePath, owner.u, {
        calendarEventId: event.json().data.event.id,
      });
    assert.equal(queued.statusCode, 200, queued.body);
    const delivery = queued.json().data.delivery;
    const failed = await request(
      "PUT",
      queuePath + "/" + delivery.id + "/dispatch",
      owner.u,
      {},
      { "if-match": '"1"' },
    );
    assert.equal(failed.statusCode, 200, failed.body);
    assert.equal(failed.json().data.delivery.state, "OUTCOME_UNKNOWN");
    assert.equal(received.size, 0);
    const deniedRetry = await request("PUT", queuePath + "/" + delivery.id + "/dispatch", owner.u, {},
      { "if-match": `"${failed.json().data.delivery.version}"` });
    assert.equal(deniedRetry.statusCode, 409, deniedRetry.body);
    assert.equal(attempts, 1);
    const secondEvent = await request("POST", path + "/calendar-events", owner.u, {
      uid: "outbound@example.test", sequence: 1, summary: "New event", startsAt: "2026-10-20T10:00:00Z",
      endsAt: "2026-10-20T11:00:00Z", source: "LOCAL", cancelled: false,
    });
    assert.equal(secondEvent.statusCode, 200, secondEvent.body);
    const secondQueued = await request("POST", queuePath, owner.u, { calendarEventId: secondEvent.json().data.event.id });
    assert.equal(secondQueued.statusCode, 200, secondQueued.body);
    const secondDelivery = secondQueued.json().data.delivery;
    const success = await request("PUT", queuePath + "/" + secondDelivery.id + "/dispatch", owner.u, {}, { "if-match": '"1"' });
    assert.equal(success.statusCode, 200, success.body);
    assert.equal(success.json().data.delivery.state, "DELIVERED");
    assert.equal(received.size, 1);
    assert.equal(attempts, 2);
    const denyAgain = await request("PUT", queuePath + "/" + secondDelivery.id + "/dispatch", owner.u, {},
      { "if-match": `"${success.json().data.delivery.version}"` });
    assert.equal(denyAgain.statusCode, 409);
    assert.equal(attempts, 2);
    const next = await request("POST", path + "/calendar-events", owner.u, {
      uid: "outbound@example.test",
      sequence: 2,
      summary: "Updated",
      startsAt: "2026-10-20T10:00:00Z",
      endsAt: "2026-10-20T11:00:00Z",
      source: "LOCAL",
      cancelled: false,
    });
    assert.equal(next.statusCode, 200, next.body);
    const pending = await request("POST", queuePath, owner.u, {
      calendarEventId: next.json().data.event.id,
    });
    assert.equal(pending.statusCode, 200, pending.body);
    const revoke = await request(
      "POST",
      path + "/connections/" + cid + "/revoke",
      owner.u,
      {},
      { "if-match": '"1"' },
    );
    assert.equal(revoke.statusCode, 200, revoke.body);
    assert.equal(
      (
        await request(
          "PUT",
          queuePath + "/" + pending.json().data.delivery.id + "/dispatch",
          owner.u,
          {},
          { "if-match": '"1"' },
        )
      ).statusCode,
      404,
    );
    assert.equal(attempts, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      receiver.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

test("offboarding permits suspension of an SSO-only member and preserves their Account and other organization", async () => {
  const owner = await fixture(), target = await fixture();
  const add = await request("POST", `/organizations/${owner.org}/members`, owner.u, { accountId: target.accountId });
  assert.equal(add.statusCode, 201, add.body);
  const member = add.json().data.membership;
  const path = `/organizations/${owner.org}/interoperability`;
  const connection = await request("POST", path + "/connections", owner.u, { provider: "OIDC", label: "A login" });
  assert.equal(connection.statusCode, 200, connection.body);
  const cid = connection.json().data.connection.id;
  federationConfiguration[owner.org + ":" + cid] = { issuer: "https://fixture.invalid" } as any;
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [owner.org]);
    await c.query("INSERT INTO interop_federated_identities(organization_id,id,connection_id,issuer,subject,account_id) VALUES($1,$2,$3,$4,$5,$6)",
      [owner.org, randomUUID(), cid, "https://fixture.invalid", "member-subject", target.accountId]);
    await c.query("UPDATE accounts SET password_enabled=false WHERE id=$1", [target.accountId]);
  });
  const otherPath = `/organizations/${target.org}/interoperability`;
  const otherConn = await request("POST", otherPath + "/connections", target.u, { provider: "OIDC", label: "B login" });
  assert.equal(otherConn.statusCode, 200, otherConn.body);
  const otherId = otherConn.json().data.connection.id;
  federationConfiguration[target.org + ":" + otherId] = { issuer: "https://other.invalid" } as any;
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [target.org]);
    await c.query("INSERT INTO interop_federated_identities(organization_id,id,connection_id,issuer,subject,account_id) VALUES($1,$2,$3,$4,$5,$6)",
      [target.org, randomUUID(), otherId, "https://other.invalid", "other-subject", target.accountId]);
  });
  const port = createLifecycleAuthMethodsPort((org, connection, provider) =>
    provider === "OIDC" && !!federationConfiguration[org + ":" + connection]);
  const preflight = () => transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [target.org]);
    return lockAndCheckOrganizationAuthContinuity(c, target.org, port);
  });
  assert.equal((await preflight()).affectedCount, 1);
  // This fixture proves preservation of global media ownership metadata; it
  // does not claim that a blob was created or read by the media store.
  await pool.query(`INSERT INTO account_media(account_id,kind,version,state,asset_id,storage_namespace,blob_key,sha256,size,mime,width,height)
    VALUES($1,'PHOTO',1,'ACTIVE',$2,'ACCOUNT_ASSETS',$3,$4,1,'image/png',1,1)`,
    [target.accountId, randomUUID(), randomUUID(), "a".repeat(64)]);
  const mediaBefore = (await pool.query("SELECT * FROM account_media WHERE account_id=$1", [target.accountId])).rows;
  const before = (await pool.query("SELECT id,email,password_enabled FROM accounts WHERE id=$1", [target.accountId])).rows[0];
  const result = await request("PATCH", `/organizations/${owner.org}/members/${member.id}`, owner.u,
    { status: "SUSPENDED" }, { "if-match": `"${member.version}"` });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual((await pool.query("SELECT id,email,password_enabled FROM accounts WHERE id=$1", [target.accountId])).rows[0], before);
  assert.deepEqual((await pool.query("SELECT * FROM account_media WHERE account_id=$1", [target.accountId])).rows, mediaBefore);
  assert.equal((await request("GET", `/organizations/${target.org}/structure`, target.u)).statusCode, 200);
  await assert.rejects(preflight(), (error: any) => error?.code === "AUTH_CONTINUITY_REQUIRED");
});

test("cross-organization suspension takes actor and target Account locks in consistent order", async () => {
  const a = await fixture(), b = await fixture();
  const aMember = await request("POST", `/organizations/${a.org}/members`, a.u, { accountId: b.accountId });
  const bMember = await request("POST", `/organizations/${b.org}/members`, b.u, { accountId: a.accountId });
  assert.equal(aMember.statusCode, 201, aMember.body);
  assert.equal(bMember.statusCode, 201, bMember.body);
  const am = aMember.json().data.membership, bm = bMember.json().data.membership;
  const [first, second] = await Promise.all([
    request("PATCH", `/organizations/${a.org}/members/${am.id}`, a.u, { status: "SUSPENDED" }, { "if-match": `"${am.version}"` }),
    request("PATCH", `/organizations/${b.org}/members/${bm.id}`, b.u, { status: "SUSPENDED" }, { "if-match": `"${bm.version}"` }),
  ]);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);
});

test("cutover and offboarding serialize on the target Account in both orders", async () => {
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const make = async () => {
    const offboardingOwner = await fixture(), target = await fixture();
    const added = await request("POST", `/organizations/${offboardingOwner.org}/members`, offboardingOwner.u, { accountId: target.accountId });
    assert.equal(added.statusCode, 201, added.body);
    const member = added.json().data.membership;
    for (const [org, owner] of [[offboardingOwner.org, offboardingOwner.u], [target.org, target.u]] as const) {
      const result = await request("POST", `/organizations/${org}/interoperability/connections`, owner, { provider: "OIDC", label: "Lock test IdP" });
      assert.equal(result.statusCode, 200, result.body);
      const connection = result.json().data.connection.id;
      federationConfiguration[org + ":" + connection] = { issuer: "https://lock-test.invalid" } as any;
      await transaction(async (c) => {
        await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
        await c.query("INSERT INTO interop_federated_identities(organization_id,id,connection_id,issuer,subject,account_id) VALUES($1,$2,$3,$4,$5,$6)",
          [org, randomUUID(), connection, "https://lock-test.invalid", "lock-subject", target.accountId]);
      });
    }
    await admin.query("UPDATE accounts SET password_enabled=false WHERE id=$1", [target.accountId]);
    const port = createLifecycleAuthMethodsPort((org, connection, provider) =>
      provider === "OIDC" && !!federationConfiguration[org + ":" + connection]);
    return { offboardingOwner, target, member, port };
  };
  const waitBlocked = async (pid: number) => {
    for (let n = 0; n < 300; n++) {
      if (Number((await admin.query("SELECT cardinality(pg_blocking_pids($1)) AS n", [pid])).rows[0].n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("transaction did not wait on the Account lock");
  };
  try {
    // Offboarding first: the cut waits, then sees no usable alternative in B.
    const one = await make(), first = await admin.connect(), second = await pool.connect();
    try {
      await first.query("BEGIN");
      await first.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [one.offboardingOwner.org]);
      await first.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [one.target.accountId]);
      await first.query("UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND id=$2", [one.offboardingOwner.org, one.member.id]);
      await second.query("BEGIN");
      await second.query("SELECT set_config('orgmap.organization_id',$1,true)", [one.target.org]);
      const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const check = lockAndCheckOrganizationAuthContinuity(second, one.target.org, one.port)
        .then(() => "accepted", (error) => error?.code);
      await waitBlocked(pid);
      await first.query("COMMIT");
      assert.equal(await check, "AUTH_CONTINUITY_REQUIRED");
    } finally {
      await first.query("ROLLBACK").catch(() => {}); await second.query("ROLLBACK").catch(() => {});
      first.release(); second.release();
    }
    // Cut first: real PATCH waits for Account, then remains allowed after cut.
    const two = await make(), cut = await admin.connect();
    try {
      await cut.query("BEGIN");
      await cut.query("SELECT set_config('orgmap.organization_id',$1,true)", [two.target.org]);
      assert.equal((await lockAndCheckOrganizationAuthContinuity(cut, two.target.org, two.port)).affectedCount, 1);
      const patch = request("PATCH", `/organizations/${two.offboardingOwner.org}/members/${two.member.id}`,
        two.offboardingOwner.u, { status: "SUSPENDED" }, { "if-match": `"${two.member.version}"` });
      let blocked = false;
      for (let n = 0; n < 300; n++) {
        const rows = (await admin.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM accounts WHERE id=ANY%'`)).rows;
        if (rows.length) { await waitBlocked(rows[0].pid); blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(blocked, "offboarding must wait until the cut releases the Account");
      await cut.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=fence+1 WHERE organization_id=$1", [two.target.org]);
      await cut.query("COMMIT");
      const result = await patch;
      assert.equal(result.statusCode, 200, result.body);
    } finally { await cut.query("ROLLBACK").catch(() => {}); cut.release(); }
  } finally { await admin.end(); }
});

test("connection revoke locks affected Accounts before a higher actor Account", async () => {
  const a = await fixture(), b = await fixture();
  const actor = a.accountId > b.accountId ? a : b, target = actor === a ? b : a;
  const added = await request("POST", `/organizations/${actor.org}/members`, actor.u, { accountId: target.accountId });
  assert.equal(added.statusCode, 201, added.body);
  const connection = await request("POST", `/organizations/${actor.org}/interoperability/connections`, actor.u, { provider: "OIDC", label: "Lock-order IdP" });
  assert.equal(connection.statusCode, 200, connection.body);
  const cid = connection.json().data.connection.id;
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [actor.org]);
    await c.query("INSERT INTO interop_federated_identities(organization_id,id,connection_id,issuer,subject,account_id) VALUES($1,$2,$3,$4,$5,$6)",
      [actor.org, randomUUID(), cid, "https://lock-order.invalid", "target", target.accountId]);
  });
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const blocker = await admin.connect(), observer = await admin.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [target.accountId]);
    const pending = request("POST", `/organizations/${actor.org}/interoperability/connections/${cid}/revoke`, actor.u, {}, { "if-match": '"1"' });
    let waiting = false;
    for (let n = 0; n < 300; n++) {
      const rows = (await admin.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM accounts WHERE id=ANY%'`)).rows;
      if (rows.length && Number((await admin.query("SELECT cardinality(pg_blocking_pids($1)) AS n", [rows[0].pid])).rows[0].n) > 0) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "revocation must wait for the lower target Account");
    await observer.query("BEGIN");
    await observer.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE NOWAIT", [actor.accountId]);
    await observer.query("ROLLBACK");
    await blocker.query("COMMIT");
    const result = await pending;
    assert.equal(result.statusCode, 200, result.body);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await observer.query("ROLLBACK").catch(() => {});
    blocker.release(); observer.release(); await admin.end();
  }
});

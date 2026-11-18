import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { deliverLocalInvitations } from "../../server/src/mail.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrustedPrincipal } from "../../server/src/runtime.js";
import { proofToken } from "./mail-fixture.js";
const fixtureRuntime = new URL(
  process.env.DATABASE_URL ?? "postgres://invalid/",
);
const fixtureOperator = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
);
if (
  !/^\/orgmap_test_[a-f0-9]{16,32}$/.test(fixtureRuntime.pathname) ||
  fixtureOperator.pathname !== fixtureRuntime.pathname ||
  fixtureOperator.host !== fixtureRuntime.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(fixtureRuntime.hostname)
)
  throw Error("EXCLUSIVE_FOUNDATION_DATABASE_REQUIRED");
const trusted = new Map<string, TrustedPrincipal>();
const federation = new Map<string, string>();
const assertionTokens = new Map<string, string>(),
  callbackIdentities = new WeakMap<object, string>();
let callbackEffects = 0;
let foundationCore: import("../../server/src/runtime.js").ModuleRuntime;
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    foundationCore = core;
    core.registerPrincipalResolver(async ({ token, c }) => {
      assert.ok(
        (
          await c.query(
            "SELECT current_setting('orgmap.organization_id',true) AS org",
          )
        ).rows[0].org,
      );
      return trusted.get(token) ?? null;
    });
    core.registerFederatedIdentityResolver(async (proof) => {
      if (proof && typeof proof === "object" && callbackIdentities.has(proof)) {
        const accountId = callbackIdentities.get(proof)!;
        callbackIdentities.delete(proof);
        return { accountId };
      }
      return typeof proof === "string" && federation.has(proof)
        ? { accountId: federation.get(proof)! }
        : null;
    });
    core.registerFederatedCallback({
      method: "POST",
      path: "/test/saml-callback",
      allowedOrigins: ["https://idp.local.test"],
      verify: async (req) => {
        const token = (req.body as any)?.assertion;
        const accountId = assertionTokens.get(token);
        if (!accountId) return null;
        assertionTokens.delete(token);
        const proof = {};
        callbackIdentities.set(proof, accountId);
        return proof;
      },
    });
    app.post("/test/saml-callback", async (r, reply) => {
      callbackEffects++;
      return core.issueFederatedSession(
        r,
        reply,
        core.federatedCallbackProof(r),
      );
    });
    app.post("/test/federation", async (r, reply) =>
      core.issueFederatedSession(r, reply, (r.body as any)?.proof),
    );
    app.post("/api/v1/organizations/:organizationId/test-provision", (r) =>
      core.tenant(
        r,
        {
          mode: "authorization_write",
          requiredScopes: ["members:provision"],
          authorize: (ctx) => ctx.member.org_role === "OWNER",
        },
        async (ctx) => ({
          membership: await core.provisionMembership(ctx, r, r.body as any),
        }),
      ),
    );

    app.post("/api/v1/organizations/:organizationId/test-member-command", (r) =>
      core.tenant(
        r,
        { mode: "write", authorize: (ctx) => ctx.member.status === "ACTIVE" },
        async (ctx) => {
          await core.changed(ctx, r, ctx.member.id, "MemberCommand");
          return { ok: true };
        },
      ),
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
const origin = "http://localhost:5173";
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  b: any = undefined,
  u?: User,
  extra: any = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin,
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...extra,
    },
    payload: b,
  });
}
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "a-secure-password-123",
    displayName: "Test person",
  });
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: r.json().data.csrfToken,
    id: r.json().data.account.id,
  };
}
async function org(u: User, name: string) {
  const r = await call("POST", "/organizations", { name }, u);
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return r.json().data;
}
const data = (r: any) => {
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return r.json().data;
};
test("real PostgreSQL foundation: isolation, lifecycle, concurrency and rollback", async () => {
  const a = await user(),
    b = await user();
  const A = await org(a, "Alpha"),
    B = await org(b, "Beta");
  const p = "/organizations/" + A.organization.id,
    q = "/organizations/" + B.organization.id;
  let graph = data(await call("GET", p + "/structure", undefined, a));
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.roles.length, 0);
  assert.notEqual(graph.nodes[0].nodeId, graph.nodes[0].entityId);
  assert.equal(
    (await call("GET", q + "/structure", undefined, a)).statusCode,
    404,
  );
  assert.equal(
    (await call("GET", p + "/structure", undefined, b)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles",
        { circleId: B.rootCircle.id, name: "IDOR", mode: "DIRECT" },
        a,
      )
    ).statusCode,
    404,
  );
  const createKey = randomUUID();
  const payload = {
    parentCircleId: A.rootCircle.id,
    name: "Research",
    mode: "DIRECT",
  };
  const c = data(
    await call("POST", p + "/circles", payload, a, {
      "idempotency-key": createKey,
    }),
  ).circle;
  assert.equal(
    data(
      await call("POST", p + "/circles", payload, a, {
        "idempotency-key": createKey,
      }),
    ).circle.id,
    c.id,
  );
  assert.equal(
    (
      await call("POST", p + "/circles", { ...payload, name: "Changed" }, a, {
        "idempotency-key": createKey,
      })
    ).statusCode,
    409,
  );
  const d = data(
    await call(
      "POST",
      p + "/circles",
      { ...payload, parentCircleId: c.id, name: "Child" },
      a,
    ),
  ).circle;
  assert.equal(
    (
      await call(
        "POST",
        p + "/structure/" + c.id + "/move",
        { targetCircleId: d.id, mode: "DIRECT" },
        a,
        { "if-match": '"1"' },
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/structure/" + A.rootCircle.id + "/move",
        { targetCircleId: c.id, mode: "DIRECT" },
        a,
        { "if-match": '"1"' },
      )
    ).statusCode,
    422,
  );
  const role = data(
    await call(
      "POST",
      p + "/roles",
      { circleId: c.id, name: "Scientist", mode: "DIRECT" },
      a,
    ),
  ).role;
  const results = await Promise.all(
    ["One", "Two"].map((name) =>
      call("PATCH", p + "/roles/" + role.id, { name, mode: "DIRECT" }, a, {
        "if-match": '"1"',
      }),
    ),
  );
  assert.deepEqual(results.map((x) => x.statusCode).sort(), [200, 409]);
  assert.equal(
    (
      await call(
        "PATCH",
        p + "/roles/" + role.id,
        { name: "No version", mode: "DIRECT" },
        a,
      )
    ).statusCode,
    428,
  );
  const member = data(
    await call("POST", p + "/members", { accountId: b.id }, a),
  ).membership;
  assert.equal(
    data(await call("GET", p + "/structure", undefined, b)).roles.length,
    1,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles",
        { circleId: c.id, name: "Denied", mode: "DIRECT" },
        b,
      )
    ).statusCode,
    403,
  );
  const cm = data(
    await call(
      "POST",
      p + "/circles/" + c.id + "/memberships",
      { memberId: member.id },
      a,
    ),
  ).membership;
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles/" + role.id + "/occupancies",
        { memberId: member.id, kind: "INTERIM" },
        a,
      )
    ).statusCode,
    422,
  );
  const occupancy = data(
    await call(
      "POST",
      p + "/roles/" + role.id + "/occupancies",
      {
        memberId: member.id,
        kind: "INTERIM",
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      },
      a,
    ),
  ).occupancy;
  data(
    await call("POST", p + "/occupancies/" + occupancy.id + "/end", {}, a, {
      "if-match": '"1"',
    }),
  );
  graph = data(await call("GET", p + "/structure", undefined, a));
  assert.ok(graph.memberships.some((x: any) => x.id === cm.id));
  assert.ok(graph.occupancies[0].endsAt);
  assert.equal(
    (
      await call(
        "POST",
        p + "/circles/" + c.id + "/memberships",
        { memberId: B.membership.id },
        a,
      )
    ).statusCode,
    404,
  );
  const commandKey = randomUUID();
  data(
    await call("POST", p + "/test-member-command", {}, b, {
      "idempotency-key": commandKey,
    }),
  );
  data(
    await call("POST", p + "/test-member-command", {}, b, {
      "idempotency-key": commandKey,
    }),
  );
  const memberReplay = await call("POST", p + "/test-member-command", {}, b, {
    "idempotency-key": commandKey,
  });
  assert.equal(memberReplay.json().capabilities["member.manage"], false);
  assert.equal(
    (
      await call("POST", p + "/test-member-command", {}, b, {
        "idempotency-key": commandKey,
        "if-match": '"9"',
      })
    ).statusCode,
    409,
  );
  data(
    await call(
      "PATCH",
      p + "/members/" + member.id,
      { status: "SUSPENDED" },
      a,
      { "if-match": '"1"' },
    ),
  );
  assert.equal(
    (await call("GET", p + "/structure", undefined, b)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        p + "/members/" + A.membership.id,
        { status: "SUSPENDED" },
        a,
        { "if-match": '"1"' },
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles",
        { circleId: c.id, name: "No csrf", mode: "DIRECT" },
        a,
        { "x-csrf-token": "bad" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles",
        { circleId: c.id, name: "No origin", mode: "DIRECT" },
        a,
        { origin: "https://evil.invalid" },
      )
    ).statusCode,
    403,
  );
  const events = data(await call("GET", p + "/audit-events", undefined, a));
  assert.ok(events.items.length > 5);
  assert.ok(!JSON.stringify(events).includes("password"));
  const me = data(await call("GET", "/me", undefined, a));
  assert.equal(me.organizations.length, 1);
  assert.equal(me.organizations[0].id, A.organization.id);
  await transaction(async (db) => {
    assert.equal((await db.query("SELECT * FROM entities")).rowCount, 0);
    assert.equal((await db.query("SELECT * FROM members")).rowCount, 0);
    await db.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.organization.id,
    ]);
    assert.equal(
      (
        await db.query("SELECT * FROM entities WHERE organization_id=$1", [
          B.organization.id,
        ])
      ).rowCount,
      0,
    );
    const privilege = (
      await db.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    assert.equal(privilege.rolsuper, false);
    assert.equal(privilege.rolbypassrls, false);
  });
  const before = await transaction(async (db) => {
    await db.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.organization.id,
    ]);
    return Number(
      (await db.query("SELECT count(*) FROM outbox")).rows[0].count,
    );
  });
  await assert.rejects(
    transaction(async (db) => {
      await db.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        A.organization.id,
      ]);
      await db.query("INSERT INTO domain_events VALUES($1,$2,$3,$4,now())", [
        A.organization.id,
        randomUUID(),
        "RollbackTest",
        role.id,
      ]);
      throw Error("abort");
    }),
  );
  await transaction(async (db) => {
    await db.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.organization.id,
    ]);
    assert.equal(
      Number((await db.query("SELECT count(*) FROM outbox")).rows[0].count),
      before,
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM domain_events WHERE action='RollbackTest'",
        )
      ).rowCount,
      0,
    );
  });
  assert.equal(
    (
      await call("POST", p + "/test-member-command", {}, b, {
        "idempotency-key": commandKey,
      })
    ).statusCode,
    404,
  );
  const emoji = data(
    await call(
      "POST",
      p + "/roles",
      { circleId: c.id, name: "🌱".repeat(200), mode: "DIRECT" },
      a,
    ),
  );
  assert.equal([...emoji.role.name].length, 200);
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles",
        { circleId: c.id, name: "🌱".repeat(201), mode: "DIRECT" },
        a,
      )
    ).statusCode,
    400,
  );
  const disposable = data(
    await call(
      "POST",
      p + "/circles",
      { parentCircleId: A.rootCircle.id, name: "Archive me", mode: "DIRECT" },
      a,
    ),
  ).circle;
  data(
    await call("POST", p + "/structure/" + disposable.id + "/archive", {}, a, {
      "if-match": '"1"',
    }),
  );
  assert.equal(
    (await call("GET", p + "/circles/" + disposable.id, undefined, a))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/structure/" + A.rootCircle.id + "/archive",
        {},
        a,
        { "if-match": '"1"' },
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (await call("GET", p + "/circles/" + B.rootCircle.id, undefined, a))
      .statusCode,
    404,
  );
  const invitee = await user();
  const email = data(await call("GET", "/me", undefined, invitee)).account
    .email;
  const invitation = data(await call("POST", p + "/invitations", { email }, a));
  assert.equal(invitation.invitation.status, "PENDING");
  assert.ok(!JSON.stringify(invitation).includes("token"));
  const mailDir = await mkdtemp(join(tmpdir(), "orgmap-mail-"));
  try {
    assert.equal(
      await deliverLocalInvitations(
        A.organization.id,
        mailDir,
        undefined,
        foundationCore.validateInvitationDelivery,
      ),
      1,
    );
    const mail = JSON.parse(
      await readFile(join(mailDir, invitation.deliveryJobId + ".json"), "utf8"),
    );
    assert.equal(mail.to, email);
    assert.equal(
      (await call("POST", "/invitations/accept", { token: mail.token }, b))
        .statusCode,
      404,
    );
    const accepted = data(
      await call("POST", "/invitations/accept", { token: mail.token }, invitee),
    );
    assert.equal(accepted.organizationId, A.organization.id);
    assert.equal(
      data(
        await call(
          "POST",
          "/invitations/accept",
          { token: mail.token },
          invitee,
        ),
      ).membership.id,
      accepted.membership.id,
    );
    assert.equal(
      await deliverLocalInvitations(
        A.organization.id,
        mailDir,
        undefined,
        foundationCore.validateInvitationDelivery,
      ),
      0,
    );
  } finally {
    await rm(mailDir, { recursive: true, force: true });
  }
  const page = data(await call("GET", p + "/members?limit=1", undefined, a));
  assert.equal(page.page.hasMore, true);
  assert.equal(
    data(
      await call(
        "GET",
        p + "/members?limit=1&cursor=" + page.page.nextCursor,
        undefined,
        a,
      ),
    ).items.length,
    1,
  );
  assert.equal(
    (
      await call(
        "GET",
        q + "/members?cursor=" + page.page.nextCursor,
        undefined,
        b,
      )
    ).statusCode,
    400,
  );
  const auditPage = data(
    await call("GET", p + "/audit-events?limit=1", undefined, a),
  );
  assert.ok(auditPage.page.nextCursor);
  const nextAudit = data(
    await call(
      "GET",
      p + "/audit-events?limit=1&cursor=" + auditPage.page.nextCursor,
      undefined,
      a,
    ),
  );
  assert.notEqual(nextAudit.items[0].id, auditPage.items[0].id);
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles",
        { circleId: c.id, name: "Bad", purpose: { x: 1 }, mode: "DIRECT" },
        a,
      )
    ).statusCode,
    400,
  );
  data(await call("POST", "/auth/logout", {}, a));
  assert.equal((await call("GET", "/me", undefined, a)).statusCode, 401);
});

test("password bytes, session rotation and invalid credentials", async () => {
  const email = randomUUID() + "@example.test",
    password = "  preserve password spaces  ";
  const registered = await call("POST", "/auth/register", {
    email,
    password,
    displayName: "Exact password",
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const first = {
    id: registered.json().data.account.id,
    csrf: registered.json().data.csrfToken,
    cookie: registered.cookies[0].name + "=" + registered.cookies[0].value,
  };
  assert.equal(
    (await call("POST", "/auth/login", { email, password: password.trim() }))
      .statusCode,
    401,
  );
  const loggedIn = await call(
    "POST",
    "/auth/login",
    { email, password },
    first,
  );
  assert.equal(loggedIn.statusCode, 200, loggedIn.body);
  assert.notEqual(loggedIn.cookies[0].value, registered.cookies[0].value);
  assert.equal((await call("GET", "/me", undefined, first)).statusCode, 401);
  assert.ok(!loggedIn.body.includes("scrypt"));
  assert.ok(loggedIn.headers["set-cookie"]?.toString().includes("HttpOnly"));
  assert.equal((await call("GET", "/me")).statusCode, 401);
});

test("trusted credential and federation ports reject forged, revoked and cross-tenant identities", async () => {
  const owner = await user(),
    person = await user(),
    A = await org(owner, "Credential Alpha"),
    B = await org(owner, "Credential Beta"),
    p = "/organizations/" + A.organization.id;
  const token = randomUUID(),
    credentialId = randomUUID();
  trusted.set(token, {
    accountId: owner.id,
    organizationId: A.organization.id,
    credentialId,
    scopes: ["orgmap:read", "orgmap:write", "members:provision"],
  });
  const headers = { authorization: "Bearer " + token, origin: "" };
  const created = await call(
    "POST",
    p + "/circles",
    {
      parentCircleId: A.rootCircle.id,
      name: "Machine command",
      mode: "DIRECT",
    },
    undefined,
    headers,
  );
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles",
        { circleId: A.rootCircle.id, name: "Forged", mode: "DIRECT" },
        undefined,
        { authorization: "Bearer invalid", origin: "" },
      )
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/organizations/" + B.organization.id + "/roles",
        { circleId: B.rootCircle.id, name: "Cross", mode: "DIRECT" },
        undefined,
        headers,
      )
    ).statusCode,
    401,
  );
  const key = randomUUID();
  const cmdHeaders = { ...headers, "idempotency-key": key };
  data(
    await call(
      "POST",
      p + "/test-provision",
      { accountId: person.id, status: "ACTIVE" },
      undefined,
      cmdHeaders,
    ),
  );
  trusted.set(token, {
    accountId: owner.id,
    organizationId: A.organization.id,
    credentialId,
    scopes: ["orgmap:read"],
  });
  assert.equal(
    (
      await call(
        "POST",
        p + "/test-provision",
        { accountId: person.id, status: "ACTIVE" },
        undefined,
        cmdHeaders,
      )
    ).statusCode,
    403,
  );
  const read = await call(
    "GET",
    p + "/structure",
    undefined,
    undefined,
    headers,
  );
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().capabilities["member.manage"], false);
  trusted.delete(token);
  assert.equal(
    (await call("GET", p + "/structure", undefined, undefined, headers))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/auth/register",
        {
          email: randomUUID() + "@example.test",
          password: "a-valid-password",
          displayName: "Forged Origin",
        },
        undefined,
        { authorization: "Bearer invalid", origin: "https://evil.invalid" },
      )
    ).statusCode,
    403,
  );
  const proof = randomUUID();
  federation.set(proof, person.id);
  const denied = await app.inject({
    method: "POST",
    url: "/test/federation",
    headers: { origin },
    payload: { proof: "invalid", accountId: owner.id },
  });
  assert.equal(denied.statusCode, 401);
  const session = await app.inject({
    method: "POST",
    url: "/test/federation",
    headers: { origin },
    payload: { proof },
  });
  assert.equal(session.statusCode, 200, session.body);
  assert.equal(session.json().data.account.id, person.id);
  assert.ok(session.headers["set-cookie"]?.toString().includes("HttpOnly"));
  const personMe = data(await call("GET", "/me", undefined, person));
  assert.ok(
    personMe.organizations.some((o: any) => o.id === A.organization.id),
  );
});

test("registered federation callback validates before effects and rejects replay or wrong route/origin", async () => {
  const account = await user(),
    assertion = randomUUID();
  assertionTokens.set(assertion, account.id);
  const before = callbackEffects;
  const send = (path: string, origin: string, body: any) =>
    app.inject({
      method: "POST",
      url: path,
      headers: { origin },
      payload: body,
    });
  assert.equal(
    (
      await send("/test/saml-callback", "https://idp.local.test", {
        assertion: "forged",
      })
    ).statusCode,
    401,
  );
  assert.equal(callbackEffects, before);
  assert.equal(
    (await send("/test/saml-callback", "https://evil.invalid", { assertion }))
      .statusCode,
    403,
  );
  assert.equal(callbackEffects, before);
  assert.equal(
    (await send("/test/federation", "https://idp.local.test", { assertion }))
      .statusCode,
    403,
  );
  assert.equal(callbackEffects, before);
  const valid = await send("/test/saml-callback", "https://idp.local.test", {
    assertion,
  });
  assert.equal(valid.statusCode, 200, valid.body);
  assert.equal(valid.json().data.account.id, account.id);
  assert.equal(callbackEffects, before + 1);
  assert.equal(
    (await send("/test/saml-callback", "https://idp.local.test", { assertion }))
      .statusCode,
    401,
  );
  assert.equal(callbackEffects, before + 1);
});

test("account preferences, reauthentication, sessions and SMTP recovery persist without crossing accounts", async () => {
  const a = await user(),
    b = await user();
  const info = data(await call("GET", "/account", undefined, a));
  assert.equal(info.account.version, 1);
  const profile = data(
    await call("PATCH", "/account", { displayName: "Updated account" }, a, {
      "if-match": '"1"',
    }),
  );
  assert.equal(profile.account.version, 2);
  assert.equal(
    data(await call("GET", "/account", undefined, b)).account.displayName,
    "Test person",
  );
  data(
    await call(
      "PATCH",
      "/account/preferences",
      {
        locale: "en-GB",
        timeZone: "Europe/London",
        dateFormat: "YYYY-MM-DD",
        theme: "dark",
        reducedMotion: true,
      },
      a,
      { "if-match": '"1"' },
    ),
  );
  assert.equal(
    data(await call("GET", "/account/preferences", undefined, a)).preferences
      .theme,
    "dark",
  );
  assert.equal(
    data(await call("GET", "/account/preferences", undefined, b)).preferences
      .theme,
    "system",
  );
  assert.equal(
    (
      await call("PATCH", "/account/preferences", { theme: "pink" }, a, {
        "if-match": '"2"',
      })
    ).statusCode,
    400,
  );
  const changed = await call(
    "POST",
    "/auth/password",
    {
      currentPassword: "a-secure-password-123",
      newPassword: "new-secure-password-456",
    },
    a,
    { "if-match": '"2"' },
  );
  data(changed);
  assert.equal((await call("GET", "/me", undefined, a)).statusCode, 401);
  const current = {
    id: a.id,
    cookie: changed.cookies[0].name + "=" + changed.cookies[0].value,
    csrf: changed.json().data.csrfToken,
  };
  assert.equal(
    (
      await call(
        "POST",
        "/auth/password/disable",
        { currentPassword: "new-secure-password-456" },
        current,
        { "if-match": '"3"' },
      )
    ).statusCode,
    422,
  );
  const email = info.account.email;
  const other = await call("POST", "/auth/login", {
    email,
    password: "new-secure-password-456",
  });
  const second = {
    id: a.id,
    cookie: other.cookies[0].name + "=" + other.cookies[0].value,
    csrf: other.json().data.csrfToken,
  };
  const sessions = data(
    await call("GET", "/auth/sessions", undefined, current),
  ).items;
  assert.equal(sessions.length, 2);
  const target = sessions.find((x: any) => !x.current);
  assert.ok(target);
  data(
    await call("POST", "/auth/sessions/" + target.id + "/revoke", {}, current, {
      "if-match": '"1"',
    }),
  );
  assert.equal((await call("GET", "/me", undefined, second)).statusCode, 401);
  const known = await call("POST", "/auth/recovery/request", { email }),
    unknown = await call("POST", "/auth/recovery/request", {
      email: randomUUID() + "@example.test",
    });
  assert.deepEqual(known.json().data, unknown.json().data);
  assert.ok(!known.body.includes("token"));
  const { startSmtpSink, sendLocalMail } =
    await import("../../server/src/smtp.js");
  const { deliverAccountMail } =
    await import("../../server/src/account-mail.js");
  const { readdir } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "orgmap-smtp-"));
  const sink = await startSmtpSink({ port: 0, directory: dir });
  try {
    assert.equal(
      await deliverAccountMail(async () => {
        throw Error("offline");
      }),
      0,
    );
    // Retry is deliberately delayed after a delivery failure.
    await pool.query(
      "UPDATE account_mail SET next_attempt_at=clock_timestamp() WHERE state='FAILED'",
    );
    assert.equal(
      await deliverAccountMail((m) =>
        sendLocalMail(m, (sink.address() as any).port),
      ),
      1,
    );
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    const mail = await readFile(join(dir, files[0]), "utf8");
    const token = mail.match(
      /token \(expires in 30 minutes\):\r?\n([a-f0-9]{64})/,
    )?.[1];
    assert.ok(token);
    const k = randomUUID(),
      payload = { token, newPassword: "recovered-password-789" };
    data(
      await call("POST", "/auth/recovery/complete", payload, undefined, {
        "idempotency-key": k,
      }),
    );
    data(
      await call("POST", "/auth/recovery/complete", payload, undefined, {
        "idempotency-key": k,
      }),
    );
    assert.equal(
      (
        await call(
          "POST",
          "/auth/recovery/complete",
          { ...payload, newPassword: "changed-again-password" },
          undefined,
          { "idempotency-key": k },
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (await call("GET", "/me", undefined, current)).statusCode,
      401,
    );
    assert.equal(
      (
        await call("POST", "/auth/login", {
          email,
          password: "recovered-password-789",
        })
      ).statusCode,
      200,
    );
  } finally {
    await new Promise<void>((resolve) => sink.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("readiness rejects missing/checksum-mismatched migrations and liveness stays independent", async () => {
  const { default: pg } = await import("pg");
  const admin = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    assert.equal((await app.inject("/api/ready")).statusCode, 200);
    const row = (
      await admin.query(
        "SELECT * FROM schema_migrations WHERE name='006_account_security.sql'",
      )
    ).rows[0];
    await admin.query(
      "UPDATE schema_migrations SET checksum='changed' WHERE name=$1",
      [row.name],
    );
    assert.equal((await app.inject("/api/ready")).statusCode, 503);
    assert.equal((await app.inject("/api/live")).statusCode, 200);
    await admin.query(
      "UPDATE schema_migrations SET checksum=$2 WHERE name=$1",
      [row.name, row.checksum],
    );
    await admin.query("DELETE FROM schema_migrations WHERE name=$1", [
      row.name,
    ]);
    assert.equal((await app.inject("/api/ready")).statusCode, 503);
    await admin.query(
      "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
      [row.name, row.checksum],
    );
    assert.equal((await app.inject("/api/ready")).statusCode, 200);
  } finally {
    await admin.end();
  }
});

test("logout wins while create-organization waits on account guard; expiration is checked after org guard", async () => {
  const { default: pg } = await import("pg");
  const admin = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const c = await admin.connect();
  async function blocked(fragment: string) {
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      if (
        (
          await admin.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
            ["%" + fragment + "%"],
          )
        ).rowCount
      )
        return;
    }
    assert.fail("Expected command to wait on guard");
  }
  try {
    const a = await user();
    await c.query("BEGIN");
    await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [a.id]);
    const pending = call(
      "POST",
      "/organizations",
      { name: "Rejected after logout" },
      a,
    );
    await blocked("SELECT id FROM accounts WHERE id=$1 FOR UPDATE");
    data(await call("POST", "/auth/logout", {}, a));
    await c.query("COMMIT");
    assert.equal((await pending).statusCode, 401);
    const b = await user(),
      B = await org(b, "Expiry guard");
    await c.query("BEGIN");
    await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      B.organization.id,
    ]);
    const read = call(
      "GET",
      "/organizations/" + B.organization.id + "/structure",
      undefined,
      b,
    );
    await blocked("SELECT * FROM organizations WHERE id=$1 FOR UPDATE");
    await c.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+interval '50 milliseconds' WHERE account_id=$1",
      [b.id],
    );
    await c.query("SELECT pg_sleep(0.08)");
    await c.query("COMMIT");
    assert.equal((await read).statusCode, 401);
  } finally {
    await c.query("ROLLBACK");
    c.release();
    await admin.end();
  }
});

test("invitation accept cannot outlive logout; worker context derives identity and rejects inactive or foreign membership", async () => {
  const { default: pg } = await import("pg");
  const admin = new pg.Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    }),
    guard = await admin.connect();
  const { deliverInvitationsSmtp } = await import("../../server/src/mail.js");
  const { startSmtpSink, sendLocalMail } =
    await import("../../server/src/smtp.js");
  const { withWorkerContext, validateActiveMembers } =
    await import("../../server/src/identity.js");
  const { readdir } = await import("node:fs/promises");
  const owner = await user(),
    invitee = await user(),
    A = await org(owner, "Invite guard"),
    p = "/organizations/" + A.organization.id;
  const email = data(await call("GET", "/me", undefined, invitee)).account
    .email;
  data(await call("POST", p + "/invitations", { email }, owner));
  const dir = await mkdtemp(join(tmpdir(), "orgmap-invite-smtp-")),
    sink = await startSmtpSink({ port: 0, directory: dir });
  try {
    assert.equal(
      await deliverInvitationsSmtp(
        A.organization.id,
        (m) => sendLocalMail(m, (sink.address() as any).port),
        foundationCore.validateInvitationDelivery,
      ),
      1,
    );
    const files = await readdir(dir);
    const mail = await readFile(join(dir, files[0]), "utf8"),
      token = proofToken(mail);
    assert.match(token, /^[a-f0-9]{64}$/);
    await guard.query("BEGIN");
    await guard.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      A.organization.id,
    ]);
    const pending = call("POST", "/invitations/accept", { token }, invitee);
    let waiting = false;
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      if (
        (
          await admin.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT * FROM organizations WHERE id=$1 FOR UPDATE%'",
          )
        ).rowCount
      ) {
        waiting = true;
        break;
      }
    }
    assert.ok(waiting);
    data(await call("POST", "/auth/logout", {}, invitee));
    await guard.query("COMMIT");
    assert.equal((await pending).statusCode, 401);
    assert.equal(
      data(await call("GET", p + "/members", undefined, owner)).items.length,
      1,
    );
    const member = data(
      await call("POST", p + "/members", { accountId: invitee.id }, owner),
    ).membership;
    await withWorkerContext(A.organization.id, member.id, async (ctx) => {
      assert.equal(ctx.account.id, invitee.id);
      assert.equal(await validateActiveMembers(ctx, [member.id]), true);
      assert.equal(await validateActiveMembers(ctx, [randomUUID()]), false);
      assert.equal(
        (
          await ctx.c.query(
            "SELECT current_setting('orgmap.organization_id',true) AS org",
          )
        ).rows[0].org,
        A.organization.id,
      );
    });
    await assert.rejects(
      withWorkerContext(randomUUID(), member.id, async () => true),
      (e: any) => e.code === "RESOURCE_NOT_FOUND",
    );
    data(
      await call(
        "PATCH",
        p + "/members/" + member.id,
        { status: "SUSPENDED" },
        owner,
        { "if-match": '"1"' },
      ),
    );
    await assert.rejects(
      withWorkerContext(A.organization.id, member.id, async () => true),
      (e: any) => e.code === "RESOURCE_NOT_FOUND",
    );
  } finally {
    await guard.query("ROLLBACK");
    guard.release();
    await admin.end();
    await new Promise<void>((resolve) => sink.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("module availability is read inside tenant guard before replay and applies to typed resources and workers", async () => {
  const enabled = new Map<string, boolean>();
  let calls = 0;
  let runtime: import("../../server/src/runtime.js").ModuleRuntime | undefined;
  const local = await buildApp([
    foundationDefaultAdmissionPolicy,
    async (app, core) => {
      runtime = core;
      core.registerOrganizationSettings(async (ctx) => ({
        version: 1,
        settings: {
          name: "Configured " + ctx.org.name,
          locale: "en-GB",
          timezone: "Europe/London",
          branding: { color: "#000000" },
          modules: { work: enabled.get(ctx.org.id) ?? true },
        },
      }));
      core.registerModuleScope({
        module: "work",
        routePrefixes: [
          "/api/v1/organizations/:organizationId/test-work-command",
        ],
        resourceTypes: ["test-task"],
      });
      app.post("/api/v1/organizations/:organizationId/test-work-command", (r) =>
        core.tenant(r, { mode: "write" }, async (ctx) => {
          calls++;
          await core.changed(ctx, r, ctx.member.id, "ModuleTestCommand");
          return { ok: true };
        }),
      );
      app.post("/api/v1/organizations/:organizationId/test-settings", (r) =>
        core.tenant(r, { mode: "authorization_write" }, async (ctx) => {
          enabled.set(ctx.org.id, (r.body as any).enabled);
          return { saved: true };
        }),
      );
      app.post("/api/v1/organizations/:organizationId/test-export", (r) =>
        core.tenant(r, { mode: "write" }, async () => ({ exported: true })),
      );
    },
  ]);
  const a = await user(),
    A = await org(a, "Module scope"),
    p = "/organizations/" + A.organization.id;
  const req = (method: string, path: string, payload?: any, extra: any = {}) =>
    local.inject({
      method: method as any,
      url: "/api/v1" + path,
      headers: {
        origin,
        cookie: a.cookie,
        "x-csrf-token": a.csrf,
        "idempotency-key": randomUUID(),
        ...extra,
      },
      payload,
    });
  try {
    const key = randomUUID();
    data(
      await req(
        "POST",
        p + "/test-work-command",
        {},
        { "idempotency-key": key },
      ),
    );
    assert.equal(calls, 1);
    const bootstrap = data(await req("GET", p + "/bootstrap"));
    assert.equal(bootstrap.organization.name, "Configured Module scope");
    assert.equal(bootstrap.modules.projects, true);
    assert.equal(
      data(await req("GET", "/me")).organizations[0].name,
      "Configured Module scope",
    );
    data(await req("POST", p + "/test-settings", { enabled: false }));
    const replay = await req(
      "POST",
      p + "/test-work-command",
      {},
      { "idempotency-key": key },
    );
    assert.equal(replay.statusCode, 403, replay.body);
    assert.equal(replay.json().error.code, "MODULE_DISABLED");
    assert.equal(calls, 1);
    assert.equal(
      (
        await req("POST", p + "/test-export", { resourceType: "test-task" })
      ).json().error.code,
      "MODULE_DISABLED",
    );
    await assert.rejects(
      runtime!.withWorkerContext(A.organization.id, A.membership.id, (ctx) =>
        runtime!.assertResourceAvailable(ctx, "test-task"),
      ),
      (e: any) => e.code === "MODULE_DISABLED",
    );
    assert.equal(
      data(await req("GET", p + "/bootstrap")).modules.projects,
      false,
    );
    data(await req("POST", p + "/test-settings", { enabled: true }));
    data(
      await req(
        "POST",
        p + "/test-work-command",
        {},
        { "idempotency-key": key },
      ),
    );
    assert.equal(calls, 1);
    await runtime!.withWorkerContext(
      A.organization.id,
      A.membership.id,
      (ctx) => runtime!.assertResourceAvailable(ctx, "test-task"),
    );
  } finally {
    await local.close();
  }
});

test("credentials verified before waiting cannot mint a session after password reset commits", async () => {
  const local = await buildApp([foundationDefaultAdmissionPolicy]);
  const { default: pg } = await import("pg");
  const { hashPassword } = await import("../../server/src/password.js");
  const admin = new pg.Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    }),
    guard = await admin.connect();
  const a = await user(),
    email = data(await call("GET", "/me", undefined, a)).account.email;
  const replacement = await hashPassword("replacement-password-987");
  try {
    await guard.query("BEGIN");
    await guard.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [a.id]);
    const pending = local.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin },
      payload: { email, password: "a-secure-password-123" },
    });
    let waiting = false;
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      if (
        (
          await admin.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT * FROM accounts WHERE id=$1 FOR UPDATE%'",
          )
        ).rowCount
      ) {
        waiting = true;
        break;
      }
    }
    assert.ok(waiting);
    await guard.query(
      "UPDATE accounts SET password_hash=$2,version=version+1 WHERE id=$1",
      [a.id, replacement],
    );
    await guard.query("DELETE FROM sessions WHERE account_id=$1", [a.id]);
    await guard.query("COMMIT");
    assert.equal((await pending).statusCode, 401);
    assert.equal(
      (
        await local.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          headers: { origin },
          payload: { email, password: "replacement-password-987" },
        })
      ).statusCode,
      200,
    );
  } finally {
    await guard.query("ROLLBACK");
    guard.release();
    await admin.end();
    await local.close();
  }
});

test("GET me does not hold its session while waiting for an organization; logout wins before the org is released", { timeout: 15000 }, async () => {
  const { default: pg } = await import("pg");
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const guard = await admin.connect();
  const a = await user(), A = await org(a, "Me organization wait");
  let pending: ReturnType<typeof call> | undefined;
  let logout: ReturnType<typeof call> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const guardPid = (await guard.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await guard.query("BEGIN");
    await guard.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [A.organization.id]);
    pending = call("GET", "/me", undefined, a);
    let waiting = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if ((await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT * FROM organizations WHERE id=$1 FOR UPDATE%' AND $1::int=ANY(pg_blocking_pids(pid))", [guardPid])).rowCount) {
        waiting = true;
        break;
      }
    }
    assert.ok(waiting, "GET /me reached the held organization guard");
    logout = call("POST", "/auth/logout", {}, a);
    const response = await Promise.race([logout, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("LOGOUT_BLOCKED_BY_ME_SESSION_LOCK")), 3000); })]);
    assert.equal(response.statusCode, 200, response.body);
    clearTimeout(timer); timer = undefined;
    // The organization remains locked until logout has demonstrably completed.
    await guard.query("COMMIT");
    const rejected = await pending;
    assert.equal(rejected.statusCode, 401, rejected.body);
  } finally {
    if (timer) clearTimeout(timer);
    await guard.query("ROLLBACK");
    guard.release();
    await Promise.allSettled([...(pending ? [pending] : []), ...(logout ? [logout] : [])]);
    await admin.end();
  }
});

test("GET me resolves current settings and membership IDs independently for two organizations", async () => {
  const seen: string[] = [];
  const local = await buildApp([foundationDefaultAdmissionPolicy, async (_app, core) => {
    core.registerOrganizationSettings(async ctx => {
      seen.push(ctx.org.id);
      return { version: 7, settings: { name: "Current " + ctx.org.id, locale: "en", timezone: "UTC", branding: {}, modules: {} } };
    });
  }]);
  try {
    // This app owns its auth limiter; the shared fixture has already exercised
    // register/login enough times to reach the intentional per-IP limit.
    const registration = await local.inject({ method: "POST", url: "/api/v1/auth/register", headers: { origin }, payload: { email: randomUUID() + "@example.test", password: "a-secure-password-123", displayName: "Me settings fixture" } });
    const registered = data(registration);
    const a: User = { id: registered.account.id, csrf: registered.csrfToken, cookie: registration.cookies[0].name + "=" + registration.cookies[0].value };
    const A = await org(a, "Me first organization"), B = await org(a, "Me second organization");
    const response = await local.inject({ method: "GET", url: "/api/v1/me", headers: { origin, cookie: a.cookie } });
    const me = data(response), expected = new Map([[A.organization.id, A.membership.id], [B.organization.id, B.membership.id]]);
    assert.equal(me.account.id, a.id);
    assert.equal(me.organizations.length, 2);
    assert.deepEqual([...seen].sort(), [...expected.keys()].sort());
    for (const organization of me.organizations) {
      assert.ok(expected.has(organization.id));
      assert.equal(organization.memberId, expected.get(organization.id));
      assert.equal(organization.name, "Current " + organization.id);
      assert.equal(organization.orgRole, "OWNER");
      assert.equal(organization.memberType, "MEMBER");
    }
  } finally { await local.close(); }
});

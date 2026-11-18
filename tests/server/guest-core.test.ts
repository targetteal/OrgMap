import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deliverLocalInvitations } from "../../server/src/mail.js";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import type { ModuleRuntime } from "../../server/src/runtime.js";

const fixtureRuntime = new URL(
  process.env.DATABASE_URL ?? "postgres://invalid/",
);
const fixtureOperator = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
);
if (
  !/^\/orgmap_guest_core_[a-f0-9]{16}$/.test(fixtureRuntime.pathname) ||
  fixtureOperator.pathname !== fixtureRuntime.pathname ||
  fixtureOperator.host !== fixtureRuntime.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(fixtureRuntime.hostname)
)
  throw Error("EXCLUSIVE_GUEST_CORE_DATABASE_REQUIRED");

let testCore!: ModuleRuntime;
// This is an explicit test adapter, used to prove the core SPI. It is not
// acceptance evidence for any real OrgMap business module.
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    testCore = core;
    core.registerGuestAccessAdapter({
      context: "probe",
      routes: [
        {
          method: "GET",
          path: "/api/v1/organizations/:organizationId/guest-probe/:id",
          action: "read",
          resolve: async (ctx, request) => ({
            context: "probe",
            kind: "circle",
            id: String((request.params as any).id),
          }),
        },
        {
          method: "GET",
          path: "/api/v1/organizations/:organizationId/guest-probe",
          action: "read",
          collection: true,
        },
        {
          method: "POST",
          path: "/api/v1/organizations/:organizationId/guest-probe/:id/write",
          action: "write",
          resolve: async (_ctx, request) => ({
            context: "probe",
            kind: "circle",
            id: String((request.params as any).id),
          }),
        },
      ],
      validateSharePlan: async (ctx, plan) => {
        if (
          ctx.member.org_role !== "OWNER" ||
          ctx.member.member_type !== "MEMBER"
        )
          return false;
        for (const item of plan) {
          if (
            item.resource.context !== "probe" ||
            item.resource.kind !== "circle" ||
            item.actions.some((action) => !["read", "write"].includes(action))
          )
            return false;
          const exists = await ctx.c.query(
            "SELECT 1 FROM entities WHERE organization_id=$1 AND id=$2 AND kind='CIRCLE' AND NOT archived",
            [ctx.org.id, item.resource.id],
          );
          if (!exists.rowCount) return false;
        }
        return true;
      },
    });
    app.get(
      "/api/v1/organizations/:organizationId/guest-probe/:id",
      (request) =>
        core.tenant(request, { mode: "read" }, async (ctx) => {
          const id = String((request.params as any).id);
          await core.requireGuestResource(
            ctx,
            { context: "probe", kind: "circle", id },
            "read",
          );
          const row = await ctx.c.query(
            "SELECT name FROM entities WHERE organization_id=$1 AND id=$2 AND kind='CIRCLE' AND NOT archived",
            [ctx.org.id, id],
          );
          return { item: row.rows[0] ?? null };
        }),
    );
    app.get("/api/v1/organizations/:organizationId/guest-probe", (request) =>
      core.tenant(request, { mode: "read" }, async (ctx) => {
        const ids = core.isGuest(ctx)
          ? await core.guestResourceIds(ctx, {
              context: "probe",
              kind: "circle",
              action: "read",
            })
          : (
              await ctx.c.query(
                "SELECT id FROM entities WHERE organization_id=$1 AND kind='CIRCLE' AND NOT archived",
                [ctx.org.id],
              )
            ).rows.map((row) => row.id);
        const rows = await ctx.c.query(
          "SELECT id,name FROM entities WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND kind='CIRCLE' AND NOT archived ORDER BY id",
          [ctx.org.id, ids],
        );
        return { items: rows.rows };
      }),
    );
    app.post(
      "/api/v1/organizations/:organizationId/guest-probe/:id/write",
      (request) =>
        core.tenant(
          request,
          { mode: "write", authorize: () => true },
          async (ctx) => {
            const id = String((request.params as any).id);
            await core.requireGuestResource(
              ctx,
              { context: "probe", kind: "circle", id },
              "write",
            );
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
  method: InjectOptions["method"],
  path: string,
  body?: InjectOptions["payload"],
  user?: User,
  extra: NonNullable<InjectOptions["headers"]> = {},
): Promise<LightMyRequestResponse> {
  const options: InjectOptions = {
    method,
    url: "/api/v1" + path,
    headers: {
      origin,
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...extra,
    },
  };
  if (body !== undefined) options.payload = body;
  return app.inject(options);
}
async function user(): Promise<User> {
  const response = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "a-secure-password-123",
    displayName: "Guest core test",
  });
  assert.ok([200, 201].includes(response.statusCode), response.body);
  return {
    cookie: response.cookies[0].name + "=" + response.cookies[0].value,
    csrf: response.json().data.csrfToken,
    id: response.json().data.account.id,
  };
}
const data = (response: any) => {
  assert.ok([200, 201].includes(response.statusCode), response.body);
  return response.json().data;
};

test("guest core enforces explicit grants, visibility, and worker scope", async () => {
  const owner = await user();
  const guestAccount = await user();
  const outsider = await user();
  const noGrantAccount = await user();
  const orgData = data(
    await call("POST", "/organizations", { name: "Guest core" }, owner),
  );
  const organizationId = orgData.organization.id;
  const base = "/organizations/" + organizationId;
  const rootId = orgData.rootCircle.id;
  const ownerDirectory = data(
    await call("GET", base + "/members", undefined, owner),
  );
  const ownerMembership = ownerDirectory.items.find(
    (item: any) => item.accountId === owner.id,
  );
  assert.ok(ownerMembership);
  assert.equal(
    (
      await call(
        "POST",
        base + "/members/" + ownerMembership.id + "/actions/change-type",
        {
          memberType: "GUEST",
          confirmVisibilityChange: true,
        },
        owner,
        { "if-match": '"1"' },
      )
    ).statusCode,
    422,
  );
  const privateCircle = data(
    await call(
      "POST",
      base + "/circles",
      {
        parentCircleId: rootId,
        name: "Private",
        mode: "DIRECT",
      },
      owner,
    ),
  ).circle;
  const share = [
    {
      resource: { context: "probe", kind: "circle", id: rootId },
      actions: ["read", "write"],
    },
  ];
  const membership = data(
    await call(
      "POST",
      base + "/members",
      {
        accountId: guestAccount.id,
        memberType: "GUEST",
        accessPlan: share,
      },
      owner,
    ),
  ).membership;
  assert.equal(membership.memberType, "GUEST");
  assert.equal(membership.orgRole, "MEMBER");
  const noGrant = data(
    await call(
      "POST",
      base + "/members",
      {
        accountId: noGrantAccount.id,
        memberType: "GUEST",
        accessPlan: [],
      },
      owner,
    ),
  ).membership;
  assert.equal(noGrant.memberType, "GUEST");
  const noGrantBootstrap = data(
    await call("GET", base + "/bootstrap", undefined, noGrantAccount),
  );
  assert.equal(
    JSON.stringify(noGrantBootstrap).includes(noGrantAccount.id),
    false,
  );
  assert.deepEqual(
    data(await call("GET", base + "/structure", undefined, noGrantAccount))
      .nodes,
    [],
  );
  assert.deepEqual(
    data(
      await call("GET", base + "/members", undefined, noGrantAccount),
    ).items.map((item: any) => item.id),
    [noGrant.id],
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + rootId,
        undefined,
        noGrantAccount,
      )
    ).statusCode,
    404,
  );

  const boot = data(
    await call("GET", base + "/bootstrap", undefined, guestAccount),
  );
  assert.ok(boot);
  const structure = data(
    await call("GET", base + "/structure", undefined, guestAccount),
  );
  assert.deepEqual(structure.nodes, []);
  const directory = data(
    await call("GET", base + "/members", undefined, guestAccount),
  );
  assert.deepEqual(
    directory.items.map((item: any) => item.id),
    [membership.id],
  );
  assert.equal(JSON.stringify(directory).includes(guestAccount.id), false);

  const allowed = await call(
    "GET",
    base + "/guest-probe/" + rootId,
    undefined,
    guestAccount,
  );
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json().data.item.name, "Guest core");
  const denied = await call(
    "GET",
    base + "/guest-probe/" + privateCircle.id,
    undefined,
    guestAccount,
  );
  assert.equal(denied.statusCode, 404, denied.body);
  assert.equal(denied.body.includes("Private"), false);
  const collection = data(
    await call("GET", base + "/guest-probe", undefined, guestAccount),
  );
  assert.deepEqual(
    collection.items.map((item: any) => item.id),
    [rootId],
  );
  assert.equal(
    collection.items.some((item: any) => item.name === "Private"),
    false,
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + privateCircle.id + "/undeclared",
        undefined,
        guestAccount,
      )
    ).statusCode,
    404,
  );

  assert.equal(
    (
      await call(
        "POST",
        base + "/guest-probe/" + rootId + "/write",
        {},
        guestAccount,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/guest-probe/" + privateCircle.id + "/write",
        {},
        guestAccount,
      )
    ).statusCode,
    404,
  );
  await assert.rejects(
    testCore.withWorkerContext(
      organizationId,
      membership.id,
      async () => "ran",
    ),
    (error: any) => error.code === "RESOURCE_NOT_FOUND",
  );
  let workerRan = false;
  await testCore.withResourceWorkerContext(
    organizationId,
    membership.id,
    [
      {
        resource: { context: "probe", kind: "circle", id: rootId },
        action: "read",
      },
    ],
    async () => {
      workerRan = true;
    },
  );
  assert.equal(workerRan, true);
  const grants = data(
    await call(
      "GET",
      base + "/members/" + membership.id + "/access-grants",
      undefined,
      owner,
    ),
  );
  assert.equal(grants.items.length, 1);
  assert.equal(
    (
      await call(
        "POST",
        base +
          "/members/" +
          membership.id +
          "/access-grants/" +
          grants.items[0].id +
          "/revoke",
        {},
        owner,
        { "if-match": '"1"' },
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + privateCircle.id,
        undefined,
        guestAccount,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + privateCircle.id,
        undefined,
        owner,
      )
    ).statusCode,
    200,
  );
  await assert.rejects(
    testCore.withResourceWorkerContext(
      organizationId,
      membership.id,
      [
        {
          resource: { context: "probe", kind: "circle", id: rootId },
          action: "read",
        },
      ],
      async () => "must not run",
    ),
    (error: any) => error.code === "RESOURCE_NOT_FOUND",
  );

  const foreignOrg = data(
    await call("POST", "/organizations", { name: "Separate" }, outsider),
  );
  assert.equal(
    (
      await call(
        "GET",
        "/organizations/" +
          foreignOrg.organization.id +
          "/guest-probe/" +
          rootId,
        undefined,
        guestAccount,
      )
    ).statusCode,
    404,
  );

  // Route declarations are module-owned. A path supplied by a client cannot
  // turn an undeclared route into an authorized guest route.
  assert.equal(
    (await call("GET", base + "/goals", undefined, guestAccount)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/members",
        { accountId: outsider.id, memberType: "MEMBER" },
        guestAccount,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/members/" + membership.id + "/actions/change-type",
        {
          memberType: "MEMBER",
          confirmVisibilityChange: true,
        },
        guestAccount,
        { "if-match": '"1"' },
      )
    ).statusCode,
    404,
  );

  // Downgrade removes general member access, preserving explicit valid grants.
  // The same account keeps its independent owner authority in another tenant.
  assert.equal(
    (
      await call(
        "POST",
        base + "/members/" + membership.id + "/access-grants",
        { accessPlan: share },
        owner,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + rootId,
        undefined,
        guestAccount,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/members/" + membership.id + "/actions/change-type",
        {
          memberType: "MEMBER",
          confirmVisibilityChange: true,
        },
        owner,
        { "if-match": '"1"' },
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + privateCircle.id,
        undefined,
        guestAccount,
      )
    ).statusCode,
    200,
  );
  const orgB = data(
    await call(
      "POST",
      "/organizations",
      { name: "Independent B" },
      guestAccount,
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/members/" + membership.id + "/actions/change-type",
        {
          memberType: "GUEST",
          confirmVisibilityChange: true,
        },
        owner,
        { "if-match": '"2"' },
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + privateCircle.id,
        undefined,
        guestAccount,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + privateCircle.id,
        undefined,
        owner,
      )
    ).statusCode,
    200,
  );

  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + rootId,
        undefined,
        guestAccount,
      )
    ).statusCode,
    200,
    "valid explicit share survives downgrade",
  );
  const stillB = data(
    await call(
      "GET",
      "/organizations/" + orgB.organization.id + "/bootstrap",
      undefined,
      guestAccount,
    ),
  );
  assert.equal(stillB.membership.orgRole, "OWNER");
  assert.equal(stillB.membership.memberType, "MEMBER");
  // Source authority is current, independent of the target's original acceptance.
  const standby = await user(),
    standbyMember = data(
      await call("POST", base + "/members", { accountId: standby.id }, owner),
    ).membership;
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      organizationId,
    ]);
    await c.query(
      "UPDATE members SET org_role='OWNER' WHERE organization_id=$1 AND id=$2",
      [organizationId, standbyMember.id],
    );
    await c.query(
      "UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND id=$2",
      [organizationId, ownerMembership.id],
    );
  });
  assert.equal(
    (
      await call(
        "GET",
        base + "/guest-probe/" + rootId,
        undefined,
        guestAccount,
      )
    ).statusCode,
    404,
  );
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      organizationId,
    ]);
    await c.query(
      "UPDATE members SET status='ACTIVE' WHERE organization_id=$1 AND id=$2",
      [organizationId, ownerMembership.id],
    );
  });
  const invitation = data(
    await call(
      "POST",
      base + "/invitations",
      {
        email: randomUUID() + "@example.test",
        memberType: "GUEST",
        accessPlan: share,
      },
      owner,
    ),
  );
  assert.equal(invitation.invitation.status, "PENDING");
  assert.equal(JSON.stringify(invitation).includes("token"), false);
  const invitedUser = await user();
  const invitedEmail = data(await call("GET", "/me", undefined, invitedUser))
    .account.email;
  const invite = data(
    await call(
      "POST",
      base + "/invitations",
      {
        email: invitedEmail,
        memberType: "GUEST",
        accessPlan: share,
      },
      owner,
    ),
  );
  assert.equal(invite.invitation.status, "PENDING");
  const beforeAccept = data(
    await call("GET", base + "/members", undefined, owner),
  );
  assert.equal(
    beforeAccept.items.some((item: any) => item.accountId === invitedUser.id),
    false,
  );
  const mailDir = await mkdtemp(join(tmpdir(), "orgmap-guest-mail-"));
  try {
    assert.equal(
      await deliverLocalInvitations(
        organizationId,
        mailDir,
        undefined,
        testCore.validateInvitationDelivery,
      ),
      2,
    );
    const mail = JSON.parse(
      await readFile(join(mailDir, invite.deliveryJobId + ".json"), "utf8"),
    );
    assert.equal(mail.to, invitedEmail);
    // Local delivery is the test-only entry mechanism; the application response
    // itself never exposes the invitation token.
    const changed = data(
      await call(
        "POST",
        base +
          "/invitations/" +
          invite.invitation.id +
          "/actions/change-access",
        {
          memberType: "GUEST",
          accessPlan: [
            {
              resource: {
                context: "probe",
                kind: "circle",
                id: privateCircle.id,
              },
              actions: ["read"],
            },
          ],
        },
        owner,
        { "if-match": '"' + invite.invitation.version + '"' },
      ),
    );
    assert.equal(
      (
        await call(
          "POST",
          "/invitations/accept",
          { token: mail.token },
          invitedUser,
        )
      ).statusCode,
      404,
      "old token cannot reuse altered plan",
    );
    assert.equal(
      await deliverLocalInvitations(
        organizationId,
        mailDir,
        undefined,
        testCore.validateInvitationDelivery,
      ),
      1,
    );
    const replacement = JSON.parse(
      await readFile(join(mailDir, changed.deliveryJobId + ".json"), "utf8"),
    );
    const accepted = data(
      await call(
        "POST",
        "/invitations/accept",
        { token: replacement.token },
        invitedUser,
      ),
    );
    assert.equal(accepted.membership.memberType, "GUEST");
    assert.equal(
      (
        await call(
          "GET",
          base + "/guest-probe/" + rootId,
          undefined,
          invitedUser,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await call(
          "GET",
          base + "/guest-probe/" + privateCircle.id,
          undefined,
          invitedUser,
        )
      ).statusCode,
      200,
    );
    const conflict = data(
      await call(
        "POST",
        base + "/invitations",
        { email: invitedEmail, memberType: "MEMBER", accessPlan: [] },
        owner,
      ),
    );
    assert.equal(
      await deliverLocalInvitations(
        organizationId,
        mailDir,
        undefined,
        testCore.validateInvitationDelivery,
      ),
      1,
    );
    const conflictMail = JSON.parse(
      await readFile(join(mailDir, conflict.deliveryJobId + ".json"), "utf8"),
    );
    const rejected = await call(
      "POST",
      "/invitations/accept",
      { token: conflictMail.token },
      invitedUser,
    );
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.json().error.code, "TYPE_CHANGE_REQUIRED");
  } finally {
    await rm(mailDir, { recursive: true, force: true });
  }
});

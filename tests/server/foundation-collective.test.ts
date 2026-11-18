import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, HTTPMethods } from "fastify";

// Guard before app construction or any database query: this suite is allowed
// to run only against its uniquely named database from the private runner.
const databaseName = new URL(
  process.env.DATABASE_URL ?? "postgres://invalid/",
).pathname.slice(1);
if (!/^orgmap_foundation_collective_[a-f0-9]{16}$/.test(databaseName))
  throw Error("EXCLUSIVE_FOUNDATION_COLLECTIVE_DATABASE_REQUIRED");

import { buildApp } from "../../server/src/app.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { pool, transaction } from "../../server/src/db.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { createStructureModule } from "../../server/modules/structure/plugin.js";
import {
  createAdministration,
  readOrganizationalPolicy,
} from "../../server/modules/administration/index.js";

const fixtureRuntime = new URL(process.env.DATABASE_URL!),
  fixtureOperator = new URL(
    process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
  );
if (
  fixtureOperator.pathname !== fixtureRuntime.pathname ||
  fixtureOperator.host !== fixtureRuntime.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(fixtureRuntime.hostname)
)
  throw Error("EXCLUSIVE_FOUNDATION_COLLECTIVE_DATABASE_REQUIRED");
const origin = "http://foundation-collective.localhost:5273";
process.env.ALLOWED_ORIGINS = origin;
const blobsDirectory = await mkdtemp(
  join(tmpdir(), "orgmap-foundation-collective-"),
);
const integration = async (
  app: import("fastify").FastifyInstance,
  core: ModuleRuntime,
) => {
  const options = {
    organizationPolicy: async (
      ctx: import("../../server/src/runtime.js").Ctx,
    ) => {
      const policy = await readOrganizationalPolicy(
        ctx,
        "structure.collectiveManagement",
      );
      if (policy && typeof policy.value !== "boolean")
        throw Error("POLICY_CONFIGURATION_INVALID");
      return {
        enabled: policy?.value === true,
        allowCircleOverride: policy?.allowOverride ?? false,
        revision: policy?.revision ?? 0,
      };
    },
  };
  const structure = createStructurePorts(core, options);
  core.registerFoundationStructure(structure);
  await createAdministration({
    validateOrganizationPolicyChange: async (ctx, next) => {
      await structure.validateOrganizationPolicyChange(ctx, next);
    },
  })(app, core);
  await createStructureModule(options)(app, core);
};
const app = await buildApp([foundationDefaultAdmissionPolicy, integration], {
  migrationMaxPrefix: 999,
});
await app.ready();

after(async () => {
  await app.close();
  await pool.end();
  await rm(blobsDirectory, { recursive: true, force: true });
});

type Session = { cookie: string; csrf: string; accountId: string };
async function account(label: string, target = app): Promise<Session> {
  const response = await target.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin },
    payload: {
      email: `foundation-${randomUUID()}@example.test`,
      password: `Synthetic-${randomUUID()}`,
      displayName: label,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const session = response.cookies.find(
    (cookie) => cookie.name === "orgmap_session",
  );
  assert.ok(session);
  return {
    cookie: `orgmap_session=${session.value}`,
    csrf: response.json().data.csrfToken,
    accountId: response.json().data.account.id,
  };
}
async function request(
  session: Session,
  method: HTTPMethods,
  path: string,
  payload?: object,
  version?: number,
  key = randomUUID(),
  target = app,
) {
  return target.inject({
    method,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
      ...(method === "POST" ? { "idempotency-key": key } : {}),
      ...(version === undefined ? {} : { "if-match": `"${version}"` }),
    },
  });
}

test("HTTP admission fails closed without a policy provider and preserves bootstrap and other organizations", async () => {
  const strictApp = await buildApp([], { migrationMaxPrefix: 999 });
  try {
    await strictApp.ready();
    const owner = await account("Owner sem provider", strictApp);
    const target = await account("Conta preservada", strictApp);
    const call = (
      actor: Session,
      method: HTTPMethods,
      path: string,
      payload?: object,
      commandKey = randomUUID(),
    ) => request(actor, method, path, payload, undefined, commandKey, strictApp);
    const A = result(
      await call(owner, "POST", "/organizations", { name: "Bootstrap sem provider" }),
      201,
    );
    const B = result(
      await call(target, "POST", "/organizations", { name: "Organização preservada" }),
      201,
    );
    const base = `/organizations/${A.organization.id}`;
    const snapshot = async () => transaction(async (c) => {
      const organizations = [];
      for (const organizationId of [A.organization.id, B.organization.id]) {
        await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [organizationId]);
        organizations.push((await c.query(
          "SELECT (SELECT row_to_json(o) FROM organizations o WHERE id=$1) AS organization,(SELECT count(*) FROM members WHERE organization_id=$1)::int AS members,(SELECT count(*) FROM invitations WHERE organization_id=$1)::int AS invitations,(SELECT count(*) FROM invitation_delivery WHERE organization_id=$1)::int AS mail,(SELECT count(*) FROM command_results WHERE organization_id=$1)::int AS commands,(SELECT count(*) FROM audit_events WHERE organization_id=$1)::int AS audit",
          [organizationId],
        )).rows[0]);
      }
      const accounts = (await c.query(
        "SELECT id,email,display_name,version FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id",
        [[owner.accountId, target.accountId]],
      )).rows;
      return { organizations, accounts };
    });
    const before = await snapshot();
    for (const [path, payload] of [
      [base + "/members", { accountId: target.accountId }],
      [base + "/invitations", { email: "strict-no-mail@example.test" }],
    ] as const) {
      const commandKey = randomUUID();
      for (let attempt = 0; attempt < 2; attempt++) {
        const denied = await call(owner, "POST", path, payload, commandKey);
        assert.equal(denied.statusCode, 503, denied.body);
        assert.equal(denied.json().error.code, "POLICY_CONSUMER_UNAVAILABLE");
      }
    }
    assert.deepEqual(await snapshot(), before);
    const otherMe = result(await call(target, "GET", "/me"), 200);
    assert.equal(otherMe.account.id, target.accountId);
    assert.deepEqual(otherMe.organizations.map((org: { id: string }) => org.id), [B.organization.id]);
    result(await call(target, "GET", `/organizations/${B.organization.id}/bootstrap`), 200);
  } finally {
    await strictApp.close();
  }
});
function result(
  response: { statusCode: number; body: string; json: () => any },
  expected: number,
) {
  assert.equal(response.statusCode, expected, response.body);
  return response.json().data;
}

test("collective circle members get only local association and circle content edits", async () => {
  const owner = await account("Coordenadora local");
  const localMember = await account("Membro do círculo");
  const parentOnly = await account("Membro apenas do pai");
  const childOnly = await account("Membro apenas do filho");
  const roleholder = await account("Ocupante de papel no pai");
  const outside = await account("Conta de outra organização");
  const newMember = await account("Nova pessoa associada");
  const deniedMembers = [
    await account("Alvo pai"),
    await account("Alvo filho"),
    await account("Alvo papel"),
    await account("Alvo externo"),
  ];

  const organization = result(
    await request(owner, "POST", "/organizations", { name: "Coletivo local" }),
    201,
  );
  const orgId = organization.organization.id;
  const base = `/organizations/${orgId}`;
  const root = result(
    await request(owner, "GET", `${base}/bootstrap`),
    200,
  ).rootCircleId;
  const otherOrganization = result(
    await request(outside, "POST", "/organizations", {
      name: "Outra organização",
    }),
    201,
  );
  const otherBase = `/organizations/${otherOrganization.organization.id}`;

  async function addMember(actor: Session) {
    return result(
      await request(owner, "POST", `${base}/members`, {
        accountId: actor.accountId,
      }),
      201,
    ).membership.id as string;
  }
  const localMemberId = await addMember(localMember);
  const parentOnlyId = await addMember(parentOnly);
  const childOnlyId = await addMember(childOnly);
  const roleholderId = await addMember(roleholder);
  const newMemberId = await addMember(newMember);
  const deniedMemberIds = await Promise.all(deniedMembers.map(addMember));

  const circle = result(
    await request(owner, "POST", `${base}/circles`, {
      mode: "DIRECT",
      name: "Círculo coletivo",
      parentCircleId: root,
    }),
    201,
  ).circle;
  const child = result(
    await request(owner, "POST", `${base}/circles`, {
      mode: "DIRECT",
      name: "Filho",
      parentCircleId: circle.id,
    }),
    201,
  ).circle;
  const emptyChild = result(
    await request(owner, "POST", `${base}/circles`, {
      mode: "DIRECT",
      name: "Filho vazio",
      parentCircleId: circle.id,
    }),
    201,
  ).circle;
  const sibling = result(
    await request(owner, "POST", `${base}/circles`, {
      mode: "DIRECT",
      name: "Irmão",
      parentCircleId: root,
    }),
    201,
  ).circle;
  await request(owner, "POST", `${base}/circles/${circle.id}/memberships`, {
    memberId: localMemberId,
  });
  await request(owner, "POST", `${base}/circles/${root}/memberships`, {
    memberId: parentOnlyId,
  });
  await request(owner, "POST", `${base}/circles/${child.id}/memberships`, {
    memberId: childOnlyId,
  });

  const parentRole = result(
    await request(owner, "POST", `${base}/roles`, {
      mode: "DIRECT",
      name: "Papel do círculo pai",
      circleId: root,
    }),
    201,
  ).role;
  result(
    await request(owner, "POST", `${base}/roles/${parentRole.id}/occupancies`, {
      memberId: roleholderId,
      kind: "DIRECT",
      scope: "papel local",
    }),
    201,
  );
  const assignableRole = result(
    await request(owner, "POST", `${base}/roles`, {
      mode: "DIRECT",
      name: "Papel do coletivo",
      circleId: circle.id,
    }),
    201,
  ).role;

  const scopedQuery = async (sql: string, args: unknown[]) =>
    transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        orgId,
      ]);
      return c.query(sql, args);
    });
  const currentAdmins = await scopedQuery(
    "SELECT count(*)::int AS n FROM (SELECT role_id,member_id,starts_at,ends_at,NULL::timestamptz ended_at FROM occupancies UNION ALL SELECT role_id,member_id,starts_at,ends_at,ended_at FROM structure_mandates) o JOIN entities r ON r.organization_id=$1 AND r.id=o.role_id JOIN structure_role_settings f ON f.organization_id=r.organization_id AND f.role_id=r.id JOIN members m ON m.organization_id=r.organization_id AND m.id=o.member_id WHERE r.parent_id=$2 AND (f.flags->>'admin')::boolean=true AND m.status='ACTIVE' AND o.starts_at<=clock_timestamp() AND (o.ends_at IS NULL OR o.ends_at>clock_timestamp()) AND (o.ended_at IS NULL OR o.ended_at>clock_timestamp())",
    [orgId, circle.id],
  );
  assert.equal(
    currentAdmins.rows[0].n,
    0,
    "the target circle must have no current ADMIN",
  );

  const policy = result(
    await request(owner, "POST", `${base}/administration/policies`, {
      value: {
        key: "structure.collectiveManagement",
        value: true,
        allowOverride: true,
        parentId: null,
      },
    }),
    201,
  );

  // Parent membership, child membership, a parent role, and another tenant do not inherit access.
  for (const [actor, targetId] of [
    [parentOnly, deniedMemberIds[0]],
    [childOnly, deniedMemberIds[1]],
    [roleholder, deniedMemberIds[2]],
  ] as const) {
    assert.equal(
      (
        await request(
          actor,
          "POST",
          `${base}/circles/${circle.id}/memberships`,
          { memberId: targetId },
        )
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (
      await request(
        outside,
        "POST",
        `${base}/circles/${circle.id}/memberships`,
        { memberId: deniedMemberIds[3] },
      )
    ).statusCode,
    404,
  );

  const associationKey = randomUUID();
  const associated = result(
    await request(
      localMember,
      "POST",
      `${base}/circles/${circle.id}/memberships`,
      { memberId: newMemberId },
      undefined,
      associationKey,
    ),
    201,
  ).membership;
  assert.equal(associated.origin, "EXPLICIT");
  const associationHistory = await scopedQuery(
    "SELECT action,after_value->>'source' AS source FROM structure_history WHERE organization_id=$1 AND resource_id=$2 AND action IN ('CircleMemberAssociated','CollectiveActionAuthorized') ORDER BY action",
    [orgId, associated.id],
  );
  assert.deepEqual(
    associationHistory.rows,
    [
      { action: "CircleMemberAssociated", source: null },
      { action: "CollectiveActionAuthorized", source: "COLLECTIVE" },
    ],
    "association and collective authorization history must commit together",
  );

  const edit = result(
    await request(
      localMember,
      "PATCH",
      `${base}/circles/${circle.id}`,
      { mode: "DIRECT", purpose: "Editado pelo coletivo" },
      circle.version,
    ),
    200,
  );
  assert.equal(edit.entity.purpose, "Editado pelo coletivo");
  const editHistory = await scopedQuery(
    "SELECT action,after_value->>'source' AS source FROM structure_history WHERE organization_id=$1 AND resource_id=$2 AND action IN ('StructureEntityUpdated','CollectiveActionAuthorized') ORDER BY action",
    [orgId, circle.id],
  );
  assert.deepEqual(
    editHistory.rows,
    [
      { action: "CollectiveActionAuthorized", source: "COLLECTIVE" },
      { action: "StructureEntityUpdated", source: null },
    ],
    "circle edit and collective authorization history must commit together",
  );

  assert.equal(
    (
      await request(localMember, "POST", `${base}/circles`, {
        mode: "DIRECT",
        name: "Forbidden child",
        parentCircleId: circle.id,
      })
    ).statusCode,
    403,
    "collective membership does not permit circle creation",
  );
  assert.equal(
    (
      await request(
        localMember,
        "PUT",
        `${base}/structure-advanced/roles/${assignableRole.id}/settings`,
        {
          flags: {
            core: false,
            electable: false,
            assigner: false,
            representative: false,
            admin: false,
          },
        },
        0,
      )
    ).statusCode,
    403,
    "collective membership does not permit role configuration",
  );
  assert.equal(
    (
      await request(localMember, "POST", `${base}/structure/${child.id}/move`, {
        targetCircleId: sibling.id,
        mode: "DIRECT",
      })
    ).statusCode,
    403,
    "collective membership does not permit moving a circle",
  );
  assert.equal(
    (
      await request(
        localMember,
        "POST",
        `${base}/structure/${emptyChild.id}/archive`,
        {},
      )
    ).statusCode,
    403,
    "collective membership does not permit archiving a circle",
  );
  assert.equal(
    (
      await request(
        localMember,
        "POST",
        `${base}/roles/${assignableRole.id}/occupancies`,
        {
          memberId: newMemberId,
          kind: "DIRECT",
          scope: "assignment denied",
        },
      )
    ).statusCode,
    403,
    "collective membership does not permit occupancy assignment",
  );

  result(
    await request(
      owner,
      "PUT",
      `${base}/structure-advanced/circles/${circle.id}/policy`,
      {
        governedFields: ["purpose"],
      },
      0,
    ),
    200,
  );
  const protectedEdit = await request(
    localMember,
    "PATCH",
    `${base}/circles/${circle.id}`,
    { mode: "DIRECT", purpose: "Não deve persistir" },
    edit.entity.version,
  );
  assert.equal(protectedEdit.statusCode, 422, protectedEdit.body);
  const unchanged = result(
    await request(owner, "GET", `${base}/circles/${circle.id}`),
    200,
  ).entity;
  assert.equal(
    unchanged.purpose,
    "Editado pelo coletivo",
    "governed column must remain unchanged after preflight denial",
  );

  // Replay authorization is checked against current policy before idempotency can return its old result.
  const replayWhileOn = result(
    await request(
      localMember,
      "POST",
      `${base}/circles/${circle.id}/memberships`,
      { memberId: newMemberId },
      undefined,
      associationKey,
    ),
    201,
  ).membership;
  assert.equal(replayWhileOn.id, associated.id);
  const endPath = `${base}/circle-memberships/${associated.id}/end`,
    endKey = randomUUID();
  assert.equal(
    (await request(parentOnly, "POST", endPath, {}, associated.version))
      .statusCode,
    403,
  );
  assert.equal(
    (await request(localMember, "POST", endPath, {})).statusCode,
    428,
  );
  assert.equal(
    (await request(localMember, "POST", endPath, {}, associated.version + 1))
      .statusCode,
    409,
  );
  const ended = result(
    await request(localMember, "POST", endPath, {}, associated.version, endKey),
    200,
  ).membership;
  assert.equal(ended.version, associated.version + 1);
  assert.equal(ended.origin, "EXPLICIT");
  assert.ok(ended.endsAt);
  const endReplay = result(
    await request(localMember, "POST", endPath, {}, associated.version, endKey),
    200,
  ).membership;
  assert.deepEqual(endReplay, ended);
  const endedHistory = await scopedQuery(
    "SELECT action,after_value->>'source' AS source FROM structure_history WHERE organization_id=$1 AND resource_id=$2 AND action IN ('CircleMembershipEnded','CollectiveActionAuthorized') ORDER BY action",
    [orgId, associated.id],
  );
  assert.ok(
    endedHistory.rows.some((row) => row.action === "CircleMembershipEnded"),
  );
  assert.ok(
    endedHistory.rows.some(
      (row) =>
        row.action === "CollectiveActionAuthorized" &&
        row.source === "COLLECTIVE",
    ),
  );
  const disabled = result(
    await request(
      owner,
      "PUT",
      `${base}/administration/policies/${policy.id}`,
      {
        value: {
          key: "structure.collectiveManagement",
          value: false,
          allowOverride: true,
          parentId: null,
        },
      },
      policy.version,
    ),
    200,
  );
  assert.ok(disabled);
  const replayWhileOff = await request(
    localMember,
    "POST",
    `${base}/circles/${circle.id}/memberships`,
    { memberId: newMemberId },
    undefined,
    associationKey,
  );
  assert.equal(replayWhileOff.statusCode, 403, replayWhileOff.body);
});

import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import type { Ctx, ModuleRuntime } from "../../server/src/runtime.js";
import {
  createAdministration,
  readOrganizationalPolicy,
} from "../../server/modules/administration/index.js";
import { workModule } from "../../server/modules/work/index.js";
import { createWorkApplicationPorts } from "../../server/modules/work/application.js";
import { createStructureModule } from "../../server/modules/structure/plugin.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { createStructureResourceAdapters } from "../../server/modules/structure/platform.js";
import type {
  StructurePortsOptions,
  CircleCreatedEvent,
} from "../../server/modules/structure/ports.js";
import { defaultFlags } from "../../server/modules/structure/domain.js";
let core: ModuleRuntime;
let ports: ReturnType<typeof createStructurePorts>;
let adapters: ReturnType<typeof createStructureResourceAdapters>;
let failObserver = false;
const observed: CircleCreatedEvent[] = [];
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, runtime) => {
    core = runtime;
    const work = createWorkApplicationPorts(core);
    const options: StructurePortsOptions = {
      organizationPolicy: async (ctx) => {
        const policy = await readOrganizationalPolicy(
          ctx,
          "structure.collectiveManagement",
        );
        return {
          enabled: policy?.value === true,
          allowCircleOverride: policy?.allowOverride ?? false,
          revision: policy?.revision ?? 0,
        };
      },
      onCircleCreated: async (ctx, input) => {
        observed.push(input);
        await work.onCircleCreated(ctx, input);
        if (failObserver) throw Error("injected observer failure");
      },
    };
    ports = createStructurePorts(core, options);
    adapters = createStructureResourceAdapters(core, options);
    core.registerFoundationStructure(ports);
    await createAdministration({
      validateOrganizationPolicyChange: async (ctx, next) => {
        await ports.validateOrganizationPolicyChange(ctx, next);
      },
    })(app, core);
    await workModule(app, core);
    await createStructureModule(options)(app, core);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  payload?: any,
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
      ...(version !== undefined ? { "if-match": '"' + version + '"' } : {}),
    },
  });
}
function data(r: any, status?: number) {
  assert.equal(
    r.statusCode,
    status ?? (r.statusCode === 201 ? 201 : 200),
    r.body,
  );
  return r.json().data;
}
async function user() {
  const r = await call("POST", "/auth/register", {
      email: randomUUID() + "@example.test",
      password: "structure-port-test-password",
      displayName: "Policy/observer tester",
    }),
    d = data(r, 201);
  return {
    id: d.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
async function ctx<T>(
  organizationId: string,
  actor: User,
  fn: (ctx: Ctx) => Promise<T>,
) {
  return transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      organizationId,
    ]);
    const org = (
      await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [
        organizationId,
      ])
    ).rows[0];
    const member = (
      await c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE'",
        [organizationId, actor.id],
      )
    ).rows[0];
    return fn({
      c,
      org,
      member,
      account: { id: actor.id },
      mode: "authorization_write",
    });
  });
}
test("real organization policy reader, circle-only collective allowlist, override/reconciliation and current admin expiry", async () => {
  const owner = await user(),
    member = await user(),
    admin = await user(),
    foreign = await user();
  const A = data(
      await call(
        "POST",
        "/organizations",
        { name: "Collective Aurora" },
        owner,
      ),
    ),
    B = data(
      await call(
        "POST",
        "/organizations",
        { name: "Collective Horizon" },
        foreign,
      ),
    );
  const p = "/organizations/" + A.organization.id,
    q = "/organizations/" + B.organization.id,
    base = p + "/structure-advanced";
  const root = data(
    await call("GET", p + "/bootstrap", undefined, owner),
  ).rootCircleId;
  const memberId = data(
      await call("POST", p + "/members", { accountId: member.id }, owner),
    ).membership.id,
    adminId = data(
      await call("POST", p + "/members", { accountId: admin.id }, owner),
    ).membership.id;
  const circle = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Círculo coletivo", parentCircleId: root },
      owner,
    ),
  ).circle;
  const child = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Filho sem herança", parentCircleId: circle.id },
      owner,
    ),
  ).circle;
  const selfMembership = data(
    await call(
      "POST",
      p + "/circles/" + circle.id + "/memberships",
      { memberId },
      owner,
    ),
  ).membership;
  assert.equal(
    await ctx(A.organization.id, member, (c) =>
      ports.authorizeLocalCircle(c, circle.id, "MEMBERSHIP_MANAGE"),
    ),
    false,
  );
  const policy = data(
    await call(
      "POST",
      p + "/administration/policies",
      {
        value: {
          key: "structure.collectiveManagement",
          value: true,
          allowOverride: true,
          parentId: null,
        },
      },
      owner,
    ),
    201,
  );
  assert.equal(
    data(
      await call(
        "GET",
        base + "/circles/" + circle.id + "/collective",
        undefined,
        member,
      ),
    ).source,
    "ORGANIZATION_DEFAULT",
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/circles/" + circle.id + "/collective",
        { enabled: false },
        member,
        0,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/circles/" + circle.id + "/policy",
        { governedFields: [] },
        member,
        0,
      )
    ).statusCode,
    403,
  );
  const displayPath = base + "/circles/" + circle.id + "/display-preferences";
  const display = data(
    await call(
      "PUT",
      displayPath,
      { labels: false, avatars: true, minimap: false },
      member,
      0,
    ),
  );
  assert.deepEqual(display.preferences, {
    labels: false,
    avatars: true,
    minimap: false,
  });
  assert.equal(
    data(await call("GET", displayPath, undefined, member)).version,
    1,
  );
  assert.equal(
    (
      await call(
        "PUT",
        displayPath,
        { labels: true, avatars: true, minimap: true, enabled: true },
        member,
        1,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "PUT",
        displayPath,
        { labels: true, avatars: true, minimap: true },
        member,
        0,
      )
    ).statusCode,
    409,
  );
  const associationKey = randomUUID();
  const associationBody = { memberId: adminId };
  const associated = data(
    await call(
      "POST",
      p + "/circles/" + circle.id + "/memberships",
      associationBody,
      member,
      undefined,
      associationKey,
    ),
    201,
  );
  const edited = data(
    await call(
      "PATCH",
      p + "/circles/" + circle.id,
      { mode: "DIRECT", purpose: "Aprender com vínculo local" },
      member,
      1,
    ),
  );
  assert.equal(edited.entity.purpose, "Aprender com vínculo local");
  assert.equal(
    (
      await call(
        "PATCH",
        p + "/circles/" + child.id,
        { mode: "DIRECT", purpose: "No cascade" },
        member,
        1,
      )
    ).statusCode,
    403,
  );
  await ctx(A.organization.id, member, async (c) => {
    assert.equal(
      await ports.authorizeLocalCircle(c, circle.id, "MEMBERSHIP_MANAGE"),
      true,
    );
    assert.equal(
      await ports.authorizeLocalCircle(c, circle.id, "CIRCLE_CONTENT_EDIT"),
      true,
    );
    assert.equal(
      await ports.authorizeLocalCircle(c, child.id, "MEMBERSHIP_MANAGE"),
      false,
    );
    assert.equal(
      await ports.authorizeLocalCircle(c, root, "MEMBERSHIP_MANAGE"),
      false,
    );
    assert.equal(await ports.authorizeCircle(c, circle.id, "ADMIN"), false);
    assert.equal(await ports.authorizeCircle(c, circle.id, "ASSIGN"), false);
    assert.equal(await ports.authorizeCircle(c, circle.id, "DECISION"), false);
    await ports.recordFoundationChange(c, {
      resourceId: circle.id,
      action: "CollectiveContractProbe",
      before: {},
      after: {},
    });
    assert.ok(
      (
        await c.c.query(
          "SELECT 1 FROM structure_history WHERE organization_id=$1 AND resource_id=$2 AND action='CollectiveActionAuthorized' AND after_value->>'source'='COLLECTIVE'",
          [c.org.id, circle.id],
        )
      ).rowCount,
    );
  });
  assert.equal(
    (
      await call(
        "GET",
        q + "/structure-advanced/circles/" + circle.id + "/collective",
        undefined,
        foreign,
      )
    ).statusCode,
    404,
  );
  const disabled = data(
    await call(
      "PUT",
      base + "/circles/" + circle.id + "/collective",
      { enabled: false },
      owner,
      0,
    ),
  );
  assert.equal(disabled.enabled, false);
  assert.equal(
    await ctx(A.organization.id, member, (c) =>
      ports.authorizeLocalCircle(c, circle.id, "MEMBERSHIP_MANAGE"),
    ),
    false,
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/circles/" + circle.id + "/collective",
        { enabled: true },
        member,
        disabled.version,
      )
    ).statusCode,
    403,
  );
  const enabled = data(
    await call(
      "PUT",
      base + "/circles/" + circle.id + "/collective",
      { enabled: true },
      owner,
      disabled.version,
    ),
  );
  await assert.rejects(() =>
    ctx(A.organization.id, owner, (c) =>
      ports.validateOrganizationPolicyChange(c, {
        enabled: true,
        allowCircleOverride: false,
        revision: policy.version + 1,
      }),
    ),
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/circles/" + circle.id + "/collective",
        { enabled: null },
        owner,
        disabled.version,
      )
    ).statusCode,
    409,
  );
  data(
    await call(
      "PUT",
      base + "/circles/" + circle.id + "/collective",
      { enabled: null },
      owner,
      enabled.version,
    ),
  );
  await ctx(A.organization.id, owner, (c) =>
    ports.validateOrganizationPolicyChange(c, {
      enabled: true,
      allowCircleOverride: false,
      revision: policy.version + 1,
    }),
  );
  const rootPolicyPath = p + "/administration/policies/" + policy.id;
  const locked = data(
    await call(
      "PUT",
      rootPolicyPath,
      {
        value: {
          key: "structure.collectiveManagement",
          value: true,
          allowOverride: false,
          parentId: null,
        },
      },
      owner,
      policy.version,
    ),
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/circles/" + circle.id + "/collective",
        { enabled: false },
        owner,
        3,
      )
    ).statusCode,
    422,
  );
  const off = data(
    await call(
      "PUT",
      rootPolicyPath,
      {
        value: {
          key: "structure.collectiveManagement",
          value: false,
          allowOverride: false,
          parentId: null,
        },
      },
      owner,
      locked.version,
    ),
  );
  assert.equal(
    await ctx(A.organization.id, member, (c) =>
      ports.authorizeLocalCircle(c, circle.id, "MEMBERSHIP_MANAGE"),
    ),
    false,
  );
  data(
    await call(
      "PUT",
      rootPolicyPath,
      {
        value: {
          key: "structure.collectiveManagement",
          value: true,
          allowOverride: true,
          parentId: null,
        },
      },
      owner,
      off.version,
    ),
  );
  const role = data(
    await call(
      "POST",
      p + "/roles",
      { mode: "DIRECT", name: "Administrador vigente", circleId: circle.id },
      owner,
    ),
  ).role;
  data(
    await call(
      "PUT",
      base + "/roles/" + role.id + "/settings",
      { flags: { ...defaultFlags, admin: true } },
      owner,
      0,
    ),
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/roles/" + role.id + "/settings",
        { flags: defaultFlags },
        member,
        1,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles/" + role.id + "/occupancies",
        { memberId, kind: "DIRECT" },
        member,
      )
    ).statusCode,
    403,
  );
  const mandate = data(
    await call(
      "POST",
      base + "/mandates",
      {
        roleId: role.id,
        memberId: adminId,
        kind: "INTERIM",
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      },
      owner,
    ),
    201,
  );
  assert.equal(
    await ctx(A.organization.id, member, (c) =>
      ports.authorizeLocalCircle(c, circle.id, "MEMBERSHIP_MANAGE"),
    ),
    false,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/circles/" + circle.id + "/memberships",
        associationBody,
        member,
        undefined,
        associationKey,
      )
    ).statusCode,
    403,
  );
  await ctx(A.organization.id, owner, async (c) => {
    await c.c.query(
      "UPDATE structure_mandates SET starts_at=clock_timestamp()-interval '10 seconds',ends_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
      [c.org.id, mandate.id],
    );
  });
  assert.equal(
    await ctx(A.organization.id, member, (c) =>
      ports.authorizeLocalCircle(c, circle.id, "MEMBERSHIP_MANAGE"),
    ),
    true,
  );
  assert.equal(
    data(
      await call(
        "POST",
        p + "/circles/" + circle.id + "/memberships",
        associationBody,
        member,
        undefined,
        associationKey,
      ),
      201,
    ).membership.id,
    associated.membership.id,
  );
  data(
    await call(
      "PUT",
      base + "/circles/" + circle.id + "/policy",
      { governedFields: ["purpose"] },
      owner,
      0,
    ),
  );
  assert.equal(
    (
      await call(
        "PATCH",
        p + "/circles/" + circle.id,
        { mode: "DIRECT", purpose: "Governed cannot bypass" },
        member,
        2,
      )
    ).statusCode,
    422,
  );
  await assert.rejects(() =>
    ctx(A.organization.id, member, (c) =>
      ports.preflightEntityChange(c, {
        operation: "UPDATE",
        entityId: circle.id,
        changedFields: ["purpose"],
      }),
    ),
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/circles/" + circle.id + "/collective",
        { enabled: "true" },
        owner,
        3,
      )
    ).statusCode,
    400,
  );
  const endKey = randomUUID();
  const endPath = p + "/circle-memberships/" + selfMembership.id + "/end";
  data(
    await call("POST", endPath, {}, member, selfMembership.version, endKey),
    200,
  );
  assert.equal(
    (await call("POST", endPath, {}, member, selfMembership.version, endKey))
      .statusCode,
    403,
  );
});
test("canonical circle creation event/clock observer covers foundation, changeset and import; rollback, dedup, no rename/restore replay", async () => {
  const owner = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Canonical creation" }, owner),
  );
  const p = "/organizations/" + A.organization.id;
  const root = data(
    await call("GET", p + "/bootstrap", undefined, owner),
  ).rootCircleId;
  const old = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Before enabling", parentCircleId: root },
      owner,
    ),
  ).circle;
  const oldEvent = observed.find((x) => x.circleId === old.id)!;
  assert.ok(oldEvent.eventId);
  assert.match(oldEvent.occurredAt, /\.\d{6}Z$/);
  data(
    await call(
      "POST",
      p + "/work/settings",
      { autoCreateForNewCircles: true },
      owner,
      0,
    ),
  );
  const key = randomUUID();
  const body = {
    mode: "DIRECT",
    name: "Auto project live",
    parentCircleId: root,
  };
  const live = data(
    await call("POST", p + "/circles", body, owner, undefined, key),
  ).circle;
  assert.equal(
    data(await call("POST", p + "/circles", body, owner, undefined, key)).circle
      .id,
    live.id,
  );
  let projects = data(
    await call("GET", p + "/work/projects", undefined, owner),
  ).projects;
  assert.equal(projects.filter((x: any) => x.circleId === live.id).length, 1);
  assert.equal(projects.filter((x: any) => x.circleId === old.id).length, 0);
  await ctx(A.organization.id, owner, (c) =>
    createWorkApplicationPorts(core).onCircleCreated(c, oldEvent),
  );
  assert.equal(
    data(
      await call("GET", p + "/work/projects", undefined, owner),
    ).projects.filter((x: any) => x.circleId === old.id).length,
    0,
  );
  const created = randomUUID();
  await ctx(A.organization.id, owner, (c) =>
    ports.applyStructure(c, {
      proposalId: randomUUID(),
      revision: 1,
      changes: [
        {
          kind: "CREATE",
          entityId: created,
          entityKind: "CIRCLE",
          parentCircleId: root,
          name: "Changeset circle",
          purpose: "",
        },
      ],
    }),
  );
  assert.equal(
    data(
      await call("GET", p + "/work/projects", undefined, owner),
    ).projects.filter((x: any) => x.circleId === created).length,
    1,
  );
  const imported = randomUUID();
  await ctx(A.organization.id, owner, async (c) => {
    const plan = await adapters.circle.validateImport!(
      c,
      [
        {
          schema: "orgmap-structure-v1",
          id: imported,
          kind: "CIRCLE",
          parentCircleId: root,
          name: "Imported circle",
          purpose: "",
        },
      ],
      "STRUCTURE",
    );
    await adapters.circle.applyImport!(c, plan.plan, "STRUCTURE");
  });
  assert.equal(
    data(
      await call("GET", p + "/work/projects", undefined, owner),
    ).projects.filter((x: any) => x.circleId === imported).length,
    1,
  );
  await ctx(A.organization.id, owner, async (c) => {
    const before = (
      await c.c.query(
        "SELECT * FROM entities WHERE organization_id=$1 AND id=$2",
        [c.org.id, imported],
      )
    ).rows[0];
    await ports.applyStructure(c, {
      proposalId: randomUUID(),
      revision: 1,
      changes: [
        {
          kind: "UPDATE",
          entityId: imported,
          baseVersion: before.version,
          name: "Renamed only",
        },
      ],
    });
    assert.equal(
      (
        await c.c.query(
          "SELECT * FROM structure_circle_creations WHERE organization_id=$1 AND circle_id=$2",
          [c.org.id, imported],
        )
      ).rowCount,
      1,
    );
    const event = (
      await c.c.query(
        "SELECT e.* FROM domain_events e JOIN structure_circle_creations sc ON sc.organization_id=e.organization_id AND sc.event_id=e.id WHERE sc.organization_id=$1 AND sc.circle_id=$2",
        [c.org.id, imported],
      )
    ).rows[0];
    assert.equal(event.action, "StructureCircleCreated");
    assert.equal(event.resource_id, imported);
    const exact = (
      await c.c.query(
        "SELECT e.at=sc.occurred_at AS same_clock FROM domain_events e JOIN structure_circle_creations sc ON sc.organization_id=e.organization_id AND sc.event_id=e.id WHERE sc.organization_id=$1 AND sc.circle_id=$2",
        [c.org.id, imported],
      )
    ).rows[0];
    assert.equal(exact.same_clock, true);
  });
  await ctx(A.organization.id, owner, async (c) => {
    await ports.applyStructure(c, {
      proposalId: randomUUID(),
      revision: 1,
      changes: [{ kind: "ARCHIVE", entityId: imported, baseVersion: 2 }],
    });
    await ports.applyStructure(c, {
      proposalId: randomUUID(),
      revision: 1,
      changes: [{ kind: "RESTORE", entityId: imported, baseVersion: 3 }],
    });
  });
  assert.equal(observed.filter((e) => e.circleId === imported).length, 1);
  const beforeGraph = data(
    await call("GET", p + "/structure-advanced/graph", undefined, owner),
  ).entities.length;
  const beforeProjects = data(
    await call("GET", p + "/work/projects", undefined, owner),
  ).projects.length;
  failObserver = true;
  const failed = await call(
    "POST",
    p + "/circles",
    { mode: "DIRECT", name: "Rollback callback", parentCircleId: root },
    owner,
  );
  failObserver = false;
  assert.equal(failed.statusCode, 500);
  assert.equal(
    data(await call("GET", p + "/structure-advanced/graph", undefined, owner))
      .entities.length,
    beforeGraph,
  );
  assert.equal(
    data(await call("GET", p + "/work/projects", undefined, owner)).projects
      .length,
    beforeProjects,
  );
  await ctx(A.organization.id, owner, async (c) => {
    const last = observed.at(-1)!;
    assert.equal(
      (
        await c.c.query(
          "SELECT 1 FROM structure_circle_creations WHERE organization_id=$1 AND circle_id=$2",
          [c.org.id, last.circleId],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await c.c.query(
          "SELECT 1 FROM domain_events WHERE organization_id=$1 AND id=$2",
          [c.org.id, last.eventId],
        )
      ).rowCount,
      0,
    );
  });
  assert.equal(observed.filter((x) => x.circleId === live.id).length, 1);
});

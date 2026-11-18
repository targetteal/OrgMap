import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import type { Ctx, ModuleRuntime } from "../../server/src/runtime.js";
import { createStructureModule } from "../../server/modules/structure/plugin.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { createStructureResourceAdapters } from "../../server/modules/structure/platform.js";
import { createStructureGuestAccessAdapter } from "../../server/modules/structure/guest.js";
import {
  defaultFlags,
  initialView,
} from "../../server/modules/structure/domain.js";
let core: ModuleRuntime;
let ports: ReturnType<typeof createStructurePorts>;
let adapters: ReturnType<typeof createStructureResourceAdapters>;
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, runtime) => {
    core = runtime;
    const options = {
      guestStructureScope: (ctx: Ctx) => core.guestStructureScope(ctx),
    };
    ports = createStructurePorts(core, options);
    adapters = createStructureResourceAdapters(core, options);
    core.registerFoundationStructure(ports);
    core.registerGuestAccessAdapter(
      createStructureGuestAccessAdapter(core, options),
    );
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
      password: "guest-leadlink-test-password",
      displayName: "Scoped tester",
    }),
    d = data(r, 201);
  return {
    id: d.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
async function ctx<T>(
  orgId: string,
  actor: User,
  fn: (ctx: Ctx) => Promise<T>,
) {
  return transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      orgId,
    ]);
    const org = (
      await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [
        orgId,
      ])
    ).rows[0];
    const member = (
      await c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE'",
        [orgId, actor.id],
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
const share = (kind: "circle" | "role", id: string) => ({
  resource: { context: "structure", kind, id },
  actions: ["read"],
});
test("real Guest IAM: explicit forest in all views/search/worker, no parent/descendant/metadata leak, current revoke/type boundaries", async () => {
  const owner = await user(),
    guest = await user(),
    emptyGuest = await user(),
    normal = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Guest forest A" }, owner),
    ),
    B = data(
      await call(
        "POST",
        "/organizations",
        { name: "Same account owns B" },
        guest,
      ),
    );
  const p = "/organizations/" + A.organization.id,
    q = "/organizations/" + B.organization.id,
    base = p + "/structure-advanced";
  const root = data(
      await call("GET", p + "/bootstrap", undefined, owner),
    ).rootCircleId,
    rootB = data(
      await call("GET", q + "/bootstrap", undefined, guest),
    ).rootCircleId;
  const hidden = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Hidden ancestor", parentCircleId: root },
      owner,
    ),
  ).circle;
  const shared = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Shared circle", parentCircleId: hidden.id },
      owner,
    ),
  ).circle;
  const child = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Hidden descendant", parentCircleId: shared.id },
      owner,
    ),
  ).circle;
  const role = data(
    await call(
      "POST",
      p + "/roles",
      { mode: "DIRECT", name: "Shared role", circleId: root },
      owner,
    ),
  ).role;
  const membership = data(
    await call(
      "POST",
      p + "/members",
      {
        accountId: guest.id,
        memberType: "GUEST",
        accessPlan: [share("circle", shared.id), share("role", role.id)],
      },
      owner,
    ),
    201,
  ).membership;
  data(
    await call(
      "POST",
      p + "/members",
      { accountId: emptyGuest.id, memberType: "GUEST", accessPlan: [] },
      owner,
    ),
    201,
  );
  const normalMember = data(
    await call("POST", p + "/members", { accountId: normal.id }, owner),
    201,
  ).membership;
  const boot = data(await call("GET", p + "/bootstrap", undefined, guest));
  assert.equal(boot.rootCircleId, null);
  assert.equal(boot.membership.memberType, "GUEST");
  assert.equal(
    data(await call("GET", base + "/graph", undefined, emptyGuest)).entities
      .length,
    0,
  );
  for (const view of ["PACK", "TREE", "DIRECTORY", "NETWORK"]) {
    const graph = data(
      await call(
        "GET",
        base +
          "/graph?config=" +
          encodeURIComponent(JSON.stringify({ ...initialView, view })),
        undefined,
        guest,
      ),
    );
    assert.deepEqual(
      new Set(graph.entities.map((e: any) => e.id)),
      new Set([shared.id, role.id]),
    );
    assert.ok(
      graph.entities.every(
        (e: any) => e.parentId === null && e.pathRedacted === true,
      ),
    );
    assert.ok(graph.entities.every((e: any) => !Object.hasOwn(e, "flags")));
    const raw = JSON.stringify(graph);
    for (const hiddenId of [root, hidden.id, child.id, rootB])
      assert.ok(!raw.includes(hiddenId));
    assert.equal(graph.coverage.scope, "AUTHORIZED_FOREST");
  }
  const forest = data(await call("GET", p + "/structure", undefined, guest));
  assert.deepEqual(
    new Set(forest.nodes.map((n: any) => n.entityId)),
    new Set([shared.id, role.id]),
  );
  assert.ok(
    forest.nodes.every((n: any) => n.parentNodeId === null && n.pathRedacted),
  );
  assert.equal(
    (
      await call(
        "GET",
        base +
          "/graph?config=" +
          encodeURIComponent(JSON.stringify({ ...initialView, rootId: root })),
        undefined,
        guest,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("GET", p + "/circles/" + hidden.id, undefined, guest))
      .statusCode,
    404,
  );
  const detail = data(
    await call("GET", p + "/roles/" + role.id, undefined, guest),
  ).entity;
  assert.equal(detail.circleId, null);
  assert.equal(detail.parentCircleId, null);
  assert.equal(detail.pathRedacted, true);
  for (const route of [
    "/catalog",
    "/circles/" + shared.id + "/policy",
    "/circles/" + shared.id + "/collective",
    "/entities/" + shared.id + "/history",
    "/roles/" + role.id + "/function",
  ])
    assert.equal(
      (await call("GET", base + route, undefined, guest)).statusCode,
      404,
    );
  assert.ok(
    [403, 404].includes(
      (
        await call(
          "PUT",
          base + "/circles/" + shared.id + "/display-preferences",
          { labels: false, avatars: false, minimap: false },
          guest,
          0,
        )
      ).statusCode,
    ),
  );
  assert.ok(
    [403, 404].includes(
      (
        await call(
          "POST",
          p + "/circles/" + shared.id + "/memberships",
          { memberId: normalMember.id },
          guest,
        )
      ).statusCode,
    ),
  );
  await ctx(A.organization.id, guest, async (c) => {
    assert.equal(await adapters.circle.authorize(c, shared.id, "read"), true);
    assert.equal(await adapters.circle.authorize(c, hidden.id, "read"), false);
    assert.equal(
      await adapters.circle.authorize(c, shared.id, "export"),
      false,
    );
    assert.deepEqual(
      (await adapters.circle.search!(c, "", 10)).map((x) => x.id),
      [shared.id],
    );
    assert.equal(
      await ports.authorizeLocalCircle(c, shared.id, "MEMBERSHIP_MANAGE"),
      false,
    );
    await assert.rejects(() =>
      adapters.circle.export!(c, [shared.id], "STRUCTURE"),
    );
  });
  const worker = await core.withResourceWorkerContext(
    A.organization.id,
    membership.id,
    [{ resource: share("circle", shared.id).resource, action: "read" }],
    (c) => ports.structureForest(c),
  );
  assert.deepEqual(
    new Set(worker.nodes.map((n) => n.entityId)),
    new Set([shared.id, role.id]),
  );
  assert.ok(
    data(await call("GET", q + "/structure", undefined, guest)).nodes.some(
      (n: any) => n.entityId === rootB,
    ),
  );
  assert.equal(
    (await call("GET", p + "/circles/" + rootB, undefined, guest)).statusCode,
    404,
  );
  const grants = data(
    await call(
      "GET",
      p + "/members/" + membership.id + "/access-grants",
      undefined,
      owner,
    ),
  ).items;
  const circleGrant = grants.find((g: any) => g.resourceId === shared.id);
  data(
    await call(
      "POST",
      p +
        "/members/" +
        membership.id +
        "/access-grants/" +
        circleGrant.id +
        "/revoke",
      {},
      owner,
      circleGrant.version,
    ),
  );
  assert.deepEqual(
    data(await call("GET", base + "/graph", undefined, guest)).entities.map(
      (e: any) => e.id,
    ),
    [role.id],
  );
  await assert.rejects(() =>
    core.withResourceWorkerContext(
      A.organization.id,
      membership.id,
      [{ resource: share("circle", shared.id).resource, action: "read" }],
      (c) => ports.structureForest(c),
    ),
  );
  const sharer = await user();
  const sharerId = data(
    await call("POST", p + "/members", { accountId: sharer.id }, owner),
  ).membership.id;
  const shareRole = data(
    await call(
      "POST",
      p + "/roles",
      {
        mode: "DIRECT",
        name: "Explicit share administrator",
        circleId: shared.id,
      },
      owner,
    ),
  ).role;
  data(
    await call(
      "PUT",
      base + "/roles/" + shareRole.id + "/settings",
      { flags: { ...defaultFlags, admin: true } },
      owner,
      0,
    ),
  );
  const shareMandate = data(
    await call(
      "POST",
      base + "/mandates",
      {
        roleId: shareRole.id,
        memberId: sharerId,
        kind: "INTERIM",
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      },
      owner,
    ),
    201,
  );
  await ctx(A.organization.id, sharer, (c) =>
    core.applyGuestAccessPlan(c, membership.id, [share("circle", shared.id)]),
  );
  assert.ok(
    data(await call("GET", base + "/graph", undefined, guest)).entities.some(
      (e: any) => e.id === shared.id,
    ),
  );
  data(
    await call(
      "POST",
      base + "/mandates/" + shareMandate.id + "/end",
      {},
      owner,
      shareMandate.version,
    ),
  );
  assert.ok(
    !data(await call("GET", base + "/graph", undefined, guest)).entities.some(
      (e: any) => e.id === shared.id,
    ),
  );
  await assert.rejects(() =>
    core.withResourceWorkerContext(
      A.organization.id,
      membership.id,
      [{ resource: share("circle", shared.id).resource, action: "read" }],
      (c) => ports.structureForest(c),
    ),
  );
  assert.ok(
    data(await call("GET", base + "/graph", undefined, normal)).entities
      .length > 2,
  );
  data(
    await call(
      "POST",
      p + "/members/" + normalMember.id + "/actions/change-type",
      { memberType: "GUEST", confirmVisibilityChange: true },
      owner,
      normalMember.version,
    ),
  );
  assert.equal(
    data(await call("GET", base + "/graph", undefined, normal)).entities.length,
    0,
  );
  assert.ok(
    data(await call("GET", q + "/structure", undefined, guest)).nodes.some(
      (n: any) => n.entityId === rootB,
    ),
  );
});
test("explicit LEAD_LINK function: no name/admin/owner inference, active occupancy and immediate source/function revocation", async () => {
  const owner = await user(),
    actor = await user();
  const A = data(
    await call(
      "POST",
      "/organizations",
      { name: "Lead link canonical" },
      owner,
    ),
  );
  const p = "/organizations/" + A.organization.id,
    base = p + "/structure-advanced";
  const root = data(
    await call("GET", p + "/bootstrap", undefined, owner),
  ).rootCircleId;
  const ownerId = data(await call("GET", p + "/bootstrap", undefined, owner))
    .membership.id;
  const mid = data(
    await call("POST", p + "/members", { accountId: actor.id }, owner),
  ).membership.id;
  const circle = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Lead link scope", parentCircleId: root },
      owner,
    ),
  ).circle;
  const role = data(
    await call(
      "POST",
      p + "/roles",
      { mode: "DIRECT", name: "Lead Link", circleId: circle.id },
      owner,
    ),
  ).role;
  data(
    await call(
      "PUT",
      base + "/roles/" + role.id + "/settings",
      { flags: { ...defaultFlags, admin: true, core: true } },
      owner,
      0,
    ),
  );
  const occupancy = data(
    await call(
      "POST",
      p + "/roles/" + role.id + "/occupancies",
      { memberId: mid, kind: "DIRECT" },
      owner,
    ),
  ).occupancy;
  assert.equal(
    await ctx(A.organization.id, owner, (c) =>
      ports.isLeadLink(c, { circleId: circle.id, memberId: mid }),
    ),
    false,
  );
  assert.equal(
    await ctx(A.organization.id, owner, (c) =>
      ports.isLeadLink(c, { circleId: circle.id, memberId: ownerId }),
    ),
    false,
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/roles/" + role.id + "/function",
        { functionCode: "LEAD_LINK" },
        actor,
        0,
      )
    ).statusCode,
    403,
  );
  const fn = data(
    await call(
      "PUT",
      base + "/roles/" + role.id + "/function",
      { functionCode: "LEAD_LINK" },
      owner,
      0,
    ),
  );
  assert.equal(fn.version, 1);
  assert.equal(
    data(
      await call(
        "GET",
        base + "/roles/" + role.id + "/function",
        undefined,
        owner,
      ),
    ).capabilities.manage,
    true,
  );
  assert.equal(
    data(
      await call(
        "GET",
        base + "/roles/" + role.id + "/function",
        undefined,
        actor,
      ),
    ).capabilities.manage,
    false,
  );
  assert.equal(
    await ctx(A.organization.id, owner, (c) =>
      ports.isLeadLink(c, { circleId: circle.id, memberId: mid }),
    ),
    true,
  );
  assert.equal(
    await ctx(A.organization.id, owner, (c) =>
      ports.isLeadLink(c, { circleId: root, memberId: mid }),
    ),
    false,
  );
  const second = data(
    await call(
      "POST",
      base + "/mandates",
      {
        roleId: role.id,
        memberId: mid,
        kind: "DIRECT",
        startsAt: new Date(Date.now() - 1000).toISOString(),
      },
      owner,
    ),
    201,
  );
  data(
    await call(
      "POST",
      p + "/occupancies/" + occupancy.id + "/end",
      {},
      owner,
      occupancy.version,
    ),
  );
  assert.equal(
    await ctx(A.organization.id, owner, (c) =>
      ports.isLeadLink(c, { circleId: circle.id, memberId: mid }),
    ),
    true,
  );
  const revoked = data(
    await call(
      "PUT",
      base + "/roles/" + role.id + "/function",
      { functionCode: null },
      owner,
      1,
    ),
  );
  assert.equal(revoked.version, 2);
  assert.equal(
    await ctx(A.organization.id, owner, (c) =>
      ports.isLeadLink(c, { circleId: circle.id, memberId: mid }),
    ),
    false,
  );
  data(
    await call(
      "PUT",
      base + "/roles/" + role.id + "/function",
      { functionCode: "LEAD_LINK" },
      owner,
      2,
    ),
  );
  data(
    await call(
      "POST",
      base + "/mandates/" + second.id + "/end",
      {},
      owner,
      second.version,
    ),
  );
  assert.equal(
    await ctx(A.organization.id, owner, (c) =>
      ports.isLeadLink(c, { circleId: circle.id, memberId: mid }),
    ),
    false,
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/roles/" + role.id + "/function",
        { functionCode: "LEAD_LINK" },
        owner,
        1,
      )
    ).statusCode,
    409,
  );
});

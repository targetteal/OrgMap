import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import type { Ctx, ModuleRuntime } from "../../server/src/runtime.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { createRoleCapacityPort } from "../../server/modules/structure/role-capacity.js";
let core: ModuleRuntime;
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (_app, runtime) => {
    core = runtime;
    core.registerFoundationStructure(createStructurePorts(core));
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
const origin = "http://localhost:5173";
async function user() {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin },
    payload: {
      email: randomUUID() + "@example.test",
      password: "role-capacity-test-password",
      displayName: "Capacity QA",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    ...r.json().data,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
  };
}
async function call(
  actor: any,
  method: string,
  path: string,
  payload?: object,
) {
  const r = await app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin,
      cookie: actor.cookie,
      "x-csrf-token": actor.csrfToken,
      "idempotency-key": randomUUID(),
    },
    payload,
  });
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return r.json().data;
}
test("real current RoleCapacity: exact role, multiple origins, PG clock, revoke/expiry/suspension/Guest/vacancy and tenant", async () => {
  const owner = await user(),
    a = await user(),
    b = await user();
  const org = await call(owner, "POST", "/organizations", {
      name: "Role capacity A",
    }),
    orgB = await call(owner, "POST", "/organizations", {
      name: "Role capacity B",
    });
  const base = "/organizations/" + org.organization.id;
  const ma = (
    await call(owner, "POST", base + "/members", { accountId: a.account.id })
  ).membership;
  const mb = (
    await call(owner, "POST", base + "/members", { accountId: b.account.id })
  ).membership;
  const role = (
    await call(owner, "POST", base + "/roles", {
      name: "Nome arbitrário sem função",
      circleId: org.rootCircle.id,
      mode: "DIRECT",
    })
  ).role;
  const vacancy = (
    await call(owner, "POST", base + "/roles", {
      name: "Elo de ligação",
      circleId: org.rootCircle.id,
      mode: "DIRECT",
    })
  ).role;
  const foreign = (
    await call(
      owner,
      "POST",
      "/organizations/" + orgB.organization.id + "/roles",
      { name: "Foreign", circleId: orgB.rootCircle.id, mode: "DIRECT" },
    )
  ).role;
  async function ctx<T>(fn: (ctx: Ctx) => Promise<T>) {
    return transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        org.organization.id,
      ]);
      const o = (
        await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [
          org.organization.id,
        ])
      ).rows[0];
      const m = (
        await c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",
          [org.organization.id, owner.account.id],
        )
      ).rows[0];
      return fn({
        c,
        org: o,
        member: m,
        account: owner.account,
        mode: "authorization_write",
      });
    });
  }
  const resolver = createRoleCapacityPort(core);
  const resolve = () =>
    ctx((c) => resolver.resolveRoleCapacity(c, { roleId: role.id }));
  assert.deepEqual((await resolve()).occupants, []);
  const baseSource = randomUUID(),
    interim = randomUUID(),
    elected = randomUUID(),
    future = randomUUID(),
    expired = randomUUID();
  await ctx(async (c) => {
    await c.c.query(
      "INSERT INTO occupancies(organization_id,id,member_id,role_id,kind,starts_at) VALUES($1,$2,$3,$4,'DIRECT',clock_timestamp()-interval '1 hour')",
      [c.org.id, baseSource, ma.id, role.id],
    );
    for (const [sourceId, memberId, kind, start, end] of [
      [interim, ma.id, "INTERIM", "-1 hour", "1 hour"],
      [elected, mb.id, "ELECTED", "-1 hour", "1 hour"],
      [future, ma.id, "DIRECT", "1 hour", "2 hours"],
      [expired, mb.id, "INTERIM", "-2 hours", "-1 hour"],
    ])
      await c.c.query(
        "INSERT INTO structure_mandates(organization_id,id,role_id,member_id,kind,starts_at,ends_at,scope,proposal_id,proposal_revision) VALUES($1,$2,$3,$4,$5,clock_timestamp()+$6::interval,clock_timestamp()+$7::interval,'',$8,$9)",
        [
          c.org.id,
          sourceId,
          role.id,
          memberId,
          kind,
          start,
          end,
          kind === "ELECTED" ? randomUUID() : null,
          kind === "ELECTED" ? 1 : null,
        ],
      );
  });
  const initial = await resolve();
  assert.equal(initial.roleId, role.id);
  assert.equal(initial.circleId, org.rootCircle.id);
  assert.equal(initial.roleVersion, 1);
  assert.match(initial.asOf, /\.\d{6}Z$/);
  assert.ok(Number.isSafeInteger(initial.authorizationRevision));
  assert.deepEqual(
    initial.occupants.map((x) => x.memberId).sort(),
    [ma.id, mb.id].sort(),
  );
  const origins = initial.occupants.find((x) => x.memberId === ma.id)!.origins;
  assert.equal(origins.length, 2);
  assert.deepEqual(
    new Set(origins.map((o) => o.source)),
    new Set(["OCCUPANCY", "MANDATE"]),
  );
  assert.equal(
    initial.occupants.find((x) => x.memberId === mb.id)!.origins[0].kind,
    "ELECTED",
  );
  assert.deepEqual(
    (await ctx((c) => resolver.resolveRoleCapacity(c, { roleId: vacancy.id })))
      .occupants,
    [],
  );
  await assert.rejects(
    () => ctx((c) => resolver.resolveRoleCapacity(c, { roleId: foreign.id })),
    /RESOURCE_NOT_FOUND/,
  );
  await assert.rejects(
    () =>
      ctx((c) =>
        resolver.resolveRoleCapacity(c, { roleId: org.rootCircle.id }),
      ),
    /RESOURCE_NOT_FOUND/,
  );
  await ctx(async (c) => {
    await c.c.query(
      "UPDATE structure_mandates SET ended_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
      [c.org.id, interim],
    );
    await c.c.query(
      "UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND id=$2",
      [c.org.id, mb.id],
    );
  });
  assert.equal((await resolve()).occupants.length, 1);
  assert.equal((await resolve()).occupants[0].origins[0].sourceId, baseSource);
  await ctx(async (c) => {
    await c.c.query(
      "UPDATE occupancies SET ends_at=clock_timestamp()-interval '1 microsecond' WHERE organization_id=$1 AND id=$2",
      [c.org.id, baseSource],
    );
    // Reactivation does not resurrect an expired mandate.
    await c.c.query(
      "UPDATE members SET status='ACTIVE' WHERE organization_id=$1 AND id=$2",
      [c.org.id, mb.id],
    );
    await c.c.query(
      "UPDATE structure_mandates SET ends_at=clock_timestamp()-interval '1 microsecond' WHERE organization_id=$1 AND id=$2",
      [c.org.id, elected],
    );
  });
  assert.deepEqual((await resolve()).occupants, []);
  await ctx(async (c) => {
    await c.c.query(
      "UPDATE occupancies SET ends_at=NULL WHERE organization_id=$1 AND id=$2",
      [c.org.id, baseSource],
    );
    await c.c.query(
      "UPDATE members SET member_type='GUEST' WHERE organization_id=$1 AND id=$2",
      [c.org.id, ma.id],
    );
  });
  assert.deepEqual((await resolve()).occupants, []);
  await ctx(async (c) => {
    // A stale ctx.member cannot bypass a current Guest downgrade.
    await assert.rejects(
      () =>
        resolver.resolveRoleCapacity(
          {
            ...c,
            member: { id: ma.id, member_type: "MEMBER", status: "ACTIVE" },
            account: a.account,
          },
          { roleId: role.id },
        ),
      /ACTION_DENIED/,
    );
    await c.c.query(
      "UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND id=$2",
      [c.org.id, c.member.id],
    );
    await assert.rejects(
      () => resolver.resolveRoleCapacity(c, { roleId: role.id }),
      /ACTION_DENIED/,
    );
    await c.c.query(
      "UPDATE members SET status='ACTIVE' WHERE organization_id=$1 AND id=$2",
      [c.org.id, c.member.id],
    );
  });
  await ctx(async (c) => {
    const old = Number(c.org.authorization_revision);
    await c.c.query(
      "UPDATE organizations SET authorization_revision=authorization_revision+3 WHERE id=$1",
      [c.org.id],
    );
    assert.equal(
      (await resolver.resolveRoleCapacity(c, { roleId: role.id }))
        .authorizationRevision,
      old + 3,
    );
    await c.c.query(
      "UPDATE entities SET archived=true WHERE organization_id=$1 AND id=$2",
      [c.org.id, role.id],
    );
    await assert.rejects(
      () => resolver.resolveRoleCapacity(c, { roleId: role.id }),
      /RESOURCE_NOT_FOUND/,
    );
  });
});

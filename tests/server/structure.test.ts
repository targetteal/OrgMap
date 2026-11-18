import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { createStructureResourceAdapters } from "../../server/modules/structure/platform.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { createRuntime } from "../../server/src/runtime.js";
import { registerContext } from "../../server/modules/structure/plugin.js";
import { StructureService } from "../../server/modules/structure/service.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import {
  defaultFlags,
  fieldSchema,
  fieldValue,
} from "../../server/modules/structure/domain.js";
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    core.registerFoundationStructure(createStructurePorts(core));
    await registerContext(app, core);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
type User = { id: string; cookie: string; csrf: string };
async function call(
  method: string,
  path: string,
  b?: any,
  u?: User,
  extra: Record<string, string> = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...extra,
    },
    payload: b,
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
    password: "secure-password-12345",
    displayName: "Structure synthetic",
  });
  const d = data(r);
  return {
    id: d.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
const match = (v: number) => ({ "if-match": '"' + v + '"' });
test("typed field schemas reject coercion, computed governance and malformed unions", () => {
  assert.throws(() =>
    fieldSchema({ type: "NUMBER", required: true, extra: 1 }),
  );
  for (const v of ["2", Infinity, NaN])
    assert.throws(() => fieldValue({ type: "NUMBER", required: true }, v));
  assert.throws(() => fieldValue({ type: "BOOLEAN", required: true }, "false"));
  assert.throws(() =>
    fieldValue({ type: "MULTI", required: true, options: ["x"] }, ["x", "x"]),
  );
});
test("real PG: flags and multiple origins, tenant/ACL, clock expiry, fields/version/races, records, aliases, views and transactional applier", async () => {
  const a = await user(),
    b = await user(),
    m = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Aurora structure" }, a),
    ),
    B = data(
      await call("POST", "/organizations", { name: "Horizonte structure" }, b),
    );
  const p = "/organizations/" + A.organization.id,
    q = "/organizations/" + B.organization.id,
    base = p + "/structure-advanced";
  const boot = data(await call("GET", p + "/bootstrap", undefined, a));
  const root = boot.rootCircleId;
  const member = data(
    await call("POST", p + "/members", { accountId: m.id }, a),
  ).membership;
  const c = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Pesquisa inédita", parentCircleId: root },
      a,
    ),
  ).circle;
  const d = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Outro círculo", parentCircleId: root },
      a,
    ),
  ).circle;
  const child = data(
    await call(
      "POST",
      p + "/circles",
      { mode: "DIRECT", name: "Filho local", parentCircleId: c.id },
      a,
    ),
  ).circle;
  const r = data(
    await call(
      "POST",
      p + "/roles",
      { mode: "DIRECT", name: "Guardiã de ensaios", circleId: c.id },
      a,
    ),
  ).role;
  const template = data(
    await call(
      "POST",
      base + "/templates",
      {
        name: "Eleito representativo",
        flags: {
          ...defaultFlags,
          electable: true,
          core: true,
          admin: true,
          assigner: true,
          representative: true,
        },
      },
      a,
    ),
    201,
  );
  const settings = data(
    await call(
      "PUT",
      base + "/roles/" + r.id + "/settings",
      { templateId: template.id },
      a,
      match(0),
    ),
  );
  assert.equal(settings.version, 1);
  assert.equal(
    (
      await call(
        "POST",
        p + "/roles/" + r.id + "/occupancies",
        { memberId: member.id, kind: "DIRECT" },
        a,
      )
    ).statusCode,
    422,
  );

  assert.equal(
    (
      await call(
        "POST",
        base + "/templates",
        { name: "Denied", flags: defaultFlags },
        m,
      )
    ).statusCode,
    403,
  );
  await call(
    "POST",
    p + "/circles/" + c.id + "/memberships",
    { memberId: member.id },
    a,
  );
  const mandate = {
    roleId: r.id,
    memberId: member.id,
    kind: "DIRECT",
    startsAt: new Date(Date.now() - 1000).toISOString(),
    scope: "local",
  };
  assert.equal(
    (await call("POST", base + "/mandates", mandate, a)).statusCode,
    422,
  );
  assert.equal(
    (await call("POST", base + "/mandates", { ...mandate, kind: "INTERIM" }, a))
      .statusCode,
    422,
  );
  let occ = data(
    await call(
      "POST",
      base + "/mandates",
      {
        ...mandate,
        kind: "INTERIM",
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      },
      a,
    ),
    201,
  );
  let reasons = data(
    await call(
      "GET",
      base + "/members/" + member.id + "/reasons",
      undefined,
      m,
    ),
  );
  assert.ok(
    reasons.reasons.some(
      (x: any) => x.circleId === root && x.capability === "DECISION",
    ),
  );
  assert.ok(
    !reasons.reasons.some(
      (x: any) => x.circleId === child.id && x.capability === "ADMIN",
    ),
  );
  const metric = data(
    await call(
      "POST",
      base + "/indicators",
      {
        entityId: r.id,
        name: "Amostras",
        kind: "METRIC",
        valueType: "NUMBER",
        unit: "n",
        requiredUnits: ["lab"],
      },
      m,
    ),
    201,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/indicators",
        {
          entityId: child.id,
          name: "Cannot cascade",
          kind: "METRIC",
          valueType: "NUMBER",
          unit: "n",
          requiredUnits: [],
        },
        m,
      )
    ).statusCode,
    403,
  );
  const period = "2026-10";
  assert.equal(
    data(
      await call(
        "GET",
        base + "/indicators/" + metric.id + "/records?period=" + period,
        undefined,
        m,
      ),
    ).status,
    "UNKNOWN",
  );
  const record = { period, unitKey: "lab", value: 0 };
  const recordKey = randomUUID();
  data(
    await call(
      "POST",
      base + "/indicators/" + metric.id + "/records",
      record,
      m,
      { ...match(0), "idempotency-key": recordKey },
    ),
  );
  data(
    await call(
      "POST",
      base + "/indicators/" + metric.id + "/records",
      record,
      m,
      { ...match(0), "idempotency-key": recordKey },
    ),
  );
  assert.equal(
    data(
      await call(
        "GET",
        base + "/indicators/" + metric.id + "/records?period=" + period,
        undefined,
        m,
      ),
    ).records.length,
    1,
  );
  data(
    await call(
      "POST",
      base + "/mandates/" + occ.id + "/end",
      {},
      a,
      match(occ.version),
    ),
  );
  reasons = data(
    await call(
      "GET",
      base + "/members/" + member.id + "/reasons",
      undefined,
      m,
    ),
  );
  assert.ok(reasons.reasons.some((x: any) => x.source === "EXPLICIT"));
  assert.ok(!reasons.reasons.some((x: any) => x.capability === "ADMIN"));
  assert.equal(
    (
      await call(
        "POST",
        base + "/indicators/" + metric.id + "/records",
        { ...record, value: 1 },
        m,
        match(1),
      )
    ).statusCode,
    200,
  ); // explicit membership retains recording
  const foreignRoot = data(
    await call("GET", q + "/bootstrap", undefined, b),
  ).rootCircleId;
  assert.equal(
    (
      await call(
        "POST",
        base + "/aliases",
        { sourceRoleId: r.id, circleId: foreignRoot, label: "IDOR" },
        a,
      )
    ).statusCode,
    404,
  );
  const alias = data(
    await call(
      "POST",
      base + "/aliases",
      { sourceRoleId: r.id, circleId: d.id, label: "Espelho" },
      a,
    ),
    201,
  );
  assert.equal(alias.readOnly, true);
  assert.equal(
    (
      await call(
        "PATCH",
        p + "/roles/" + alias.id,
        { mode: "DIRECT", name: "Origin edit forbidden" },
        a,
        match(1),
      )
    ).statusCode,
    404,
  );
  const definition = {
    key: "capacity",
    label: "Capacidade",
    target: "ROLE",
    schema: { type: "NUMBER", required: true, min: 0, max: 100 },
    governed: false,
  };
  let f = data(await call("POST", base + "/fields", definition, a), 201);
  const fieldPath = base + "/entities/" + r.id + "/fields/" + f.id;
  const computedDefinition = {
    key: "count_capacity",
    label: "Campos preenchidos",
    target: "ROLE",
    schema: {
      type: "COMPUTED",
      required: false,
      formula: { op: "COUNT", fieldIds: [f.id] },
    },
    governed: false,
  };
  assert.equal(
    (
      await call(
        "POST",
        base + "/fields",
        { ...computedDefinition, governed: true },
        a,
      )
    ).statusCode,
    422,
  );
  const computed = data(
    await call("POST", base + "/fields", computedDefinition, a),
    201,
  );
  assert.equal(
    (
      await call(
        "PUT",
        base + "/entities/" + r.id + "/fields/" + computed.id,
        { value: 1 },
        a,
        match(0),
      )
    ).statusCode,
    422,
  );

  assert.equal(
    (await call("PUT", fieldPath, { value: "1" }, a, match(0))).statusCode,
    422,
  );
  let value = data(await call("PUT", fieldPath, { value: 12 }, a, match(0)));
  const filtered = {
    view: "DIRECTORY",
    query: "",
    kind: "ALL",
    rootId: null,
    memberId: null,
    flag: null,
    maxDepth: 100,
    field: { fieldId: computed.id, equals: 1 },
  };
  assert.equal(
    data(
      await call(
        "GET",
        base + "/graph?config=" + encodeURIComponent(JSON.stringify(filtered)),
        undefined,
        a,
      ),
    ).entities[0].id,
    r.id,
  );
  assert.equal(
    (
      await call(
        "GET",
        base +
          "/graph?config=" +
          encodeURIComponent(
            JSON.stringify({
              ...filtered,
              field: { fieldId: f.id, equals: "12" },
            }),
          ),
        undefined,
        a,
      )
    ).statusCode,
    422,
  );

  const race = await Promise.all([
    call("PUT", fieldPath, { value: 15 }, a, match(value.version)),
    call("PUT", fieldPath, { value: 20 }, a, match(value.version)),
  ]);
  assert.deepEqual(race.map((x) => x.statusCode).sort(), [200, 409]);
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/fields/" + f.id,
        { ...definition, key: "new_key" },
        a,
        match(f.version),
      )
    ).statusCode,
    422,
  );
  f = data(
    await call(
      "PATCH",
      base + "/fields/" + f.id,
      { ...definition, label: "Capacidade revisada", governed: true },
      a,
      match(f.version),
    ),
  );
  assert.equal(
    (await call("PUT", fieldPath, { value: 22 }, a, match(2))).statusCode,
    422,
  );
  const check = data(
    await call(
      "POST",
      base + "/indicators",
      {
        entityId: c.id,
        name: "Revisões",
        kind: "CHECKLIST",
        valueType: "BOOLEAN",
        unit: "",
        requiredUnits: ["a", "b"],
      },
      a,
    ),
    201,
  );
  data(
    await call(
      "POST",
      base + "/indicators/" + check.id + "/records",
      { period, unitKey: "a", value: true },
      a,
      match(0),
    ),
  );
  assert.equal(
    data(
      await call(
        "GET",
        base + "/indicators/" + check.id + "/records?period=" + period,
        undefined,
        a,
      ),
    ).completion.rate,
    50,
  );
  const config = {
    view: "NETWORK",
    query: "",
    kind: "ALL",
    rootId: null,
    memberId: null,
    flag: null,
    maxDepth: 100,
  };
  const v = data(
    await call("POST", base + "/views", { name: "Rede inédita", config }, m),
    201,
  );
  const graph = data(
    await call("GET", base + "/graph?viewId=" + v.id, undefined, m),
  );
  assert.equal(graph.entities.length, 5);
  assert.equal(graph.aliases.length, 1);
  assert.equal(
    (await call("GET", base + "/graph?viewId=" + v.id, undefined, a))
      .statusCode,
    404,
  );
  const snapshot = data(
    await call("POST", base + "/snapshots", { name: "Antes" }, a),
    201,
  );
  assert.equal(
    data(await call("GET", base + "/snapshots/" + snapshot.id, undefined, a))
      .coverage.scope,
    "CAPTURE_ONLY",
  );
  assert.equal(
    (
      await call(
        "GET",
        q + "/structure-advanced/snapshots/" + snapshot.id,
        undefined,
        b,
      )
    ).statusCode,
    404,
  );
  // Internal service ports execute under the same real tenant transaction/lock; deliberately rolled-back application leaves no graph/history change.
  async function withCtx(fn: (s: StructureService) => Promise<any>) {
    return transaction(async (conn) => {
      await conn.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        A.organization.id,
      ]);
      const org = (
        await conn.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [
          A.organization.id,
        ])
      ).rows[0];
      const mem = (
        await conn.query(
          "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",
          [org.id, a.id],
        )
      ).rows[0];
      return fn(
        new StructureService(
          {
            c: conn,
            org,
            member: mem,
            account: { id: a.id },
            mode: "authorization_write",
          },
          createRuntime(),
        ),
      );
    });
  }
  await withCtx(async (s) => {
    const ports = createStructurePorts(s.core);
    const elected = await ports.applyElection(s.ctx, {
      proposalId: randomUUID(),
      revision: 1,
      roleId: r.id,
      winnerId: member.id,
      mandateEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(elected.kind, "ELECTED");
    await s.ctx.c.query(
      "UPDATE structure_mandates SET ends_at=clock_timestamp()-interval '1 second',starts_at=clock_timestamp()-interval '10 seconds' WHERE organization_id=$1 AND id=$2",
      [s.org, elected.id],
    );
    const result = await s.reasons(member.id);
    assert.ok(!result.reasons.some((x) => x.capability === "ADMIN"));
    await ports.applyField(s.ctx, {
      entityId: r.id,
      fieldId: f.id,
      value: 24,
      baseVersion: 2,
    });
  });
  await assert.rejects(() =>
    withCtx(async (s) => {
      await createStructurePorts(s.core).applyStructure(s.ctx, {
        proposalId: randomUUID(),
        revision: 1,
        changes: [
          {
            kind: "UPDATE",
            entityId: r.id,
            baseVersion: r.version,
            name: "Must rollback",
          },
          {
            kind: "MOVE",
            entityId: c.id,
            baseVersion: c.version,
            parentCircleId: child.id,
          },
        ],
      });
    }),
  );
  assert.equal(
    data(await call("GET", base + "/graph", undefined, a)).entities.find(
      (e: any) => e.id === r.id,
    ).name,
    r.name,
  );

  await withCtx(async (s) => {
    const ports = createStructurePorts(s.core),
      newCircle = randomUUID(),
      newRole = randomUUID();
    await ports.applyStructure(s.ctx, {
      proposalId: randomUUID(),
      revision: 1,
      changes: [
        {
          kind: "CREATE",
          entityId: newRole,
          entityKind: "ROLE",
          parentCircleId: newCircle,
          name: "Ensaio dinâmico",
          purpose: "",
        },
        {
          kind: "CREATE",
          entityId: newCircle,
          entityKind: "CIRCLE",
          parentCircleId: root,
          name: "Laboratório novo",
          purpose: "",
        },
      ],
    });
    assert.equal((await s.entity(newRole)).parent_id, newCircle);
    await ports.applyStructure(s.ctx, {
      proposalId: randomUUID(),
      revision: 1,
      changes: [
        {
          kind: "MOVE",
          entityId: newRole,
          baseVersion: 1,
          parentCircleId: d.id,
        },
      ],
    });
    assert.equal((await s.entity(newRole)).parent_id, d.id);
    await ports.applyStructure(s.ctx, {
      proposalId: randomUUID(),
      revision: 1,
      changes: [{ kind: "ARCHIVE", entityId: newRole, baseVersion: 2 }],
    });
    await assert.rejects(() => s.entity(newRole));
    await ports.applyStructure(s.ctx, {
      proposalId: randomUUID(),
      revision: 1,
      changes: [{ kind: "RESTORE", entityId: newRole, baseVersion: 3 }],
    });
    assert.equal((await s.entity(newRole)).version, 4);
    await assert.rejects(() =>
      ports.applyStructure(s.ctx, {
        proposalId: randomUUID(),
        revision: 1,
        changes: [
          { kind: "UPDATE", entityId: newRole, baseVersion: 1, name: "Stale" },
        ],
      }),
    );

    await s.circlePolicy(c.id, { governedFields: ["purpose", "MOVE"] }, 0);
    await assert.rejects(() =>
      ports.preflightEntityChange(s.ctx, {
        operation: "UPDATE",
        entityId: r.id,
        changedFields: ["purpose"],
      }),
    );
    await ports.preflightEntityChange(s.ctx, {
      operation: "UPDATE",
      entityId: r.id,
      changedFields: ["name"],
    });
    assert.deepEqual(
      new Set(
        await ports.circleScope(s.ctx, {
          circleId: c.id,
          includeSubcircles: true,
        }),
      ),
      new Set([c.id, child.id]),
    );
    const roster = await ports.resolveMeetingRoster(s.ctx, {
      circleId: c.id,
      includeSubcircles: true,
      roleIds: [r.id],
    });
    assert.ok(
      roster.some((x) => x.memberId === member.id && x.origin === "CIRCLE"),
    );
    assert.ok(
      roster.every(
        (x) => x.participationRole === "OPTIONAL" && x.access === "READ",
      ),
    );
    const adapters = createStructureResourceAdapters(s.core);
    assert.equal(
      await adapters.role.authorize(s.ctx, foreignRoot, "read"),
      false,
    );
    assert.equal(await adapters.role.authorize(s.ctx, r.id, "read"), true);
    assert.equal(
      (await adapters.role.search!(s.ctx, "Guardiã", 5))[0].id,
      r.id,
    );
    const exported = await adapters.role.export!(s.ctx, [r.id], "STRUCTURE");
    await assert.rejects(() =>
      adapters.role.validateImport!(s.ctx, exported.records, "STRUCTURE"),
    );
    await s.circlePolicy(c.id, { governedFields: [] }, 1);
    const plan = await adapters.role.validateImport!(
      s.ctx,
      exported.records,
      "STRUCTURE",
    );
    await adapters.role.applyImport!(s.ctx, plan.plan, "STRUCTURE");
    await assert.rejects(() => adapters.role.export!(s.ctx, [r.id], "TASKS"));
    const current = await s.one("structure_fields", "id", f.id);
    const preview = await s.defineField(
      {
        ...definition,
        schema: { type: "TEXT", required: true },
        governed: false,
      },
      current,
      true,
    );
    assert.equal((preview as any).valid, false);
    await assert.rejects(() =>
      s.migrateField(f.id, {
        definition: {
          ...definition,
          schema: { type: "TEXT", required: true },
          governed: false,
        },
        values: [],
      }),
    );
    await s.defineField({ ...definition, governed: false }, current);
    const migrated = await s.migrateField(f.id, {
      definition: {
        ...definition,
        schema: { type: "TEXT", required: true },
        governed: false,
      },
      values: [{ entityId: r.id, baseVersion: 3, value: "vinte e quatro" }],
    });
    assert.equal(migrated.version, 4);
    assert.equal((await s.values(r.id))[0].value, "vinte e quatro");
    const read = new StructureService({ ...s.ctx, mode: "read" }, s.core);
    await assert.rejects(() =>
      read.template({ name: "Read cannot write", flags: defaultFlags }),
    );
    await assert.rejects(() =>
      ports.applyStructure(
        { ...s.ctx, mode: "read" },
        {
          proposalId: randomUUID(),
          revision: 1,
          changes: [
            {
              kind: "UPDATE",
              entityId: r.id,
              baseVersion: 2,
              name: "Read cannot bypass",
            },
          ],
        },
      ),
    );
  });
  await assert.rejects(() =>
    withCtx(async (s) => {
      const before = await s.entity(r.id);
      await createStructurePorts(s.core).applyStructure(s.ctx, {
        proposalId: randomUUID(),
        revision: 1,
        changes: [
          {
            kind: "UPDATE",
            entityId: r.id,
            baseVersion: before.version,
            name: "Injected transaction failure",
          },
        ],
      });
      throw Error("failure after SQL");
    }),
  );
  assert.equal(
    data(await call("GET", base + "/graph", undefined, a)).entities.find(
      (e: any) => e.id === r.id,
    ).name,
    r.name,
  );
  assert.equal(
    (await pool.query("SELECT * FROM structure_fields")).rowCount,
    0,
  );
});

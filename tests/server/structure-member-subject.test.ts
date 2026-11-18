import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { createStructureModule } from "../../server/modules/structure/plugin.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    core.registerFoundationStructure(createStructurePorts(core));
    await createStructureModule()(app, core);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
test(
  "030/031 upgrade preserves actual pre-migration entity indicators, records, versions and history",
  { skip: !process.env.STRUCTURE_LEGACY_SUBJECT_FIXTURE },
  async () => {
    const ids = JSON.parse(
      process.env.STRUCTURE_LEGACY_SUBJECT_FIXTURE ?? "null",
    );
    assert.ok(
      ids,
      "Run with test-isolated --subjects to seed the legacy schema before030",
    );
    await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        ids.org,
      ]);
      const rows = (
        await c.query(
          "SELECT * FROM structure_indicators WHERE organization_id=$1 ORDER BY kind",
          [ids.org],
        )
      ).rows;
      assert.equal(rows.length, 2);
      const metric = rows.find((r) => r.id === ids.metric)!;
      assert.equal(metric.subject_kind, "CIRCLE");
      assert.equal(metric.entity_id, ids.circle);
      assert.equal(metric.member_id, null);
      assert.equal(metric.version, 4);
      const checklist = rows.find((r) => r.id === ids.checklist)!;
      assert.equal(checklist.subject_kind, "ROLE");
      assert.equal(checklist.entity_id, ids.role);
      assert.equal(checklist.version, 2);
      const metricRecord = (
        await c.query(
          "SELECT * FROM structure_records WHERE organization_id=$1 AND id=$2",
          [ids.org, ids.record],
        )
      ).rows[0];
      assert.equal(metricRecord.value, 7);
      assert.equal(metricRecord.version, 3);
      assert.equal(metricRecord.recorded_by, ids.member);
      const checkRecord = (
        await c.query(
          "SELECT * FROM structure_records WHERE organization_id=$1 AND id=$2",
          [ids.org, ids.checkRecord],
        )
      ).rows[0];
      assert.equal(checkRecord.value, true);
      assert.equal(checkRecord.version, 2);
      const history = (
        await c.query(
          "SELECT * FROM structure_history WHERE organization_id=$1 AND id=$2",
          [ids.org, ids.history],
        )
      ).rows[0];
      assert.deepEqual(history.after_value, { legacy: true });
      assert.equal(history.indicator_subject_kind, null);
    });
  },
);
test("MEMBER subject storage and absence of trusted authority fail closed; legacy entity remains operational", async () => {
  const origin = "http://localhost:5173";
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin },
    payload: {
      email: randomUUID() + "@example.test",
      password: "member-subject-test-password",
      displayName: "Member subject QA",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const a = r.json().data;
  const headers = {
    origin,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    "x-csrf-token": a.csrfToken,
  };
  const call = (
    method: string,
    url: string,
    payload?: object,
    version?: number,
  ) =>
    app.inject({
      method: method as any,
      url: "/api/v1" + url,
      payload,
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        ...(version === undefined ? {} : { "if-match": '"' + version + '"' }),
      },
    });
  function data(response: any, status = 200) {
    assert.equal(response.statusCode, status, response.body);
    return response.json().data;
  }
  const org = data(
      await call("POST", "/organizations", { name: "Member subject A" }),
      201,
    ),
    other = data(
      await call("POST", "/organizations", { name: "Member subject B" }),
      201,
    );
  const base = "/organizations/" + org.organization.id + "/structure-advanced";
  const boot = data(
    await call("GET", "/organizations/" + org.organization.id + "/bootstrap"),
  );
  const memberId = boot.membership.id;
  const foreignMemberId = data(
    await call("GET", "/organizations/" + other.organization.id + "/bootstrap"),
  ).membership.id;
  const definition = {
    name: "Personal metric",
    kind: "METRIC",
    valueType: "NUMBER",
    unit: "pontos",
    requiredUnits: ["observado"],
  };
  const unavailable = await call("POST", base + "/indicators", {
    ...definition,
    subject: { kind: "MEMBER", memberId },
  });
  assert.equal(unavailable.statusCode, 503, unavailable.body);
  assert.equal(unavailable.json().error.code, "SUBJECT_AUTHORITY_UNAVAILABLE");
  assert.equal(
    (await call("GET", base + "/subjects/member/" + memberId + "/indicators"))
      .statusCode,
    503,
  );
  assert.equal(
    (await call("GET", base + "/subjects/member/" + memberId + "/history"))
      .statusCode,
    503,
  );
  assert.equal(
    (
      await call("POST", base + "/indicators", {
        ...definition,
        entityId: org.rootCircle.id,
        subject: { kind: "MEMBER", memberId },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call("POST", base + "/indicators", {
        ...definition,
        subject: { kind: "ROLE", roleId: org.rootCircle.id },
      })
    ).statusCode,
    404,
  );
  const legacy = data(
    await call("POST", base + "/indicators", {
      ...definition,
      entityId: org.rootCircle.id,
    }),
    201,
  );
  assert.equal(legacy.entityId, org.rootCircle.id);
  assert.deepEqual(legacy.subject, {
    kind: "CIRCLE",
    circleId: org.rootCircle.id,
  });
  data(
    await call(
      "POST",
      base + "/indicators/" + legacy.id + "/records",
      { period: "2026-10", unitKey: "observado", value: 4 },
      0,
    ),
  );
  assert.equal(
    data(
      await call(
        "GET",
        base + "/indicators/" + legacy.id + "/records?period=2026-10",
      ),
    ).latest[0].value,
    4,
  );
  const personal = randomUUID();
  // Store fixture only; it is not an authorization provider or successful personal command.
  async function store(fn: (c: any) => Promise<void>) {
    await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        org.organization.id,
      ]);
      await fn(c);
    });
  }
  await store(async (c) => {
    await c.query(
      "INSERT INTO structure_indicators(organization_id,id,entity_id,member_id,subject_kind,name,kind,value_type,unit,required_units) VALUES($1,$2,NULL,$3,'MEMBER','Stored private metric','METRIC','NUMBER','pontos','[\"observado\"]')",
      [org.organization.id, personal, memberId],
    );
  });
  assert.equal(
    (
      await call(
        "GET",
        base + "/indicators/" + personal + "/records?period=2026-10",
      )
    ).statusCode,
    503,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/indicators/" + personal + "/records",
        { period: "2026-10", unitKey: "observado", value: 3 },
        0,
      )
    ).statusCode,
    503,
  );
  const catalog = data(await call("GET", base + "/catalog"));
  assert.ok(catalog.indicators.some((i: any) => i.id === legacy.id));
  assert.ok(!catalog.indicators.some((i: any) => i.id === personal));
  for (const values of [
    [org.rootCircle.id, memberId, "MEMBER"], // both namespaces
    [null, null, "MEMBER"],
    [null, foreignMemberId, "MEMBER"],
    [org.rootCircle.id, null, "ROLE"],
  ])
    await assert.rejects(() =>
      store(async (c) => {
        await c.query(
          "INSERT INTO structure_indicators(organization_id,id,entity_id,member_id,subject_kind,name,kind,value_type,unit,required_units) VALUES($1,$2,$3,$4,$5,'invalid','METRIC','NUMBER','','[]')",
          [org.organization.id, randomUUID(), ...values],
        );
      }),
    );
  await store(async (c) => {
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int n FROM structure_records WHERE organization_id=$1 AND indicator_id=$2",
          [org.organization.id, personal],
        )
      ).rows[0].n,
      0,
    );
  });
  const privateHistory = randomUUID();
  await store(async (c) => {
    await c.query(
      "INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name,purpose) VALUES($1,$2,$3,'ROLE',$4,'Same UUID in distinct namespace','')",
      [org.organization.id, memberId, randomUUID(), org.rootCircle.id],
    );
    await c.query(
      "INSERT INTO structure_history(organization_id,id,resource_id,action,after_value,actor_id,indicator_subject_kind) VALUES($1,$2,$3,'MetricRecorded','{\"privateMarker\":42}',$3,'MEMBER')",
      [org.organization.id, privateHistory, memberId],
    );
  });
  const structuralHistory = data(
    await call("GET", base + "/entities/" + memberId + "/history"),
  );
  assert.ok(!structuralHistory.items.some((h: any) => h.id === privateHistory));
  assert.equal(
    (
      await call(
        "GET",
        base + "/entities/" + memberId + "/history?before=" + privateHistory,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/indicators/" + personal,
        { name: "Should deny" },
        1,
      )
    ).statusCode,
    503,
  );
  assert.equal(
    (await call("DELETE", base + "/indicators/" + personal, {}, 1)).statusCode,
    503,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/indicators/" + legacy.id,
        { requiredUnits: ["changed"] },
        1,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/indicators/" + legacy.id,
        { unit: "different" },
        1,
      )
    ).statusCode,
    422,
  );
  const renamed = data(
    await call(
      "PATCH",
      base + "/indicators/" + legacy.id,
      { name: "Renamed legacy metric" },
      1,
    ),
  );
  assert.equal(renamed.version, 2);
  assert.equal(renamed.name, "Renamed legacy metric");
  assert.equal(
    data(
      await call(
        "GET",
        base + "/indicators/" + legacy.id + "/records?period=2026-10",
      ),
    ).latest[0].value,
    4,
  );
  assert.equal(
    (await call("DELETE", base + "/indicators/" + legacy.id, {}, 1)).statusCode,
    409,
  );
  const archived = data(
    await call("DELETE", base + "/indicators/" + legacy.id, {}, 2),
  );
  assert.equal(archived.archived, true);
  assert.equal(archived.version, 3);
  const archivedPeriod = data(
    await call(
      "GET",
      base + "/indicators/" + legacy.id + "/records?period=2026-10",
    ),
  );
  assert.equal(archivedPeriod.latest[0].value, 4);
  assert.equal(archivedPeriod.capabilities.record, false);
  assert.equal(
    (
      await call(
        "POST",
        base + "/indicators/" + legacy.id + "/records",
        { period: "2026-10", unitKey: "observado", value: 5 },
        1,
      )
    ).statusCode,
    409,
  );
  assert.ok(
    !data(await call("GET", base + "/catalog")).indicators.some(
      (i: any) => i.id === legacy.id,
    ),
  );
});

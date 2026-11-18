import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { Failure } from "../../server/src/core.js";
import {
  createAdministration,
  createMemberIndicatorAuthority,
} from "../../server/modules/administration/index.js";
import { createStructureModule } from "../../server/modules/structure/plugin.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { StructureService } from "../../server/modules/structure/service.js";
import { storedIndicatorSubject } from "../../server/modules/structure/indicator-subject.js";
const authority = createMemberIndicatorAuthority(),
  options = { memberIndicatorAuthority: authority };
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    core.registerFoundationStructure(createStructurePorts(core, options));
    await createAdministration()(app, core);
    await createStructureModule(options)(app, core);
    // Fixture-only failure after the real record service, inside the real HTTP UoW.
    app.post(
      "/api/v1/organizations/:organizationId/_test/member-record-rollback/:id",
      (r) =>
        core.tenant(
          r,
          {
            mode: "authorization_write",
            authorize: async (ctx) => {
              const s = new StructureService(ctx, core, undefined, options),
                i = await s.one(
                  "structure_indicators",
                  "id",
                  (r.params as any).id,
                );
              return s.canIndicatorSubject(storedIndicatorSubject(i), "RECORD");
            },
          },
          async (ctx) => {
            const s = new StructureService(ctx, core, r, options);
            await s.record((r.params as any).id, r.body, 0);
            throw new Failure(409, "TEST_RECORD_ROLLBACK");
          },
        ),
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
type Actor = { id: string; cookie: string; csrf: string };
const origin = "http://localhost:5173";
async function account(): Promise<Actor> {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin },
    payload: {
      email: randomUUID() + "@example.test",
      password: "real-member-authority-password",
      displayName: "Authority QA",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    id: r.json().data.account.id,
    csrf: r.json().data.csrfToken,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
  };
}
async function call(
  actor: Actor,
  method: string,
  path: string,
  payload?: object,
  version?: number,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin,
      cookie: actor.cookie,
      "x-csrf-token": actor.csrf,
      "idempotency-key": key,
      ...(version === undefined ? {} : { "if-match": '"' + version + '"' }),
    },
  });
}
function data(response: any, status = 200) {
  assert.equal(response.statusCode, status, response.body);
  return response.json().data;
}
test("real Admin consent→Structure DEFINE/SELF RECORD, private reads, revoke before replay, lifecycle and rollback", async () => {
  const owner = await account(),
    subject = await account(),
    delegate = await account();
  const org = data(
      await call(owner, "POST", "/organizations", {
        name: "Real member authority",
      }),
      201,
    ),
    base = "/organizations/" + org.organization.id;
  const member = data(
    await call(owner, "POST", base + "/members", { accountId: subject.id }),
    201,
  ).membership;
  const other = data(
    await call(owner, "POST", base + "/members", { accountId: delegate.id }),
    201,
  ).membership;
  const ownPath = base + "/structure-advanced/subjects/member/" + member.id;
  const indicators = base + "/structure-advanced/indicators",
    consents = base + "/administration/member-indicator-consents";
  const initial = data(await call(subject, "GET", ownPath + "/indicators"));
  assert.deepEqual(initial.items, []);
  assert.equal(
    (
      await call(
        subject,
        "GET",
        base +
          "/structure-advanced/subjects/member/" +
          member.id.toUpperCase() +
          "/indicators",
      )
    ).statusCode,
    200,
  );
  assert.equal(initial.capabilities.define, false);
  assert.equal(initial.capabilities.record, true);
  assert.equal(
    (await call(owner, "GET", ownPath + "/indicators")).statusCode,
    404,
  );
  const definition = {
    subject: { kind: "MEMBER", memberId: member.id },
    name: "Aprendizagens",
    kind: "METRIC",
    valueType: "NUMBER",
    unit: "pontos",
    requiredUnits: ["observado"],
  };
  assert.equal(
    (await call(subject, "POST", indicators, definition)).statusCode,
    403,
  );
  const selfConsent = data(
    await call(
      subject,
      "POST",
      consents,
      {
        delegateMemberId: member.id,
        actions: ["DEFINE"],
        confirmation: "AUTHORIZE_DEFINE_ON_MY_INDICATORS",
      },
      0,
    ),
    201,
  );
  assert.equal(selfConsent.revision, 1);
  const defineKey = randomUUID(),
    metric = data(
      await call(subject, "POST", indicators, definition, undefined, defineKey),
      201,
    );
  assert.deepEqual(metric.subject, definition.subject);
  assert.equal(metric.memberId, member.id);
  assert.equal(metric.entityId, null);
  const periodPath = indicators + "/" + metric.id + "/records";
  assert.equal(
    data(await call(subject, "GET", periodPath + "?period=p1")).status,
    "UNKNOWN",
  );
  data(
    await call(
      subject,
      "POST",
      periodPath,
      { period: "p1", unitKey: "observado", value: 0 },
      0,
    ),
    200,
  );
  const zero = data(await call(subject, "GET", periodPath + "?period=p1"));
  assert.equal(zero.status, "KNOWN");
  assert.equal(zero.latest[0].value, 0);
  assert.equal(zero.latest[0].recordedBy, member.id);
  const checklist = data(
    await call(subject, "POST", indicators, {
      ...definition,
      name: "Cuidados",
      kind: "CHECKLIST",
      valueType: "BOOLEAN",
      unit: "",
      requiredUnits: ["a", "b"],
    }),
    201,
  );
  data(
    await call(
      subject,
      "POST",
      indicators + "/" + checklist.id + "/records",
      { period: "p1", unitKey: "a", value: true },
      0,
    ),
  );
  data(
    await call(
      subject,
      "POST",
      indicators + "/" + checklist.id + "/records",
      { period: "p1", unitKey: "b", value: false },
      0,
    ),
  );
  assert.equal(
    data(
      await call(
        subject,
        "GET",
        indicators + "/" + checklist.id + "/records?period=p1",
      ),
    ).completion.rate,
    50,
  );
  const delegated = data(
    await call(
      subject,
      "POST",
      consents,
      {
        delegateMemberId: other.id,
        actions: ["DEFINE"],
        confirmation: "AUTHORIZE_DEFINE_ON_MY_INDICATORS",
      },
      1,
    ),
    201,
  );
  const delegatedKey = randomUUID(),
    assigned = data(
      await call(
        delegate,
        "POST",
        indicators,
        { ...definition, name: "Assigned by consent" },
        undefined,
        delegatedKey,
      ),
      201,
    );
  assert.equal(
    (await call(delegate, "GET", ownPath + "/indicators")).statusCode,
    404,
  );
  assert.equal(
    (await call(delegate, "GET", periodPath + "?period=p1")).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        delegate,
        "POST",
        periodPath,
        { period: "p2", unitKey: "observado", value: 4 },
        0,
      )
    ).statusCode,
    403,
  );
  data(
    await call(
      delegate,
      "PATCH",
      indicators + "/" + assigned.id,
      { name: "Maintained via DEFINE" },
      1,
    ),
  );
  data(
    await call(
      subject,
      "POST",
      consents + "/" + selfConsent.consent.id + "/revoke",
      {},
      delegated.revision,
    ),
  );
  assert.equal(
    (await call(subject, "POST", indicators, definition, undefined, defineKey))
      .statusCode,
    403,
  );
  data(
    await call(
      subject,
      "POST",
      periodPath,
      { period: "p2", unitKey: "observado", value: 2 },
      0,
    ),
  );
  const revokeDelegate = data(
    await call(
      subject,
      "POST",
      consents + "/" + delegated.consent.id + "/revoke",
      {},
      3,
    ),
  );
  assert.equal(revokeDelegate.revision, 4);
  assert.equal(
    (
      await call(
        delegate,
        "POST",
        indicators,
        { ...definition, name: "Assigned by consent" },
        undefined,
        delegatedKey,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(delegate, "DELETE", indicators + "/" + assigned.id, {}, 2))
      .statusCode,
    403,
  );
  assert.equal(
    data(await call(subject, "GET", ownPath + "/indicators")).items.length,
    3,
  );
  const history = data(await call(subject, "GET", ownPath + "/history"));
  assert.ok(history.items.some((h: any) => h.action === "MetricRecorded"));
  assert.equal(
    (await call(owner, "GET", ownPath + "/history")).statusCode,
    404,
  );
  async function counts() {
    return transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        org.organization.id,
      ]);
      const result: Record<string, number> = {};
      for (const table of [
        "structure_records",
        "structure_history",
        "audit_events",
        "outbox",
        "command_results",
      ])
        result[table] = Number(
          (
            await c.query(
              "SELECT count(*) n FROM " + table + " WHERE organization_id=$1",
              [org.organization.id],
            )
          ).rows[0].n,
        );
      return result;
    });
  }
  const before = await counts();
  assert.equal(
    (
      await call(
        subject,
        "POST",
        base + "/_test/member-record-rollback/" + metric.id,
        { period: "rollback", unitKey: "observado", value: 9 },
        0,
      )
    ).statusCode,
    409,
  );
  assert.deepEqual(await counts(), before);
  assert.equal(
    data(await call(subject, "GET", periodPath + "?period=rollback")).status,
    "UNKNOWN",
  );
  const restoreConsent = data(
    await call(
      subject,
      "POST",
      consents,
      {
        delegateMemberId: member.id,
        actions: ["DEFINE"],
        confirmation: "AUTHORIZE_DEFINE_ON_MY_INDICATORS",
      },
      4,
    ),
    201,
  );
  assert.equal(restoreConsent.revision, 5);
  data(
    await call(
      subject,
      "PATCH",
      indicators + "/" + metric.id,
      { name: "Maintained after reconsent" },
      1,
    ),
  );
  data(await call(subject, "DELETE", indicators + "/" + metric.id, {}, 2));
  assert.equal(
    data(await call(subject, "GET", periodPath + "?period=p1")).latest[0].value,
    0,
  );
  data(
    await call(
      subject,
      "POST",
      consents,
      {
        delegateMemberId: other.id,
        actions: ["DEFINE"],
        confirmation: "AUTHORIZE_DEFINE_ON_MY_INDICATORS",
      },
      5,
    ),
    201,
  );
  assert.equal(
    (
      await call(delegate, "POST", indicators, {
        ...definition,
        name: "Active renewed delegate",
      })
    ).statusCode,
    201,
  );
  const suspended = data(
    await call(
      owner,
      "PATCH",
      base + "/members/" + member.id,
      { status: "SUSPENDED" },
      member.version,
    ),
  );
  assert.equal(suspended.membership.status, "SUSPENDED");
  assert.ok(
    [403, 404].includes(
      (await call(subject, "GET", ownPath + "/indicators")).statusCode,
    ),
  );
  assert.equal(
    (
      await call(delegate, "POST", indicators, {
        ...definition,
        name: "Suspended subject",
      })
    ).statusCode,
    403,
  );
});

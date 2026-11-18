import {foundationDefaultAdmissionPolicy} from "../../server/src/admission.js";
import { createGovernanceModule } from "../../server/modules/governance/plugin.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import type { Ctx, ModuleRuntime } from "../../server/src/runtime.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { createStructureModule } from "../../server/modules/structure/plugin.js";
import { createStructureResourceAdapters } from "../../server/modules/structure/platform.js";
import { normalizePurposeChange } from "../../server/modules/structure/purpose.js";
import {
  toPlainText,
  validateRichDocument,
} from "../../packages/content/index.js";
let core: ModuleRuntime;
let ports: ReturnType<typeof createStructurePorts>;
const app = await buildApp([foundationDefaultAdmissionPolicy,
  async (app, runtime) => {
    core = runtime;
    ports = createStructurePorts(core);
    core.registerFoundationStructure(ports);
    await createStructureModule()(app, core);
    await createGovernanceModule({ applyStructure: ports.applyStructure })(
      app,
      core,
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
const rich = validateRichDocument({
  format: "orgmap-richtext",
  version: 1,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Cuidar de ", marks: [{ type: "bold" }] },
          {
            type: "text",
            text: "vínculos 日本語",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.test/proposito" },
              },
            ],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Escutar e agir",
                    marks: [{ type: "italic" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
});
test("purpose explicit rich contract preserves literal legacy, validates AST and rejects divergent plain", () => {
  const legacy = '{"format":"orgmap-richtext","doc":{}} <b>literal</b>';
  assert.deepEqual(normalizePurposeChange({ purpose: legacy }), {
    purpose: legacy,
    purposeRich: null,
  });
  assert.equal(normalizePurposeChange({}), undefined);
  assert.deepEqual(normalizePurposeChange({ purposeRich: null }), {
    purpose: "",
    purposeRich: null,
  });
  assert.deepEqual(normalizePurposeChange({ purposeRich: rich }), {
    purpose: toPlainText(rich),
    purposeRich: rich,
  });
  assert.throws(
    () => normalizePurposeChange({ purpose: "divergente", purposeRich: rich }),
    /PURPOSE_TEXT_MISMATCH/,
  );
  for (const value of [
    JSON.stringify(rich),
    { ...rich, version: 2 },
    { ...rich, html: "<b>x</b>" },
  ])
    assert.throws(
      () => normalizePurposeChange({ purposeRich: value }),
      /INVALID_PURPOSE_RICH/,
    );
});
test("PG purpose AST: entity/template/transfer/history and approved Governance CREATE+UPDATE circle/role", async () => {
  const auth = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin: "http://localhost:5173" },
    payload: {
      email: randomUUID() + "@example.test",
      password: "synthetic-purpose-password",
      displayName: "Purpose QA",
    },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const a = auth.json().data;
  const headers = {
    origin: "http://localhost:5173",
    cookie: auth.cookies[0].name + "=" + auth.cookies[0].value,
    "x-csrf-token": a.csrfToken,
    "idempotency-key": randomUUID(),
  };
  const org = await app.inject({
    method: "POST",
    url: "/api/v1/organizations",
    headers,
    payload: { name: "Rich purpose isolated" },
  });
  assert.equal(org.statusCode, 201, org.body);
  const o = org.json().data,
    orgId = o.organization.id,
    root = o.rootCircle.id;
  async function ctx<T>(fn: (c: Ctx) => Promise<T>) {
    return transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        orgId,
      ]);
      const organization = (
        await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [
          orgId,
        ])
      ).rows[0];
      const member = (
        await c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",
          [orgId, a.account.id],
        )
      ).rows[0];
      return fn({
        c,
        org: organization,
        member,
        account: a.account,
        mode: "authorization_write",
      });
    });
  }
  const circle = randomUUID(),
    role = randomUUID();
  const apply = (c: Ctx, changes: unknown[]) =>
    ports.applyStructure(c, { changes, proposalId: randomUUID(), revision: 1 });
  await ctx((c) =>
    apply(c, [
      {
        kind: "CREATE",
        entityId: circle,
        entityKind: "CIRCLE",
        parentCircleId: root,
        name: "Purpose circle",
        purposeRich: rich,
      },
      {
        kind: "CREATE",
        entityId: role,
        entityKind: "ROLE",
        parentCircleId: circle,
        name: "Purpose role",
        purposeRich: rich,
      },
    ]),
  );
  const read = (eid: string): Promise<any> =>
    ctx((c) => ports.readStructureEntity(c, eid));
  assert.deepEqual((await read(role)).purposeRich, rich);
  assert.equal((await read(role)).purpose, toPlainText(rich));
  await ctx((c) =>
    apply(c, [
      { kind: "UPDATE", entityId: role, baseVersion: 1, name: "Renamed" },
    ]),
  );
  assert.deepEqual((await read(role)).purposeRich, rich);
  const history = await ctx(
    async (c) =>
      (
        await c.c.query(
          "SELECT after_value FROM structure_history WHERE organization_id=$1 AND resource_id=$2 ORDER BY at",
          [orgId, role],
        )
      ).rows,
  );
  assert.deepEqual(history.at(-1)!.after_value.purpose_rich, rich);
  const forest = await ctx((c) => ports.structureForest(c));
  assert.deepEqual(
    forest.roles.find((r: any) => r.id === role)?.purposeRich,
    rich,
  );
  const adapters = createStructureResourceAdapters(core);
  const exported = await ctx((c) =>
    adapters.role.export!(c, [role], "STRUCTURE"),
  );
  assert.deepEqual((exported.records[0] as any).purposeRich, rich);
  const clone = randomUUID();
  const records = [{ ...(exported.records[0] as any), id: clone }];
  await ctx(async (c) => {
    const validated = await adapters.role.validateImport!(
      c,
      records,
      "STRUCTURE",
    );
    await adapters.role.applyImport!(c, validated.plan, "STRUCTURE");
  });
  assert.deepEqual((await read(clone)).purposeRich, rich);
  await assert.rejects(
    () =>
      ctx((c) =>
        apply(c, [
          { kind: "UPDATE", entityId: role, baseVersion: 1, purposeRich: null },
        ]),
      ),
    /VERSION_CONFLICT/,
  );
  await assert.rejects(
    () =>
      ctx(async (c) => {
        await apply(c, [
          { kind: "UPDATE", entityId: role, baseVersion: 2, purposeRich: null },
        ]);
        throw Error("rollback");
      }),
    /rollback/,
  );
  assert.deepEqual((await read(role)).purposeRich, rich);
  await ctx(async (c) => {
    // The foundation command owns this single version increment and its history.
    const before = (
      await c.c.query(
        "SELECT * FROM entities WHERE organization_id=$1 AND id=$2",
        [orgId, role],
      )
    ).rows[0];
    await c.c.query(
      "UPDATE entities SET version=version+1 WHERE organization_id=$1 AND id=$2",
      [orgId, role],
    );
    await ports.writeEntityPurpose(c, {
      entityId: role,
      entityVersion: 3,
      purpose: '<b>literal</b> {"doc":{}}',
    });
    const after = (
      await c.c.query(
        "SELECT * FROM entities WHERE organization_id=$1 AND id=$2",
        [orgId, role],
      )
    ).rows[0];
    await ports.recordFoundationChange(c, {
      resourceId: role,
      action: "EntityUpdated",
      before,
      after,
    });
  });
  assert.equal((await read(role)).version, 3);
  assert.equal((await read(role)).purposeRich, null);
  assert.equal((await read(role)).purpose, '<b>literal</b> {"doc":{}}');
  await assert.rejects(
    () =>
      ctx((c) =>
        ports.writeEntityPurpose(c, {
          entityId: role,
          entityVersion: 2,
          purposeRich: rich,
        }),
      ),
    /VERSION_CONFLICT/,
  );
  await assert.rejects(
    () =>
      ctx((c) =>
        ports.writeEntityPurpose(
          { ...c, mode: "read" },
          { entityId: role, entityVersion: 3, purposeRich: rich },
        ),
      ),
    /ACTION_DENIED/,
  );
  await ctx((c) =>
    apply(c, [
      { kind: "UPDATE", entityId: role, baseVersion: 3, purposeRich: null },
    ]),
  );
  assert.equal((await read(role)).purpose, "");
  assert.equal((await read(role)).purposeRich, null);
  await assert.rejects(
    () =>
      ctx((c) =>
        apply(c, [
          {
            kind: "UPDATE",
            entityId: circle,
            baseVersion: 1,
            purposeRich: rich,
            purpose: "wrong",
          },
          {
            kind: "UPDATE",
            entityId: role,
            baseVersion: 4,
            name: "Should roll back",
          },
        ]),
      ),
    /PURPOSE_TEXT_MISMATCH/,
  );
  assert.equal((await read(role)).name, "Renamed");
  const templatePath =
    "/api/v1/organizations/" + orgId + "/structure-advanced/templates";
  const sendTemplate = (
    method: string,
    url: string,
    payload: any,
    version?: number,
  ) =>
    app.inject({
      method: method as any,
      url,
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        ...(version === undefined ? {} : { "if-match": '"' + version + '"' }),
      },
      payload,
    });
  const flags = {
    core: false,
    electable: false,
    assigner: false,
    representative: false,
    admin: false,
  };
  const created = await sendTemplate("POST", templatePath, {
    name: "Modelo rico",
    flags,
    purposeRich: rich,
  });
  assert.equal(created.statusCode, 201, created.body);
  const template = created.json().data;
  assert.deepEqual(template.purposeRich, rich);
  assert.equal(template.purpose, toPlainText(rich));
  const updated = await sendTemplate(
    "PATCH",
    templatePath + "/" + template.id,
    { name: "Modelo renomeado", flags },
    1,
  );
  assert.equal(updated.statusCode, 200, updated.body);
  assert.deepEqual(updated.json().data.purposeRich, rich);
  assert.equal(
    (
      await sendTemplate(
        "PATCH",
        templatePath + "/" + template.id,
        { name: "Stale", flags, purposeRich: null },
        1,
      )
    ).statusCode,
    409,
  );
  const catalog = await app.inject({
    method: "GET",
    url: "/api/v1/organizations/" + orgId + "/structure-advanced/catalog",
    headers,
  });
  assert.deepEqual(
    catalog.json().data.templates.find((t: any) => t.id === template.id)
      .purposeRich,
    rich,
  );
  const templateHistory = await ctx(
    async (c) =>
      (
        await c.c.query(
          "SELECT after_value FROM structure_history WHERE organization_id=$1 AND resource_id=$2 ORDER BY at",
          [orgId, template.id],
        )
      ).rows,
  );
  assert.deepEqual(templateHistory.at(-1)!.after_value.purpose_rich, rich);

  const policy = await app.inject({
    method: "PUT",
    url:
      "/api/v1/organizations/" +
      orgId +
      "/structure-advanced/circles/" +
      circle +
      "/policy",
    headers: { ...headers, "idempotency-key": randomUUID(), "if-match": '"0"' },
    payload: { governedFields: ["purpose"] },
  });
  assert.equal(policy.statusCode, 200, policy.body);
  await assert.rejects(
    () =>
      ctx((c) =>
        ports.preflightEntityChange(c, {
          operation: "UPDATE",
          entityId: role,
          changedFields: ["purposeRich"],
        }),
      ),
    /FIELD_GOVERNED/,
  );
  await ctx((c) =>
    ports.preflightEntityChange(c, {
      operation: "UPDATE",
      entityId: role,
      changedFields: ["name"],
    }),
  );
  const governedRecord = { ...(exported.records[0] as any), version: 4 };
  await assert.rejects(
    () =>
      ctx((c) =>
        adapters.role.validateImport!(c, [governedRecord], "STRUCTURE"),
      ),
    /FIELD_GOVERNED/,
  );
  const apiBase = "/api/v1/organizations/" + orgId;
  async function command(
    method: string,
    path: string,
    payload?: object,
    version?: number,
  ) {
    const response = await app.inject({
      method: method as any,
      url: apiBase + path,
      payload,
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        ...(version === undefined ? {} : { "if-match": '"' + version + '"' }),
      },
    });
    assert.ok([200, 201].includes(response.statusCode), response.body);
    return response.json().data;
  }
  async function approve(changes: unknown[]) {
    const proposal = await command("POST", "/proposals", {
      title: "Propósito rico aprovado",
      circleId: root,
      kind: "GOVERNANCE",
      payload: { changes },
    });
    const detail = await command("GET", "/proposals/" + proposal.id);
    assert.ok(
      detail.revisions[0].payload.changes.every(
        (change: any) => change.purposeRich,
      ),
    );
    await command(
      "POST",
      "/proposals/" + proposal.id + "/actions/submit",
      {},
      1,
    );
    await command(
      "POST",
      "/proposals/" + proposal.id + "/votes",
      { choice: "CONSENT" },
      2,
    );
    for (const step of ["CLARIFY", "REACT", "OBJECT", "DECIDE"])
      await command(
        "POST",
        "/proposals/" + proposal.id + "/actions/step",
        { step },
        2,
      );
    await command(
      "POST",
      "/proposals/" + proposal.id + "/actions/decide",
      { verdict: "ADOPT", reason: "Revisado" },
      2,
    );
    await command(
      "POST",
      "/proposals/" + proposal.id + "/actions/apply",
      {},
      3,
    );
  }
  const proposedCircle = randomUUID(),
    proposedRole = randomUUID();
  await approve([
    {
      kind: "CREATE",
      entityId: proposedCircle,
      entityKind: "CIRCLE",
      parentCircleId: root,
      name: "Círculo por proposta",
      purposeRich: rich,
    },
    {
      kind: "CREATE",
      entityId: proposedRole,
      entityKind: "ROLE",
      parentCircleId: proposedCircle,
      name: "Papel por proposta",
      purposeRich: rich,
    },
  ]);
  assert.deepEqual((await read(proposedCircle)).purposeRich, rich);
  assert.deepEqual((await read(proposedRole)).purposeRich, rich);
  const revised = structuredClone(rich);
  (revised.doc.content[0] as any).content[0].text = "Revisar o cuidado de ";
  await approve([
    {
      kind: "UPDATE",
      entityId: proposedCircle,
      baseVersion: 1,
      purposeRich: revised,
    },
    {
      kind: "UPDATE",
      entityId: proposedRole,
      baseVersion: 1,
      purposeRich: revised,
    },
  ]);
  for (const eid of [proposedCircle, proposedRole]) {
    const entity = await read(eid);
    assert.deepEqual(entity.purposeRich, revised);
    assert.equal(entity.purpose, toPlainText(revised));
    assert.equal(entity.version, 2);
    const snapshots = await ctx(
      async (c) =>
        (
          await c.c.query(
            "SELECT after_value FROM structure_history WHERE organization_id=$1 AND resource_id=$2 ORDER BY at",
            [orgId, eid],
          )
        ).rows,
    );
    assert.deepEqual(snapshots.at(-1)!.after_value.purpose_rich, revised);
  }
  const foundationForest=await command('GET','/structure');
  assert.deepEqual(foundationForest.circles.find((e:any)=>e.id===proposedCircle).purposeRich,revised);
  assert.deepEqual(foundationForest.roles.find((e:any)=>e.id===proposedRole).purposeRich,revised);
  assert.deepEqual((await command('GET','/circles/'+proposedCircle)).entity.purposeRich,revised);
  assert.deepEqual((await command('GET','/roles/'+proposedRole)).entity.purposeRich,revised);

});

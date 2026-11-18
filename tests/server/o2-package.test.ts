import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { HTTPMethods } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { createOrgMapIntegration } from "../../server/integration/index.js";
import { defaultPolicy } from "../../server/modules/governance/domain.js";
import { zip } from "../../server/modules/platform/xlsx.js";
import { deflateRawSync } from "node:zlib";

const database = new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname.slice(1);
if (database !== process.env.O2_PACKAGE_TEST_DATABASE || !/^orgmap_o2pkg_[a-f0-9]{32}$/.test(database))
  throw Error("EXCLUSIVE_O2_PACKAGE_DATABASE_REQUIRED");
const origin = "http://o2-package.localhost:5213";
process.env.ALLOWED_ORIGINS = origin;
const blobs = await mkdtemp(join(tmpdir(), "orgmap-o2-package-test-"));
const app = await buildApp([createOrgMapIntegration({ blobsDirectory: blobs })], { migrationMaxPrefix: 899 });
after(async () => { await app.close(); await pool.end(); await rm(blobs, { recursive: true, force: true }); });
type Actor = { accountId: string; cookie: string; csrf: string; memberId?: string; email: string };
let registrationAddress=1;
async function account(label: string): Promise<Actor> {
  const email = "o2-test-" + randomUUID() + "@example.test";
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/register", remoteAddress:`127.2.0.${registrationAddress++}`, headers: { origin },
    payload: { email, password: "Synthetic-O2-package-2026-strong", displayName: label } });
  const value = data(response, 201);
  const cookie = response.cookies.find(item => item.name === "orgmap_session");
  assert.ok(cookie);
  return { accountId: value.account.id, cookie: "orgmap_session=" + cookie.value, csrf: value.csrfToken, email };
}
async function call(actor: Actor, method: HTTPMethods, path: string, payload?: object, version?: number, key = randomUUID()) {
  return app.inject({ method, url: "/api/v1" + path, payload, headers: {
    origin, cookie: actor.cookie, "x-csrf-token": actor.csrf, "idempotency-key": key,
    ...(version === undefined ? {} : { "if-match": `"${version}"` }),
  } });
}
function data(response: { statusCode: number; body: string; json(): any }, expected: number | number[] = 200): any {
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.statusCode),
    `expected ${expected}, got ${response.statusCode}: ${response.body}`);
  return response.json().data;
}
function denied(response: { statusCode: number; body: string }, expected = [403, 404, 422]) {
  assert.ok(expected.includes(response.statusCode), `expected denial, got ${response.statusCode}: ${response.body}`);
}
async function organization(owner: Actor, name: string) {
  const value = data(await call(owner, "POST", "/organizations", { name }), 201);
  owner.memberId = value.membership.id;
  return { ...value, base: "/organizations/" + value.organization.id };
}
async function add(owner: Actor, base: string, member: Actor) {
  member.memberId = data(await call(owner, "POST", base + "/members", { accountId: member.accountId }), 201).membership.id;
  return member;
}
async function model(owner: Actor, base: string) { return data(await call(owner, "GET", base + "/governance-model")); }
async function install(owner: Actor, base: string, key = randomUUID()) {
  return data(await call(owner, "POST", base + "/governance-model/install", { packageId: "targetteal.o2" }, undefined, key), [200, 201]);
}
function entitiesOf(structure: any): any[] { return structure.entities ?? [...structure.circles, ...structure.roles]; }
async function essential(owner: Actor, base: string, circleId: string, functionCode: string) {
  const value = await model(owner, base);
  const structure = data(await call(owner, "GET", base + "/structure"));
  const rows = entitiesOf(structure);
  const boundIds = new Set(value.bindings.filter((row: any) => row.functionCode === functionCode).map((row: any) => row.roleId));
  const entity = rows.find((row: any) => row.parentId === circleId && boundIds.has(row.id));
  assert.ok(entity, `missing ${functionCode} in ${circleId}`);
  return entity;
}
async function role(owner: Actor, base: string, circleId: string, name: string) {
  return data(await call(owner, "POST", base + "/roles", { mode: "DIRECT", circleId, name }), 201).role;
}
async function circle(owner: Actor, base: string, parentCircleId: string, name: string) {
  return data(await call(owner, "POST", base + "/circles", { mode: "DIRECT", parentCircleId, name }), 201).circle;
}
async function assign(actor: Actor, base: string, roleId: string, member: Actor, extra: object = {}) {
  const value = data(await call(actor, "POST", base + "/governance-model/roles/" + roleId + "/occupancies", {
    memberId: member.memberId, startsAt: "2026-01-01T00:00:00.000Z", ...extra,
  }), [200, 201]);
  return value.occupancy ?? value;
}
async function end(actor: Actor, base: string, occupancy: any) {
  return call(actor, "POST", base + "/governance-model/occupancies/" + (occupancy.source ?? "OCCUPANCY") + "/" + occupancy.id + "/end", {}, occupancy.version);
}
async function reasons(actor: Actor, base: string, member: Actor) {
  return data(await call(actor, "GET", base + "/structure-advanced/members/" + member.memberId + "/reasons"));
}
function belongs(value: any, circleId: string) {
  return value.reasons.some((row: any) => row.circleId === circleId && row.capability === "MEMBER");
}

test("O2 installation reuses root, seeds essentials once, preserves rich definition and records model revisions", async () => {
  const owner = await account("Owner de implantação"), outsider = await account("Outra organização");
  const org = await organization(owner, "Aurora O2 sintética"), foreign = await organization(outsider, "Outra O2 isolada");
  const before = await model(owner, org.base);
  assert.equal(before.installed, false);
  const installation = await install(owner, org.base);
  assert.equal(installation.installed, true); assert.equal(installation.phase, "PREPARATION");
  const effective = data(await call(owner, "GET", org.base + "/governance/policies/" + org.rootCircle.id + "/effective"));
  assert.equal(effective.configuration.decisionProcess, "HOLACRACY_O2");
  assert.equal(effective.configuration.method, "MANUAL_FACILITATED"); assert.equal(effective.policySource, "PACKAGE");
  assert.equal(installation.bindings.length, 4);
  const firstIds = installation.bindings.map((item: any) => item.roleId).sort();
  const again = await install(owner, org.base);
  assert.deepEqual(again.bindings.map((item: any) => item.roleId).sort(), firstIds);
  const structure = data(await call(owner, "GET", org.base + "/structure"));
  const entities = entitiesOf(structure);
  assert.equal(entities.filter((row: any) => row.parentId === null).length, 1);
  assert.equal(entities.find((row: any) => row.parentId === null).id, org.rootCircle.id);
  assert.equal((await reasons(owner, org.base, owner)).reasons.length, 0, "install must not energize owner");
  assert.ok(entities.filter((row: any) => firstIds.includes(row.id)).every((row: any) => typeof row.purpose === "string" && Array.isArray(row.responsibilities) && row.responsibilities.length > 0));
  for (const row of installation.bindings) {
    const definition = entities.find((entity: any) => entity.id === row.roleId);
    if (["GUIDE", "REPRESENTATIVE"].includes(row.functionCode))
      assert.equal(definition.purpose, entities.find((entity: any) => entity.id === org.rootCircle.id).purpose);
    else assert.ok(definition.purpose);
  }
  const child = await circle(owner, org.base, org.rootCircle.id, "Cuidado e Cultura");
  const afterChild = await model(owner, org.base);
  assert.equal(afterChild.bindings.length, 8);
  const ordinary = await role(owner, org.base, child.id, "Cuidar do aprendizado");
  const list = [{ id: randomUUID(), text: "Escutar tensões e revisar acordos" }];
  const rich = { format: "orgmap-richtext", version: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Aprender em conjunto", marks: [{ type: "bold" }] }] }] } };
  const saved = data(await call(owner, "PATCH", org.base + "/roles/" + ordinary.id, { mode: "DIRECT", purposeRich: rich, responsibilities: list }, ordinary.version)).entity;
  const current = await model(owner, org.base);
  const customized = data(await call(owner, "PUT", org.base + "/governance-model", { overrides: { protectEssentials: false } }, current.revision));
  assert.equal(customized.rules.protectEssentials, false);
  const reread = data(await call(owner, "GET", org.base + "/roles/" + ordinary.id)).entity;
  assert.equal(reread.version, saved.version); assert.deepEqual(reread.purposeRich, rich); assert.deepEqual(reread.responsibilities, list);
  denied(await call(owner, "PUT", org.base + "/governance-model", { overrides: { ignoredRule: true } }, customized.revision), [400, 422]);
  await transaction(async c => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org.organization.id]);
    await c.query("INSERT INTO circle_memberships(organization_id,id,member_id,circle_id,starts_at) VALUES($1,$2,$3,$4,'2026-01-01')", [org.organization.id, randomUUID(), owner.memberId, org.rootCircle.id]);
  });
  assert.equal(belongs(await reasons(owner, org.base, owner), org.rootCircle.id), false);
  const ownRules = data(await call(owner, "PUT", org.base + "/governance-model", { overrides: { protectEssentials: false, membership: "LEGACY" } }, customized.revision));
  assert.equal(ownRules.rules.membership, "LEGACY");
  assert.equal(belongs(await reasons(owner, org.base, owner), org.rootCircle.id), true, "local model adaptation must change actual membership resolution");
  denied(await call(owner, "PUT", org.base + "/governance-model", { overrides: {} }, customized.revision), [409]);
  const history = data(await call(owner, "GET", org.base + "/governance-model/history"));
  const revisions = history.items ?? history;
  assert.ok(revisions.length >= 2);
  const originalRules = revisions.find((row: any) => row.revision === installation.revision).snapshot.rules;
  assert.equal(originalRules.membership, "OCCUPANCY"); assert.equal(originalRules.protectEssentials, true);
  assert.equal(revisions.find((row: any) => row.revision === customized.revision).snapshot.rules.protectEssentials, false);
  denied(await call(outsider, "GET", org.base + "/governance-model"));
  denied(await call(owner, "GET", foreign.base + "/governance-model"));
  assert.equal((await model(outsider, foreign.base)).installed, false);
});

test("O2 preparation and operation enforce local guide chain, prior-member self assignment, voluntary exit and tenant isolation", async () => {
  const owner = await account("Owner sem energização"), guide = await account("Guia geral"), childGuide = await account("Guia de cuidado"),
    member = await account("Integrante comum"), newcomer = await account("Sem papel"), representative = await account("Representante"), outsider = await account("Estranho ao tenant");
  const org = await organization(owner, "Vínculos O2 sintéticos"), base = org.base, root = org.rootCircle.id;
  for (const actor of [guide, childGuide, member, newcomer, representative]) await add(owner, base, actor);
  await install(owner, base);
  const child = await circle(owner, base, root, "Cuidado"), grandchild = await circle(owner, base, child.id, "Escuta"),
    sibling = await circle(owner, base, root, "Aprendizado");
  const rootGuide = await essential(owner, base, root, "GUIDE"), localGuide = await essential(owner, base, child.id, "GUIDE"),
    nestedGuide = await essential(owner, base, grandchild.id, "GUIDE"), rep = await essential(owner, base, child.id, "REPRESENTATIVE"),
    facilitator = await essential(owner, base, root, "FACILITATOR"), siblingGuide = await essential(owner, base, sibling.id, "GUIDE");
  const common = await role(owner, base, root, "Registro"), second = await role(owner, base, root, "Aprendizado"),
    local = await role(owner, base, child.id, "Cuidado comum"), directSelfRole = await role(owner, base, root, "Atribuição pela API base"),
    mandateSelfRole = await role(owner, base, root, "Mandato pela API avançada"), finiteRole = await role(owner, base, root, "Energização com prazo");
  await assign(owner, base, rootGuide.id, guide);
  await assign(owner, base, localGuide.id, childGuide);
  await assign(owner, base, rep.id, representative);
  const first = await assign(owner, base, common.id, member);
  const finite = await assign(owner, base, finiteRole.id, guide, { endsAt: "2098-01-01T00:00:00Z" });
  await assign(owner, base, common.id, newcomer, { startsAt: "2099-01-01T00:00:00Z" });
  await assign(owner, base, common.id, newcomer, { startsAt: "2020-01-01T00:00:00Z", endsAt: "2021-01-01T00:00:00Z" });
  // Synthetic existing generic association is preserved, but not counted as O2 belonging.
  await transaction(async c => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org.organization.id]);
    await c.query("INSERT INTO circle_memberships(organization_id,id,member_id,circle_id,starts_at) VALUES($1,$2,$3,$4,'2026-01-01')", [org.organization.id, randomUUID(), newcomer.memberId, root]);
  });
  assert.equal(belongs(await reasons(owner, base, newcomer), root), false);
  assert.equal(belongs(await reasons(owner, base, childGuide), root), true, "child guide belongs to outer circle");
  assert.equal(belongs(await reasons(owner, base, representative), root), true, "child representative belongs to outer circle");
  const prepared = await model(owner, base);
  const operating = data(await call(owner, "POST", base + "/governance-model/start", {}, prepared.revision));
  assert.equal(operating.phase, "OPERATING");
  const events = data(await call(owner, "GET", base + "/governance-model/events")).items;
  const initialAssignment = events.find((row: any) => row.action === "RoleEnergized" && row.snapshot.occupancy.id === first.id);
  assert.equal(initialAssignment.snapshot.origin, "OWNER_PREPARATION");
  assert.equal(initialAssignment.snapshot.occupancy.kind, "DIRECT");
  assert.equal(initialAssignment.snapshot.rules.membership, "OCCUPANCY");
  const extendingEnd = await call(guide, "POST", base + "/occupancies/" + finite.id + "/end", { endsAt: "2099-01-01T00:00:00Z" }, finite.version);
  assert.equal(extendingEnd.statusCode, 422, extendingEnd.body);
  assert.equal(extendingEnd.json().error.code, "OCCUPANCY_END_CANNOT_EXTEND");
  for (const actor of [owner, guide]) {
    const directCircleEdit = await call(actor, "PATCH", base + "/circles/" + root, {
      mode: "DIRECT", purpose: "Não contornar governança pelo fallback local",
    }, org.rootCircle.version);
    assert.equal(directCircleEdit.statusCode, 403, directCircleEdit.body);
  }
  const displayPath = base + "/structure-advanced/circles/" + root + "/display-preferences";
  const initialDisplay = data(await call(owner, "GET", displayPath));
  const changedDisplay = data(await call(owner, "PUT", displayPath, { labels: true, avatars: false, minimap: false }, initialDisplay.version));
  assert.deepEqual(changedDisplay.preferences, { labels: true, avatars: false, minimap: false });
  assert.deepEqual(data(await call(owner, "GET", displayPath)).preferences, changedDisplay.preferences);
  const changes = [{ kind: "UPDATE", entityId: local.id, baseVersion: local.version, name: "Mudança dentro de Cuidado" }];
  const foreignCircleProposal = await call(guide, "POST", base + "/proposals", {
    circleId: child.id, title: "Guia externo não integra automaticamente o filho", kind: "GOVERNANCE", payload: { changes },
  });
  assert.equal(foreignCircleProposal.statusCode, 403, foreignCircleProposal.body);
  const nestedEdit = await call(guide, "POST", base + "/proposals", {
    circleId: root, title: "Círculo externo não edita papel interno diretamente", kind: "GOVERNANCE", payload: { changes },
  });
  assert.equal(nestedEdit.statusCode, 422, nestedEdit.body);
  assert.equal(nestedEdit.json().error.code, "GOVERNANCE_CIRCLE_SCOPE");
  const ownProposal = data(await call(guide, "POST", base + "/proposals", {
    circleId: root, title: "Alterar papel do próprio círculo", kind: "GOVERNANCE",
    payload: { changes: [{ kind: "UPDATE", entityId: common.id, baseVersion: common.version, name: "Registro com clareza" }] },
  }), 201);
  data(await call(guide, "POST", base + "/proposals/" + ownProposal.id + "/actions/submit", {}, ownProposal.version));
  const submittedVersion = data(await call(guide, "GET", base + "/proposals/" + ownProposal.id)).proposal.version;
  for (const [action, payload] of [["step", { step: "REACT" }], ["decide", { verdict: "ADOPT", reason: "Não deve autorizar owner sem papel" }], ["apply", {}]] as const) {
    const ownerAttempt = await call(owner, "POST", base + "/proposals/" + ownProposal.id + "/actions/" + action, payload, submittedVersion);
    assert.equal(ownerAttempt.statusCode, 403, ownerAttempt.body);
  }
  denied(await call(owner, "POST", base + "/governance-model/roles/" + second.id + "/occupancies", { memberId: newcomer.memberId }));
  denied(await call(member, "POST", base + "/roles/" + second.id + "/occupancies", { memberId: newcomer.memberId, kind: "DIRECT", startsAt: "2026-01-01T00:00:00Z" }));
  denied(await call(member, "POST", base + "/structure-advanced/mandates", { roleId: second.id, memberId: newcomer.memberId, kind: "DIRECT", startsAt: "2026-01-01T00:00:00Z", scope: "" }));
  const rootConfig = operating.circles.find((row: any) => row.circleId === root);
  const enabled = data(await call(guide, "PUT", base + "/governance-model/circles/" + root, { selfAssignment: true }, rootConfig.version));
  assert.equal(enabled.selfAssignment, true);
  denied(await call(newcomer, "POST", base + "/governance-model/roles/" + second.id + "/occupancies", { memberId: newcomer.memberId }));
  const secondLink = await assign(member, base, second.id, member);
  const directSelf = data(await call(member, "POST", base + "/roles/" + directSelfRole.id + "/occupancies", {
    memberId: member.memberId, kind: "DIRECT", startsAt: "2026-01-01T00:00:00Z",
  }), 201).occupancy;
  const mandateSelf = data(await call(member, "POST", base + "/structure-advanced/mandates", {
    roleId: mandateSelfRole.id, memberId: member.memberId, kind: "DIRECT", startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z", scope: "Acordo de atuação sintético",
  }), 201);
  assert.equal(belongs(await reasons(member, base, member), root), true);
  denied(await call(guide, "POST", base + "/governance-model/roles/" + facilitator.id + "/occupancies", { memberId: member.memberId }));
  denied(await call(member, "POST", base + "/governance-model/roles/" + facilitator.id + "/occupancies", { memberId: member.memberId }));
  denied(await call(guide, "POST", base + "/governance-model/roles/" + nestedGuide.id + "/occupancies", { memberId: newcomer.memberId }));
  await assign(guide, base, siblingGuide.id, representative);
  await assign(childGuide, base, nestedGuide.id, newcomer);
  const fresh = await model(owner, base);
  const childConfig = fresh.circles.find((row: any) => row.circleId === child.id);
  denied(await call(guide, "PUT", base + "/governance-model/circles/" + child.id, { selfAssignment: true }, childConfig.version));
  data(await call(owner, "PUT", base + "/governance-model/circles/" + child.id, { selfAssignment: true }, childConfig.version));
  const localLink = await assign(childGuide, base, local.id, member);
  const rootCurrent = (await model(owner, base)).circles.find((row: any) => row.circleId === root);
  data(await call(owner, "PUT", base + "/governance-model/circles/" + root, { selfAssignment: false }, rootCurrent.version));
  data(await call(member, "POST", base + "/occupancies/" + directSelf.id + "/end", {}, directSelf.version));
  data(await call(member, "POST", base + "/structure-advanced/mandates/" + mandateSelf.id + "/end", {}, mandateSelf.version));
  data(await end(member, base, first));
  denied(await call(member, "POST", base + "/occupancies/" + first.id + "/end", {}, first.version), [403, 409, 422]);
  assert.equal(belongs(await reasons(member, base, member), root), true, "second role sustains membership");
  data(await end(member, base, secondLink));
  assert.equal(belongs(await reasons(member, base, member), root), false);
  assert.equal(belongs(await reasons(member, base, member), child.id), true);
  data(await end(member, base, localLink));
  assert.equal((await reasons(member, base, member)).reasons.length, 0);
  const endedDetail = data(await call(member, "GET", base + "/governance-model/roles/" + common.id));
  const endedLink = endedDetail.occupancies.find((row: any) => row.id === first.id);
  assert.ok(endedLink);
  const reactivation = await call(member, "POST", base + "/occupancies/" + first.id + "/end", { endsAt: "2099-01-01T00:00:00Z" }, endedLink.version);
  assert.equal(reactivation.statusCode, 403, reactivation.body);
  assert.ok(data(await call(member, "GET", base + "/members?limit=100")).items.some((row: any) => row.id === member.memberId), "last exit preserves organization membership");
  const agreed = await assign(guide, base, common.id, member, { exitNotBefore: "2099-01-01T00:00:00Z", exitAgreement: "Acordo sintético explícito de permanência até a data" });
  denied(await end(member, base, agreed), [403, 409, 422]);
  denied(await call(outsider, "GET", base + "/governance-model/roles/" + common.id));
  // Owner administrative authority does not substitute operational circle membership.
  denied(await call(owner, "POST", base + "/proposals", { circleId: root, title: "Owner sem papel", kind: "GOVERNANCE", payload: { changes: [{ kind: "UPDATE", entityId: common.id, baseVersion: 1, name: "Não autorizado" }] } }));
  await transaction(async c => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org.organization.id]);
    assert.equal((await c.query("SELECT 1 FROM circle_memberships WHERE organization_id=$1 AND member_id=$2", [org.organization.id, newcomer.memberId])).rowCount, 1);
  });
});

test("explicit custom assignment and guide-selection rules activate legacy authorization in dedicated role endpoints", async () => {
  const owner = await account("Owner do modelo próprio"), assigner = await account("Atribuidor por flag genérica"), target = await account("Pessoa energizada pelo modelo próprio");
  const org = await organization(owner, "O2 adaptado explicitamente"), base = org.base, root = org.rootCircle.id;
  await add(owner, base, assigner); await add(owner, base, target); await install(owner, base);
  const child = await circle(owner, base, root, "Círculo de modelo próprio");
  const common = await role(owner, base, root, "Papel comum adaptado"), flagsRole = await role(owner, base, child.id, "Atribuidor local"),
    childGuide = await essential(owner, base, child.id, "GUIDE");
  data(await call(owner, "PUT", base + "/structure-advanced/roles/" + flagsRole.id + "/settings", {
    templateId: null, flags: { core: false, electable: false, assigner: true, representative: false, admin: false },
  }, 0));
  await assign(owner, base, flagsRole.id, assigner);
  const prepared = await model(owner, base);
  const operating = data(await call(owner, "POST", base + "/governance-model/start", {}, prepared.revision));
  denied(await call(owner, "POST", base + "/governance-model/roles/" + common.id + "/occupancies", { memberId: target.memberId }));
  denied(await call(assigner, "POST", base + "/governance-model/roles/" + childGuide.id + "/occupancies", { memberId: target.memberId }));
  const custom = data(await call(owner, "PUT", base + "/governance-model", {
    overrides: { assignment: "LEGACY", guideSelection: "LEGACY", structureChanges: "LEGACY" },
  }, operating.revision));
  assert.equal(custom.rules.assignment, "LEGACY"); assert.equal(custom.rules.guideSelection, "LEGACY");
  await assign(owner, base, common.id, target);
  await assign(assigner, base, childGuide.id, target);
  assert.equal(belongs(await reasons(assigner, base, target), child.id), true);
});

test("existing election application enforces O2 candidate belonging and guide incompatibility without direct/interim bypass", async () => {
  const owner = await account("Guia e facilitador administrativo da eleição"), candidate = await account("Candidata integrante"), nonmember = await account("Pessoa sem vínculo");
  const org = await organization(owner, "Eleição O2 focal"), base = org.base, root = org.rootCircle.id;
  await add(owner, base, candidate); await add(owner, base, nonmember);
  await install(owner, base);
  const guide = await essential(owner, base, root, "GUIDE"), facilitator = await essential(owner, base, root, "FACILITATOR");
  const common = await role(owner, base, root, "Aprendizado eleitoral");
  await assign(owner, base, guide.id, owner); await assign(owner, base, common.id, candidate);
  const prepared = await model(owner, base);
  data(await call(owner, "POST", base + "/governance-model/start", {}, prepared.revision));
  for (const actor of [owner, candidate]) {
    denied(await call(actor, "POST", base + "/roles/" + facilitator.id + "/occupancies", {
      memberId: actor.memberId, kind: "INTERIM", startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z",
    }));
  }
  async function election(winner: Actor, shouldApply: boolean) {
    const created = await call(owner, "POST", base + "/proposals", { title: "Escolha focal para facilitação", circleId: root, kind: "ELECTION",
      payload: { roleId: facilitator.id, winnerId: winner.memberId, mandateEnd: new Date(Date.now() + 86_400_000).toISOString() } });
    if (!shouldApply && created.statusCode >= 400) { denied(created, [403, 409, 422]); return; }
    const proposal = data(created, 201), path = base + "/proposals/" + proposal.id;
    const submitted = await call(owner, "POST", path + "/actions/submit", {}, proposal.version);
    if (!shouldApply && submitted.statusCode >= 400) { denied(submitted, [403, 409, 422]); return; }
    data(submitted);
    let detail = data(await call(owner, "GET", path)), version = detail.proposal.version;
    for (const actor of [owner, candidate]) data(await call(actor, "POST", path + "/votes", { choice: "CONSENT" }, version));
    const steps = detail.rounds.at(-1).policy.workflowSteps as string[];
    for (const step of steps.slice(1)) data(await call(owner, "POST", path + "/actions/step", { step }, version));
    data(await call(owner, "POST", path + "/actions/decide", { verdict: "ADOPT", reason: "Consentimento no mecanismo eleitoral existente; não certifica rito O2 integral" }, version));
    detail = data(await call(owner, "GET", path));
    const applied = await call(owner, "POST", path + "/actions/apply", {}, detail.proposal.version);
    if (shouldApply) assert.equal(data(applied).applyState, "APPLIED");
    else if (applied.statusCode >= 400) denied(applied, [403, 409, 422]);
    else assert.notEqual(data(applied).applyState, "APPLIED");
  }
  await election(nonmember, false); await election(owner, false); await election(candidate, true);
  const mandates = data(await call(owner, "GET", base + "/structure-advanced/roles/" + facilitator.id + "/mandates")).items;
  assert.equal(mandates.filter((row: any) => row.memberId === candidate.memberId && row.kind === "ELECTED").length, 1);
  assert.equal(mandates.some((row: any) => row.memberId === nonmember.memberId || row.memberId === owner.memberId), false);
});

test("legacy organization retains generic membership and assignment semantics without installing O2", async () => {
  const owner = await account("Owner legado"), member = await account("Membro legado");
  const org = await organization(owner, "Legado preservado"); await add(owner, org.base, member);
  const existing = await role(owner, org.base, org.rootCircle.id, "Papel genérico");
  const membership = data(await call(owner, "POST", org.base + "/circles/" + org.rootCircle.id + "/memberships", { memberId: member.memberId, startsAt: "2026-01-01T00:00:00Z" }), 201).membership;
  assert.ok(membership.id);
  assert.equal(belongs(await reasons(owner, org.base, member), org.rootCircle.id), true);
  data(await call(owner, "POST", org.base + "/roles/" + existing.id + "/occupancies", { memberId: member.memberId, kind: "DIRECT", startsAt: "2026-01-01T00:00:00Z" }), 201);
  assert.equal((await model(owner, org.base)).installed, false);
});

test("O2 proposal creation and submission require membership in the target circle for both consent methods", async () => {
  for (const method of ["MANUAL_FACILITATED", "CONSENT_WINDOW"] as const) {
    const owner = await account("Implantação"), participant = await account("Integrante"), invited = await account("Convidada em outro círculo");
    const org = await organization(owner, "Escopo de proposta " + method), base = org.base, root = org.rootCircle.id;
    await add(owner, base, participant); await add(owner, base, invited);
    await install(owner, base);
    const child = await circle(owner, base, root, "Círculo próprio da convidada");
    const rootRole = await role(owner, base, root, "Trabalho do círculo da reunião");
    const ownRole = await role(owner, base, child.id, "Trabalho do círculo próprio");
    await assign(owner, base, rootRole.id, participant);
    await assign(owner, base, ownRole.id, invited);
    data(await call(owner, "POST", base + "/governance/policies", {
      circleId: root, configuration: { ...defaultPolicy, decisionProcess: "HOLACRACY_O2", method },
    }));
    const current = await model(owner, base);
    data(await call(owner, "POST", base + "/governance-model/start", {}, current.revision));
    const input = { circleId: root, title: "Proposta com escopo", kind: "GOVERNANCE", payload: {
      changes: [{ kind: "UPDATE", entityId: rootRole.id, baseVersion: rootRole.version, name: "Trabalho atualizado" }],
    } };
    assert.equal((await call(invited, "POST", base + "/proposals", input)).statusCode, 403);
    const proposal = data(await call(participant, "POST", base + "/proposals", input), 201);
    denied(await call(invited, "POST", base + "/proposals/" + proposal.id + "/actions/submit", {}, proposal.version), [403, 404]);
    assert.equal(data(await call(participant, "GET", base + "/proposals/" + proposal.id)).proposal.state, "DRAFT");
    const own = data(await call(invited, "POST", base + "/proposals", {
      circleId: child.id, title: "Acesso preservado no próprio círculo", kind: "GOVERNANCE", payload: {
        changes: [{ kind: "UPDATE", entityId: ownRole.id, baseVersion: ownRole.version, name: "Meu trabalho atualizado" }],
      },
    }), 201);
    data(await call(invited, "POST", base + "/proposals/" + own.id + "/actions/submit", {}, own.version));
  }
});

test("package governance defaults preserve explicit local STANDARD and administrative method overrides", async () => {
  const owner = await account("Owner de políticas preservadas");
  const localOrg = await organization(owner, "Política local anterior");
  data(await call(owner, "POST", localOrg.base + "/governance/policies", {
    circleId: localOrg.rootCircle.id, configuration: { ...defaultPolicy, decisionProcess: "STANDARD", method: "CONSENT_ROUND" },
  }));
  await install(owner, localOrg.base);
  const local = data(await call(owner, "GET", localOrg.base + "/governance/policies/" + localOrg.rootCircle.id + "/effective"));
  assert.equal(local.policySource, "LOCAL"); assert.equal(local.configuration.decisionProcess, "STANDARD");
  assert.equal(local.configuration.method, "CONSENT_ROUND");
  const adminOrg = await organization(owner, "Método organizacional anterior");
  data(await call(owner, "POST", adminOrg.base + "/administration/policies", {
    value: { key: "governance.method", value: "CONSENT_ROUND", allowOverride: true, parentId: null },
  }), [200, 201]);
  await install(owner, adminOrg.base);
  const administrative = data(await call(owner, "GET", adminOrg.base + "/governance/policies/" + adminOrg.rootCircle.id + "/effective"));
  assert.equal(administrative.policySource, "ORGANIZATION"); assert.equal(administrative.configuration.method, "CONSENT_ROUND");
  assert.equal(administrative.configuration.decisionProcess, "HOLACRACY_O2");
});

test("O2 checks future incompatible intervals and rechecks approved document scope at application", async () => {
  const owner = await account("Guia externo para acordos futuros"), target = await account("Pessoa com energizações agendadas");
  const org = await organization(owner, "Compatibilidade e escopo documental"), base = org.base, root = org.rootCircle.id;
  await add(owner, base, target); await install(owner, base);
  const rootGuide = await essential(owner, base, root, "GUIDE"); await assign(owner, base, rootGuide.id, owner);
  const circles = [await circle(owner, base, root, "Facilitação futura"), await circle(owner, base, root, "Representação futura")];
  const functions = ["FACILITATOR", "REPRESENTATIVE"];
  const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const children: { guideId: string; circleId: string }[] = [];
  for (let index = 0; index < circles.length; index++) {
    const elected = await essential(owner, base, circles[index].id, functions[index]);
    const childGuide = await essential(owner, base, circles[index].id, "GUIDE");
    await assign(owner, base, elected.id, target, { startsAt: at(1), endsAt: at(14) });
    children.push({ guideId: childGuide.id, circleId: circles[index].id });
  }
  const common = await role(owner, base, root, "Âmbito documental móvel");
  const document = data(await call(owner, "POST", base + "/documents", {
    title: "Acordo do papel do círculo geral", ownerId: common.id, workflow: "GOVERNANCE", visibility: "ORGANIZATION", content: "Texto sintético de acordo",
  }), 201);
  const nestedDocument = data(await call(owner, "POST", base + "/documents", {
    title: "Acordo do círculo interno", ownerId: circles[0].id, workflow: "GOVERNANCE", visibility: "ORGANIZATION", content: "Restrição sintética interna",
  }), 201);
  const preparation = await model(owner, base);
  data(await call(owner, "POST", base + "/governance-model/start", {}, preparation.revision));
  for (const child of children) {
    const incompatible = await call(owner, "POST", base + "/governance-model/roles/" + child.guideId + "/occupancies", {
      memberId: target.memberId, startsAt: at(7), endsAt: at(21),
    });
    assert.equal(incompatible.statusCode, 422, incompatible.body);
    assert.equal(incompatible.json().error.code, "ROLE_INCOMPATIBILITY");
    await assign(owner, base, child.guideId, target, { startsAt: "2020-01-01T00:00:00Z", endsAt: "2021-01-01T00:00:00Z" });
    await assign(owner, base, child.guideId, target, { startsAt: at(15), endsAt: at(21) });
  }
  const foreignDocumentProposal = await call(owner, "POST", base + "/proposals", {
    title: "Não governar documento do círculo interno", circleId: root, kind: "DOCUMENT",
    payload: { documentId: nestedDocument.id, documentVersion: nestedDocument.draftVersion },
  });
  assert.equal(foreignDocumentProposal.statusCode, 422, foreignDocumentProposal.body);
  assert.equal(foreignDocumentProposal.json().error.code, "GOVERNANCE_CIRCLE_SCOPE");
  const proposal = data(await call(owner, "POST", base + "/proposals", {
    title: "Acordo inicialmente no escopo correto", circleId: root, kind: "DOCUMENT",
    payload: { documentId: document.id, documentVersion: document.draftVersion },
  }), 201);
  const path = base + "/proposals/" + proposal.id;
  data(await call(owner, "POST", path + "/actions/submit", {}, proposal.version));
  let detail = data(await call(owner, "GET", path));
  data(await call(owner, "POST", path + "/votes", { choice: "CONSENT" }, detail.proposal.version));
  for (const step of detail.rounds.at(-1).policy.workflowSteps.slice(1))
    data(await call(owner, "POST", path + "/actions/step", { step }, detail.proposal.version));
  data(await call(owner, "POST", path + "/actions/decide", { verdict: "ADOPT", reason: "Acordo aprovado antes da mudança concorrente de escopo" }, detail.proposal.version));
  detail = data(await call(owner, "GET", path));
  await transaction(async c => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org.organization.id]);
    await c.query("UPDATE entities SET parent_id=$3,version=version+1 WHERE organization_id=$1 AND id=$2", [org.organization.id, common.id, circles[0].id]);
  });
  const application = await call(owner, "POST", path + "/actions/apply", {}, detail.proposal.version);
  assert.equal(application.statusCode, 409, application.body);
  assert.equal(application.json().error.code, "APPLY_CONFLICT");
  assert.equal(application.json().error.conflictDetails.applyState, "APPLY_CONFLICT");
  assert.equal(application.json().error.conflictDetails.conflictCode, "GOVERNANCE_CIRCLE_SCOPE");
  const final = data(await call(owner, "GET", path));
  assert.equal(final.proposal.verdict, "ADOPT"); assert.equal(final.proposal.applyState, "APPLY_CONFLICT");
});

test("O2 operation can pause back to preparation and restore direct owner editing of inner circles", async () => {
  const owner = await account("Owner da pausa"), member = await account("Membro sem autoridade direta");
  const org = await organization(owner, "Operação pausável"), base = org.base, root = org.rootCircle.id;
  await add(owner, base, member); await install(owner, base);
  const child = await circle(owner, base, root, "Círculo interno anterior");
  const prepared = await model(owner, base);
  const operating = data(await call(owner, "POST", base + "/governance-model/start", {}, prepared.revision));
  assert.equal(operating.phase, "OPERATING");
  const deniedEdit = await call(owner, "PATCH", base + "/circles/" + child.id, { mode: "DIRECT", purpose: "Negado em operação" }, child.version);
  assert.equal(deniedEdit.statusCode, 403, deniedEdit.body);
  const deniedCreate = await call(owner, "POST", base + "/circles", { mode: "DIRECT", parentCircleId: child.id, name: "Círculo negado" });
  assert.equal(deniedCreate.statusCode, 403, deniedCreate.body);
  denied(await call(member, "POST", base + "/governance-model/pause", {}, operating.revision));
  denied(await call(owner, "POST", base + "/governance-model/pause", {}, prepared.revision), [409]);
  const paused = data(await call(owner, "POST", base + "/governance-model/pause", {}, operating.revision));
  assert.equal(paused.phase, "PREPARATION");
  const repeated = data(await call(owner, "POST", base + "/governance-model/pause", {}, paused.revision));
  assert.equal(repeated.phase, "PREPARATION"); assert.equal(repeated.revision, paused.revision);
  data(await call(owner, "PATCH", base + "/circles/" + child.id, { mode: "DIRECT", purpose: "Propósito ajustado na preparação" }, child.version));
  const grandchild = await circle(owner, base, child.id, "Círculo interno criado na preparação");
  const bindings = (await model(owner, base)).bindings.filter((row: any) => row.functionCode === "GUIDE").map((row: any) => row.roleId);
  const structure = entitiesOf(data(await call(owner, "GET", base + "/structure")));
  assert.ok(structure.some((row: any) => row.parentId === grandchild.id && bindings.includes(row.id)), "new circle receives essential roles");
  const restarted = data(await call(owner, "POST", base + "/governance-model/start", {}, paused.revision));
  assert.equal(restarted.phase, "OPERATING"); assert.ok(restarted.revision > paused.revision);
  const events = data(await call(owner, "GET", base + "/governance-model/events")).items;
  assert.equal(events.filter((row: any) => row.action === "OrganizationOperationPaused").length, 1);
});

function deflatedZip(entries: Record<string, string>) {
  const crc = (data: Buffer) => {
    let n = 0xffffffff;
    for (const byte of data) {
      n ^= byte;
      for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, source] of Object.entries(entries)) {
    const filename = Buffer.from(name), raw = Buffer.from(source),
      compressed = deflateRawSync(raw), checksum = crc(raw),
      head = Buffer.alloc(30), directory = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(checksum, 14); head.writeUInt32LE(compressed.length, 18);
    head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10); directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(head, filename, compressed); central.push(directory, filename);
    offset += head.length + filename.length + compressed.length;
  }
  const body = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(body.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, body, end]);
}
async function uploadArchive(actor: Actor, base: string, bytes: Buffer, version: number, key = randomUUID()) {
  return app.inject({ method: "POST", url: "/api/v1" + base + "/governance-model/import", payload: bytes, headers: {
    origin, cookie: actor.cookie, "x-csrf-token": actor.csrf, "idempotency-key": key,
    "if-match": `"${version}"`, "content-type": "application/zip",
  } });
}

test("O2 preparation imports external governance archive with structure, energizations, policies and documents", async () => {
  const owner = await account("Owner da importação"), member = await account("Membro energizado pela importação"), outsider = await account("Sem papel importado");
  const org = await organization(owner, "Organização importadora"), base = org.base, root = org.rootCircle.id;
  await add(owner, base, member);
  const installation = await install(owner, base);
  const anchor = "aaaaaaaa-0000-4000-8000-000000000001", marketing = "aaaaaaaa-0000-4000-8000-000000000002",
    product = "aaaaaaaa-0000-4000-8000-000000000003", orphan = "aaaaaaaa-0000-4000-8000-000000000004",
    roleA = "bbbbbbbb-0000-4000-8000-000000000001", roleB = "bbbbbbbb-0000-4000-8000-000000000002";
  const archive = deflatedZip({
    "circles.csv": [
      "circle_id,circle_name,parent_circle_id,parent_circle_name,decision_makers,other_members,roles,sub_circles,purpose,domains,accountabilities,Strategy",
      `${anchor},Exportadora,,,9,0,29,2,Propósito da raiz exportada,Domínio orgânico,Prestar contas da organização,Estratégia herdada`,
      `${marketing},Marketing,${anchor},Exportadora,3,0,2,1,Crescimento sustentável,"Marca
Comunidade","Publicar conteúdo
Medir canais",`,
      `${product},Produto,${marketing},Marketing,1,0,1,0,,,,Célula de produto`,
      `${orphan},Órfão,ffffffff-0000-4000-8000-000000000099,Inexistente,0,0,0,0,,,,`,
    ].join("\r\n"),
    "roles.csv": [
      "circle_id,role_id,circle_name,role_name,from_template,hiring,has_holders,created_at,purpose,domains,accountabilities,Due in,Last update,extra_domains,extra_accountabilities",
      `${marketing},${roleA},Marketing,Editora,false,false,true,2026-01-01,Conteúdo publicado,Editorial,"Escrever artigos
Revisar textos",,,Blog,Agendar pauta`,
      `${anchor},${roleB},Exportadora,Curadoria,false,false,false,2026-01-01,Curadoria geral,,Selecionar temas,,,,`,
    ].join("\r\n"),
    "assignments.csv": [
      "member_id,member_display_name,member_email,circle_id,circle_name,role_id,role_name,since,until,scope,decision_maker,circle_admin,time_spent_assignation",
      `cccccccc,Importado,${member.email},${marketing},Marketing,${roleA},Editora,2026-01-15,,Meio período,true,false,`,
      `dddddddd,Externo,externo@example.test,${anchor},Exportadora,${roleB},Curadoria,2026-01-15,,,false,false,`,
    ].join("\r\n"),
    "policies.csv": [
      "circle_id,circle_name,role_id,role_name,domain,policy,description",
      `${marketing},Marketing,,,Editorial,Aprovação prévia,Publicações exigem revisão da editoria.`,
    ].join("\r\n"),
    "documents.csv": [
      "circle_id,circle_name,role_id,role_name,member_display_name,member_email,title,description,type,status,privacy,published_at,next_review_at,attachments",
      `${marketing},Marketing,${roleA},Editora,Importado,${member.email},Guia de estilo,Usar tom direto.,Compliance,PUBLISHED,PRIVATE,,,`,
      `${marketing},Marketing,,,Importado,${member.email},Rascunho interno,Notas soltas.,Other,DRAFT,PRIVATE,,,`,
    ].join("\r\n"),
  });
  denied(await call(member, "POST", base + "/governance-model/import", {}), [400, 403, 415]);
  const deniedMember = await uploadArchive(member, base, archive, installation.revision);
  assert.equal(deniedMember.statusCode, 403, deniedMember.body);
  const imported = data(await uploadArchive(owner, base, archive, installation.revision), [200, 201]);
  assert.equal(imported.import.circles, 3); assert.equal(imported.import.roles, 2);
  assert.equal(imported.import.assignments, 1); assert.equal(imported.import.policies, 1);
  assert.equal(imported.import.documents, 2); assert.equal(imported.import.strategies, 2);
  assert.deepEqual(imported.import.unmatchedMembers, ["externo@example.test"]);
  assert.ok(imported.import.skipped.some((row: any) => row.reference === "Órfão" && row.reason === "PARENT_NOT_FOUND"));
  const structure = data(await call(owner, "GET", base + "/structure")), entities = entitiesOf(structure);
  const mkt = entities.find((row: any) => row.name === "Marketing"), prd = entities.find((row: any) => row.name === "Produto"),
    editora = entities.find((row: any) => row.name === "Editora"), curadoria = entities.find((row: any) => row.name === "Curadoria"),
    rootCircle = entities.find((row: any) => row.parentId === null);
  assert.equal(mkt.parentId, root); assert.equal(prd.parentId, mkt.id);
  assert.equal(editora.parentId, mkt.id); assert.equal(curadoria.parentId, root);
  assert.equal(rootCircle.id, root); assert.equal(rootCircle.purpose, "Propósito da raiz exportada");
  assert.ok(rootCircle.responsibilities.some((item: any) => item.text === "Prestar contas da organização"));
  assert.ok(rootCircle.artifacts.some((item: any) => item.text === "Domínio orgânico"));
  assert.equal(editora.purpose, "Conteúdo publicado");
  assert.deepEqual(editora.artifacts.map((item: any) => item.text).sort(), ["Blog", "Editorial"]);
  assert.ok(editora.responsibilities.some((item: any) => item.text === "Agendar pauta"));
  for (const circleId of [mkt.id, prd.id]) assert.ok(await essential(owner, base, circleId, "GUIDE"));
  const detail = data(await call(owner, "GET", base + "/governance-model/roles/" + editora.id));
  assert.ok(detail.occupancies.some((row: any) => row.memberId === member.memberId && row.scope === "Meio período"));
  await transaction(async c => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org.organization.id]);
    const strategy = (await c.query("SELECT value FROM structure_values v JOIN structure_fields f ON f.organization_id=v.organization_id AND f.id=v.field_id WHERE v.organization_id=$1 AND f.key='strategy' AND v.entity_id=$2", [org.organization.id, root])).rows[0];
    assert.equal(strategy?.value, "Estratégia herdada");
    const productStrategy = (await c.query("SELECT value FROM structure_values v JOIN structure_fields f ON f.organization_id=v.organization_id AND f.id=v.field_id WHERE v.organization_id=$1 AND f.key='strategy' AND v.entity_id=$2", [org.organization.id, prd.id])).rows[0];
    assert.equal(productStrategy?.value, "Célula de produto");
    const type = (await c.query("SELECT name FROM gov_document_types WHERE organization_id=$1 AND lower(name)='política'", [org.organization.id])).rows[0];
    assert.ok(type, "import creates the policy document type");
  });
  const ownerDocs = data(await call(owner, "GET", base + "/documents")).items;
  assert.ok(ownerDocs.some((row: any) => row.title === "Aprovação prévia" && row.publishedVersion === 1));
  const memberDocs = data(await call(member, "GET", base + "/documents")).items;
  assert.ok(memberDocs.some((row: any) => row.title === "Guia de estilo" && row.publishedVersion === 1));
  assert.ok(memberDocs.some((row: any) => row.title === "Rascunho interno" && row.publishedVersion === null));
  assert.ok(!ownerDocs.some((row: any) => row.title === "Guia de estilo"), "private imported document stays restricted to its author");
  const stored = zip({ "circles.csv": "circle_id,circle_name,parent_circle_id,parent_circle_name,purpose\n" + randomUUID() + ",Extra,,\n" });
  const storedImport = data(await uploadArchive(owner, base, stored, imported.revision), [200, 201]);
  assert.equal(storedImport.import.circles, 1, "stored (method 0) entries also parse");
  const prepared = await model(owner, base);
  const operating = data(await call(owner, "POST", base + "/governance-model/start", {}, prepared.revision));
  assert.equal(operating.phase, "OPERATING");
  const lateImport = await uploadArchive(owner, base, archive, operating.revision);
  assert.equal(lateImport.statusCode, 409, lateImport.body);
  assert.equal(lateImport.json().error.code, "IMPORT_REQUIRES_PREPARATION");
});

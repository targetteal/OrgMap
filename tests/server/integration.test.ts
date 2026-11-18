import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

function fixtureDispatchRole() {
  const prefix = process.env.INTEGRATION_TEST_ROLE_PREFIX;
  if (prefix && !/^orgmap_it_[a-f0-9]{32}_$/.test(prefix)) throw Error('INVALID_INTEGRATION_ROLE_PREFIX');
  return prefix ? `${prefix}${randomUUID().replaceAll('-', '').slice(0, 16)}` : `integration_dispatch_${randomUUID().replaceAll('-', '')}`;
}
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildApp } from '../../server/src/app.js';
import { pool } from '../../server/src/db.js';
import { createIntegrationEnvironment, createOrgMapIntegration, createPlatformWorker, createIntegratedDispatcher } from '../../server/integration/index.js';
import { createRuntime } from '../../server/src/runtime.js';
import { PostgresScopeDispatch, enqueueNotification } from '../../server/modules/platform/index.js';
import { startSmtpSink, sendLocalMail } from '../../server/src/smtp.js';
import { defaultPolicy } from '../../server/modules/governance/domain.js';
import { memberProjects } from '../../server/modules/work/member-profile.js';
import { memberGoals } from '../../server/modules/goals/member-profile.js';
import { memberResourceAdapter } from '../../server/modules/administration/resources.js';
import { fail } from '../../server/src/core.js';
import { encodeTransfer, decodeTransfer } from '../../server/modules/platform/transfer.js';

const origin = 'http://integration.localhost:5273';
process.env.ALLOWED_ORIGINS = origin;
process.env.ORGMAP_PUBLIC_URL = origin;
delete process.env.BREVO_API_KEY;
if (!/^\/orgmap_(?:test|integration|goals|quality)_[a-z0-9]+$/.test(new URL(process.env.DATABASE_URL ?? 'postgres://invalid/orgmap').pathname))
  throw Error('EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED');
after(async () => { await pool.end(); });
// Domain actions now enqueue real notices. The global dispatcher must not claim
// an earlier test's pending notifications when the next test asserts its lease.
const fixtureOrganizations = new Set<string>();
afterEach(async () => {
  const ids=[...fixtureOrganizations];
  if(!ids.length)return;
  const appUrl=new URL(process.env.DATABASE_URL!),operatorUrl=new URL(process.env.MIGRATION_DATABASE_URL!);
  if(!['127.0.0.1','localhost','[::1]'].includes(appUrl.hostname)||operatorUrl.host!==appUrl.host||operatorUrl.pathname!==appUrl.pathname)
    throw Error('MATCHING_EXCLUSIVE_INTEGRATION_DATABASE_REQUIRED');
  const admin=new pg.Pool({connectionString:operatorUrl.href});
  try {
    await admin.query('DELETE FROM platform_deliveries WHERE organization_id=ANY($1::uuid[])',[ids]);
    await admin.query('DELETE FROM platform_scope_wakes WHERE organization_id=ANY($1::uuid[])',[ids]);
  } finally {await admin.end();fixtureOrganizations.clear();}
});

type Session = { cookie: string; csrf: string; accountId: string; email: string };
async function account(app: FastifyInstance, label: string, password = `Synthetic-${randomUUID()}`, email = `integration-${randomUUID()}@example.test`): Promise<Session> {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/register', headers: { origin },
    payload: { email, password, displayName: label },
  });
  assert.equal(response.statusCode, 201, response.body);
  const session = response.cookies.find(cookie => cookie.name === 'orgmap_session');
  assert.ok(session);
  const data = response.json().data;
  return { cookie: `orgmap_session=${session.value}`, csrf: data.csrfToken, accountId: data.account.id, email: data.account.email };
}
async function request(app: FastifyInstance, session: Session, method: HTTPMethods, url: string, payload?: object, version?: number, key = randomUUID()) {
  const response=await app.inject({ method, url, payload,
    headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf,
      'idempotency-key': key, ...(version === undefined ? {} : { 'if-match': `"${version}"` }) },
  });
  if(method==='POST'&&url==='/api/v1/organizations'&&response.statusCode===201)
    fixtureOrganizations.add(response.json().data.organization.id);
  return response;
}
const ok = (response: { statusCode: number; body: string; json: () => any }, expected: number) => {
  assert.equal(response.statusCode, expected, response.body);
  return response.json().data;
};
async function enableGoals(app: FastifyInstance, owner: Session, base: string) {
  const current = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
  current.settings.modules.goals = true;
  ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: current.settings }, current.version), 200);
}

test('member profile Work reader authorizes target and each project before pagination', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Profile owner'), target = await account(app, 'Profile target'), viewer = await account(app, 'Profile viewer');
    const org = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Profile A' }), 201);
    const foreign = ok(await request(app, viewer, 'POST', '/api/v1/organizations', { name: 'Profile B' }), 201);
    const base = `/api/v1/organizations/${org.organization.id}`;
    await enableGoals(app, owner, base);
    const targetMember = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: target.accountId }), 201).membership;
    ok(await request(app, owner, 'POST', `${base}/members`, { accountId: viewer.accountId }), 201);
    for (const title of ['Public A', 'Public B']) {
      const project = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title, visibility: 'PUBLIC' }), 201).project;
      const task = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Assigned', projectId: project.id }), 201).task;
      ok(await request(app, owner, 'POST', `${base}/work/tasks/${task.id}/assignments`, { memberIds: [targetMember.id] }, task.version), 200);
    }
    const privateProject = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Private secret', visibility: 'PRIVATE' }), 201).project;
    ok(await request(app, owner, 'POST', `${base}/work/projects/${privateProject.id}/access`, { memberId: targetMember.id, role: 'READER' }, privateProject.version), 201);
    const endpoint = `${base}/work/members/${targetMember.id}/projects`;
    const first = ok(await request(app, viewer, 'GET', endpoint + '?limit=1'), 200);
    assert.equal(first.items.length, 1); assert.deepEqual(first.items[0].reasons, ['TASK_ASSIGNEE']);
    assert.ok(first.nextCursor); assert.equal(first.coverage.completeness, 'COMPLETE');
    const second = ok(await request(app, viewer, 'GET', endpoint + '?limit=1&cursor=' + encodeURIComponent(first.nextCursor)), 200);
    assert.equal(second.items.length, 1); assert.notEqual(first.items[0].id, second.items[0].id); assert.equal(second.nextCursor, null);
    assert.ok(!JSON.stringify([first, second]).includes(privateProject.id));
    ok(await request(app, owner, 'GET', endpoint + '?limit=1&cursor=' + encodeURIComponent(first.nextCursor)), 400);
    const [payload, signature] = first.nextCursor.split('.');
    const tampered = payload + '.' + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    ok(await request(app, viewer, 'GET', endpoint + '?limit=1&cursor=' + encodeURIComponent(tampered)), 400);
    ok(await request(app, viewer, 'GET', `${base}/goals/members/${targetMember.id}/goals?limit=1&cursor=` + encodeURIComponent(first.nextCursor)), 400);
    ok(await request(app, viewer, 'GET', `${base}/work/members/${foreign.membership.id}/projects`), 404);
    ok(await request(app, owner, 'PATCH', `${base}/members/${targetMember.id}`, { status: 'SUSPENDED' }, targetMember.version), 200);
    ok(await request(app, viewer, 'GET', endpoint), 404);
  } finally { await app.close(); }
});

test('member profile Goals reader excludes followers and private goals before pagination', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Goals profile owner'), target = await account(app, 'Goals profile target'), viewer = await account(app, 'Goals profile viewer');
    const org = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Goals profile' }), 201);
    const base = `/api/v1/organizations/${org.organization.id}`;
    await enableGoals(app, owner, base);
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: target.accountId }), 201).membership;
    ok(await request(app, owner, 'POST', `${base}/members`, { accountId: viewer.accountId }), 201);
    const period = ok(await request(app, owner, 'POST', `${base}/goal-periods`, { title: 'Period', startsOn: '2000-01-01', endsOn: '2100-12-31' }), 201);
    const create = async (title: string, privacy: string, ownerId: string) => ok(await request(app, owner, 'POST', `${base}/goals`, { title, ownerType: 'MEMBER', ownerId, periodIds: [period.id], privacy }), 201);
    const own = await create('Public responsible', 'PUBLIC', member.id);
    const hidden = await create('Private responsible', 'PRIVATE', member.id);
    const follower = await create('Follower only', 'PUBLIC', org.membership.id);
    ok(await request(app, owner, 'POST', `${base}/goals/${follower.id}/assignments`, { assignments: [{ memberId: member.id, functionalRole: 'FOLLOWER' }] }, follower.version), 200);
    const resultGoal = await create('Result responsibility', 'PUBLIC', org.membership.id);
    ok(await request(app, owner, 'POST', `${base}/goals/${resultGoal.id}/key-results`, { title: 'KR', resultType: 'QUANTITATIVE', initialValue: '0', targetValue: '10' }, resultGoal.version), 201);
    const detail = ok(await request(app, owner, 'GET', `${base}/goals/${resultGoal.id}`), 200);
    ok(await request(app, owner, 'POST', `${base}/goals/${resultGoal.id}/assignments`, { assignments: [{ memberId: member.id, functionalRole: 'CONTRIBUTOR', keyResultId: detail.keyResults[0].id }] }, detail.version), 200);
    const path = `${base}/goals/members/${member.id}/goals`;
    const first = ok(await request(app, viewer, 'GET', path + '?limit=1'), 200);
    assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
    const second = ok(await request(app, viewer, 'GET', path + '?limit=1&cursor=' + encodeURIComponent(first.nextCursor)), 200);
    const items = [...first.items, ...second.items];
    assert.equal(second.nextCursor, null);
    assert.deepEqual(items.find((item: any) => item.id === own.id).reasons, ['GOAL_RESPONSIBLE']);
    assert.deepEqual(items.find((item: any) => item.id === resultGoal.id).reasons, ['RESULT_RESPONSIBLE']);
    assert.ok(!JSON.stringify(items).includes(hidden.id)); assert.ok(!JSON.stringify(items).includes(follower.id));
    ok(await request(app, owner, 'GET', path + '?limit=1&cursor=' + encodeURIComponent(first.nextCursor)), 400);
    const role = ok(await request(app, owner, 'POST', `${base}/roles`, { name: 'Role for goal', circleId: org.rootCircle.id, mode: 'DIRECT' }), 201).role;
    const occupancy = ok(await request(app, owner, 'POST', `${base}/roles/${role.id}/occupancies`, { memberId: member.id, kind: 'DIRECT', startsAt: '2020-01-01T00:00:00.000Z' }), 201).occupancy;
    const roleGoal = await create('Role-based responsibility', 'PUBLIC', org.membership.id);
    ok(await request(app, owner, 'POST', `${base}/goals/${roleGoal.id}/assignments`, { assignments: [{ memberId: member.id, functionalRole: 'LEAD', viaRoleId: role.id }] }, roleGoal.version), 200);
    assert.ok(ok(await request(app, viewer, 'GET', path), 200).items.some((item: any) => item.id === roleGoal.id));
    ok(await request(app, owner, 'POST', `${base}/occupancies/${occupancy.id}/end`, {}, occupancy.version), 200);
    assert.ok(!ok(await request(app, viewer, 'GET', path), 200).items.some((item: any) => item.id === roleGoal.id));
  } finally { await app.close(); }
});

test('member profile Work reader pages more than fifty authorized relations without a hidden total', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Profile pagination owner'), target = await account(app, 'Profile pagination target');
    const org = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Profile pagination' }), 201);
    const base = `/api/v1/organizations/${org.organization.id}`;
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: target.accountId }), 201).membership;
    const projectIds = Array.from({ length: 51 }, () => randomUUID());
    const taskIds = Array.from({ length: 51 }, () => randomUUID());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('orgmap.organization_id',$1,true)", [org.organization.id]);
      for (let i = 0; i < 51; i++) {
        await client.query("INSERT INTO work_projects(organization_id,id,title,visibility,creator_id) VALUES($1,$2,$3,'PUBLIC',$4)", [org.organization.id, projectIds[i], `Public ${i}`, org.membership.id]);
        await client.query("INSERT INTO work_tasks(organization_id,id,project_id,creator_id,title) VALUES($1,$2,$3,$4,'Assigned')", [org.organization.id, taskIds[i], projectIds[i], org.membership.id]);
        await client.query('INSERT INTO work_assignments(organization_id,task_id,member_id) VALUES($1,$2,$3)', [org.organization.id, taskIds[i], member.id]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    const path = `${base}/work/members/${member.id}/projects`;
    const first = ok(await request(app, owner, 'GET', path + '?limit=50'), 200);
    assert.equal(first.items.length, 50); assert.ok(first.nextCursor); assert.equal('total' in first, false);
    const second = ok(await request(app, owner, 'GET', path + '?limit=50&cursor=' + encodeURIComponent(first.nextCursor)), 200);
    assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null);
    assert.deepEqual([...first.items, ...second.items].map((item: any) => item.id).sort(), [...projectIds].sort());
  } finally { await app.close(); }
});

test('composed admission policy drives actual mailbox self-join and link revocation without changing Account or organization B', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orgmap-admission-composed-'));
  const smtp = await startSmtpSink({ port: 0, directory });
  const smtpPort = (smtp.address() as { port: number }).port;
  const options = { smtp: { port: smtpPort } };
  const app = await buildApp([createOrgMapIntegration(options)], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora de admissão'), joiner = await account(app, 'Pessoa que comprova a caixa postal');
    const A = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Ingresso A' }), 201);
    const B = ok(await request(app, joiner, 'POST', '/api/v1/organizations', { name: 'Conta independente B' }), 201);
    const base = `/api/v1/organizations/${A.organization.id}`, other = `/api/v1/organizations/${B.organization.id}`;
    const path = `${base}/administration/admission-policy`;
    const original = ok(await request(app, owner, 'GET', path), 200);
    assert.equal(original.policy.registrationMode, 'DISABLED');
    assert.equal(original.policy.revision, 0);
    assert.notEqual((await request(app, joiner, 'POST', `${base}/admission/requests`, {})).statusCode, 202);
    const configuration = { registrationMode: 'OPEN', allowedDomains: [], membersMayInvite: false, limitMemberInvitesToDomains: false, invitationLinkEnabled: true };
    const active = ok(await request(app, owner, 'PUT', path, configuration, 0), 200);
    assert.equal(active.supported, true);
    const pending = ok(await request(app, joiner, 'POST', `${base}/admission/requests`, {}), 202);
    ok(await request(app, joiner, 'GET', `${base}/entry`), 404);
    ok(await request(app, joiner, 'GET', `${other}/entry`), 200);
    const core = createRuntime(); createIntegrationEnvironment(core, options);
    const mailbox = async (requestId: string, email: string) => {
      assert.equal(await core.deliverAdmissionMail(A.organization.id, message => sendLocalMail(message, smtpPort)), 1);
      const texts = await Promise.all((await readdir(directory)).filter(x => x.endsWith('.eml')).map(x => readFile(join(directory,x),'utf8')));
      const exact = texts.filter(x => x.includes('request '+requestId+' ') && x.includes('To: <'+email+'>'));
      assert.equal(exact.length, 1);
      const token = exact[0].match(/\r\n([a-f0-9]{64})\r\n$/)?.[1];
      assert.ok(token); return token;
    };
    const mailboxToken = await mailbox(pending.requestId, joiner.email), key = randomUUID();
    const joined = ok(await request(app, joiner, 'POST', `${base}/admission/requests/${pending.requestId}/complete`, { mailboxToken }, undefined, key), 201);
    assert.equal(joined.state, 'JOINED');
    assert.equal(joined.membership.memberType, 'MEMBER');
    assert.equal(joined.membership.orgRole, 'MEMBER');
    assert.equal(ok(await request(app, joiner, 'POST', `${base}/admission/requests/${pending.requestId}/complete`, { mailboxToken }, undefined, key), 200).membership.id, joined.membership.id);
    ok(await request(app, joiner, 'GET', `${base}/entry`), 200);
    ok(await request(app, joiner, 'GET', `${other}/entry`), 200);
    const link = ok(await request(app, owner, 'POST', `${base}/invitation-links`, {}, 0), 200);
    assert.ok(link.linkToken);
    const throughLink = await account(app, 'Ingresso pelo link');
    const linkedRequest = ok(await request(app, throughLink, 'POST', `${base}/admission/link-requests`, { linkToken: link.linkToken }), 202);
    const linkedToken = await mailbox(linkedRequest.requestId, throughLink.email);
    // Disable and revoke in the real Admin authorization UoW; an existing intent cannot bypass current policy.
    const disabled = ok(await request(app, owner, 'PUT', path, { ...configuration, registrationMode: 'DISABLED', invitationLinkEnabled: false }, active.policy.revision), 200);
    assert.equal(disabled.policy.registrationMode, 'DISABLED');
    assert.notEqual((await request(app, throughLink, 'POST', `${base}/admission/requests/${linkedRequest.requestId}/complete`, { mailboxToken: linkedToken })).statusCode, 201);
    assert.notEqual((await request(app, throughLink, 'POST', `${base}/admission/link-requests`, { linkToken: link.linkToken })).statusCode, 202);
    ok(await request(app, joiner, 'GET', `${base}/entry`), 200);
    ok(await request(app, joiner, 'GET', `${other}/entry`), 200);
    assert.equal(ok(await request(app, owner, 'GET', `${base}/invitation-links`), 200).link.revokedAt !== null, true);
  } finally { await app.close(); await new Promise<void>((resolve,reject) => smtp.close(error => error ? reject(error) : resolve())); await rm(directory,{recursive:true,force:true}); }
});

test('composed admission normalizes exact IDNA domains and checks the current policy again after mailbox proof', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orgmap-admission-domain-'));
  const smtp = await startSmtpSink({ port: 0, directory });
  const smtpPort = (smtp.address() as { port: number }).port;
  const options = { smtp: { port: smtpPort } };
  const app = await buildApp([createOrgMapIntegration(options)], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora da política exata');
    const exact = await account(app, 'Domínio exato');
    const child = await account(app, 'Subdomínio não permitido', undefined, `integration-${randomUUID()}@child.example.test`);
    const international = await account(app, 'Domínio IDNA', undefined, `integration-${randomUUID()}@xn--bcher-kva.test`);
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Ingresso por domínio exato' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`, path = `${base}/administration/admission-policy`;
    const config = { registrationMode: 'DOMAIN_RESTRICTED', allowedDomains: ['EXAMPLE.TEST'], membersMayInvite: false, limitMemberInvitesToDomains: false, invitationLinkEnabled: false };
    const first = ok(await request(app, owner, 'PUT', path, config, 0), 200);
    assert.deepEqual(first.policy.allowedDomains, ['example.test']);
    const started = ok(await request(app, exact, 'POST', `${base}/admission/requests`, {}), 202);
    ok(await request(app, child, 'POST', `${base}/admission/requests`, {}), 404);
    ok(await request(app, international, 'POST', `${base}/admission/requests`, {}), 404);
    const core = createRuntime(); createIntegrationEnvironment(core, options);
    const proof = async (requestId: string, email: string) => {
      assert.equal(await core.deliverAdmissionMail(organization.organization.id, message => sendLocalMail(message, smtpPort)), 1);
      const messages = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.eml')).map(name => readFile(join(directory,name),'utf8')));
      const exactMessages = messages.filter(message => message.includes('request '+requestId+' ') && message.includes('To: <'+email+'>'));
      assert.equal(exactMessages.length, 1);
      const token = exactMessages[0].match(/\r\n([a-f0-9]{64})\r\n$/)?.[1];
      assert.ok(token); return token;
    };
    const oldProof = await proof(started.requestId, exact.email);
    const second = ok(await request(app, owner, 'PUT', path, { ...config, allowedDomains: ['BÜCHER.test'] }, first.policy.revision), 200);
    assert.deepEqual(second.policy.allowedDomains, ['xn--bcher-kva.test']);
    ok(await request(app, exact, 'POST', `${base}/admission/requests/${started.requestId}/complete`, { mailboxToken: oldProof }), 404);
    ok(await request(app, exact, 'GET', `${base}/entry`), 404);
    const unicodeRequest = ok(await request(app, international, 'POST', `${base}/admission/requests`, {}), 202);
    const unicodeProof = await proof(unicodeRequest.requestId, international.email);
    assert.equal(ok(await request(app, international, 'POST', `${base}/admission/requests/${unicodeRequest.requestId}/complete`, { mailboxToken: unicodeProof }), 201).membership.memberType, 'MEMBER');
    // Rejected URL/authority syntax cannot mutate the accepted policy revision or domains.
    for (const invalid of ['ex%61mple.test', '*.example.test', 'example.test.', '127.0.0.1', 'https://example.test', 'example.test#fragment'])
      ok(await request(app, owner, 'PUT', path, { ...config, allowedDomains: [invalid] }, second.policy.revision), 422);
    const unchanged = ok(await request(app, owner, 'GET', path), 200).policy;
    assert.equal(unchanged.revision, second.policy.revision);
    assert.deepEqual(unchanged.allowedDomains, ['xn--bcher-kva.test']);
  } finally { await app.close(); await new Promise<void>((resolve,reject) => smtp.close(error => error ? reject(error) : resolve())); await rm(directory,{recursive:true,force:true}); }
});

test('composed Work role principal follows current Structure occupancy without granting task access', async () => {
  const blobsDirectory = await mkdtemp(join(tmpdir(), 'orgmap-role-transfer-'));
  const app = await buildApp([createOrgMapIntegration({ blobsDirectory }), async (server, core) => {
    const authority = async (ctx: any, target: string) => {
      if (!await memberResourceAdapter().authorize(ctx, target, 'read')) fail(404, 'RESOURCE_NOT_FOUND');
    };
    server.get('/api/v1/organizations/:organizationId/test-profile/:memberId/partial', (r) =>
      core.tenant(r, false, ctx => memberProjects(ctx, (r.params as any).memberId, {}, authority)));
    server.get('/api/v1/organizations/:organizationId/test-profile/:memberId/missing-work', (r) =>
      core.tenant(r, false, ctx => memberProjects(ctx, (r.params as any).memberId, {})));
    server.get('/api/v1/organizations/:organizationId/test-profile/:memberId/missing-goals', (r) =>
      core.tenant(r, false, ctx => memberGoals(ctx, (r.params as any).memberId, {})));
  }], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora da atribuição por papel'), first = await account(app, 'Primeira ocupante'), second = await account(app, 'Segunda ocupante');
    const A = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Capacidade dinâmica A' }), 201);
    const B = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Capacidade independente B' }), 201);
    const base = `/api/v1/organizations/${A.organization.id}`;
    const firstMember = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: first.accountId }), 201).membership;
    const secondMember = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: second.accountId }), 201).membership;
    const role = ok(await request(app, owner, 'POST', `${base}/roles`, { name: 'Responsabilidade de plantão', circleId: A.rootCircle.id, mode: 'DIRECT' }), 201).role;
    const firstOccupancy = ok(await request(app, owner, 'POST', `${base}/roles/${role.id}/occupancies`, { memberId: firstMember.id, kind: 'DIRECT', startsAt: '2020-01-01T00:00:00.000Z' }), 201).occupancy;
    ok(await request(app, owner, 'POST', `${base}/roles/${role.id}/occupancies`, { memberId: secondMember.id, kind: 'DIRECT', startsAt: '2020-01-01T00:00:00.000Z' }), 201);
    const project = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Uma principal, duas pessoas', visibility: 'PUBLIC' }), 201).project;
    ok(await request(app, owner, 'PATCH', `${base}/work/projects/${project.id}`, { assignmentMode: 'SINGLE' }, project.version), 200);
    const task = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Segue o papel vigente', projectId: project.id }), 201).task;
    const input = { principals: [{ kind: 'ROLE', roleId: role.id }] }, key = randomUUID();
    const assigned = ok(await request(app, owner, 'POST', `${base}/work/tasks/${task.id}/assignments`, input, task.version, key), 200).task;
    const original = ok(await request(app, owner, 'GET', `${base}/work/tasks/${task.id}`), 200);
    assert.deepEqual(original.principals, input.principals);
    assert.deepEqual(original.resolvedAssignees.map((person: any) => person.memberId).sort(), [firstMember.id, secondMember.id].sort());
    assert.ok(original.resolvedAssignees.every((person: any) => person.reasons.some((reason: any) => reason.kind === 'ROLE_CAPACITY' && reason.roleId === role.id)));
    const memberProjectsPath = `${base}/work/members/${firstMember.id}/projects`;
    assert.deepEqual(ok(await request(app, owner, 'GET', memberProjectsPath), 200).items.find((item: any) => item.id === project.id).reasons, ['TASK_ASSIGNEE']);
    const partial = ok(await request(app, owner, 'GET', `${base}/test-profile/${firstMember.id}/partial`), 200);
    assert.deepEqual(partial.coverage, { scope: 'CURRENT_VIEWER_AUTHORIZED_RELATIONS', completeness: 'PARTIAL', limitations: ['ROLE_CAPACITY_UNAVAILABLE'] });
    assert.equal(partial.items.some((item: any) => item.id === project.id), false);
    ok(await request(app, owner, 'GET', `${base}/test-profile/${firstMember.id}/missing-work`), 503);
    ok(await request(app, owner, 'GET', `${base}/test-profile/${firstMember.id}/missing-goals`), 503);
    const transfer = { resourceType: 'task', resourceIds: [task.id], kind: 'task-definitions-v2', format: 'JSON' };
    const exportJob = ok(await request(app, owner, 'POST', `${base}/platform/exports`, transfer), 202);
    const worker = await createPlatformWorker({ blobsDirectory });
    assert.equal(await worker.runJob(A.organization.id, A.membership.id), true);
    const exported = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${exportJob.id}`), 200);
    assert.equal(exported.state, 'COMPLETED');
    const artifact = ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${exported.result.artifactId}/download`), 200);
    const document = JSON.parse(Buffer.from(artifact.base64, 'base64').toString('utf8'));
    assert.equal(document.kind, 'task-definitions-v2');
    assert.deepEqual(document.records[0].principals, input.principals);
    assert.equal(document.records[0].sourceOrganizationId, A.organization.id);
    for (const format of ['CSV', 'XLSX']) assert.deepEqual(decodeTransfer(encodeTransfer(document, format), format), document);
    const preview = ok(await request(app, owner, 'POST', `${base}/platform/imports/preview`, { document, resourceId: task.id }), 200);
    const importJob = ok(await request(app, owner, 'POST', `${base}/platform/imports`, { document, resourceId: task.id, planHash: preview.planHash }), 202);
    assert.equal(await worker.runJob(A.organization.id, A.membership.id), true);
    const imported = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${importJob.id}`), 200);
    assert.equal(imported.state, 'COMPLETED');
    assert.deepEqual(ok(await request(app, owner, 'GET', `${base}/work/tasks/${imported.result.idMap[task.id]}`), 200).principals, input.principals);
    ok(await request(app, first, 'POST', `${base}/platform/imports/preview`, { document, resourceId: task.id }), 403);
    const foreignBase = `/api/v1/organizations/${B.organization.id}`;
    const foreignProject = ok(await request(app, owner, 'POST', `${foreignBase}/work/projects`, { title: 'Foreign destination', visibility: 'PUBLIC' }), 201).project;
    const foreignTask = ok(await request(app, owner, 'POST', `${foreignBase}/work/tasks`, { title: 'Foreign target', projectId: foreignProject.id }), 201).task;
    ok(await request(app, owner, 'POST', `${foreignBase}/platform/imports/preview`, { document, resourceId: foreignTask.id }), 422);
    ok(await request(app, owner, 'POST', `${base}/work/tasks/${task.id}/assignments`, { principals: [...input.principals, { kind: 'MEMBER', memberId: firstMember.id }] }, assigned.version), 422);
    ok(await request(app, owner, 'POST', `${base}/work/tasks/${task.id}/assignments`, { memberIds: [] }, assigned.version), 409);
    ok(await request(app, owner, 'POST', `${base}/occupancies/${firstOccupancy.id}/end`, {}, firstOccupancy.version), 200);
    assert.equal(ok(await request(app, owner, 'GET', memberProjectsPath), 200).items.some((item: any) => item.id === project.id), false);
    const changed = ok(await request(app, owner, 'GET', `${base}/work/tasks/${task.id}`), 200);
    assert.deepEqual(changed.principals, input.principals);
    assert.deepEqual(changed.resolvedAssignees.map((person: any) => person.memberId), [secondMember.id]);
    assert.equal(changed.task.version, assigned.version);
    assert.equal(ok(await request(app, owner, 'POST', `${base}/work/tasks/${task.id}/assignments`, input, task.version, key), 200).task.version, assigned.version);
    const privateProject = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Projeto privado não compartilhado', visibility: 'PRIVATE' }), 201).project;
    const privateTask = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'O papel não concede acesso', projectId: privateProject.id }), 201).task;
    ok(await request(app, owner, 'POST', `${base}/work/tasks/${privateTask.id}/assignments`, input, privateTask.version), 200);
    const restricted = ok(await request(app, owner, 'GET', `${base}/work/tasks/${privateTask.id}`), 200);
    assert.deepEqual(restricted.principals, input.principals);
    assert.deepEqual(restricted.resolvedAssignees, []);
    ok(await request(app, first, 'GET', `${base}/work/tasks/${privateTask.id}`), 404);
    ok(await request(app, second, 'GET', `${base}/work/tasks/${privateTask.id}`), 404);
    const foreign = ok(await request(app, owner, 'POST', `/api/v1/organizations/${B.organization.id}/roles`, { name: 'Papel de B', circleId: B.rootCircle.id, mode: 'DIRECT' }), 201).role;
    ok(await request(app, owner, 'POST', `${base}/work/tasks/${task.id}/assignments`, { principals: [{ kind: 'ROLE', roleId: foreign.id }] }, assigned.version), 404);
    assert.deepEqual(ok(await request(app, owner, 'GET', `${base}/work/tasks/${task.id}`), 200).principals, input.principals);
  } finally { await app.close(); await rm(blobsDirectory, { recursive: true, force: true }); }
});

test('composed upload policy uses the real Work resource ACL and preserves authorized READY downloads after restriction', async () => {
  const blobsDirectory = await mkdtemp(join(tmpdir(), 'orgmap-upload-composed-'));
  const app = await buildApp([createOrgMapIntegration({ blobsDirectory })], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora dos anexos'), peer = await account(app, 'Pessoa sem acesso ao projeto');
    const A = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Política de anexos A' }), 201);
    const B = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Política independente B' }), 201);
    const base = `/api/v1/organizations/${A.organization.id}`, path = `${base}/administration/upload-policy`;
    ok(await request(app, owner, 'POST', `${base}/members`, { accountId: peer.accountId }), 201);
    const project = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Documentos privados', visibility: 'PRIVATE' }), 201).project;
    const task = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Anexo por recurso real', projectId: project.id }), 201).task;
    const uploadPath = `${base}/platform/resources/task/${task.id}/uploads`;
    const original = ok(await request(app, owner, 'GET', path), 200);
    assert.equal(original.supported, true);
    assert.equal(original.policy.mode, 'ANY');
    const bytes = Buffer.from([0, 255, 1, 254, 2, 253]), input = { name: 'dados-opacos.bin', mime: 'application/octet-stream', base64: bytes.toString('base64') }, key = randomUUID();
    const uploaded = ok(await request(app, owner, 'POST', uploadPath, input, undefined, key), 201);
    assert.equal(uploaded.state, 'READY');
    const downloadPath = `${base}/platform/files/${uploaded.id}/download`;
    const download = await request(app, owner, 'GET', downloadPath);
    const file = ok(download, 200);
    assert.equal(file.base64, input.base64);
    assert.equal(file.downloadMime, 'application/octet-stream');
    assert.equal(file.disposition, 'attachment');
    assert.equal(file.preview, false);
    assert.equal(download.headers['x-content-type-options'], 'nosniff');
    assert.equal(download.headers['content-disposition'], 'attachment');
    ok(await request(app, peer, 'GET', downloadPath), 404);
    ok(await request(app, owner, 'GET', `/api/v1/organizations/${B.organization.id}/platform/files/${uploaded.id}/download`), 404);
    const restricted = ok(await request(app, owner, 'PUT', path, { mode: 'ALLOWLIST', allowedKinds: ['JSON'] }, original.policy.revision), 200);
    assert.equal((await request(app, owner, 'POST', uploadPath, input, undefined, key)).json().error.code, 'UPLOAD_POLICY_DENIED');
    ok(await request(app, owner, 'POST', uploadPath, input), 403);
    const document = { name: 'registro.json', mime: 'application/json', base64: Buffer.from('{"mensagem":"ação 漢字"}').toString('base64') };
    const jsonFile = ok(await request(app, owner, 'POST', uploadPath, document), 201);
    assert.equal(jsonFile.mime, 'application/json');
    ok(await request(app, owner, 'POST', uploadPath, { ...input, purpose: 'GENERATED_EXPORT' }), 400);
    const disabled = ok(await request(app, owner, 'PUT', path, { mode: 'DISABLED', allowedKinds: [] }, restricted.policy.revision), 200);
    assert.equal(disabled.policy.mode, 'DISABLED');
    ok(await request(app, owner, 'POST', uploadPath, document), 403);
    assert.equal(ok(await request(app, owner, 'GET', downloadPath), 200).base64, input.base64);
    const independent = ok(await request(app, owner, 'GET', `/api/v1/organizations/${B.organization.id}/administration/upload-policy`), 200).policy;
    assert.equal(independent.mode, 'ANY');
    assert.equal(independent.revision, 0);
  } finally { await app.close(); await rm(blobsDirectory, { recursive: true, force: true }); }
});

test('composed member indicators require actual subject consent and keep DEFINE separate from private values', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora sem autoridade pessoal implícita'), subject = await account(app, 'Titular dos indicadores'), delegate = await account(app, 'Pessoa autorizada a definir');
    const A = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Indicadores pessoais A' }), 201);
    const B = ok(await request(app, subject, 'POST', '/api/v1/organizations', { name: 'Organização pessoal independente B' }), 201);
    const base = `/api/v1/organizations/${A.organization.id}`;
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: subject.accountId }), 201).membership;
    const other = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: delegate.accountId }), 201).membership;
    const indicators = `${base}/structure-advanced/indicators`, personal = `${base}/structure-advanced/subjects/member/${member.id}`, consents = `${base}/administration/member-indicator-consents`;
    const initial = ok(await request(app, subject, 'GET', `${personal}/indicators`), 200);
    assert.deepEqual(initial.items, []);
    assert.equal(initial.capabilities.define, false);
    ok(await request(app, owner, 'GET', `${personal}/indicators`), 404);
    const definition = { subject: { kind: 'MEMBER', memberId: member.id }, name: 'Aprendizagens próprias', kind: 'METRIC', valueType: 'NUMBER', unit: 'pontos', requiredUnits: ['observado'] };
    ok(await request(app, subject, 'POST', indicators, definition), 403);
    const consentBody = { delegateMemberId: member.id, actions: ['DEFINE'], confirmation: 'AUTHORIZE_DEFINE_ON_MY_INDICATORS' };
    ok(await request(app, owner, 'POST', consents, { ...consentBody, subjectMemberId: member.id }, 0), 400);
    const permission = ok(await request(app, subject, 'POST', consents, consentBody, 0), 201);
    const defineKey = randomUUID(), metric = ok(await request(app, subject, 'POST', indicators, definition, undefined, defineKey), 201);
    assert.equal(metric.memberId, member.id);
    assert.equal(metric.entityId, null);
    const records = `${indicators}/${metric.id}/records`;
    assert.equal(ok(await request(app, subject, 'GET', `${records}?period=atual`), 200).status, 'UNKNOWN');
    ok(await request(app, subject, 'POST', records, { period: 'atual', unitKey: 'observado', value: 0 }, 0), 200);
    const known = ok(await request(app, subject, 'GET', `${records}?period=atual`), 200);
    assert.equal(known.status, 'KNOWN');
    assert.equal(known.latest[0].value, 0);
    assert.equal(known.latest[0].recordedBy, member.id);
    const delegated = ok(await request(app, subject, 'POST', consents, { ...consentBody, delegateMemberId: other.id }, permission.revision), 201);
    const delegatedDefinition = { ...definition, name: 'Definição delegada sem leitura de valores' }, delegatedKey = randomUUID();
    ok(await request(app, delegate, 'POST', indicators, delegatedDefinition, undefined, delegatedKey), 201);
    ok(await request(app, delegate, 'GET', `${personal}/indicators`), 404);
    ok(await request(app, delegate, 'GET', `${records}?period=atual`), 404);
    ok(await request(app, delegate, 'POST', records, { period: 'novo', unitKey: 'observado', value: 3 }, 0), 403);
    const revoked = ok(await request(app, subject, 'POST', `${consents}/${permission.consent.id}/revoke`, {}, delegated.revision), 200);
    ok(await request(app, subject, 'POST', indicators, definition, undefined, defineKey), 403);
    ok(await request(app, subject, 'POST', records, { period: 'novo', unitKey: 'observado', value: 2 }, 0), 200);
    ok(await request(app, subject, 'POST', `${consents}/${delegated.consent.id}/revoke`, {}, revoked.revision), 200);
    ok(await request(app, delegate, 'POST', indicators, delegatedDefinition, undefined, delegatedKey), 403);
    assert.equal(ok(await request(app, subject, 'GET', `${records}?period=atual`), 200).latest[0].value, 0);
    ok(await request(app, owner, 'GET', `${personal}/history`), 404);
    ok(await request(app, subject, 'GET', `/api/v1/organizations/${B.organization.id}/entry`), 200);
  } finally { await app.close(); }
});

test('composed standalone worker enforces the same configured SSO requirement without a credential-policy record', async () => {
  const setup = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  let guarded: FastifyInstance | undefined;
  try {
    await setup.ready();
    const owner = await account(setup, 'Titular da sessão de senha');
    const A = ok(await request(setup, owner, 'POST', '/api/v1/organizations', { name: 'SSO obrigatório A' }), 201);
    const B = ok(await request(setup, owner, 'POST', '/api/v1/organizations', { name: 'Método independente B' }), 201);
    const connectionId = randomUUID(), key = `${A.organization.id}:${connectionId}`;
    const options = {
      oidc: { [key]: { issuer: 'https://idp.example.test', clientId: 'synthetic-worker-config', authorizationEndpoint: 'https://idp.example.test/authorize', tokenEndpoint: 'https://idp.example.test/token', jwksUri: 'https://idp.example.test/jwks', redirectUri: `${origin}/api/v1/organizations/${A.organization.id}/interoperability/oidc/callback` } },
      enrollment: { [key]: { issuer: 'https://idp.example.test', claim: 'employee_id', mappingRevision: 1, externalIdToValue: {}, ssoRequired: true } },
    };
    await setup.close();
    guarded = await buildApp([createOrgMapIntegration(options)], { migrationMaxPrefix: 999 });
    await guarded.ready();
    const blocked = await request(guarded, owner, 'GET', `/api/v1/organizations/${A.organization.id}/structure`);
    assert.equal(blocked.statusCode, 403, blocked.body);
    assert.equal(blocked.json().error.code, 'SSO_REQUIRED');
    ok(await request(guarded, owner, 'GET', `/api/v1/organizations/${B.organization.id}/structure`), 200);
    const workerCore = createRuntime();
    createIntegrationEnvironment(workerCore, options);
    let businessCalls = 0;
    await assert.rejects(() => workerCore.withWorkerContext(A.organization.id, A.membership.id, async () => { businessCalls++; }), (error: any) => error.code === 'SSO_REQUIRED');
    assert.equal(businessCalls, 0);
    assert.equal(await workerCore.withWorkerContext(B.organization.id, B.membership.id, async () => true), true);
    // Configuration is intentionally unavailable: this negative proves fail-closed parity,
    // not an IdP login or a usable federated connection. Positive provenance is tested separately.
  } finally { await guarded?.close(); await setup.close(); }
});

test('organization notification email master applies at enqueue and delivery without disabling in-app', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  const core = createRuntime(), environment = createIntegrationEnvironment(core);
  const fixtureEvents: { organizationId: string; memberId: string; eventIds: string[] }[] = [];
  try {
    const owner = await account(app, 'Notification owner'), recipient = await account(app, 'Notification recipient');
    const org = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Notification master' }), 201);
    const base = `/api/v1/organizations/${org.organization.id}`;
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: recipient.accountId }), 201).membership;
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    assert.equal(settings.settings.notifications.emailEnabled, true);
    const staleSettings = structuredClone(settings.settings);
    const ownEvents = { organizationId: org.organization.id, memberId: org.membership.id, eventIds: [] as string[] };
    fixtureEvents.push(ownEvents);
    const enqueue = async () => core.withWorkerContext(org.organization.id, org.membership.id, async ctx => {
      const eventId = randomUUID();
      ownEvents.eventIds.push(eventId);
      await enqueueNotification(ctx, environment.registry, { eventId, event: 'CommentAdded', ref: { type: 'circle', id: org.rootCircle.id }, recipients: [{ memberId: member.id, nominal: true }] });
      return (await ctx.c.query('SELECT id,channel,state FROM platform_deliveries WHERE organization_id=$1 AND event_id=$2 ORDER BY channel', [ctx.org.id, eventId])).rows;
    });
    const pending = await enqueue();
    assert.deepEqual(pending.map((row: any) => row.channel), ['EMAIL', 'IN_APP']);
    settings.settings.notifications.emailEnabled = false;
    const disabled = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: staleSettings }, settings.version), 409);
    assert.equal(ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200).settings.notifications.emailEnabled, false);
    assert.deepEqual((await enqueue()).map((row: any) => row.channel), ['IN_APP']);
    const other = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Independent notification master' }), 201);
    const otherBase = `/api/v1/organizations/${other.organization.id}`;
    const otherMember = ok(await request(app, owner, 'POST', `${otherBase}/members`, { accountId: recipient.accountId }), 201).membership;
    const otherEvents = { organizationId: other.organization.id, memberId: other.membership.id, eventIds: [] as string[] };
    fixtureEvents.push(otherEvents);
    const otherChannels = await core.withWorkerContext(other.organization.id, other.membership.id, async ctx => {
      const eventId = randomUUID();
      otherEvents.eventIds.push(eventId);
      await enqueueNotification(ctx, environment.registry, { eventId, event: 'CommentAdded', ref: { type: 'circle', id: other.rootCircle.id }, recipients: [{ memberId: otherMember.id, nominal: true }] });
      return (await ctx.c.query('SELECT channel FROM platform_deliveries WHERE organization_id=$1 AND event_id=$2 ORDER BY channel', [ctx.org.id, eventId])).rows.map((row: any) => row.channel);
    });
    assert.deepEqual(otherChannels, ['EMAIL', 'IN_APP']);
    const prefs = ok(await request(app, recipient, 'GET', `${base}/platform/preferences`), 200);
    const pref = prefs.events.find((event: any) => event.event === 'CommentAdded');
    assert.equal(pref.effective.EMAIL.origin, 'ORGANIZATION_EMAIL_DISABLED');
    assert.equal(pref.effective.IN_APP.enabled, true);
    const personal = ok(await request(app, recipient, 'POST', `${base}/platform/preferences`, { event: 'CommentAdded', channel: 'EMAIL', enabled: false }, prefs.version), 200);
    const worker = await createPlatformWorker();
    await worker.runDelivery(org.organization.id, member.id);
    await worker.runDelivery(org.organization.id, member.id);
    await worker.runDelivery(org.organization.id, member.id);
    const state = await core.withWorkerContext(org.organization.id, org.membership.id, async ctx =>
      (await ctx.c.query('SELECT channel,state FROM platform_deliveries WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY channel', [ctx.org.id, pending.map((row: any) => row.id)])).rows);
    assert.deepEqual(state, [{ channel: 'EMAIL', state: 'SUPPRESSED' }, { channel: 'IN_APP', state: 'DELIVERED' }]);
    // A legacy client updating other settings cannot silently re-enable email.
    delete disabled.settings.notifications;
    const legacy = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: disabled.settings }, disabled.version), 200);
    assert.equal(legacy.settings.notifications.emailEnabled, false);
    legacy.settings.notifications.emailEnabled = true;
    const enabled = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: legacy.settings }, legacy.version), 200);
    assert.deepEqual((await enqueue()).map((row: any) => row.channel), ['IN_APP']);
    ok(await request(app, recipient, 'POST', `${base}/platform/preferences/reset`, {}, personal.version), 200);
    assert.deepEqual((await enqueue()).map((row: any) => row.channel), ['EMAIL', 'IN_APP']);
    ok(await request(app, owner, 'POST', `${base}/platform/notification-policy`, { event: 'CommentAdded', channel: 'EMAIL', moduleEnabled: true, masterEnabled: true, defaultEnabled: false, locked: true }, 1), 200);
    enabled.settings.notifications.emailEnabled = false;
    const disabledAgain = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: enabled.settings }, enabled.version), 200);
    disabledAgain.settings.notifications.emailEnabled = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: disabledAgain.settings }, disabledAgain.version), 200);
    assert.deepEqual((await enqueue()).map((row: any) => row.channel), ['IN_APP']);
    const lockedPrefs = ok(await request(app, recipient, 'GET', `${base}/platform/preferences`), 200);
    assert.equal(lockedPrefs.events.find((event: any) => event.event === 'CommentAdded').effective.EMAIL.origin, 'LOCK');
  } finally {
    try {
      for (const fixture of fixtureEvents) if (fixture.eventIds.length)
        await core.withWorkerContext(fixture.organizationId, fixture.memberId, async ctx => {
          await ctx.c.query('DELETE FROM platform_deliveries WHERE organization_id=$1 AND event_id=ANY($2::uuid[])', [fixture.organizationId, fixture.eventIds]);
        });
    } finally { await app.close(); }
  }
});

test('Guest scoped worker rechecks organization email master before delivery', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL! });
  const role = fixtureDispatchRole(), password = randomUUID();
  let roleCreated = false, dispatchPool: pg.Pool | undefined;
  let smtp: Awaited<ReturnType<typeof startSmtpSink>> | undefined, mailDirectory: string | undefined;
  try {
    const owner = await account(app, 'Guest email owner'), guest = await account(app, 'Guest email recipient');
    const org = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Guest notification master' }), 201);
    const base = `/api/v1/organizations/${org.organization.id}`;
    const resource = { context: 'structure', kind: 'circle', id: org.rootCircle.id };
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [{ resource, actions: ['read'] }] }), 201).membership;
    await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`); roleCreated = true;
    await admin.query(`GRANT orgmap_platform_dispatcher TO "${role}"`);
    const url = new URL(process.env.MIGRATION_DATABASE_URL!); url.username = role; url.password = password;
    dispatchPool = new pg.Pool({ connectionString: url.href });
    const core = createRuntime(), environment = createIntegrationEnvironment(core);
    const queued = await core.withWorkerContext(org.organization.id, org.membership.id, async ctx => {
      const eventId = randomUUID();
      await enqueueNotification(ctx, environment.registry, { eventId, event: 'CommentAdded', ref: { type: 'circle', id: org.rootCircle.id }, recipients: [{ memberId: member.id, nominal: true }] });
      return (await ctx.c.query('SELECT id,channel FROM platform_deliveries WHERE organization_id=$1 AND event_id=$2 ORDER BY channel', [ctx.org.id, eventId])).rows;
    });
    assert.deepEqual(queued.map((row: any) => row.channel), ['EMAIL', 'IN_APP']);
    // The absent SMTP transport forces a real retry, without sending any mail.
    const dispatcher = createIntegratedDispatcher(new PostgresScopeDispatch(dispatchPool));
    for (let i = 0; i < 2; i++) await dispatcher.runOnce();
    const before = (await admin.query('SELECT channel,state,attempts FROM platform_deliveries WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY channel', [org.organization.id, queued.map((row: any) => row.id)])).rows;
    assert.deepEqual(before, [{ channel: 'EMAIL', state: 'PENDING', attempts: 1 }, { channel: 'IN_APP', state: 'DELIVERED', attempts: 1 }]);
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.notifications.emailEnabled = false;
    const disabled = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    // Advance only this synthetic retry; its next attempt must suppress before transport.
    await admin.query("UPDATE platform_deliveries SET available_at=now() WHERE organization_id=$1 AND id=$2", [org.organization.id, queued[0].id]);
    for (let i = 0; i < 2; i++) await dispatcher.runOnce();
    const states = (await admin.query('SELECT channel,state FROM platform_deliveries WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY channel', [org.organization.id, queued.map((row: any) => row.id)])).rows;
    assert.deepEqual(states, [{ channel: 'EMAIL', state: 'SUPPRESSED' }, { channel: 'IN_APP', state: 'DELIVERED' }]);
    disabled.settings.notifications.emailEnabled = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: disabled.settings }, disabled.version), 200);
    await core.withWorkerContext(org.organization.id, org.membership.id, async ctx => {
      await enqueueNotification(ctx, environment.registry, { eventId: randomUUID(), event: 'CommentAdded', ref: { type: 'circle', id: org.rootCircle.id }, recipients: [{ memberId: member.id, nominal: true }] });
    });
    mailDirectory = await mkdtemp(join(tmpdir(), 'orgmap-notification-master-'));
    smtp = await startSmtpSink({ port: 0, directory: mailDirectory });
    const smtpPort = (smtp.address() as { port: number }).port;
    const enabledDispatcher = createIntegratedDispatcher(new PostgresScopeDispatch(dispatchPool), { smtp: { port: smtpPort } });
    for (let i = 0; i < 3; i++) await enabledDispatcher.runOnce();
    const mails = (await readdir(mailDirectory)).filter(name => name.endsWith('.eml'));
    assert.equal(mails.length, 1);
    assert.ok((await readFile(join(mailDirectory, mails[0]), 'utf8')).includes(guest.email));
  } finally {
    await app.close(); await dispatchPool?.end();
    if (smtp) await new Promise<void>(resolve => smtp!.close(() => resolve()));
    if (mailDirectory) await rm(mailDirectory, { recursive: true, force: true });
    if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
    await admin.end();
  }
});

test('composed dispatcher delivers Guest notifications through restricted metadata and suppresses revocation before resource execution', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  const migrationUrl = process.env.MIGRATION_DATABASE_URL!;
  const admin = new pg.Pool({ connectionString: migrationUrl });
  const role = fixtureDispatchRole(), password = randomUUID();
  let roleCreated = false, dispatchPool: pg.Pool | undefined;
  try {
    await app.ready();
    const owner = await account(app, 'Gestora da notificação');
    const guest = await account(app, 'Destinatária com grant explícito');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Entrega Guest real' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const circle = ok(await request(app, owner, 'POST', `${base}/circles`, { name: 'Recurso da notificação', parentCircleId: organization.rootCircle.id, mode: 'DIRECT' }), 201).circle;
    const resource = { context: 'structure', kind: 'circle', id: circle.id };
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [{ resource, actions: ['read'] }] }), 201).membership;
    ok(await request(app, owner, 'POST', `${base}/platform/notification-policy`, { event: 'CommentAdded', channel: 'EMAIL', moduleEnabled: true, masterEnabled: true, defaultEnabled: false, locked: true }, 1), 200);
    await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
    roleCreated = true;
    await admin.query(`GRANT orgmap_platform_dispatcher TO "${role}"`);
    const dispatchUrl = new URL(migrationUrl); dispatchUrl.username = role; dispatchUrl.password = password;
    dispatchPool = new pg.Pool({ connectionString: dispatchUrl.href });
    const scopes = new PostgresScopeDispatch(dispatchPool);
    const core = createRuntime(), environment = createIntegrationEnvironment(core);
    const enqueue = async () => core.withWorkerContext(organization.organization.id, organization.membership.id, async ctx => {
      assert.equal(await core.validateActiveMembers(ctx, [member.id]), true);
      const eventId = randomUUID();
      await enqueueNotification(ctx, environment.registry, { eventId, event: 'CommentAdded', ref: { type: 'circle', id: circle.id }, recipients: [{ memberId: member.id, nominal: true }] });
      return (await ctx.c.query('SELECT id FROM platform_deliveries WHERE organization_id=$1 AND event_id=$2', [ctx.org.id,eventId])).rows[0].id;
    });
    const firstId = await enqueue();
    const dispatcher = createIntegratedDispatcher(scopes);
    assert.equal(await dispatcher.runOnce(), true);
    const first = (await admin.query('SELECT state,attempts FROM platform_deliveries WHERE organization_id=$1 AND id=$2', [organization.organization.id,firstId])).rows[0];
    assert.equal(first.state, 'DELIVERED');
    assert.equal(first.attempts, 1);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/notifications`), 200).items.map((x: any) => x.id), [firstId]);
    const secondId = await enqueue();
    const grants = ok(await request(app, owner, 'GET', `${base}/members/${member.id}/access-grants`), 200).items;
    const metadata = scopes.deliveryMetadata(); let revoked = false;
    const guardedScopes = {
      claim: scopes.claim.bind(scopes), release: scopes.release.bind(scopes), heartbeat: scopes.heartbeat.bind(scopes),
      deliveryMetadata: () => ({ ...metadata, claim: async (...args: Parameters<typeof metadata.claim>) => {
        const claim = await metadata.claim(...args);
        if (claim && claim.id === secondId) {
          ok(await request(app, owner, 'POST', `${base}/members/${member.id}/access-grants/${grants[0].id}/revoke`, {}, grants[0].version), 200);
          revoked = true;
        }
        return claim;
      } }),
    };
    const resumed = createIntegratedDispatcher(guardedScopes);
    assert.equal(await resumed.runOnce(), true);
    assert.equal(revoked, true);
    assert.equal((await admin.query('SELECT state FROM platform_deliveries WHERE organization_id=$1 AND id=$2', [organization.organization.id,secondId])).rows[0].state, 'SUPPRESSED');
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/notifications`), 200).items, []);
  } finally {
    await app.close(); await dispatchPool?.end();
    if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
    await admin.end();
  }
});

test('composed administration credential policy gates HTTP replay and independent workers only for its organization', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const password = `CedarRiver-Orchid!47-${randomUUID()}`;
    const owner = await account(app, 'Titular de credencial', password);
    const A = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Política de credencial A' }), 201);
    const B = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Política independente B' }), 201);
    const base = `/api/v1/organizations/${A.organization.id}`, other = `/api/v1/organizations/${B.organization.id}`;
    const command = { title: 'Resultado de comando anterior à política' }, key = randomUUID();
    const project = ok(await request(app, owner, 'POST', `${base}/work/projects`, command, undefined, key), 201).project;
    const configuration = { complexity: true, strength: 'HIGH', expirationDays: null, mfaEnforced: false };
    const active = ok(await request(app, owner, 'PUT', `${base}/administration/security-policy`, { enabled: true, configuration }, 0), 200);
    assert.equal(active.supported, true);
    assert.equal(active.state, 'ACTIVE');
    const denied = await request(app, owner, 'GET', `${base}/entry`);
    ok(denied, 403);
    assert.equal(denied.json().error.code, 'ORG_CREDENTIAL_REQUIREMENT_UNMET');
    ok(await request(app, owner, 'POST', `${base}/work/projects`, command, undefined, key), 403);
    ok(await request(app, owner, 'GET', `${other}/entry`), 200);
    const core = createRuntime(); createIntegrationEnvironment(core);
    let ran = false;
    await assert.rejects(core.withWorkerContext(A.organization.id, A.membership.id, async () => { ran = true; }), (error: any) => error.code === 'ORG_CREDENTIAL_REQUIREMENT_UNMET');
    assert.equal(ran, false);
    await core.withWorkerContext(B.organization.id, B.membership.id, async () => { ran = true; });
    assert.equal(ran, true);
    const requirements = ok(await request(app, owner, 'GET', `${base}/security/requirements`), 200);
    assert.equal(requirements.policy.revision, 1);
    ok(await request(app, owner, 'POST', `${base}/security/attest`, { password: 'Incorrect password' }), 401);
    ok(await request(app, owner, 'POST', `${base}/security/attest`, { password }), 200);
    ok(await request(app, owner, 'GET', `${base}/entry`), 200);
    assert.equal(ok(await request(app, owner, 'POST', `${base}/work/projects`, command, undefined, key), 201).project.id, project.id);
    await core.withWorkerContext(A.organization.id, A.membership.id, async () => undefined);
    const changed = ok(await request(app, owner, 'PUT', `${base}/administration/security-policy`, { enabled: true, configuration: { ...configuration, expirationDays: 90 } }, active.version), 200);
    assert.equal(changed.version, 2);
    ok(await request(app, owner, 'GET', `${base}/entry`), 403);
    ok(await request(app, owner, 'GET', `${other}/entry`), 200);
    ran = false;
    await assert.rejects(core.withWorkerContext(A.organization.id, A.membership.id, async () => { ran = true; }));
    assert.equal(ran, false);
    ok(await request(app, owner, 'POST', `${base}/security/attest`, { password }), 200);
    ok(await request(app, owner, 'GET', `${base}/entry`), 200);
  } finally { await app.close(); }
});

test('composed draft sharing uses the canonical occupied lead-link function and revokes before replay', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Autora da proposta');
    const reader = await account(app, 'Ocupante do papel');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Governança por função explícita' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const circleId = organization.rootCircle.id;
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: reader.accountId }), 201).membership;
    ok(await request(app, owner, 'POST', `${base}/circles/${circleId}/memberships`, { memberId: member.id }), 201);
    const role = ok(await request(app, owner, 'POST', `${base}/roles`, { name: 'Elo de ligação', circleId, mode: 'DIRECT' }), 201).role;
    const occupancy = ok(await request(app, owner, 'POST', `${base}/roles/${role.id}/occupancies`, { memberId: member.id, kind: 'DIRECT', startsAt: '2020-01-01T00:00:00.000Z' }), 201).occupancy;
    const doc = ok(await request(app, owner, 'POST', `${base}/documents`, { title: 'Acordo em elaboração', ownerId: circleId, workflow: 'GOVERNANCE', visibility: 'ORGANIZATION', content: 'Texto inicial' }), 201);
    const payload = { documentId: doc.id, documentVersion: 1 };
    const proposal = ok(await request(app, owner, 'POST', `${base}/proposals`, { title: 'Rascunho reservado', circleId, kind: 'DOCUMENT', payload }), 201);
    assert.equal(proposal.kind,'GOVERNANCE');
    const amendmentPayload={documents:[payload]};
    ok(await request(app, owner, 'POST', `${base}/governance/policies`, { circleId, configuration: { ...defaultPolicy, draftAccess: 'AUTHOR_AND_LEAD_LINKS' } }), 200);
    assert.equal(ok(await request(app, owner, 'GET', `${base}/governance/policies/${circleId}/effective`), 200).leadLinkAccessAvailable, true);
    // The visible role name and an active occupancy confer no canonical function.
    ok(await request(app, reader, 'GET', `${base}/proposals/${proposal.id}`), 404);
    ok(await request(app, owner, 'PUT', `${base}/structure-advanced/roles/${role.id}/function`, { functionCode: 'LEAD_LINK' }, 0), 200);
    assert.equal(ok(await request(app, reader, 'GET', `${base}/proposals/${proposal.id}`), 200).proposal.canEdit, true);
    const amendmentKey = randomUUID();
    ok(await request(app, reader, 'POST', `${base}/proposals/${proposal.id}/revisions`, { payload:amendmentPayload }, 1, amendmentKey), 201);
    ok(await request(app, owner, 'POST', `${base}/occupancies/${occupancy.id}/end`, {}, occupancy.version), 200);
    ok(await request(app, reader, 'GET', `${base}/proposals/${proposal.id}`), 404);
    ok(await request(app, reader, 'POST', `${base}/proposals/${proposal.id}/revisions`, { payload:amendmentPayload }, 1, amendmentKey), 404);
    const search = ok(await request(app, reader, 'GET', `${base}/platform/search?q=Rascunho`), 200);
    assert.ok(!search.items.some((item: any) => item.id === proposal.id));
  } finally {
    await app.close();
  }
});

test('composed Guest structural shares remain scoped in HTTP and standalone worker environments', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora de compartilhamento');
    const guest = await account(app, 'Convidada de uma organização');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Estrutura compartilhada' }), 201);
    const independent = ok(await request(app, guest, 'POST', '/api/v1/organizations', { name: 'Organização independente' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const shared = ok(await request(app, owner, 'POST', `${base}/circles`, { name: 'Círculo compartilhado', parentCircleId: organization.rootCircle.id, mode: 'DIRECT' }), 201).circle;
    const secret = ok(await request(app, owner, 'POST', `${base}/circles`, { name: 'Círculo reservado', parentCircleId: organization.rootCircle.id, mode: 'DIRECT' }), 201).circle;
    const resource = { context: 'structure', kind: 'circle', id: shared.id };
    const membership = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [{ resource, actions: ['read'] }] }), 201).membership;
    assert.equal(membership.memberType, 'GUEST');
    const forest = ok(await request(app, guest, 'GET', `${base}/structure`), 200);
    assert.deepEqual(forest.nodes.map((node: any) => node.entityId), [shared.id]);
    assert.equal(forest.nodes[0].parentNodeId, null);
    assert.ok(!JSON.stringify(forest).includes(secret.id));
    assert.ok(!JSON.stringify(forest).includes(organization.rootCircle.id));
    ok(await request(app, guest, 'GET', `${base}/circles/${shared.id}`), 200);
    ok(await request(app, guest, 'GET', `${base}/circles/${secret.id}`), 404);
    const search = ok(await request(app, guest, 'GET', `${base}/platform/search?q=Círculo`), 200);
    assert.deepEqual(search.items.map((item: any) => item.id), [shared.id]);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/circle/${shared.id}/comments`), 200);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/circle/${secret.id}/comments`), 404);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/work/projects`), 200).projects, []);
    const directory = ok(await request(app, guest, 'GET', `${base}/members`), 200);
    assert.deepEqual(directory.items.map((member: any) => member.id), [membership.id]);
    ok(await request(app, guest, 'POST', `/api/v1/organizations/${independent.organization.id}/circles`, { name: 'Autonomia preservada', parentCircleId: independent.rootCircle.id, mode: 'DIRECT' }), 201);
    const workerCore = createRuntime();
    const workerEnvironment = createIntegrationEnvironment(workerCore);
    await workerCore.withResourceWorkerContext(organization.organization.id, membership.id, [{ resource, action: 'read' }], async ctx => {
      assert.deepEqual((await workerCore.guestStructureScope(ctx)).roots, [resource]);
      await workerEnvironment.structure.readStructureEntity!(ctx, shared.id, 'CIRCLE');
      assert.equal(await workerEnvironment.registry.allowed(ctx, { type: 'circle', id: shared.id }, 'read'), true);
      assert.equal(await workerEnvironment.registry.allowed(ctx, { type: 'circle', id: secret.id }, 'read'), false);
    });
    const grants = ok(await request(app, owner, 'GET', `${base}/members/${membership.id}/access-grants`), 200).items;
    assert.equal(grants.length, 1);
    ok(await request(app, owner, 'POST', `${base}/members/${membership.id}/access-grants/${grants[0].id}/revoke`, {}, grants[0].version), 200);
    ok(await request(app, guest, 'GET', `${base}/circles/${shared.id}`), 404);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/circle/${shared.id}/comments`), 404);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Círculo`), 200).items, []);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/structure`), 200).nodes, []);
    let callbackRan = false;
    await assert.rejects(workerCore.withResourceWorkerContext(organization.organization.id, membership.id, [{ resource, action: 'read' }], async () => { callbackRan = true; }), (error: any) => error.code === 'RESOURCE_NOT_FOUND');
    assert.equal(callbackRan, false);
  } finally {
    await app.close();
  }
});

test('composed Work Guest task grants do not expose the project, siblings or other public resources', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora de tarefas compartilhadas');
    const guest = await account(app, 'Leitora de tarefa específica');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Trabalho com acesso explícito' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const project = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Projeto privado não compartilhado', visibility: 'PRIVATE' }), 201).project;
    const task = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Tarefa compartilhada', projectId: project.id }), 201).task;
    const hidden = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Tarefa irmã oculta', projectId: project.id }), 201).task;
    ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Projeto público sem grant', visibility: 'PUBLIC' }), 201);
    const resource = { context: 'work', kind: 'task', id: task.id };
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [{ resource, actions: ['read'] }] }), 201).membership;
    const detail = ok(await request(app, guest, 'GET', `${base}/work/tasks/${task.id}`), 200);
    assert.equal(detail.task.projectId, null);
    assert.deepEqual(detail.assignments, []);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/work/tasks`), 200).tasks.map((x: any) => x.id), [task.id]);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/work/projects`), 200).projects, []);
    ok(await request(app, guest, 'GET', `${base}/work/projects/${project.id}`), 404);
    ok(await request(app, guest, 'GET', `${base}/work/tasks/${hidden.id}`), 404);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Tarefa`), 200).items.map((x: any) => x.id), [task.id]);
    const panel = ok(await request(app, guest, 'GET', `${base}/platform/resources/task/${task.id}/capabilities`), 200);
    assert.equal(panel.actions.read, true);
    assert.equal(panel.actions.export, false);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/task/${task.id}/files`), 200);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/task/${hidden.id}/capabilities`), 404);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/task/${task.id}/comments`), 200);
    ok(await request(app, guest, 'POST', `${base}/platform/resources/task/${task.id}/comments`, { content: 'Read não autoriza comentar' }), 404);
    ok(await request(app, guest, 'PATCH', `${base}/work/tasks/${task.id}`, { title: 'Mutação negada' }, task.version), 404);
    const core = createRuntime(), environment = createIntegrationEnvironment(core);
    await core.withResourceWorkerContext(organization.organization.id, member.id, [{ resource, action: 'read' }], async ctx => {
      assert.equal(await environment.registry.allowed(ctx, { type: 'task', id: task.id }, 'read'), true);
      assert.equal(await environment.registry.allowed(ctx, { type: 'task', id: hidden.id }, 'read'), false);
      assert.equal(await environment.registry.allowed(ctx, { type: 'task', id: task.id }, 'export'), false);
    });
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.modules.work = false;
    const disabled = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    ok(await request(app, guest, 'GET', `${base}/work/tasks/${task.id}`), 404);
    let ran = false;
    await assert.rejects(core.withResourceWorkerContext(organization.organization.id, member.id, [{ resource, action: 'read' }], async () => { ran = true; }));
    assert.equal(ran, false);
    settings.settings.modules.work = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, disabled.version), 200);
    const grants = ok(await request(app, owner, 'GET', `${base}/members/${member.id}/access-grants`), 200).items;
    ok(await request(app, owner, 'POST', `${base}/members/${member.id}/access-grants/${grants[0].id}/revoke`, {}, grants[0].version), 200);
    ok(await request(app, guest, 'GET', `${base}/work/tasks/${task.id}`), 404);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Tarefa`), 200).items, []);
  } finally { await app.close(); }
});

test('composed Meetings Guest grants keep meeting and published report scopes separate across HTTP and workers', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora de reuniões compartilhadas');
    const guest = await account(app, 'Leitora de reunião específica');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Reuniões com grants explícitos' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const create = async (title: string) => ok(await request(app, owner, 'POST', `${base}/meeting-series`, {
      title, circleId: organization.rootCircle.id, localStart: '2030-01-01T10:00', timeZone: 'America/Sao_Paulo', durationMinutes: 60,
      recurrence: { frequency: 'ONCE' }, sections: [{ id: 'agenda', title: 'Agenda', kind: 'AGENDA' }], participants: [], policy: { notesOnlyNoter: false, windowDays: 7 }, notesProtocol: 'orgmap-richtext-yjs-v1',
    }), 201).occurrenceIds[0];
    const meetingId = await create('Encontro compartilhado'), hiddenId = await create('Encontro oculto');
    const resource = { context: 'meetings', kind: 'meeting', id: meetingId };
    const membership = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [{ resource, actions: ['read'] }] }), 201).membership;
    const detail = ok(await request(app, guest, 'GET', `${base}/meetings/${meetingId}`), 200);
    assert.equal(detail.accessMode, 'GUEST_READ');
    assert.deepEqual(detail.participants, []);
    assert.equal(detail.report, null);
    assert.ok(!JSON.stringify(detail).includes(organization.rootCircle.id));
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/meetings?limit=1`), 200).items.map((x: any) => x.id), [meetingId]);
    ok(await request(app, guest, 'GET', `${base}/meetings/${hiddenId}`), 404);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Encontro`), 200).items.map((x: any) => x.id), [meetingId]);
    ok(await request(app, guest, 'POST', `${base}/meetings/${meetingId}/actions/start`, {}, detail.meeting.version), 404);
    const core = createRuntime(), environment = createIntegrationEnvironment(core);
    await core.withResourceWorkerContext(organization.organization.id, membership.id, [{ resource, action: 'read' }], async ctx => {
      assert.equal(await environment.registry.allowed(ctx, { type: 'meeting', id: meetingId }, 'read'), true);
      assert.equal(await environment.registry.allowed(ctx, { type: 'meeting', id: hiddenId }, 'read'), false);
      assert.equal(await environment.registry.allowed(ctx, { type: 'meeting', id: meetingId }, 'export'), false);
    });
    let state = ok(await request(app, owner, 'GET', `${base}/meetings/${meetingId}`), 200);
    state = ok(await request(app, owner, 'POST', `${base}/meetings/${meetingId}/actions/start`, {}, state.meeting.version), 200);
    state = ok(await request(app, owner, 'POST', `${base}/meetings/${meetingId}/actions/close`, {}, state.meeting.version), 200);
    state = ok(await request(app, owner, 'POST', `${base}/meetings/${meetingId}/report/actions/publish`, {}, state.report.version), 200);
    const reportId = state.report.id;
    ok(await request(app, guest, 'GET', `${base}/meeting-reports/${reportId}`), 404);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/meeting-reports`), 200).items, []);
    ok(await request(app, owner, 'POST', `${base}/members/${membership.id}/access-grants`, { accessPlan: [{ resource: { context: 'meetings', kind: 'report', id: reportId }, actions: ['read'] }] }), 200);
    const published = ok(await request(app, guest, 'GET', `${base}/meeting-reports/${reportId}`), 200);
    assert.equal(published.report.id, reportId);
    assert.equal(published.snapshot.meeting.id, null);
    assert.deepEqual(published.snapshot.participants, []);
    const grants = ok(await request(app, owner, 'GET', `${base}/members/${membership.id}/access-grants`), 200).items;
    const meetingGrant = grants.find((x: any) => x.kind === 'meeting');
    ok(await request(app, owner, 'POST', `${base}/members/${membership.id}/access-grants/${meetingGrant.id}/revoke`, {}, meetingGrant.version), 200);
    ok(await request(app, guest, 'GET', `${base}/meetings/${meetingId}`), 404);
    ok(await request(app, guest, 'GET', `${base}/meeting-reports/${reportId}`), 200);
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.modules.meetings = false;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    ok(await request(app, guest, 'GET', `${base}/meeting-reports/${reportId}`), 404);
    let ran = false;
    await assert.rejects(core.withResourceWorkerContext(organization.organization.id, membership.id, [{ resource: { context: 'meetings', kind: 'report', id: reportId }, action: 'read' }], async () => { ran = true; }));
    assert.equal(ran, false);
  } finally { await app.close(); }
});

test('composed Goals Guest exact grants survive only while module and original-resource authorization remain valid', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora de objetivos compartilhados');
    const guest = await account(app, 'Leitora de objetivo específico');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Objetivos com acesso explícito' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    await enableGoals(app, owner, base);
    const period = ok(await request(app, owner, 'POST', `${base}/goal-periods`, { title: 'Ciclo de objetivos', startsOn: '2000-01-01', endsOn: '2100-12-31' }), 201);
    const goalInput = { ownerType: 'MEMBER', ownerId: organization.membership.id, periodIds: [period.id], privacy: 'PRIVATE' };
    const goal = ok(await request(app, owner, 'POST', `${base}/goals`, { ...goalInput, title: 'Objetivo compartilhado' }), 201);
    const hidden = ok(await request(app, owner, 'POST', `${base}/goals`, { ...goalInput, title: 'Objetivo oculto' }), 201);
    ok(await request(app, owner, 'POST', `${base}/goals/${goal.id}/key-results`, { title: 'Resultado ainda não compartilhado', resultType: 'QUANTITATIVE', initialValue: '0', targetValue: '10' }, goal.version), 201);
    const detail = ok(await request(app, owner, 'GET', `${base}/goals/${goal.id}`), 200);
    const keyResultId = detail.keyResults[0].id;
    const resource = { context: 'goals', kind: 'goal', id: goal.id };
    const membership = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [{ resource, actions: ['read'] }] }), 201).membership;
    const shared = ok(await request(app, guest, 'GET', `${base}/goals/${goal.id}`), 200);
    assert.equal(shared.ownerId, null);
    assert.deepEqual(shared.keyResults, []);
    const listing = ok(await request(app, guest, 'GET', `${base}/goals?limit=1`), 200);
    assert.deepEqual(listing.items.map((item: any) => item.id), [goal.id]);
    assert.equal(listing.total, 1);
    assert.ok(!JSON.stringify(listing).includes(hidden.title));
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Objetivo`), 200).items.map((item: any) => item.id), [goal.id]);
    ok(await request(app, guest, 'GET', `${base}/goals/${hidden.id}`), 404);
    ok(await request(app, guest, 'GET', `${base}/goals/key-results/${keyResultId}`), 404);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/goal/${goal.id}/comments`), 200);
    ok(await request(app, guest, 'POST', `${base}/platform/resources/goal/${goal.id}/comments`, { content: 'Grant read não permite comentar.' }), 404);
    const workerCore = createRuntime();
    const environment = createIntegrationEnvironment(workerCore);
    await workerCore.withResourceWorkerContext(organization.organization.id, membership.id, [{ resource, action: 'read' }], async ctx => {
      assert.equal(await environment.registry.allowed(ctx, { type: 'goal', id: goal.id }, 'read'), true);
      assert.equal(await environment.registry.allowed(ctx, { type: 'goal', id: hidden.id }, 'read'), false);
      assert.equal(await environment.registry.allowed(ctx, { type: 'goal', id: goal.id }, 'export'), false);
    });
    const krResource = { context: 'goals', kind: 'key-result', id: keyResultId };
    ok(await request(app, owner, 'POST', `${base}/members/${membership.id}/access-grants`, { accessPlan: [{ resource: krResource, actions: ['read'] }] }), 200);
    ok(await request(app, guest, 'GET', `${base}/goals/key-results/${keyResultId}`), 200);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Resultado`), 200).items.map((item: any) => item.id), [keyResultId]);
    await workerCore.withResourceWorkerContext(organization.organization.id, membership.id, [{ resource: krResource, action: 'read' }], async ctx => {
      assert.equal(await environment.registry.allowed(ctx, { type: 'key-result', id: keyResultId }, 'read'), true);
    });
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.modules.goals = false;
    const disabled = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    const denied = await request(app, guest, 'GET', `${base}/goals/${goal.id}`);
    assert.equal(denied.statusCode, 404, denied.body);
    assert.equal(denied.json().error.code, 'RESOURCE_NOT_FOUND');
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Objetivo`), 200).items, []);
    await assert.rejects(workerCore.withResourceWorkerContext(organization.organization.id, membership.id, [{ resource, action: 'read' }], async () => true), (error: any) => error.code === 'RESOURCE_NOT_FOUND');
    settings.settings.modules.goals = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, disabled.version), 200);
    ok(await request(app, guest, 'GET', `${base}/goals/${goal.id}`), 200);
    const grants = ok(await request(app, owner, 'GET', `${base}/members/${membership.id}/access-grants`), 200).items;
    const goalGrant = grants.find((grant: any) => grant.resourceId === goal.id);
    ok(await request(app, owner, 'POST', `${base}/members/${membership.id}/access-grants/${goalGrant.id}/revoke`, {}, goalGrant.version), 200);
    ok(await request(app, guest, 'GET', `${base}/goals/${goal.id}`), 404);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/goal/${goal.id}/comments`), 404);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/goals`), 200).items, []);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Objetivo`), 200).items, []);
    assert.equal(ok(await request(app, guest, 'GET', `${base}/goals/key-results/${keyResultId}`), 200).goalId, null);
  } finally {
    await app.close();
  }
});

test('composed Governance Guest vote intersects current grants with the captured electorate and revokes before replay', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Autora de governança');
    const guest = await account(app, 'Convidada eleitora');
    const lateGuest = await account(app, 'Convidada após abertura da rodada');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Governança compartilhada com escopo' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const document = ok(await request(app, owner, 'POST', `${base}/documents`, { title: 'Acordo compartilhável', ownerId: organization.rootCircle.id, workflow: 'GOVERNANCE', visibility: 'ORGANIZATION', content: 'Conteúdo autorizado.' }), 201);
    const proposalInput = { circleId: organization.rootCircle.id, kind: 'DOCUMENT', payload: { documentId: document.id, documentVersion: 1 } };
    const proposal = ok(await request(app, owner, 'POST', `${base}/proposals`, { ...proposalInput, title: 'Proposta compartilhada' }), 201);
    const hidden = ok(await request(app, owner, 'POST', `${base}/proposals`, { ...proposalInput, title: 'Proposta oculta' }), 201);
    const resource = { context: 'governance', kind: 'proposal', id: proposal.id };
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [{ resource, actions: ['read', 'vote'] }] }), 201).membership;
    const lateMember = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: lateGuest.accountId, memberType: 'GUEST', accessPlan: [] }), 201).membership;
    ok(await request(app, guest, 'GET', `${base}/proposals/${proposal.id}`), 404);
    ok(await request(app, owner, 'POST', `${base}/proposals/${proposal.id}/actions/submit`, {}, proposal.version), 200);
    const shared = ok(await request(app, guest, 'GET', `${base}/proposals/${proposal.id}`), 200);
    assert.equal(shared.proposal.canEdit, false);
    assert.equal(shared.proposal.canVote, true);
    assert.ok(shared.rounds[0].electorate.includes(member.id));
    assert.ok(!shared.rounds[0].electorate.includes(lateMember.id));
    const found = ok(await request(app, guest, 'GET', `${base}/platform/search?q=Proposta`), 200);
    assert.deepEqual(found.items.map((item: any) => item.id), [proposal.id]);
    assert.ok(!JSON.stringify(found).includes(hidden.title));
    ok(await request(app, guest, 'GET', `${base}/proposals/${hidden.id}`), 404);
    ok(await request(app, guest, 'GET', `${base}/platform/resources/proposal/${proposal.id}/comments`), 200);
    ok(await request(app, owner, 'POST', `${base}/members/${lateMember.id}/access-grants`, { accessPlan: [{ resource, actions: ['read', 'vote'] }] }), 200);
    assert.equal(ok(await request(app, lateGuest, 'GET', `${base}/proposals/${proposal.id}`), 200).proposal.canVote, false);
    ok(await request(app, lateGuest, 'POST', `${base}/proposals/${proposal.id}/votes`, { choice: 'CONSENT' }, shared.proposal.version), 403);
    const key = randomUUID();
    ok(await request(app, guest, 'POST', `${base}/proposals/${proposal.id}/votes`, { choice: 'CONSENT' }, shared.proposal.version, key), 200);
    const workerCore = createRuntime();
    const environment = createIntegrationEnvironment(workerCore);
    await workerCore.withResourceWorkerContext(organization.organization.id, member.id, [{ resource, action: 'read' }], async ctx => {
      assert.equal(await environment.registry.allowed(ctx, { type: 'proposal', id: proposal.id }, 'read'), true);
      assert.equal(await environment.registry.allowed(ctx, { type: 'proposal', id: hidden.id }, 'read'), false);
      assert.equal(await environment.registry.allowed(ctx, { type: 'proposal', id: proposal.id }, 'export'), false);
    });
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.modules.governance = false;
    const disabled = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    let callbackRan = false;
    await assert.rejects(workerCore.withResourceWorkerContext(organization.organization.id, member.id, [{ resource, action: 'read' }], async () => { callbackRan = true; }), (error: any) => error.code === 'RESOURCE_NOT_FOUND');
    assert.equal(callbackRan, false);
    ok(await request(app, guest, 'POST', `${base}/proposals/${proposal.id}/votes`, { choice: 'CONSENT' }, shared.proposal.version, key), 404);
    settings.settings.modules.governance = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, disabled.version), 200);
    const grant = ok(await request(app, owner, 'GET', `${base}/members/${member.id}/access-grants`), 200).items[0];
    ok(await request(app, owner, 'POST', `${base}/members/${member.id}/access-grants/${grant.id}/revoke`, {}, grant.version), 200);
    ok(await request(app, guest, 'POST', `${base}/proposals/${proposal.id}/votes`, { choice: 'CONSENT' }, shared.proposal.version, key), 404);
    assert.deepEqual(ok(await request(app, guest, 'GET', `${base}/platform/search?q=Proposta`), 200).items, []);
  } finally {
    await app.close();
  }
});

test('composed organization entry projects the current audience and requires the exact Guest acknowledgement grant', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora de boas-vindas');
    const guest = await account(app, 'Convidada com entrada restrita');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Boas-vindas por organização' }), 201);
    const independent = ok(await request(app, guest, 'POST', '/api/v1/organizations', { name: 'Boas-vindas independentes' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.onboarding = { ...settings.settings.onboarding, enabled: true, audience: 'MEMBER', title: 'Título exclusivo de membros', body: 'Conteúdo exclusivo de membros', videoUrl: 'https://example.org/member-only.mp4', attachmentUrl: 'https://example.org/member-only.pdf' };
    const saved = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [] }), 201).membership;
    ok(await request(app, guest, 'GET', `${base}/entry`), 404);
    const resource = { context: 'administration', kind: 'entry', id: organization.organization.id };
    ok(await request(app, owner, 'POST', `${base}/members/${member.id}/access-grants`, { accessPlan: [{ resource, actions: ['read'] }] }), 200);
    const entry = ok(await request(app, guest, 'GET', `${base}/entry`), 200);
    assert.deepEqual(Object.keys(entry).sort(), ['acknowledged', 'destination', 'legal', 'revision', 'welcome']);
    assert.equal(entry.destination, 'SHARED');
    assert.equal(entry.welcome.mode, 'DEFAULT');
    assert.equal(entry.acknowledged, false);
    assert.doesNotMatch(JSON.stringify(entry), /exclusivo de membros|member-only/);
    ok(await request(app, guest, 'POST', `${base}/entry/acknowledge`, {}, entry.revision), 404);
    ok(await request(app, guest, 'GET', `${base}/administration/settings`), 404);
    ok(await request(app, owner, 'POST', `${base}/members/${member.id}/access-grants`, { accessPlan: [{ resource, actions: ['read', 'acknowledge'] }] }), 200);
    const key = randomUUID();
    ok(await request(app, guest, 'POST', `${base}/entry/acknowledge`, {}, entry.revision, key), 200);
    ok(await request(app, guest, 'POST', `${base}/entry/acknowledge`, {}, entry.revision, key), 200);
    assert.equal(ok(await request(app, guest, 'GET', `${base}/entry`), 200).acknowledged, true);
    const otherEntry = ok(await request(app, guest, 'GET', `/api/v1/organizations/${independent.organization.id}/entry`), 200);
    assert.equal(otherEntry.destination, 'HOME');
    assert.equal(otherEntry.acknowledged, false);
    const grant = ok(await request(app, owner, 'GET', `${base}/members/${member.id}/access-grants`), 200).items[0];
    ok(await request(app, owner, 'POST', `${base}/members/${member.id}/access-grants/${grant.id}/revoke`, {}, grant.version), 200);
    ok(await request(app, guest, 'GET', `${base}/entry`), 404);
    ok(await request(app, guest, 'POST', `${base}/entry/acknowledge`, {}, entry.revision, key), 404);
    settings.settings.onboarding.audience = 'GUEST';
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, saved.version), 200);
    ok(await request(app, owner, 'POST', `${base}/members/${member.id}/access-grants`, { accessPlan: [{ resource, actions: ['read'] }] }), 200);
    const refreshed = ok(await request(app, guest, 'GET', `${base}/entry`), 200);
    assert.equal(refreshed.welcome.mode, 'CUSTOM');
    assert.equal(refreshed.welcome.title, 'Título exclusivo de membros');
    assert.equal(refreshed.acknowledged, true);
    assert.equal(ok(await request(app, owner, 'GET', `${base}/entry`), 200).welcome.mode, 'DEFAULT');
  } finally {
    await app.close();
  }
});

test('composed tension to agenda commits both domains atomically and rechecks the target before successful replay', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  assert.ok(migrationUrl);
  assert.equal(new URL(migrationUrl).pathname, new URL(process.env.DATABASE_URL!).pathname);
  const admin = new pg.Pool({ connectionString: migrationUrl });
  const faultName = `orgmap_agenda_fault_${randomUUID().replaceAll('-', '')}`;
  let faultInstalled = false;
  try {
    await app.ready();
    const owner = await account(app, 'Encaminhadora de tensão');
    const other = await account(app, 'Outro participante');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Encaminhamento transacional' }), 201);
    const foreign = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Outra organização de reuniões' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    ok(await request(app, owner, 'POST', `${base}/members`, { accountId: other.accountId }), 201);
    const seriesInput = { title: 'Reunião de destino', circleId: organization.rootCircle.id, localStart: '2030-01-01T10:00', timeZone: 'America/Sao_Paulo', durationMinutes: 60, recurrence: { frequency: 'ONCE' }, sections: [{ id: 'agenda', title: 'Agenda', kind: 'AGENDA' }], participants: [], policy: { notesOnlyNoter: false, windowDays: 7 } };
    const series = ok(await request(app, owner, 'POST', `${base}/meeting-series`, seriesInput), 201);
    const meetingId = series.occurrenceIds[0];
    const before = ok(await request(app, owner, 'GET', `${base}/meetings/${meetingId}`), 200);
    const tension = ok(await request(app, owner, 'POST', `${base}/tensions`, { title: 'Tensão para a pauta', circleId: organization.rootCircle.id }), 201);
    const endpoint = `${base}/tensions/${tension.id}/actions/process`;
    const command = { targetKind: 'AGENDA', meetingId, meetingVersion: before.meeting.version };
    ok(await request(app, other, 'POST', endpoint, command, tension.version), 403);
    ok(await request(app, owner, 'POST', endpoint, { ...command, meetingVersion: 999 }, tension.version), 409);
    const foreignSeries = ok(await request(app, owner, 'POST', `/api/v1/organizations/${foreign.organization.id}/meeting-series`, { ...seriesInput, circleId: foreign.rootCircle.id }), 201);
    ok(await request(app, owner, 'POST', endpoint, { ...command, meetingId: foreignSeries.occurrenceIds[0] }, tension.version), 404);
    // Deliberate storage failure after the real destination insert, in this disposable database only.
    await admin.query(`CREATE FUNCTION ${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_LINK_STORAGE_FAILURE'; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER ${faultName} BEFORE INSERT ON gov_tension_links FOR EACH ROW WHEN (NEW.tension_id='${tension.id}'::uuid) EXECUTE FUNCTION ${faultName}()`);
    faultInstalled = true;
    const key = randomUUID();
    ok(await request(app, owner, 'POST', endpoint, command, tension.version, key), 500);
    const rolledBack = ok(await request(app, owner, 'GET', `${base}/meetings/${meetingId}`), 200);
    assert.equal(rolledBack.meeting.version, before.meeting.version);
    assert.deepEqual(rolledBack.agenda, []);
    const source = (await admin.query('SELECT version,state FROM gov_tensions WHERE organization_id=$1 AND id=$2', [organization.organization.id, tension.id])).rows[0];
    assert.equal(source.version, tension.version);
    assert.equal(source.state, 'OPEN');
    assert.equal((await admin.query('SELECT 1 FROM gov_tension_links WHERE organization_id=$1 AND tension_id=$2', [organization.organization.id, tension.id])).rowCount, 0);
    await admin.query(`DROP TRIGGER ${faultName} ON gov_tension_links`);
    await admin.query(`DROP FUNCTION ${faultName}()`);
    faultInstalled = false;
    const result = ok(await request(app, owner, 'POST', endpoint, command, tension.version, key), 200);
    assert.equal(result.targetKind, 'AGENDA');
    assert.equal(ok(await request(app, owner, 'POST', endpoint, command, tension.version, key), 200).targetId, result.targetId);
    const after = ok(await request(app, owner, 'GET', `${base}/meetings/${meetingId}`), 200);
    assert.equal(after.agenda.length, 1);
    assert.equal(after.agenda[0].id, result.targetId);
    assert.equal(after.agenda[0].sourceId, tension.id);
    assert.equal(after.agenda[0].title, tension.title);
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.modules.meetings = false;
    const disabled = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    ok(await request(app, owner, 'POST', endpoint, command, tension.version, key), 403);
    settings.settings.modules.meetings = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, disabled.version), 200);
    ok(await request(app, owner, 'POST', `${base}/meetings/${meetingId}/actions/cancel`, { scope: 'THIS', reason: 'Destino encerrado para novas pautas.' }, after.meeting.version), 200);
    ok(await request(app, owner, 'POST', endpoint, command, tension.version, key), 409);
  } finally {
    if (faultInstalled) {
      await admin.query(`DROP TRIGGER IF EXISTS ${faultName} ON gov_tension_links`);
      await admin.query(`DROP FUNCTION IF EXISTS ${faultName}()`);
    }
    await admin.end();
    await app.close();
  }
});

test('composed Work and Platform use one comment thread while preserving immutable legacy history', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    await app.ready();
    const owner = await account(app, 'Autora da thread unificada');
    const guest = await account(app, 'Leitora do histórico');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Comentários canônicos' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const task = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Tarefa com histórico legado' }), 201).task;
    // Historical fixture is written by migrator only, never the tenant runtime.
    const legacyIds = Array.from({ length: 105 }, () => randomUUID());
    for (let i = 0; i < legacyIds.length; i++)
      await admin.query('INSERT INTO work_comments(organization_id,id,task_id,author_id,content,created_at) VALUES($1,$2,$3,$4,$5,$6)', [organization.organization.id, legacyIds[i], task.id, organization.membership.id, `Legado literal <b>${i}</b>`, `2020-01-01T00:00:00.${String(i).padStart(6,'0')}Z`]);
    const command = { content: 'Compatibilidade preservada' }, key = randomUUID();
    const old = ok(await request(app, owner, 'POST', `${base}/work/tasks/${task.id}/comments`, command, task.version, key), 201);
    assert.equal(old.task.version, task.version + 1);
    assert.equal(ok(await request(app, owner, 'POST', `${base}/work/tasks/${task.id}/comments`, command, task.version, key), 201).task.version, old.task.version);
    const added = ok(await request(app, owner, 'POST', `${base}/platform/resources/task/${task.id}/comments`, { content: 'Nova escrita Platform' }), 201);
    const detail = ok(await request(app, owner, 'GET', `${base}/work/tasks/${task.id}`), 200);
    assert.equal(detail.task.version, old.task.version);
    assert.equal(detail.commentsComplete, true);
    assert.equal(detail.commentsSource, 'PLATFORM_THREAD');
    assert.equal(detail.comments.length, 107);
    assert.equal(detail.comments[0].content, 'Legado literal <b>0</b>');
    assert.equal(detail.comments[0].contentRich, null);
    assert.equal(detail.comments.at(-1).id, added.id);
    const collected: any[] = [];
    let cursor: string | null = null;
    do {
      const page = ok(await request(app, owner, 'GET', `${base}/platform/resources/task/${task.id}/comments?limit=17${cursor ? '&cursor='+encodeURIComponent(cursor) : ''}`), 200);
      collected.push(...page.items); cursor = page.page.nextCursor;
    } while (cursor);
    assert.deepEqual(collected.map(x => x.key), detail.comments.map((x: any) => x.key));
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM work_comments WHERE organization_id=$1 AND task_id=$2', [organization.organization.id,task.id])).rows[0].n, 105);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM platform_comments WHERE organization_id=$1 AND resource_id=$2', [organization.organization.id,task.id])).rows[0].n, 2);
    const core = createRuntime();
    await assert.rejects(core.withWorkerContext(organization.organization.id, organization.membership.id, async ctx => {
      await ctx.c.query('INSERT INTO work_comments(organization_id,id,task_id,author_id,content) VALUES($1,$2,$3,$4,$5)', [ctx.org.id,randomUUID(),task.id,ctx.member.id,'Writer antigo recusado']);
    }), (error: any) => error.code === '42501');
    ok(await request(app, owner, 'POST', `${base}/members`, { accountId: guest.accountId, memberType: 'GUEST', accessPlan: [{ resource: { context: 'work', kind: 'task', id: task.id }, actions: ['read'] }] }), 201);
    const shared = ok(await request(app, guest, 'GET', `${base}/work/tasks/${task.id}`), 200);
    assert.equal(shared.comments.length, 107);
    assert.ok(shared.comments.every((comment: any) => comment.authorId === null));
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM work_comments WHERE organization_id=$1 AND author_id=$2', [organization.organization.id,organization.membership.id])).rows[0].n, 105);
  } finally { await app.close(); await admin.end(); }
});

test('composed Work tabular export uses real workbook sheets and a documented single CSV projection', async () => {
  const blobsDirectory = await mkdtemp(join(tmpdir(), 'orgmap-tabular-integration-'));
  const app = await buildApp([createOrgMapIntegration({ blobsDirectory })], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Exportação tabular real');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Planilha dinâmica' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const project = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: '=Projeto Ç', visibility: 'PRIVATE' }), 201).project;
    const empty = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Projeto vazio', visibility: 'PRIVATE' }), 201).project;
    const parent = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: '=1+1', projectId: project.id }), 201).task;
    const child = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Filha 日本語', projectId: project.id, parentId: parent.id }), 201).task;
    const worker = await createPlatformWorker({ blobsDirectory });
    for (const format of ['XLSX', 'CSV']) {
      const queued = ok(await request(app, owner, 'POST', `${base}/work/exports`, { kind: 'TASKS', format }), 202);
      assert.equal(await worker.runJob(organization.organization.id, organization.membership.id), true);
      const job = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${queued.job.id}`), 200);
      assert.equal(job.state, 'COMPLETED', JSON.stringify(job));
      const artifact = ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${job.result.artifactId}/download`), 200);
      const bytes = Buffer.from(artifact.base64, 'base64');
      if (format === 'XLSX') {
        assert.equal(bytes.subarray(0, 2).toString(), 'PK');
        assert.ok(bytes.includes(Buffer.from('name="Tarefas"')));
        assert.ok(bytes.includes(Buffer.from('name="Projetos"')));
        assert.ok(!bytes.includes(Buffer.from('<f>')));
      } else {
        const csv = bytes.toString('utf8');
        assert.ok(csv.startsWith('"Tipo de registro","Projeto ID"'));
        assert.ok(csv.includes('"PROJECT_ONLY"'));
        assert.ok(csv.includes('"\'=1+1"'));
        assert.ok(csv.includes('Filha 日本語'));
      }
      if (process.env.ORGMAP_TABULAR_PROOF_DIRECTORY)
        await writeFile(join(process.env.ORGMAP_TABULAR_PROOF_DIRECTORY, `work.${format.toLowerCase()}`), bytes);
    }
    assert.notEqual(child.id, empty.id);
  } finally { await app.close(); await rm(blobsDirectory, { recursive: true, force: true }); }
});

test('composed organization Work export selects authorized projects and reaches the worker without manual resource IDs', async () => {
  const blobsDirectory = await mkdtemp(join(tmpdir(), 'orgmap-work-export-integration-'));
  const app = await buildApp([createOrgMapIntegration({ blobsDirectory })], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Solicitante de exportação');
    const colleague = await account(app, 'Responsável por projeto público');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Exportação dinâmica da organização' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    ok(await request(app, owner, 'POST', `${base}/members`, { accountId: colleague.accountId }), 201);
    const project = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Projeto selecionado automaticamente', visibility: 'PRIVATE' }), 201).project;
    const shared = ok(await request(app, colleague, 'POST', `${base}/work/projects`, { title: 'Projeto público que pode ser revogado', visibility: 'PUBLIC' }), 201).project;
    const hidden = ok(await request(app, colleague, 'POST', `${base}/work/projects`, { title: 'Projeto privado fora do perímetro', visibility: 'PRIVATE' }), 201).project;
    const parent = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Tarefa pai exportada', projectId: project.id }), 201).task;
    const child = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Subtarefa exportada', projectId: project.id, parentId: parent.id }), 201).task;
    const personal = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: 'Tarefa pessoal não exportável' }), 201).task;
    const capabilities = ok(await request(app, owner, 'GET', `${base}/work/exports/capabilities`), 200);
    assert.equal(capabilities.queueAvailable, true);
    assert.equal(capabilities.tabularAvailable, true);
    const command = { kind: 'TASKS', format: 'JSON' };
    const key = randomUUID();
    const exported = ok(await request(app, owner, 'POST', `${base}/work/exports`, command, undefined, key), 202);
    assert.equal(exported.selection.projects, 2);
    assert.equal(exported.selection.personalTasksExcluded, true);
    assert.equal(ok(await request(app, owner, 'POST', `${base}/work/exports`, command, undefined, key), 202).job.id, exported.job.id);
    const worker = await createPlatformWorker({ blobsDirectory });
    assert.equal(await worker.runJob(organization.organization.id, organization.membership.id), true);
    const job = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${exported.job.id}`), 200);
    assert.equal(job.state, 'COMPLETED');
    const artifactId = job.result.artifactId;
    const artifact = ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${artifactId}/download`), 200);
    const document = JSON.parse(Buffer.from(artifact.base64, 'base64').toString('utf8'));
    assert.equal(document.resourceType, 'work-export');
    assert.equal(document.kind, 'TASKS');
    assert.deepEqual(document.records.map((record: any) => record.sourceId).sort(), [project.id, shared.id].sort());
    assert.deepEqual(document.records.find((record: any) => record.sourceId === project.id).tasks.map((task: any) => task.sourceId), [parent.id, child.id]);
    assert.ok(!JSON.stringify(document).includes(personal.id));
    assert.ok(!JSON.stringify(document).includes(hidden.title));
    ok(await request(app, colleague, 'GET', `${base}/platform/artifacts/${artifactId}/download`), 404);
    const statistics = ok(await request(app, owner, 'POST', `${base}/work/exports`, { kind: 'STATISTICS', format: 'JSON', endMonth: '2026-10' }), 202);
    assert.equal(statistics.selection.months, 25);
    assert.equal(await worker.runJob(organization.organization.id, organization.membership.id), true);
    const statsJob = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${statistics.job.id}`), 200);
    assert.equal(statsJob.state, 'COMPLETED');
    const statsArtifact = ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${statsJob.result.artifactId}/download`), 200);
    const statsDocument = JSON.parse(Buffer.from(statsArtifact.base64, 'base64').toString('utf8'));
    assert.equal(statsDocument.kind, 'STATISTICS');
    assert.equal(statsDocument.records.length, 25);
    // A public project's current ACL still controls already exported selections and successful replay.
    ok(await request(app, colleague, 'PATCH', `${base}/work/projects/${shared.id}`, { visibility: 'PRIVATE' }, shared.version), 200);
    ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${artifactId}/download`), 404);
    ok(await request(app, owner, 'POST', `${base}/work/exports`, command, undefined, key), 404);
    const queued = ok(await request(app, owner, 'POST', `${base}/work/exports`, command), 202);
    assert.equal(queued.selection.projects, 1);
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.modules.work = false;
    const disabled = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    ok(await request(app, owner, 'POST', `${base}/work/exports`, command), 403);
    assert.equal(await worker.runJob(organization.organization.id, organization.membership.id), true);
    ok(await request(app, owner, 'GET', `${base}/platform/jobs/${queued.job.id}`), 404);
    settings.settings.modules.work = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, disabled.version), 200);
    const refused = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${queued.job.id}`), 200);
    assert.equal(refused.state, 'FAILED');
    assert.ok(!refused.result?.artifactId);
  } finally {
    await app.close();
    await rm(blobsDirectory, { recursive: true, force: true });
  }
});

test('composed contexts: tension conversion, private task, search, comments and authorized export worker', async () => {
  const blobsDirectory = await mkdtemp(join(tmpdir(), 'orgmap-integration-'));
  const app = await buildApp([createOrgMapIntegration({ blobsDirectory })], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Coordenadora sintética');
    const colleague = await account(app, 'Colega sintética');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Aurora da integração' }), 201);
    const other = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Horizonte isolado' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const otherBase = `/api/v1/organizations/${other.organization.id}`;
    ok(await request(app, owner, 'POST', `${base}/members`, { accountId: colleague.accountId }), 201);
    const circleId = organization.rootCircle.id;

    const capabilities = ok(await request(app, owner, 'GET', `${base}/platform/capabilities`), 200);
    for (const type of ['circle', 'role', 'proposal', 'tension', 'agreement', 'project', 'task', 'goal', 'key-result', 'meeting', 'report', 'member', 'public-page']) {
      assert.ok(capabilities.resourceTypes.includes(type), `Missing real resource adapter: ${type}`);
    }
    // This is a real target command in the same tenant UoW, not a fake HTTP request or memory repository.
    const title = `Necessidade compartilhada ${randomUUID()}`;
    const tension = ok(await request(app, owner, 'POST', `${base}/tensions`, { title, circleId }), 201);
    const converted = ok(await request(app, owner, 'POST', `${base}/tensions/${tension.id}/actions/process`, { targetKind: 'TASK' }, tension.version), 200);
    assert.equal(converted.targetKind, 'TASK');
    const taskId = converted.targetId;
    const task = ok(await request(app, owner, 'GET', `${base}/work/tasks/${taskId}`), 200);
    assert.ok(JSON.stringify(task).includes(title));
    const ownSearch = ok(await request(app, owner, 'GET', `${base}/platform/search?q=${encodeURIComponent(title)}`), 200);
    assert.ok(ownSearch.items.some((item: any) => item.type === 'task' && item.id === taskId));
    const colleagueSearch = ok(await request(app, colleague, 'GET', `${base}/platform/search?q=${encodeURIComponent(title)}`), 200);
    assert.ok(!colleagueSearch.items.some((item: any) => item.type === 'task' && item.id === taskId));
    ok(await request(app, colleague, 'GET', `${base}/work/tasks/${taskId}`), 404);
    ok(await request(app, owner, 'GET', `${otherBase}/work/tasks/${taskId}`), 404);

    const comment = ok(await request(app, owner, 'POST', `${base}/platform/resources/task/${taskId}/comments`, { content: 'Discussão persistida pelo adapter do contexto dono.' }), 201);
    assert.ok(comment.id);
    ok(await request(app, colleague, 'GET', `${base}/platform/resources/task/${taskId}/comments`), 403);

    // Goals are optional and start disabled for a new organization. Enable the
    // module before exercising its cross-context behavior.
    const goalSettings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    goalSettings.settings.modules.goals = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: goalSettings.settings }, goalSettings.version), 200);
    // A failed cross-context target must not partially process its source tension.
    const goalTension = ok(await request(app, owner, 'POST', `${base}/tensions`, { title: 'Objetivo antes de configurar período', circleId }), 201);
    const beforePeriod = await request(app, owner, 'POST', `${base}/tensions/${goalTension.id}/actions/process`, { targetKind: 'GOAL' }, goalTension.version);
    assert.equal(beforePeriod.statusCode, 422, beforePeriod.body);
    ok(await request(app, owner, 'POST', `${base}/goal-periods`, { title: 'Período de teste', startsOn: '2000-01-01', endsOn: '2100-12-31' }), 201);
    const goal = ok(await request(app, owner, 'POST', `${base}/tensions/${goalTension.id}/actions/process`, { targetKind: 'GOAL' }, goalTension.version), 200);
    assert.equal(goal.targetKind, 'GOAL');
    ok(await request(app, owner, 'GET', `${base}/goals/${goal.targetId}`), 200);

    // TASKS is the organization/project transfer: personal tasks stay outside it even for their creator.
    ok(await request(app, owner, 'POST', `${base}/platform/exports`, { resourceType: 'task', resourceIds: [taskId], kind: 'TASKS', format: 'JSON' }), 403);
    const project = ok(await request(app, owner, 'POST', `${base}/work/projects`, { title: 'Projeto privado da integração', circleId, visibility: 'PRIVATE' }), 201).project;
    const projectTask = ok(await request(app, owner, 'POST', `${base}/work/tasks`, { title: `${title} — tarefa do projeto`, projectId: project.id }), 201).task;
    const exported = ok(await request(app, owner, 'POST', `${base}/platform/exports`, { resourceType: 'task', resourceIds: [projectTask.id], kind: 'TASKS', format: 'JSON' }), 202);
    const worker = await createPlatformWorker({ blobsDirectory });
    assert.equal(await worker.runJob(organization.organization.id, organization.membership.id), true);
    const completed = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${exported.id}`), 200);
    assert.equal(completed.state, 'COMPLETED');
    const artifactId = completed.result.artifactId;
    const artifact = ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${artifactId}/download`), 200);
    const document = JSON.parse(Buffer.from(artifact.base64, 'base64').toString('utf8'));
    assert.equal(document.resourceType, 'task');
    assert.equal(document.kind, 'TASKS');
    assert.ok(JSON.stringify(document.records).includes(title));
    ok(await request(app, colleague, 'GET', `${base}/platform/artifacts/${artifactId}/download`), 404);
    ok(await request(app, owner, 'GET', `${otherBase}/platform/artifacts/${artifactId}/download`), 404);

    // Availability is an authorization input at execution time, including already queued jobs.
    const queuedKey = randomUUID();
    const exportInput = { resourceType: 'task', resourceIds: [projectTask.id], kind: 'TASKS', format: 'JSON' };
    const queued = ok(await request(app, owner, 'POST', `${base}/platform/exports`, exportInput, undefined, queuedKey), 202);
    const disabledTension = ok(await request(app, owner, 'POST', `${base}/tensions`, { title: 'Conversão bloqueada pelo módulo', circleId }), 201);
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.modules.work = false;
    const disabledSettings = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    const unavailable = await request(app, owner, 'GET', `${base}/work/tasks/${taskId}`);
    assert.equal(unavailable.statusCode, 403, unavailable.body);
    assert.equal(unavailable.json().error.code, 'MODULE_DISABLED');
    const hiddenSearch = ok(await request(app, owner, 'GET', `${base}/platform/search?q=${encodeURIComponent(title)}`), 200);
    assert.ok(!hiddenSearch.items.some((item: any) => item.type === 'task' && item.id === taskId));
    ok(await request(app, owner, 'GET', `${base}/platform/resources/task/${taskId}/comments`), 403);
    ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${artifactId}/download`), 404);
    const replayWhileDisabled = await request(app, owner, 'POST', `${base}/platform/exports`, exportInput, undefined, queuedKey);
    assert.equal(replayWhileDisabled.statusCode, 403, replayWhileDisabled.body);
    assert.equal(replayWhileDisabled.json().error.code, 'MODULE_DISABLED');
    const blockedConversion = await request(app, owner, 'POST', `${base}/tensions/${disabledTension.id}/actions/process`, { targetKind: 'TASK' }, disabledTension.version);
    assert.equal(blockedConversion.statusCode, 403, blockedConversion.body);
    assert.equal(blockedConversion.json().error.code, 'MODULE_DISABLED');
    assert.equal(await worker.runJob(organization.organization.id, organization.membership.id), true);
    ok(await request(app, owner, 'GET', `${base}/platform/jobs/${queued.id}`), 404);
    settings.settings.modules.work = true;
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, disabledSettings.version), 200);
    const refusedJob = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${queued.id}`), 200);
    assert.equal(refusedJob.state, 'FAILED');
    assert.ok(!refusedJob.result?.artifactId);
    const resumed = ok(await request(app, owner, 'POST', `${base}/tensions/${disabledTension.id}/actions/process`, { targetKind: 'TASK' }, disabledTension.version), 200);
    ok(await request(app, owner, 'GET', `${base}/work/tasks/${resumed.targetId}`), 200);
  } finally {
    await app.close();
    await rm(blobsDirectory, { recursive: true, force: true });
  }
});

test('composed private export needs explicit intent and current supervision without granting normal private reads', async () => {
  const blobsDirectory = await mkdtemp(join(tmpdir(), 'orgmap-private-integration-'));
  const app = await buildApp([createOrgMapIntegration({ blobsDirectory })], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Administradora sintética');
    const creator = await account(app, 'Gestora do projeto privado');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Aurora de supervisão explícita' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    ok(await request(app, owner, 'POST', `${base}/members`, { accountId: creator.accountId }), 201);
    const privateTitle = `Conteúdo privado ${randomUUID()}`;
    const project = ok(await request(app, creator, 'POST', `${base}/work/projects`, { title: privateTitle, visibility: 'PRIVATE' }), 201).project;
    const task = ok(await request(app, creator, 'POST', `${base}/work/tasks`, { title: privateTitle, projectId: project.id }), 201).task;
    const input = { resourceType: 'task', resourceIds: [task.id], kind: 'TASKS', format: 'JSON' };
    ok(await request(app, owner, 'GET', `${base}/work/tasks/${task.id}`), 404);
    ok(await request(app, owner, 'POST', `${base}/platform/exports`, { ...input, includePrivate: true }), 403);
    let settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    async function supervision(enabled: boolean) {
      settings.settings.oversight.privateOperationalExport = enabled;
      settings = ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings, oversightAcknowledged: true }, settings.version), 200);
    }
    await supervision(true);
    // Turning supervision on does not grant UI reads, normal exports or common search.
    ok(await request(app, owner, 'GET', `${base}/work/tasks/${task.id}`), 404);
    const search = ok(await request(app, owner, 'GET', `${base}/platform/search?q=${encodeURIComponent(privateTitle)}`), 200);
    assert.ok(!search.items.some((item: any) => item.id === task.id || item.id === project.id));
    ok(await request(app, owner, 'POST', `${base}/platform/exports`, input), 403);
    ok(await request(app, creator, 'POST', `${base}/platform/exports`, { ...input, includePrivate: true }), 403);
    const key = randomUUID();
    const job = ok(await request(app, owner, 'POST', `${base}/platform/exports`, { ...input, includePrivate: true }, undefined, key), 202);
    const worker = await createPlatformWorker({ blobsDirectory });
    assert.equal(await worker.runJob(organization.organization.id, organization.membership.id), true);
    const completed = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${job.id}`), 200);
    assert.equal(completed.state, 'COMPLETED');
    const artifact = ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${completed.result.artifactId}/download`), 200);
    assert.ok(Buffer.from(artifact.base64, 'base64').toString('utf8').includes(privateTitle));
    const queued = ok(await request(app, owner, 'POST', `${base}/platform/exports`, { ...input, includePrivate: true }), 202);
    await supervision(false);
    ok(await request(app, owner, 'GET', `${base}/platform/artifacts/${completed.result.artifactId}/download`), 404);
    ok(await request(app, owner, 'POST', `${base}/platform/exports`, { ...input, includePrivate: true }, undefined, key), 403);
    assert.equal(await worker.runJob(organization.organization.id, organization.membership.id), true);
    ok(await request(app, owner, 'GET', `${base}/platform/jobs/${queued.id}`), 404);
    await supervision(true);
    const refused = ok(await request(app, owner, 'GET', `${base}/platform/jobs/${queued.id}`), 200);
    assert.equal(refused.state, 'FAILED');
    assert.ok(!refused.result?.artifactId);
    await supervision(false);
  } finally {
    await app.close();
    await rm(blobsDirectory, { recursive: true, force: true });
  }
});

test('composed circle creation triggers the Work port once and policy writes require a real consumer', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
  try {
    await app.ready();
    const owner = await account(app, 'Gestora da integração de círculos');
    const organization = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Horizonte de criação dinâmica' }), 201);
    const base = `/api/v1/organizations/${organization.organization.id}`;
    const oldCircle = ok(await request(app, owner, 'POST', `${base}/circles`, { name: 'Anterior à configuração', parentCircleId: organization.rootCircle.id, mode: 'DIRECT' }), 201).circle;
    assert.equal(ok(await request(app, owner, 'GET', `${base}/work/projects`), 200).projects.length, 0);
    const current = ok(await request(app, owner, 'GET', `${base}/work/settings`), 200).settings;
    ok(await request(app, owner, 'POST', `${base}/work/settings`, { autoCreateForNewCircles: true, defaultPrivacy: 'PRIVATE' }, current.version), 200);
    const key = randomUUID();
    const input = { name: `Círculo novo ${randomUUID()}`, parentCircleId: organization.rootCircle.id, mode: 'DIRECT' };
    const circle = ok(await request(app, owner, 'POST', `${base}/circles`, input, undefined, key), 201).circle;
    assert.equal(ok(await request(app, owner, 'POST', `${base}/circles`, input, undefined, key), 201).circle.id, circle.id);
    const projects = ok(await request(app, owner, 'GET', `${base}/work/projects`), 200).projects;
    assert.equal(projects.length, 1);
    assert.equal(projects[0].circleId, circle.id);
    assert.equal(projects[0].title, input.name);
    assert.equal(projects[0].visibility, 'PRIVATE');
    assert.ok(!projects.some((project: any) => project.circleId === oldCircle.id));
    const collective = ok(await request(app, owner, 'POST', `${base}/administration/policies`, { value: { key: 'structure.collectiveManagement', value: true, allowOverride: true, parentId: null } }), 201);
    assert.ok(collective.id || collective.record?.id);
    ok(await request(app, owner, 'POST', `${base}/administration/policies`, { value: { key: 'governance.method', value: 'CONSENT_ROUND', allowOverride: true, parentId: null } }), 201);
    const resolved = ok(await request(app, owner, 'GET', `${base}/governance/policies/${circle.id}/effective`), 200);
    assert.equal(resolved.policySource, 'ORGANIZATION');
    assert.equal(resolved.configuration.method, 'CONSENT_ROUND');
    for (const [key, value] of [['organization.allowGuests', true], ['member.profileVisibility', 'organization'], ['security.minimumPasswordLength', 12]]) {
      const unsupported = await request(app, owner, 'POST', `${base}/administration/policies`, { value: { key, value, allowOverride: false, parentId: null } });
      assert.equal(unsupported.statusCode, 422, unsupported.body);
      assert.equal(unsupported.json().error.code, 'POLICY_UNSUPPORTED');
    }
  } finally {
    await app.close();
  }
});

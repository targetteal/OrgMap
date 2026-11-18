import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildApp } from '../../server/src/app.js';
import { pool } from '../../server/src/db.js';
import { createRuntime, type ModuleRuntime } from '../../server/src/runtime.js';
import { createIntegratedDispatcher, createIntegrationEnvironment, createOrgMapIntegration } from '../../server/integration/index.js';
import { PostgresScopeDispatch } from '../../server/modules/platform/index.js';
import { SmtpDeliveryError, startSmtpSink } from '../../server/src/smtp.js';

const origin = 'http://integration.localhost:5273';
process.env.ALLOWED_ORIGINS = origin;
process.env.ORGMAP_PUBLIC_URL = origin;
delete process.env.BREVO_API_KEY;
if (!/^\/orgmap_integration_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL ?? 'postgres://invalid/').pathname))
  throw Error('EXCLUSIVE_INVITATION_NOTIFICATION_DATABASE_REQUIRED');
after(async () => { await pool.end(); });
type Session = { cookie: string; csrf: string; accountId: string; email: string };
async function account(app: FastifyInstance, label: string): Promise<Session> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { origin },
    payload: { email: `${randomUUID()}@example.test`, password: `Fixture!${randomUUID()}`, displayName: label } });
  const data = ok(response, 201), cookie = response.cookies.find(value => value.name === 'orgmap_session');
  assert.ok(cookie);
  return { cookie: `orgmap_session=${cookie.value}`, csrf: data.csrfToken, accountId: data.account.id, email: data.account.email };
}
function request(app: FastifyInstance, session: Session, method: HTTPMethods, url: string, payload?: object, version?: number, key = randomUUID()) {
  return app.inject({ method, url, payload, headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf,
    'idempotency-key': key, ...(version === undefined ? {} : { 'if-match': `"${version}"` }) } });
}
function ok(response: { statusCode: number; body: string; json(): any }, status: number) {
  assert.equal(response.statusCode, status, response.body); return response.json().data;
}
async function fixture() {
  let core!: ModuleRuntime;
  const directory = await mkdtemp(join(tmpdir(), 'orgmap-invitation-notification-'));
  const smtp = await startSmtpSink({ port: 0, directory });
  const smtpPort = (smtp.address() as { port: number }).port;
  const app = await buildApp([createOrgMapIntegration({ smtp: { port: smtpPort } }), async (_app, runtime) => { core = runtime; }], { migrationMaxPrefix: 999 });
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL! });
  const prefix = process.env.INTEGRATION_TEST_ROLE_PREFIX;
  assert.match(prefix ?? '', /^orgmap_it_[a-f0-9]{32}_$/);
  const role = `${prefix}${randomUUID().replaceAll('-', '').slice(0, 16)}`, password = randomUUID();
  let dispatchPool: pg.Pool | undefined;
  let roleCreated = false, organizationId: string | undefined;
  async function close() {
    await app.close(); await dispatchPool?.end();
    if (smtp) await new Promise<void>(resolve => smtp!.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
    if (organizationId) await admin.query('DELETE FROM platform_deliveries WHERE organization_id=$1', [organizationId]);
    if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
    await admin.end();
  }
  try {
    await app.ready();
    const owner = await account(app, 'Titular'), author = await account(app, 'Autora do convite');
    const org = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Equipo de invitaciones' }), 201);
    organizationId = org.organization.id;
    const base = `/api/v1/organizations/${organizationId}`;
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: author.accountId }), 201).membership;
    assert.equal(member.memberType, 'MEMBER');
    ok(await request(app, owner, 'PUT', `${base}/administration/admission-policy`, {
      registrationMode: 'DISABLED', allowedDomains: [], membersMayInvite: true, limitMemberInvitesToDomains: false, invitationLinkEnabled: false,
    }, 0), 200);
    const settings = ok(await request(app, owner, 'GET', `${base}/administration/settings`), 200);
    settings.settings.locale = 'es-ES';
    ok(await request(app, owner, 'PUT', `${base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`); roleCreated = true;
    await admin.query(`GRANT orgmap_platform_dispatcher TO "${role}"`);
    const dispatchUrl = new URL(process.env.MIGRATION_DATABASE_URL!); dispatchUrl.username = role; dispatchUrl.password = password;
    dispatchPool = new pg.Pool({ connectionString: dispatchUrl.href });
    assert.deepEqual((await dispatchPool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0], { rolsuper: false, rolbypassrls: false });
    await assert.rejects(dispatchPool.query('SELECT token FROM invitation_delivery'), (error: any) => error.code === '42501');
    const scopes = new PostgresScopeDispatch(dispatchPool);
    const dispatcher = createIntegratedDispatcher(scopes, { smtp: { port: smtpPort } });
    const issue = async (email = `${randomUUID()}@example.test`) => ok(await request(app, author, 'POST', `${base}/invitations`, { email }), 201);
    const token = async (jobId: string) => (await admin.query('SELECT token FROM invitation_delivery WHERE organization_id=$1 AND id=$2', [organizationId, jobId])).rows[0].token as string;
    const rows = async (invitationId: string) => (await admin.query('SELECT id,event_id,recipient_id,event,channel,state,attempts,nominal FROM platform_deliveries WHERE organization_id=$1 AND resource_type=\'invitation\' AND resource_id=$2 ORDER BY channel', [organizationId, invitationId])).rows;
    const mails = async () => Promise.all((await readdir(directory!)).filter(name => name.endsWith('.eml')).map(name => readFile(join(directory!, name), 'utf8')));
    const accept = async (target: Session, issued: any, key = randomUUID()) => ok(await request(app, target, 'POST', '/api/v1/invitations/accept', { token: await token(issued.deliveryJobId) }, undefined, key), 200);
    return { app, core, admin, owner, author, org, member, base, scopes, dispatcher, smtpPort, issue, token, rows, mails, accept, close };
  } catch (error) { await close(); throw error; }
}
function decodedMime(raw: string) {
  // RFC 2047 folding whitespace between adjacent encoded words is not content.
  return raw.replace(/(\?=)[\r\n \t]+(?==\?UTF-8\?B\?)/gi,'$1')
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, text: string) => Buffer.from(text, 'base64').toString('utf8')) + '\n' +
    [...raw.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)(?=\r?\n--)/g)]
      .map(match => Buffer.from(match[1].replace(/\s/g, ''), 'base64').toString('utf8')).join('\n');
}

test('accepted invitation notifies its regular Member author once through restricted dispatch and localized SMTP', async () => {
  const f = await fixture();
  try {
    const target = await account(f.app, 'Persona invitada'), unrelated = await account(f.app, 'Outra pessoa'), guest = await account(f.app, 'Guest');
    const otherMember = ok(await request(f.app, f.owner, 'POST', `${f.base}/members`, { accountId: unrelated.accountId }), 201).membership;
    const guestMember = ok(await request(f.app, f.owner, 'POST', `${f.base}/members`, { accountId: guest.accountId, memberType: 'GUEST',
      accessPlan: [{ resource: { context: 'structure', kind: 'circle', id: f.org.rootCircle.id }, actions: ['read'] }] }), 201).membership;
    const issued = await f.issue(target.email), acceptanceToken = await f.token(issued.deliveryJobId), key = randomUUID();
    await f.accept(target, issued, key);
    // Replay uses the same real account command after the one-time token has been consumed.
    ok(await request(f.app, target, 'POST', '/api/v1/invitations/accept', { token: acceptanceToken }, undefined, key), 200);
    const queued = await f.rows(issued.invitation.id);
    assert.deepEqual(queued.map(row => ({ channel: row.channel, event: row.event, recipient: row.recipient_id, nominal: row.nominal })),
      ['EMAIL', 'IN_APP'].map(channel => ({ channel, event: 'InvitationAccepted', recipient: f.member.id, nominal: true })));
    assert.equal(new Set(queued.map(row => row.event_id)).size, 1);
    for (let i = 0; i < 3; i++) await f.dispatcher.runOnce();
    assert.deepEqual((await f.rows(issued.invitation.id)).map(row => [row.channel, row.state, row.attempts]), [['EMAIL', 'DELIVERED', 1], ['IN_APP', 'DELIVERED', 1]]);
    const notices = ok(await request(f.app, f.author, 'GET', `${f.base}/platform/notifications`), 200).items;
    assert.equal(notices.length, 1); assert.equal(notices[0].resourceType, 'invitation'); assert.equal(notices[0].resourceId, issued.invitation.id);
    const environment = createIntegrationEnvironment(createRuntime());
    await f.core.withWorkerContext(f.org.organization.id, f.org.membership.id, async ctx => {
      assert.equal((await f.core.invitationResource(ctx, issued.invitation.id))?.email, target.email);
      assert.equal(await environment.registry.allowed(ctx, { type: 'invitation', id: issued.invitation.id }, 'read'), true);
    });
    await f.core.withWorkerContext(f.org.organization.id, otherMember.id, async ctx => {
      assert.equal(await f.core.invitationResource(ctx, issued.invitation.id), null);
      assert.equal(await environment.registry.allowed(ctx, { type: 'invitation', id: issued.invitation.id }, 'read'), false);
    });
    await f.core.withResourceWorkerContext(f.org.organization.id, guestMember.id, [{ resource: { context: 'structure', kind: 'circle', id: f.org.rootCircle.id }, action: 'read' }], async ctx => {
      assert.equal(await f.core.invitationResource(ctx, issued.invitation.id), null);
      assert.equal(await environment.registry.allowed(ctx, { type: 'invitation', id: issued.invitation.id }, 'read'), false);
    });
    for (const viewer of [unrelated, guest]) assert.deepEqual(ok(await request(f.app, viewer, 'GET', `${f.base}/platform/notifications`), 200).items, []);
    assert.deepEqual(ok(await request(f.app, unrelated, 'GET', `${f.base}/invitations?status=ALL&invitationId=${issued.invitation.id}`), 200).items, []);
    ok(await request(f.app, guest, 'GET', `${f.base}/invitations?status=ALL&invitationId=${issued.invitation.id}`), 404);
    const mails = await f.mails(); assert.equal(mails.length, 1);
    const decoded = decodedMime(mails[0]);
    assert.ok(decoded.includes('Persona invitada'));
    assert.ok(decoded.includes(`To: <${f.author.email}>`));
    assert.ok(decoded.includes(`Invitación aceptada · ${target.email} · Equipo de invitaciones`));
    assert.match(decoded, /<h1[^>]*>Invitación aceptada<\/h1>/);
    assert.ok(decoded.includes('Abrir en OrgMap'));
    assert.ok(decoded.includes('Elegir qué notificaciones recibir'));
    assert.ok(decoded.includes('lang="es-ES"'));
    assert.ok(decoded.includes(`${origin}/organization-invitations?organizationId=${f.org.organization.id}&invitationId=${issued.invitation.id}`));
    assert.ok(decoded.includes(`${origin}/platform/preferences?organizationId=${f.org.organization.id}&event=InvitationAccepted`));
    assert.ok(!decoded.includes(acceptanceToken)); assert.ok(!decoded.includes('/invitations/accept')); assert.ok(!decoded.includes('token='));
    for (let i = 0; i < 2; i++) await f.dispatcher.runOnce();
    assert.equal((await f.mails()).length, 1);
  } finally { await f.close(); }
});

test('bounded invitation transport failures notify once only when terminal and unknown outcomes never retry', async () => {
  const f = await fixture();
  try {
    const issued = await f.issue(), secret = await f.token(issued.deliveryJobId);
    for (let attempt = 1; attempt <= 5; attempt++) {
      await f.admin.query('UPDATE invitation_delivery SET next_attempt_at=clock_timestamp() WHERE organization_id=$1 AND id=$2', [f.org.organization.id, issued.deliveryJobId]);
      assert.equal(await f.core.deliverInvitationMail(f.org.organization.id, async () => { throw new SmtpDeliveryError('NOT_SENT', 'private transport credential'); }), 0);
      assert.equal((await f.rows(issued.invitation.id)).length, attempt === 5 ? 2 : 0);
    }
    await f.core.deliverInvitationMail(f.org.organization.id, async () => { assert.fail('terminal failure must not retry'); });
    const terminal = (await f.admin.query('SELECT state,attempts,terminal_at,failure_notified_at FROM invitation_delivery WHERE organization_id=$1 AND id=$2', [f.org.organization.id, issued.deliveryJobId])).rows[0];
    assert.equal(terminal.state, 'FAILED'); assert.equal(terminal.attempts, 5); assert.ok(terminal.terminal_at); assert.ok(terminal.failure_notified_at);
    const unknown = await f.issue();
    await f.core.deliverInvitationMail(f.org.organization.id, async () => { throw new SmtpDeliveryError('OUTCOME_UNKNOWN', 'private receipt data'); });
    await f.core.deliverInvitationMail(f.org.organization.id, async () => { assert.fail('unknown outcome must not blindly retry'); });
    await f.core.withWorkerContext(f.org.organization.id, f.member.id, ctx => f.core.reportInvitationDelivery(ctx.c, ctx.org.id, unknown.deliveryJobId));
    assert.equal((await f.rows(unknown.invitation.id)).length, 2);
    assert.ok((await f.rows(unknown.invitation.id)).every(row => row.event === 'InvitationDeliveryFailed'));
    assert.deepEqual((await f.admin.query('SELECT state,attempts FROM invitation_delivery WHERE organization_id=$1 AND id=$2', [f.org.organization.id, unknown.deliveryJobId])).rows[0], { state: 'OUTCOME_UNKNOWN', attempts: 1 });
    for (let i = 0; i < 5; i++) await f.dispatcher.runOnce();
    for (const invitation of [issued, unknown]) assert.deepEqual((await f.rows(invitation.invitation.id)).map(row => [row.state, row.attempts]), [['DELIVERED', 1], ['DELIVERED', 1]]);
    const mails = await f.mails(); assert.equal(mails.length, 2);
    const expectedSubjects=[issued,unknown].map(invitation=>`La invitación necesita atención · ${invitation.invitation.email} · Equipo de invitaciones`);
    for (const raw of mails) {
      const decoded = decodedMime(raw);
      assert.ok(expectedSubjects.some(subject=>decoded.includes(subject)));
      assert.match(decoded, /<h1[^>]*>La invitación necesita atención<\/h1>/);
      assert.ok(decoded.includes('Comprueba el estado actual antes de reenviar.'));
      assert.ok(decoded.includes('Elegir qué notificaciones recibir'));
      assert.ok(decoded.includes('/organization-invitations?organizationId='));
      assert.ok(decoded.includes(`${origin}/platform/preferences?organizationId=${f.org.organization.id}&event=InvitationDeliveryFailed`));
      assert.ok(!decoded.includes(secret)); assert.ok(!decoded.includes('private ')); assert.ok(!decoded.includes('token='));
    }
  } finally { await f.close(); }
});

test('invitation outcomes obey event preferences, members master and organization email setting', async () => {
  const f = await fixture();
  try {
    const preferences = ok(await request(f.app, f.author, 'GET', `${f.base}/platform/preferences`), 200);
    ok(await request(f.app, f.author, 'POST', `${f.base}/platform/preferences`, { event: 'InvitationAccepted', channel: 'EMAIL', enabled: false }, preferences.version), 200);
    const firstTarget = await account(f.app, 'Primera persona'), first = await f.issue(firstTarget.email); await f.accept(firstTarget, first);
    assert.deepEqual((await f.rows(first.invitation.id)).map(row => row.channel), ['IN_APP']);
    const current = ok(await request(f.app, f.author, 'GET', `${f.base}/platform/preferences`), 200);
    ok(await request(f.app, f.author, 'POST', `${f.base}/platform/preferences`, { event: 'members.Master', channel: 'IN_APP', enabled: false }, current.version), 200);
    const secondTarget = await account(f.app, 'Segunda persona'), second = await f.issue(secondTarget.email); await f.accept(secondTarget, second);
    assert.deepEqual(await f.rows(second.invitation.id), []);
    const settings = ok(await request(f.app, f.owner, 'GET', `${f.base}/administration/settings`), 200);
    settings.settings.notifications.emailEnabled = false;
    ok(await request(f.app, f.owner, 'PUT', `${f.base}/administration/settings`, { settings: settings.settings }, settings.version), 200);
    const failure = await f.issue();
    await f.core.deliverInvitationMail(f.org.organization.id, async () => { throw new SmtpDeliveryError('OUTCOME_UNKNOWN', 'synthetic unknown'); });
    assert.deepEqual(await f.rows(failure.invitation.id), []);
    // Dispatch rechecks the newly disabled master even for the earlier queued channel.
    for (let i = 0; i < 3; i++) await f.dispatcher.runOnce();
    assert.equal((await f.rows(first.invitation.id))[0].state, 'SUPPRESSED');
    assert.equal((await f.mails()).length, 0);
  } finally { await f.close(); }
});

test('queued invitation outcome revalidates author suspension after restricted metadata claim', async () => {
  const f = await fixture();
  try {
    const target = await account(f.app, 'Persona que acepta'), issued = await f.issue(target.email); await f.accept(target, issued);
    const queued = await f.rows(issued.invitation.id), metadata = f.scopes.deliveryMetadata(); let suspended = false;
    const guardedScopes = { claim: f.scopes.claim.bind(f.scopes), release: f.scopes.release.bind(f.scopes), heartbeat: f.scopes.heartbeat.bind(f.scopes),
      deliveryMetadata: () => ({ ...metadata, claim: async (...args: Parameters<typeof metadata.claim>) => {
        const claim = await metadata.claim(...args);
        if (claim && queued.some(row => row.id === claim.id) && !suspended) {
          ok(await request(f.app, f.owner, 'PATCH', `${f.base}/members/${f.member.id}`, { status: 'SUSPENDED' }, f.member.version), 200);
          suspended = true;
        }
        return claim;
      } }) };
    const dispatcher = createIntegratedDispatcher(guardedScopes, { smtp: { port: f.smtpPort } });
    for (let i = 0; i < 3; i++) await dispatcher.runOnce();
    assert.equal(suspended, true);
    assert.deepEqual((await f.rows(issued.invitation.id)).map(row => [row.channel, row.state, row.attempts]), [['EMAIL', 'SUPPRESSED', 1], ['IN_APP', 'SUPPRESSED', 1]]);
    assert.equal((await f.mails()).length, 0);
  } finally { await f.close(); }
});

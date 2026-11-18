import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildApp } from '../../server/src/app.js';
import { pool } from '../../server/src/db.js';
import { Failure } from '../../server/src/core.js';
import type { ModuleRuntime } from '../../server/src/runtime.js';
import type { NotificationIntent } from '../../packages/contracts/notifications.js';
import { createOrgMapIntegration, createPlatformWorker } from '../../server/integration/index.js';
import { createStructurePorts } from '../../server/modules/structure/applier.js';
import { seedO2Panel } from '../../server/modules/meetings/o2-fixture.js';
import { defaultPolicy } from '../../server/modules/governance/domain.js';

const origin = 'http://integration.localhost:5273';
process.env.ALLOWED_ORIGINS = origin;
delete process.env.BREVO_API_KEY;
if (!/^\/orgmap_integration_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL ?? 'postgres://invalid/').pathname))
  throw Error('EXCLUSIVE_NOTIFICATION_DOMAIN_DATABASE_REQUIRED');
after(async () => { await pool.end(); });
type Session = { cookie: string; csrf: string; accountId: string };
function request(app: FastifyInstance, session: Session, method: HTTPMethods, url: string, payload?: object, version?: number, key = randomUUID()) {
  return app.inject({ method, url, payload, headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf,
    'idempotency-key': key, ...(version === undefined ? {} : { 'if-match': `"${version}"` }) } });
}
function ok(response: { statusCode: number; body: string; json(): any }, status = 200) {
  assert.equal(response.statusCode, status, response.body); return response.json().data;
}
async function account(app: FastifyInstance, displayName: string): Promise<Session> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { origin },
    payload: { email: `${randomUUID()}@example.test`, password: `Fixture!${randomUUID()}`, displayName } });
  const data = ok(r, 201);
  return { cookie: `orgmap_session=${r.cookies.find(value => value.name === 'orgmap_session')!.value}`, csrf: data.csrfToken, accountId: data.account.id };
}
async function fixture() {
  let core!: ModuleRuntime;
  let failNextPublication = false;
  const intents: NotificationIntent[] = [];
  const app = await buildApp([createOrgMapIntegration(), async (_app, runtime) => {
    core = runtime;
    const publish = runtime.publishNotification;
    runtime.publishNotification = async (ctx, input) => {
      intents.push(input);
      await publish(ctx, input);
      if (failNextPublication) { failNextPublication = false; throw new Failure(503, 'SYNTHETIC_PUBLICATION_FAILURE'); }
    };
  }], { migrationScope: 'all' });
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL! });
  try {
    const owner = await account(app, 'Marina coordena'), recipient = await account(app, 'Pedro participa'), outsider = await account(app, 'Outra organização');
    const org = ok(await request(app, owner, 'POST', '/api/v1/organizations', { name: 'Estrutura com avisos' }), 201);
    const other = ok(await request(app, outsider, 'POST', '/api/v1/organizations', { name: 'Organização isolada' }), 201);
    const base = `/api/v1/organizations/${org.organization.id}`;
    const member = ok(await request(app, owner, 'POST', `${base}/members`, { accountId: recipient.accountId }), 201).membership;
    const rows = async (resourceId: string, event?: string) => (await admin.query(
      'SELECT event,event_id,recipient_id,resource_type,channel FROM platform_deliveries WHERE organization_id=$1 AND resource_id=$2 AND ($3::text IS NULL OR event=$3) ORDER BY event,channel',
      [org.organization.id, resourceId, event ?? null],
    )).rows;
    const pair = async (resourceId: string, event: string, recipientId = member.id) => {
      const delivered = await rows(resourceId, event);
      assert.deepEqual(delivered.map(row => [row.channel, row.recipient_id]), [['EMAIL', recipientId], ['IN_APP', recipientId]]);
      assert.equal(new Set(delivered.map(row => row.event_id)).size, 1);
    };
    const role = async (name: string) => ok(await request(app, owner, 'POST', `${base}/roles`, { circleId: org.rootCircle.id, name, purpose: 'Escopo inicial', mode: 'DIRECT' }), 201).role;
    return { app, core, admin, owner, recipient, outsider, org, other, base, member, intents, rows, pair, role,
      failNext: () => { failNextPublication = true; },
      close: async () => { await app.close(); await admin.end(); } };
  } catch (error) { await app.close(); await admin.end(); throw error; }
}

test('structure commands notify actual recipients once across direct, mandate and applier paths, with atomic rollback and tenant isolation', async () => {
  const f = await fixture();
  try {
    const role = await f.role('Articulação');
    const assignment = { memberId: f.member.id, kind: 'DIRECT', scope: 'Acompanhar as entregas', startsAt: '2026-01-01T00:00:00Z' };
    const key = randomUUID();
    const first = ok(await request(f.app, f.owner, 'POST', `${f.base}/roles/${role.id}/occupancies`, assignment, undefined, key), 201);
    ok(await request(f.app, f.owner, 'POST', `${f.base}/roles/${role.id}/occupancies`, assignment, undefined, key), 201);
    await f.pair(role.id, 'RoleAssigned');
    const intent = f.intents.find(input => input.event === 'RoleAssigned' && input.ref.id === role.id)!;
    assert.equal(intent.context?.resourceTitle, 'Articulação');
    assert.ok(intent.context?.details?.some(detail => detail.key === 'scope' && detail.value === assignment.scope));
    assert.ok(intent.context?.details?.some(detail => detail.key === 'person' && detail.value === 'Pedro participa'));

    ok(await request(f.app, f.owner, 'PATCH', `${f.base}/roles/${role.id}`, { purpose: 'Escopo revisto', mode: 'DIRECT' }, 1));
    await f.pair(role.id, 'RoleScopeUpdated');
    const scope = f.intents.find(input => input.event === 'RoleScopeUpdated' && input.ref.id === role.id)!;
    assert.ok(scope.context?.details?.some(detail => detail.key === 'previousScope' && detail.value === 'Escopo inicial'));
    assert.ok(scope.context?.details?.some(detail => detail.key === 'scope' && detail.value === 'Escopo revisto'));
    ok(await request(f.app, f.owner, 'PATCH', `${f.base}/roles/${role.id}`, { purpose: 'Escopo revisto', mode: 'DIRECT' }, 2));
    await f.pair(role.id, 'RoleScopeUpdated'); // version-only update has no second notice
    ok(await request(f.app, f.owner, 'POST', `${f.base}/occupancies/${first.occupancy.id}/end`, {}, first.occupancy.version));
    await f.pair(role.id, 'RoleUnassigned');

    const association = ok(await request(f.app, f.owner, 'POST', `${f.base}/circles/${f.org.rootCircle.id}/memberships`, { memberId: f.member.id, startsAt: '2026-01-01T00:00:00Z' }), 201).membership;
    await f.pair(f.org.rootCircle.id, 'CircleAssigned');
    ok(await request(f.app, f.owner, 'POST', `${f.base}/circle-memberships/${association.id}/end`, {}, association.version));
    await f.pair(f.org.rootCircle.id, 'CircleUnassigned');

    const mandateRole = await f.role('Rodízio');
    const mandate = ok(await request(f.app, f.owner, 'POST', `${f.base}/structure-advanced/mandates`, { roleId: mandateRole.id, memberId: f.member.id, kind: 'INTERIM', scope: 'Cobertura temporária', startsAt: '2026-01-01T00:00:00Z', endsAt: '2090-01-01T00:00:00Z' }), 201);
    await f.pair(mandateRole.id, 'RoleAssigned');
    ok(await request(f.app, f.owner, 'POST', `${f.base}/structure-advanced/mandates/${mandate.id}/end`, {}, mandate.version));
    await f.pair(mandateRole.id, 'RoleUnassigned');

    const electionRole = await f.role('Representação');
    ok(await request(f.app, f.owner, 'PUT', `${f.base}/structure-advanced/roles/${electionRole.id}/settings`, { flags: { core: false, electable: true, assigner: false, representative: false, admin: false } }, 0));
    await f.core.withWorkerContext(f.org.organization.id, f.org.membership.id, async ctx => {
      await createStructurePorts(f.core).applyElection(ctx, { proposalId: randomUUID(), revision: 1, roleId: electionRole.id, winnerId: f.member.id, mandateEnd: '2090-01-01T00:00:00Z' });
    });
    await f.pair(electionRole.id, 'RoleAssigned');
    await f.core.withWorkerContext(f.org.organization.id, f.org.membership.id, async ctx => {
      await createStructurePorts(f.core).applyStructure(ctx, { proposalId: randomUUID(), revision: 1, changes: [{ kind: 'UPDATE', entityId: electionRole.id, baseVersion: 1, purpose: 'Representar com novo escopo' }] });
    });
    await f.pair(electionRole.id, 'RoleScopeUpdated');

    const failedRole = await f.role('Ação que deve reverter');
    f.failNext();
    const failure = await request(f.app, f.owner, 'POST', `${f.base}/roles/${failedRole.id}/occupancies`, assignment);
    assert.equal(failure.statusCode, 503, failure.body);
    assert.deepEqual(await f.rows(failedRole.id), []);
    assert.equal((await f.admin.query('SELECT count(*)::int n FROM occupancies WHERE organization_id=$1 AND role_id=$2', [f.org.organization.id, failedRole.id])).rows[0].n, 0);
    assert.ok([403,404].includes((await request(f.app, f.outsider, 'POST', `${f.base}/roles/${failedRole.id}/occupancies`, assignment)).statusCode));
    assert.deepEqual(await f.rows(failedRole.id), []);
    assert.equal((await f.admin.query('SELECT count(*)::int n FROM platform_deliveries WHERE organization_id=$1', [f.other.organization.id])).rows[0].n, 0);
  } finally { await f.close(); }
});

test('proposal submission and decision notify the captured electorate and preserve replay uniqueness', async () => {
  const f = await fixture();
  try {
    ok(await request(f.app, f.owner, 'POST', `${f.base}/circles/${f.org.rootCircle.id}/memberships`, { memberId: f.member.id, startsAt: '2026-01-01T00:00:00Z' }), 201);
    const proposal = ok(await request(f.app, f.owner, 'POST', `${f.base}/proposals`, { title: 'Criar facilitação', kind: 'GOVERNANCE', circleId: f.org.rootCircle.id,
      payload: { changes: [{ kind: 'CREATE', entityId: randomUUID(), entityKind: 'ROLE', parentCircleId: f.org.rootCircle.id, name: 'Facilitação', purpose: 'Cuidar do processo' }] } }), 201);
    const path = `${f.base}/proposals/${proposal.id}`, key = randomUUID();
    ok(await request(f.app, f.owner, 'POST', path + '/actions/submit', {}, proposal.version, key));
    ok(await request(f.app, f.owner, 'POST', path + '/actions/submit', {}, proposal.version, key));
    await f.pair(proposal.id, 'ProposalSubmitted');
    ok(await request(f.app, f.owner, 'POST', path + '/votes', { choice: 'CONSENT' }, 2));
    ok(await request(f.app, f.recipient, 'POST', path + '/votes', { choice: 'CONSENT' }, 2));
    for (const step of ['CLARIFY','REACT','OBJECT','DECIDE']) ok(await request(f.app, f.owner, 'POST', path + '/actions/step', { step }, 2));
    ok(await request(f.app, f.owner, 'POST', path + '/actions/decide', { verdict: 'ADOPT', reason: 'Sem objeções à criação do papel' }, 2));
    await f.pair(proposal.id, 'ProposalDecided');
    assert.ok((await f.rows(proposal.id)).every(row => row.recipient_id === f.member.id));
  } finally { await f.close(); }
});

test('automatic consent notifies its author about the actual window and outcome without notifying their own submission', async () => {
  const f = await fixture();
  try {
    ok(await request(f.app, f.owner, 'POST', `${f.base}/circles/${f.org.rootCircle.id}/memberships`, { memberId: f.member.id, startsAt: '2026-01-01T00:00:00Z' }), 201);
    for (const actor of [f.owner,f.recipient]) {
      const preferences = ok(await request(f.app, actor, 'GET', `${f.base}/platform/preferences`));
      ok(await request(f.app, actor, 'POST', `${f.base}/platform/preferences`, { event: 'structure.Master', channel: 'EMAIL', enabled: false }, preferences.version));
    }
    ok(await request(f.app, f.owner, 'POST', `${f.base}/governance/policies`, { circleId: f.org.rootCircle.id,
      configuration: { ...defaultPolicy, decisionProcess: 'HOLACRACY_O2', method: 'CONSENT_WINDOW', reviewDurationHours: 1, workflowSteps: ['DECIDE'] } }));
    const proposal = ok(await request(f.app, f.owner, 'POST', `${f.base}/proposals`, { title: 'Consentimento automático acompanhado', kind: 'GOVERNANCE', circleId: f.org.rootCircle.id,
      payload: { changes: [{ kind: 'CREATE', entityId: randomUUID(), entityKind: 'ROLE', parentCircleId: f.org.rootCircle.id, name: 'Apoio assíncrono', purpose: 'Apoiar o círculo' }] } }), 201);
    const submitted = ok(await request(f.app, f.owner, 'POST', `${f.base}/proposals/${proposal.id}/actions/submit`, {}, proposal.version));
    assert.equal(submitted.round.deadline, null);
    assert.deepEqual((await f.rows(proposal.id, 'ProposalSubmitted')).map(row => [row.channel,row.recipient_id]), [['IN_APP',f.member.id]]);
    const worker = await createPlatformWorker();
    await worker.runGovernanceConsent(f.org.organization.id, f.org.membership.id);
    assert.deepEqual(await f.rows(proposal.id, 'ConsentWindowOpened'), []);
    for (let pass = 0; pass < 5; pass++) await worker.runDelivery(f.org.organization.id, f.member.id);
    await worker.runGovernanceConsent(f.org.organization.id, f.org.membership.id);
    const recipients = [f.org.membership.id,f.member.id].sort();
    for (const event of ['ConsentWindowOpened','ProposalDecided']) {
      if (event === 'ProposalDecided') {
        await f.admin.query("UPDATE gov_rounds SET deadline=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND proposal_id=$2", [f.org.organization.id,proposal.id]);
        await worker.runGovernanceConsent(f.org.organization.id,f.org.membership.id);
      }
      const rows = await f.rows(proposal.id,event);
      assert.deepEqual(rows.map(row => row.recipient_id).sort(),recipients);
      assert.ok(rows.every(row => row.channel === 'IN_APP'));
      assert.equal(new Set(rows.map(row => row.event_id)).size,1);
    }
    await worker.runGovernanceConsent(f.org.organization.id,f.org.membership.id);
    assert.equal((await f.rows(proposal.id,'ProposalDecided')).length,2);
    assert.equal(ok(await request(f.app,f.owner,'GET',`${f.base}/proposals/${proposal.id}`)).proposal.applyState,'APPLIED');
  } finally { await f.close(); }
});

test('consent distribution respects event and master opt-outs while an enabled pending delivery still gates the window', async () => {
  const f = await fixture();
  try {
    ok(await request(f.app, f.owner, 'POST', `${f.base}/circles/${f.org.rootCircle.id}/memberships`, { memberId: f.member.id, startsAt: '2026-01-01T00:00:00Z' }), 201);
    ok(await request(f.app, f.owner, 'POST', `${f.base}/governance/policies`, { circleId: f.org.rootCircle.id,
      configuration: { ...defaultPolicy, decisionProcess: 'HOLACRACY_O2', method: 'CONSENT_WINDOW', reviewDurationHours: 1, workflowSteps: ['DECIDE'] } }));
    const preference = async (event: string, channel: string, enabled: boolean) => {
      const current = ok(await request(f.app, f.recipient, 'GET', `${f.base}/platform/preferences`));
      ok(await request(f.app, f.recipient, 'POST', `${f.base}/platform/preferences`, { event, channel, enabled }, current.version));
    };
    const submit = async (title: string) => {
      const proposal = ok(await request(f.app, f.owner, 'POST', `${f.base}/proposals`, { title, kind: 'GOVERNANCE', circleId: f.org.rootCircle.id,
        payload: { changes: [{ kind: 'CREATE', entityId: randomUUID(), entityKind: 'ROLE', parentCircleId: f.org.rootCircle.id, name: title, purpose: 'Apoiar o círculo' }] } }), 201);
      const submitted = ok(await request(f.app, f.owner, 'POST', `${f.base}/proposals/${proposal.id}/actions/submit`, {}, proposal.version));
      assert.ok(submitted.round.electorate.includes(f.member.id));
      assert.equal(submitted.round.deadline, null);
      return proposal;
    };
    const deadline = async (proposal: { id: string }) => ok(await request(f.app, f.owner, 'GET', `${f.base}/proposals/${proposal.id}`)).rounds[0].deadline;
    const worker = await createPlatformWorker();
    const process = () => worker.runGovernanceConsent(f.org.organization.id, f.org.membership.id);

    for (const channel of ['EMAIL','IN_APP']) await preference('ProposalSubmitted', channel, false);
    const eventOptOut = await submit('Aviso de proposta desativado');
    assert.deepEqual(await f.rows(eventOptOut.id, 'ProposalSubmitted'), []);
    await process();
    assert.ok(await deadline(eventOptOut)); // Explicit opt-out does not strand a valid round before its window.

    for (const channel of ['EMAIL','IN_APP']) {
      await preference('ProposalSubmitted', channel, true);
      await preference('structure.Master', channel, false);
    }
    const masterOptOut = await submit('Módulo de notificações desativado');
    assert.deepEqual(await f.rows(masterOptOut.id, 'ProposalSubmitted'), []);
    await process();
    assert.ok(await deadline(masterOptOut));

    for (const channel of ['EMAIL','IN_APP']) await preference('structure.Master', channel, true);
    await preference('structure.Master', 'EMAIL', false);
    await preference('circles.Master', 'EMAIL', false);
    await preference('ProposalSubmitted', 'EMAIL', false);
    const pending = await submit('Sino habilitado aguarda distribuição');
    assert.deepEqual((await f.rows(pending.id, 'ProposalSubmitted')).map(row => [row.channel,row.recipient_id]), [['IN_APP',f.member.id]]);
    await process();
    assert.equal(await deadline(pending), null);
    assert.equal((await f.admin.query("SELECT state FROM platform_deliveries WHERE organization_id=$1 AND resource_id=$2 AND event='ProposalSubmitted'", [f.org.organization.id,pending.id])).rows[0].state, 'PENDING');
    for (let pass = 0; pass < 8; pass++) await worker.runDelivery(f.org.organization.id, f.member.id);
    assert.equal((await f.admin.query("SELECT state FROM platform_deliveries WHERE organization_id=$1 AND resource_id=$2 AND event='ProposalSubmitted'", [f.org.organization.id,pending.id])).rows[0].state, 'DELIVERED');
    await process();
    assert.ok(await deadline(pending));

    // A preference changed after enqueue must also be honored without inventing a delivery receipt.
    const changedAfterEnqueue = await submit('Preferência alterada antes do envio');
    await process();
    assert.equal(await deadline(changedAfterEnqueue), null);
    await preference('ProposalSubmitted', 'IN_APP', false);
    await process();
    assert.ok(await deadline(changedAfterEnqueue));
    assert.equal((await f.admin.query("SELECT count(*)::int AS n FROM platform_deliveries WHERE organization_id=$1 AND resource_id=$2 AND event='ProposalSubmitted' AND state='DELIVERED'", [f.org.organization.id,changedAfterEnqueue.id])).rows[0].n, 0);
  } finally { await f.close(); }
});

test('suppressed consent distributions stay final after opt-in while previously absent deliveries are enqueued', async () => {
  const f = await fixture();
  try {
    const secondVoter = await account(f.app, 'Outra pessoa do eleitorado');
    const secondMember = ok(await request(f.app, f.owner, 'POST', `${f.base}/members`, { accountId: secondVoter.accountId }), 201).membership;
    const preference = async (actor: Session, event: string, channel: string, enabled: boolean) => {
      const current = ok(await request(f.app, actor, 'GET', `${f.base}/platform/preferences`));
      ok(await request(f.app, actor, 'POST', `${f.base}/platform/preferences`, { event, channel, enabled }, current.version));
    };
    for (const [actor,member] of [[f.recipient,f.member],[secondVoter,secondMember]] as const) {
      for (const event of ['structure.Master','circles.Master']) await preference(actor,event,'EMAIL',false);
      ok(await request(f.app, f.owner, 'POST', `${f.base}/circles/${f.org.rootCircle.id}/memberships`, { memberId: member.id, startsAt: '2026-01-01T00:00:00Z' }), 201);
    }
    ok(await request(f.app, f.owner, 'POST', `${f.base}/governance/policies`, { circleId: f.org.rootCircle.id,
      configuration: { ...defaultPolicy, decisionProcess: 'HOLACRACY_O2', method: 'CONSENT_WINDOW', reviewDurationHours: 1, workflowSteps: ['DECIDE'] } }));
    const submit = async (title: string) => {
      const proposal = ok(await request(f.app, f.owner, 'POST', `${f.base}/proposals`, { title, kind: 'GOVERNANCE', circleId: f.org.rootCircle.id,
        payload: { changes: [{ kind: 'CREATE', entityId: randomUUID(), entityKind: 'ROLE', parentCircleId: f.org.rootCircle.id, name: title, purpose: 'Apoiar o círculo' }] } }), 201);
      const submitted = ok(await request(f.app, f.owner, 'POST', `${f.base}/proposals/${proposal.id}/actions/submit`, {}, proposal.version));
      assert.ok(submitted.round.electorate.includes(f.member.id) && submitted.round.electorate.includes(secondMember.id));
      return proposal;
    };
    const deadline = async (proposal: { id: string }) => ok(await request(f.app, f.owner, 'GET', `${f.base}/proposals/${proposal.id}`)).rounds[0].deadline;
    const states = async (proposal: { id: string }, memberId: string) => (await f.admin.query(
      "SELECT id,state FROM platform_deliveries WHERE organization_id=$1 AND resource_id=$2 AND recipient_id=$3 AND event='ProposalSubmitted' ORDER BY channel", [f.org.organization.id,proposal.id,memberId],
    )).rows;
    const worker = await createPlatformWorker();
    const process = () => worker.runGovernanceConsent(f.org.organization.id,f.org.membership.id);
    const deliverUntil = async (proposal: { id: string }, memberId: string, state: string) => {
      for (let pass = 0; pass < 12; pass++) {
        const rows = await states(proposal,memberId);
        if (rows.length && rows.every(row => row.state === state)) return;
        await worker.runDelivery(f.org.organization.id,memberId);
      }
      assert.fail(`Native delivery did not reach ${state}`);
    };

    const suppressed = await submit('Uma recusa registrada permanece válida');
    await preference(f.recipient,'ProposalSubmitted','IN_APP',false);
    await deliverUntil(suppressed,f.member.id,'SUPPRESSED');
    const original = await states(suppressed,f.member.id);
    await process();
    assert.equal(await deadline(suppressed),null); // The second voter's enabled notice is still pending.
    await preference(f.recipient,'ProposalSubmitted','IN_APP',true);
    await process();
    assert.equal(await deadline(suppressed),null);
    assert.deepEqual(await states(suppressed,f.member.id),original); // No resend or revival on a new preference.
    await deliverUntil(suppressed,secondMember.id,'DELIVERED');
    await process();
    assert.ok(await deadline(suppressed));
    assert.deepEqual(await states(suppressed,f.member.id),original);

    await preference(f.recipient,'ProposalSubmitted','IN_APP',false);
    const absent = await submit('Ativação antes da distribuição ainda pendente');
    assert.deepEqual(await states(absent,f.member.id),[]);
    await process();
    assert.equal(await deadline(absent),null);
    await preference(f.recipient,'ProposalSubmitted','IN_APP',true);
    await process(); // The still-pending distribution invokes the normal domain publisher again.
    assert.equal(await deadline(absent),null);
    assert.deepEqual((await states(absent,f.member.id)).map(row => row.state),['PENDING']);
    for (const memberId of [f.member.id,secondMember.id]) await deliverUntil(absent,memberId,'DELIVERED');
    await process();
    assert.ok(await deadline(absent));
    assert.equal((await states(absent,f.member.id)).length,1);
  } finally { await f.close(); }
});

test('a decision reached in an O2 meeting emits a single proposal notice for current eligible participants', async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationScope: 'all' });
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL! });
  try {
    const f = await seedO2Panel(app, origin);
    for (const actor of [f.scribe,f.facilitator]) {
      const assigned = (await admin.query("SELECT channel FROM platform_deliveries WHERE organization_id=$1 AND recipient_id=$2 AND event='RoleAssigned' ORDER BY channel",[f.base.split('/').at(-1),actor.memberId])).rows;
      assert.deepEqual(assigned.map(row => row.channel),['EMAIL','IN_APP']);
    }
    const room = await f.call(f.scribe, 'GET', f.url);
    const output = await f.call(f.scribe, 'POST', f.url + '/outcomes', {
      kind: 'PROPOSAL', title: 'Novo papel por consentimento', proposalKind: 'GOVERNANCE', agendaId: f.agendaId,
      payload: { changes: [{ kind: 'CREATE', entityId: randomUUID(), entityKind: 'ROLE', parentCircleId: f.rootId, name: 'Apoio do círculo', purpose: 'Dar apoio' }] },
    }, room.meeting.version);
    const path = f.base + '/proposals/' + output.target.id;
    await f.panelCommand(f.facilitator, 'process', { action: 'start', proposalId: output.target.id, revision: 1 });
    for (let step = 0; step < 4; step++) await f.panelCommand(f.facilitator, 'process', { action: 'advance', proposalId: output.target.id, revision: 1, confirmed: true });
    const ready = await f.call(f.scribe, 'GET', path), key = randomUUID();
    const body = { meetingVersion: ready.proposal.consentMeetingVersion, revision: 1, confirmed: true, reason: 'Sem objeções válidas pendentes' };
    const first = await f.raw(f.scribe, 'POST', path + '/actions/meeting-consent', body, ready.proposal.version, key);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().data.proposal.state, 'DECIDED');
    assert.equal((await f.raw(f.scribe, 'POST', path + '/actions/meeting-consent', body, ready.proposal.version, key)).statusCode, 200);
    const rows = (await admin.query("SELECT event_id,recipient_id,channel FROM platform_deliveries WHERE organization_id=$1 AND resource_id=$2 AND event='ProposalDecided' ORDER BY recipient_id,channel", [f.base.split('/').at(-1), output.target.id])).rows;
    assert.ok(rows.some(row => row.recipient_id === f.facilitator.memberId));
    assert.ok(rows.every(row => row.recipient_id !== f.scribe.memberId && row.recipient_id !== f.guest.memberId));
    assert.equal(new Set(rows.map(row => row.event_id)).size, 1);
    for (const memberId of new Set(rows.map(row => row.recipient_id))) assert.deepEqual(rows.filter(row => row.recipient_id === memberId).map(row => row.channel), ['EMAIL','IN_APP']);
    const model = await f.call(f.owner,'GET',f.base+'/governance-model');
    const roleId = model.bindings.find((binding:any) => binding.functionCode === 'FACILITATOR').roleId;
    const occupancy = (await admin.query('SELECT id,version FROM occupancies WHERE organization_id=$1 AND role_id=$2 AND member_id=$3',[f.base.split('/').at(-1),roleId,f.facilitator.memberId])).rows[0];
    await f.call(f.owner,'POST',f.base+'/governance-model/occupancies/OCCUPANCY/'+occupancy.id+'/end',{},occupancy.version);
    const removed = (await admin.query("SELECT channel FROM platform_deliveries WHERE organization_id=$1 AND recipient_id=$2 AND resource_id=$3 AND event='RoleUnassigned' ORDER BY channel",[f.base.split('/').at(-1),f.facilitator.memberId,roleId])).rows;
    assert.deepEqual(removed.map(row => row.channel),['EMAIL','IN_APP']);
  } finally { await app.close(); await admin.end(); }
});

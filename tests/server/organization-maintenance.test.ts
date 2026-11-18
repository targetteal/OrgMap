import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../../server/src/app.js';
import { pool } from '../../server/src/db.js';

if (!/^\/orgmap_integration_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL ?? 'postgres://invalid/orgmap').pathname)) throw Error('EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED');
after(async () => { await pool.end(); });
test('maintenance authority requires restricted real login, closed target and current persisted lease/fence', async () => {
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const prefix = process.env.INTEGRATION_TEST_ROLE_PREFIX;
  assert.match(prefix ?? '', /^orgmap_it_[a-f0-9]{32}_$/);
  const role = prefix + randomUUID().replaceAll('-', '').slice(0, 16), password = randomUUID();
  let operator: pg.Pool | undefined, roleCreated = false;
  const origin = 'http://maintenance.localhost:5273'; process.env.ALLOWED_ORIGINS = origin;
  const app = await buildApp([], { migrationScope: 'foundation' });
  try {
    const registration = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { origin }, payload: { email: `maintenance-${randomUUID()}@example.test`, password: `Synthetic-${randomUUID()}`, displayName: 'Maintenance fixture' } });
    assert.equal(registration.statusCode, 201, registration.body);
    const account = registration.json().data, cookie = `orgmap_session=${registration.cookies.find(value => value.name === 'orgmap_session')!.value}`;
    const orgs: string[] = [];
    for (const name of ['A maintenance target', 'B preserved']) {
      const result = await app.inject({ method: 'POST', url: '/api/v1/organizations', headers: { origin, cookie, 'x-csrf-token': account.csrfToken, 'idempotency-key': randomUUID() }, payload: { name } });
      assert.equal(result.statusCode, 201, result.body); orgs.push(result.json().data.organization.id);
    }
    await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`); roleCreated = true;
    await admin.query(`GRANT orgmap_lifecycle_maintenance TO "${role}"`);
    const url = new URL(process.env.DATABASE_URL!); url.username = role; url.password = password;
    operator = new pg.Pool({ connectionString: url.href });
    const jobId = randomUUID(), token = randomUUID(), args = [orgs[0], jobId, '2', token];
    // Authority-predicate fixture only: the migrator supplies a persisted lease.
    // Claim/drain production is proved separately through the actual 912/915 APIs.
    await admin.query(`INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence,state,ledger_state,ledger_authority_id,ledger_record_sha256,lease_token,lease_until,lease_fence) VALUES($1,$2,$3,$4,$5,2,2,'RUNNING','CONFIRMED',$6,$5,$7,clock_timestamp()+interval '1 minute',2)`, [orgs[0], jobId, account.account.id, randomUUID(), 'a'.repeat(64), randomUUID(), token]);
    const invoke = (client: pg.Pool, values = args) => client.query('SELECT orgmap_assert_deletion_maintenance($1,$2,$3,$4)', values);
    await assert.rejects(invoke(pool), /permission denied/);
    await assert.rejects(invoke(admin), /AUTHORITY_REQUIRED/);
    await assert.rejects(invoke(operator), /LEASE_INVALID/); // ACTIVE is never a purge target.
    await admin.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1", [orgs[0]]);
    await invoke(operator);
    await assert.rejects(invoke(operator, [orgs[1], jobId, '2', token]), /LEASE_INVALID/);
    await assert.rejects(invoke(operator, [orgs[0], jobId, '3', token]), /LEASE_INVALID/);
    await assert.rejects(invoke(operator, [orgs[0], jobId, '2', randomUUID()]), /LEASE_INVALID/);
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query("SELECT set_config('orgmap.deletion_organization_id',$1,true),set_config('orgmap.deletion_job_id',$2,true),set_config('orgmap.deletion_fence','2',true),set_config('orgmap.deletion_lease_token',$3,true)", [orgs[0], jobId, token]);
      assert.equal((await connection.query('SELECT orgmap_deletion_maintenance_row_allowed($1) AS allowed', [orgs[0]])).rows[0].allowed, false);
    } finally { await connection.query('ROLLBACK'); connection.release(); }
    await assert.rejects(operator.query('DELETE FROM organization_deletion_jobs WHERE id=$1', [jobId]), /permission denied/);
    await admin.query("UPDATE organization_deletion_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [jobId]);
    await assert.rejects(invoke(operator), /LEASE_INVALID/);
    assert.equal((await admin.query("SELECT state FROM organization_lifecycle WHERE organization_id=$1", [orgs[1]])).rows[0].state, 'ACTIVE');
  } finally {
    await app.close(); await operator?.end();
    if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
    await admin.end();
  }
});

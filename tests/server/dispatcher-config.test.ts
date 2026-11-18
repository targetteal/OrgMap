import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { stat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { configureLocalDispatcher } from '../../server/src/dispatcher-config.js';
import { PostgresScopeDispatch } from '../../server/modules/platform/dispatcher.js';

const adminUrl = process.env.DISPATCH_ADMIN_URL!;
const localRole = process.env.DISPATCH_TEST_ROLE!;
const credentialFile = process.env.DISPATCH_TEST_FILE!;

test('requires the dispatcher group before provisioning', {
  skip: process.env.DISPATCH_PHASE !== 'groupAbsent',
}, async () => {
  await assert.rejects(
    configureLocalDispatcher({ adminUrl, file: credentialFile, role: localRole }),
    /MIGRATION_432_REQUIRED/,
  );
});

test('requires migration 432 overloads before creating a login', {
  skip: process.env.DISPATCH_PHASE !== 'pre432',
}, async () => {
  await assert.rejects(
    configureLocalDispatcher({ adminUrl, file: credentialFile, role: localRole }),
    /MIGRATION_432_REQUIRED/,
  );
  const admin = new pg.Pool({ connectionString: adminUrl });
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [localRole])).rowCount, 0);
  } finally { await admin.end(); }
});

test('provisions a restricted local dispatcher credential', {
  skip: process.env.DISPATCH_PHASE !== 'post432',
}, async () => {
  const result = await configureLocalDispatcher({ adminUrl, file: credentialFile, role: localRole });
  assert.equal(result.role, localRole);
  const metadata = await stat(credentialFile);
  assert.equal(metadata.mode & 0o777, 0o600);
  const contents = await readFile(credentialFile, 'utf8');
  assert.match(contents, /^PLATFORM_DISPATCH_DATABASE_URL=postgres(?:ql)?:\/\//);
  const dispatchUrl = contents.trim().slice('PLATFORM_DISPATCH_DATABASE_URL='.length);
  assert.ok(dispatchUrl.length > 0);
  execFileSync('rtk', ['proxy', 'git', 'check-ignore', '-q', credentialFile], { stdio: 'ignore' });

  const dispatchPool = new pg.Pool({ connectionString: dispatchUrl });
  const admin = new pg.Pool({ connectionString: adminUrl });
  try {
    const roleState = (await admin.query(
      'SELECT r.rolcanlogin,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication, pg_has_role(r.oid, g.oid, \'MEMBER\') AS in_group FROM pg_roles r CROSS JOIN pg_roles g WHERE r.rolname=$1 AND g.rolname=\'orgmap_platform_dispatcher\'',
      [localRole],
    )).rows[0];
    assert.deepEqual(roleState, { rolcanlogin: true, rolsuper: false, rolbypassrls: false,
      rolcreatedb: false, rolcreaterole: false, rolreplication: false, in_group: true });
    const relations = (await admin.query(
      "SELECT format('%I.%I',n.nspname,c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')",
    )).rows;
    for (const { name } of relations)
      assert.equal((await dispatchPool.query('SELECT has_table_privilege(current_user,$1,\'SELECT\') AS allowed', [name])).rows[0].allowed, false);

    const port = new PostgresScopeDispatch(dispatchPool);
    assert.equal(await port.claim([]), null);
    const fake = { organizationId: '00000000-0000-0000-0000-000000000001',
      memberId: '00000000-0000-0000-0000-000000000002', token: '00000000-0000-0000-0000-000000000003' };
    assert.equal(await port.release(fake, false, []), false);
    assert.equal(await port.heartbeat(fake), false);

    const appUrl = process.env.DISPATCH_APP_URL!;
    const appPool = new pg.Pool({ connectionString: appUrl });
    const appDispatch = new PostgresScopeDispatch(appPool);
    await assert.rejects(appDispatch.claim([]), /DEDICATED_DISPATCH_CREDENTIAL_REQUIRED/);
    const migratorPool = new pg.Pool({ connectionString: adminUrl });
    const actor = (await migratorPool.query(
      'SELECT r.rolsuper OR r.rolbypassrls AS privileged FROM pg_roles r WHERE r.rolname=current_user',
    )).rows[0].privileged;
    assert.equal(actor, true, 'migration credential should exercise the privileged-actor rejection');
    const migratorDispatch = new PostgresScopeDispatch(migratorPool);
    await assert.rejects(migratorDispatch.claim([]), /DEDICATED_DISPATCH_CREDENTIAL_REQUIRED/);
    await appPool.end();
    await migratorPool.end();
  } finally {
    await dispatchPool.end();
    await admin.end();
  }
});

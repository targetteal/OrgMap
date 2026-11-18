import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = process.env.MIGRATION_DATABASE_URL ??
  'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap';
const runtimeSource = process.env.DATABASE_URL ??
  'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap';
const baseUrl = new URL(source);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname) ||
    !['postgres:', 'postgresql:'].includes(baseUrl.protocol))
  throw Error('LOCAL_DATABASE_REQUIRED');

const suffix = randomBytes(8).toString('hex');
const database = 'orgmap_dispatch_test_' + suffix;
const role = 'orgmap_platform_dispatcher_local_' + suffix;
const databaseUrl = new URL(source), appUrl = new URL(runtimeSource);
databaseUrl.pathname = appUrl.pathname = '/' + database;
const admin = new pg.Pool({ connectionString: source });
const credentialFile = resolve('.orgmap', 'dispatcher-test-' + suffix + '.env');
const directory = resolve('.orgmap');
await mkdir(directory, { recursive: true, mode: 0o700 });

async function run(args: string[], extra: NodeJS.ProcessEnv = {}) {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
      stdio: 'inherit',
      env: { ...process.env, MIGRATION_DATABASE_URL: databaseUrl.href,
        DATABASE_URL: appUrl.href, ...extra },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(Error('DISPATCH_TEST_FAILED')));
  });
}

try {
  await admin.query('CREATE DATABASE "' + database + '"');
  await run(['--test', 'tests/server/dispatcher-config.test.ts'], {
    DISPATCH_PHASE: 'groupAbsent', DISPATCH_ADMIN_URL: databaseUrl.href,
    DISPATCH_APP_URL: appUrl.href, DISPATCH_TEST_ROLE: role, DISPATCH_TEST_FILE: credentialFile,
  });
  await run(['server/src/migrate.ts'], { MIGRATION_MAX_PREFIX: '429' });
  await run(['--test', 'tests/server/dispatcher-config.test.ts'], {
    DISPATCH_PHASE: 'pre432', DISPATCH_ADMIN_URL: databaseUrl.href,
    DISPATCH_APP_URL: appUrl.href, DISPATCH_TEST_ROLE: role, DISPATCH_TEST_FILE: credentialFile,
  });
  await run(['server/src/migrate.ts']);
  await run(['--test', 'tests/server/dispatcher-config.test.ts'], {
    DISPATCH_PHASE: 'post432', DISPATCH_ADMIN_URL: databaseUrl.href,
    DISPATCH_APP_URL: appUrl.href, DISPATCH_TEST_ROLE: role, DISPATCH_TEST_FILE: credentialFile,
  });
  console.log('dispatcher local IAM integration checks passed');
} finally {
  await rm(credentialFile, { force: true });
  await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
  await admin.query('DROP ROLE IF EXISTS "' + role + '"');
  await admin.end();
}

import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const adminSource = process.env.MIGRATION_DATABASE_URL ??
  'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap';
const runtimeSource = process.env.DATABASE_URL ??
  'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap';
const adminUrl = new URL(adminSource);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname) ||
    !['postgres:', 'postgresql:'].includes(adminUrl.protocol))
  throw Error('LOCAL_DATABASE_REQUIRED');

const database = `orgmap_foundation_collective_${randomBytes(8).toString('hex')}`;
const migrationUrl = new URL(adminSource);
const runtimeUrl = new URL(runtimeSource);
migrationUrl.pathname = runtimeUrl.pathname = '/' + database;
const admin = new pg.Pool({ connectionString: adminSource });

async function run(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: migrationUrl.href,
        MIGRATION_MAX_PREFIX: '999',
        DATABASE_URL: runtimeUrl.href,
      },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error('FOUNDATION_COLLECTIVE_TEST_FAILED')));
  });
}

try {
  await admin.query('CREATE DATABASE "' + database + '"');
  await run(['server/src/migrate.ts']);
  await run(['--test', 'tests/server/foundation-collective.test.ts']);
  console.log('foundation collective HTTP integration passed; ephemeral database removed next');
} finally {
  try {
    await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
  } finally {
    await admin.end();
  }
}

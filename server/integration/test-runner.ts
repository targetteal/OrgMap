import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const migrationSource = process.env.MIGRATION_DATABASE_URL ?? 'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap';
const runtimeSource = process.env.DATABASE_URL ?? 'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap';
const migration = new URL(migrationSource), runtime = new URL(runtimeSource);
for (const source of [migration, runtime]) {
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname))
    throw Error('LOCAL_DATABASE_REQUIRED');
}
if (migration.host !== runtime.host || migration.pathname !== runtime.pathname)
  throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
const runId = randomUUID().replaceAll('-', '');
const database = `orgmap_integration_${runId}`;
// Roles are cluster-wide, unlike the fixture database. Give every role created
// by the child a run-owned namespace so interruption can clean only that run.
const rolePrefix = `orgmap_it_${runId}_`;
const admin = new pg.Pool({ connectionString: migrationSource });
migration.pathname = `/${database}`;
runtime.pathname = `/${database}`;
let interrupted = false, activeChild: ChildProcess | undefined;
let escalation: ReturnType<typeof setTimeout> | undefined;
function liveGroupMembers(child: ChildProcess) {
  return execFileSync('ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8' }).trim().split('\n').flatMap(line => {
    const [pid, pgid, state] = line.trim().split(/\s+/);
    return Number(pgid) === child.pid && !state.startsWith('Z') ? [Number(pid)] : [];
  });
}
function signalChild(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return;
    // Darwin can return EPERM for an exited process group while its zombie
    // leader is being reaped. Verify there is no running group member before
    // treating this as an already completed shutdown.
    if (code === 'EPERM' && process.platform === 'darwin') {
      if (!liveGroupMembers(child).length) return;
    }
    throw error;
  }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  interrupted = true;
  if (activeChild) {
    const child = activeChild;
    signalChild(child, signal);
    escalation ??= setTimeout(() => signalChild(child, 'SIGKILL'), 5_000);
  }
});
function checkInterrupted() { if (interrupted) throw new Error('INTEGRATION_TEST_INTERRUPTED'); }
async function run(args: string[]) {
  checkInterrupted();
  const env: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: migration.href, DATABASE_URL: runtime.href, MIGRATION_MAX_PREFIX: '999', INTEGRATION_TEST_ROLE_PREFIX: rolePrefix };
  delete env.MIGRATION_SCOPE;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
      cwd: root, stdio: 'inherit', detached: process.platform !== 'win32',
      env,
    });
    activeChild = child;
    child.once('error', reject);
    child.once('close', async code => {
      if (escalation) { clearTimeout(escalation); escalation = undefined; }
      // The test coordinator may exit before its subprocesses. Dispose of the
      // entire group before dropping its database or cluster-level roles.
      try {
        if (interrupted && process.platform !== 'win32') {
          const deadline = Date.now() + 1_000;
          while (liveGroupMembers(child).length && Date.now() < deadline) await delay(25);
          if (liveGroupMembers(child).length) signalChild(child, 'SIGKILL');
        }
        activeChild = undefined;
        code === 0 && !interrupted ? resolve() : reject(new Error(interrupted ? 'INTEGRATION_TEST_INTERRUPTED' : `Integration command exited ${code}`));
      } catch (error) { activeChild = undefined; reject(error); }
    });
  });
}
let created = false;
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  console.log(`Integration fixture database: ${database}`);
  checkInterrupted();
  await run(['server/src/migrate.ts']);
  const arguments_ = process.argv.slice(2);
  const namePattern = arguments_.filter(value => value.startsWith('--test-name-pattern='));
  const selectedFiles = arguments_.filter(value => value.startsWith('--test-file=')).map(value => value.slice('--test-file='.length));
  if (selectedFiles.some(file => !/^tests\/server\/[a-z0-9.-]+\.test\.ts$/.test(file))) throw Error('INVALID_INTEGRATION_TEST_FILE');
  await run(['--test', '--test-concurrency=1', ...namePattern, ...(selectedFiles.length ? selectedFiles : ['tests/server/integration.test.ts'])]);
} finally {
  try {
    if (created) await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    const roles = await admin.query<{ rolname: string }>('SELECT rolname FROM pg_roles WHERE starts_with(rolname,$1)', [rolePrefix]);
    for (const { rolname } of roles.rows) {
      if (!new RegExp(`^${rolePrefix}[a-f0-9]{16}$`).test(rolname)) throw Error('UNEXPECTED_FIXTURE_ROLE_NAME');
      await admin.query(`DROP ROLE "${rolname}"`);
    }
  } finally { await admin.end(); }
}

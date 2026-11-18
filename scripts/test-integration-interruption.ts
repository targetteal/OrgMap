import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import pg from 'pg';

// Run explicitly against a frozen fixture; never send a signal to a preexisting process.
const root = resolve(process.argv[2] ?? '.');
const source = process.env.MIGRATION_DATABASE_URL ?? 'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap';
const url = new URL(source);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
const admin = new pg.Pool({ connectionString: source });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };
function descendants(parent: number) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([parent]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [pid, ppid] of rows) if (owned.has(ppid) && !owned.has(pid)) { owned.add(pid); changed = true; }
  }
  return rows.filter(([pid]) => pid !== parent && owned.has(pid));
}
async function probe(signal: 'SIGINT' | 'SIGTERM', phase: 'startup' | 'role') {
  let output = '', exited = false, database = '', pids: number[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/integration/test-runner.ts', '--test-name-pattern=Guest scoped worker rechecks organization email master before delivery'], {
    cwd: root, env: { ...process.env, MIGRATION_DATABASE_URL: source }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const completion = new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', code => { exited = true; resolveExit(code); });
  });
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && !exited) {
      database = output.match(/Integration fixture database: (orgmap_integration_[a-f0-9]{32})/)?.[1] ?? '';
      if (database && phase === 'startup') break;
      if (database && phase === 'role') {
        const prefix = database.replace('orgmap_integration_', 'orgmap_it_') + '_';
        if ((await admin.query('SELECT 1 FROM pg_roles WHERE starts_with(rolname,$1)', [prefix])).rowCount) break;
      }
      await delay(20);
    }
    assert.ok(database && !exited, `Fixture did not reach ${phase}: ${output.slice(-1500)}`);
    if (phase === 'role') {
      assert.ok((await admin.query('SELECT 1 FROM pg_roles WHERE starts_with(rolname,$1)', [database.replace('orgmap_integration_', 'orgmap_it_') + '_'])).rowCount, 'Role phase was not reached');
    }
    pids = descendants(child.pid!).map(([pid]) => pid);
    assert.ok(pids.length > 0 || phase === 'startup', 'No subprocess was observed');
    child.kill(signal);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const code = await Promise.race([completion, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error('INTERRUPTION_TIMEOUT')), 12_000); })]).finally(() => clearTimeout(timeout));
    assert.notEqual(code, 0);
    assert.ok(output.includes('INTEGRATION_TEST_INTERRUPTED'), output.slice(-1500));
    // Killing a process group is asynchronous; allow the OS to reap descendants.
    const reapDeadline = Date.now() + 3000;
    while (pids.some(alive) && Date.now() < reapDeadline) await delay(25);
    assert.deepEqual(pids.filter(alive), [], 'Owned subprocess remains alive');
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
    assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE starts_with(rolname,$1)', [database.replace('orgmap_integration_', 'orgmap_it_') + '_'])).rowCount, 0);
    console.log(JSON.stringify({ signal, phase, database, observedSubprocesses: pids.length, exitCode: code, databaseRemoved: true, rolesRemoved: true }));
  } finally {
    if (!exited) {
      child.kill('SIGTERM');
      // A failed observation deadline must not orphan a still-cleaning fixture.
      // Wait for the existing coordinator to reap its group and remove its DB/roles.
      await completion;
    }
  }
}
try {
  await probe('SIGINT', 'startup');
  await probe('SIGINT', 'role');
  await probe('SIGTERM', 'role');
} finally { await admin.end(); }

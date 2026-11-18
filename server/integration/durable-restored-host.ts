/** Operator-only supervisor for an already bound retained restore; never deletes host resources. */
import pg from 'pg';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSmtpSink } from '../src/smtp.js';
import { configureLocalDispatcher } from '../src/dispatcher-config.js';
import { configureIamMail } from '../iam-mail/config.js';
import { OrganizationLedger } from '../ops/organization-ledger.js';
import { acquireOrganizationHostLease, listHostWriters, reapStoppedHostWriters } from '../ops/organization-host-lease.js';
import { assertHostStorageBindingLocked } from '../ops/organization-storage-binding.js';

const execute = promisify(execFile);
const root = resolve('.');
function option(name: string) {
  return process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const expectedRef = option('expected-ref');
if (!expectedRef || !/^[a-f0-9]{40}$/.test(expectedRef)) throw Error('FULL_EXPECTED_REF_REQUIRED');
const head = (await execute('rtk', ['proxy', 'git', 'rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const status = async () => (await execute('rtk', ['proxy', 'git', 'status', '--porcelain', '--untracked-files=all'], { cwd: root })).stdout.trim();
const dirty = await status();
if (head !== expectedRef || dirty) throw Error('CLEAN_FROZEN_CANDIDATE_REQUIRED');
const port = (name: string, fallback: number) => {
  const number = Number(option(name) ?? fallback);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) throw Error('INVALID_LOCAL_PORT');
  return number;
};
const apiPort = port('api-port', 3320), webPort = port('web-port', 5200);
if (apiPort === webPort) throw Error('DISTINCT_PORTS_REQUIRED');
const suffix = randomBytes(8).toString('hex');
let database = '';
const role = `orgmap_platform_dispatcher_local_${suffix}`;
const iamRole = `orgmap_iam_mail_local_${suffix}`;
const acceptanceRole = `orgmap_lifecycle_acceptance_local_${suffix}`;
const directory = resolve('.orgmap/candidates', `${head.slice(0, 12)}-${suffix}`);
await mkdir(directory, { recursive: true, mode: 0o700 });
const hostname=option('hostname')??'orgmap.localhost';
if(!['orgmap.localhost','core.orgmap.localhost','qa.orgmap.localhost'].includes(hostname))throw Error('LOCAL_CANDIDATE_HOST_REQUIRED');
// A distinct host keeps the core acceptance cookie separate from an existing
// user session on orgmap.localhost, even when the two sites use different ports.
const origin = `http://${hostname}:${webPort}`;
const migrationSource = process.env.MIGRATION_DATABASE_URL ?? 'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap';
const runtimeSource = process.env.DATABASE_URL ?? 'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap';
const migration = new URL(migrationSource), runtime = new URL(runtimeSource);
for (const url of [migration, runtime]) {
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error('LOCAL_DATABASE_REQUIRED');
}
if (migration.host !== runtime.host || migration.pathname !== runtime.pathname)
  throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
const admin = new pg.Pool({ connectionString: migrationSource });
const children: ChildProcess[] = [];
const logs: ReturnType<typeof createWriteStream>[] = [];
let closing = false;
let closePromise: Promise<void> | undefined;
let startupOperation: Promise<unknown> | undefined;
let smtp: Awaited<ReturnType<typeof startSmtpSink>> | undefined;
let ledger:OrganizationLedger | undefined, hostLease:Awaited<ReturnType<typeof acquireOrganizationHostLease>> | undefined;
const manifest: Record<string, unknown> = {
  format: 'orgmap-durable-restored-host-v1', head, checkout: root, cleanBefore: true,
  database, dispatcherRole: role, iamMailRole: iamRole, acceptanceRole,
  integrationConfiguration: resolve(directory, 'integration.json'), origin, apiPort, webPort,
  startedAt: new Date().toISOString(), productComplete: false, status: 'PREPARING',
};
async function save() {
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
}
async function close() {
  if (closePromise) return closePromise;
  closing = true;
  closePromise = (async () => {
  for (const child of [...children].reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  // Wait for any role configuration or SMTP startup already in flight before
  // releasing the lease and stopping this supervisor's processes.
  await startupOperation?.catch(() => {});
  await Promise.all(children.map(child => new Promise<void>((done,reject) => {
    if (child.exitCode !== null || child.signalCode !== null) { done(); return; }
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const deadline = setTimeout(() => reject(Error('CANDIDATE_CHILD_DID_NOT_EXIT')),10000);
    const exited = () => { clearTimeout(killTimer); clearTimeout(deadline); done(); };
    child.once('exit',exited);
    if (child.exitCode !== null || child.signalCode !== null) exited();
  })));
  if (smtp) await new Promise<void>(done => smtp!.close(() => done()));
  if (ledger && hostLease) { await reapStoppedHostWriters(ledger,hostLease,children.flatMap(c=>c.pid?[c.pid]:[])); await hostLease.release(); hostLease=undefined; }
  // Durable host: database, roles, and storage are retained even after failure.
  await admin.end();
  for (const log of logs) log.end();
  manifest.stoppedAt = new Date().toISOString();
  manifest.resourcesRetained = true;
  manifest.status = manifest.status === 'FAILED' ? 'FAILED' : 'STOPPED';
  await save();
  })();
  return closePromise;
}
async function startupStage<T>(operation: () => Promise<T>): Promise<T> {
  if (closing) throw Error('CANDIDATE_INTERRUPTED');
  const current = operation();
  startupOperation = current;
  try {
    const value = await current;
    if (closing) throw Error('CANDIDATE_INTERRUPTED');
    return value;
  } finally {
    if (startupOperation === current) startupOperation = undefined;
  }
}
function child(name: string, args: string[], env: NodeJS.ProcessEnv) {
  const log = createWriteStream(resolve(directory, `${name}.log`), { mode: 0o600 });
  logs.push(log);
  const process = spawn(globalThis.process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout?.pipe(log, { end: false });
  process.stderr?.pipe(log, { end: false });
  children.push(process);
  process.once('error', () => { manifest.status = 'FAILED'; void close().then(() => { globalThis.process.exitCode = 1; }); });
  return process;
}
async function finish(process: ChildProcess) {
  await new Promise<void>((done, reject) => {
    process.once('error', reject);
    process.once('exit', code => code === 0 ? done() : reject(Error('CANDIDATE_COMMAND_FAILED')));
  });
}
async function ready(url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (closing) throw Error('CANDIDATE_INTERRUPTED');
    if (children.some(child => child.exitCode !== null && child.exitCode !== 0)) throw Error('CANDIDATE_PROCESS_FAILED');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(done => setTimeout(done, 200));
  }
  throw Error('CANDIDATE_READINESS_TIMEOUT');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void close().then(() => { process.exitCode = 0; }); });
try {
  await save();
  await startupStage(async () => {
    const ledgerDirectory=process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY;
    const configuration=process.env.ORGMAP_INTEGRATION_CONFIG;
    if(!ledgerDirectory || !configuration) throw Error('BOUND_HOST_CONFIGURATION_REQUIRED');
    database=decodeURIComponent(migration.pathname.slice(1));
    if(!/^orgmap_(?:restore|fresh)_[a-f0-9]{32}$/.test(database)) throw Error('BOUND_HOST_DATABASE_REQUIRED');
    ledger=await OrganizationLedger.open(ledgerDirectory);
    hostLease=await acquireOrganizationHostLease(ledger);
    const c=await admin.connect();
    try { await ledger.withExclusive(locked=>assertHostStorageBindingLocked(ledger!,hostLease!,c,locked)); }
    finally { c.release(); }
    manifest.database=database;
  });
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: runtime.href, PORT: String(apiPort), ALLOWED_ORIGINS: origin, ORGMAP_LIFECYCLE_LEDGER_DIRECTORY: ledger!.directory, ORGMAP_HOST_LEASE_TOKEN: hostLease!.token };
  delete baseEnv.MIGRATION_DATABASE_URL;
  delete baseEnv.MIGRATION_SCOPE;
  delete baseEnv.MIGRATION_MAX_PREFIX;
  delete baseEnv.ORGMAP_LIFECYCLE_ACCEPTANCE_DATABASE_URL;
  const acceptancePassword = randomBytes(32).toString('hex');
  // Provision transactionally: only a committed CREATE is ours to clean up.
  // The role name and password are generated locally from restricted alphabets.
  await startupStage(async()=>{
    const c=await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(`CREATE ROLE "${acceptanceRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${acceptancePassword}'`);
      await c.query(`GRANT orgmap_app, orgmap_lifecycle_acceptance TO "${acceptanceRole}"`);
      await c.query('COMMIT');
    } catch(error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  });
  const acceptanceUrl = new URL(runtime.href);acceptanceUrl.username=acceptanceRole;acceptanceUrl.password=acceptancePassword;
  if ((await startupStage(() => admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]))).rowCount) throw Error('DISPATCH_ROLE_COLLISION');
  // Each boot provisions a separate role; its credentials remain private and
  // the role is retained for operator review after shutdown.
  const dispatchFile = resolve(directory, 'dispatcher.env');
  await startupStage(() => configureLocalDispatcher({ adminUrl: migration.href, file: dispatchFile, role }));
  const dispatchUrl = (await startupStage(() => readFile(dispatchFile, 'utf8'))).trim().slice('PLATFORM_DISPATCH_DATABASE_URL='.length);
  if ((await startupStage(() => admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [iamRole]))).rowCount) throw Error('IAM_MAIL_ROLE_COLLISION');
  const iamFile = resolve(directory, 'iam-mail.env');
  await startupStage(() => configureIamMail({ adminUrl: migration.href, file: iamFile, role: iamRole }));
  // This local host deliberately uses an SMTP sink, not external delivery.
  await startupStage(async () => { smtp = await startSmtpSink({ port: 0, directory: resolve(directory, 'smtp') }); });
  const smtpPort = (smtp!.address() as { port: number }).port;
  const configuration = resolve(process.env.ORGMAP_INTEGRATION_CONFIG!);
  manifest.integrationConfiguration = configuration;
  const env: NodeJS.ProcessEnv = { ...baseEnv, ORGMAP_INTEGRATION_CONFIG: configuration, SMTP_PORT: String(smtpPort), PLATFORM_DISPATCH_DATABASE_URL: dispatchUrl, IAM_MAIL_ENV_FILE: iamFile };
  delete env.IAM_MAIL_DISPATCH_DATABASE_URL;
  await startupStage(() => finish(child('build', ['node_modules/typescript/bin/tsc', '--noEmit'], env)));
  await startupStage(() => finish(child('web-build', ['node_modules/vite/bin/vite.js', 'build', 'web', '--config', resolve('web/vite.config.ts')], env)));
  const viteConfiguration = resolve(directory, 'vite.config.mjs');
  await startupStage(() => writeFile(viteConfiguration, 'export default ' + JSON.stringify({
    root: resolve('web'), build: { outDir: resolve('web/dist') },
    preview: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true, changeOrigin: false },
      '^/public(?:/|$)': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    } },
  }) + ';\n', { mode: 0o600 }));
  const api = child('api', ['--import', 'tsx', 'server/src/main.ts'], {...env,ORGMAP_LIFECYCLE_ACCEPTANCE_DATABASE_URL:acceptanceUrl.href});
  await startupStage(() => ready(`http://127.0.0.1:${apiPort}/api/ready`));
  const dispatcher = child('dispatcher', ['--import', 'tsx', 'server/modules/platform/worker-cli.ts', 'server/modules/platform/composition.ts'], env);
  const iamMail = child('iam-mail', ['--import', 'tsx', 'scripts/iam-mail.ts'], env);
  const web = child('web', ['node_modules/vite/bin/vite.js', 'preview', '--config', viteConfiguration], env);
  await startupStage(async()=>{const expected=[api.pid,dispatcher.pid,iamMail.pid];if(expected.some(pid=>!pid))throw Error('CANDIDATE_WRITER_PID_REQUIRED');for(let attempt=0;attempt<100;attempt++){if(closing || [api,dispatcher,iamMail].some(c=>c.exitCode!==null||c.signalCode!==null))throw Error('CANDIDATE_PROCESS_FAILED');const writers=await listHostWriters(ledger!,hostLease!);if(expected.every(pid=>writers.some(w=>w.pid===pid)))return;await new Promise(done=>setTimeout(done,200));}throw Error('CANDIDATE_WRITERS_NOT_REGISTERED');});
  await startupStage(() => ready(`http://127.0.0.1:${webPort}`));
  manifest.status = 'READY_FOR_AUDIT';
  manifest.processes = { launcher: process.pid, api: api.pid, dispatcher: dispatcher.pid, iamMail: iamMail.pid, web: web.pid };
  manifest.smtpPort = smtpPort;
  manifest.mailDelivery = 'Autonomous IAM daemon and local SMTP started; positive delivery must be proved separately by UI/API action and sink receipt';
  manifest.managedWriters = 'API, dispatcher and IAM mail registered under supervisor lease; production deployment remains unverified';
  manifest.readyAt = new Date().toISOString();
  const finalDirty = await startupStage(status);
  const finalHead = (await startupStage(() => execute('rtk', ['proxy', 'git', 'rev-parse', 'HEAD'], { cwd: root }))).stdout.trim();
  if (finalDirty || finalHead !== head) throw Error('CANDIDATE_CHANGED_DURING_STARTUP');
  await startupStage(() => save());
  console.log(JSON.stringify({ origin, apiPort, manifest: resolve(directory, 'manifest.json'), head, status: manifest.status }));
  for (const running of [api, dispatcher, iamMail, web]) running.once('exit', () => {
    if (!closing) { manifest.status = 'FAILED'; void close().then(() => { process.exitCode = 1; }); }
  });
} catch (error) {
  // Persist only a bounded error code, never connection strings or credentials.
  const code = error instanceof Error ? error.message : '';
  manifest.failureCode = /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'STARTUP_FAILED';
  manifest.status = 'FAILED';
  await close();
  throw Error('CANDIDATE_START_FAILED_SEE_PRIVATE_LOCAL_LOGS');
}

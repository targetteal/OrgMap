/** Persistent local development supervisor. Never deletes the database or storage. */
import pg from 'pg';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSmtpSink } from '../src/smtp.js';
import { configureLocalDispatcher } from '../src/dispatcher-config.js';
import { configureIamMail } from '../iam-mail/config.js';
import { OrganizationLedger } from '../ops/organization-ledger.js';
import { acquireOrganizationHostLease, provisionFreshHostBinding, recoverAbandonedHostLease, withStoppedHostWriters, listHostWriters, reapStoppedHostWriters } from '../ops/organization-host-lease.js';
import { assertHostStorageBindingLocked, installHostStorageBinding } from '../ops/organization-storage-binding.js';

const execute = promisify(execFile);
const root = resolve('.');
function option(name: string) {
  return process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const head = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const port = (name: string, fallback: number) => {
  const number = Number(option(name) ?? fallback);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) throw Error('INVALID_LOCAL_PORT');
  return number;
};
const apiPort = port('api-port', 3330), webPort = port('web-port', 5230);
if (apiPort === webPort) throw Error('DISTINCT_PORTS_REQUIRED');
const suffix = randomBytes(8).toString('hex');
let database = '';
const role = `orgmap_platform_dispatcher_local_${suffix}`;
const iamRole = `orgmap_iam_mail_local_${suffix}`;
const acceptanceRole = `orgmap_lifecycle_acceptance_local_${suffix}`;
const directory = resolve('.orgmap/local-dev');
await mkdir(directory, { recursive: true, mode: 0o700 });
const hostname=option('hostname')??'orgmap.localhost';
if(!['orgmap.localhost','core.orgmap.localhost','qa.orgmap.localhost'].includes(hostname))throw Error('LOCAL_CANDIDATE_HOST_REQUIRED');
// A distinct host keeps the core acceptance cookie separate from an existing
// user session on orgmap.localhost, even when the two sites use different ports.
const origin = `http://${hostname}:${webPort}`;
const migrationSource = 'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55433/orgmap';
const runtimeSource = 'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55433/orgmap';
const migration = new URL(migrationSource), runtime = new URL(runtimeSource);
for (const url of [migration, runtime]) {
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error('LOCAL_DATABASE_REQUIRED');
}
if (migration.host !== runtime.host || migration.pathname !== runtime.pathname)
  throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
const project = `orgmap-dev-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`;
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ORGMAP_') || ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'MIGRATION_SCOPE', 'MIGRATION_MAX_PREFIX', 'PLATFORM_BLOBS_DIRECTORY', 'IAM_MAIL_ENV_FILE', 'PLATFORM_DISPATCH_DATABASE_URL'].includes(key)) delete process.env[key];
}
process.env.COMPOSE_PROJECT_NAME = project;
process.env.COMPOSE_FILE = resolve('compose.local-dev.yaml');
await execute('docker', ['compose', '-p', project, '-f', resolve('compose.local-dev.yaml'), 'up', '-d', '--wait'], {cwd: root});
const admin = new pg.Pool({ connectionString: migrationSource });
async function acquireDevLease(ledger: OrganizationLedger) {
  try { return await acquireOrganizationHostLease(ledger); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'HOST_LEASE_HELD_OR_RECOVERY_REQUIRED') throw error;
    const owner = JSON.parse(await readFile(resolve(ledger.directory, '.host-lease/owner.json'), 'utf8')) as {token: string};
    // Canonical recovery refuses a live owner, live writers, another host or PID reuse.
    await recoverAbandonedHostLease(ledger, owner.token);
    return acquireOrganizationHostLease(ledger);
  }
}
const children: ChildProcess[] = [];
const logs: ReturnType<typeof createWriteStream>[] = [];
let closing = false;
let ownsManifest = false;
let closePromise: Promise<void> | undefined;
let startupOperation: Promise<unknown> | undefined;
let smtp: Awaited<ReturnType<typeof startSmtpSink>> | undefined;
let ledger:OrganizationLedger | undefined, hostLease:Awaited<ReturnType<typeof acquireOrganizationHostLease>> | undefined;
const manifest: Record<string, unknown> = {
  format: 'orgmap-local-development-v1', head, checkout: root,
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
  // The database and storage persist; the three per-run login roles are removed.
  for (const localRole of [role, iamRole, acceptanceRole]) {
    await admin.query(`DROP ROLE IF EXISTS "${localRole}"`);
  }
  await admin.end();
  for (const log of logs) log.end();
  manifest.stoppedAt = new Date().toISOString();
  manifest.resourcesRetained = true;
  manifest.status = manifest.status === 'FAILED' ? 'FAILED' : 'STOPPED';
  if (ownsManifest) await save();
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
  for (let attempt = 0; attempt < 600; attempt++) {
    if (closing) throw Error('CANDIDATE_INTERRUPTED');
    if (children.some(child => child.exitCode !== null && child.exitCode !== 0)) throw Error('CANDIDATE_PROCESS_FAILED');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(done => setTimeout(done, 200));
  }
  throw Error('CANDIDATE_READINESS_TIMEOUT');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void close().then(() => { process.exitCode = 0; }); });
try {
  await startupStage(async () => {
    const metadataPath = resolve(directory, 'host.json');
    const ledgerDirectory = resolve(directory, 'lifecycle-authority');
    const configuration = resolve(directory, 'integration.json');
    let existing: { database: string } | undefined;
    try { existing = JSON.parse(await readFile(metadataPath, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existing) {
      if (!/^orgmap_fresh_[a-f0-9]{32}$/.test(existing.database)) throw Error('INVALID_DEV_HOST_METADATA');
      database = existing.database;
      ledger = await OrganizationLedger.open(ledgerDirectory);
      hostLease = await acquireDevLease(ledger);
      migration.pathname = runtime.pathname = `/${database}`;
      const pool = new pg.Pool({connectionString: migration.href});
      process.env.ORGMAP_INTEGRATION_CONFIG = configuration;
      try { const c = await pool.connect(); try { await ledger.withExclusive(locked => assertHostStorageBindingLocked(ledger!,hostLease!,c,locked)); } finally { c.release(); } } finally { await pool.end(); }
      // Upgrade the retained development database only while the host lease is
      // held and every registered writer is stopped. The normal migrator checks
      // all recorded migration checksums before applying new SQL.
      await withStoppedHostWriters(ledger, hostLease, async () => {
        const migrationEnv: NodeJS.ProcessEnv = {...process.env, MIGRATION_DATABASE_URL: migration.href};
        delete migrationEnv.MIGRATION_SCOPE;
        delete migrationEnv.MIGRATION_MAX_PREFIX;
        await execute(process.execPath, ['--import', 'tsx', 'server/src/migrate.ts'], {cwd: root, env: migrationEnv});
      });
      manifest.migrationCheck = 'official-migrator-completed';
    } else {
      ledger = await OrganizationLedger.initialize(ledgerDirectory);
      hostLease = await acquireDevLease(ledger);
      const fresh = await provisionFreshHostBinding(ledger,hostLease,migrationSource);
      database = fresh.database;
      migration.pathname = runtime.pathname = `/${database}`;
      await writeFile(configuration, JSON.stringify({blobsDirectory: resolve(directory, 'blobs')}) + '\n', {mode: 0o600, flag: 'wx'});
      const pool = new pg.Pool({connectionString: migration.href});
      try { const c = await pool.connect(); try { await installHostStorageBinding(ledger,hostLease,c,configuration); } finally { c.release(); } } finally { await pool.end(); }
      await writeFile(metadataPath, JSON.stringify({database}) + '\n', {mode: 0o600, flag: 'wx'});
    }
    manifest.database = database;
    process.env.ORGMAP_INTEGRATION_CONFIG = configuration;
    ownsManifest = true;
    await save();
  });
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, COMPOSE_PROJECT_NAME: project, COMPOSE_FILE: resolve('compose.local-dev.yaml'), DATABASE_URL: runtime.href, PORT: String(apiPort), ALLOWED_ORIGINS: origin, ORGMAP_LIFECYCLE_LEDGER_DIRECTORY: ledger!.directory, ORGMAP_HOST_LEASE_TOKEN: hostLease!.token };
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
  // Each boot provisions a separate private role, removed after writers stop.
  const dispatchFile = resolve(directory, 'dispatcher.env');
  await startupStage(() => configureLocalDispatcher({ adminUrl: migration.href, file: dispatchFile, role }));
  const dispatchUrl = (await startupStage(() => readFile(dispatchFile, 'utf8'))).trim().slice('PLATFORM_DISPATCH_DATABASE_URL='.length);
  if ((await startupStage(() => admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [iamRole]))).rowCount) throw Error('IAM_MAIL_ROLE_COLLISION');
  const iamFile = resolve(directory, 'iam-mail.env');
  await startupStage(() => configureIamMail({ adminUrl: migration.href, file: iamFile, role: iamRole }));
  // This local host deliberately uses an SMTP sink, not external delivery.
  await startupStage(async () => { smtp = await startSmtpSink({ port: 0, directory: resolve(directory, 'smtp') }); });
  const smtpPort = (smtp!.address() as { port: number }).port;
  const configuration = resolve(directory, 'integration.json');
  await writeFile(configuration, JSON.stringify({blobsDirectory: resolve(directory, 'blobs'), smtp: {port: smtpPort}}) + '\n', {mode: 0o600});
  manifest.integrationConfiguration = configuration;
  const env: NodeJS.ProcessEnv = { ...baseEnv, ORGMAP_INTEGRATION_CONFIG: configuration, SMTP_PORT: String(smtpPort), PLATFORM_DISPATCH_DATABASE_URL: dispatchUrl, IAM_MAIL_ENV_FILE: iamFile };
  delete env.IAM_MAIL_DISPATCH_DATABASE_URL;
  const viteConfiguration = resolve(directory, 'vite.config.mjs');
  await startupStage(() => writeFile(viteConfiguration, 'export default ' + JSON.stringify({
    root: resolve('web'), server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true, changeOrigin: false },
      '^/public(?:/|$)': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    } },
  }) + ';\n', { mode: 0o600 }));
  const api = child('api', ['--import', 'tsx', 'server/src/main.ts'], {...env,ORGMAP_LIFECYCLE_ACCEPTANCE_DATABASE_URL:acceptanceUrl.href});
  await startupStage(() => ready(`http://127.0.0.1:${apiPort}/api/ready`));
  const dispatcher = child('dispatcher', ['--import', 'tsx', 'server/modules/platform/worker-cli.ts', 'server/modules/platform/composition.ts'], env);
  const iamMail = child('iam-mail', ['--import', 'tsx', 'scripts/iam-mail.ts'], env);
  const web = child('web', ['node_modules/vite/bin/vite.js', '--config', viteConfiguration], env);
  await startupStage(async()=>{const expected=[api.pid,dispatcher.pid,iamMail.pid];if(expected.some(pid=>!pid))throw Error('CANDIDATE_WRITER_PID_REQUIRED');for(let attempt=0;attempt<100;attempt++){if(closing || [api,dispatcher,iamMail].some(c=>c.exitCode!==null||c.signalCode!==null))throw Error('CANDIDATE_PROCESS_FAILED');const writers=await listHostWriters(ledger!,hostLease!);if(expected.every(pid=>writers.some(w=>w.pid===pid)))return;await new Promise(done=>setTimeout(done,200));}throw Error('CANDIDATE_WRITERS_NOT_REGISTERED');});
  await startupStage(() => ready(`http://127.0.0.1:${webPort}`));
  manifest.status = 'READY_FOR_AUDIT';
  manifest.processes = { launcher: process.pid, api: api.pid, dispatcher: dispatcher.pid, iamMail: iamMail.pid, web: web.pid };
  manifest.smtpPort = smtpPort;
  manifest.mailDelivery = 'Autonomous IAM daemon and local SMTP started; positive delivery must be proved separately by UI/API action and sink receipt';
  manifest.managedWriters = 'API, dispatcher and IAM mail registered under supervisor lease; production deployment remains unverified';
  manifest.readyAt = new Date().toISOString();
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

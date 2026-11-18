import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { configureIamMail } from '../../server/iam-mail/config.js';
import { listPlatformBackupReferences } from '../../server/modules/platform/backup.js';
import { createBackup, restoreBackup, socketPostgresTool, validateBundle } from '../../server/ops/backup.js';
import { acquireOrganizationHostLease, provisionFreshHostBinding } from '../../server/ops/organization-host-lease.js';
import { OrganizationLedger } from '../../server/ops/organization-ledger.js';
import { assertHostStorageBindingLocked, installHostStorageBinding } from '../../server/ops/organization-storage-binding.js';
import { configureLocalDispatcher } from '../../server/src/dispatcher-config.js';
import { enterManagedWriter } from '../../server/src/managed-writer.js';

const run = promisify(execFile);
const root = '/var/lib/orgmap';
const authority = join(root, 'authority');
const installationFile = join(root, 'installation.json');
const operatorPassword = process.env.ORGMAP_DB_PASSWORD;
if (!operatorPassword || !/^[a-f0-9]{64}$/.test(operatorPassword))
  throw Error('ORGMAP_DB_PASSWORD_MUST_BE_64_HEX_CHARACTERS');

process.umask(0o077);
const operatorUrl = new URL('postgres://orgmap_migrator@localhost/postgres?host=/var/run/postgresql');
operatorUrl.password = operatorPassword;
const admin = new pg.Client(operatorUrl.href);

function databaseUrl(database: string) {
  const url = new URL(operatorUrl);
  url.pathname = '/' + database;
  return url;
}

async function migrate(url: URL) {
  try {
    await run(process.execPath, ['--import', 'tsx', 'server/src/migrate.ts'], {
      env: { ...process.env, MIGRATION_DATABASE_URL: url.href },
    });
  } catch (error) {
    if (error instanceof Error && 'stderr' in error) console.error(String(error.stderr).trim());
    throw Error('ORGMAP_MIGRATION_FAILED');
  }
}

async function readInstallation() {
  const { database, configuration } = JSON.parse(await readFile(installationFile, 'utf8'));
  if (!/^orgmap_(fresh|restore)_[a-f0-9]{32}$/.test(database) ||
      !['integration.json', 'restored/storage-config.json'].includes(configuration))
    throw Error('ORGMAP_INSTALLATION_INVALID');
  return { database: database as string, configuration: join(root, configuration) };
}

async function freshCluster() {
  const databases = await admin.query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'");
  const { objects } = (await admin.query("SELECT count(*)::int AS objects FROM pg_tables WHERE schemaname='public'")).rows[0];
  if (databases.rowCount || objects || (await readdir(root)).length)
    throw Error('ORGMAP_EMPTY_INSTALLATION_REQUIRED');
}

async function configureApplicationLogin() {
  const secret = randomBytes(32).toString('hex');
  await admin.query("ALTER ROLE orgmap_app PASSWORD '" + secret + "'");
  const url = new URL(operatorUrl);
  url.username = 'orgmap_app';
  url.password = secret;
  return url;
}

async function saveInstallation(database: string, configuration: string, runtime: URL) {
  runtime.pathname = '/' + database;
  const adminUrl = databaseUrl(database).href;
  await configureLocalDispatcher({ adminUrl, file: join(root, 'dispatcher.env') });
  await configureIamMail({ adminUrl, file: join(root, 'iam-mail.env') });
  await writeFile(join(root, 'app.env'), 'DATABASE_URL=' + runtime.href + '\n', { flag: 'wx' });
  await writeFile(installationFile, JSON.stringify({ database, configuration }) + '\n', { flag: 'wx' });
}

async function prepare() {
  const existing = await lstat(installationFile).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing) {
    const installation = await readInstallation();
    const ledger = await OrganizationLedger.open(authority);
    const lease = await acquireOrganizationHostLease(ledger);
    const url = databaseUrl(installation.database);
    const client = new pg.Client(url.href);
    process.env.ORGMAP_INTEGRATION_CONFIG = installation.configuration;
    try {
      await client.connect();
      await ledger.withExclusive(locked => assertHostStorageBindingLocked(ledger, lease, client, locked));
      await migrate(url);
    } finally {
      await client.end();
      await lease.release();
    }
    return;
  }

  await freshCluster();
  const ledger = await OrganizationLedger.initialize(authority);
  const lease = await acquireOrganizationHostLease(ledger);
  try {
    const { database } = await provisionFreshHostBinding(ledger, lease, operatorUrl.href);
    const configuration = join(root, 'integration.json');
    await writeFile(configuration, JSON.stringify({ blobsDirectory: join(root, 'blobs') }) + '\n', { flag: 'wx' });
    const client = new pg.Client(databaseUrl(database).href);
    try {
      await client.connect();
      await installHostStorageBinding(ledger, lease, client, configuration);
    } finally {
      await client.end();
    }
    await saveInstallation(database, basename(configuration), await configureApplicationLogin());
  } finally {
    await lease.release();
  }
}

async function copyAuthority(from: string, into: string) {
  await mkdir(into, { mode: 0o700 });
  const files = await readdir(from);
  for (const file of files) {
    if (file === 'authority.json' || /^[a-f0-9-]{36}\.json$/.test(file))
      await cp(join(from, file), join(into, file), { force: false, errorOnExist: true });
  }
  const bindings = join(into, '.runtime-bindings');
  await mkdir(bindings, { mode: 0o700 });
  for (const file of await readdir(join(from, '.runtime-bindings'))) {
    if (!/^commit-[a-f0-9-]{36}\.json$/.test(file))
      throw Error('ORGMAP_AUTHORITY_HAS_PENDING_BINDING');
    await cp(join(from, '.runtime-bindings', file), join(bindings, file), { force: false, errorOnExist: true });
  }
}

async function backup(directory: string) {
  const installation = await readInstallation();
  const ledger = await OrganizationLedger.open(authority);
  const lease = await acquireOrganizationHostLease(ledger);
  const url = databaseUrl(installation.database).href;
  const client = new pg.Client(url);
  process.env.ORGMAP_INTEGRATION_CONFIG = installation.configuration;
  try {
    await client.connect();
    const registration = await enterManagedWriter({ ledger, token: lease.token, client });
    try {
      const paths = await ledger.withExclusive(locked => assertHostStorageBindingLocked(ledger, lease, client, locked));
      await mkdir(directory, { mode: 0o700 });
      await createBackup({
        adminUrl: url,
        bundleDirectory: join(directory, 'bundle'),
        blobsDirectory: paths.platform,
        brandingDirectory: paths.branding,
        accountMediaDirectory: paths.platform,
        lifecycleLedgerDirectory: authority,
        references: listPlatformBackupReferences,
        postgresTool: socketPostgresTool(url),
      });
      await copyAuthority(authority, join(directory, 'authority'));
    } finally {
      await registration?.release();
    }
  } finally {
    await client.end();
    await lease.release();
  }
}

async function restore(directory: string) {
  await freshCluster();
  const bundle = join(directory, 'bundle');
  const manifest = await validateBundle(bundle);
  if (!manifest.lifecycleBaseline) throw Error('ORGMAP_MANAGED_BACKUP_REQUIRED');
  const imported = await OrganizationLedger.open(join(directory, 'authority'), manifest.lifecycleBaseline.authorityId);
  await imported.requireSuperset(manifest.lifecycleBaseline);

  // Initialize the built-in roles required by the dump in a disposable database.
  // The restore itself still requires an empty cluster and verifies the dump.
  const scratch = 'orgmap_roles_' + randomUUID().replaceAll('-', '');
  await admin.query('CREATE DATABASE ' + scratch);
  try {
    await migrate(databaseUrl(scratch));
  } finally {
    await admin.query('DROP DATABASE ' + scratch);
  }
  const runtime = await configureApplicationLogin();
  await copyAuthority(imported.directory, authority);
  const result = await restoreBackup({
    adminUrl: operatorUrl.href,
    runtimeUrl: runtime.href,
    bundleDirectory: bundle,
    destinationDirectory: join(root, 'restored'),
    lifecycleLedgerDirectory: authority,
    newCluster: true,
    references: listPlatformBackupReferences,
    postgresTool: socketPostgresTool(operatorUrl.href),
  });
  await migrate(databaseUrl(result.database));
  await saveInstallation(result.database, 'restored/storage-config.json', runtime);
}

const [command, name] = process.argv.slice(2);
if (command !== 'prepare' && !(['backup', 'restore-new'].includes(command) && /^[a-zA-Z0-9_-]{1,64}$/.test(name ?? '')))
  throw Error('Usage: prepare | backup NAME | restore-new NAME');

await admin.connect();
try {
  if (!(await admin.query('SELECT pg_try_advisory_lock(76041853) AS acquired')).rows[0].acquired)
    throw Error('ORGMAP_OPERATOR_RUNNING');
  const directory = join('/backups', name ?? '');
  if (command === 'prepare') await prepare();
  else if (command === 'backup') await backup(directory);
  else await restore(directory);
  console.log('OrgMap ' + command + ' completed');
} finally {
  await admin.end();
}

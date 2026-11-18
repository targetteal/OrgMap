import { installHostStorageBindingLocked,assertJoinedHostStorageBinding } from './organization-storage-binding.js';
import { assertManagedWriter } from '../src/managed-writer.js';
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
  realpath,
  open,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { OrganizationLedger, type OrganizationLedgerSnapshot } from "./organization-ledger.js";
import { reconcileRestoredOrganizationLedger } from "./organization-ledger-restore.js";
import { acquireOrganizationHostLease, assertHostDatabaseBindingLocked, rotateLocked } from "./organization-host-lease.js";
import type { BrandingBackupReference } from "../modules/administration/branding-contract.js";
import type { AccountMediaBackupReference } from "../src/account-media-contract.js";
import { ACCOUNT_MEDIA_GC_LOCK } from "../src/account-media.js";
import { listAccountMediaBackupReferences } from "../modules/platform/backup.js";
import { withBrandingBackupLock, readBrandingBackupInventory, readBrandingRestoredInventory, copyBrandingBackupBlobs, restoreBrandingBackupBlobs, verifyBrandingBackupBlobs, validateBrandingBackupReferences, retireRestoredBrandingStages } from "../modules/administration/branding-backup.js";

export type BlobReference = {
  kind: string;
  organizationId: string;
  id: string;
  key: string;
  sha256: string;
  size: number;
};
type QueryClient = Pick<pg.PoolClient, "query">;
export type ReferencePort = (client: QueryClient) => Promise<BlobReference[]>;
type Snapshot = {
  counts: Record<string, number>;
  migrations: { name: string; checksum: string }[];
};
export type BackupManifest = {
  format: "orgmap-local-backup-v2" | "orgmap-local-backup-v3" | "orgmap-local-backup-v4" | "orgmap-local-backup-v5";
  lifecycleBaseline?: OrganizationLedgerSnapshot;
  brandingReferences?: BrandingBackupReference[];
  accountMediaReferences?: AccountMediaBackupReference[];
  createdAt: string;
  dumpSha256: string;
  snapshot: Snapshot;
  references: BlobReference[];
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const localUrl = (raw: string) => {
  const url = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^\/[a-z0-9_]+$/.test(url.pathname)
  )
    throw Error("LOCAL_DATABASE_REQUIRED");
  return url;
};
async function digestFile(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
async function regularFile(path: string) {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink())
    throw Error("BACKUP_REGULAR_FILE_REQUIRED");
  return file;
}
async function readBlob(directory: string, ref: Pick<BlobReference, "key" | "sha256" | "size">) {
  if (
    !uuid.test(ref.key) ||
    !/^[a-f0-9]{64}$/.test(ref.sha256) ||
    !Number.isSafeInteger(ref.size) ||
    ref.size < 0
  )
    throw Error("BACKUP_REFERENCE_INVALID");
  const path = join(directory, ref.key);
  // O_NOFOLLOW closes the lstat/open symlink race. The hash checks content identity.
  const handle = await open(
    path,
    (await import("node:fs")).constants.O_RDONLY |
      (await import("node:fs")).constants.O_NOFOLLOW,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== ref.size)
      throw Error("BACKUP_BLOB_SIZE_MISMATCH");
    const bytes = await handle.readFile();
    if (sha(bytes) !== ref.sha256)
      throw Error("BACKUP_BLOB_INTEGRITY_MISMATCH");
    return bytes;
  } finally {
    await handle.close();
  }
}
function normalizedReferences(refs: BlobReference[]) {
  for (const ref of refs)
    if (
      !uuid.test(ref.key) ||
      !uuid.test(ref.id) ||
      !uuid.test(ref.organizationId) ||
      !["FILE", "ARTIFACT"].includes(ref.kind) ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) ||
      !Number.isSafeInteger(ref.size) ||
      ref.size < 0
    )
      throw Error("BACKUP_REFERENCE_INVALID");
  return refs
    .slice()
    .sort((a, b) =>
      (a.kind + a.organizationId + a.id).localeCompare(
        b.kind + b.organizationId + b.id,
      ),
    );
}
function normalizedAccounts(refs: AccountMediaBackupReference[]) {
  if (!Array.isArray(refs)) throw Error("ACCOUNT_BACKUP_REFERENCE_INVALID");
  const keys=new Set<string>(), owners=new Set<string>(), assets=new Set<string>();
  for(const r of refs) {
    if(!r || r.owner!=="ACCOUNT" || r.storageNamespace!=="ACCOUNT_ASSETS" || !["PHOTO","COVER"].includes(r.kind) || !uuid.test(r.accountId) || !uuid.test(r.assetId) || !uuid.test(r.key) || !/^[a-f0-9]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.size) || r.size<1 || r.size>8*1024*1024) throw Error("ACCOUNT_BACKUP_REFERENCE_INVALID");
    const owner=r.accountId+":"+r.kind;if(keys.has(r.key)||owners.has(owner)||assets.has(r.assetId))throw Error("ACCOUNT_BACKUP_REFERENCE_CONFLICT");keys.add(r.key);owners.add(owner);assets.add(r.assetId);
  }
  return refs.map(r=>({owner:r.owner,accountId:r.accountId,storageNamespace:r.storageNamespace,kind:r.kind,assetId:r.assetId,key:r.key,sha256:r.sha256,size:r.size})).sort((a,b)=>(a.accountId+":"+a.kind).localeCompare(b.accountId+":"+b.kind));
}
function normalizedBranding(refs: BrandingBackupReference[], stageAware: boolean) {
  validateBrandingBackupReferences(refs);
  if(!stageAware && refs.some(r=>r.state==='READY')) throw Error("BRANDING_BACKUP_STAGE_MANIFEST_REQUIRED");
  return refs.map(r => ({owner:r.owner, ...(stageAware?{state:r.state??'ACTIVE'}:{}), organizationId:r.organizationId, storageNamespace:r.storageNamespace, purpose:r.purpose, assetId:r.assetId, key:r.key, sha256:r.sha256, size:r.size})).sort((a,b)=>(a.organizationId+':'+a.purpose+':'+a.assetId).localeCompare(b.organizationId+':'+b.purpose+':'+b.assetId));
}
async function state(c: QueryClient): Promise<Snapshot> {
  const counts: Record<string, number> = {};
  for (const { tablename } of (
    await c.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows) {
    if (!/^[a-z0-9_]+$/.test(tablename)) throw Error("BACKUP_TABLE_INVALID");
    counts[tablename] = Number(
      (await c.query('SELECT count(*) FROM "' + tablename + '"')).rows[0].count,
    );
  }
  return {
    counts,
    migrations: (
      await c.query("SELECT name,checksum FROM schema_migrations ORDER BY name")
    ).rows,
  };
}
type PostgresTool = typeof postgresTool;

async function postgresTool(args: string[], input?: string, output?: string) {
  await runPostgresTool("docker", ["compose", "exec", "-T", "postgres", ...args], input, output);
}

/** The self-hosted operator image has PostgreSQL clients and a private Unix socket. */
export function socketPostgresTool(connectionString: string): PostgresTool {
  const url = localUrl(connectionString);
  if (url.hostname !== "localhost" || url.searchParams.get("host") !== "/var/run/postgresql")
    throw Error("BACKUP_POSTGRES_SOCKET_REQUIRED");
  const env = { ...process.env, PGHOST: "/var/run/postgresql", PGPORT: "5432", PGPASSWORD: decodeURIComponent(url.password) };
  return ([program, ...args], input, output) => runPostgresTool(program, args, input, output, env);
}
async function runPostgresTool(
  program: string, args: string[], input?: string, output?: string, env?: NodeJS.ProcessEnv,
) {
  const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"], env });
  let diagnostic = "";
  child.stderr.on("data", (bytes) => {
    diagnostic = (diagnostic + bytes.toString()).slice(-2000);
  });
  const done = new Promise<void>((ok, no) => {
    child.on("error", no);
    child.on("close", (code) =>
      code === 0
        ? ok()
        : no(Error("POSTGRES_BACKUP_COMMAND_FAILED: " + diagnostic)),
    );
  });
  const streams: Promise<unknown>[] = [];
  if (input) streams.push(pipeline(createReadStream(input), child.stdin));
  else child.stdin.end();
  if (output)
    streams.push(
      pipeline(
        child.stdout,
        createWriteStream(output, { flags: "wx", mode: 0o600 }),
      ),
    );
  else child.stdout.resume();
  await Promise.all([done, ...streams]);
}
async function operator(pool: pg.Pool) {
  const row = (
    await pool.query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (!row?.rolsuper && !row?.rolbypassrls)
    throw Error("BACKUP_OPERATOR_BYPASS_REQUIRED");
}
export async function createBackup(options: {
  adminUrl: string;
  bundleDirectory: string;
  blobsDirectory: string;
  references: ReferencePort;
  brandingDirectory?: string;
  accountMediaDirectory?: string;
  lifecycleLedgerDirectory?: string;
  postgresTool?: PostgresTool;
}) {
  const url = localUrl(options.adminUrl),
    destination = resolve(options.bundleDirectory);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  // Reserve the final name before doing expensive work; partial packages carry no manifest.
  await mkdir(destination, { mode: 0o700 });
  const staging = await mkdtemp(destination + ".partial-");
  const admin = new pg.Pool({ connectionString: url.href });
  let published = false;
  try {
    const lifecycleLedger = options.lifecycleLedgerDirectory ? await OrganizationLedger.open(options.lifecycleLedgerDirectory) : null;
    const lifecycleBaseline = lifecycleLedger ? await lifecycleLedger.snapshot() : undefined;
    await operator(admin);
    const c = await admin.connect();
    let manifest: BackupManifest;
    let failed = false;
    try {
      const modeTable=(await c.query("SELECT to_regclass('public.organization_runtime_mode') AS name")).rows[0]?.name;
      const identityTable=(await c.query("SELECT to_regclass('public.organization_runtime_identity') AS name")).rows[0]?.name;
      const mode=modeTable ? (await c.query('SELECT managed FROM organization_runtime_mode WHERE singleton=true')).rows[0]?.managed : false;
      if(typeof mode!=='boolean')throw Error('HOST_RUNTIME_MODE_INVALID');
      if(!mode && identityTable && (await c.query('SELECT 1 FROM organization_runtime_identity WHERE singleton=true')).rowCount)throw Error('HOST_DATABASE_BINDING_MISMATCH');
      if(mode && !lifecycleLedger)throw Error('LIFECYCLE_LEDGER_REQUIRED');
      if(mode && lifecycleLedger){
        await assertManagedWriter(c);
        const roots=await assertJoinedHostStorageBinding(lifecycleLedger,c);
        if(await realpath(resolve(options.blobsDirectory))!==roots.platform ||
           (options.brandingDirectory && await realpath(resolve(options.brandingDirectory))!==roots.branding) ||
           (options.accountMediaDirectory && await realpath(resolve(options.accountMediaDirectory))!==roots.platform))
          throw Error('BACKUP_STORAGE_BINDING_MISMATCH');
      }
      await withBrandingBackupLock(c, async () => {
      await c.query("SELECT pg_advisory_lock($1)",[ACCOUNT_MEDIA_GC_LOCK]);
      try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const snapshotId = (await c.query("SELECT pg_export_snapshot() AS id"))
        .rows[0].id;
      const snapshot = await state(c),
        references = normalizedReferences(await options.references(c));
      await mkdir(join(staging, "blobs"), { mode: 0o700 });
      const copied = new Map<string, string>();
      for (const ref of references) {
        const bytes = await readBlob(resolve(options.blobsDirectory), ref);
        if (copied.has(ref.key)) {
          if (copied.get(ref.key) !== ref.sha256)
            throw Error("BACKUP_REFERENCE_CONFLICT");
          continue;
        }
        await writeFile(join(staging, "blobs", ref.key), bytes, {
          flag: "wx",
          mode: 0o600,
        });
        copied.set(ref.key, ref.sha256);
      }
      const accountMediaReferences = normalizedAccounts(await listAccountMediaBackupReferences(c));
      if (accountMediaReferences.length && !options.accountMediaDirectory) throw Error("ACCOUNT_BACKUP_DIRECTORY_REQUIRED");
      if (accountMediaReferences.length) {
        await mkdir(join(staging,"account-assets"), {mode:0o700});
        const platformKeys=new Set(references.map(r=>r.key));
        for(const ref of accountMediaReferences) { if(platformKeys.has(ref.key)) throw Error("BACKUP_NAMESPACE_KEY_COLLISION"); await writeFile(join(staging,"account-assets",ref.key),await readBlob(resolve(options.accountMediaDirectory!),ref),{flag:"wx",mode:0o600}); }
      }
      const hasBranding = !!(await c.query("SELECT to_regclass('public.administration_branding_assets') AS name")).rows[0].name;
      const brandingReferences = hasBranding ? await readBrandingBackupInventory(c) : [];
      const stageAware = !!(await c.query("SELECT to_regclass('public.administration_branding_stages') AS name")).rows[0].name;
      if (brandingReferences.length && !options.brandingDirectory) throw Error("BRANDING_BACKUP_DIRECTORY_REQUIRED");
      if (brandingReferences.length) await copyBrandingBackupBlobs(c, brandingReferences, options.brandingDirectory!, join(staging, "org-branding"));
      await (options.postgresTool ?? postgresTool)(
        [
          "pg_dump",
          "-U",
          url.username,
          "-d",
          url.pathname.slice(1),
          "--format=c",
          "--snapshot=" + snapshotId,
        ],
        undefined,
        join(staging, "database.dump"),
      );
      manifest = {
        format: stageAware ? "orgmap-local-backup-v5" : lifecycleBaseline ? "orgmap-local-backup-v4" : brandingReferences.length || accountMediaReferences.length ? "orgmap-local-backup-v3" : "orgmap-local-backup-v2",
        ...(stageAware || lifecycleBaseline || brandingReferences.length || accountMediaReferences.length ? { brandingReferences, accountMediaReferences } : {}),
        ...(lifecycleBaseline ? { lifecycleBaseline } : {}),
        createdAt: new Date().toISOString(),
        dumpSha256: await digestFile(join(staging, "database.dump")),
        snapshot,
        references,
      };
      await c.query("COMMIT");
      } catch (error) { await c.query("ROLLBACK"); throw error; }
      finally { await c.query("SELECT pg_advisory_unlock($1)",[ACCOUNT_MEDIA_GC_LOCK]); }
      });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // Destroy the session on failure so no advisory lock can return to the pool.
      c.release(failed);
    }
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify(manifest!, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await rename(staging, destination);
    published = true;
    return {
      bundleDirectory: destination,
      blobs: new Set(manifest!.references.map((r) => r.key)).size,
      references: manifest!.references.length,
      format: manifest!.format,
      brandingReferences: manifest!.brandingReferences?.length ?? 0,
      accountMediaReferences: manifest!.accountMediaReferences?.length ?? 0,
      lifecycleProtection: manifest!.lifecycleBaseline ? "BASELINE_RECORDED" : "UNKNOWN",
      dumpSha256: manifest!.dumpSha256,
    };
  } finally {
    await admin.end();
    if (!published) {
      await rm(staging, { recursive: true, force: true });
      await rm(destination, { recursive: true, force: true });
    }
  }
}
export async function validateBundle(
  directory: string,
): Promise<BackupManifest> {
  const root = resolve(directory),
    metadata = await regularFile(join(root, "manifest.json"));
  if (metadata.size > 64 * 1024 * 1024) throw Error("BACKUP_MANIFEST_INVALID");
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  ) as BackupManifest;
  if (
    !["orgmap-local-backup-v2", "orgmap-local-backup-v3", "orgmap-local-backup-v4", "orgmap-local-backup-v5"].includes(manifest.format) ||
    !/^[a-f0-9]{64}$/.test(manifest.dumpSha256) ||
    !manifest.snapshot ||
    !Array.isArray(manifest.references)
  )
    throw Error("BACKUP_MANIFEST_INVALID");
  normalizedReferences(manifest.references);
  if (manifest.format !== "orgmap-local-backup-v2") {
    if (!Array.isArray(manifest.brandingReferences) || !Array.isArray(manifest.accountMediaReferences)) throw Error("BACKUP_MANIFEST_INVALID");
    validateBrandingBackupReferences(manifest.brandingReferences);
    if(manifest.format==='orgmap-local-backup-v5' && manifest.brandingReferences.some(r=>!['ACTIVE','READY'].includes(r.state??''))) throw Error("BACKUP_MANIFEST_INVALID");
    if(manifest.format!=='orgmap-local-backup-v5' && manifest.brandingReferences.some(r=>r.state!==undefined)) throw Error("BACKUP_MANIFEST_INVALID");
    if(manifest.brandingReferences.length) await verifyBrandingBackupBlobs(manifest.brandingReferences, join(root, "org-branding"));
    const accountRefs=normalizedAccounts(manifest.accountMediaReferences);
    const platformKeys=new Set(manifest.references.map(r=>r.key));
    for(const ref of accountRefs) {if(platformKeys.has(ref.key))throw Error("BACKUP_NAMESPACE_KEY_COLLISION");await readBlob(join(root,"account-assets"),ref);}
  } else if (manifest.brandingReferences !== undefined || manifest.accountMediaReferences !== undefined) throw Error("BACKUP_MANIFEST_INVALID");
  if (manifest.format === "orgmap-local-backup-v4" ? !manifest.lifecycleBaseline : manifest.format === "orgmap-local-backup-v5" ? false : manifest.lifecycleBaseline !== undefined) throw Error("BACKUP_MANIFEST_INVALID");
  await regularFile(join(root, "database.dump"));
  if ((await digestFile(join(root, "database.dump"))) !== manifest.dumpSha256)
    throw Error("BACKUP_DUMP_INTEGRITY_MISMATCH");
  for (const ref of manifest.references)
    await readBlob(join(root, "blobs"), ref);
  return manifest;
}
async function migrateRestoredDatabase(databaseUrl: string) {
  const env:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:databaseUrl};
  delete env.MIGRATION_SCOPE; delete env.MIGRATION_MAX_PREFIX;
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("../src/migrate.ts",import.meta.url))],{env,stdio:["ignore","pipe","pipe"]});
    let diagnostic=""; child.stderr.on("data",chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-2000);});child.stdout.resume();child.on("error",reject);child.on("close",code=>code===0?resolve():reject(Error("RESTORED_MIGRATION_FAILED: "+diagnostic)));
  });
}
export async function restoreBackup<T>(options: {
  adminUrl: string;
  runtimeUrl: string;
  bundleDirectory: string;
  references: ReferencePort;
  destinationDirectory?: string;
  newCluster?: boolean;
  lifecycleLedgerDirectory?: string;
  postgresTool?: PostgresTool;
  resourceEvent?: (event: {name:string;state:'PLANNED'|'CREATED'}) => Promise<void>;
  probe?: (context: {
    runtimeUrl: string;
    blobsDirectory: string;
    brandingDirectory?: string;
    database: string;
    manifest: BackupManifest;
  }) => Promise<T>;
}) {
  const manifest = await validateBundle(options.bundleDirectory);
  if (!options.lifecycleLedgerDirectory) throw Error("LIFECYCLE_LEDGER_REQUIRED");
  const ledger = await OrganizationLedger.open(options.lifecycleLedgerDirectory, manifest.lifecycleBaseline?.authorityId);
  const lease = await acquireOrganizationHostLease(ledger);
  try { return await ledger.withExclusive(async lockedLedger => {
  const verifiedManifest = await validateBundle(options.bundleDirectory);
  if (JSON.stringify(verifiedManifest) !== JSON.stringify(manifest)) throw Error("BACKUP_MANIFEST_CHANGED");
  if (manifest.lifecycleBaseline) await lockedLedger.requireSuperset(manifest.lifecycleBaseline);
  const url = localUrl(options.adminUrl),
    runtime = localUrl(options.runtimeUrl);
  const admin = new pg.Pool({ connectionString: url.href }),
    database = "orgmap_restore_" + randomUUID().replaceAll("-", "");
  const directory = options.destinationDirectory
    ? resolve(options.destinationDirectory)
    : await mkdtemp(join(tmpdir(), "orgmap-restore-"));
  let createdDatabase = false,
    createdDirectory = !options.destinationDirectory,
    completed = false, rotationStarted = false;
  let target: pg.Client | undefined;
  const restoreBackends: Array<{ pid: number; started: string }> = [];
  async function rememberBackend(client: pg.Client) {
    const result = await client.query("SELECT pid, backend_start::text AS started FROM pg_stat_activity WHERE pid=pg_backend_pid()");
    restoreBackends.push(result.rows[0]);
  }
  try {
    await operator(admin);
    if (options.newCluster) {
      // The operator carries the latest authority to a fresh, isolated cluster.
      // Refuse this route on a cluster that could already serve a workspace.
      if (!options.destinationDirectory || !manifest.lifecycleBaseline || url.pathname !== "/postgres")
        throw Error("HOST_RESTORE_NEW_CLUSTER_REQUIRED");
      const databases = await admin.query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'");
      if (databases.rowCount || (await admin.query("SELECT to_regclass('public.organizations') AS relation")).rows[0].relation)
        throw Error("HOST_RESTORE_CLUSTER_NOT_EMPTY");
    } else {
      const source = await admin.connect();
      try { await assertHostDatabaseBindingLocked(ledger, lease, source, lockedLedger); }
      finally { source.release(); }
    }
    if (options.destinationDirectory) {
      await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
      await mkdir(directory, { mode: 0o700 });
      createdDirectory = true;
    }
    const blobsDirectory = join(directory, "blobs");
    await mkdir(blobsDirectory, { mode: 0o700 });
    // The managed destination binds these empty directories before any bytes
    // are copied; an isolated verify remains unbound and is never served.
    const brandRoot=join(blobsDirectory,'organization-branding');
    await mkdir(brandRoot,{mode:0o700});
    const brandingDirectory=manifest.format!=='orgmap-local-backup-v2' ? brandRoot : undefined;
    await options.resourceEvent?.({name:database,state:'PLANNED'});
    await admin.query('CREATE DATABASE "' + database + '"');
    createdDatabase = true;
    await options.resourceEvent?.({name:database,state:'CREATED'});
    await (options.postgresTool ?? postgresTool)(
      [
        "pg_restore",
        "-U",
        url.username,
        "-d",
        database,
        "--exit-on-error",
        "--no-owner",
      ],
      join(resolve(options.bundleDirectory), "database.dump"),
    );
    if (await digestFile(join(resolve(options.bundleDirectory), "database.dump")) !== manifest.dumpSha256) throw Error("BACKUP_DUMP_INTEGRITY_MISMATCH");
    url.pathname = "/" + database;
    target = new pg.Client({ connectionString: url.href });
    await target.connect();
    await rememberBackend(target);
    if (
      JSON.stringify(await state(target)) !== JSON.stringify(manifest.snapshot)
    )
      throw Error("BACKUP_RESTORED_STATE_MISMATCH");
    try {
      await target.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      if (
        JSON.stringify(
          normalizedReferences(await options.references(target)),
        ) !== JSON.stringify(normalizedReferences(manifest.references))
      )
        throw Error("BACKUP_RESTORED_REFERENCES_MISMATCH");
      const restoredAccount = await listAccountMediaBackupReferences(target);
      if(JSON.stringify(normalizedAccounts(restoredAccount))!==JSON.stringify(normalizedAccounts(manifest.accountMediaReferences ?? []))) throw Error("ACCOUNT_BACKUP_RESTORED_REFERENCES_MISMATCH");
      const hasBranding = !!(await target.query("SELECT to_regclass('public.administration_branding_assets') AS name")).rows[0].name;
      const restoredBranding = hasBranding ? await readBrandingRestoredInventory(target) : [];
      if (JSON.stringify(normalizedBranding(restoredBranding,manifest.format==='orgmap-local-backup-v5')) !== JSON.stringify(normalizedBranding(manifest.brandingReferences ?? [],manifest.format==='orgmap-local-backup-v5'))) throw Error("BRANDING_BACKUP_RESTORED_REFERENCES_MISMATCH");
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }
    // Baseline and referenced bytes have been checked against the original dump before upgrading.
    const lifecyclePresent = !!(await target.query("SELECT to_regclass('public.organization_lifecycle') AS name")).rows[0].name;
    const identityPresent = !!(await target.query("SELECT to_regclass('public.organization_runtime_identity') AS name")).rows[0].name;
    if (!lifecyclePresent || !identityPresent) await migrateRestoredDatabase(url.href);
    const currentLedger = manifest.lifecycleBaseline ? await lockedLedger.requireSuperset(manifest.lifecycleBaseline) : await lockedLedger.snapshot();
    await target.query("BEGIN");
    let lifecycleReconciliation;
    let brandingStagesRetired=0;
    try {
      lifecycleReconciliation = await reconcileRestoredOrganizationLedger(target,currentLedger);
      brandingStagesRetired = await retireRestoredBrandingStages(target);
      // An old snapshot can contain the current identity. Never leave an unbound clone bootable.
      await target.query("DELETE FROM organization_runtime_identity WHERE singleton=true");
      await target.query("UPDATE organization_runtime_mode SET managed=true WHERE singleton=true");
      await target.query("COMMIT");
    }
    catch(error) { await target.query("ROLLBACK"); throw error; }
    // Recheck immediately before exposing the restore; a changed ledger requires a fresh restore.
    const rechecked = manifest.lifecycleBaseline ? await lockedLedger.requireSuperset(manifest.lifecycleBaseline) : await lockedLedger.snapshot();
    if(rechecked.sha256 !== currentLedger.sha256) throw Error("LIFECYCLE_LEDGER_CHANGED_DURING_RESTORE");
    runtime.pathname = "/" + database;
    const app = new pg.Client({ connectionString: runtime.href });
    try {
      await app.connect();
      await rememberBackend(app);
      const role = (
        await app.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0];
      if (role.rolsuper || role.rolbypassrls)
        throw Error("BACKUP_RUNTIME_UNSAFE");
      if ((await app.query("SELECT * FROM entities")).rowCount !== 0)
        throw Error("BACKUP_RESTORED_RLS_FAILED");
    } finally {
      await app.end();
    }
    let newBinding;
    let storageConfigurationFile:string|undefined;
    if(options.destinationDirectory){
      rotationStarted=true;
      newBinding=await rotateLocked(ledger,lease,target,lockedLedger);
      storageConfigurationFile=join(directory,'storage-config.json');
      await writeFile(storageConfigurationFile,JSON.stringify({blobsDirectory})+'\n',{mode:0o600,flag:'wx'});
      await installHostStorageBindingLocked(ledger,lease,target,lockedLedger,storageConfigurationFile,true);
    }
    // Manifest hashes were validated before restore. Copy only after the
    // retained destination has its own empty-root binding.
    for(const ref of manifest.references)await writeFile(join(blobsDirectory,ref.key),await readBlob(join(resolve(options.bundleDirectory),'blobs'),ref),{flag:'wx',mode:0o600});
    for(const ref of manifest.brandingReferences??[])await writeFile(join(brandRoot,ref.key),await readBlob(join(resolve(options.bundleDirectory),'org-branding'),ref),{flag:'wx',mode:0o600});
    for(const ref of manifest.accountMediaReferences??[])await writeFile(join(blobsDirectory,ref.key),await readBlob(join(resolve(options.bundleDirectory),'account-assets'),ref),{flag:'wx',mode:0o600});
    const proof = await options.probe?.({
      runtimeUrl: runtime.href,
      blobsDirectory,
      brandingDirectory,
      database,
      manifest,
    });
    completed = true;
    return {
      database,
      blobsDirectory,
      brandingDirectory,
      lifecycleProtection: manifest.lifecycleBaseline ? "BASELINE_VERIFIED" : "UNKNOWN",
      readiness: options.destinationDirectory ? "BOUND_HOST_NOT_RUNNING" as const : "VERIFIED_ISOLATED_NOT_BOUND" as const,
      newBinding,
      storageConfigurationFile,
      brandingStagesRetired,
      lifecycleReconciliation,
      manifest,
      proof,
      retained: !!options.destinationDirectory,
    };
  } catch(error) {
    if(rotationStarted && !completed) throw new Error(`HOST_BINDING_RECOVERY_REQUIRED:${database}`, {cause:error});
    throw error;
  } finally {
    try {
      await target?.end();
      // Closing the local socket can precede PostgreSQL removing its backend.
      // Wait only for connections created by this restore, never unrelated clients.
      for (const backend of restoreBackends) {
        const deadline = Date.now() + 5000;
        while ((await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start::text=$2", [backend.pid, backend.started])).rowCount) {
          if (Date.now() >= deadline) throw Error("BACKUP_RESTORE_CONNECTION_CLOSE_TIMEOUT");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    } finally {
      try {
        if (createdDatabase && (!completed || !options.destinationDirectory) && !rotationStarted)
          await admin.query(
            'DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)',
          );
      } finally {
        await admin.end();
        if (createdDirectory && (!completed || !options.destinationDirectory) && !rotationStarted)
          await rm(directory, { recursive: true, force: true });
      }
    }
  }
  }); } finally { await lease.release(); }
}

import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createBackup, restoreBackup } from "../server/ops/backup.js";
import { listPlatformBackupReferences } from "../server/modules/platform/backup.js";
import { loadIntegrationOptions } from "../server/integration/config.js";
import pg from "pg";
import { OrganizationLedger } from "../server/ops/organization-ledger.js";
import { enterManagedWriter } from "../server/src/managed-writer.js";
import { acquireOrganizationHostLease, provisionFreshHostBinding, recoverAbandonedHostLease, recoverBindingTemporaries, recoverPendingHostBinding } from "../server/ops/organization-host-lease.js";
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const runtimeUrl =
  process.env.DATABASE_URL ??
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap";
// Optional private test-supervisor journal. The parent must durably acknowledge
// each identifier before resource creation; never send URLs or credentials.
async function resourceEvent(event: {name:string;state:'PLANNED'|'CREATED'}): Promise<void> {
 if(process.env.ORGMAP_TEST_RESOURCE_RECEIPTS!=='1')return;
 if(!process.send)throw Error('RESOURCE_RECEIPT_SUPERVISOR_REQUIRED');
 const id=randomUUID();
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{process.off('message',onMessage);reject(Error('RESOURCE_RECEIPT_ACK_TIMEOUT'));},10000);
  function onMessage(value:unknown){if(!value||typeof value!=='object'||(value as {id?:unknown}).id!==id)return;clearTimeout(timer);process.off('message',onMessage);(value as {ok?:unknown}).ok===true?resolve():reject(Error('RESOURCE_RECEIPT_ACK_FAILED'));}
  process.on('message',onMessage);process.send!({type:'HOST_OPS_DATABASE',id,...event},error=>{if(error){clearTimeout(timer);process.off('message',onMessage);reject(error);}});
 });
}
const mode = process.argv[2] ?? "create";
const bundleDirectory = resolve(
  process.argv[3] ?? ".orgmap/backups/" + Date.now() + "-" + randomUUID(),
);
if (mode === "initialize-authority") {
  const directory=process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY;
  if(!directory)throw Error("LIFECYCLE_LEDGER_REQUIRED");
  // Exclusive new directory only: a missing authority in an existing directory is never replaced.
  await mkdir(resolve(directory),{mode:0o700});
  const ledger=await OrganizationLedger.initialize(directory);
  console.log(JSON.stringify({authorityId:ledger.authorityId}));
} else if (mode === "initialize-host" || mode === "recover-binding" || mode === "recover-host-lease") {
  const directory=process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY;
  if(!directory)throw Error("LIFECYCLE_LEDGER_REQUIRED");
  const ledger=await OrganizationLedger.open(directory);
  if(mode==="recover-host-lease") {
    const token=process.env.ORGMAP_HOST_LEASE_RECOVERY_TOKEN;if(!token)throw Error("HOST_LEASE_TOKEN_REQUIRED");
    await recoverAbandonedHostLease(ledger,token);console.log(JSON.stringify({recovered:true}));
  } else {
    const lease=await acquireOrganizationHostLease(ledger);
    try {if(mode==="initialize-host") {const result=await provisionFreshHostBinding(ledger,lease,adminUrl);console.log(JSON.stringify({result}));}
      else {const p=new pg.Pool({connectionString:adminUrl});try {const c=await p.connect();try {const cleaned=await recoverBindingTemporaries(ledger,lease);try{console.log(JSON.stringify({result:await recoverPendingHostBinding(ledger,lease,c),cleanedTemporaries:cleaned}));}catch(e){if(!(e instanceof Error && e.message==='HOST_BINDING_NO_PENDING' && cleaned>0))throw e;console.log(JSON.stringify({result:'TEMPORARIES_REMOVED',cleanedTemporaries:cleaned}));}}finally{c.release();}}finally{await p.end();}}
    } finally {await lease.release();}
  }
} else if (mode === "create") {
  const options = await loadIntegrationOptions();
  const platformDirectory = process.env.PLATFORM_BLOBS_DIRECTORY ?? options.blobsDirectory ?? resolve(".orgmap/blobs");
  const check=new pg.Pool({connectionString:adminUrl});
  let registration:Awaited<ReturnType<typeof enterManagedWriter>> = null;
  try {
   const c=await check.connect();try {
    const modeTable=(await c.query("SELECT to_regclass('public.organization_runtime_mode') AS name")).rows[0]?.name;
    if(modeTable && (await c.query('SELECT managed FROM organization_runtime_mode WHERE singleton=true')).rows[0]?.managed===true)
      registration=await enterManagedWriter({client:c});
   } finally {c.release();}
   const result = await createBackup({
    adminUrl,
    bundleDirectory,
    blobsDirectory: platformDirectory,
    brandingDirectory: process.env.ORGMAP_BRANDING_BLOBS_DIRECTORY ?? join(platformDirectory, "organization-branding"),
    accountMediaDirectory: process.env.ORGMAP_ACCOUNT_MEDIA_DIRECTORY ?? platformDirectory,
    lifecycleLedgerDirectory: process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY,
    references: listPlatformBackupReferences,
   });
   console.log(JSON.stringify(result));
  } finally {await registration?.release();await check.end();}
} else if (mode === "verify" || mode === "restore") {
  const destinationDirectory =
    mode === "restore"
      ? resolve(process.argv[4] ?? ".orgmap/recovered/" + randomUUID())
      : undefined;
  const result = await restoreBackup({
    adminUrl,
    runtimeUrl,
    bundleDirectory,
    references: listPlatformBackupReferences,
    destinationDirectory,
    lifecycleLedgerDirectory: process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY,
    resourceEvent,
  });
  const receipt = {
    format: "orgmap-local-backup-verification-v2",
    backupFormat: result.manifest.format,
    brandingReferences: result.manifest.brandingReferences?.length ?? 0,
    accountMediaReferences: result.manifest.accountMediaReferences?.length ?? 0,
    lifecycleProtection: result.lifecycleProtection,
    readiness: result.readiness,
    lifecycleReconciliation: result.lifecycleReconciliation,
    brandingStagesRetired: result.brandingStagesRetired,
    verifiedAt: new Date().toISOString(),
    dumpSha256: result.manifest.dumpSha256,
    tables: Object.keys(result.manifest.snapshot.counts).length,
    migrations: result.manifest.snapshot.migrations.length,
    references: result.manifest.references.length,
    blobs: new Set(result.manifest.references.map((r) => r.key)).size,
    rlsNoContext: "deny",
    ...(mode === "restore"
      ? {
          restoredDatabase: result.database,
          storageConfigurationFile: result.storageConfigurationFile,
          blobsDirectory: result.blobsDirectory,
          ...(result.brandingDirectory ? { brandingDirectory: result.brandingDirectory } : {}),
          retained: true,
        }
      : { restoredDatabaseRemoved: true, restoredDirectoryRemoved: true }),
  };
  // Written only after validation and, for verify, successful temporary-state cleanup.
  const receiptFile = resolve(
    bundleDirectory,
    mode + "-" + randomUUID() + ".json",
  );
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({ ...receipt, receiptFile }));
} else
  throw Error(
    "Usage: backup.ts create|verify [bundle-directory] | restore [bundle-directory] [new-destination-directory] | initialize-authority | initialize-host | recover-binding | recover-host-lease",
  );

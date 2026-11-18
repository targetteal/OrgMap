import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile, writeFile, rm, cp, readdir, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import {
  createOrgMapIntegration,
  createPlatformWorker,
} from "../../server/integration/index.js";
import {
  createBackup,
  restoreBackup as restoreBackupRaw,
  validateBundle,
} from "../../server/ops/backup.js";
import { listPlatformBackupReferences } from "../../server/modules/platform/backup.js";
import { OrganizationLedger } from "../../server/ops/organization-ledger.js";
import { acquireOrganizationHostLease, type OrganizationHostLease } from '../../server/ops/organization-host-lease.js';
import { installHostStorageBinding } from '../../server/ops/organization-storage-binding.js';
import { enterManagedWriter } from '../../server/src/managed-writer.js';
if (
  !/^\/orgmap_fresh_[a-f0-9]{32}$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("EXCLUSIVE_OPS_DATABASE_REQUIRED");
const fixtureRuntime = new URL(process.env.DATABASE_URL!),
  fixtureOperator = new URL(
    process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
  );
if (
  fixtureOperator.pathname !== fixtureRuntime.pathname ||
  fixtureOperator.host !== fixtureRuntime.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(fixtureRuntime.hostname)
)
  throw Error("EXCLUSIVE_OPS_DATABASE_REQUIRED");
const directory = process.env.OPS_PROOF_DIRECTORY!,
  blobsDirectory = join(directory, "source-blobs");
const lifecycleLedgerDirectory=join(directory,"lifecycle-authority"), ledger=await OrganizationLedger.open(lifecycleLedgerDirectory);
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const configPath=join(directory,'operator.json');
await writeFile(configPath,JSON.stringify({blobsDirectory}),{mode:0o600,flag:'wx'});
process.env.ORGMAP_INTEGRATION_CONFIG=configPath;
let hostLease:OrganizationHostLease|undefined;
let writer:Awaited<ReturnType<typeof enterManagedWriter>>=null;
async function startWriter(){
 hostLease=await acquireOrganizationHostLease(ledger);
 try{const c=await admin.connect();try{await installHostStorageBinding(ledger,hostLease,c,configPath);writer=await enterManagedWriter({ledger,token:hostLease.token,client:c});}finally{c.release();}}
 catch(e){await hostLease.release();hostLease=undefined;throw e;}
}
async function stopWriter(){await writer?.release();writer=null;await hostLease?.release();hostLease=undefined;}
async function restoreBackup<T>(options:Parameters<typeof restoreBackupRaw<T>>[0]){await stopWriter();try{return await restoreBackupRaw(options);}finally{await startWriter();}}
// Exercise retained restores under a copied authority, so rotation cannot fence the source fixture.
async function withBoundRestore<T>(options: Parameters<typeof restoreBackupRaw>[0], run: (ctx: {runtimeUrl:string; blobsDirectory:string; brandingDirectory?:string; database:string; runChild:(code:string, env:Record<string,string>)=>Promise<string>})=>Promise<T>) {
  await stopWriter();
  const isolated=join(directory,'restore-authority-'+randomUUID());
  let restored:Awaited<ReturnType<typeof restoreBackupRaw>>|undefined;
  let lease:OrganizationHostLease|undefined;
  try {
    await cp(lifecycleLedgerDirectory,isolated,{recursive:true});
    restored=await restoreBackupRaw({...options,lifecycleLedgerDirectory:isolated,destinationDirectory:join(directory,'retained-'+randomUUID())});
    assert.equal(restored.readiness,'BOUND_HOST_NOT_RUNNING');
    const isolatedLedger=await OrganizationLedger.open(isolated);
    lease=await acquireOrganizationHostLease(isolatedLedger);
    const runtime=new URL(process.env.DATABASE_URL!);runtime.pathname='/'+restored.database;
    const token=lease.token, config=restored.storageConfigurationFile!;
    const runChild=(code:string,env:Record<string,string>)=>child(['--input-type=module','--eval',`
      const {OrganizationLedger}=await import('./server/ops/organization-ledger.ts');
      const {enterManagedWriter}=await import('./server/src/managed-writer.ts');
      const {pool}=await import('./server/src/db.ts');
      const ledger=await OrganizationLedger.open(process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY);
      const client=await pool.connect();let writer;
      try {writer=await enterManagedWriter({ledger,token:process.env.ORGMAP_HOST_LEASE_TOKEN,client});client.release();await (async()=>{${code}})();}
      finally {await writer?.release();if(!pool.ending)await pool.end();}
    `],{...env,DATABASE_URL:runtime.href,ORGMAP_LIFECYCLE_LEDGER_DIRECTORY:isolated,ORGMAP_HOST_LEASE_TOKEN:token,ORGMAP_INTEGRATION_CONFIG:config});
    return await run({runtimeUrl:runtime.href,blobsDirectory:restored.blobsDirectory,brandingDirectory:restored.brandingDirectory,database:restored.database,runChild});
  } finally {
    await lease?.release();
    if(restored){
      assert.match(restored.database,/^orgmap_restore_[a-f0-9]{32}$/);
      const retainedDirectory=join(restored.blobsDirectory,'..');
      await admin.query('DROP DATABASE "'+restored.database+'"');
      assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[restored.database])).rowCount,0);
      await rm(retainedDirectory,{recursive:true});
      await assert.rejects(readdir(retainedDirectory),{code:'ENOENT'});
      console.log(JSON.stringify({boundRestoreCleanup:{database:restored.database,databaseAbsent:true,directory:retainedDirectory,directoryAbsent:true}}));
    }
    await rm(isolated,{recursive:true,force:true});
    await assert.rejects(readdir(isolated),{code:'ENOENT'});
    await startWriter();
  }
}
await startWriter();
const app = await buildApp([createOrgMapIntegration({ blobsDirectory })], {
  migrationMaxPrefix: 999,
});
after(async () => {
  await app.close();
  await stopWriter();
  await pool.end();
  await admin.end();
});
const origin = "http://localhost:5173";
async function call(
  method: InjectOptions["method"],
  path: string,
  user?: any,
  payload?: InjectOptions["payload"],
): Promise<LightMyRequestResponse> {
  const options: InjectOptions = {
    method,
    url: "/api/v1" + path,
    headers: {
      origin,
      "idempotency-key": randomUUID(),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
    },
    payload,
  };
  return app.inject(options);
}
function ok(response: any, status = 200) {
  assert.equal(response.statusCode, status, response.body);
  return response.json().data;
}
async function user() {
  const response = await call("POST", "/auth/register", undefined, {
    email: randomUUID() + "@example.test",
    displayName: "OPS recovery",
    password: "ops-proof-password-123",
  });
  const data = ok(response, 201);
  return {
    cookie: response.cookies[0].name + "=" + response.cookies[0].value,
    csrf: data.csrfToken,
    id: data.account.id,
  };
}
async function child(args: string[], env: Record<string, string>) {
  const stopped=args[0]==='scripts/backup.ts'&&args[1]==='verify';
  if(stopped)await stopWriter();
  try{return await new Promise<string>((yes, no) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, ...(hostLease?{ORGMAP_HOST_LEASE_TOKEN:hostLease.token}:{}) };
    if (env.MIGRATION_MAX_PREFIX) delete childEnv.MIGRATION_SCOPE;
    const p = spawn(process.execPath, ["--import", "tsx", ...args], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    p.stdout.on("data", (b) => (output += b.toString()));
    p.stderr.on("data", (b) => (output += b.toString()));
    p.on("error", no);
    p.on("exit", (code) => (code === 0 ? yes(output) : no(Error(output))));
  });}finally{if(stopped)await startWriter();}
}
test('managed backup rejects missing ledger and unregistered writer',async()=>{
 const opts={adminUrl:process.env.MIGRATION_DATABASE_URL!,blobsDirectory,references:listPlatformBackupReferences};
 await assert.rejects(createBackup({...opts,bundleDirectory:join(directory,'managed-no-ledger')}),/LIFECYCLE_LEDGER_REQUIRED/);
 await stopWriter();
 try {await assert.rejects(createBackup({...opts,bundleDirectory:join(directory,'managed-no-writer'),lifecycleLedgerDirectory}),/HOST_WRITER_REGISTRATION_REQUIRED/);}
 finally {await startWriter();}
});
test("consistent DB + referenced blobs restore exact authenticated HTTP downloads; reject partial/corrupt packages", async () => {
  const owner = await user(),
    outsider = await user();
  const created = ok(
    await call("POST", "/organizations", owner, { name: "OPS snapshot proof" }),
    201,
  );
  const org = created.organization.id,
    member = created.membership.id,
    circle = created.rootCircle.id,
    base = "/organizations/" + org + "/platform";
  const upload = async (name: string, bytes: string) =>
    ok(
      await call(
        "POST",
        base + "/resources/circle/" + circle + "/uploads",
        owner,
        {
          name,
          mime: "text/plain",
          base64: Buffer.from(bytes).toString("base64"),
        },
      ),
      201,
    );
  const text = "Acentos e recuperação íntegra: ação, tensão, coração.\n";
  const file = await upload("evidencia.txt", text),
    filePath = base + "/files/" + file.id + "/download";
  const job = ok(
    await call("POST", base + "/exports", owner, {
      resourceType: "circle",
      resourceIds: [circle],
      kind: "STRUCTURE",
      format: "JSON",
    }),
    202,
  );
  const worker = await createPlatformWorker({ blobsDirectory });
  await worker.runJob(org, member);
  const completed = ok(await call("GET", base + "/jobs/" + job.id, owner));
  assert.equal(completed.state, "COMPLETED");
  const artifactPath =
    base + "/artifacts/" + completed.result.artifactId + "/download";
  const downloads = [
    { path: filePath, base64: ok(await call("GET", filePath, owner)).base64 },
    {
      path: artifactPath,
      base64: ok(await call("GET", artifactPath, owner)).base64,
    },
  ];
  const bundle = join(directory, "backup"),
    options = {
      adminUrl: process.env.MIGRATION_DATABASE_URL!,
      bundleDirectory: bundle,
      blobsDirectory,
      references: listPlatformBackupReferences,
      lifecycleLedgerDirectory,
    };
  let late: any;
  const result = await createBackup({
    ...options,
    references: async (c) => {
      const refs = await listPlatformBackupReferences(c);
      late = await upload(
        "after-snapshot.txt",
        "committed after exported snapshot",
      );
      return refs;
    },
  });
  assert.equal(result.references, 2);
  assert.equal(result.blobs, 2);
  const manifest = await validateBundle(bundle);
  assert.equal(manifest.references.length, 2);
  assert.equal((await readdir(join(bundle, "blobs"))).length, 2);
  // Failure never publishes a manifest/package, and does not mutate the source DB.
  const first = manifest.references[0],
    sourcePath = join(blobsDirectory, first.key),
    original = await readFile(sourcePath);
  await rm(sourcePath);
  const absent = join(directory, "missing-blob-package");
  await assert.rejects(createBackup({ ...options, bundleDirectory: absent }));
  await assert.rejects(readFile(join(absent, "manifest.json")));
  await writeFile(sourcePath, original, { mode: 0o600 });
  const fixture = join(directory, "downloads.json");
  await writeFile(
    fixture,
    JSON.stringify({
      cookie: owner.cookie,
      outsiderCookie: outsider.cookie,
      downloads,
      latePath: base + "/files/" + late.id + "/download",
    }),
    { mode: 0o600 },
  );
  // Exercise the operator CLI with the same private host configuration as HTTP/workers.
  const config = join(directory, "operator.json"),
    cliBundle = join(directory, "cli-backup");
  const cliEnv = { ORGMAP_INTEGRATION_CONFIG: config, ORGMAP_LIFECYCLE_LEDGER_DIRECTORY: lifecycleLedgerDirectory };
  const createdCli = JSON.parse(
    (await child(["scripts/backup.ts", "create", cliBundle], cliEnv)).trim(),
  );
  assert.equal(createdCli.references, 3);
  assert.equal(createdCli.format, "orgmap-local-backup-v5");
  const verifiedCli = JSON.parse(
    (await child(["scripts/backup.ts", "verify", cliBundle], cliEnv)).trim(),
  );
  assert.equal(verifiedCli.restoredDatabaseRemoved, true);
  assert.equal(verifiedCli.restoredDirectoryRemoved, true);
  // Repeated verification produces a separate receipt rather than failing or overwriting history.
  const repeated = JSON.parse(
    (await child(["scripts/backup.ts", "verify", cliBundle], cliEnv)).trim(),
  );
  assert.notEqual(repeated.receiptFile, verifiedCli.receiptFile);
  // Retained CLI restore rotates binding and is exercised by the independent host-ops fixture.
  // Source files can be gone during disaster recovery; only the package is used.
  for(const name of await readdir(blobsDirectory))if(name!=='organization-branding')await rm(join(blobsDirectory,name),{recursive:true,force:true});
  const proof = await withBoundRestore({lifecycleLedgerDirectory,adminUrl:options.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bundle,references:listPlatformBackupReferences},async ctx=>JSON.parse((await ctx.runChild("await import('./server/ops/download-proof.ts');",{OPS_RESTORED_BLOBS:ctx.blobsDirectory,OPS_DOWNLOAD_FIXTURE:fixture})).trim()));
  assert.equal(proof.restoredHttpDownloads,2);assert.equal(proof.bytesExact,true);
  const before = Number(
    (
      await admin.query(
        "SELECT count(*) FROM pg_database WHERE datname LIKE 'orgmap_restore_%'",
      )
    ).rows[0].count,
  );
  for (const corruption of ["blob", "dump", "reference"]) {
    const bad = join(directory, "corrupt-" + corruption);
    await cp(bundle, bad, { recursive: true });
    if (corruption === "blob")
      await writeFile(join(bad, "blobs", first.key), "damaged");
    if (corruption === "dump")
      await writeFile(join(bad, "database.dump"), Buffer.alloc(8));
    if (corruption === "reference") {
      const m = JSON.parse(await readFile(join(bad, "manifest.json"), "utf8"));
      m.references[0].id = randomUUID();
      await writeFile(join(bad, "manifest.json"), JSON.stringify(m));
    }
    await assert.rejects(
      restoreBackup({
        lifecycleLedgerDirectory,
        adminUrl: options.adminUrl,
        runtimeUrl: process.env.DATABASE_URL!,
        bundleDirectory: bad,
        references: listPlatformBackupReferences,
      }),
    );
  }
  const afterCount = Number(
    (
      await admin.query(
        "SELECT count(*) FROM pg_database WHERE datname LIKE 'orgmap_restore_%'",
      )
    ).rows[0].count,
  );
  assert.equal(afterCount, before);
  const unavailableRuntime = new URL(process.env.DATABASE_URL!);
  unavailableRuntime.password = randomUUID();
  for (const failure of ["runtime", "probe"]) {
    const failedDirectory = join(directory, "failed-restore-" + failure);
    let failedDatabase: string | undefined;
    await assert.rejects(
      restoreBackup({
        lifecycleLedgerDirectory,
        adminUrl: options.adminUrl,
        runtimeUrl:
          failure === "runtime"
            ? unavailableRuntime.href
            : process.env.DATABASE_URL!,
        bundleDirectory: bundle,
        references: async (c) => {
          failedDatabase = (await c.query("SELECT current_database() AS name"))
            .rows[0].name;
          return listPlatformBackupReferences(c);
        },
        destinationDirectory: failure === "runtime" ? failedDirectory : undefined,
        probe:
          failure === "probe"
            ? async () => {
                throw Error("OPS_PROBE_REJECTED");
              }
            : undefined,
      }),
      failure === "runtime" ? { code: "28P01" } : /OPS_PROBE_REJECTED/,
    );
    assert.ok(failedDatabase);
    assert.equal(
      (
        await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
          failedDatabase,
        ])
      ).rowCount,
      0,
    );
    await assert.rejects(readdir(failedDirectory), { code: "ENOENT" });
  }
  // Retained restore and no-overwrite are covered with their own bound source in host-ops.
  console.log(
    JSON.stringify({
      snapshotLateCommitExcluded: true,
      downloads: 2,
      artifactAndAttachment: true,
      sourceBytesRemoved: true,
      corruptionRejected: ["blob", "dump", "reference"],
      noRestoreDatabaseLeak: true,
      failedConnectionAndProbeCleaned: true,
      cliCreateVerifyRepeat: true,
    }),
  );
});

test("organization branding backup copies real A/B images into its own namespace and restores snapshot", async () => {
  // The earlier disaster-recovery case removed its source; recover only its own synthetic fixture blobs.
  await cp(join(directory,"cli-backup","blobs"),blobsDirectory,{recursive:true});
  const sharp = (await import("sharp")).default;
  const { createHash } = await import("node:crypto");
  const owner=await user(), other=await user();
  const orgA=ok(await call("POST","/organizations",owner,{name:"Brand backup A"}),201).organization.id;
  const orgB=ok(await call("POST","/organizations",other,{name:"Brand backup B"}),201).organization.id;
  const imageA=await sharp({create:{width:400,height:250,channels:4,background:"red"}}).png().toBuffer();
  const imageB=await sharp({create:{width:2200,height:1600,channels:3,background:"blue"}}).png().toBuffer();
  async function upload(org:string,actor:any,purpose:string,bytes:Buffer,publicBackground=false) {
    const boundary='orgmap-boundary',payload=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="brand.png"\r\nContent-Type: image/png\r\n\r\n`),bytes,Buffer.from(publicBackground?`\r\n--${boundary}\r\nContent-Disposition: form-data; name="publish"\r\n\r\ntrue\r\n--${boundary}--\r\n`:`\r\n--${boundary}--\r\n`)]);
    const response=await app.inject({method:"POST",url:`/api/v1/organizations/${org}/administration/branding-assets/${purpose}`,headers:{origin,cookie:actor.cookie,"x-csrf-token":actor.csrf,"idempotency-key":randomUUID(),"if-match":'"0"',"content-type":`multipart/form-data; boundary=${boundary}`},payload});
    return ok(response).asset;
  }
  const first=await upload(orgA,owner,"workspace-logo",imageA),second=await upload(orgB,other,"login-background",imageB,true);
  const accountUpload=await app.inject({method:'POST',url:'/api/v1/account/media/photo',headers:{origin,cookie:owner.cookie,'x-csrf-token':owner.csrf,'idempotency-key':randomUUID(),'if-match':'"0"'},payload:{base64:imageA.toString('base64')}}); assert.equal(accountUpload.statusCode,200,accountUpload.body);
  const accountBefore=await app.inject({method:'GET',url:'/api/v1/account/media/photo',headers:{cookie:owner.cookie}}); assert.equal(accountBefore.statusCode,200,accountBefore.body);
  const brandingDirectory=join(blobsDirectory,"organization-branding");
  const bundle=join(directory,'branding-backup');
  const options={adminUrl:process.env.MIGRATION_DATABASE_URL!,bundleDirectory:bundle,blobsDirectory,brandingDirectory,accountMediaDirectory:blobsDirectory,references:listPlatformBackupReferences,lifecycleLedgerDirectory};
  const result=await createBackup(options);assert.equal(result.format,'orgmap-local-backup-v5');assert.equal(result.brandingReferences,2);assert.equal(result.accountMediaReferences,1);
  const manifest=await validateBundle(bundle);assert.equal(manifest.brandingReferences?.length,2);
  const refs=manifest.brandingReferences!,accountRefs=manifest.accountMediaReferences!;assert.equal(accountRefs.length,1);assert.equal(accountRefs[0].owner,'ACCOUNT');assert.equal(accountRefs[0].storageNamespace,'ACCOUNT_ASSETS');assert.deepEqual(await readFile(join(bundle,'account-assets',accountRefs[0].key)),accountBefore.rawPayload);assert.deepEqual(new Set(refs.map(r=>r.organizationId)),new Set([orgA,orgB]));
  for(const ref of refs) {const data=await readFile(join(bundle,'org-branding',ref.key));assert.equal(createHash('sha256').update(data).digest('hex'),ref.sha256);assert.equal(data.length,ref.size);assert.equal(ref.owner,'ORGANIZATION');assert.equal(ref.storageNamespace,'ORG_BRANDING');}
  const cliV3=join(directory,'branding-cli-backup'),cliEnv={ORGMAP_INTEGRATION_CONFIG:join(directory,'operator.json'),ORGMAP_LIFECYCLE_LEDGER_DIRECTORY:lifecycleLedgerDirectory};
  const cliCreated=JSON.parse((await child(['scripts/backup.ts','create',cliV3],cliEnv)).trim());assert.equal(cliCreated.format,'orgmap-local-backup-v5');assert.equal(cliCreated.brandingReferences,2);assert.equal(cliCreated.accountMediaReferences,1);
  const cliChecked=JSON.parse((await child(['scripts/backup.ts','verify',cliV3],cliEnv)).trim());assert.equal(cliChecked.backupFormat,'orgmap-local-backup-v5');assert.equal(cliChecked.brandingReferences,2);assert.equal(cliChecked.accountMediaReferences,1);assert.equal(cliChecked.restoredDatabaseRemoved,true);
  const noRoot=join(directory,'branding-no-root');await assert.rejects(createBackup({...options,bundleDirectory:noRoot,brandingDirectory:undefined}));
  for(const [org,actor,purpose] of [[orgA,owner,'workspace-logo'],[orgB,other,'login-background']] as const){const r=await app.inject({method:'DELETE',url:`/api/v1/organizations/${org}/administration/branding-assets/${purpose}`,headers:{origin,cookie:actor.cookie,'x-csrf-token':actor.csrf,'idempotency-key':randomUUID(),'if-match':'"1"'}});assert.equal(r.statusCode,200,r.body);}
  assert.equal((await app.inject({method:'GET',url:second.readUrl})).statusCode,404);
  assert.equal(first.revision,1);const accountAfter=await app.inject({method:'GET',url:'/api/v1/account/media/photo',headers:{cookie:owner.cookie}});assert.deepEqual(accountAfter.rawPayload,accountBefore.rawPayload);
  const accountDelete=await app.inject({method:'DELETE',url:'/api/v1/account/media/photo',headers:{origin,cookie:owner.cookie,'x-csrf-token':owner.csrf,'idempotency-key':randomUUID(),'if-match':'"1"'}});assert.equal(accountDelete.statusCode,200,accountDelete.body);
  const proofRestored=await withBoundRestore({lifecycleLedgerDirectory,adminUrl:options.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bundle,references:listPlatformBackupReferences},async ctx=>{
    assert.ok(ctx.brandingDirectory);const client=new pg.Client({connectionString:ctx.runtimeUrl});await client.connect();try{for(const ref of refs){await client.query('BEGIN');await client.query("SELECT set_config('orgmap.organization_id',$1,true)",[ref.organizationId]);const row=(await client.query("SELECT origin,asset_id FROM administration_branding_assets WHERE purpose=$1",[ref.purpose])).rows[0];await client.query('COMMIT');assert.equal(row.origin,'UPLOADED');assert.equal(row.asset_id,ref.assetId);assert.equal(createHash('sha256').update(await readFile(join(ctx.brandingDirectory!,ref.key))).digest('hex'),ref.sha256);}const accountRow=(await client.query("SELECT state,asset_id FROM account_media WHERE account_id=$1 AND kind='PHOTO'",[accountRefs[0].accountId])).rows[0];assert.equal(accountRow.state,'ACTIVE');assert.equal(accountRow.asset_id,accountRefs[0].assetId);assert.deepEqual(await readFile(join(ctx.blobsDirectory,accountRefs[0].key)),accountBefore.rawPayload);}finally{await client.end();}
    const proof=JSON.parse((await ctx.runChild(`
      const {buildApp}=await import('./server/src/app.ts');
      const {createOrgMapIntegration}=await import('./server/integration/index.ts');
      const {pool}=await import('./server/src/db.ts');
      const {createHash}=await import('node:crypto');
      const app=await buildApp([createOrgMapIntegration({blobsDirectory:process.env.OPS_RESTORED_BLOBS})],{migrationMaxPrefix:999});
      try {const photo=await app.inject({method:'GET',url:'/api/v1/account/media/photo',headers:{cookie:process.env.OPS_OWNER_COOKIE}});const logo=await app.inject({method:'GET',url:process.env.OPS_WORKSPACE_URL,headers:{cookie:process.env.OPS_OWNER_COOKIE}});const bg=await app.inject({method:'GET',url:process.env.OPS_BACKGROUND_URL});const sha=r=>createHash('sha256').update(r.rawPayload).digest('hex');console.log(JSON.stringify({photoStatus:photo.statusCode,logoStatus:logo.statusCode,bgStatus:bg.statusCode,photoHash:sha(photo),logoHash:sha(logo),bgHash:sha(bg)}));}finally{await app.close();await pool.end();}
    `,{OPS_RESTORED_BLOBS:ctx.blobsDirectory,OPS_OWNER_COOKIE:owner.cookie,OPS_WORKSPACE_URL:first.readUrl,OPS_BACKGROUND_URL:second.readUrl})).trim());
    assert.equal(proof.photoStatus,200);assert.equal(proof.logoStatus,200);assert.equal(proof.bgStatus,200);assert.equal(proof.photoHash,accountRefs[0].sha256);assert.equal(proof.logoHash,refs.find(r=>r.organizationId===orgA)!.sha256);assert.equal(proof.bgHash,refs.find(r=>r.organizationId===orgB)!.sha256);return true;
  });assert.equal(proofRestored,true);
  for(const mode of ['missing','corrupt','account-missing','account-corrupt'] as const){const bad=join(directory,'branding-'+mode);await cp(bundle,bad,{recursive:true});const target=mode.startsWith('account-')?join(bad,'account-assets',accountRefs[0].key):join(bad,'org-branding',refs[0].key);if(mode.endsWith('missing'))await rm(target);else await writeFile(target,'corrupt');await assert.rejects(validateBundle(bad));await assert.rejects(restoreBackup({lifecycleLedgerDirectory,adminUrl:options.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bad,references:listPlatformBackupReferences}));}
});

test('ledger authority fences old restored organization, preserves other and rejects mismatched or missing authority',async()=>{
  // The preceding synthetic case removes several source references; use its own complete CLI copy to restore fixture inputs.
  try { await cp(join(directory,'cli-backup','blobs'),blobsDirectory,{recursive:true}); }
  catch(error:any) { if(error.code!=='ENOENT')throw error; await (await import('node:fs/promises')).mkdir(blobsDirectory,{recursive:true}); }
  const owner=await user();const A=ok(await call('POST','/organizations',owner,{name:'Ledger A'}),201),B=ok(await call('POST','/organizations',owner,{name:'Ledger B'}),201);
  const bundle=join(directory,'ledger-baseline');
  const opts={adminUrl:process.env.MIGRATION_DATABASE_URL!,bundleDirectory:bundle,blobsDirectory,brandingDirectory:join(blobsDirectory,'organization-branding'),accountMediaDirectory:blobsDirectory,references:listPlatformBackupReferences,lifecycleLedgerDirectory};
  const backup=await createBackup(opts);assert.equal(backup.format,'orgmap-local-backup-v5');assert.equal(backup.lifecycleProtection,'BASELINE_RECORDED');
  const accepted={organizationId:A.organization.id,jobId:randomUUID(),fence:'2',acceptedAt:new Date().toISOString()};
  const cut=await admin.connect();try{await cut.query('BEGIN');await cut.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[A.organization.id]);await cut.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[A.organization.id]);await cut.query('COMMIT');}catch(e){await cut.query('ROLLBACK');throw e;}finally{cut.release();}await ledger.confirm(accepted);
  const proof=await withBoundRestore({adminUrl:opts.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bundle,references:listPlatformBackupReferences,lifecycleLedgerDirectory},async ctx=>{
    const proof=JSON.parse((await ctx.runChild(`
      const {buildApp}=await import('./server/src/app.ts');const {createOrgMapIntegration}=await import('./server/integration/index.ts');const {pool}=await import('./server/src/db.ts');
      const app=await buildApp([createOrgMapIntegration({blobsDirectory:process.env.OPS_RESTORED_BLOBS})],{migrationMaxPrefix:999});
      try {const headers={cookie:process.env.OPS_OWNER_COOKIE};const a=await app.inject({method:'GET',url:process.env.OPS_ORG_A+'/structure',headers});const b=await app.inject({method:'GET',url:process.env.OPS_ORG_B+'/structure',headers});const me=await app.inject({method:'GET',url:'/api/v1/account',headers});console.log(JSON.stringify({a:a.statusCode,b:b.statusCode,account:me.statusCode}));} finally {await app.close();await pool.end();}
    `,{OPS_RESTORED_BLOBS:ctx.blobsDirectory,OPS_OWNER_COOKIE:owner.cookie,OPS_ORG_A:`/api/v1/organizations/${A.organization.id}`,OPS_ORG_B:`/api/v1/organizations/${B.organization.id}`})).trim());
    assert.deepEqual(proof,{a:404,b:200,account:200});return proof;
  });
  assert.deepEqual(proof,{a:404,b:200,account:200});
  const restored=await restoreBackup({adminUrl:opts.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bundle,references:listPlatformBackupReferences,lifecycleLedgerDirectory});
  assert.equal(restored.lifecycleProtection,'BASELINE_VERIFIED');assert.equal(restored.readiness,'VERIFIED_ISOLATED_NOT_BOUND');assert.equal(restored.lifecycleReconciliation.closed,1);assert.equal(restored.lifecycleReconciliation.missingJobs,1);assert.equal(restored.lifecycleReconciliation.backupCopies,'UNKNOWN');
  await assert.rejects(restoreBackup({adminUrl:opts.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bundle,references:listPlatformBackupReferences}),/LIFECYCLE_LEDGER_REQUIRED/);
  const wrong=join(directory,'wrong-ledger');await OrganizationLedger.initialize(wrong);await assert.rejects(restoreBackup({adminUrl:opts.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bundle,references:listPlatformBackupReferences,lifecycleLedgerDirectory:wrong}),/AUTHORITY_MISMATCH/);
  const currentBundle=join(directory,'ledger-new-baseline');await createBackup({...opts,bundleDirectory:currentBundle});
  const removed=join(lifecycleLedgerDirectory,accepted.organizationId+'.json');const entry=await readFile(removed);await rm(removed);
  try {await assert.rejects(restoreBackup({adminUrl:opts.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:currentBundle,references:listPlatformBackupReferences,lifecycleLedgerDirectory}),/LIFECYCLE_LEDGER_STALE/);} finally {await writeFile(removed,entry,{mode:0o600,flag:'wx'});}
});

test('legacy pre-508 dump is checked, upgraded and reconciled before access',async()=>{
  const legacyName='orgmap_legacy_'+randomUUID().replaceAll('-',''),operator=new URL(process.env.MIGRATION_DATABASE_URL!),runtime=new URL(process.env.DATABASE_URL!);operator.pathname='/'+legacyName;runtime.pathname='/'+legacyName;let created=false;
  try {
    await admin.query('CREATE DATABASE "'+legacyName+'"');created=true;
    await child(['server/src/migrate.ts'],{MIGRATION_DATABASE_URL:operator.href,DATABASE_URL:runtime.href,MIGRATION_MAX_PREFIX:'507'});
    const legacy=new pg.Pool({connectionString:operator.href});const orgA=randomUUID(),orgB=randomUUID();
    try {assert.equal((await legacy.query("SELECT to_regclass('public.organization_lifecycle') AS name")).rows[0].name,null);await legacy.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Legacy A','pt-BR','America/Sao_Paulo'),($2,'Legacy B','pt-BR','America/Sao_Paulo')",[orgA,orgB]);}finally{await legacy.end();}
    const bundle=join(directory,'legacy-before-508');await createBackup({adminUrl:operator.href,bundleDirectory:bundle,blobsDirectory,references:listPlatformBackupReferences,lifecycleLedgerDirectory});
    await ledger.confirm({organizationId:orgA,jobId:randomUUID(),fence:'2',acceptedAt:new Date().toISOString()});
    const restored=await restoreBackup({adminUrl:process.env.MIGRATION_DATABASE_URL!,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bundle,references:listPlatformBackupReferences,lifecycleLedgerDirectory,probe:async ctx=>{const c=new pg.Client({connectionString:ctx.runtimeUrl});await c.connect();try{const rows=(await c.query('SELECT organization_id,state,fence::text FROM organization_lifecycle WHERE organization_id=ANY($1::uuid[]) ORDER BY organization_id',[[orgA,orgB]])).rows;assert.equal(rows.find(r=>r.organization_id===orgA)?.state,'DELETION_PENDING');assert.equal(rows.find(r=>r.organization_id===orgB)?.state,'ACTIVE');return true;}finally{await c.end();}}});assert.equal(restored.proof,true);
  } finally {if(created){await admin.query('DROP DATABASE IF EXISTS "'+legacyName+'" WITH (FORCE)');assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[legacyName])).rowCount,0);console.log(JSON.stringify({legacyCleanup:{database:legacyName,databaseAbsent:true}}));}}
});

test('v5 backup refuses WRITING and preserves READY beside an ACTIVE image',async()=>{
  const {createHash}=await import('node:crypto'), sharp=(await import('sharp')).default;
  const owner=await user(),org=ok(await call('POST','/organizations',owner,{name:'Stage snapshot'}),201),base=`/organizations/${org.organization.id}`;
  const active=await sharp({create:{width:20,height:10,channels:3,background:'red'}}).png().toBuffer(),ready=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).png().toBuffer();
  const response=await app.inject({method:'POST',url:`/api/v1${base}/administration/branding-assets/email-logo`,headers:{origin,cookie:owner.cookie,'x-csrf-token':owner.csrf,'idempotency-key':randomUUID(),'if-match':'"0"'},payload:{base64:active.toString('base64')}});ok(response);
  const stage=randomUUID(),key=randomUUID(),sha=createHash('sha256').update(ready).digest('hex');
  await admin.query(`INSERT INTO administration_branding_stages(id,organization_id,actor_id,credential_scope,purpose,request_key,request_hash,lifecycle_fence,base_revision,blob_key,sha256,size,width,height,write_token,writer_host,writer_pid,state) VALUES($1,$2,$3,'cookie','EMAIL_LOGO',$4,$5,1,1,$6,$7,$8,20,10,$9,'fixture',1,'WRITING')`,[stage,org.organization.id,owner.id,randomUUID(),'a'.repeat(64),key,sha,ready.length,randomUUID()]);
  const options={adminUrl:process.env.MIGRATION_DATABASE_URL!,bundleDirectory:join(directory,'stage-writing'),blobsDirectory,brandingDirectory:join(blobsDirectory,'organization-branding'),accountMediaDirectory:blobsDirectory,references:listPlatformBackupReferences,lifecycleLedgerDirectory};
  await assert.rejects(createBackup(options),/BRANDING_BACKUP_WRITING_RECONCILIATION_REQUIRED/);
  await writeFile(join(options.brandingDirectory,key),ready,{mode:0o600,flag:'wx'});await admin.query("UPDATE administration_branding_stages SET state='READY' WHERE id=$1",[stage]);
  const bundle=join(directory,'stage-ready');const result=await createBackup({...options,bundleDirectory:bundle});assert.equal(result.format,'orgmap-local-backup-v5');const manifest=await validateBundle(bundle);const refs=manifest.brandingReferences!.filter(r=>r.organizationId===org.organization.id);assert.equal(refs.length,2);assert.deepEqual(new Set(refs.map(r=>r.state)),new Set(['ACTIVE','READY']));assert.equal(refs.find(r=>r.state==='READY')?.key,key);
  const restored=await restoreBackup({adminUrl:options.adminUrl,runtimeUrl:process.env.DATABASE_URL!,bundleDirectory:bundle,references:listPlatformBackupReferences,lifecycleLedgerDirectory,probe:async ctx=>{assert.ok(ctx.brandingDirectory);assert.deepEqual(await readFile(join(ctx.brandingDirectory,key)),ready);const p=new pg.Client({connectionString:ctx.runtimeUrl});await p.connect();try{await p.query('BEGIN');await p.query("SELECT set_config('orgmap.organization_id',$1,true)",[org.organization.id]);const state=(await p.query('SELECT state FROM administration_branding_stages WHERE id=$1',[stage])).rows[0].state;await p.query('COMMIT');assert.equal(state,'ABANDONED');}finally{await p.end();}return true;}});assert.equal(restored.proof,true);assert.equal(restored.brandingStagesRetired,1);
  const c=await admin.connect();try{await c.query('BEGIN');await c.query("UPDATE administration_branding_stages SET state='ABANDONED' WHERE id=$1",[stage]);await c.query("INSERT INTO administration_branding_gc(id,organization_id,purpose,blob_key,sha256,size,reason) VALUES($1,$2,'EMAIL_LOGO',$3,$4,$5,'UNPUBLISHED')",[stage,org.organization.id,key,sha,ready.length]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  await createBackup({...options,bundleDirectory:join(directory,'stage-abandoned')});await admin.query('DELETE FROM administration_branding_gc WHERE id=$1',[stage]);await assert.rejects(createBackup({...options,bundleDirectory:join(directory,'stage-inconsistent')}),/BRANDING_BACKUP_STAGE_INCONSISTENT/);
});

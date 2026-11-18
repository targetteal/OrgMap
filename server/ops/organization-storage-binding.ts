import { constants } from 'node:fs';
import { mkdir,open,realpath,lstat,link,unlink,readdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { loadIntegrationOptions } from '../integration/config.js';
import { assertHostDatabaseBindingLocked,withStoppedHostWriters,assertStoppedHostWritersLocked,type OrganizationHostLease } from './organization-host-lease.js';
import type { OrganizationLedger,LockedOrganizationLedger } from './organization-ledger.js';

type Client=Pick<PoolClient,'query'>;
type Identity={authorityId:string;instanceId:string;epoch:string};
type Directory={path:string;dev:string;ino:string};
type StorageRecord={version:1;binding:Identity;database:{name:string;host:string;port:number|null};platform:Directory;branding:Directory;account:Directory;configurationSha256:string};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
async function syncDir(path:string){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
async function directory(path:string):Promise<Directory>{
 const absolute=resolve(path),st=await lstat(absolute,{bigint:true}),real=await realpath(absolute);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077n)!==0n||st.uid!==BigInt(process.getuid?.()??-1))throw Error('HOST_STORAGE_DIRECTORY_UNSAFE');
 return {path:real,dev:st.dev.toString(),ino:st.ino.toString()};
}
async function projection(c:Client,binding:Identity,create:boolean,configPath=process.env.ORGMAP_INTEGRATION_CONFIG,ignoreOverrides=false):Promise<StorageRecord>{
 if(!configPath)throw Error('HOST_STORAGE_CONFIGURATION_REQUIRED');
 const options=await loadIntegrationOptions(configPath);if(!options.blobsDirectory)throw Error('HOST_STORAGE_CONFIGURATION_REQUIRED');
 const platform=resolve(options.blobsDirectory),branding=resolve(platform,'organization-branding');
 if(!ignoreOverrides && (process.env.PLATFORM_BLOBS_DIRECTORY && resolve(process.env.PLATFORM_BLOBS_DIRECTORY)!==platform ||
    process.env.ORGMAP_BRANDING_BLOBS_DIRECTORY && resolve(process.env.ORGMAP_BRANDING_BLOBS_DIRECTORY)!==branding ||
    process.env.ORGMAP_ACCOUNT_MEDIA_DIRECTORY && resolve(process.env.ORGMAP_ACCOUNT_MEDIA_DIRECTORY)!==platform))throw Error('HOST_STORAGE_OVERRIDE_MISMATCH');
 if(create){await mkdir(platform,{recursive:true,mode:0o700});await mkdir(branding,{recursive:true,mode:0o700});}
 const [p,b]=await Promise.all([directory(platform),directory(branding)]);
 const db=(await c.query("SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port")).rows[0];
 if(typeof db?.name!=='string'||typeof db.host!=='string'||(db.port!==null&&typeof db.port!=='number'))throw Error('HOST_STORAGE_DATABASE_INVALID');
 const database={name:db.name as string,host:db.host as string,port:db.port as number|null};
 const config=JSON.stringify({platform:p,branding:b,account:p});
 return {version:1,binding,database,platform:p,branding:b,account:p,configurationSha256:createHash('sha256').update(config).digest('hex')};
}
async function readRecord(path:string):Promise<unknown>{const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await f.stat();if(!st.isFile()||(st.mode&0o077)||st.size>8192)throw Error('HOST_STORAGE_MANIFEST_UNSAFE');return JSON.parse(await f.readFile('utf8'));}finally{await f.close();}}
/** Installation is explicit, before any managed writer. Existing files never overwrite. */
export async function installHostStorageBinding(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client,configPath?:string):Promise<void>{
 await withStoppedHostWriters(ledger,lease,locked=>installHostStorageBindingLocked(ledger,lease,c,locked,configPath,false));
}
/** Restricted restore/setup caller must already own the host and ledger guard. */
export async function installHostStorageBindingLocked(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client,locked:LockedOrganizationLedger,configPath:string|undefined,restoreFresh:boolean):Promise<void>{
  await assertStoppedHostWritersLocked(ledger,lease,locked);
  const binding=await assertHostDatabaseBindingLocked(ledger,lease,c,locked),record=await projection(c,binding,true,configPath,restoreFresh);
  const dir=join(ledger.directory,'.storage-bindings');try{await mkdir(dir,{mode:0o700});await syncDir(ledger.directory);}catch(e:any){if(e.code!=='EEXIST')throw e;}
  await directory(dir);const target=join(dir,`${binding.instanceId}.json`),temp=join(dir,`.pending-${randomUUID()}`);
  try{const existing=await readRecord(target);if(JSON.stringify(existing)!==JSON.stringify(record))throw Error('HOST_STORAGE_BINDING_CONFLICT');return;}
  catch(e:any){if(e.code!=='ENOENT')throw e;}
  // Fresh installation only: a restored/live old root with bytes is never
  // adopted as a new binding. Restore provisioning needs its own protocol.
  const rootNames=await readdir(record.platform.path),brandNames=await readdir(record.branding.path);
  if(rootNames.some(name=>name!=='organization-branding')||brandNames.length)throw Error('HOST_STORAGE_NOT_FRESH');
  const f=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await f.writeFile(JSON.stringify(record)+'\n');await f.sync();}finally{await f.close();}
  try{await link(temp,target);await syncDir(dir);}catch(e:any){if(e.code!=='EEXIST')throw e;if(JSON.stringify(await readRecord(target))!==JSON.stringify(record))throw Error('HOST_STORAGE_BINDING_CONFLICT');}
  finally{await unlink(temp);await syncDir(dir);}
}
/** Under the live host/ledger guard, prove roots still match the installation. */
export async function assertHostStorageBindingLocked(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client,locked:LockedOrganizationLedger):Promise<{platform:string;branding:string}> {
 const binding=await assertHostDatabaseBindingLocked(ledger,lease,c,locked);if(!uuid.test(binding.instanceId))throw Error('HOST_STORAGE_BINDING_INVALID');
 const dir=join(ledger.directory,'.storage-bindings');await directory(dir);
 const record=await readRecord(join(dir,`${binding.instanceId}.json`));const expected=await projection(c,binding,false);
 if(JSON.stringify(record)!==JSON.stringify(expected))throw Error('HOST_STORAGE_BINDING_MISMATCH');
 return {platform:expected.platform.path,branding:expected.branding.path};
}

/** Call only after a successful writer join, which prevents host rotation. */
export async function assertJoinedHostStorageBinding(ledger:OrganizationLedger,c:Client):Promise<{platform:string;branding:string}>{
 const row=(await c.query('SELECT authority_id,instance_id,epoch::text AS epoch FROM organization_runtime_identity WHERE singleton=true')).rows[0];
 if(!row || row.authority_id!==ledger.authorityId || !uuid.test(row.instance_id) || typeof row.epoch!=='string')throw Error('HOST_STORAGE_BINDING_INVALID');
 const binding:Identity={authorityId:row.authority_id,instanceId:row.instance_id,epoch:row.epoch};
 const dir=join(ledger.directory,'.storage-bindings');await directory(dir);
 const record=await readRecord(join(dir,`${binding.instanceId}.json`)),expected=await projection(c,binding,false);
 if(JSON.stringify(record)!==JSON.stringify(expected))throw Error('HOST_STORAGE_BINDING_MISMATCH');
 return {platform:expected.platform.path,branding:expected.branding.path};
}

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import type { BrandingBackupReference } from './branding-contract.js';
import { BRANDING_GC_LOCK } from './branding.js';
import { BRANDING_PURPOSES } from './branding-image.js';

type QueryClient=Pick<PoolClient,'query'>;
const locked=new WeakSet<object>();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
function validate(ref:BrandingBackupReference) {
  if(ref.owner!=='ORGANIZATION'||(ref.state!==undefined&&!['ACTIVE','READY'].includes(ref.state))||ref.storageNamespace!=='ORG_BRANDING'||!uuid.test(ref.organizationId)||!uuid.test(ref.assetId)||!uuid.test(ref.key)||!BRANDING_PURPOSES.includes(ref.purpose)||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.size)||ref.size<1||ref.size>5*1024*1024) throw Error('BRANDING_BACKUP_REFERENCE_INVALID');
}
/** The callback starts its snapshot only AFTER this session lock and finishes copying before it returns. */
export async function withBrandingBackupLock<T>(client:QueryClient, operation:()=>Promise<T>):Promise<T> {
  if(locked.has(client)) throw Error('BRANDING_BACKUP_LOCK_ALREADY_HELD');
  await client.query('SELECT pg_advisory_lock($1)',[BRANDING_GC_LOCK]); locked.add(client);
  try { return await operation(); }
  finally { locked.delete(client); await client.query('SELECT pg_advisory_unlock($1)',[BRANDING_GC_LOCK]); }
}
/** Requires BYPASSRLS operator and the lock wrapper, on the same connection and snapshot. */
export async function readBrandingBackupInventory(client:QueryClient):Promise<BrandingBackupReference[]> {
  if(!locked.has(client)) throw Error('BRANDING_BACKUP_LOCK_REQUIRED');
  return readBrandingRestoredInventory(client);
}
/** Only for an isolated restored database with no live GC. */
export async function readBrandingRestoredInventory(client:QueryClient):Promise<BrandingBackupReference[]> {
  const role=(await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(!role?.rolsuper && !role?.rolbypassrls) throw Error('BRANDING_BACKUP_OPERATOR_REQUIRED');
  const hasStages=!!(await client.query("SELECT to_regclass('public.administration_branding_stages') AS name")).rows[0]?.name;
  if(hasStages){
    if((await client.query("SELECT 1 FROM administration_branding_stages WHERE state='WRITING' LIMIT 1")).rowCount)throw Error('BRANDING_BACKUP_WRITING_RECONCILIATION_REQUIRED');
    const inconsistent=await client.query(`SELECT 1 FROM administration_branding_stages s
      WHERE s.storage_removed_at IS NULL AND ((s.state='ABANDONED' AND NOT EXISTS(SELECT 1 FROM administration_branding_gc g WHERE g.id=s.id AND g.organization_id=s.organization_id AND g.blob_key=s.blob_key AND g.sha256=s.sha256 AND g.size=s.size)) OR
       (s.state='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM administration_branding_gc g WHERE g.id=s.id AND g.organization_id=s.organization_id AND g.blob_key=s.blob_key AND g.sha256=s.sha256 AND g.size=s.size) AND NOT EXISTS(SELECT 1 FROM administration_branding_assets a WHERE a.organization_id=s.organization_id AND a.asset_id=s.id AND a.origin='UPLOADED' AND a.blob_key=s.blob_key AND a.sha256=s.sha256 AND a.size=s.size))) LIMIT 1`);
    if(inconsistent.rowCount)throw Error('BRANDING_BACKUP_STAGE_INCONSISTENT');
  }
  const rows=(await client.query("SELECT organization_id,purpose,asset_id,blob_key,sha256,size FROM administration_branding_assets WHERE origin='UPLOADED' ORDER BY organization_id,purpose")).rows;
  const refs:BrandingBackupReference[]=rows.map(r=>({owner:'ORGANIZATION',...(hasStages?{state:'ACTIVE' as const}:{}),organizationId:r.organization_id,storageNamespace:'ORG_BRANDING',purpose:r.purpose,assetId:r.asset_id,key:r.blob_key,sha256:r.sha256,size:r.size}));
  if(hasStages){const stages=(await client.query("SELECT organization_id,purpose,id,blob_key,sha256,size FROM administration_branding_stages WHERE state='READY' ORDER BY organization_id,purpose,id")).rows;refs.push(...stages.map(r=>({owner:'ORGANIZATION' as const,state:'READY' as const,organizationId:r.organization_id,storageNamespace:'ORG_BRANDING' as const,purpose:r.purpose,assetId:r.id,key:r.blob_key,sha256:r.sha256,size:r.size})));}
  validateBrandingBackupReferences(refs);
  return refs;
}
async function checkedRead(directory:string,ref:BrandingBackupReference) {
  validate(ref);const file=await open(join(resolve(directory),ref.key),constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const stat=await file.stat();if(!stat.isFile()||stat.size!==ref.size) throw Error('BRANDING_BACKUP_SIZE_MISMATCH');const data=await file.readFile();if(digest(data)!==ref.sha256)throw Error('BRANDING_BACKUP_INTEGRITY_MISMATCH');return data;}
  finally {await file.close();}
}
/** Copy to an EXCLUSIVE new directory. Caller holds snapshot lock until this finishes. */
export async function copyBrandingBackupBlobs(client:QueryClient, refs:BrandingBackupReference[], sourceDirectory:string, destinationDirectory:string):Promise<void> {
  if(!locked.has(client)) throw Error('BRANDING_BACKUP_LOCK_REQUIRED');
  await copy(refs,sourceDirectory,destinationDirectory);
}
/** Restore only into a new, separate directory; never delete or overwrite a live store. */
export async function restoreBrandingBackupBlobs(refs:BrandingBackupReference[], sourceDirectory:string, destinationDirectory:string):Promise<void> {
  await copy(refs,sourceDirectory,destinationDirectory);
}
export function validateBrandingBackupReferences(refs:BrandingBackupReference[]) {
  if (!Array.isArray(refs)) throw Error('BRANDING_BACKUP_REFERENCE_INVALID');
  const keys=new Set<string>(), assets=new Set<string>(), purposes=new Set<string>();for(const ref of refs){validate(ref);const ownerPurpose=ref.organizationId+':'+ref.purpose;if(keys.has(ref.key)||assets.has(ref.assetId)||((ref.state??'ACTIVE')==='ACTIVE'&&purposes.has(ownerPurpose)))throw Error('BRANDING_BACKUP_REFERENCE_CONFLICT');keys.add(ref.key);assets.add(ref.assetId);if((ref.state??'ACTIVE')==='ACTIVE')purposes.add(ownerPurpose);}
}
export async function verifyBrandingBackupBlobs(refs:BrandingBackupReference[], directory:string) {
  validateBrandingBackupReferences(refs);for(const ref of refs) await checkedRead(directory,ref);
}
async function copy(refs:BrandingBackupReference[], sourceDirectory:string, destinationDirectory:string) {
  const source=resolve(sourceDirectory),destination=resolve(destinationDirectory);
  if(source===destination) throw Error('BRANDING_BACKUP_DIRECTORY_COLLISION');
  validateBrandingBackupReferences(refs);
  await mkdir(destination,{mode:0o700});
  const copied=new Set<string>();for(const ref of refs){if(copied.has(ref.key))continue;const data=await checkedRead(source,ref);await writeFile(join(destination,ref.key),data,{flag:'wx',mode:0o600});copied.add(ref.key);}
}
/** Isolated restore only: pending uploads are retired, never published as a restore side effect. Caller owns the transaction. */
export async function retireRestoredBrandingStages(client:QueryClient):Promise<number> {
  const hasStages=!!(await client.query("SELECT to_regclass('public.administration_branding_stages') AS name")).rows[0]?.name;
  if(!hasStages)return 0;
  const rows=(await client.query("UPDATE administration_branding_stages SET state='ABANDONED',updated_at=clock_timestamp() WHERE state='READY' RETURNING id,organization_id,purpose,blob_key,sha256,size")).rows;
  for(const r of rows){
    await client.query("INSERT INTO administration_branding_gc(id,organization_id,purpose,blob_key,sha256,size,reason) VALUES($1,$2,$3,$4,$5,$6,'UNPUBLISHED') ON CONFLICT(id) DO NOTHING",[r.id,r.organization_id,r.purpose,r.blob_key,r.sha256,r.size]);
    const gc=(await client.query("SELECT 1 FROM administration_branding_gc WHERE id=$1 AND organization_id=$2 AND purpose=$3 AND blob_key=$4 AND sha256=$5 AND size=$6",[r.id,r.organization_id,r.purpose,r.blob_key,r.sha256,r.size])).rowCount;
    if(gc!==1)throw Error('BRANDING_RESTORE_GC_CONFLICT');
  }
  return rows.length;
}

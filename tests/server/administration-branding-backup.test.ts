import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withBrandingBackupLock,readBrandingBackupInventory,copyBrandingBackupBlobs,restoreBrandingBackupBlobs,retireRestoredBrandingStages} from '../../server/modules/administration/branding-backup.js';

test('backup lock wraps snapshot and copies only verified organization branding bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orgmap-branding-backup-'));const source=join(root,'branding'),backup=join(root,'backup'),restored=join(root,'restored'),account=join(root,'account');await mkdir(source);await mkdir(account);
 const bytes=Buffer.from('branding fixture'),other=Buffer.from('other organization'),a=randomUUID(),b=randomUUID(),accountKey=randomUUID(),aid=randomUUID(),bid=randomUUID(),oa=randomUUID(),ob=randomUUID();
 const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');await writeFile(join(source,a),bytes);await writeFile(join(source,b),other);await writeFile(join(account,accountKey),'account unchanged');
 const rows=[{organization_id:oa,purpose:'WORKSPACE_LOGO',asset_id:aid,blob_key:a,sha256:hash(bytes),size:bytes.length},{organization_id:ob,purpose:'EMAIL_LOGO',asset_id:bid,blob_key:b,sha256:hash(other),size:other.length}];const calls:string[]=[];
 const client={query:async(sql:string)=>{calls.push(sql);return {rows:sql.includes('pg_roles')?[{rolsuper:true}]:sql.includes('administration_branding_assets')?rows:[]};}} as any;
 try {await assert.rejects(()=>readBrandingBackupInventory(client),/LOCK_REQUIRED/);let refs:any[]=[];
  await withBrandingBackupLock(client,async()=>{calls.push('BEGIN SNAPSHOT');refs=await readBrandingBackupInventory(client);assert.equal(refs.length,2);await copyBrandingBackupBlobs(client,refs,source,backup);calls.push('COMMIT SNAPSHOT');});
  assert.match(calls[0],/pg_advisory_lock/);assert.equal(calls[1],'BEGIN SNAPSHOT');assert.equal(calls.at(-2),'COMMIT SNAPSHOT');assert.match(calls.at(-1)!,/pg_advisory_unlock/);
  await restoreBrandingBackupBlobs(refs,backup,restored);assert.deepEqual(await readFile(join(restored,a)),bytes);assert.deepEqual(await readFile(join(restored,b)),other);assert.equal(await readFile(join(account,accountKey),'utf8'),'account unchanged');
  await assert.rejects(()=>restoreBrandingBackupBlobs(refs,backup,restored),/EEXIST/);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('tampering, symlinks and insufficient operator privileges fail closed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orgmap-branding-backup-'));const source=join(root,'source');await mkdir(source);const key=randomUUID();const data=Buffer.from('correct'),ref={owner:'ORGANIZATION' as const,organizationId:randomUUID(),storageNamespace:'ORG_BRANDING' as const,purpose:'EMAIL_LOGO' as const,assetId:randomUUID(),key,sha256:createHash('sha256').update(data).digest('hex'),size:data.length};
 try {await writeFile(join(source,key),'tampered');await assert.rejects(()=>restoreBrandingBackupBlobs([ref],source,join(root,'bad')),/MISMATCH/);
  await rm(join(source,key));await symlink('/etc/hosts',join(source,key));await assert.rejects(()=>restoreBrandingBackupBlobs([ref],source,join(root,'symlink')));
  const client={query:async(sql:string)=>({rows:sql.includes('pg_roles')?[{rolsuper:false,rolbypassrls:false}]:[]})} as any;
  await assert.rejects(()=>withBrandingBackupLock(client,()=>readBrandingBackupInventory(client)),/OPERATOR_REQUIRED/);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('stage-aware inventory refuses in-flight and inconsistent stages and includes READY',async()=>{
 let writing=true,inconsistent=false;const org=randomUUID(),active=randomUUID(),ready=randomUUID(),keyA=randomUUID(),keyB=randomUUID();const sha='a'.repeat(64);
 const c={query:async(sql:string)=>{if(sql.includes('pg_roles'))return {rows:[{rolsuper:true}]};if(sql.includes('to_regclass'))return {rows:[{name:'administration_branding_stages'}]};if(sql.includes("state='WRITING'"))return {rows:writing?[{id:1}]:[],rowCount:writing?1:0};if(sql.includes('storage_removed_at'))return {rows:inconsistent?[{id:1}]:[],rowCount:inconsistent?1:0};if(sql.includes('FROM administration_branding_assets'))return {rows:[{organization_id:org,purpose:'EMAIL_LOGO',asset_id:active,blob_key:keyA,sha256:sha,size:3}]};if(sql.includes("state='READY'"))return {rows:[{organization_id:org,purpose:'EMAIL_LOGO',id:ready,blob_key:keyB,sha256:sha,size:4}]};return {rows:[],rowCount:0};}} as any;
 await assert.rejects(withBrandingBackupLock(c,()=>readBrandingBackupInventory(c)),/WRITING_RECONCILIATION_REQUIRED/);writing=false;inconsistent=true;await assert.rejects(withBrandingBackupLock(c,()=>readBrandingBackupInventory(c)),/STAGE_INCONSISTENT/);inconsistent=false;const refs=await withBrandingBackupLock(c,()=>readBrandingBackupInventory(c));assert.deepEqual(refs.map(r=>r.state),['ACTIVE','READY']);assert.equal(refs[1].assetId,ready);
});

test('restore retires READY into matching GC without publishing',async()=>{const stage={id:randomUUID(),organization_id:randomUUID(),purpose:'EMAIL_LOGO',blob_key:randomUUID(),sha256:'a'.repeat(64),size:20};const calls:string[]=[];const c={query:async(sql:string)=>{calls.push(sql);if(sql.includes('to_regclass'))return {rows:[{name:'administration_branding_stages'}]};if(sql.startsWith('UPDATE administration_branding_stages'))return {rows:[stage]};if(sql.startsWith('INSERT INTO administration_branding_gc'))return {rows:[],rowCount:1};if(sql.startsWith('SELECT 1 FROM administration_branding_gc'))return {rows:[{}],rowCount:1};throw Error(sql);}} as any;assert.equal(await retireRestoredBrandingStages(c),1);assert.match(calls[1],/state='ABANDONED'/);assert.match(calls[2],/UNPUBLISHED/);assert.ok(!calls.some(sql=>/state='PUBLISHED'/.test(sql)));});

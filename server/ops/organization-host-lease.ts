import { constants } from 'node:fs';
import { mkdir, open, readdir, unlink, rmdir, lstat, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import pg, { type PoolClient } from 'pg';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OrganizationLedger, type LockedOrganizationLedger } from './organization-ledger.js';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
type Client=Pick<PoolClient,'query'>;
type Identity={authorityId:string;instanceId:string;epoch:string};
type Pending={transactionId:string;from:Identity|null;to:Identity;targetPrevious:Identity|null;targetDatabase:string;targetFingerprint:string};
const identity=(v:any):Identity=>{if(!v||!uuid.test(v.authorityId)||!uuid.test(v.instanceId)||typeof v.epoch!=='string'||!/^[1-9][0-9]{0,18}$/.test(v.epoch))throw Error('HOST_BINDING_INVALID');return {authorityId:v.authorityId,instanceId:v.instanceId,epoch:v.epoch};};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function syncDir(path:string){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
async function readJson(path:string){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.size>8192||(s.mode&0o077))throw Error('HOST_BINDING_FILE_UNSAFE');return JSON.parse(await f.readFile('utf8'));}finally{await f.close();}}
async function writeOnce(dir:string,name:string,value:unknown){const temp=join(dir,'.tmp-'+randomUUID()),target=join(dir,name);const f=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}finally{await f.close();}try{await link(temp,target);await syncDir(dir);}finally{await unlink(temp).catch(()=>{});await syncDir(dir);}}
async function bindingDirectory(ledger:OrganizationLedger){const dir=join(ledger.directory,'.runtime-bindings');try{await mkdir(dir,{mode:0o700});await syncDir(ledger.directory);}catch(e:any){if(e.code!=='EEXIST')throw e;}const st=await lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077))throw Error('HOST_BINDING_DIRECTORY_UNSAFE');return dir;}
/** The exclusive lease is process lifetime state. A crash deliberately leaves it for explicit recovery. */
export async function acquireOrganizationHostLease(ledger:OrganizationLedger) {
 await OrganizationLedger.open(ledger.directory,ledger.authorityId);const dir=join(ledger.directory,'.host-lease'),token=randomUUID();
 await ledger.withExclusive(async()=>{try{await mkdir(dir,{mode:0o700});}catch(e:any){if(e.code==='EEXIST')throw Error('HOST_LEASE_HELD_OR_RECOVERY_REQUIRED');throw e;}const owner={token,pid:process.pid,host:hostname(),startedAt:new Date().toISOString()};await writeOnce(dir,'owner.json',owner);await syncDir(ledger.directory);});
 let active=true;
 return {token,assertHeld(){if(!active)throw Error('HOST_LEASE_EXPIRED');},async release(){if(!active)return;await ledger.withExclusive(async()=>{const actual=await readJson(join(dir,'owner.json'));if(actual.token!==token)throw Error('HOST_LEASE_OWNER_CHANGED');const names=await readdir(dir);if(names.some(n=>n!=='owner.json'))throw Error('HOST_WRITERS_STILL_REGISTERED');await unlink(join(dir,'owner.json'));await rmdir(dir);await syncDir(ledger.directory);active=false;});}};
}
export type OrganizationHostLease=Awaited<ReturnType<typeof acquireOrganizationHostLease>>;
/** Explicit operator action only. Never uses age; remote host or live/reused PID fails closed. */
export async function recoverAbandonedHostLease(ledger:OrganizationLedger,expectedToken:string) {
 if(!uuid.test(expectedToken))throw Error('HOST_LEASE_TOKEN_INVALID');return ledger.withExclusive(async()=>{const dir=join(ledger.directory,'.host-lease');const owner=await readJson(join(dir,'owner.json'));
 if(owner.token!==expectedToken||owner.host!==hostname()||!Number.isInteger(owner.pid)||owner.pid<1)throw Error('HOST_LEASE_RECOVERY_UNVERIFIED');
 const names=await readdir(dir);for(const name of names){if(name==='owner.json')continue;if(!/^writer-[a-f0-9-]{36}\.json$/.test(name))throw Error('HOST_LEASE_RECOVERY_UNVERIFIED');const writer=await readJson(join(dir,name));if(writer.token!==expectedToken||writer.host!==hostname()||!Number.isInteger(writer.pid)||writer.pid<1)throw Error('HOST_LEASE_RECOVERY_UNVERIFIED');try{process.kill(writer.pid,0);throw Error('HOST_WRITER_PROCESS_ALIVE');}catch(e:any){if(e.code!=='ESRCH')throw e;}}
 try{process.kill(owner.pid,0);throw Error('HOST_LEASE_PROCESS_ALIVE');}catch(e:any){if(e.code!=='ESRCH')throw e;}
 for(const name of names)if(name!=='owner.json')await unlink(join(dir,name));await unlink(join(dir,'owner.json'));await rmdir(dir);await syncDir(ledger.directory);});
}
/** A separately supervised writer must register before reading its database binding. */
export async function joinOrganizationHostLease(ledger:OrganizationLedger, token:string, c:Client){
 if(!uuid.test(token))throw Error('HOST_LEASE_TOKEN_INVALID');return ledger.withExclusive(async locked=>{const dir=join(ledger.directory,'.host-lease'),owner=await readJson(join(dir,'owner.json'));if(owner.token!==token||owner.host!==hostname()||!Number.isInteger(owner.pid)||owner.pid<1)throw Error('HOST_LEASE_JOIN_DENIED');try{process.kill(owner.pid,0);}catch{throw Error('HOST_LEASE_JOIN_DENIED');}const state=await readBinding(ledger),snapshot=await locked.snapshot();if(state.pending||!state.current||!same(state.current,await dbIdentity(c))||!same(state.currentTarget,await targetIdentity(c))||snapshot.authorityId!==ledger.authorityId||(await c.query('SELECT managed FROM organization_runtime_mode WHERE singleton=true')).rows[0]?.managed!==true)throw Error('HOST_DATABASE_BINDING_MISMATCH');await assertLedgerApplied(c,snapshot);const id=randomUUID(),name='writer-'+id+'.json';await writeOnce(dir,name,{id,pid:process.pid,host:hostname(),token});let active=true;let releasing:Promise<void>|undefined;return {
  // Read only: this may run with an Org transaction held, so never acquire the
  // ledger lock here (the restore barrier takes ledger before DB locks).
  async assertRegistered(){
   if(!active)throw Error('HOST_WRITER_REGISTRATION_REQUIRED');
   try {
    const dirStat=await lstat(dir);if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||(dirStat.mode&0o077))throw Error('HOST_WRITER_REGISTRATION_INVALID');
    const currentOwner=await readJson(join(dir,'owner.json')),current=await readJson(join(dir,name));
    if(currentOwner.token!==token||currentOwner.host!==hostname()||!Number.isInteger(currentOwner.pid)||currentOwner.pid<1 ||
       current.id!==id||current.token!==token||current.host!==hostname()||current.pid!==process.pid)throw Error('HOST_WRITER_REGISTRATION_INVALID');
    try{process.kill(currentOwner.pid,0);}catch{throw Error('HOST_WRITER_REGISTRATION_INVALID');}
    if(!active)throw Error('HOST_WRITER_REGISTRATION_REQUIRED');
   } catch(error){throw Error('HOST_WRITER_REGISTRATION_REQUIRED',{cause:error});}
  },
  async release(){if(releasing)return releasing;if(!active)return;active=false;
   releasing=ledger.withExclusive(async()=>{const current=await readJson(join(dir,name));if(current.id!==id||current.token!==token)throw Error('HOST_WRITER_OWNER_CHANGED');await unlink(join(dir,name));await syncDir(dir);});
   return releasing;
  }};});
}
/** Exclusive operator guard for recovery: no registered writer, even a dead one, may exist. */
export async function withStoppedHostWriters<T>(ledger:OrganizationLedger,lease:OrganizationHostLease,operation:(locked:LockedOrganizationLedger)=>Promise<T>):Promise<T>{
 lease.assertHeld();return ledger.withExclusive(async locked=>{await assertStoppedHostWritersLocked(ledger,lease,locked);return operation(locked);});
}
/** Caller already holds the active ledger capability; no nested lock. */
export async function assertStoppedHostWritersLocked(ledger:OrganizationLedger,lease:OrganizationHostLease,locked:LockedOrganizationLedger):Promise<void>{
 lease.assertHeld();await locked.snapshot();const dir=join(ledger.directory,'.host-lease'),owner=await readJson(join(dir,'owner.json'));if(owner.token!==lease.token||owner.host!==hostname()||owner.pid!==process.pid)throw Error('HOST_LEASE_OWNER_CHANGED');const names=await readdir(dir);if(names.some(n=>n!=='owner.json'))throw Error('HOST_WRITERS_STILL_REGISTERED');
}
/** Supervisor-only: identify and clean registrations of its own already-reaped children. */
export async function listHostWriters(ledger:OrganizationLedger,lease:OrganizationHostLease){lease.assertHeld();return ledger.withExclusive(async()=>{const dir=join(ledger.directory,'.host-lease'),owner=await readJson(join(dir,'owner.json'));if(owner.token!==lease.token)throw Error('HOST_LEASE_OWNER_CHANGED');const result:{pid:number;id:string}[]=[];for(const name of await readdir(dir)){if(name==='owner.json')continue;if(!/^writer-[a-f0-9-]{36}\.json$/.test(name))throw Error('HOST_WRITER_INVALID');const writer=await readJson(join(dir,name));if(writer.token!==lease.token||writer.host!==hostname()||!Number.isInteger(writer.pid)||writer.pid<1||name!==`writer-${writer.id}.json`)throw Error('HOST_WRITER_INVALID');result.push({pid:writer.pid,id:writer.id});}return result;});}
export async function reapStoppedHostWriters(ledger:OrganizationLedger,lease:OrganizationHostLease,expectedPids:readonly number[]){lease.assertHeld();return ledger.withExclusive(async()=>{const dir=join(ledger.directory,'.host-lease'),owner=await readJson(join(dir,'owner.json'));if(owner.token!==lease.token)throw Error('HOST_LEASE_OWNER_CHANGED');for(const name of await readdir(dir)){if(name==='owner.json')continue;if(!/^writer-[a-f0-9-]{36}\.json$/.test(name))throw Error('HOST_WRITER_INVALID');const writer=await readJson(join(dir,name));if(writer.token!==lease.token||writer.host!==hostname()||!expectedPids.includes(writer.pid)||name!==`writer-${writer.id}.json`)throw Error('HOST_WRITER_RECOVERY_UNVERIFIED');try{process.kill(writer.pid,0);throw Error('HOST_WRITER_PROCESS_ALIVE');}catch(e:any){if(e.code!=='ESRCH')throw e;}await unlink(join(dir,name));}await syncDir(dir);});}
async function readBinding(ledger:OrganizationLedger) {
 const dir=await bindingDirectory(ledger),names=await readdir(dir);let pending:Pending|null=null;const commits:Array<Identity>=[],targets=new Map<string,{name:string;fingerprint:string}>();
 for(const name of names){if(/^\.tmp-[a-f0-9-]{36}$/.test(name))throw Error('HOST_BINDING_RECOVERY_REQUIRED');if(name==='pending.json'){const v=await readJson(join(dir,name));if(!uuid.test(v.transactionId)||typeof v.targetDatabase!=='string'||!/^[a-z0-9_]{1,63}$/.test(v.targetDatabase)||typeof v.targetFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.targetFingerprint))throw Error('HOST_BINDING_INVALID');pending={transactionId:v.transactionId,from:v.from===null?null:identity(v.from),to:identity(v.to),targetPrevious:v.targetPrevious===null?null:identity(v.targetPrevious),targetDatabase:v.targetDatabase,targetFingerprint:v.targetFingerprint};continue;}if(/^commit-[a-f0-9-]{36}\.json$/.test(name)){const v=await readJson(join(dir,name));if(!uuid.test(v.transactionId)||name!==`commit-${v.transactionId}.json`||typeof v.targetDatabase!=='string'||!/^[a-z0-9_]{1,63}$/.test(v.targetDatabase)||typeof v.targetFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.targetFingerprint))throw Error('HOST_BINDING_INVALID');const parsed=identity(v);if(parsed.authorityId!==ledger.authorityId)throw Error('HOST_BINDING_AUTHORITY_MISMATCH');commits.push(parsed);targets.set(parsed.epoch,{name:v.targetDatabase,fingerprint:v.targetFingerprint});continue;}throw Error('HOST_BINDING_UNEXPECTED_FILE');}
 commits.sort((a,b)=>BigInt(a.epoch)<BigInt(b.epoch)?-1:1);for(let i=0;i<commits.length;i++)if(BigInt(commits[i].epoch)!==BigInt(i+1))throw Error('HOST_BINDING_SEQUENCE_INVALID');
 const current=commits.at(-1)??null;if(pending && (pending.to.authorityId!==ledger.authorityId || (pending.from && pending.from.authorityId!==ledger.authorityId) || (pending.targetPrevious && pending.targetPrevious.authorityId!==ledger.authorityId) || BigInt(pending.to.epoch)!==BigInt(pending.from?.epoch??'0')+1n))throw Error('HOST_BINDING_INVALID');return {dir,current,currentTarget:current ? targets.get(current.epoch) ?? null : null,pending};
}
async function dbIdentity(c:Client):Promise<Identity|null>{const row=(await c.query('SELECT authority_id,instance_id,epoch::text FROM organization_runtime_identity WHERE singleton=true')).rows[0];return row?identity({authorityId:row.authority_id,instanceId:row.instance_id,epoch:row.epoch}):null;}
async function targetIdentity(c:Client){const r=(await c.query("SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port")).rows[0];return {name:r.name as string,fingerprint:createHash('sha256').update(JSON.stringify([r.name,r.host,r.port])).digest('hex')};}
async function assertLedgerApplied(c:Client,snapshot:Awaited<ReturnType<LockedOrganizationLedger['snapshot']>>) {
 if(!snapshot.entries.length)return;
 const rows=(await c.query("SELECT o.id,l.state,l.fence::text AS fence FROM organizations o LEFT JOIN organization_lifecycle l ON l.organization_id=o.id WHERE o.id=ANY($1::uuid[])",[snapshot.entries.map(e=>e.organizationId)])).rows;
 const entries=new Map(snapshot.entries.map(e=>[e.organizationId,e]));
 for(const row of rows){const entry=entries.get(row.id);if(!entry||!['DELETION_PENDING','PURGING','DELETED'].includes(row.state)||!row.fence||BigInt(row.fence)<BigInt(entry.fence))throw Error('HOST_LEDGER_RECONCILIATION_REQUIRED');}
}
/** Startup checks while holding the process lease; an old database cannot match a later binding. */
export async function assertHostDatabaseBinding(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client){lease.assertHeld();return ledger.withExclusive(locked=>assertHostDatabaseBindingLocked(ledger,lease,c,locked));}
export async function assertHostDatabaseBindingLocked(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client,locked:LockedOrganizationLedger){lease.assertHeld();const snapshot=await locked.snapshot();if(snapshot.authorityId!==ledger.authorityId)throw Error('HOST_BINDING_AUTHORITY_MISMATCH');const state=await readBinding(ledger);if(state.pending)throw Error('HOST_BINDING_RECOVERY_REQUIRED');if(!state.current||!same(state.current,await dbIdentity(c))||!same(state.currentTarget,await targetIdentity(c))||(await c.query('SELECT managed FROM organization_runtime_mode WHERE singleton=true')).rows[0]?.managed!==true)throw Error('HOST_DATABASE_BINDING_MISMATCH');await assertLedgerApplied(c,snapshot);return state.current;}
/** Fresh installation only: caller has exclusive lease, no previous binding or tombstone, and a completely empty DB. */
async function initializeFreshHostBinding(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client){lease.assertHeld();return ledger.withExclusive(async locked=>{const snap=await locked.snapshot(),state=await readBinding(ledger);if(snap.entries.length||state.pending||state.current)throw Error('HOST_INSTALL_NOT_FRESH');const target=await targetIdentity(c);await c.query('BEGIN');let to:Identity;let pending:Pending;try{await c.query('LOCK TABLE accounts,organizations,organization_runtime_identity IN EXCLUSIVE MODE');const counts=(await c.query('SELECT (SELECT count(*) FROM accounts)::int AS accounts,(SELECT count(*) FROM organizations)::int AS organizations')).rows[0];if(counts.accounts!==0||counts.organizations!==0||await dbIdentity(c))throw Error('HOST_INSTALL_NOT_FRESH');to={authorityId:ledger.authorityId,instanceId:randomUUID(),epoch:'1'};pending={transactionId:randomUUID(),from:null,to,targetPrevious:null,targetDatabase:target.name,targetFingerprint:target.fingerprint};await writeOnce(state.dir,'pending.json',pending);await c.query('INSERT INTO organization_runtime_identity(singleton,authority_id,instance_id,epoch) VALUES(true,$1,$2,$3)',[to.authorityId,to.instanceId,to.epoch]);await c.query('UPDATE organization_runtime_mode SET managed=true WHERE singleton=true');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}await writeOnce(state.dir,'commit-'+pending!.transactionId+'.json',{...to!,transactionId:pending!.transactionId,targetDatabase:pending!.targetDatabase,targetFingerprint:pending!.targetFingerprint});await unlink(join(state.dir,'pending.json'));await syncDir(state.dir);return to!;});}
/** Explicit installation provisions a database itself. It cannot adopt or disguise a restored DB. */
export async function provisionFreshHostBinding(ledger:OrganizationLedger,lease:OrganizationHostLease,operatorUrl:string,resourceEvent?: (event:{name:string;state:'PLANNED'|'CREATED'})=>Promise<void>){
 lease.assertHeld();const url=new URL(operatorUrl);if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('LOCAL_DATABASE_REQUIRED');
 await ledger.withExclusive(async locked=>{const state=await readBinding(ledger);if(state.current||state.pending||(await locked.snapshot()).entries.length)throw Error('HOST_INSTALL_NOT_FRESH');});
 const name='orgmap_fresh_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href});let created=false;
 try{await resourceEvent?.({name,state:'PLANNED'});await admin.query(`CREATE DATABASE "${name}"`);created=true;await resourceEvent?.({name,state:'CREATED'});url.pathname='/'+name;const env:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:url.href};delete env.MIGRATION_SCOPE;delete env.MIGRATION_MAX_PREFIX;
 await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('../src/migrate.ts',import.meta.url))],{env,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',v=>{error=(error+v.toString()).slice(-2000);});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('HOST_INSTALL_MIGRATION_FAILED: '+error)));});
 const target=new pg.Pool({connectionString:url.href});try{const c=await target.connect();try{const binding=await initializeFreshHostBinding(ledger,lease,c);return {database:name,binding};}finally{c.release();}}finally{await target.end();}
 }catch(e){if(created)throw new Error(`HOST_INSTALL_RECOVERY_REQUIRED:${name}`,{cause:e});throw e;}finally{await admin.end();}
}
/** Called after restore reconciliation while the destination is not serving. */
export async function rotateRestoredHostBinding(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client) {
 lease.assertHeld();return ledger.withExclusive(async locked=>rotateLocked(ledger,lease,c,locked));
}
export async function rotateLocked(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client,locked:LockedOrganizationLedger) {
 lease.assertHeld();if((await locked.snapshot()).authorityId!==ledger.authorityId)throw Error('HOST_BINDING_AUTHORITY_MISMATCH');const state=await readBinding(ledger);if(state.pending||!state.current)throw Error('HOST_BINDING_RECOVERY_REQUIRED');
 const target=await targetIdentity(c);const db=target.name;if(!/^orgmap_restore_[a-f0-9]+$/.test(db))throw Error('HOST_RESTORE_DATABASE_REQUIRED');
 const previous=await dbIdentity(c);if(previous && previous.authorityId!==ledger.authorityId)throw Error('HOST_BINDING_AUTHORITY_MISMATCH');const to={authorityId:ledger.authorityId,instanceId:randomUUID(),epoch:(BigInt(state.current.epoch)+1n).toString()};const pending:Pending={transactionId:randomUUID(),from:state.current,to,targetPrevious:previous,targetDatabase:db,targetFingerprint:target.fingerprint};
 await writeOnce(state.dir,'pending.json',pending);
 await c.query('BEGIN');try{await c.query('DELETE FROM organization_runtime_identity WHERE singleton=true');await c.query('INSERT INTO organization_runtime_identity(singleton,authority_id,instance_id,epoch) VALUES(true,$1,$2,$3)',[to.authorityId,to.instanceId,to.epoch]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
 await writeOnce(state.dir,'commit-'+pending.transactionId+'.json',{...to,transactionId:pending.transactionId,targetDatabase:pending.targetDatabase,targetFingerprint:pending.targetFingerprint});await unlink(join(state.dir,'pending.json'));await syncDir(state.dir);
 return {binding:to,previousDatabaseIdentity:previous};
}
/** Explicit recovery of unpublished temporary files; never removes a committed/pending record. */
export async function recoverBindingTemporaries(ledger:OrganizationLedger,lease:OrganizationHostLease){lease.assertHeld();return ledger.withExclusive(async()=>{const dir=await bindingDirectory(ledger);let removed=0;for(const name of await readdir(dir)){if(!/^\.tmp-[a-f0-9-]{36}$/.test(name))continue;const st=await lstat(join(dir,name));if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw Error('HOST_BINDING_FILE_UNSAFE');await unlink(join(dir,name));removed++;}if(removed)await syncDir(dir);return removed;});}
/** Operator must provide the exact recorded target DB while holding a recovered exclusive lease. */
export async function recoverPendingHostBinding(ledger:OrganizationLedger,lease:OrganizationHostLease,c:Client){lease.assertHeld();return ledger.withExclusive(async()=>{const state=await readBinding(ledger),p=state.pending;if(!p)throw Error('HOST_BINDING_NO_PENDING');const target=await targetIdentity(c);if(target.name!==p.targetDatabase||target.fingerprint!==p.targetFingerprint)throw Error('HOST_BINDING_TARGET_MISMATCH');const current=await dbIdentity(c);
 if(same(current,p.to)){if(!same(state.current,p.to)){if(!same(state.current,p.from))throw Error('HOST_BINDING_CONFLICT');await writeOnce(state.dir,'commit-'+p.transactionId+'.json',{...p.to,transactionId:p.transactionId,targetDatabase:p.targetDatabase,targetFingerprint:p.targetFingerprint});}await unlink(join(state.dir,'pending.json'));await syncDir(state.dir);return 'COMPLETED' as const;}
 if(!same(state.current,p.from)||!(current===null||same(current,p.targetPrevious)))throw Error('HOST_BINDING_CONFLICT');
 // The destination is not serving and must be made unbootable before discarding the incomplete rotation.
 await c.query('BEGIN');try{await c.query('DELETE FROM organization_runtime_identity WHERE singleton=true');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
 await unlink(join(state.dir,'pending.json'));await syncDir(state.dir);return 'ABORTED_TARGET_UNBOUND' as const;
 });}

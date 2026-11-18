/** Deterministic concurrency checks against a real isolated PostgreSQL database. */
import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import pg from 'pg';
const candidate=process.env.ORGMAP_QA_CANDIDATE??process.cwd();
const {buildApp}=await import(pathToFileURL(resolve(candidate,'server/src/app.ts')).href);
const {pool}=await import(pathToFileURL(resolve(candidate,'server/src/db.ts')).href);
const app=await buildApp();const admin=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
after(async()=>{await app.close();await pool.end();await admin.end();});
type User={id:string;cookie:string;csrf:string;email:string};
async function call(u:User|undefined,method:string,path:string,body?:unknown,extra:Record<string,string>={}){
 const response=await app.inject({method:method as any,url:'/api/v1'+path,payload:body,headers:{origin:'http://localhost:5173',...(u?{cookie:u.cookie,'x-csrf-token':u.csrf}:{}),'idempotency-key':randomUUID(),...extra}});
 const meta=response.json().meta??{};console.log(JSON.stringify({kind:'QA-request',method,path,status:response.statusCode,requestId:meta.requestId,resourceVersion:meta.resourceVersion,authorizationRevision:meta.authorizationRevision}));
 return response;
}
function data(r:any){assert.ok(r.statusCode>=200&&r.statusCode<300,'Unexpected '+r.statusCode+' '+r.json().error?.code);return r.json().data;}
async function user():Promise<User>{const email='qa-security-'+randomUUID()+'@example.invalid';const r=await call(undefined,'POST','/auth/register',{email,password:randomUUID()+randomUUID(),displayName:'QA concurrency'});const d=data(r);return {id:d.account.id,email,cookie:r.cookies[0].name+'='+r.cookies[0].value,csrf:d.csrfToken};}
async function observe(fn:()=>Promise<any>,label:string){const until=Date.now()+5000;while(Date.now()<until){const result=await fn();if(result)return result;await delay(10);}throw Error('No authoritative lock observation: '+label);}
async function blockedBy(pid:number){return observe(async()=>{const r=await admin.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))",[pid]);return r.rows[0]?.pid;},'request blocked by test guard');}
/** Allow either correct serialization order; reject command after completed logout. */
async function logoutRace(u:User,start:()=>Promise<any>){
 const guard=await admin.connect();let pending:Promise<any>|undefined,logout:Promise<any>|undefined;let logoutDone=false,logoutResult:any;let beforeRelease=false;
 try{
  await guard.query('BEGIN');await guard.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[u.id]);const guardPid=(await guard.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  pending=Promise.resolve(start());const commandPid=await blockedBy(guardPid);
  logout=Promise.resolve(call(u,'POST','/auth/logout',{})).then(r=>{logoutDone=true;logoutResult=r;return r;});
  await observe(async()=>{
   if(logoutDone){beforeRelease=true;return true;}
   const waits=await admin.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>$1 AND pid<>$2",[guardPid,commandPid]);return waits.rowCount>0;
  },'logout committed or blocked behind command');
  await guard.query('ROLLBACK');
  const result=await pending;await logout;assert.equal(logoutResult.statusCode,200);
  if(beforeRelease)assert.equal(result.statusCode,401,'Command/replay must be denied after logout committed while waiting');
  else assert.ok([200,201,401].includes(result.statusCode),'Only serialized success or revoked-session rejection allowed');
  assert.equal((await call(u,'GET','/me')).statusCode,401);
  return {result,logoutCommittedBeforeGuardReleased:beforeRelease};
 }finally{await guard.query('ROLLBACK');guard.release();if(pending)await pending.catch(()=>{});if(logout)await logout.catch(()=>{});}
}
for(const replay of [false,true])test('logout × create organization '+(replay?'replay':'first write'),async()=>{
 const u=await user(),key=randomUUID(),body={name:'QA guarded '+randomUUID()};
 if(replay)data(await call(u,'POST','/organizations',body,{'idempotency-key':key}));
 const before=Number((await admin.query('SELECT count(*) FROM members WHERE account_id=$1',[u.id])).rows[0].count);
 const outcome=await logoutRace(u,()=>Promise.resolve(call(u,'POST','/organizations',body,{'idempotency-key':key})));
 if(outcome.logoutCommittedBeforeGuardReleased)assert.equal(Number((await admin.query('SELECT count(*) FROM members WHERE account_id=$1',[u.id])).rows[0].count),before);
});
for(const replay of [false,true])test('logout × invitation acceptance '+(replay?'replay':'first write'),async()=>{
 const owner=await user(),invitee=await user();const org=data(await call(owner,'POST','/organizations',{name:'QA invitation '+randomUUID()}));
 const invitation=data(await call(owner,'POST','/organizations/'+org.organization.id+'/invitations',{email:invitee.email}));
 const token=(await admin.query('SELECT token FROM invitation_delivery WHERE organization_id=$1 AND invitation_id=$2',[org.organization.id,invitation.invitation.id])).rows[0].token;
 const key=randomUUID();if(replay)data(await call(invitee,'POST','/invitations/accept',{token},{'idempotency-key':key}));
 const outcome=await logoutRace(invitee,()=>Promise.resolve(call(invitee,'POST','/invitations/accept',{token},{'idempotency-key':key})));
 if(outcome.logoutCommittedBeforeGuardReleased&&!replay)assert.equal((await admin.query('SELECT 1 FROM members WHERE organization_id=$1 AND account_id=$2',[org.organization.id,invitee.id])).rowCount,0);
});
test('Session expires while waiting for organization guard',async()=>{
 const u=await user();const org=data(await call(u,'POST','/organizations',{name:'QA expiry '+randomUUID()}));const p='/organizations/'+org.organization.id;
 const guard=await admin.connect();let pending:Promise<any>|undefined;
 try{
  const token=u.cookie.slice(u.cookie.indexOf('=')+1);const hash=createHash('sha256').update(token).digest('hex');
  await admin.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1",[hash]);
  await guard.query('BEGIN');await guard.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org.organization.id]);const pid=(await guard.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  pending=Promise.resolve(call(u,'POST',p+'/roles',{circleId:org.rootCircle.id,name:'Expired command',mode:'DIRECT'}));await blockedBy(pid);
  await observe(async()=>(await admin.query('SELECT expires_at<=clock_timestamp() expired FROM sessions WHERE token_hash=$1',[hash])).rows[0].expired,'database clock crossed expiry');
  await guard.query('ROLLBACK');const result=await pending;assert.equal(result.statusCode,401,'Post-lock recheck must use wall clock rather than transaction start');
  assert.equal((await admin.query("SELECT 1 FROM entities WHERE organization_id=$1 AND kind='ROLE'",[org.organization.id])).rowCount,0);
 }finally{await guard.query('ROLLBACK');guard.release();if(pending)await pending.catch(()=>{});}
});

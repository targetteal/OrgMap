import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {buildApp} from '../../server/src/app.js';
import {pool,transaction} from '../../server/src/db.js';
import {defaultAdmissionPolicy} from '../../server/src/admission-contract.js';

test('real create and accept command shapes preserve B and reject cross-tenant fields',async()=>{
 const runtime=new URL(process.env.DATABASE_URL??'postgres://invalid/'); const operator=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://invalid/');
 if(!/^\/orgmap_integration_[a-f0-9]{32}$/.test(runtime.pathname)||runtime.pathname!==operator.pathname||runtime.host!==operator.host||!['127.0.0.1','localhost','[::1]'].includes(runtime.hostname))throw Error('EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED');
 const admin=new pg.Pool({connectionString:operator.href});
 const app=await buildApp([async(_app,core)=>{core.registerAdmissionPolicyProvider({resolve:async()=>defaultAdmissionPolicy()});}]);
 const call=(method:'POST',path:string,payload:any,user?:{cookie:string;csrf:string},idempotency=randomUUID())=>app.inject({method,url:'/api/v1'+path,payload,headers:{origin:'http://localhost:5173','idempotency-key':idempotency,...(user?{cookie:user.cookie,'x-csrf-token':user.csrf}:{})}});
 const data=(r:any)=>{assert.ok([200,201].includes(r.statusCode),r.body);return r.json().data;};
 try {
  const register=async()=>{const email=randomUUID()+'@example.test',response=await call('POST','/auth/register',{email,password:'Synthetic-password-739!',displayName:'Global'});const d=data(response);return {email,id:d.account.id as string,cookie:response.cookies[0].name+'='+response.cookies[0].value,csrf:d.csrfToken as string};};
  const owner=await register(), target=await register(), a=randomUUID(), createKey=randomUUID();
  const created=data(await call('POST','/organizations',{name:`B contains ${a}`},owner,createKey)), b=created.organization.id;
  const issued=data(await call('POST',`/organizations/${b}/invitations`,{email:target.email},owner));
  const token=await transaction(async c=>{await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[b]);return (await c.query('SELECT token FROM invitation_delivery WHERE organization_id=$1 AND id=$2',[b,issued.deliveryJobId])).rows[0].token;});
  const acceptKey=randomUUID(); data(await call('POST','/invitations/accept',{token},target,acceptKey));
  const commands=(await admin.query("SELECT account_id,key,result FROM account_commands WHERE (account_id=$1 AND key=$2) OR (account_id=$3 AND key=$4)",[owner.id,'organization.create:'+createKey,target.id,'invitation.accept:'+acceptKey])).rows;
  assert.equal(commands.length,2);
  for(const command of commands) assert.equal((await admin.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[command.account_id,command.key,command.result])).rows[0].valid,true,command.key);
  const create=commands.find(x=>x.key.startsWith('organization.create:'))!; const accept=commands.find(x=>x.key.startsWith('invitation.accept:'))!;
  const {responsibilities,artifacts,...legacyRoot}=create.result.rootCircle;
  assert.deepEqual([responsibilities,artifacts],[[],[]]);
  assert.equal((await admin.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[owner.id,create.key,{...create.result,rootCircle:legacyRoot}])).rows[0].valid,true);
  assert.equal((await admin.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[owner.id,create.key,{...create.result,rootCircle:{...create.result.rootCircle,responsibilities:[{id:randomUUID(),text:'forged'}]}}])).rows[0].valid,false);
  assert.notEqual((await admin.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[owner.id,create.key,{...create.result,rootCircle:{...create.result.rootCircle,organizationId:a}}])).rows[0].valid,true);
  assert.notEqual((await admin.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[target.id,accept.key,{...accept.result,membership:{...accept.result.membership,organizationId:a}}])).rows[0].valid,true);
 } finally {await app.close();await pool.end();await admin.end();}
});

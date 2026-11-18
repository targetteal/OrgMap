import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/src/app.js';
import { pool } from '../../server/src/db.js';
import type { ModuleRuntime } from '../../server/src/runtime.js';
import { createOrgMapIntegration } from '../../server/integration/index.js';
const directory = await mkdtemp(join(tmpdir(), 'orgmap-interop-guest-'));
let core: ModuleRuntime;
const app = await buildApp([async (app, runtime) => {
  core = runtime;
  await createOrgMapIntegration({ blobsDirectory: directory })(app, runtime);
}], { migrationMaxPrefix: 999 });
after(async () => { await app.close(); await pool.end(); await rm(directory, {recursive:true,force:true}); });
async function call(method:string,path:string,user?:any,payload?:any,headers:any={}) {
  return app.inject({method:method as any,url:'/api/v1'+path,payload,headers:{origin:'http://localhost:5173','idempotency-key':randomUUID(),...(user?{cookie:user.cookie,'x-csrf-token':user.csrf}:{}),...headers}});
}
function data(r:any) { assert.ok([200,201].includes(r.statusCode),r.body); return r.json().data; }
async function user() {
 const r=await call('POST','/auth/register',undefined,{email:randomUUID()+'@example.test',password:'synthetic-guest-agent-123',displayName:'Synthetic guest agent'});
 const d=data(r);return {id:d.account.id,cookie:r.cookies[0].name+'='+r.cookies[0].value,csrf:d.csrfToken};
}
test('Guest bearer MCP/API re-enters real shared structure, denies private IDs/metadata/replay and revoked grants; worker fails closed',async()=>{
 const owner=await user(),actor=await user();
 const org=data(await call('POST','/organizations',owner,{name:'Guest agent organization'}));
 const p='/organizations/'+org.organization.id,base=p+'/interoperability';
 const shared=data(await call('POST',p+'/circles',owner,{parentCircleId:org.rootCircle.id,name:'Shared circle',mode:'DIRECT'})).circle;
 const hidden=data(await call('POST',p+'/circles',owner,{parentCircleId:org.rootCircle.id,name:'Private secret circle',mode:'DIRECT'})).circle;
 const membership=data(await call('POST',p+'/members',owner,{accountId:actor.id})).membership;
 const key=data(await call('POST',base+'/credentials',actor,{label:'Pre-downgrade actor key',kind:'API',scopes:['interop.read','structure.read','structure.create','work.project.create'],expiresAt:new Date(Date.now()+86400000).toISOString()}));
 const headers={authorization:'Bearer '+key.secret,accept:'application/json, text/event-stream'};
 async function tool(name:string,args:any={}) {const r=await call('POST',base+'/mcp',undefined,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},headers);assert.equal(r.statusCode,200,r.body);return r.json().result;}
 assert.equal((await tool('orgmap_circle_get',{entityId:hidden.id})).isError,undefined);
 const replayKey=randomUUID();
 const priorCreate={title:'Created before downgrade',visibility:'PRIVATE',idempotencyKey:replayKey};
 assert.equal((await tool('orgmap_project_create',priorCreate)).isError,undefined);
 data(await call('POST',p+'/members/'+membership.id+'/actions/change-type',owner,{memberType:'GUEST',confirmVisibilityChange:true},{'if-match':'"'+membership.version+'"'}));
 data(await call('POST',p+'/members/'+membership.id+'/access-grants',owner,{accessPlan:[{resource:{context:'structure',kind:'circle',id:shared.id},actions:['read']}]}));
 const permitted=await tool('orgmap_circle_get',{entityId:shared.id});assert.equal(permitted.isError,undefined);assert.ok(JSON.stringify(permitted).includes('Shared circle'));
 const denied=await tool('orgmap_circle_get',{entityId:hidden.id});assert.equal(denied.isError,true);assert.ok(!JSON.stringify(denied).includes('Private secret circle'));
 assert.equal((await call('GET',p+'/circles/'+shared.id,undefined,undefined,headers)).statusCode,200);
 assert.equal((await call('GET',p+'/circles/'+hidden.id,undefined,undefined,headers)).statusCode,404);
 const named=data(await call('POST',base+'/commands/orgmap_circle_get',undefined,{entityId:shared.id},headers));assert.equal(named.entity.id,shared.id);
 const forest=await tool('orgmap_structure_list');const forestText=JSON.stringify(forest);assert.ok(forestText.includes('Shared circle'));assert.ok(!forestText.includes('Private secret circle'));assert.ok(!forestText.includes(hidden.id));assert.deepEqual(forest.structuredContent.data.nodes.map((n:any)=>n.entityId),[shared.id]);
 const replay=await tool('orgmap_project_create',priorCreate);assert.equal(replay.isError,true);
 const list=await call('POST',base+'/mcp',undefined,{jsonrpc:'2.0',id:2,method:'tools/list'},headers);assert.equal(list.statusCode,200,list.body);const tools=list.json().result.tools;assert.ok(tools.some((t:any)=>t.name==='orgmap_circle_get'));assert.ok(!tools.some((t:any)=>t.name==='orgmap_integration_status'||t.name==='orgmap_calendar_export'||t.name==='orgmap_task_get'));assert.ok(!list.body.includes('Private secret circle'));
 const status=await tool('orgmap_integration_status');assert.ok(status.isError);assert.ok(!JSON.stringify(status).includes('connections'));
 assert.equal((await call('GET',base,undefined,undefined,headers)).statusCode,404);
 assert.equal((await call('POST',base+'/credentials',actor,{label:'Guest denied',kind:'API',scopes:['interop.read'],expiresAt:new Date(Date.now()+86400000).toISOString()})).statusCode,404);
 await assert.rejects(()=>core.withWorkerContext(org.organization.id,membership.id,async()=>true));
 const grants=data(await call('GET',p+'/members/'+membership.id+'/access-grants',owner)).items;
 const grant=grants.find((g:any)=>g.resourceId===shared.id);assert.ok(grant);
 data(await call('POST',p+'/members/'+membership.id+'/access-grants/'+grant.id+'/revoke',owner,{}, {'if-match':'"'+grant.version+'"'}));
 assert.equal((await tool('orgmap_circle_get',{entityId:shared.id})).isError,true);
 assert.equal((await call('GET',p+'/circles/'+shared.id,undefined,undefined,headers)).statusCode,404);
});

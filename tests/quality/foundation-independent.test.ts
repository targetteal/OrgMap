/** Independent acceptance assertions; real app + configured local PostgreSQL.
 * Does not open a listener, migrate, restart services, or mark a capability complete.
 */
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const candidate=process.env.ORGMAP_QA_CANDIDATE??fileURLToPath(new URL('../../',import.meta.url));
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const {buildApp}=await import(pathToFileURL(resolve(candidate,'server/src/app.ts')).href);
const {pool}=await import(pathToFileURL(resolve(candidate,'server/src/db.ts')).href);
const app=await buildApp();
let cookie='',csrf='',orgPath='',rootId='';
async function call(method:string,path:string,payload?:unknown,extra:Record<string,string>={}) {
 return app.inject({method:method as any,url:'/api/v1'+path,payload,
  headers:{origin:'http://localhost:5173',cookie,'x-csrf-token':csrf,'idempotency-key':randomUUID(),...extra}});
}
function ok(r:any){assert.ok(r.statusCode>=200&&r.statusCode<300,`Unexpected ${r.statusCode}: ${r.json().error?.code}`);return r.json().data;}
before(async()=>{
 const r=await call('POST','/auth/register',{email:`qa-independent-${randomUUID()}@example.invalid`,password:randomUUID()+randomUUID(),displayName:'QA independent'});
 const data=ok(r);cookie=r.cookies[0].name+'='+r.cookies[0].value;csrf=data.csrfToken;
 const org=ok(await call('POST','/organizations',{name:'Independent QA '+randomUUID()}));
 orgPath='/organizations/'+org.organization.id;rootId=org.rootCircle.id;
});
after(async()=>{await app.close();await pool.end();});
test('Unicode contract: 200 codepoints accepted; 201 rejected',async()=>{
 const r=await call('POST',orgPath+'/roles',{circleId:rootId,name:'🌱'.repeat(200),mode:'DIRECT'});
 assert.ok(r.statusCode>=200&&r.statusCode<300,`200 codepoints rejected (${r.statusCode})`);
 const tooLong=await call('POST',orgPath+'/roles',{circleId:rootId,name:'🌱'.repeat(201),mode:'DIRECT'});
 assert.equal(tooLong.statusCode,400);
});
test('Canonical command body: reordered equivalent fields replay same result',async()=>{
 const key=randomUUID();const r=ok(await call('POST',orgPath+'/circles',{parentCircleId:rootId,name:'Canonical',mode:'DIRECT'},{'idempotency-key':key}));
 const again=await call('POST',orgPath+'/circles',{mode:'DIRECT',name:'Canonical',parentCircleId:rootId},{'idempotency-key':key});
 assert.ok(again.statusCode>=200&&again.statusCode<300,`Equivalent command rejected (${again.statusCode})`);
 assert.equal(again.json().data.circle.id,r.circle.id);
});
test('Transition replay includes If-Match in request hash',async()=>{
 const circle=ok(await call('POST',orgPath+'/circles',{parentCircleId:rootId,name:'Move target',mode:'DIRECT'})).circle;
 const role=ok(await call('POST',orgPath+'/roles',{circleId:rootId,name:'Mover',mode:'DIRECT'})).role;
 const key=randomUUID(),path=orgPath+'/structure/'+role.id+'/move',payload={targetCircleId:circle.id,mode:'DIRECT'};
 ok(await call('POST',path,payload,{'idempotency-key':key,'if-match':'"1"'}));
 const replay=await call('POST',path,payload,{'idempotency-key':key,'if-match':'"1"'});ok(replay);
 const changedVersion=await call('POST',path,payload,{'idempotency-key':key,'if-match':'"999"'});
 assert.equal(changedVersion.statusCode,409,'Changed expected version must not replay original success');
});
test('Unknown field rejected without changing structure revision or graph',async()=>{
 const before=ok(await call('GET',orgPath+'/structure'));
 const denied=await call('POST',orgPath+'/roles',{circleId:rootId,name:'Should not persist',mode:'DIRECT',admin:true});assert.equal(denied.statusCode,400);
 const after=ok(await call('GET',orgPath+'/structure'));assert.equal(after.structureRevision,before.structureRevision);assert.deepEqual(after.nodes,before.nodes);
});
test('Creation uses 201 according to executable contracts',async()=>{
 const r=await call('POST',orgPath+'/roles',{circleId:rootId,name:'Created status',mode:'DIRECT'});assert.equal(r.statusCode,201);
});

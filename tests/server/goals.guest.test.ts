import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createRuntime, type ModuleRuntime } from "../../server/src/runtime.js";
import { withWorkerContext } from "../../server/src/identity.js";
import { createGoalsModule } from "../../server/modules/goals/plugin.js";
import { createGoalResourceAdapters } from "../../server/modules/goals/ports.js";
import { createGoalsGuestAccessAdapter } from "../../server/modules/goals/guest.js";

// Same domain adapter factory in HTTP and an independent worker runtime.
let goalsEnabled = true;
function bind(core: ModuleRuntime) {
  // Explicit configuration fixture; both runtimes use the production domain adapter.
  core.registerOrganizationSettings(async ctx=>({version:1,settings:{name:ctx.org.name,locale:ctx.org.locale,timezone:ctx.org.time_zone,modules:{structure:true,goals:goalsEnabled}}}));
  core.registerGuestAccessAdapter(createGoalsGuestAccessAdapter(core)); return core;
}
let httpCore: ModuleRuntime;
const app=await buildApp([foundationDefaultAdmissionPolicy,async (_app,core)=>{httpCore=bind(core);},createGoalsModule()]);
after(async()=>{await app.close();await pool.end();});
type User={cookie:string;csrf:string;id:string};
async function call(method:string,path:string,payload?:any,user?:User,headers:Record<string,string>={}){
 return app.inject({method:method as any,url:"/api/v1"+path,payload,headers:{origin:"http://localhost:5173","idempotency-key":randomUUID(),...(user?{cookie:user.cookie,"x-csrf-token":user.csrf}:{}),...headers}});
}
function ok(response:any,status=200){assert.equal(response.statusCode,status,response.body);return response.json().data;}
async function user():Promise<User>{const r=await call("POST","/auth/register",{email:randomUUID()+"@example.test",displayName:"Synthetic Guest goals",password:"synthetic-goals-password-12345"});const d=ok(r,201);return {cookie:r.cookies[0].name+"="+r.cookies[0].value,csrf:d.csrfToken,id:d.account.id};}
const ref=(kind:string,id:string)=>({context:"goals",kind,id});
test("Goals Guest exact reads: no inherited goals/KRs, no foreign IDs, current grantor and worker revocation",async()=>{
 const owner=await user(),guest=await user(),outsider=await user();
 const A=ok(await call("POST","/organizations",{name:"Guest goals A"},owner),201);
 const B=ok(await call("POST","/organizations",{name:"Guest goals B"},outsider),201);
 const base="/organizations/"+A.organization.id,foreign="/organizations/"+B.organization.id;
 const period=ok(await call("POST",base+"/goal-periods",{title:"Visible period",startsOn:"2026-01-01",endsOn:"2026-12-31"},owner),201);
 const hiddenPeriod=ok(await call("POST",base+"/goal-periods",{title:"Hidden period sentinel",startsOn:"2027-01-01",endsOn:"2027-12-31"},owner),201);
 const otherMember=ok(await call("POST",base+"/members",{accountId:outsider.id},owner),201).membership;
 const make=async(title:string,parentId?:string,ownerId=A.membership.id)=>ok(await call("POST",base+"/goals",{title,ownerType:"MEMBER",ownerId,periodIds:[period.id],privacy:"PRIVATE",...(parentId?{parentId}:{})},owner),201);
 const parent=await make("Hidden parent sentinel"),shared=await make("Explicit shared goal",parent.id,otherMember.id),hidden=await make("AAA Hidden child sentinel",shared.id);
 const publicGoal=ok(await call("POST",base+"/goals",{title:"Public unshared sentinel",ownerType:"MEMBER",ownerId:A.membership.id,periodIds:[period.id],privacy:"PUBLIC"},owner),201);
 const kr=ok(await call("POST",base+"/goals/"+shared.id+"/key-results",{title:"Shared KR sentinel",resultType:"QUANTITATIVE",initialValue:"0",targetValue:"100"},owner,{"if-match":'"'+shared.version+'"'}),201);
 // The create endpoint returns the updated goal; read its authoritative KR ID/version.
 const detail=ok(await call("GET",base+"/goals/"+shared.id,undefined,owner));
 const kid=detail.keyResults[0].id;
 const configured=ok(await call("POST",base+"/goals/"+shared.id+"/progress-config",{source:"KEY_RESULTS",manualProgress:"0",krWeight:"100",childWeight:"0",keyResults:[{id:kid,weight:"1",excluded:false}],children:[{id:hidden.id,weight:"1",excluded:false}]},owner,{"if-match":'"'+detail.version+'"'}));
 const plan=[{resource:ref("goal",shared.id),actions:["read"]}];
 assert.equal((await call("POST",base+"/members",{accountId:guest.id,memberType:"GUEST",accessPlan:[{resource:ref("goal",shared.id),actions:["update"]}]},owner)).statusCode,403);
 const membership=ok(await call("POST",base+"/members",{accountId:guest.id,memberType:"GUEST",accessPlan:plan},owner),201).membership;
 const read=ok(await call("GET",base+"/goals/"+shared.id,undefined,guest));
 assert.equal(read.title,"Explicit shared goal");assert.equal(read.parentId,null);assert.equal(read.ownerId,null);assert.deepEqual(read.children,[]);assert.deepEqual(read.keyResults,[]);assert.deepEqual(read.assignments,[]);assert.equal(read.progress.display,null);assert.equal(read.progress.reason,"INCOMPLETE_AUTHORIZED_COVERAGE");
 for(const sentinel of [parent.id,hidden.id,kid,A.membership.id,"Hidden parent sentinel","Hidden child sentinel","Shared KR sentinel"]){assert.ok(!JSON.stringify(read).includes(sentinel),sentinel);}
 const listing=ok(await call("GET",base+"/goals?limit=1",undefined,guest));assert.deepEqual(listing.items.map((g:any)=>g.id),[shared.id]);assert.equal(listing.total,1);assert.deepEqual(listing.sharedKeyResults,[]);assert.equal(listing.capabilities.statistics,false);assert.equal(read.capabilities.history,false);assert.equal(listing.page.hasMore,false);assert.equal(listing.page.nextCursor,null);
 assert.deepEqual(ok(await call("GET",base+"/goal-periods",undefined,guest)).items.map((p:any)=>p.id),[period.id]);
 for(const path of ["/goals/"+publicGoal.id,"/goals/"+parent.id,"/goals/"+hidden.id,"/goals/key-results/"+kid,"/goals/statistics","/goals/"+shared.id+"/history"]){assert.equal((await call("GET",base+path,undefined,guest)).statusCode,404);}
 assert.equal((await call("GET",foreign+"/goals/"+shared.id,undefined,guest)).statusCode,404);
 assert.equal((await call("GET",base+"/goals?ownerId="+A.membership.id,undefined,guest)).statusCode,403);
 assert.equal((await call("POST",base+"/goals/"+shared.id+"/progress",{value:"50"},guest,{"if-match":'"'+configured.version+'"'})).statusCode,404);
 assert.ok(!JSON.stringify(ok(await call("GET",base+"/goal-periods",undefined,guest))).includes(hiddenPeriod.id));
 const worker=bind(createRuntime());
 const adapters=createGoalResourceAdapters({guest:worker});
 await worker.withResourceWorkerContext(A.organization.id,membership.id,[{resource:ref("goal",shared.id),action:"read"}],async ctx=>{assert.deepEqual(await worker.guestResourceIds(ctx,{context:"goals",kind:"goal",action:"read"}),[shared.id]);
 assert.equal(await adapters.goal.authorize(ctx,shared.id,"read"),true);
 assert.equal(await adapters.goal.authorize(ctx,hidden.id,"read"),false);
 assert.equal(await adapters["key-result"].authorize(ctx,kid,"read"),false);
 assert.equal(await adapters.goal.authorize(ctx,shared.id,"export"),false);
 assert.deepEqual((await adapters.goal.search!(ctx,"",100)).map(item=>item.id),[shared.id]);
 assert.deepEqual((await adapters.goal.search!(ctx,"",1)).map(item=>item.id),[shared.id]);
 assert.deepEqual(await adapters.goal.search!(ctx,"sentinel",1),[]);});
 await assert.rejects(()=>withWorkerContext(A.organization.id,membership.id,async()=>true));
 await assert.rejects(()=>worker.withResourceWorkerContext(A.organization.id,membership.id,[{resource:ref("goal",hidden.id),action:"read"}],async()=>true));
 // Core grants API adds an exact KR grant; it does not grant its parent.
 goalsEnabled=false;
 assert.equal((await call("GET",base+"/goals/"+shared.id,undefined,guest)).statusCode,404);
 await assert.rejects(()=>worker.withResourceWorkerContext(A.organization.id,membership.id,[{resource:ref("goal",shared.id),action:"read"}],async()=>true));
 goalsEnabled=true;
 const granted=await call("POST",base+"/members/"+membership.id+"/access-grants",{accessPlan:[{resource:ref("key-result",kid),actions:["read"]}]},owner);
 ok(granted);
 assert.equal(ok(await call("GET",base+"/goals/key-results/"+kid,undefined,guest)).id,kid);
 assert.deepEqual(ok(await call("GET",base+"/goals",undefined,guest)).sharedKeyResults.map((k:any)=>k.id),[kid]);
 assert.deepEqual(ok(await call("GET",base+"/goals/"+shared.id,undefined,guest)).keyResults.map((k:any)=>k.id),[kid]);
 const grants=ok(await call("GET",base+"/members/"+membership.id+"/access-grants",undefined,owner));
 const goalGrant=grants.items.find((g:any)=>g.resourceId===shared.id);
 ok(await call("POST",base+"/members/"+membership.id+"/access-grants/"+goalGrant.id+"/revoke",{},owner,{"if-match":'"'+goalGrant.version+'"'}));
 assert.equal((await call("GET",base+"/goals/"+shared.id,undefined,guest)).statusCode,404);
 assert.deepEqual(ok(await call("GET",base+"/goals",undefined,guest)).items,[]);
 assert.equal(ok(await call("GET",base+"/goals/key-results/"+kid,undefined,guest)).goalId,null);
 await worker.withResourceWorkerContext(A.organization.id,membership.id,[{resource:ref("key-result",kid),action:"read"}],async ctx=>{
   assert.deepEqual(await adapters.goal.search!(ctx,"",1),[]);
   assert.deepEqual((await adapters["key-result"].search!(ctx,"",1)).map(item=>item.id),[kid]);
 });
 await assert.rejects(()=>worker.withResourceWorkerContext(A.organization.id,membership.id,[{resource:ref("goal",shared.id),action:"read"}],async()=>true));
 // Removing the grantor's private leadership invalidates the remaining KR grant immediately.
 const current=ok(await call("GET",base+"/goals/"+shared.id,undefined,owner));
 const removed=ok(await call("POST",base+"/goals/"+shared.id+"/assignments",{assignments:[]},owner,{"if-match":'"'+current.version+'"'}));
 assert.equal(removed.accessRevoked,true);
 assert.equal((await call("GET",base+"/goals/key-results/"+kid,undefined,guest)).statusCode,404);
 await assert.rejects(()=>worker.withResourceWorkerContext(A.organization.id,membership.id,[{resource:ref("key-result",kid),action:"read"}],async()=>true));
 assert.equal((await call("POST",base+"/members/"+membership.id+"/access-grants",{accessPlan:[{resource:ref("key-result",kid),actions:["read"]}]},owner)).statusCode,403);
 assert.equal(await httpCore!.isGuest({member:{member_type:"GUEST"}} as any),true);
});

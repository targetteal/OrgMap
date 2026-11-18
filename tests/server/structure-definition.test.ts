import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { createStructureModule } from "../../server/modules/structure/plugin.js";
import { createStructureResourceAdapters } from "../../server/modules/structure/platform.js";
import { createGovernanceModule } from "../../server/modules/governance/plugin.js";
import { definitionItems } from "../../server/modules/structure/definition.js";
import { changes as normalizeChanges } from "../../server/modules/governance/domain.js";
import type { Ctx, ModuleRuntime } from "../../server/src/runtime.js";

let core: ModuleRuntime;
let ports: ReturnType<typeof createStructurePorts>;
const app = await buildApp([foundationDefaultAdmissionPolicy, async (app, runtime) => {
  core = runtime;
  ports = createStructurePorts(core);
  core.registerFoundationStructure(ports);
  await createStructureModule()(app, core);
  await createGovernanceModule({applyStructure: ports.applyStructure})(app, core);
}]);
after(async () => {await app.close(); await pool.end();});
const item = (text: string) => ({id: randomUUID(), text});
const rich = {format: "orgmap-richtext", version: 1, doc: {type: "doc", content: [
  {type: "paragraph", content: [{type: "text", text: "Cuidar de vínculos 日本語", marks: [{type:"bold"}]}]},
]}};

test("additive migration preserves pre-existing entity and similarly named custom field", async () => {
  const fixture=JSON.parse(process.env.STRUCTURE_LEGACY_DEFINITION_FIXTURE!);
  await transaction(async c=>{
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[fixture.org]);
    const entity=(await c.query("SELECT * FROM entities WHERE organization_id=$1 AND id=$2",[fixture.org,fixture.circle])).rows[0];
    assert.equal(entity.name,"Círculo anterior");
    assert.equal(entity.purpose,"Propósito anterior");
    assert.equal(entity.purpose_rich.doc.content[0].content[0].marks[0].type,"bold");
    assert.equal(entity.version,7);
    assert.deepEqual(entity.responsibilities,[]);
    assert.deepEqual(entity.artifacts,[]);
    const custom=(await c.query("SELECT f.label,v.value FROM structure_values v JOIN structure_fields f ON f.organization_id=v.organization_id AND f.id=v.field_id WHERE v.organization_id=$1 AND v.entity_id=$2",[fixture.org,fixture.circle])).rows[0];
    assert.deepEqual(custom,{label:"Responsabilidades",value:"Texto personalizado anterior"});
  });
});

test("definition lists validate identity, shape, blanks and limits", () => {
  const original = item("  Cuidar de vínculos  ");
  assert.deepEqual(definitionItems([original]), [{...original,text: original.text.trim()}]);
  assert.deepEqual(definitionItems([]), []);
  for (const invalid of [null, "texto", [{}], [{...original,text:" "}], [{...original,id:"x"}],
    [{...original,permissions:["admin"]}], [original,original],
    Array.from({length:101}, () => item("x")), [{...original,text:"x".repeat(10001)}]])
    assert.throws(() => definitionItems(invalid));
});

test("PG four components: direct CRUD, history, isolation, policy, move, export/import, approved governance and atomic rollback", async () => {
  const origin = "http://localhost:5173";
  const registered = await app.inject({method:"POST",url:"/api/v1/auth/register",headers:{origin},payload:{
    email: randomUUID()+"@example.test",password:"synthetic-definition-password",displayName:"O2 definition QA",
  }});
  assert.equal(registered.statusCode,201,registered.body);
  const auth = registered.json().data;
  const headers = {origin,cookie:registered.cookies[0].name+"="+registered.cookies[0].value,"x-csrf-token":auth.csrfToken};
  async function call(method:string,path:string,payload?:object,version?:number,key=randomUUID()) {
    return app.inject({method:method as any,url:"/api/v1"+path,payload,headers:{...headers,
      "idempotency-key":key,...(version===undefined?{}:{"if-match":'"'+version+'"'}),
    }});
  }
  function data(response:any,status=200) {assert.equal(response.statusCode,status,response.body);return response.json().data;}
  const org=data(await call("POST","/organizations",{name:"O2 definition isolated"}),201);
  const orgId=org.organization.id, root=org.rootCircle.id, base="/organizations/"+orgId;
  const other=data(await call("POST","/organizations",{name:"Other isolated O2"}),201);
  assert.deepEqual(org.rootCircle.responsibilities,[]);
  assert.deepEqual(org.rootCircle.artifacts,[]);
  const responsibilities=[item("Revisar continuamente os acordos"),item("Escutar tensões")];
  const artifacts=[item("Marca e identidade visual")];
  const circle=data(await call("POST",base+"/circles",{mode:"DIRECT",parentCircleId:root,
    name:"Círculo O2",purposeRich:rich,responsibilities,artifacts}),201).circle;
  const role=data(await call("POST",base+"/roles",{mode:"DIRECT",circleId:root,
    name:"Papel O2",purposeRich:rich,responsibilities,artifacts}),201).role;
  for (const [route,created] of [["circles",circle],["roles",role]] as const) {
    const path=base+"/"+route+"/"+created.id;
    assert.deepEqual(created.responsibilities,responsibilities);
    assert.deepEqual(created.artifacts,artifacts);
    assert.deepEqual(created.purposeRich,rich);
    const revised=[{...responsibilities[0],text:"Revisar acordos com o círculo"},item("Documentar decisões")];
    const key=randomUUID();
    const saved=data(await call("PATCH",path,{mode:"DIRECT",responsibilities:revised,artifacts:[]},1,key));
    assert.equal(saved.entity.version,2);
    assert.deepEqual(saved.entity.responsibilities,revised);
    assert.deepEqual(saved.entity.artifacts,[]);
    assert.deepEqual(saved.entity.purposeRich,rich);
    assert.equal(saved.entity.name,created.name);
    assert.equal((await call("PATCH",path,{mode:"DIRECT",responsibilities:[]},1)).statusCode,409);
    assert.equal((await call("PATCH",path,{mode:"DIRECT",name:"Should roll back",responsibilities:[revised[0],revised[0]]},2)).statusCode,422);
    const read=data(await call("GET",path)).entity;
    assert.deepEqual(read.responsibilities,revised);
    assert.equal(read.version,2);
    assert.equal(read.name,created.name);
    const history=data(await call("GET",base+"/structure-advanced/entities/"+created.id+"/history")).items;
    assert.ok(history.some((row:any)=>JSON.stringify(row.beforeValue?.responsibilities)===JSON.stringify(responsibilities) && JSON.stringify(row.afterValue?.responsibilities)===JSON.stringify(revised)));
    assert.equal((await call("GET","/organizations/"+other.organization.id+"/"+route+"/"+created.id)).statusCode,404);
    assert.equal((await call("PATCH","/organizations/"+other.organization.id+"/"+route+"/"+created.id,{mode:"DIRECT",artifacts:[]},2)).statusCode,404);
    const clear=data(await call("PATCH",path,{mode:"DIRECT",responsibilities:[],artifacts:[]},2)).entity;
    assert.equal(clear.version,3);
    assert.deepEqual(clear.responsibilities,[]);
    assert.deepEqual(clear.artifacts,[]);
  }
  data(await call("PUT",base+"/structure-advanced/circles/"+root+"/policy",{governedFields:["responsibilities","artifacts"]},0));
  assert.equal((await call("PATCH",base+"/roles/"+role.id,{mode:"DIRECT",artifacts},3)).statusCode,422);
  // A name-only edit remains possible and retains rich purpose and empty lists.
  const renamed=data(await call("PATCH",base+"/roles/"+role.id,{mode:"DIRECT",name:"Papel renomeado"},3)).entity;
  assert.equal(renamed.version,4);
  assert.deepEqual(renamed.purposeRich,rich);
  async function approve(changes:unknown[]) {
    const proposal=data(await call("POST",base+"/proposals",{title:"Completar definição O2",circleId:root,kind:"GOVERNANCE",payload:{changes}}),201);
    const detail=data(await call("GET",base+"/proposals/"+proposal.id));
    assert.deepEqual(detail.revisions[0].payload.changes,normalizeChanges(changes));
    data(await call("POST",base+"/proposals/"+proposal.id+"/actions/submit",{},1));
    data(await call("POST",base+"/proposals/"+proposal.id+"/votes",{choice:"CONSENT"},2));
    for (const step of ["CLARIFY","REACT","OBJECT","DECIDE"])
      data(await call("POST",base+"/proposals/"+proposal.id+"/actions/step",{step},2));
    data(await call("POST",base+"/proposals/"+proposal.id+"/actions/decide",{verdict:"ADOPT",reason:"Revisado"},2));
    return data(await call("POST",base+"/proposals/"+proposal.id+"/actions/apply",{},3));
  }
  const governanceCircle=randomUUID(),governanceRole=randomUUID();
  await approve([
    {kind:"UPDATE",entityId:role.id,baseVersion:4,responsibilities,artifacts},
    {kind:"UPDATE",entityId:circle.id,baseVersion:3,responsibilities,artifacts},
    {kind:"CREATE",entityId:governanceCircle,entityKind:"CIRCLE",parentCircleId:root,name:"Círculo por proposta",purpose:"",responsibilities,artifacts},
    {kind:"CREATE",entityId:governanceRole,entityKind:"ROLE",parentCircleId:root,name:"Papel por proposta",purpose:"",responsibilities:[],artifacts:[]},
  ]);
  const forest=data(await call("GET",base+"/structure"));
  for (const eid of [role.id,circle.id,governanceCircle]) {
    const entity=[...forest.roles,...forest.circles].find((e:any)=>e.id===eid);
    assert.deepEqual(entity.responsibilities,responsibilities);
    assert.deepEqual(entity.artifacts,artifacts);
  }
  assert.deepEqual(forest.roles.find((e:any)=>e.id===governanceRole).artifacts,[]);
  for (const [route,eid,version] of [["roles",role.id,5],["circles",circle.id,4]] as const) {
    const moved=data(await call("POST",base+"/structure/"+eid+"/move",{mode:"DIRECT",targetCircleId:governanceCircle},version)).entity;
    assert.deepEqual(moved.responsibilities,responsibilities);
    assert.deepEqual(moved.artifacts,artifacts);
    assert.deepEqual(data(await call("GET",base+"/"+route+"/"+eid)).entity.purposeRich,rich);
  }
  async function context<T>(fn:(ctx:Ctx)=>Promise<T>) {
    return transaction(async c=>{
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[orgId]);
      const organization=(await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE",[orgId])).rows[0];
      const member=(await c.query("SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",[orgId,auth.account.id])).rows[0];
      return fn({c,org:organization,member,account:auth.account,mode:"authorization_write"});
    });
  }
  const adapter=createStructureResourceAdapters(core).role;
  const exported=await context(ctx=>adapter.export!(ctx,[role.id],"STRUCTURE"));
  assert.deepEqual((exported.records[0] as any).artifacts,artifacts);
  const clonedRole=randomUUID();
  await context(async ctx=>{
    const plan=await adapter.validateImport!(ctx,[{...(exported.records[0] as any),id:clonedRole}],"STRUCTURE");
    await adapter.applyImport!(ctx,plan.plan,"STRUCTURE");
  });
  assert.deepEqual(data(await call("GET",base+"/roles/"+clonedRole)).entity.responsibilities,responsibilities);
  await assert.rejects(()=>context(ctx=>ports.applyStructure(ctx,{proposalId:randomUUID(),revision:1,changes:[
    {kind:"UPDATE",entityId:role.id,baseVersion:6,responsibilities:[]},
    {kind:"UPDATE",entityId:circle.id,baseVersion:5,artifacts:[{id:"invalid",text:"bad"}]},
  ]})));
  assert.deepEqual(data(await call("GET",base+"/roles/"+role.id)).entity.responsibilities,responsibilities);
  // Definition data does not grant access: a separate account cannot read/write it.
  const stranger=await app.inject({method:"POST",url:"/api/v1/auth/register",headers:{origin},payload:{email:randomUUID()+"@example.test",password:"synthetic-stranger-password",displayName:"Stranger"}});
  assert.equal(stranger.statusCode,201,stranger.body);
  const strangerHeaders={origin,cookie:stranger.cookies[0].name+"="+stranger.cookies[0].value,"x-csrf-token":stranger.json().data.csrfToken,"idempotency-key":randomUUID(),"if-match":'"6"'};
  assert.equal((await app.inject({method:"GET",url:"/api/v1"+base+"/roles/"+role.id,headers:strangerHeaders})).statusCode,404);
  assert.equal((await app.inject({method:"PATCH",url:"/api/v1"+base+"/roles/"+role.id,headers:strangerHeaders,payload:{mode:"DIRECT",artifacts:[item("admin")]}})).statusCode,404);
});

import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import { spawnSync } from "node:child_process";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Standalone isolated database: never resets or migrates the shared development DB.
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const db = "orgmap_o2_essential_defs_" + randomUUID().replaceAll("-", "");
await admin.query(`CREATE DATABASE "${db}"`);
const migrationUrl = new URL(adminUrl);
migrationUrl.pathname = "/" + db;
const migrationEnvironment: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: migrationUrl.href };
delete migrationEnvironment.MIGRATION_SCOPE;
delete migrationEnvironment.MIGRATION_MAX_PREFIX;
try {
  const result = spawnSync(process.execPath, ["--import", "tsx", "server/src/migrate.ts"], {env:migrationEnvironment,encoding:"utf8"});
  if (result.status !== 0) throw Error(`O2_OFFICIAL_MIGRATION_FAILED: ${result.stderr || result.stdout}`);
} catch (error) {
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
  throw error;
}
const runtimeUrl = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtimeUrl.pathname = "/" + db;
process.env.DATABASE_URL = runtimeUrl.href;
const { buildApp } = await import("../../server/src/app.js");
const { pool } = await import("../../server/src/db.js");
assert.equal(
  (await pool.query("SELECT current_database() AS name")).rows[0].name,
  db,
  "runtime must point at this slice isolated database before any API command",
);
const blobs=await mkdtemp(join(tmpdir(),"orgmap-o2-essential-defs-"));
let app: Awaited<ReturnType<typeof buildApp>>;
try {
  const { createOrgMapIntegration } = await import("../../server/integration/index.js");
  app = await buildApp([createOrgMapIntegration({blobsDirectory:blobs})]);
  if (process.env.O2_TEST_DEBUG)
    app.addHook("onError", async (_request, _reply, error) => {
      console.error(error.message);
    });
} catch (e) {
  await rm(blobs,{recursive:true,force:true});
  await pool.end();
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
  throw e;
}
after(async () => {
  await app.close();
  await rm(blobs,{recursive:true,force:true});
  await pool.end();
  await admin.query(`DROP DATABASE "${db}" WITH (FORCE)`);
  await admin.end();
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  b?: any,
  u?: User,
  headers: any = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload: b,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...headers,
    },
  });
}
function data(r: any) {
  assert.ok(r.statusCode >= 200 && r.statusCode < 300, r.body);
  return r.json().data;
}
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "work-test-password-123",
    displayName: "Work tester",
  });
  const d = data(r);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
    id: d.account.id,
  };
}
const match = (v: number) => ({ "if-match": `"${v}"` });

test("O2 essential definitions are versioned adaptations for future circles, preserve inheritance and existing roles, and remain tenant/owner scoped",async()=>{
  const owner=await user(),member=await user(),outsider=await user();
  const A=data(await call("POST","/organizations",{name:"Essenciais A"},owner)),B=data(await call("POST","/organizations",{name:"Essenciais B"},outsider));
  const base="/organizations/"+A.organization.id,other="/organizations/"+B.organization.id;
  data(await call("POST",base+"/members",{accountId:member.id},owner));
  const model=async() => data(await call("GET",base+"/governance-model",undefined,owner));
  const structure=async() => {const s=data(await call("GET",base+"/structure",undefined,owner));return s.entities ?? [...s.circles,...s.roles];};
  const essential=async(circleId:string,code:string) => {const m=await model(),s=await structure(),ids=new Set(m.bindings.filter((b:any)=>b.functionCode===code).map((b:any)=>b.roleId));const r=s.find((r:any)=>r.parentId===circleId&&ids.has(r.id));assert.ok(r);return r;};
  const circle=async(name:string,purpose:string) => data(await call("POST",base+"/circles",{parentCircleId:A.rootCircle.id,name,purpose,mode:"DIRECT"},owner)).circle;
  const installed=data(await call("POST",base+"/governance-model/install",{packageId:"targetteal.o2"},owner));
  assert.ok(installed.rules.essentialDefinitions.GUIDE.responsibilities.length);
  assert.deepEqual(installed.rules.essentialDefinitions,installed.essentialDefinitionDefaults);
  const existing=await circle("Antes da adaptação","Preservar este propósito"),before=await essential(existing.id,"FACILITATOR");
  const originalGuide=await essential(existing.id,"GUIDE");assert.equal(originalGuide.purpose,existing.purpose);
  const overrides={essentialDefinitions:{GUIDE:{responsibilities:["Acompanhar os experimentos do círculo."]},FACILITATOR:{purpose:"Cultivar conversas claras",artifacts:["Processo de facilitação do círculo."]},SCRIBE:{artifacts:[]}}};
  const key=randomUUID(),headers={...match(installed.revision),"idempotency-key":key};
  const adapted=data(await call("PUT",base+"/governance-model",{overrides},owner,headers));
  assert.equal(adapted.revision,installed.revision+1);
  assert.equal((await call("PUT",base+"/governance-model",{overrides},owner,headers)).statusCode,409,"replaying a consumed model revision cannot adapt twice");
  assert.equal((await model()).revision,adapted.revision);
  assert.equal((await model()).rules.essentialDefinitions.FACILITATOR.purpose,"Cultivar conversas claras");
  assert.deepEqual((await model()).overrides.essentialDefinitions,overrides.essentialDefinitions);
  assert.equal((await call("PUT",base+"/governance-model",{overrides:{}},member,match(adapted.revision))).statusCode,403);
  assert.equal((await call("PUT",base+"/governance-model",{overrides:{}},owner,match(installed.revision))).statusCode,409);
  for(const invalid of [{HOLACRACY:{purpose:"Outro modelo"}},{GUIDE:{name:"Autoridade inventada"}},{GUIDE:{artifacts:[{url:"https://example.test"}]}},{GUIDE:{responsibilities:["Uma linha\noutra"]}},{GUIDE:{purpose:42}}])assert.ok([400,422].includes((await call("PUT",base+"/governance-model",{overrides:{essentialDefinitions:invalid}},owner,match(adapted.revision))).statusCode));
  assert.equal((await model()).revision,adapted.revision,"invalid definitions never advance model revision");
  const future=await circle("Depois da adaptação","Experimentos futuros"),guide=await essential(future.id,"GUIDE"),representative=await essential(future.id,"REPRESENTATIVE"),facilitator=await essential(future.id,"FACILITATOR"),scribe=await essential(future.id,"SCRIBE");
  assert.equal(guide.purpose,future.purpose);assert.equal(representative.purpose,future.purpose);
  assert.deepEqual(guide.responsibilities.map((r:any)=>r.text),overrides.essentialDefinitions.GUIDE.responsibilities);
  assert.equal(facilitator.purpose,"Cultivar conversas claras");assert.deepEqual(facilitator.artifacts.map((r:any)=>r.text),overrides.essentialDefinitions.FACILITATOR.artifacts);
  assert.deepEqual(scribe.artifacts,[]);
  assert.deepEqual(await essential(existing.id,"FACILITATOR"),before,"adapting defaults never rewrites an existing role");
  const fullRules={...(await model()).rules,essentialDefinitions:{...(await model()).rules.essentialDefinitions,GUIDE:{...(await model()).rules.essentialDefinitions.GUIDE,purpose:"Um propósito próprio para novos guias"}}};
  const ownPurpose=data(await call("PUT",base+"/governance-model",{overrides:fullRules},owner,match(adapted.revision)));
  assert.equal(ownPurpose.overrides.essentialDefinitions.REPRESENTATIVE,undefined,"serializing the full editor must preserve the reference inheritance");
  const next=await circle("Propósito adaptado","Continuar herdando nos representantes");
  assert.equal((await essential(next.id,"GUIDE")).purpose,"Um propósito próprio para novos guias");
  assert.equal((await essential(next.id,"REPRESENTATIVE")).purpose,next.purpose);
  assert.equal((await call("GET",base+"/governance-model",undefined,outsider)).statusCode,404);
  const foreign=data(await call("POST",other+"/governance-model/install",{packageId:"targetteal.o2"},outsider));
  assert.deepEqual(foreign.rules.essentialDefinitions,installed.essentialDefinitionDefaults);
  const restored=data(await call("PUT",base+"/governance-model",{overrides:{}},owner,match(ownPurpose.revision)));
  assert.deepEqual(restored.rules.essentialDefinitions,installed.essentialDefinitionDefaults);
  assert.deepEqual(await essential(future.id,"FACILITATOR"),facilitator,"restoring reference defaults is not retroactive either");
  const restoredCircle=await circle("Após restauração","Propósito depois de restaurar");
  assert.equal((await essential(restoredCircle.id,"GUIDE")).purpose,restoredCircle.purpose);
  assert.equal((await essential(restoredCircle.id,"FACILITATOR")).purpose,installed.essentialDefinitionDefaults.FACILITATOR.purpose);
  const history=data(await call("GET",base+"/governance-model/history",undefined,owner)).items;
  assert.equal(history.find((r:any)=>r.revision===adapted.revision).snapshot.rules.essentialDefinitions.FACILITATOR.purpose,"Cultivar conversas claras");
  const started=data(await call("POST",base+"/governance-model/start",{},owner,match(restored.revision)));
  assert.equal(started.rules.protectEssentials,true);assert.equal(started.rules.enforceEligibility,true);
  const protectedRole=await essential(restoredCircle.id,"FACILITATOR");
  assert.ok([403,422].includes((await call("PATCH",base+"/roles/"+protectedRole.id,{mode:"DIRECT",purpose:"Contornar a definição"},owner,match(protectedRole.version))).statusCode));
});

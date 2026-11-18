import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

test("publication migration backfills only matching publish receipts and preserves snapshots", async () => {
  const source =
    process.env.MIGRATION_DATABASE_URL ??
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
  const admin = new pg.Pool({ connectionString: source });
  const name =
    "orgmap_meetings_migration_test_" + randomBytes(8).toString("hex");
  const url = new URL(source);
  url.pathname = "/" + name;
  let db: pg.Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    db = new pg.Pool({ connectionString: url.href });
    // Minimal Foundation keys only; all Meetings DDL is the actual historical and additive SQL.
    await db.query(
      "CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE members(organization_id uuid,id uuid,PRIMARY KEY(organization_id,id)); CREATE TABLE entities(organization_id uuid,id uuid,PRIMARY KEY(organization_id,id))",
    );
    await db.query(
      await readFile("server/migrations/300_meetings.sql", "utf8"),
    );
    const org = randomUUID(),
      actor = randomUUID(),
      circle = randomUUID(),
      series = randomUUID(),
      live = randomUUID(),
      closed = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.query("INSERT INTO organizations VALUES($1)", [org]);
    await db.query("INSERT INTO members VALUES($1,$2)", [org, actor]);
    await db.query("INSERT INTO entities VALUES($1,$2)", [org, circle]);
    await db.query(
      `INSERT INTO meeting_series(organization_id,id,title,circle_id,local_start,time_zone,duration_minutes,recurrence,template_snapshot,participants,policy) VALUES($1,$2,'Legacy',$3,'2020-01-01T10:00','UTC',60,'{}','{}','[]','{}')`,
      [org, series, circle],
    );
    for (const [mid, sequence, state] of [
      [live, 0, "SCHEDULED"],
      [closed, 1, "CLOSED"],
    ])
      await db.query(
        `INSERT INTO meeting_occurrences(organization_id,id,series_id,sequence,start_at,local_start,time_zone,duration_minutes,title,circle_id,state,sections,method,policy,facilitator_id) VALUES($1,$2,$3,$4,'2020-01-01T10:00Z','2020-01-01T10:00','UTC',60,'Original',$5,$6,'[{"id":"agenda","kind":"AGENDA","title":"Agenda"}]','CUSTOM','{}',$7)`,
        [org, mid, series, sequence, circle, state, actor],
      );
    for (const [i, status, mid, from] of [
      [0, "OPEN", live, null],
      [1, "COMPLETED", closed, null],
      [2, "TRANSFERRED", closed, ids[0]],
      [3, "OPEN", closed, null],
    ])
      await db.query(
        "INSERT INTO meeting_agenda(organization_id,id,meeting_id,title,presenter_id,duration_minutes,status,transferred_from) VALUES($1,$2,$3,$4,$5,0,$6,$7)",
        [org, ids[i as number], mid, "Legado " + i, actor, status, from],
      );
    const rid = randomUUID();
    await db.query(
      "INSERT INTO meeting_reports(organization_id,id,meeting_id,window_days) VALUES($1,$2,$3,7)",
      [org, rid, closed],
    );
    await db.query(
      "INSERT INTO meeting_report_versions(organization_id,report_id,version,epoch,snapshot,actor_id,reason) VALUES($1,$2,1,1,$3,$4,'Published')",
      [
        org,
        rid,
        JSON.stringify({
          original: true,
          placementId: ids[2],
          authorUnknown: null,
        }),
        actor,
      ],
    );
    await db.query("CREATE TABLE command_results(organization_id uuid, actor_id uuid, operation text, key text, hash text, result jsonb)");
    for (const n of [2, 3, 4, 5]) await db.query(
      "INSERT INTO meeting_report_versions(organization_id,report_id,version,epoch,snapshot,actor_id,reason) VALUES($1,$2,$3,1,$4,$5,'Published')",
      [org,rid,n,JSON.stringify({number:n}),actor]);
    const receipt = (n:number) => ({meeting:{id:closed},report:{id:rid,meetingId:closed,version:n,epoch:1,state:'PUBLISHED'}});
    const path = `/api/v1/organizations/${org}/meetings/${closed}/report/actions/publish`;
    for (const [operation, n] of [[`cookie:${path}`,1],[`credential:${randomUUID()}:${path}`,2],[`cookie:${path}/spoof`,3],[`cookie:${path}`,4]] as const) {
      const result=receipt(n); if(n===4) result.report.epoch=2;
      await db.query("INSERT INTO command_results VALUES($1,$2,$3,$4,'hash',$5)",[org,actor,operation,String(n),JSON.stringify(result)]);
    }
    const originals = (await db.query("SELECT version,snapshot::text,reason FROM meeting_report_versions ORDER BY version")).rows;
    await db.query(await readFile("server/migrations/931_meeting_report_publication.sql", "utf8"));
    const after = (await db.query("SELECT version,snapshot::text,reason,publication_status FROM meeting_report_versions ORDER BY version")).rows;
    assert.deepEqual(after.map(x=>x.publication_status), ['PUBLISHED','PUBLISHED','UNVERIFIED','UNVERIFIED','UNVERIFIED']);
    assert.deepEqual(after.map(({publication_status,...x})=>x), originals);
    await db.query("INSERT INTO meeting_report_versions(organization_id,report_id,version,epoch,snapshot,actor_id,reason) VALUES($1,$2,6,1,'{}',$3,'Published')",[org,rid,actor]);
    assert.equal((await db.query("SELECT publication_status FROM meeting_report_versions WHERE version=6")).rows[0].publication_status,'NOT_PUBLISHED');
    const before = (
      await db.query(
        "SELECT snapshot::text AS bytes FROM meeting_report_versions WHERE version=1",
      )
    ).rows[0].bytes;
    await db.query(
      await readFile("server/migrations/304_meetings_agenda_items.sql", "utf8"),
    );
    const roots = (
      await db.query("SELECT * FROM meeting_agenda_items ORDER BY title")
    ).rows;
    assert.deepEqual(
      roots.map((x) => x.state),
      ["ASSIGNED", "COMPLETED", "ARCHIVED", "NEEDS_RESCHEDULE"],
    );
    for (let i = 0; i < roots.length; i++) {
      assert.equal(roots[i].id, ids[i]);
      assert.equal(roots[i].creator_id, null);
      assert.equal(roots[i].owner_id, null);
      assert.equal(roots[i].created_at, null);
      assert.equal(roots[i].identity_coverage, "LEGACY_PLACEMENT");
      assert.equal(roots[i].creator_coverage, "UNKNOWN");
      assert.equal(roots[i].expected_duration_minutes, 0);
    }
    const placements = (
      await db.query("SELECT * FROM meeting_agenda ORDER BY title")
    ).rows;
    assert.deepEqual(
      placements.map((x) => x.id),
      ids,
    );
    assert.deepEqual(
      placements.map((x) => x.is_active),
      [true, false, false, false],
    );
    assert.equal(placements[2].transferred_from, ids[0]);
    assert.equal(
      (
        await db.query(
          "SELECT snapshot::text AS bytes FROM meeting_report_versions WHERE version=1",
        )
      ).rows[0].bytes,
      before,
    );
  } finally {
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});


import { after } from "node:test";
import * as Y from "yjs";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import { createMeetingRuntimePorts } from "../../server/modules/meetings/guest.js";
import { createMeetingExportResourceAdapter, type MeetingExportPorts } from "../../server/modules/meetings/exports.js";
import { fail } from "../../server/src/core.js";

if (!/^\/orgmap_meetings_test_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname) || new URL(process.env.MIGRATION_DATABASE_URL!).pathname !== new URL(process.env.DATABASE_URL!).pathname) throw Error("Matching disposable DB required");
const formats: MeetingExportPorts["formatsByKind"] = {MEETING_REPORT_BUNDLE:["ZIP"]};
const jobs: NonNullable<MeetingExportPorts["exportJobs"]> = {async enqueue(){return {id:randomUUID(),state:"PENDING",version:1};}};
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app,core)=>{
    core.registerModuleScope({module:"meetings",routePrefixes:[],resourceTypes:["meeting","report","meeting-export"]});
    core.registerOrganizationSettings(async ctx=>({version:1,settings:{name:ctx.org.name,locale:ctx.org.locale,timezone:ctx.org.time_zone,modules:{structure:true,meetings:true}}}));
    const input = {exports:{formatsByKind:formats,exportJobs:jobs},validateMembers:async(ctx:any,ids:string[])=>(await ctx.c.query("SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",[ctx.org.id,ids])).rowCount===new Set(ids).size};
    await createMeetings(createMeetingRuntimePorts(core,input))(app,core);
    const ports:MeetingExportPorts={formatsByKind:formats,exportJobs:jobs,assertAvailable:ctx=>core.assertModuleAvailable(ctx,"meetings")};
    const adapter=createMeetingExportResourceAdapter(ports);
    app.get("/api/v1/organizations/:organizationId/test-publication-export/:selectionId",r=>core.tenant(r,{mode:"read"},async ctx=>{
      const sid=(r.params as any).selectionId;
      if(!await adapter.authorize(ctx,sid,"export")) fail(404,"RESOURCE_NOT_FOUND");
      return adapter.export!(ctx,[sid],"MEETING_REPORT_BUNDLE",{includePrivate:false,format:"ZIP"});
    }));
  },
]);
after(async()=>{await app.close();await pool.end();});
type User = {id:string,cookie:string,csrf:string};
async function call(method:string,path:string,payload?:any,u?:User,version?:number){return app.inject({method:method as any,url:"/api/v1"+path,payload,headers:{origin:"http://localhost:5173","idempotency-key":randomUUID(),...(u?{cookie:u.cookie,"x-csrf-token":u.csrf}:{}),...(version!==undefined?{"if-match":`"${version}"`}:{})}});}
function ok(r:any,status=200):any{assert.equal(r.statusCode,status,r.body);return r.json().data;}
async function user():Promise<User>{const r=await call("POST","/auth/register",{email:randomUUID()+"@example.test",password:"publication-test-123",displayName:"Publication test"});const d=ok(r,201);return {id:d.account.id,cookie:r.cookies[0].name+"="+r.cookies[0].value,csrf:d.csrfToken};}

test("restore-only member cannot publish via reason; Guest and frozen exports use proven publication",async()=>{
 const owner=await user(),editor=await user(),guest=await user();
 const org=ok(await call("POST","/organizations",{name:"Publication regression"},owner),201), base="/organizations/"+org.organization.id;
 const member=ok(await call("POST",base+"/members",{accountId:editor.id},owner),201).membership;
 const created=ok(await call("POST",base+"/meeting-series",{title:"Publication",circleId:org.rootCircle.id,localStart:"2030-01-01T10:00",timeZone:"UTC",durationMinutes:60,recurrence:{frequency:"ONCE"},sections:[{id:"notes",title:"Notes",kind:"CUSTOM"}],participants:[{memberId:member.id,access:"EDIT",canManage:false,canPublish:false,canRestore:true}],policy:{}},owner),201);
 const mid=created.occurrenceIds[0],route=base+"/meetings/"+mid;
 let d=ok(await call("POST",route+"/actions/start",{},owner,1));
 const doc=new Y.Doc(); doc.getText("notes").insert(0,"PUBLISHED_SAFE");
 ok(await call("POST",route+"/collaboration/updates",{sectionId:"notes",epoch:1,updateId:randomUUID(),update:Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64")},owner));
 d=ok(await call("POST",route+"/actions/close",{},owner,d.meeting.version));
 d=ok(await call("POST",route+"/report/actions/publish",{},owner,d.report.version));
 const rid=d.report.id,publishedVersion=d.report.version;
 ok(await call("POST",base+"/members",{accountId:guest.id,memberType:"GUEST",accessPlan:[{resource:{context:"meetings",kind:"report",id:rid},actions:["read"]}]},owner),201);
 const state=Y.encodeStateVector(doc); doc.getText("notes").insert(doc.getText("notes").length," UNPUBLISHED_PRIVATE_SENTINEL");
 ok(await call("POST",route+"/collaboration/updates",{sectionId:"notes",epoch:1,updateId:randomUUID(),update:Buffer.from(Y.encodeStateAsUpdate(doc,state)).toString("base64")},owner));
 d=ok(await call("GET",route,undefined,editor));
 assert.equal(d.capabilities.restore,true); assert.equal(d.capabilities.publish,false);
 assert.equal((await call("POST",route+"/report/actions/publish",{},editor,d.report.version)).statusCode,403);
 d=ok(await call("POST",route+"/report/actions/reopen",{reason:"Published"},editor,d.report.version));
 const reopenedVersion=d.report.version, reopenedEpoch=d.report.epoch;
 d=ok(await call("POST",route+"/report/actions/restore",{reason:"Published",restoreVersion:reopenedVersion},editor,d.report.version));
 const guestReport=ok(await call("GET",base+"/meeting-reports/"+rid,undefined,guest));
 assert.equal(guestReport.report.version,publishedVersion); assert.ok(!JSON.stringify(guestReport).includes("UNPUBLISHED_PRIVATE_SENTINEL"));
 const selection=ok(await call("POST",base+"/meetings/exports",{kind:"MEETING_REPORT_BUNDLE",format:"ZIP"},owner),202).selectionSummary.id;
 const download=base+"/test-publication-export/"+selection;
 const frozen=ok(await call("GET",download,undefined,owner));
 assert.ok(JSON.stringify(frozen).includes("PUBLISHED_SAFE")); assert.ok(!JSON.stringify(frozen).includes("UNPUBLISHED_PRIVATE_SENTINEL"));
 assert.equal(frozen.documentPackage.documents[0].ref.reportVersion,publishedVersion);
 // Simulate a frozen reference created by older code, then exercise download revalidation.
 const migrator = new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
 try { const changed=await migrator.query("UPDATE meeting_export_selections SET report_refs=jsonb_set(jsonb_set(report_refs,'{0,reportVersion}',to_jsonb($3::int)),'{0,epoch}',to_jsonb($4::int)) WHERE organization_id=$1 AND id=$2",[org.organization.id,selection,reopenedVersion,reopenedEpoch]); assert.equal(changed.rowCount,1); } finally { await migrator.end(); }
 assert.equal((await call("GET",download,undefined,owner)).statusCode,404);
 doc.destroy();
});

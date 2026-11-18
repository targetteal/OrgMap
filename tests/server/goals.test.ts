import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { page } from "../../server/modules/goals/pagination.js";
import {validateRichDocument} from "../../packages/content/index.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createGoalsModule } from "../../server/modules/goals/plugin.js";
import {
  workModule,
  createWorkResourceAdapters,
} from "../../server/modules/work/index.js";
import { ResourceRegistry } from "../../server/modules/platform/ports.js";
import {
  createGoalFromTension,
  listMeetingItems,
} from "../../server/modules/goals/services.js";
import {
  progress,
  aggregate,
  decimal,
  currentMonthWindow,
} from "../../server/modules/goals/domain.js";
import {
  createGoalResourceAdapters,
  createRegistryGoalLinkResolver,
  goalAccess,
  goalManageAccess,
} from "../../server/modules/goals/ports.js";
const adapters = createGoalResourceAdapters();
test("Guest cannot inherit organization-public or nominal goal access before sharing composition",async()=>{
  for(const privacy of ["PUBLIC","PRIVATE"])for(const org_role of ["OWNER","MEMBER"]){
    const ctx={member:{id:"guest",status:"ACTIVE",member_type:"GUEST",org_role},c:{query:()=>{throw Error("Guest guard must precede nominal ACL lookup");}}} as any;
    const goal={privacy,owner_type:"MEMBER",owner_id:"guest"};
    assert.equal(await goalAccess(ctx,goal),false);
    assert.equal(await goalAccess(ctx,goal,true),false);
    assert.equal(await goalManageAccess(ctx,goal),false);
  }
});
const registry = new ResourceRegistry();
for (const [kind, adapter] of Object.entries(createWorkResourceAdapters()))
  registry.registerResourceAdapter(kind, adapter);
const app = await buildApp([foundationDefaultAdmissionPolicy,
  workModule,
  createGoalsModule({ resolveLink: createRegistryGoalLinkResolver(registry) }),
  async (app, core) => {
    app.post("/api/v1/organizations/:organizationId/goal-service-test", (r) =>
      core.tenant(r, true, (ctx) => createGoalFromTension(ctx, r.body as any)),
    );
    app.get("/api/v1/organizations/:organizationId/goal-meeting-test", (r) =>
      core.tenant(r, false, (ctx) =>
        listMeetingItems(ctx, { circleIds: [(r.query as any).circleId] }),
      ),
    );
    app.get(
      "/api/v1/organizations/:organizationId/goal-adapter-test/:resourceId",
      (r) =>
        core.tenant(r, false, async (ctx) => {
          const rid = (r.params as any).resourceId;
          return {
            read: await adapters.goal.authorize(ctx, rid, "read"),
            comment: await adapters.goal.authorize(ctx, rid, "comment"),
            found: await adapters.goal.search!(ctx, "", 100),
            export: (await adapters.goal.authorize(ctx, rid, "export"))
              ? await adapters.goal.export!(ctx, [rid], "RESOURCES")
              : null,
          };
        }),
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  b?: unknown,
  u?: User,
  extra: Record<string, string> = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...extra,
    },
    payload: b as any,
  });
}
function data(r: any, status?: number) {
  if (status) assert.equal(r.statusCode, status, r.body);
  else assert.ok(r.statusCode === 200 || r.statusCode === 201, r.body);
  return r.json().data;
}
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "secure-password-12345",
    displayName: "Goals tester",
  });
  const d = data(r);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
    id: d.account.id,
  };
}
test("strict decimals, decreasing targets, zero contributors and independent lifecycle formula", () => {
  assert.equal(
    progress(
      "999999999999.000001",
      "999999999999.000002",
      "999999999999.000003",
    ).display,
    50,
  );
  assert.equal(
    progress(
      "999999999999.000003",
      "999999999999.000002",
      "999999999999.000001",
    ).display,
    50,
  );
  assert.equal(progress("100", "60", "20").display, 50);
  assert.equal(progress("10", "140", "100").raw, 144.44444444444446);
  for (const v of ["1x", "Infinity", "1e3", "-1", " 2", "", 2, null])
    assert.throws(() => decimal(v));
  assert.throws(() => progress("10", "2", "10"));
  assert.equal(aggregate("BOTH", "0", [], [], "50", "50").display, null);
  assert.throws(() => aggregate("BOTH", "0", [], [], "20", "50"));
  assert.equal(
    aggregate(
      "KEY_RESULTS",
      "0",
      [{ id: "x", progress: 50, weight: "0" }],
      [],
      "100",
      "0",
    ).display,
    null,
  );
});
test("Civil statistics window respects timezone and month boundaries",()=>{
  assert.deepEqual(currentMonthWindow("America/Sao_Paulo","2028-03-01T01:00:00Z"),{startsOn:"2028-02-01",endsOn:"2028-02-29"});
  assert.deepEqual(currentMonthWindow("UTC","2028-03-01T01:00:00Z"),{startsOn:"2028-03-01",endsOn:"2028-03-31"});
  assert.deepEqual(currentMonthWindow("America/Sao_Paulo","2027-01-01T01:00:00Z"),{startsOn:"2026-12-01",endsOn:"2026-12-31"});
});
test("PostgreSQL goals: organization isolation, assignments, version, replay, revocation, rollback and concurrency", async () => {
  const a = await user(),
    b = await user(),
    c = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Goals Alpha" }, a),
    ),
    B = data(await call("POST", "/organizations", { name: "Goals Beta" }, b));
  const p = "/organizations/" + A.organization.id,
    q = "/organizations/" + B.organization.id;
  const period = data(
    await call(
      "POST",
      p + "/goal-periods",
      { title: "2026 Q4", startsOn: "2026-10-01", endsOn: "2026-12-31" },
      a,
    ),
    201,
  );
  const foreignPeriod = data(
    await call(
      "POST",
      q + "/goal-periods",
      { title: "2026 Q4", startsOn: "2026-10-01", endsOn: "2026-12-31" },
      b,
    ),
    201,
  );
  const calendarPeriod = data(await call("POST",p+"/goal-periods",{title:"Calendar month end",startsOn:"2028-01-31",frequency:1,calendarUnit:"MONTH"},a),201);
  assert.equal(calendarPeriod.startsOn,"2028-01-31");
  assert.equal(calendarPeriod.endsOn,"2028-02-28");
  const yearSpan = data(await call("POST",p+"/goal-periods",{title:"Leap anniversary",startsOn:"2028-02-29",frequency:12,calendarUnit:"MONTH"},a),201);
  assert.equal(yearSpan.endsOn,"2029-02-27");
  for (const frequency of [0,-1,1.5,121,"1"]) assert.equal((await call("POST",p+"/goal-periods",{title:"Invalid frequency",startsOn:"2027-01-31",frequency,calendarUnit:"MONTH"},a)).statusCode,400);
  assert.equal((await call("POST",p+"/goal-periods",{title:"Ambiguous calendar",startsOn:"2027-01-31",endsOn:"2027-03-01",frequency:1,calendarUnit:"MONTH"},a)).statusCode,400);
  assert.equal((await call("GET", q + "/goals", undefined, a)).statusCode, 404);
  const payload = {
    title: "Reduce lead time",
    ownerType: "MEMBER",
    ownerId: A.membership?.id,
    periodIds: [period.id],
    privacy: "PRIVATE",
  };
  // Foundation organization creation exposes member as membership or member, use authoritative bootstrap.
  const boot = data(await call("GET", p + "/bootstrap", undefined, a));
  payload.ownerId = boot.membership.id;
  assert.equal(
    (
      await call(
        "POST",
        p + "/goals",
        { ...payload, periodIds: [foreignPeriod.id] },
        a,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/goal-periods",
        { title: "Invalid", startsOn: "2026-99-01", endsOn: "2026-12-31" },
        a,
      )
    ).statusCode,
    400,
  );
  const key = randomUUID();
  let g = data(
    await call("POST", p + "/goals", payload, a, { "idempotency-key": key }),
    201,
  );
  // Filters are validated even in an empty tenant, and apply without widening ACL.
  for (const tenantPath of [p,q]) {
    const actor = tenantPath === p ? a : b;
    for (const filter of ["health=NOPE", "lifecycle=NOPE", "category=NOPE", "ownerId=invalid", "periodId=invalid", "view=NOPE"]) {
      assert.equal((await call("GET", tenantPath + "/goals?" + filter, undefined, actor)).statusCode,400);
    }
    assert.equal((await call("GET",tenantPath + "/goals/statistics?periodId=invalid",undefined,actor)).statusCode,400);
  }
  for (const filter of ["search=lead", "health=ON_TRACK", "lifecycle=ACTIVE", "category=TEAM", "ownerId="+payload.ownerId, "periodId="+period.id]) {
    const filtered=data(await call("GET",p+"/goals?"+filter,undefined,a));
    assert.deepEqual(filtered.items.map((item:any)=>item.id),[g.id]);
  }
  for (const filter of ["search=absent", "health=BLOCKED", "lifecycle=CLOSED", "category=INDIVIDUAL", "periodId="+foreignPeriod.id]) {
    assert.equal(data(await call("GET",p+"/goals?"+filter,undefined,a)).items.length,0);
  }
  assert.equal((await call("GET",p+"/goals?search=lead",undefined,b)).statusCode,404);
  // Fault after goal/history/audit/domain writes proves the shared UoW rolls all of them back.
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  assert.ok(
    migrationUrl && new URL(migrationUrl).pathname !== "/orgmap",
    "Isolated database required for fault injection",
  );
  const admin = new pg.Pool({ connectionString: migrationUrl }),
    fault = "goals_test_" + randomUUID().replaceAll("-", "");
  try {
    await admin.query(
      `CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM domain_events WHERE organization_id=NEW.organization_id AND id=NEW.event_id AND action='goal.progress.updated' AND resource_id='${g.id}'::uuid) THEN RAISE EXCEPTION 'goals isolated rollback fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${fault} BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION ${fault}()`,
    );
    const beforeFault = (
      await admin.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND resource_id=$2",
        [A.organization.id, g.id],
      )
    ).rows[0].n;
    assert.equal(
      (
        await call(
          "POST",
          p + "/goals/" + g.id + "/progress",
          { value: "25", comment: "must roll back" },
          a,
          { "if-match": '"' + g.version + '"' },
        )
      ).statusCode,
      500,
    );
    const rolledBack = data(
      await call("GET", p + "/goals/" + g.id, undefined, a),
    );
    assert.equal(rolledBack.version, g.version);
    assert.equal(rolledBack.manualProgress, "0");
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND resource_id=$2",
          [A.organization.id, g.id],
        )
      ).rows[0].n,
      beforeFault,
    );
  } finally {
    await admin.query(
      `DROP TRIGGER IF EXISTS ${fault} ON outbox; DROP FUNCTION IF EXISTS ${fault}()`,
    );
    await admin.end();
  }
  assert.equal(
    data(
      await call("POST", p + "/goals", payload, a, { "idempotency-key": key }),
      201,
    ).id,
    g.id,
  );
  assert.equal(
    (
      await call("POST", p + "/goals", { ...payload, title: "Different" }, a, {
        "idempotency-key": key,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await call("GET", q + "/goals/" + g.id, undefined, b)).statusCode,
    404,
  );
  const update = { ...payload, title: "Long title survives reload" };
  const simultaneous = await Promise.all([
    call("PATCH", p + "/goals/" + g.id, update, a, {
      "if-match": '"' + g.version + '"',
    }),
    call("PATCH", p + "/goals/" + g.id, update, a, {
      "if-match": '"' + g.version + '"',
    }),
  ]);
  assert.deepEqual(simultaneous.map((r) => r.statusCode).sort(), [200, 409]);
  g = data(await call("GET", p + "/goals/" + g.id, undefined, a));
  assert.equal(
    (
      await call(
        "POST",
        p + "/goals/" + g.id + "/key-results",
        {
          title: "Strict",
          resultType: "QUANTITATIVE",
          initialValue: "100bad",
          targetValue: "20",
        },
        a,
        { "if-match": '"' + g.version + '"' },
      )
    ).statusCode,
    400,
  );
  g = data(
    await call(
      "POST",
      p + "/goals/" + g.id + "/key-results",
      {
        title: "Latency",
        resultType: "QUANTITATIVE",
        initialValue: "100",
        targetValue: "20",
      },
      a,
      { "if-match": '"' + g.version + '"' },
    ),
    201,
  );
  const kr = g.keyResults[0];
  g = data(
    await call(
      "POST",
      p + "/goals/" + g.id + "/key-results/" + kr.id + "/progress",
      { value: "20" },
      a,
      { "if-match": '"' + kr.version + '"' },
    ),
  );
  assert.equal(g.lifecycle, "ACTIVE");
  assert.equal(g.keyResults[0].progress.display, 100);
  const before = g.version;
  const config = {
    source: "BOTH",
    manualProgress: "0",
    krWeight: "50",
    childWeight: "50",
    keyResults: [{ id: kr.id, weight: "2", excluded: false }],
    children: [],
  };
  g = data(
    await call("POST", p + "/goals/" + g.id + "/progress-config", config, a, {
      "if-match": '"' + g.version + '"',
    }),
  );
  assert.equal(g.progress.display, null);
  const bad = {
    ...config,
    source: "KEY_RESULTS",
    keyResults: [{ id: kr.id, weight: "99", excluded: false }],
    children: [{ id: randomUUID(), weight: "1", excluded: false }],
  };
  assert.equal(
    (
      await call("POST", p + "/goals/" + g.id + "/progress-config", bad, a, {
        "if-match": '"' + g.version + '"',
      })
    ).statusCode,
    422,
  );
  const afterRollback = data(
    await call("GET", p + "/goals/" + g.id, undefined, a),
  );
  assert.equal(afterRollback.keyResults[0].weight, "2");
  assert.equal(afterRollback.version, g.version);
  const memberResponse = data(
    await call("POST", p + "/members", { accountId: c.id }, a),
  );
  const mid = memberResponse.membership.id;
  assert.equal(
    (await call("GET", p + "/goals/" + g.id, undefined, c)).statusCode,
    404,
  );
  const inaccessible = data(
    await call("GET", p + "/goal-adapter-test/" + g.id, undefined, c),
  );
  assert.equal(inaccessible.read, false);
  assert.deepEqual(inaccessible.found, []);
  assert.equal(inaccessible.export, null);
  assert.equal(
    (
      await call("PATCH", p + "/goals/" + g.id, { title: "Unauthorized" }, c, {
        "if-match": '"' + g.version + '"',
      })
    ).statusCode,
    404,
  );
  g = data(
    await call(
      "POST",
      p + "/goals/" + g.id + "/assignments",
      {
        assignments: [
          { memberId: mid, functionalRole: "CONTRIBUTOR", keyResultId: kr.id },
          {
            memberId: boot.membership.id,
            functionalRole: "CONTRIBUTOR",
            keyResultId: kr.id,
          },
        ],
      },
      a,
      { "if-match": '"' + g.version + '"' },
    ),
  );
  assert.equal(g.assignments.length, 2);
  g = data(
    await call(
      "PATCH",
      p + "/goals/" + g.id,
      { title: "Member authorized" },
      c,
      { "if-match": '"' + g.version + '"' },
    ),
  );
  const authorized = data(
    await call("GET", p + "/goal-adapter-test/" + g.id, undefined, c),
  );
  assert.equal(authorized.read, true);
  assert.equal(authorized.export.records[0].title, "Member authorized");
  const replayKey = randomUUID(),
    replayVersion = g.version,
    replayBody = { title: "Member milestone", resultType: "MILESTONE" };
  g = data(
    await call("POST", p + "/goals/" + g.id + "/key-results", replayBody, c, {
      "if-match": '"' + replayVersion + '"',
      "idempotency-key": replayKey,
    }),
    201,
  );
  g = data(
    await call(
      "POST",
      p + "/goals/" + g.id + "/assignments",
      { assignments: [] },
      a,
      { "if-match": '"' + g.version + '"' },
    ),
  );
  assert.equal(
    (await call("GET", p + "/goals/" + g.id, undefined, c)).statusCode,
    404,
  );
  assert.equal(
    (
      await call("POST", p + "/goals/" + g.id + "/key-results", replayBody, c, {
        "if-match": '"' + replayVersion + '"',
        "idempotency-key": replayKey,
      })
    ).statusCode,
    404,
  );
  const privateOther = data(
    await call(
      "POST",
      p + "/goals",
      { ...payload, title: "Private recipient goal", ownerId: mid },
      a,
    ),
    201,
  );
  const removedCreator = data(
    await call(
      "POST",
      p + "/goals/" + privateOther.id + "/assignments",
      { assignments: [] },
      a,
      { "if-match": '"' + privateOther.version + '"' },
    ),
  );
  assert.equal(removedCreator.accessRevoked, true);
  assert.equal(
    (await call("GET", p + "/goals/" + privateOther.id, undefined, a))
      .statusCode,
    404,
  );
  assert.equal(
    data(
      await call(
        "GET",
        p + "/goal-adapter-test/" + privateOther.id,
        undefined,
        a,
      ),
    ).read,
    false,
  );
  assert.ok(
    !data(await call("GET", p + "/goals", undefined, a)).items.some(
      (v: any) => v.id === privateOther.id,
    ),
  );
  assert.equal(
    data(await call("GET", p + "/goals/" + privateOther.id, undefined, c))
      .title,
    "Private recipient goal",
  );
  const localTask = data(
    await call("POST", p + "/work/tasks", { title: "Linked personal work" }, a),
  ).task;
  const foreignTask = data(
    await call(
      "POST",
      q + "/work/tasks",
      { title: "Foreign personal work" },
      b,
    ),
  ).task;
  let currentKr = g.keyResults.find((v: any) => v.id === kr.id);
  g = data(
    await call(
      "POST",
      p + "/goals/" + g.id + "/key-results/" + kr.id + "/links",
      { links: [{ kind: "TASK", id: localTask.id }] },
      a,
      { "if-match": '"' + currentKr.version + '"' },
    ),
  );
  currentKr = g.keyResults.find((v: any) => v.id === kr.id);
  assert.equal(currentKr.links[0].id, localTask.id);
  assert.equal(
    (
      await call(
        "POST",
        p + "/goals/" + g.id + "/key-results/" + kr.id + "/links",
        { links: [{ kind: "TASK", id: foreignTask.id }] },
        a,
        { "if-match": '"' + currentKr.version + '"' },
      )
    ).statusCode,
    404,
  );
  assert.equal(
    data(await call("GET", p + "/goals/" + g.id, undefined, a)).keyResults.find(
      (v: any) => v.id === kr.id,
    ).links[0].id,
    localTask.id,
  );
  const localProject=data(await call("POST",p+"/work/projects",{title:"Linked private project sentinel",visibility:"PRIVATE"},a)).project;
  const foreignProject=data(await call("POST",q+"/work/projects",{title:"Foreign project sentinel",visibility:"PRIVATE"},b)).project;
  g=data(await call("POST",p+"/goals/"+g.id+"/key-results/"+kr.id+"/links",{links:[{kind:"TASK",id:localTask.id},{kind:"PROJECT",id:localProject.id}]},a,{"if-match":'"'+currentKr.version+'"'}));
  currentKr=g.keyResults.find((v:any)=>v.id===kr.id);
  assert.ok(currentKr.links.some((link:any)=>link.kind==="PROJECT" && link.id===localProject.id));
  const projectProjection=currentKr.links.find((link:any)=>link.id===localProject.id);
  assert.equal(projectProjection.title, localProject.title, "authorized project shows its current title");
  assert.equal(projectProjection.titleSource, undefined);
  const taskProjection=currentKr.links.find((link:any)=>link.kind==="TASK" && link.id===localTask.id);
  assert.equal(taskProjection.title, localTask.title, "authorized task shows its current title");
  assert.equal(taskProjection.titleSource, undefined);
  g=data(await call("POST",p+"/goals/"+g.id+"/assignments",{assignments:[{memberId:mid,functionalRole:"FOLLOWER",keyResultId:kr.id}]},a,{"if-match":'"'+g.version+'"'}));
  const contributorLinks=data(await call("GET",p+"/goals/"+g.id,undefined,c)).keyResults.find((v:any)=>v.id===kr.id).links;
  assert.ok(!JSON.stringify(contributorLinks).includes(localProject.id),"KR contribution does not grant access to linked private project IDs");
  assert.ok(!JSON.stringify(contributorLinks).includes(localProject.title),"linked private project title stays hidden");
  assert.ok(!JSON.stringify(contributorLinks).includes(localTask.id),"KR contribution does not grant access to a personal task");
  assert.ok(!JSON.stringify(contributorLinks).includes(localTask.title),"linked personal task title stays hidden");
  assert.equal((await call("GET",p+"/work/projects/"+localProject.id,undefined,c)).statusCode,404);
  g=data(await call("POST",p+"/goals/"+g.id+"/assignments",{assignments:[]},a,{"if-match":'"'+g.version+'"'}));
  assert.equal((await call("POST",p+"/goals/"+g.id+"/key-results/"+kr.id+"/links",{links:[{kind:"PROJECT",id:foreignProject.id}]},a,{"if-match":'"'+currentKr.version+'"'})).statusCode,404);
  const preservedLinks=data(await call("GET",p+"/goals/"+g.id,undefined,a)).keyResults.find((v:any)=>v.id===kr.id).links;
  assert.deepEqual(preservedLinks.map((link:any)=>link.kind+":"+link.id).sort(),["TASK:"+localTask.id,"PROJECT:"+localProject.id].sort(),"foreign project failure preserves both existing links atomically");
  const child = data(
    await call(
      "POST",
      p + "/goals",
      { ...payload, title: "Child", parentId: g.id },
      a,
    ),
    201,
  );
  assert.equal(
    (
      await call("PATCH", p + "/goals/" + g.id, { parentId: child.id }, a, {
        "if-match": '"' + g.version + '"',
      })
    ).statusCode,
    422,
  );
  const events = data(
    await call("GET", p + "/goals/" + g.id + "/history", undefined, a),
  );
  assert.ok(events.items.length >= 6);
  assert.ok(g.version > before);
  g = data(
    await call(
      "POST",
      p + "/goals/" + g.id + "/lifecycle",
      { lifecycle: "ARCHIVED" },
      a,
      { "if-match": '"' + g.version + '"' },
    ),
  );
  assert.equal(
    (
      await call("PATCH", p + "/goals/" + g.id, { title: "Archived" }, a, {
        "if-match": '"' + g.version + '"',
      })
    ).statusCode,
    409,
  );
  const archivedAccess = data(
    await call("GET", p + "/goal-adapter-test/" + g.id, undefined, a),
  );
  assert.equal(archivedAccess.read, true);
  assert.equal(archivedAccess.comment, false);
  const stat = data(
    await call(
      "GET",
      p + "/goals/statistics?periodId=" + period.id,
      undefined,
      a,
    ),
  );
  assert.equal(stat.denominator, 2);
  assert.equal(stat.estimated, false);
  const monthStat = data(await call("GET",p+"/goals/statistics?window=CURRENT_MONTH",undefined,a));
  assert.equal(monthStat.window.kind,"CURRENT_MONTH");
  assert.equal(monthStat.window.basis,"GOAL_PERIOD_OVERLAP");
  assert.match(monthStat.window.startsOn,/^\d{4}-\d{2}-01$/);
  data(await call("POST",p+"/goals",{...payload,title:"Future calendar only",periodIds:[calendarPeriod.id]},a),201);
  const allFuture = data(await call("GET",p+"/goals/statistics?window=ALL&periodId="+calendarPeriod.id,undefined,a));
  assert.equal(allFuture.denominator,1);
  const futureOnly = data(await call("GET",p+"/goals/statistics?window=CURRENT_MONTH&periodId="+calendarPeriod.id,undefined,a));
  assert.equal(futureOnly.denominator,0);
  assert.equal((await call("GET",p+"/goals/statistics?window=INVALID",undefined,a)).statusCode,400);
  assert.equal(stat.metricDefinitionVersion, "orgmap-goal-statistics-v1");
  assert.equal(stat.completion.denominator, stat.denominator - stat.lifecycle.ARCHIVED);
  assert.equal(stat.completion.numerator, stat.lifecycle.CLOSED);
  assert.equal(stat.activeOwners.denominator >= stat.activeOwners.numerator, true);
  assert.equal(Number.isInteger(stat.keyResultCount), true);
  const emptyStat = data(await call("GET", q + "/goals/statistics", undefined, b));
  assert.equal(emptyStat.denominator, 0);
  assert.equal(emptyStat.keyResultCount, 0);
  assert.deepEqual(emptyStat.completion, {numerator:0,denominator:0,percent:null});
  assert.deepEqual(emptyStat.activeOwners, {numerator:0,denominator:0,percent:null});
  let weightedParent = data(
    await call(
      "POST",
      p + "/goals",
      { ...payload, title: "Weighted authorized coverage" },
      a,
    ),
    201,
  );
  weightedParent = data(
    await call(
      "POST",
      p + "/goals/" + weightedParent.id + "/key-results",
      { title: "Reached milestone", resultType: "MILESTONE" },
      a,
      { "if-match": '"' + weightedParent.version + '"' },
    ),
    201,
  );
  const weightedKr = weightedParent.keyResults[0];
  weightedParent = data(
    await call(
      "POST",
      p +
        "/goals/" +
        weightedParent.id +
        "/key-results/" +
        weightedKr.id +
        "/progress",
      { value: true },
      a,
      { "if-match": '"' + weightedKr.version + '"' },
    ),
  );
  let hiddenChild = data(
    await call(
      "POST",
      p + "/goals",
      {
        ...payload,
        title: "Hidden contributor",
        ownerId: mid,
        parentId: weightedParent.id,
      },
      a,
    ),
    201,
  );
  const weightedConfig = {
    source: "BOTH",
    manualProgress: "0",
    krWeight: "100",
    childWeight: "0",
    keyResults: [{ id: weightedKr.id, weight: "1", excluded: false }],
    children: [{ id: hiddenChild.id, weight: "1", excluded: false }],
  };
  weightedParent = data(
    await call(
      "POST",
      p + "/goals/" + weightedParent.id + "/progress-config",
      weightedConfig,
      a,
      { "if-match": '"' + weightedParent.version + '"' },
    ),
  );
  hiddenChild = data(
    await call("GET", p + "/goals/" + hiddenChild.id, undefined, a),
  );
  data(
    await call(
      "POST",
      p + "/goals/" + hiddenChild.id + "/assignments",
      { assignments: [] },
      a,
      { "if-match": '"' + hiddenChild.version + '"' },
    ),
  );
  assert.equal(
    data(await call("GET", p + "/goals/" + weightedParent.id, undefined, a))
      .progress.display,
    100,
    "A zero-weight child source cannot erase known KR progress",
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/goals/" + weightedParent.id + "/progress-config",
        { ...weightedConfig, krWeight: "50", childWeight: "50" },
        a,
        { "if-match": '"' + weightedParent.version + '"' },
      )
    ).statusCode,
    404,
    "Known hidden child IDs do not authorize changing their weights",
  );
  const viaRole = data(
    await call(
      "POST",
      p + "/roles",
      { circleId: A.rootCircle.id, name: "Delivery steward", mode: "DIRECT" },
      a,
    ),
  ).role;
  const occupancy = data(
    await call(
      "POST",
      p + "/roles/" + viaRole.id + "/occupancies",
      { memberId: mid, kind: "DIRECT" },
      a,
    ),
  ).occupancy;
  const viaGoal = data(
    await call(
      "POST",
      p + "/goals",
      {
        ...payload,
        title: "Private via current role",
        ownerId: mid,
        ownerViaRoleId: viaRole.id,
      },
      a,
    ),
    201,
  );
  assert.equal(
    data(await call("GET", p + "/goals/" + viaGoal.id, undefined, c)).id,
    viaGoal.id,
  );
  data(
    await call("POST", p + "/occupancies/" + occupancy.id + "/end", {}, a, {
      "if-match": '"' + occupancy.version + '"',
    }),
  );
  assert.equal(
    (await call("GET", p + "/goals/" + viaGoal.id, undefined, c)).statusCode,
    404,
  );
  data(
    await call("PATCH", p + "/members/" + mid, { status: "SUSPENDED" }, a, {
      "if-match": '"' + memberResponse.membership.version + '"',
    }),
  );
  assert.equal((await call("GET", p + "/goals", undefined, c)).statusCode, 404);
  assert.equal((await pool.query("SELECT * FROM goals")).rowCount, 0);
  const sourceId = randomUUID(),
    conversion = {
      title: "Convert tension into scoped goal",
      circleId: A.rootCircle.id,
      tensionId: sourceId,
    };
  const converted = data(
    await call("POST", p + "/goal-service-test", conversion, a),
  );
  assert.equal(
    data(await call("POST", p + "/goal-service-test", conversion, a)).id,
    converted.id,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/goal-service-test",
        { ...conversion, tensionId: randomUUID(), circleId: B.rootCircle.id },
        a,
      )
    ).statusCode,
    404,
  );
  assert.ok(
    data(
      await call(
        "GET",
        p + "/goal-meeting-test?circleId=" + A.rootCircle.id,
        undefined,
        a,
      ),
    ).some((v: any) => v.id === converted.id && v.kind === "GOAL"),
  );
  assert.deepEqual(
    data(
      await call(
        "GET",
        q + "/goal-meeting-test?circleId=" + A.rootCircle.id,
        undefined,
        b,
      ),
    ),
    [],
  );
  data(
    await call(
      "POST",
      p + "/goal-periods",
      {
        title: "Ambiguous overlap",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
      },
      a,
    ),
    201,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/goal-service-test",
        { ...conversion, tensionId: randomUUID() },
        a,
      )
    ).statusCode,
    422,
  );
  let typed = data(await call("POST",p+"/goals",{...payload,title:"Typed result scales"},a),201);
  typed = data(await call("POST",p+"/goals/"+typed.id+"/key-results",{title:"Binary completion",resultType:"BINARY"},a,{"if-match":'"'+typed.version+'"'}),201);
  const binary = typed.keyResults.find((k:any)=>k.resultType==="BINARY");
  assert.equal(binary.initialValue,"0");assert.equal(binary.targetValue,"1");
  typed = data(await call("POST",p+"/goals/"+typed.id+"/key-results/"+binary.id+"/progress",{value:true},a,{"if-match":'"'+binary.version+'"'}));
  const completedBinary = typed.keyResults.find((k:any)=>k.id===binary.id);
  assert.equal(completedBinary.currentValue,"1");assert.equal(completedBinary.progress.display,100);
  assert.equal((await call("POST",p+"/goals/"+typed.id+"/key-results/"+binary.id+"/progress",{value:"0.5"},a,{"if-match":'"'+completedBinary.version+'"'})).statusCode,400);
  assert.equal((await call("PATCH",p+"/goals/"+typed.id+"/key-results/"+binary.id,{targetValue:"2"},a,{"if-match":'"'+completedBinary.version+'"'})).statusCode,422);
  typed = data(await call("POST",p+"/goals/"+typed.id+"/key-results",{title:"Custom scale",resultType:"CUSTOM",initialValue:"10",targetValue:"2",unit:"pontos de espera"},a,{"if-match":'"'+typed.version+'"'}),201);
  const custom=typed.keyResults.find((k:any)=>k.resultType==="CUSTOM");
  typed=data(await call("POST",p+"/goals/"+typed.id+"/key-results/"+custom.id+"/progress",{value:"6"},a,{"if-match":'"'+custom.version+'"'}));
  assert.equal(typed.keyResults.find((k:any)=>k.id===custom.id).progress.display,50);
  typed = data(await call("POST",p+"/goals/"+typed.id+"/key-results",{title:"Percentage with independent progress",resultType:"PERCENTAGE",initialValue:"20",targetValue:"80",unit:"%"},a,{"if-match":'"'+typed.version+'"'}),201);
  const percentage = typed.keyResults.find((k:any)=>k.resultType==="PERCENTAGE");
  assert.equal(percentage.initialValue,"20");
  assert.equal(percentage.targetValue,"80");
  assert.equal(percentage.unit,"%");
  typed = data(await call("POST",p+"/goals/"+typed.id+"/key-results/"+percentage.id+"/progress",{value:"35",comment:"35% measured; 25% of the configured interval achieved."},a,{"if-match":'"'+percentage.version+'"'}));
  const measuredPercentage=typed.keyResults.find((k:any)=>k.id===percentage.id);
  assert.equal(measuredPercentage.resultType,"PERCENTAGE");
  assert.equal(measuredPercentage.currentValue,"35");
  assert.equal(measuredPercentage.progress.display,25);
  assert.equal(typed.lifecycle,"ACTIVE");
  assert.equal((await call("POST",p+"/goals/"+typed.id+"/key-results/"+percentage.id+"/progress",{value:"35,5"},a,{"if-match":'"'+measuredPercentage.version+'"'})).statusCode,400);
  assert.equal(data(await call("GET",p+"/goals/"+typed.id,undefined,a)).keyResults.find((k:any)=>k.id===percentage.id).currentValue,"35");
  // Confidence is an explicit judgement, independent of health and numeric progress.
  const confidencePath=p+"/goals/"+typed.id+"/key-results/"+percentage.id+"/progress";
  assert.equal(measuredPercentage.confidenceLevel,null);
  let confidenceKr=measuredPercentage;
  for(const confidenceLevel of ["LOW","MEDIUM","HIGH",null]) {
    typed=data(await call("POST",confidencePath,{value:"35",confidenceLevel},a,{"if-match":'"'+confidenceKr.version+'"'}));
    confidenceKr=typed.keyResults.find((k:any)=>k.id===percentage.id);
    assert.equal(confidenceKr.confidenceLevel,confidenceLevel);
    assert.equal(confidenceKr.progress.display,25);
    assert.equal(confidenceKr.health,"ON_TRACK");
  }
  typed=data(await call("POST",confidencePath,{value:"35",confidenceLevel:"HIGH"},a,{"if-match":'"'+confidenceKr.version+'"'}));
  confidenceKr=typed.keyResults.find((k:any)=>k.id===percentage.id);
  typed=data(await call("POST",confidencePath,{value:"35"},a,{"if-match":'"'+confidenceKr.version+'"'}));
  confidenceKr=typed.keyResults.find((k:any)=>k.id===percentage.id);
  assert.equal(confidenceKr.confidenceLevel,"HIGH","omitting confidence preserves the explicit judgement");
  assert.equal((await call("POST",confidencePath,{value:"36",confidenceLevel:"LOW"},b,{"if-match":'"'+confidenceKr.version+'"'})).statusCode,404);
  assert.equal((await call("POST",confidencePath,{value:"36",confidenceLevel:"LOW"},a,{"if-match":'"'+measuredPercentage.version+'"'})).statusCode,409);
  assert.equal((await call("GET",p+"/goals/"+typed.id+"/history",undefined,b)).statusCode,404);
  const confidenceHistory=data(await call("GET",p+"/goals/"+typed.id+"/history",undefined,a)).items;
  for(const level of ["LOW","MEDIUM","HIGH",null])assert.ok(confidenceHistory.some((event:any)=>event.progressUpdate?.keyResultId===percentage.id && event.progressUpdate.confidenceLevel===level && event.progressUpdate.value==="35"),"confidence history API: "+level);
  const confidenceAdmin=new pg.Pool({connectionString:migrationUrl});
  try {
    const snapshots=(await confidenceAdmin.query("SELECT snapshot FROM goal_history WHERE organization_id=$1 AND goal_id=$2 AND action='goal.key-result.progressed'",[A.organization.id,typed.id])).rows;
    for(const level of ["LOW","MEDIUM","HIGH",null])assert.ok(snapshots.some(row=>row.snapshot.keyResults.some((k:any)=>k.id===percentage.id && k.confidenceLevel===level)),"durable confidence history: "+level);
    await assert.rejects(confidenceAdmin.query("UPDATE goal_key_results SET confidence_level='CERTAIN' WHERE organization_id=$1 AND id=$2",[A.organization.id,percentage.id]),(error:any)=>error.code==='23514');
  } finally {await confidenceAdmin.end();}

  assert.equal((await call("POST",confidencePath,{value:"36",confidenceLevel:"CERTAIN"},a,{"if-match":'"'+confidenceKr.version+'"'})).statusCode,400);
  assert.equal(data(await call("GET",p+"/goals/"+typed.id,undefined,a)).keyResults.find((k:any)=>k.id===percentage.id).currentValue,"35");
  const richDocument={format:"orgmap-richtext",version:1,doc:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Descrição 🌿",marks:[{type:"bold"}]},{type:"text",text:"fonte",marks:[{type:"link",attrs:{href:"https://example.com"}}]}]},{type:"bulletList",content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"Ação com cuidado"}]}]}]}]}};
  let richGoal=data(await call("POST",p+"/goals",{...payload,title:"Rich durable goal",descriptionRich:richDocument},a),201);
  assert.deepEqual(richGoal.descriptionRich,richDocument);
  assert.match(richGoal.description,/Descrição 🌿/);
  assert.match(richGoal.description,/Ação com cuidado/);
  assert.deepEqual(data(await call("GET",p+"/goals/"+richGoal.id,undefined,a)).descriptionRich,richDocument);
  assert.equal((await call("PATCH",p+"/goals/"+richGoal.id,{descriptionRich:richDocument},b,{"if-match":'"'+richGoal.version+'"'})).statusCode,404);
  const unsafeDocument=validateRichDocument(richDocument);
  const paragraph=unsafeDocument.doc.content[0];
  if(paragraph.type!=="paragraph")throw Error("Expected paragraph fixture");
  const linkedText=paragraph.content?.[1];
  if(linkedText?.type!=="text")throw Error("Expected text fixture");
  const linkMark=linkedText.marks?.find(mark=>mark.type==="link");
  if(linkMark?.type!=="link")throw Error("Expected link fixture");
  linkMark.attrs.href="javascript:alert(1)";
  assert.equal((await call("PATCH",p+"/goals/"+richGoal.id,{descriptionRich:unsafeDocument},a,{"if-match":'"'+richGoal.version+'"'})).statusCode,400);
  assert.deepEqual(data(await call("GET",p+"/goals/"+richGoal.id,undefined,a)).descriptionRich,richDocument);
  richGoal=data(await call("POST",p+"/goals/"+richGoal.id+"/key-results",{title:"Rich KR",resultType:"QUANTITATIVE",descriptionRich:richDocument},a,{"if-match":'"'+richGoal.version+'"'}),201);
  assert.deepEqual(richGoal.keyResults[0].descriptionRich,richDocument);
  richGoal=data(await call("PATCH",p+"/goals/"+richGoal.id,{description:"**literal legacy**"},a,{"if-match":'"'+richGoal.version+'"'}));
  assert.equal(richGoal.descriptionRich,null);
  assert.equal(richGoal.description,"**literal legacy**");
});

test("goal cursors bind tenant, filter and authorization revision", () => {
  const items = [{ id: randomUUID() }, { id: randomUUID() }];
  const first = page(items, "A", 1, { limit: "1", health: "ON_TRACK" });
  assert.equal(first.items.length, 1);
  assert.equal(first.page.hasMore, true);
  assert.equal(
    page(items, "A", 1, {
      limit: "1",
      health: "ON_TRACK",
      cursor: first.page.nextCursor,
    }).items[0].id,
    items[1].id,
  );
  for (const [org, revision, filter] of [
    ["B", 1, "ON_TRACK"],
    ["A", 2, "ON_TRACK"],
    ["A", 1, "BLOCKED"],
  ] as const)
    assert.throws(() =>
      page(items, org, revision, {
        limit: "1",
        health: filter,
        cursor: first.page.nextCursor,
      }),
    );
  assert.throws(() => page(items, "A", 1, { limit: "101" }));
  assert.throws(() =>
    page(items, "A", 1, { cursor: first.page.nextCursor + "tampered" }),
  );
});

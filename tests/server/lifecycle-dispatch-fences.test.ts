import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { pool, transaction } from "../../server/src/db.js";
import { authorizeOrganizationEffect, recordOrganizationEffectOutcome } from "../../server/src/organization-effects.js";

const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const operator = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/");
if (!/^\/orgmap_test_[a-f0-9]{16,32}$/.test(runtime.pathname) || runtime.pathname !== operator.pathname ||
    runtime.host !== operator.host || !["127.0.0.1", "localhost", "[::1]"].includes(runtime.hostname))
  throw Error("EXCLUSIVE_LIFECYCLE_DISPATCH_DATABASE_REQUIRED");
const admin = new pg.Pool({ connectionString: operator.href });
after(async () => { await pool.end(); await admin.end(); });

test("privileged dispatch, late leases and authorized external effects are fenced", async () => {
  const role = "lf04_dispatch_" + randomBytes(8).toString("hex"), password = randomBytes(24).toString("hex");
  const dispatchUrl = new URL(operator.href); dispatchUrl.username = role; dispatchUrl.password = password;
  let dispatch: pg.Pool | undefined, created = false;
  try {
    await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`); created = true;
    await admin.query(`GRANT orgmap_platform_dispatcher TO "${role}"`);
    dispatch = new pg.Pool({ connectionString: dispatchUrl.href });
    const fixture = async () => {
      const org = randomUUID(), account = randomUUID(), member = randomUUID();
      await admin.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture','unused')", [account, account + "@example.test"]);
      await admin.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Fixture','pt-BR','UTC')", [org]);
      await admin.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')", [org, member, account]);
      await admin.query("INSERT INTO platform_worker_scopes(organization_id,member_id) VALUES($1,$2)", [org, member]);
      await admin.query("INSERT INTO platform_scope_wakes(organization_id,id,member_id,participant) VALUES($1,$2,$3,'interoperability')", [org, randomUUID(), member]);
      return { org, member };
    };
    const a = await fixture();
    const delivery = randomUUID();
    await admin.query(`INSERT INTO platform_deliveries(organization_id,id,event_id,recipient_id,channel,resource_type,resource_id,event)
      VALUES($1,$2,$3,$4,'IN_APP','fixture',$5,'Fixture')`, [a.org, delivery, randomUUID(), a.member, randomUUID()]);
    for (const isolation of ["REPEATABLE READ", "SERIALIZABLE"]) {
      const iam = await admin.connect();
      try {
        await iam.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await iam.query("SELECT * FROM iam_mail_claim()").then(
          () => assert.fail("IAM discovery must fail closed under unsupported isolation"),
          (error) => assert.match(error.message, /LIFECYCLE_ISOLATION_UNSUPPORTED/));
      } finally { await iam.query("ROLLBACK"); iam.release(); }
      const client = await dispatch.connect();
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await client.query("SELECT count(*) FROM platform_claimed_participants($1,$2,$3)", [a.org,a.member,randomUUID()]).then(
          () => assert.fail("unsupported isolation must fail closed"),
          (error) => assert.match(error.message, /LIFECYCLE_ISOLATION_UNSUPPORTED/));
      } finally { await client.query("ROLLBACK"); client.release(); }
      const application = await pool.connect();
      try {
        await application.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await application.query("SELECT set_config('orgmap.organization_id',$1,true)", [a.org]);
        await authorizeOrganizationEffect(application, { organizationId:a.org, owner:"INTEROP", effectKey:"unsupported:" + isolation.replace(" ","_"), sourceLeaseToken:randomUUID(), validateSourceLease:async()=>false }).then(
          () => assert.fail("unsupported isolation must fail closed"),
          (error: any) => assert.equal(error.code, "LIFECYCLE_ISOLATION_UNSUPPORTED"));
      } finally { await application.query("ROLLBACK"); application.release(); }
    }
    const scopeToken = randomUUID();
    const scope = (await dispatch.query("SELECT * FROM platform_claim_scope($1,$2::text[])", [scopeToken, ["interoperability"]])).rows[0];
    assert.equal(scope.organization_id, a.org);
    const claimToken = randomUUID();
    const claimed = (await dispatch.query("SELECT * FROM platform_claim_delivery_metadata($1,$2,$3,$4)", [a.org, a.member, scopeToken, claimToken])).rows[0];
    assert.equal(claimed.delivery_id, delivery);
    await admin.query("UPDATE platform_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2", [a.org, delivery]);
    assert.equal((await dispatch.query("SELECT platform_finish_delivery_metadata($1,$2,$3,$4,'RETRY') AS ok", [a.org,a.member,delivery,claimToken])).rows[0].ok, false);
    await admin.query("UPDATE platform_deliveries SET lease_until=clock_timestamp()+interval '1 minute' WHERE organization_id=$1 AND id=$2", [a.org, delivery]);
    const cut = await admin.connect(), late = await dispatch.connect();
    try {
      await cut.query("BEGIN");
      await cut.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [a.org]);
      await cut.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=fence+1 WHERE organization_id=$1", [a.org]);
      const pid = (await late.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const pending = late.query("SELECT platform_heartbeat_scope($1,$2,$3) AS ok", [a.org, a.member, scopeToken]);
      let blocked = false;
      for (let n=0;n<300;n++) {
        if (Number((await admin.query("SELECT cardinality(pg_blocking_pids($1)) AS n", [pid])).rows[0].n)>0) { blocked=true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(blocked);
      await cut.query("COMMIT");
      assert.equal((await pending).rows[0].ok, false);
    } finally { await cut.query("ROLLBACK").catch(() => {}); cut.release(); late.release(); }
    assert.equal((await dispatch.query("SELECT platform_release_scope($1,$2,$3,false,$4::text[]) AS ok", [a.org,a.member,scopeToken,["interoperability"]])).rows[0].ok, false);
    assert.equal((await dispatch.query("SELECT platform_finish_delivery_metadata($1,$2,$3,$4,'RETRY') AS ok", [a.org,a.member,delivery,claimToken])).rows[0].ok, false);
    assert.equal((await dispatch.query("SELECT * FROM platform_claimed_participants($1,$2,$3)", [a.org,a.member,scopeToken])).rowCount, 0);
    assert.equal(Number((await admin.query("SELECT count(*) AS n FROM platform_scope_wakes WHERE organization_id=$1", [a.org])).rows[0].n), 1);
    const b = await fixture(), bToken = randomUUID();
    assert.equal((await dispatch.query("SELECT * FROM platform_claim_scope($1,$2::text[])", [bToken,["interoperability"]])).rows[0].organization_id, b.org);
    const validateB = async (client: pg.PoolClient, token: string, fence: string) => !!(await client.query(
      "SELECT 1 FROM platform_worker_scopes WHERE organization_id=$1 AND member_id=$2 AND lease_token=$3 AND lifecycle_fence=$4::bigint AND lease_until>clock_timestamp() FOR UPDATE",
      [b.org,b.member,token,fence])).rowCount;
    await assert.rejects(transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [b.org]);
      return authorizeOrganizationEffect(c, { organizationId:b.org, owner:"INTEROP", effectKey:"fixture:invalid-lease", sourceLeaseToken:randomUUID(), validateSourceLease:validateB });
    }), (error: any) => error?.code === "EFFECT_LEASE_INVALID");
    await assert.rejects(transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [b.org]);
      await c.query(`INSERT INTO organization_effects(organization_id,id,owner,effect_key,lifecycle_fence,source_lease_token,effect_token,state,completed_at)
        VALUES($1,$2,'INTEROP','fixture:invalid-state',1,$3,$4,'CONFIRMED',clock_timestamp())`, [b.org,randomUUID(),bToken,randomUUID()]);
    }), /effect must start authorized/);
    const effect = await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [b.org]);
      return authorizeOrganizationEffect(c, { organizationId: b.org, owner: "INTEROP", effectKey: "fixture:1", sourceLeaseToken: bToken,
        validateSourceLease: validateB });
    });
    await assert.rejects(transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [b.org]);
      await authorizeOrganizationEffect(c, { organizationId:b.org, owner:"INTEROP", effectKey:"fixture:1", sourceLeaseToken:bToken,
        validateSourceLease: validateB });
    }));
    const cutB = await admin.connect(), waitingSender = await pool.connect();
    try {
      await cutB.query("BEGIN"); await cutB.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [b.org]);
      await waitingSender.query("BEGIN");
      await waitingSender.query("SELECT set_config('orgmap.organization_id',$1,true)", [b.org]);
      const pid = (await waitingSender.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const afterCut = authorizeOrganizationEffect(waitingSender, { organizationId:b.org, owner:"INTEROP", effectKey:"fixture:cut-race", sourceLeaseToken:bToken, validateSourceLease:validateB })
        .then(() => "accepted", () => "rejected");
      let blocked = false;
      for (let n=0;n<300;n++) {
        if (Number((await admin.query("SELECT cardinality(pg_blocking_pids($1)) AS n", [pid])).rows[0].n)>0) { blocked=true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(blocked, "effect authorization must wait for Org cutover");
      await cutB.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=fence+1 WHERE organization_id=$1", [b.org]);
      await cutB.query("COMMIT");
      assert.equal(await afterCut, "rejected");
    } finally { await cutB.query("ROLLBACK").catch(() => {}); await waitingSender.query("ROLLBACK").catch(() => {}); cutB.release(); waitingSender.release(); }
    assert.deepEqual(await transaction(async (c) => { await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [b.org]); return recordOrganizationEffectOutcome(c,effect,"OUTCOME_UNKNOWN"); }), { recorded: true, cutoverOccurred: true });
    assert.deepEqual(await transaction(async (c) => { await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [b.org]); return recordOrganizationEffectOutcome(c,effect,"CONFIRMED"); }), { recorded: false, cutoverOccurred: true });
    await assert.rejects(transaction(async (c) => { await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [b.org]); return authorizeOrganizationEffect(c, { organizationId:b.org, owner:"INTEROP", effectKey:"fixture:2", sourceLeaseToken:bToken, validateSourceLease: validateB }); }));
  } finally {
    if (dispatch) await dispatch.end();
    if (created) await admin.query(`DROP ROLE "${role}"`);
  }
});

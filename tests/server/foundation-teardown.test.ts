import { strict as assert } from "node:assert";
import test from "node:test";
import { createFoundationTeardownParticipant } from "../../server/src/foundation-teardown.js";
import { foundationDisposition } from "../../server/src/organization-deletion-catalog.js";

test("Foundation declares every owned tenant set and waits for all other owners", () => {
  const participant = createFoundationTeardownParticipant();
  assert.equal(participant.contextId, "foundation");
  assert.deepEqual(participant.describe().ownedSets, foundationDisposition.tenantCandidate);
  assert.deepEqual(new Set(participant.describe().after), new Set(["administration", "platform", "structure", "governance", "work", "goals", "meetings", "interoperability"]));
});

test("Foundation forwards the exact maintenance authority and rejects malformed results", async () => {
  const participant = createFoundationTeardownParticipant();
  const calls: unknown[][] = [];
  const ctx = { organizationId: "org", jobId: "job", lifecycleFence: "9", leaseToken: "lease",
    c: { query: async (_sql: string, args: unknown[]) => { calls.push(args); return { rows: [{ result: null }] }; } } } as any;
  await assert.rejects(participant.runBatch(ctx, { phase: "PURGE", cursor: "2", limit: 7 }), /INVALID_TEARDOWN_BATCH_RESULT/);
  assert.deepEqual(calls, [["org", "job", "9", "lease", "PURGE", "2", 7]]);
});

import { randomUUID } from "node:crypto";
import pg from "pg";

test("Foundation purge: isolated A/B, real owner absence, bounded checkpoints and rollback", async () => {
  if (!/^\/orgmap_integration_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname))
    throw Error("EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED");
  const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const prefix = process.env.INTEGRATION_TEST_ROLE_PREFIX;
  assert.match(prefix ?? "", /^orgmap_it_[a-f0-9]{32}_$/);
  const role = prefix + randomUUID().replaceAll("-", "").slice(0, 16), password = randomUUID();
  const account = randomUUID(), a = randomUUID(), b = randomUUID(), memberA = randomUUID(), memberB = randomUUID();
  const rootA = randomUUID(), childA = randomUUID(), rootB = randomUUID(), job = randomUUID(), lease = randomUUID();
  const session = randomUUID(), bSession = randomUUID(), blocker = randomUUID(), enrollment = randomUUID(), reauth = randomUUID();
  let operator: pg.Pool | undefined, created = false;
  const sha = "a".repeat(64);
  try {
    await admin.query('INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,\'Fixture\',\'hash\')', [account, `${account}@fixture.invalid`]);
    for (const [org, member, root] of [[a, memberA, rootA], [b, memberB, rootB]]) {
      await admin.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,$2,'pt-BR','UTC')", [org, `private-${org}`]);
      await admin.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')", [org, member, account]);
      await admin.query("INSERT INTO entities(organization_id,id,node_id,kind,name) VALUES($1,$2,$3,'CIRCLE','Root')", [org, root, randomUUID()]);
    }
    await admin.query("INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name) VALUES($1,$2,$3,'ROLE',$4,'Child')", [a,childA,randomUUID(),rootA]);
    await admin.query("INSERT INTO audit_events(organization_id,id,actor_id,resource_id,action,request_id) VALUES($1,$2,$3,$4,'fixture','fixture')", [a,randomUUID(),memberA,rootA]);
    for (const [org,id] of [[a,session],[b,bSession]]) await admin.query("INSERT INTO sessions(token_hash,id,account_id,csrf,expires_at,auth_method,auth_organization_id,auth_connection_id,auth_issuer,auth_subject) VALUES($1,$2,$3,'x',now()-interval '1 hour','FEDERATED',$4,$5,'issuer','subject')", [randomUUID(),id,account,org,randomUUID()]);
    await admin.query("INSERT INTO provisioned_enrollments(organization_id,id,connection_id,external_id,user_name,email,display_name,issuer,claim_name,claim_value,mapping_revision,active,state,account_id,member_id,created_by) VALUES($1,$2,$3,'fixture','fixture','b@fixture.invalid','B','issuer','sub','b',1,true,'PENDING_ENROLLMENT',$4,$5,$4)",[b,enrollment,randomUUID(),account,memberB]);
    await admin.query("INSERT INTO provisioned_enrollment_reauth(organization_id,id,enrollment_id,enrollment_version,account_id,session_id,token_hash,expires_at,confirmed) VALUES($1,$2,$3,1,$4,$5,$6,now()+interval '1 hour',true)",[b,reauth,enrollment,account,session,randomUUID()]);
    const createResult=(id:string,name:string)=>({organization:{id,name,locale:'pt-BR',timeZone:'UTC',version:1,structureRevision:1,authorizationRevision:1},membership:{id:randomUUID(),orgRole:'OWNER'},rootCircle:{organizationId:id,id:randomUUID(),nodeId:randomUUID(),kind:'CIRCLE',parentId:null,parentCircleId:null,name,purpose:null,purposeRich:null,archived:false,version:1}});
    const acceptResult={organizationId:a,membership:{organizationId:a,id:randomUUID(),accountId:account,orgRole:'MEMBER',status:'ACTIVE',version:1,memberType:'HUMAN',suspensionOrigin:null}};
    await admin.query("INSERT INTO account_commands(account_id,key,hash,result) VALUES($1,'organization.create:a',$2,$3),($1,'organization.create:b',$2,$4),($1,'invitation.accept:a',$2,$5)", [account,sha,createResult(a,'secret A'),createResult(b,'B intact'),acceptResult]);
    await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`); created = true;
    await admin.query(`GRANT orgmap_lifecycle_maintenance TO "${role}"`);
    const url = new URL(process.env.DATABASE_URL!); url.username=role; url.password=password;
    operator = new pg.Pool({connectionString:url.href});
    await admin.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1", [a]);
    await admin.query("INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence,state,ledger_state,ledger_authority_id,ledger_record_sha256,lease_token,lease_fence,lease_until) VALUES($1,$2,$3,'fixture',$4,2,2,'RUNNING','CONFIRMED',$5,$4,$6,2,now()+interval '1 hour')", [a,job,account,sha,randomUUID(),lease]);
    const c = await operator.connect();
    const call = (phase: string, cursor: string | null, token = lease) => c.query("WITH l AS MATERIALIZED (SELECT pg_advisory_xact_lock(730184)) SELECT foundation_teardown_batch($1,$2,$3,$4,$5,$6,1) result FROM l",[a,job,3,token,phase,cursor]);
    try {
      await assert.rejects(c.query("SELECT foundation_teardown_batch($1,$2,2,$3,'QUIESCE',NULL,1)",[a,job,lease]), /TEARDOWN_IO_DRAIN_PROOF_REQUIRED/);
      // Reconciliation is real; the lease and subsequent Q checkpoints are fixture scaffolding.
      assert.equal((await c.query("SELECT foundation_expire_federated_sessions($1,$2,2,$3,10) result",[a,job,lease])).rows[0].result.expired,1);
      // Synthetic Q checkpoints are fixture scaffolding, not real drain evidence.
      await admin.query("UPDATE organization_lifecycle SET state='PURGING',fence=3 WHERE organization_id=$1", [a]);
      await admin.query("UPDATE organization_deletion_jobs SET phase='PURGE',lifecycle_fence=3,lease_fence=3 WHERE id=$1",[job]);
      await admin.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,'foundation','QUIESCE',true),($1,'foundation','INVENTORY',true)",[job]);
      // Compare the reviewed pin before introducing synthetic schema objects.
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(730184)');
      const fingerprint=(await c.query('SELECT orgmap_deletion_schema_fingerprint($1,$2,3,$3) digest',[a,job,lease])).rows[0].digest;
      await c.query('ROLLBACK');
      assert.equal((await admin.query("SELECT fingerprint FROM organization_deletion_schema_baseline WHERE singleton")).rows[0]?.fingerprint,fingerprint);

      for (const owner of ['administration','platform','structure','governance','work','goals','interoperability']) await admin.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,$2,'PURGE',true)",[job,owner]);
      // The automatic immutable meeting observation is removed by the real
      // meeting owner under 510 authority; never disable its trigger.
      await admin.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,'meetings','QUIESCE',true),($1,'meetings','INVENTORY',true)",[job]);
      let mc: string | null = null, md = false;
      for (let i=0;i<10 && !md;i++) {
        await c.query('BEGIN');
        try {
          await c.query('SELECT pg_advisory_xact_lock(730184)');
          const state = (await c.query("SELECT orgmap_deletion_read_progress($1,$2,3,$3,'meetings','PURGE') result",[a,job,lease])).rows[0].result;
          const result: {nextCursor: string | null; done: boolean; counts: Record<string,number>} = (await c.query("SELECT meetings_teardown_batch($1,$2,3,$3,'PURGE',$4,1) result",[a,job,lease,mc])).rows[0].result;
          await c.query("SELECT orgmap_deletion_checkpoint($1,$2,3,$3,'meetings','PURGE',$4,$5,$6,$7,$8,'[]')",[a,job,lease,state.revision,mc,result.nextCursor,result.done,result.counts]);
          await c.query('COMMIT'); mc=result.nextCursor; md=result.done;
        } catch (e) { await c.query('ROLLBACK'); throw e; }
      }
      assert.equal(md,true);
      await assert.rejects(call('PURGE',null,randomUUID()), /DELETION_MAINTENANCE_LEASE_INVALID/);
      await admin.query("INSERT INTO structure_templates(organization_id,id,name,flags) VALUES($1,$2,'not empty','{}')",[a,blocker]);
      await assert.rejects(call('PURGE',null), /FOUNDATION_OWNER_ROWS_REMAIN/);
      await admin.query("DELETE FROM structure_templates WHERE organization_id=$1 AND id=$2",[a,blocker]);
      await admin.query("CREATE TABLE foundation_test_cascade (organization_id uuid NOT NULL, entity_id uuid NOT NULL, FOREIGN KEY(organization_id,entity_id) REFERENCES entities(organization_id,id) ON DELETE CASCADE)");
      await assert.rejects(call('PURGE',null), /DELETION_SCHEMA_ATTESTATION_REQUIRED/);
      await admin.query("DROP TABLE foundation_test_cascade");
      await admin.query("INSERT INTO account_commands(account_id,key,hash,result) VALUES($1,'unknown:fixture',$2,'{}')",[account,sha]);
      await assert.rejects(call('PURGE',null), /FOUNDATION_ACCOUNT_COMMAND_UNCLASSIFIED/);
      await admin.query("DELETE FROM account_commands WHERE account_id=$1 AND key='unknown:fixture'",[account]);
      await admin.query("INSERT INTO account_commands(account_id,key,hash,result) VALUES($1,'organization.create:malformed',$2,'{}')",[account,sha]);
      await assert.rejects(call('PURGE',null), /FOUNDATION_TENANT_COMMAND_PROOF_REQUIRED/);
      await admin.query("DELETE FROM account_commands WHERE account_id=$1 AND key='organization.create:malformed'",[account]);
      await assert.rejects(call('PURGE','99'), /TEARDOWN_CURSOR_MISMATCH/);

      await c.query('BEGIN');
      const rolled = (await call('PURGE',null)).rows[0].result;
      assert.equal(rolled.counts.account_commands,1);
      await c.query('ROLLBACK');
      assert.equal((await admin.query("SELECT result->'organization'->>'name' n FROM account_commands WHERE account_id=$1 AND key='organization.create:a'",[account])).rows[0].n,'secret A');
      let cursor: string | null = null, done = false;
      for (let i=0;i<50 && !done;i++) {
        await c.query('BEGIN');
        try {
          await c.query('SELECT pg_advisory_xact_lock(730184)');
          const state = (await c.query("SELECT orgmap_deletion_read_progress($1,$2,3,$3,'foundation','PURGE') result",[a,job,lease])).rows[0].result;
          assert.equal(state.cursor,cursor);
          const result: {nextCursor: string | null; done: boolean; counts: Record<string,number>} = (await call('PURGE',cursor)).rows[0].result;
          await c.query("SELECT orgmap_deletion_checkpoint($1,$2,3,$3,'foundation','PURGE',$4,$5,$6,$7,$8,'[]')",[a,job,lease,state.revision,cursor,result.nextCursor,result.done,result.counts]);
          await c.query('COMMIT'); cursor=result.nextCursor; done=result.done;
        } catch (e) { await c.query('ROLLBACK'); throw e; }
      }
      assert.equal(done,true);
      assert.equal((await call('PURGE',null)).rows[0].result.done,true);
    } finally { c.release(); }
    for (const table of foundationDisposition.tenantCandidate) assert.equal((await admin.query(`SELECT count(*)::int n FROM "${table}" WHERE organization_id=$1`,[a])).rows[0].n,0,table);
    assert.equal((await admin.query('SELECT count(*)::int n FROM accounts WHERE id=$1',[account])).rows[0].n,1);
    assert.equal((await admin.query('SELECT name FROM organizations WHERE id=$1',[a])).rows[0].name,'Deleted organization');
    assert.equal((await admin.query('SELECT name FROM organizations WHERE id=$1',[b])).rows[0].name,`private-${b}`);
    assert.equal((await admin.query('SELECT count(*)::int n FROM members WHERE organization_id=$1',[b])).rows[0].n,1);
    assert.equal((await admin.query('SELECT auth_organization_id FROM sessions WHERE id=$1',[bSession])).rows[0].auth_organization_id,b);
    const retained = (await admin.query('SELECT auth_organization_id,auth_method,auth_issuer,auth_subject,deletion_revoked_job_id,token_hash,csrf FROM sessions WHERE id=$1',[session])).rows[0];
    assert.equal(retained.auth_organization_id,a);
    assert.equal(retained.auth_method,'FEDERATED');
    assert.equal(retained.deletion_revoked_job_id,job);
    assert.equal(retained.auth_issuer,null); assert.equal(retained.auth_subject,null);
    assert.equal(retained.token_hash,`revoked:${session}`); assert.equal(retained.csrf,'revoked');
    assert.equal((await admin.query('SELECT session_id FROM provisioned_enrollment_reauth WHERE organization_id=$1 AND id=$2',[b,reauth])).rows[0].session_id,session);
    const cmds = (await admin.query('SELECT key,hash,result FROM account_commands WHERE account_id=$1 ORDER BY key',[account])).rows;
    assert.deepEqual(cmds.find(x=>x.key==='organization.create:a').result,{organization:{id:a},deleted:true});
    assert.deepEqual(cmds.find(x=>x.key==='invitation.accept:a').result,{organizationId:a,deleted:true});
    assert.equal(cmds.find(x=>x.key==='organization.create:b').result.organization.name,'B intact');
    assert.ok(cmds.every(x=>x.hash===sha));
  } finally { await operator?.end(); if(created) await admin.query(`DROP ROLE "${role}"`); await admin.end(); }
});

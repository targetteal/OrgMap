import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptMfaSecret, totpAt } from "../../server/src/mfa.js";
import pg from "pg";
import { createSessionRecord } from "../../server/src/sessions.js";
import { digest } from "../../server/src/core.js";
import { expireOrganizationFederatedSessions } from "../../server/src/organization-foundation-teardown.js";
import { createRuntime } from "../../server/src/runtime.js";
import { registerAccountFederatedReauthentication } from "../../server/modules/interoperability/account-reauth.js";
import { createLifecycleAuthMethodsPort } from "../../server/modules/interoperability/lifecycle.js";
import { preflightOrganizationDeletionAcceptance, acceptOrganizationDeletion } from "../../server/src/organization-deletion-acceptance.js";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { assertLiveDeletionTableInventory } from "../../server/src/organization-deletion-catalog.js";
import { createInteroperabilityTeardownParticipant } from "../../server/modules/interoperability/teardown.js";
import { createMeetingsTeardownParticipant } from "../../server/modules/meetings/teardown.js";
import { createWorkTeardownParticipant } from "../../server/modules/work/teardown.js";
import { createGoalsTeardownParticipant } from "../../server/modules/goals/teardown.js";
import { createGovernanceTeardownParticipant } from "../../server/modules/governance/teardown.js";
import { createStructureTeardownParticipant } from "../../server/modules/structure/teardown.js";
import { createAdministrationTeardownParticipant } from "../../server/modules/administration/teardown.js";
import { createPlatformTeardownParticipant } from "../../server/modules/platform/teardown.js";
import type {
  OrganizationDeletionContext,
  OrganizationDeletionPhase,
} from "../../server/src/organization-lifecycle-contract.js";

if (
  !/^\/orgmap_integration_[a-f0-9]{32}$/.test(
    new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname,
  )
)
  throw Error("EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED");
after(async () => pool.end());
test("maintenance inventories before scoped purge, preserves B and global Account, and rejects forged authority", async () => {
  const admin = new pg.Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    }),
    prefix = process.env.INTEGRATION_TEST_ROLE_PREFIX;
  assert.match(prefix ?? "", /^orgmap_it_[a-f0-9]{32}_$/);
  const role = prefix + randomUUID().replaceAll("-", "").slice(0, 16),
    password = randomUUID(),
    origin = "http://teardown.localhost:5273";
  process.env.ALLOWED_ORIGINS = origin;
  let operator: pg.Pool | undefined, acceptancePool: pg.Pool | undefined,
    created = false, acceptanceCreated = false;
  const acceptanceRole = prefix + randomUUID().replaceAll("-","").slice(0,16);
  const app = await buildApp([], { migrationScope: "foundation" });
  try {
    const catalog = await admin.connect();
    try {
      await catalog.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await assertLiveDeletionTableInventory(catalog);
      await catalog.query("COMMIT");
    } catch (error) { await catalog.query("ROLLBACK"); throw error; } finally { catalog.release(); }
    const fixturePassword = `Synthetic-${randomUUID()}`;
    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin },
      payload: {
        email: `teardown-${randomUUID()}@example.test`,
        password: fixturePassword,
        displayName: "Teardown",
      },
    });
    assert.equal(reg.statusCode, 201, reg.body);
    const account = reg.json().data,
      cookie = `orgmap_session=${reg.cookies.find((c) => c.name === "orgmap_session")!.value}`;
    async function org(name: string) {
      const commandKey = randomUUID();
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/organizations",
        headers: {
          origin,
          cookie,
          "x-csrf-token": account.csrfToken,
          "idempotency-key": commandKey,
        },
        payload: { name },
      });
      assert.equal(r.statusCode, 201, r.body);
      return { ...r.json().data, commandKey };
    }
    const A = await org("A teardown"),
      B = await org("B preserved"),
      C = await org("C atomic cut"),
      D = await org("D session race"),
      a = A.organization.id,
      b = B.organization.id,
      member = A.membership.id,
      accountId = account.account.id;
    // Real Account security service and real Interop query adapter; no cut or receipt.
    const acceptanceRuntime = createRuntime();
    const acceptanceMethods = createLifecycleAuthMethodsPort(() => false);
    const preflightClient = await pool.connect();
    try {
      await preflightClient.query("BEGIN");
      const proof = await preflightOrganizationDeletionAcceptance(preflightClient, {
        organizationId:a, sessionToken:reg.cookies.find(c=>c.name==='orgmap_session')!.value, csrfToken:account.csrfToken,
        expectedVersion:A.organization.version, confirmationName:'A teardown', credentials:{currentPassword:fixturePassword},
      }, acceptanceRuntime, acceptanceMethods);
      assert.equal(proof.actorAccountId,accountId);
      assert.equal(proof.fence,'1');
      await preflightClient.query("ROLLBACK");
      await preflightClient.query("BEGIN");
      await assert.rejects(preflightOrganizationDeletionAcceptance(preflightClient, {
        organizationId:a, sessionToken:reg.cookies.find(c=>c.name==='orgmap_session')!.value, csrfToken:account.csrfToken,
        expectedVersion:A.organization.version, confirmationName:'A teardown', credentials:{currentPassword:'wrong'},
      }, acceptanceRuntime, acceptanceMethods));
      await preflightClient.query("ROLLBACK");
    } finally { await preflightClient.query("ROLLBACK").catch(()=>{}); preflightClient.release(); }
    const tokenA = randomUUID(), tokenB = randomUUID(), passwordToken = randomUUID();
    const sessionA = randomUUID(), sessionB = randomUUID(), passwordSession = randomUUID(), bEnrollment = randomUUID(), bReauth = randomUUID();
    for (const [token, session, method, org] of [[tokenA,sessionA,"FEDERATED",a],[tokenB,sessionB,"FEDERATED",b],[passwordToken,passwordSession,"PASSWORD",null]] as const) {
      await admin.query("INSERT INTO sessions(token_hash,id,account_id,csrf,expires_at,auth_method,auth_organization_id,auth_connection_id,auth_issuer,auth_subject) VALUES($1,$2,$3,'fixture',clock_timestamp()+interval '1 hour',$4,$5,$6,$7,$8)", [digest(token),session,accountId,method,org,org ? randomUUID() : null,org ? 'fixture-issuer' : null,org ? 'fixture-subject' : null]);
    }
    const cToken=randomUUID();
    await admin.query("INSERT INTO sessions(token_hash,id,account_id,csrf,expires_at,auth_method,auth_organization_id,auth_connection_id,auth_issuer,auth_subject) VALUES($1,$2,$3,'fixture',clock_timestamp()+interval '1 hour','FEDERATED',$4,$5,'fixture','fixture')",[digest(cToken),randomUUID(),accountId,C.organization.id,randomUUID()]);
    await admin.query(`CREATE ROLE "${acceptanceRole}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
    acceptanceCreated=true;
    await admin.query(`GRANT orgmap_app,orgmap_lifecycle_acceptance TO "${acceptanceRole}"`);
    const acceptUrl=new URL(process.env.DATABASE_URL!); acceptUrl.username=acceptanceRole; acceptUrl.password=password;
    acceptancePool=new pg.Pool({connectionString:acceptUrl.href});
    // The ordinary app cannot mint receipts. A private receipt also cannot
    // be consumed in a different transaction, even with identical arguments.
    await assert.rejects(pool.query("SELECT orgmap_acceptance_mint_receipt($1,$2,$3,$4,1,$5::uuid[])",[C.organization.id,accountId,passwordSession,'a'.repeat(64),[accountId]]), /permission denied/);
    const receiptClient=await acceptancePool.connect();
    try {
      await receiptClient.query("BEGIN");
      const receipt=(await receiptClient.query("SELECT orgmap_acceptance_mint_receipt($1,$2,$3,$4,1,$5::uuid[]) id",[C.organization.id,accountId,passwordSession,'a'.repeat(64),[accountId]])).rows[0].id;
      await receiptClient.query("COMMIT");
      await assert.rejects(receiptClient.query("SELECT orgmap_acceptance_cut($1,$2,$3,$4,$5,1,$6,$7,$8,$9)",[receipt,C.organization.id,accountId,passwordSession,'a'.repeat(64),C.organization.version,'C atomic cut',randomUUID(),randomUUID()]), /DELETION_RECEIPT_INVALID/);
      assert.equal((await admin.query("SELECT state FROM organization_lifecycle WHERE organization_id=$1",[C.organization.id])).rows[0].state,'ACTIVE');
    } finally { await receiptClient.query("ROLLBACK").catch(()=>{}); receiptClient.release(); }
    const cutInput={organizationId:C.organization.id,sessionToken:passwordToken,csrfToken:'fixture',expectedVersion:C.organization.version,confirmationName:'C atomic cut',credentials:{currentPassword:fixturePassword},idempotencyKey:randomUUID()};
    await assert.rejects(acceptOrganizationDeletion(acceptancePool,{...cutInput,credentials:{currentPassword:'wrong'}},acceptanceRuntime,acceptanceMethods));
    assert.equal((await admin.query("SELECT state FROM organization_lifecycle WHERE organization_id=$1",[C.organization.id])).rows[0].state,'ACTIVE');
    const cutResult=await acceptOrganizationDeletion(acceptancePool,cutInput,acceptanceRuntime,acceptanceMethods);
    assert.equal(cutResult.fence,'2');
    assert.equal(cutResult.expiredSessions,1);
    assert.equal((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:`orgmap_session=${cToken}`}})).statusCode,401);
    assert.equal((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:`orgmap_session=${tokenB}`}})).statusCode,200);
    const cutReplay=await acceptOrganizationDeletion(acceptancePool,cutInput,acceptanceRuntime,acceptanceMethods);
    assert.equal(cutReplay.jobId,cutResult.jobId);
    assert.equal(cutReplay.replayed,true);
    await assert.rejects(acceptOrganizationDeletion(acceptancePool,{...cutInput,idempotencyKey:randomUUID()},acceptanceRuntime,acceptanceMethods));
    // A global Account writer holds Account while creating a federated session;
    // the cut holds Org and must wait, then discover and expire the new session.
    const raceWriter=await pool.connect();
    try {
      await raceWriter.query("BEGIN");
      await raceWriter.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[accountId]);
      const raced=await createSessionRecord(raceWriter,accountId,{method:'FEDERATED',organizationId:D.organization.id,connectionId:randomUUID(),issuer:'fixture',subject:'fixture',verifiedAt:new Date()});
      const writerPid=(await raceWriter.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      const pending=acceptOrganizationDeletion(acceptancePool,{...cutInput,organizationId:D.organization.id,expectedVersion:D.organization.version,confirmationName:'D session race',idempotencyKey:randomUUID()},acceptanceRuntime,acceptanceMethods);
      void pending.catch(()=>{});
      let blocked=false;
      for(let n=0;n<200;n++) {
        blocked=(await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked",[writerPid])).rows[0].blocked;
        if(blocked) break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(blocked,true,'cut must wait for Account session writer');
      await raceWriter.query("COMMIT");
      assert.equal((await pending).expiredSessions,1);
      assert.equal((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:`orgmap_session=${raced.token}`}})).statusCode,401);
    } finally { await raceWriter.query("ROLLBACK").catch(()=>{}); raceWriter.release(); }
    // Two different owners close two organizations sharing a passwordless
    // federated Account; only one cut may pass the real continuity adapter.
    const owner2Password=`Synthetic-${randomUUID()}`, victimPassword=`Synthetic-${randomUUID()}`;
    const register = async (label: string, pass: string) => {
      const response=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin},payload:{email:`${label}-${randomUUID()}@example.test`,password:pass,displayName:label}});
      assert.equal(response.statusCode,201,response.body);
      return {data:response.json().data,token:response.cookies.find(c=>c.name==='orgmap_session')!.value};
    };
    const owner2=await register('owner2',owner2Password), victim=await register('victim',victimPassword);
    const E=await org('E continuity');
    const fResponse=await app.inject({method:'POST',url:'/api/v1/organizations',headers:{origin,cookie:`orgmap_session=${owner2.token}`,'x-csrf-token':owner2.data.csrfToken,'idempotency-key':randomUUID()},payload:{name:'F continuity'}});
    assert.equal(fResponse.statusCode,201,fResponse.body);
    const F=fResponse.json().data;
    await admin.query("UPDATE accounts SET password_enabled=false WHERE id=$1",[victim.data.account.id]);
    const knownConnections=new Set<string>();
    for(const orgId of [E.organization.id,F.organization.id]) {
      const connection=randomUUID(); knownConnections.add(`${orgId}:${connection}`);
      await admin.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'MEMBER')",[orgId,randomUUID(),victim.data.account.id]);
      await admin.query("INSERT INTO interop_connections(organization_id,id,provider,label,state) VALUES($1,$2,'OIDC','fixture','CONFIGURED')",[orgId,connection]);
      await admin.query("INSERT INTO interop_federated_identities(organization_id,id,connection_id,issuer,subject,account_id) VALUES($1,$2,$3,'fixture','fixture',$4)",[orgId,randomUUID(),connection,victim.data.account.id]);
    }
    const configuredMethods=createLifecycleAuthMethodsPort((orgId,connection,provider)=>provider==='OIDC' && knownConnections.has(`${orgId}:${connection}`));
    const cuts=await Promise.allSettled([
      acceptOrganizationDeletion(acceptancePool,{...cutInput,organizationId:E.organization.id,expectedVersion:E.organization.version,confirmationName:'E continuity',idempotencyKey:randomUUID()},acceptanceRuntime,configuredMethods),
      acceptOrganizationDeletion(acceptancePool,{organizationId:F.organization.id,sessionToken:owner2.token,csrfToken:owner2.data.csrfToken,expectedVersion:F.organization.version,confirmationName:'F continuity',credentials:{currentPassword:owner2Password},idempotencyKey:randomUUID()},acceptanceRuntime,configuredMethods),
    ]);
    assert.equal(cuts.filter(result=>result.status==='fulfilled').length,1);
    const denied=cuts.find(result=>result.status==='rejected') as PromiseRejectedResult;
    assert.match(String(denied.reason?.code ?? denied.reason),/AUTH_CONTINUITY_REQUIRED/);
    assert.deepEqual((await admin.query("SELECT state FROM organization_lifecycle WHERE organization_id=ANY($1::uuid[]) ORDER BY state",[[E.organization.id,F.organization.id]])).rows.map(row=>row.state),['ACTIVE','DELETION_PENDING']);
    assert.equal((await admin.query("SELECT password_enabled FROM accounts WHERE id=$1",[victim.data.account.id])).rows[0].password_enabled,false);
    // Reauthentication uses the actual Interop verifier and persisted binding;
    // synthetic issuer configuration does not prove a live IdP round trip.
    const fedOwner=await register('fed-owner',`Synthetic-${randomUUID()}`);
    const fedOrgResponse=await app.inject({method:'POST',url:'/api/v1/organizations',headers:{origin,cookie:`orgmap_session=${fedOwner.token}`,'x-csrf-token':fedOwner.data.csrfToken,'idempotency-key':randomUUID()},payload:{name:'Federated cut'}});
    assert.equal(fedOrgResponse.statusCode,201,fedOrgResponse.body);
    const fedOrg=fedOrgResponse.json().data, fedConnection=randomUUID(), fedToken=randomUUID();
    knownConnections.add(`${fedOrg.organization.id}:${fedConnection}`);
    await admin.query("INSERT INTO interop_connections(organization_id,id,provider,label,state) VALUES($1,$2,'OIDC','fixture','CONFIGURED')",[fedOrg.organization.id,fedConnection]);
    await admin.query("INSERT INTO interop_federated_identities(organization_id,id,connection_id,issuer,subject,account_id) VALUES($1,$2,$3,'fixture-issuer','fixture-subject',$4)",[fedOrg.organization.id,randomUUID(),fedConnection,fedOwner.data.account.id]);
    await admin.query("INSERT INTO sessions(token_hash,account_id,csrf,expires_at,auth_method,auth_organization_id,auth_connection_id,auth_issuer,auth_subject,auth_time) VALUES($1,$2,'fixture',clock_timestamp()+interval '1 hour','FEDERATED',$3,$4,'fixture-issuer','fixture-subject',clock_timestamp())",[digest(fedToken),fedOwner.data.account.id,fedOrg.organization.id,fedConnection]);
    registerAccountFederatedReauthentication(acceptanceRuntime,(orgId,connection,provider)=>provider==='OIDC' && knownConnections.has(`${orgId}:${connection}`)?'fixture-issuer':undefined);
    const fedCut=await acceptOrganizationDeletion(acceptancePool,{organizationId:fedOrg.organization.id,sessionToken:fedToken,csrfToken:'fixture',expectedVersion:fedOrg.organization.version,confirmationName:'Federated cut',credentials:{},idempotencyKey:randomUUID()},acceptanceRuntime,configuredMethods);
    assert.equal(fedCut.expiredSessions,1);
    assert.equal((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:`orgmap_session=${fedToken}`}})).statusCode,401);
    assert.equal((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:`orgmap_session=${fedOwner.token}`}})).statusCode,200);
    // Real encrypted MFA factor and TOTP verification, without exposing key material.
    const mfaDirectory=await mkdtemp(join(tmpdir(),'orgmap-cut-mfa-'));
    const priorMfaPath=process.env.ORGMAP_MFA_KEY_FILE;
    process.env.ORGMAP_MFA_KEY_FILE=join(mfaDirectory,'key');
    try {
      await writeFile(process.env.ORGMAP_MFA_KEY_FILE,randomBytes(32).toString('hex'),{mode:0o600});
      const mfaPass=`Synthetic-${randomUUID()}`;
      const mfaActor=await register('mfa-actor',mfaPass);
      const mfaOrgResponse=await app.inject({method:'POST',url:'/api/v1/organizations',headers:{origin,cookie:`orgmap_session=${mfaActor.token}`,'x-csrf-token':mfaActor.data.csrfToken,'idempotency-key':randomUUID()},payload:{name:'MFA cut'}});
      assert.equal(mfaOrgResponse.statusCode,201,mfaOrgResponse.body);
      const mfaOrg=mfaOrgResponse.json().data, seed=randomBytes(20);
      const encrypted=await encryptMfaSecret(seed,mfaActor.data.account.id);
      await admin.query("INSERT INTO account_mfa_factors(account_id,encrypted_secret,state) VALUES($1,$2,'ACTIVE')",[mfaActor.data.account.id,encrypted]);
      const mfaInput={organizationId:mfaOrg.organization.id,sessionToken:mfaActor.token,csrfToken:mfaActor.data.csrfToken,expectedVersion:mfaOrg.organization.version,confirmationName:'MFA cut',credentials:{currentPassword:mfaPass,totpCode:'invalid'},idempotencyKey:randomUUID()};
      await assert.rejects(acceptOrganizationDeletion(acceptancePool,mfaInput,acceptanceRuntime,acceptanceMethods));
      assert.equal((await admin.query("SELECT state FROM organization_lifecycle WHERE organization_id=$1",[mfaOrg.organization.id])).rows[0].state,'ACTIVE');
      const otp=totpAt(seed,Math.floor(Date.now()/30000));
      assert.equal((await acceptOrganizationDeletion(acceptancePool,{...mfaInput,credentials:{currentPassword:mfaPass,totpCode:otp}},acceptanceRuntime,acceptanceMethods)).fence,'2');
    } finally {
      if(priorMfaPath===undefined) delete process.env.ORGMAP_MFA_KEY_FILE; else process.env.ORGMAP_MFA_KEY_FILE=priorMfaPath;
      await rm(mfaDirectory,{recursive:true,force:true});
    }
    await admin.query(`INSERT INTO provisioned_enrollments(organization_id,id,connection_id,external_id,user_name,email,display_name,issuer,claim_name,claim_value,mapping_revision,active,state,account_id,member_id,created_by) VALUES($1,$2,$3,'fixture','fixture','synthetic@example.test','Fixture','issuer','sub','subject',1,true,'PENDING_ENROLLMENT',$4,$5,$4)`, [b,bEnrollment,randomUUID(),accountId,B.membership.id]);
    await admin.query("INSERT INTO provisioned_enrollment_reauth(organization_id,id,enrollment_id,enrollment_version,account_id,session_id,token_hash,expires_at,confirmed) VALUES($1,$2,$3,1,$4,$5,$6,clock_timestamp()+interval '1 hour',true)", [b,bReauth,bEnrollment,accountId,sessionA,digest(randomUUID())]);
    const workProject = randomUUID(), workSection = randomUUID(), workParent = randomUUID(), workChild = randomUUID(), workGroup = randomUUID(), workProjectB = randomUUID();
    await admin.query("INSERT INTO work_projects(organization_id,id,title,visibility,creator_id) VALUES($1,$2,'A project','PUBLIC',$3)", [a,workProject,member]);
    await admin.query("INSERT INTO work_sections(organization_id,id,project_id,name,semantic,position) VALUES($1,$2,$3,'Done','DONE',0)", [a,workSection,workProject]);
    await admin.query("UPDATE work_projects SET default_done_section_id=$3 WHERE organization_id=$1 AND id=$2", [a,workProject,workSection]);
    await admin.query("INSERT INTO work_tasks(organization_id,id,project_id,section_id,creator_id,title) VALUES($1,$2,$3,$4,$5,'parent')", [a,workParent,workProject,workSection,member]);
    await admin.query("INSERT INTO work_subtask_groups(organization_id,id,parent_task_id,name) VALUES($1,$2,$3,'group')", [a,workGroup,workParent]);
    await admin.query("INSERT INTO work_tasks(organization_id,id,project_id,creator_id,title,parent_id,subtask_group_id) VALUES($1,$2,$3,$4,'child',$5,$6)", [a,workChild,workProject,member,workParent,workGroup]);
    await admin.query("INSERT INTO work_projects(organization_id,id,title,visibility,creator_id) VALUES($1,$2,'B project','PUBLIC',$3)", [b,workProjectB,B.membership.id]);
    const goalParent = randomUUID(), goalChild = randomUUID(), goalB = randomUUID();
    await admin.query("INSERT INTO goals(organization_id,id,title,owner_type,owner_id) VALUES($1,$2,'parent','MEMBER',$3)", [a,goalParent,member]);
    await admin.query("INSERT INTO goals(organization_id,id,title,owner_type,owner_id,parent_id) VALUES($1,$2,'child','MEMBER',$3,$4)", [a,goalChild,member,goalParent]);
    await admin.query("INSERT INTO goals(organization_id,id,title,owner_type,owner_id) VALUES($1,$2,'preserved','MEMBER',$3)", [b,goalB,B.membership.id]);
    const interopConnection = randomUUID(), interopConnectionB = randomUUID(), interopDelivery = randomUUID();
    await admin.query("INSERT INTO interop_connections(organization_id,id,provider,label) VALUES($1,$2,'LOCAL','fixture')", [a,interopConnection]);
    await admin.query("INSERT INTO interop_connections(organization_id,id,provider,label) VALUES($1,$2,'LOCAL','preserved')", [b,interopConnectionB]);
    await admin.query("INSERT INTO interop_deliveries(organization_id,id,connection_id,event_id,payload) VALUES($1,$2,$3,'fixture','{}')", [a,interopDelivery,interopConnection]);
    const meetingSeries = randomUUID(), meeting = randomUUID(), agendaItem = randomUUID(), agendaPlacement = randomUUID(), report = randomUUID();
    const meetingEntity = (await admin.query("SELECT id FROM entities WHERE organization_id=$1 AND kind='CIRCLE' LIMIT 1", [a])).rows[0]?.id;
    assert.ok(meetingEntity);
    await admin.query(`INSERT INTO meeting_series(organization_id,id,title,circle_id,local_start,time_zone,duration_minutes,recurrence,template_snapshot,participants,policy) VALUES($1,$2,'fixture',$3,'2026-01-01T10:00','UTC',30,'{}','{}','[]','{}')`, [a,meetingSeries,meetingEntity]);
    await admin.query(`INSERT INTO meeting_occurrences(organization_id,id,series_id,sequence,start_at,local_start,time_zone,duration_minutes,title,circle_id,sections,method,policy,facilitator_id) VALUES($1,$2,$3,1,now(),'2026-01-01T10:00','UTC',30,'fixture',$4,'[]','CUSTOM','{}',$5)`, [a,meeting,meetingSeries,meetingEntity,member]);
    await admin.query(`INSERT INTO meeting_agenda_items(organization_id,id,title,description_rich,state,source_kind,identity_coverage,creator_coverage) VALUES($1,$2,'item','{}','ASSIGNED','MANUAL','NATIVE','KNOWN')`, [a,agendaItem]);
    await admin.query(`INSERT INTO meeting_agenda(organization_id,id,meeting_id,title,presenter_id,agenda_item_id) VALUES($1,$2,$3,'placement',$4,$5)`, [a,agendaPlacement,meeting,member,agendaItem]);
    await admin.query("UPDATE meeting_agenda_items SET current_placement_id=$3,last_placement_id=$3 WHERE organization_id=$1 AND id=$2", [a,agendaItem,agendaPlacement]);
    await admin.query("INSERT INTO meeting_reports(organization_id,id,meeting_id,window_days) VALUES($1,$2,$3,0)", [a,report,meeting]);
    await admin.query("INSERT INTO meeting_report_versions(organization_id,report_id,version,epoch,snapshot,actor_id,reason) VALUES($1,$2,1,1,'{}',$3,'fixture')", [a,report,member]);
    await admin.query("INSERT INTO meeting_first_close_snapshots(organization_id,meeting_id,report_id,report_version,report_epoch,occurrence_version,first_closed_at,snapshot) VALUES($1,$2,$3,1,1,1,now(),'{}')", [a,meeting,report]);
    const governanceDoc = randomUUID(), governanceDocB = randomUUID();
    const entityA = (await admin.query("SELECT id FROM entities WHERE organization_id=$1 ORDER BY id LIMIT 1", [a])).rows[0]?.id;
    assert.ok(entityA);
    const docFixture = await admin.connect();
    try {
      await docFixture.query("BEGIN");
      await docFixture.query("INSERT INTO gov_documents(organization_id,id,owner_id,title,workflow,visibility,author_id,draft_version,published_version) VALUES($1,$2,$3,'synthetic','DIRECT','ORGANIZATION',$4,2,1)", [a, governanceDoc, entityA, member]);
      for (const n of [1, 2, 3]) await docFixture.query("INSERT INTO gov_document_versions(organization_id,document_id,number,content,created_by) VALUES($1,$2,$3,'fixture',$4)", [a, governanceDoc, n, member]);
      const entityB = (await docFixture.query("SELECT id FROM entities WHERE organization_id=$1 ORDER BY id LIMIT 1", [b])).rows[0]?.id;
      assert.ok(entityB);
      await docFixture.query("INSERT INTO gov_documents(organization_id,id,owner_id,title,workflow,visibility,author_id,draft_version) VALUES($1,$2,$3,'preserved','DIRECT','ORGANIZATION',$4,1)", [b, governanceDocB, entityB, B.membership.id]);
      await docFixture.query("INSERT INTO gov_document_versions(organization_id,document_id,number,content,created_by) VALUES($1,$2,1,'preserved',$3)", [b, governanceDocB, B.membership.id]);
      await docFixture.query("COMMIT");
    } catch (error) { await docFixture.query("ROLLBACK"); throw error; } finally { docFixture.release(); }
    const structureField = randomUUID(), structureB = randomUUID();
    await admin.query("INSERT INTO structure_fields(organization_id,id,key,label,target,schema) VALUES($1,$2,'test','Test','BOTH','{}')", [a, structureField]);
    await admin.query("INSERT INTO structure_field_revisions(organization_id,field_id,version,definition) VALUES($1,$2,1,'{}')", [a, structureField]);
    await admin.query("INSERT INTO structure_templates(organization_id,id,name,flags) VALUES($1,$2,'preserved','{}')", [b, structureB]);
    const parent = randomUUID(),
      child = randomUUID(),
      page = randomUUID(),
      post = randomUUID(),
      job = randomUUID(),
      scopeMember = member,
      publicToken = randomUUID(),
      backgroundRef = randomUUID();
    const brandingKey = randomUUID(),
      gcKey = randomUUID(),
      writingKey = randomUUID(), readyKey = randomUUID(), publishedKey = randomUUID(), abandonedKey = randomUUID(),
      fileKey = randomUUID(),
      artifactKey = randomUUID(),
      foreignBrandingKey = randomUUID(),
      sha = "a".repeat(64);
    for (const [id, parentId] of [
      [parent, null],
      [child, parent],
    ] as const) {
      await admin.query(
        "INSERT INTO administration_records(organization_id,id,kind,value) VALUES($1,$2,'group',$3)",
        [a, id, { name: "Group", parentId, memberIds: [member] }],
      );
      await admin.query(
        "INSERT INTO administration_group_relations(organization_id,id,parent_id) VALUES($1,$2,$3)",
        [a, id, parentId],
      );
    }
    await admin.query(
      "INSERT INTO administration_records(organization_id,id,kind,value) VALUES($1,$2,'page',$3)",
      [a, page, { title: "A" }],
    );
    await admin.query(
      "INSERT INTO administration_revisions(organization_id,id,version,value,actor_id) VALUES($1,$2,1,$3,$4)",
      [a, page, { title: "A" }, accountId],
    );
    await admin.query(
      "INSERT INTO administration_publications(organization_id,id,token,revision,snapshot,active) VALUES($1,$2,$3,1,$4,true)",
      [a, page, publicToken, { title: "A" }],
    );
    await admin.query(
      "INSERT INTO administration_feed_posts(organization_id,id,group_id,author_member_id,state,version,draft_title,draft_body,published_version) VALUES($1,$2,$3,$4,'PUBLISHED',1,'post',$5,1)",
      [a, post, child, member, {}],
    );
    await admin.query(
      "INSERT INTO administration_feed_versions(organization_id,post_id,number,title,body) VALUES($1,$2,1,'post',$3)",
      [a, post, {}],
    );
    await admin.query(
      "INSERT INTO administration_assistant_personal(organization_id,member_id,account_id,revision,instructions) VALUES($1,$2,$3,1,'fixture')",
      [a, member, accountId],
    );
    await admin.query(
      "INSERT INTO administration_assistant_workspace(organization_id,revision,instructions) VALUES($1,1,'fixture')",
      [a],
    );
    await admin.query(
      "INSERT INTO administration_branding_assets(organization_id,purpose,revision,origin,asset_id,blob_key,sha256,size,mime,width,height,public_ref) VALUES($1,'LOGIN_BACKGROUND',1,'UPLOADED',$2,$3,$4,5,'image/png',2000,1500,$5)",
      [a, randomUUID(), brandingKey, sha, backgroundRef],
    );
    await admin.query(
      "INSERT INTO administration_branding_gc(id,organization_id,purpose,blob_key,sha256,size,reason) VALUES($1,$2,'WORKSPACE_LOGO',$3,$4,5,'REPLACED')",
      [randomUUID(), a, gcKey, sha],
    );
    // Fixture-only state transitions: the production drain is deliberately unavailable.
    for (const [key, state] of [[writingKey, "WRITING"], [readyKey, "READY"], [publishedKey, "PUBLISHED"], [abandonedKey, "ABANDONED"]] as const) {
      const id = randomUUID();
      await admin.query(`INSERT INTO administration_branding_stages(id,organization_id,actor_id,credential_scope,purpose,request_key,request_hash,lifecycle_fence,base_revision,blob_key,sha256,size,width,height,write_token,writer_host,writer_pid,state)
        VALUES($1,$2,$3,'test','WORKSPACE_LOGO',$4,$5,1,0,$6,$5,5,1,1,$7,'fixture',1,'WRITING')`,
        [id, a, accountId, id, sha, key, randomUUID()]);
      if (state === "READY" || state === "PUBLISHED")
        await admin.query("UPDATE administration_branding_stages SET state='READY' WHERE id=$1", [id]);
      if (state === "PUBLISHED")
        await admin.query("UPDATE administration_branding_stages SET state='PUBLISHED',published_revision=1 WHERE id=$1", [id]);
      if (state === "ABANDONED")
        await admin.query("UPDATE administration_branding_stages SET state='ABANDONED' WHERE id=$1", [id]);
      if (state === "PUBLISHED" || state === "ABANDONED")
        await admin.query("UPDATE administration_branding_stages SET storage_removed_at=clock_timestamp() WHERE id=$1", [id]);
    }
    await admin.query(
      "INSERT INTO platform_jobs(organization_id,id,owner_id,kind,resource_type,resource_ids,export_kind,format) VALUES($1,$2,$3,'EXPORT','circle',ARRAY[$4]::uuid[],'RESOURCES','JSON')",
      [a, job, member, parent],
    );
    await admin.query(
      "INSERT INTO platform_job_attempts(organization_id,id,job_id,trace_id,attempt,stage,error_code,retryable) VALUES($1,$2,$3,$4,1,'fixture','FAIL',false)",
      [a, randomUUID(), job, randomUUID()],
    );
    await admin.query(
      "INSERT INTO platform_files(organization_id,id,resource_type,resource_id,owner_id,name,mime,size,sha256,state,blob_key) VALUES($1,$2,'circle',$3,$4,'a','application/octet-stream',5,$5,'READY',$6)",
      [a, randomUUID(), parent, member, sha, fileKey],
    );
    await admin.query(
      "INSERT INTO platform_artifacts(organization_id,id,job_id,blob_key,sha256,size,manifest) VALUES($1,$2,$3,$4,$5,5,'{}')",
      [a, randomUUID(), job, artifactKey, sha],
    );
    await admin.query(
      "INSERT INTO platform_worker_scopes(organization_id,member_id) VALUES($1,$2)",
      [a, scopeMember],
    );
    await admin.query(
      "INSERT INTO platform_scope_wakes(organization_id,id,member_id,participant) VALUES($1,$2,$3,'test')",
      [a, randomUUID(), scopeMember],
    );
    const bRecord = randomUUID(),
      bPublicToken = randomUUID();
    await admin.query(
      "INSERT INTO administration_records(organization_id,id,kind,value) VALUES($1,$2,'page',$3)",
      [b, bRecord, { title: "B" }],
    );
    await admin.query(
      "INSERT INTO administration_revisions(organization_id,id,version,value,actor_id) VALUES($1,$2,1,$3,$4)",
      [b, bRecord, { title: "B" }, accountId],
    );
    await admin.query(
      "INSERT INTO administration_publications(organization_id,id,token,revision,snapshot,active) VALUES($1,$2,$3,1,$4,true)",
      [b, bRecord, bPublicToken, { title: "B" }],
    );
    await admin.query(
      "INSERT INTO administration_branding_assets(organization_id,purpose,revision,origin,asset_id,blob_key,sha256,size,mime,width,height,public_ref) VALUES($1,'LOGIN_BACKGROUND',1,'UPLOADED',$2,$3,$4,5,'image/png',2000,1500,$5)",
      [b, randomUUID(), foreignBrandingKey, sha, randomUUID()],
    );
    assert.deepEqual(
      (
        await pool.query("SELECT administration_read_public($1) AS snapshot", [
          publicToken,
        ])
      ).rows[0].snapshot,
      { title: "A" },
    );
    assert.equal(
      (
        await pool.query(
          "SELECT administration_branding_public_owner($1) AS owner",
          [backgroundRef],
        )
      ).rows[0].owner,
      a,
    );
    await admin.query(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
    );
    created = true;
    await admin.query(`GRANT orgmap_lifecycle_maintenance TO "${role}"`);
    const url = new URL(process.env.DATABASE_URL!);
    url.username = role;
    url.password = password;
    operator = new pg.Pool({ connectionString: url.href });
    const deletionJob = randomUUID(),
      token = randomUUID();
    await admin.query(
      "INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence,state,ledger_state,ledger_authority_id,ledger_record_sha256,lease_token,lease_fence,lease_until) VALUES($1,$2,$3,$4,$5,2,2,'RUNNING','CONFIRMED',$6,$5,$7,2,clock_timestamp()+interval '10 minutes')",
      [a, deletionJob, accountId, randomUUID(), sha, randomUUID(), token],
    );
    // Both SECURITY DEFINER readers must re-read lifecycle after waiting on Org.
    const cut = await admin.connect(),
      publicReader = await pool.connect(),
      brandingReader = await pool.connect();
    let publicWait: Promise<pg.QueryResult> | undefined,
      brandingWait: Promise<pg.QueryResult> | undefined;
    let replayWait: Promise<{statusCode:number;body:string}> | undefined;
    try {
      await cut.query("BEGIN");
      await cut.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        a,
      ]);
      const pids = [
        (await publicReader.query("SELECT pg_backend_pid() AS pid")).rows[0]
          .pid,
        (await brandingReader.query("SELECT pg_backend_pid() AS pid")).rows[0]
          .pid,
      ];
      publicWait = publicReader.query(
        "SELECT administration_read_public($1) AS snapshot",
        [publicToken],
      );
      brandingWait = brandingReader.query(
        "SELECT administration_branding_public_owner($1) AS owner",
        [backgroundRef],
      );
      // Attach rejection handlers immediately while observing actual PostgreSQL blockers.
      void publicWait.catch(() => {});
      void brandingWait.catch(() => {});
      let blocked = false;
      for (let n = 0; n < 200; n++) {
        const rows = (
          await admin.query(
            "SELECT count(*)::int AS n FROM unnest($1::int[]) pid WHERE cardinality(pg_blocking_pids(pid))>0",
            [pids],
          )
        ).rows;
        if (rows[0].n === 2) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(
        blocked,
        "public readers did not wait for the target organization lock",
      );
      const cutPid=(await cut.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      replayWait=app.inject({method:"POST",url:"/api/v1/organizations",headers:{origin,cookie,"x-csrf-token":account.csrfToken,"idempotency-key":A.commandKey},payload:{name:"A teardown"}});
      let replayResponse: any;
      void replayWait!.then(response=>{replayResponse=response;});
      let replayBlocked=false;
      for (let n=0;n<200;n++) {
        replayBlocked=(await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND pid<>ALL($1::int[]) AND pid<>$2::int) AS blocked",[pids,cutPid])).rows[0].blocked;
        if (replayBlocked) break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      if (!replayBlocked) {
        const states=(await admin.query("SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() ORDER BY pid")).rows;
        throw Error(`replay wait not observed: status=${replayResponse?.statusCode}; pool=${pool.totalCount}/${pool.idleCount}/${pool.waitingCount}; states=${JSON.stringify(states)}`);
      }
      await cut.query(
        "UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",
        [a],
      );
      await cut.query("COMMIT");
      assert.equal((await publicWait).rows[0].snapshot, null);
      assert.equal((await brandingWait).rows[0].owner, null);
      assert.equal((await replayWait!).statusCode,404);
    } finally {
      await cut.query("ROLLBACK").catch(() => {});
      await Promise.allSettled(
        [publicWait, brandingWait, replayWait].filter(Boolean) as Promise<unknown>[],
      );
      cut.release();
      publicReader.release();
      brandingReader.release();
    }
    assert.equal(
      (
        await pool.query("SELECT administration_read_public($1) AS snapshot", [
          publicToken,
        ])
      ).rows[0].snapshot,
      null,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT administration_branding_public_owner($1) AS owner",
          [backgroundRef],
        )
      ).rows[0].owner,
      null,
    );
    assert.deepEqual(
      (
        await pool.query("SELECT administration_read_public($1) AS snapshot", [
          bPublicToken,
        ])
      ).rows[0].snapshot,
      { title: "B" },
    );
    for (const [sql, ref] of [
      ["SELECT administration_read_public($1)", publicToken],
      ["SELECT administration_branding_public_owner($1)", backgroundRef],
    ] as const) {
      const rr = await pool.connect();
      try {
        await rr.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await assert.rejects(
          rr.query(sql, [ref]),
          /PUBLIC_READ_COMMITTED_REQUIRED/,
        );
      } finally {
        await rr.query("ROLLBACK");
        rr.release();
      }
    }
    await assert.rejects(admin.query("DELETE FROM meeting_first_close_snapshots WHERE organization_id=$1 AND meeting_id=$2", [a,meeting]), /immutable/);
    await assert.rejects(admin.query("UPDATE meeting_statistics_observation SET source=source WHERE organization_id=$1", [a]), /immutable/);
    const forged = await pool.connect();
    try {
      await forged.query("BEGIN");
      await forged.query(
        "SELECT set_config('orgmap.organization_id',$1,true),set_config('orgmap.deletion_organization_id',$1,true),set_config('orgmap.deletion_job_id',$2,true),set_config('orgmap.deletion_fence','2',true),set_config('orgmap.deletion_lease_token',$3,true)",
        [a, deletionJob, token],
      );
      await assert.rejects(
        forged.query(
          "UPDATE administration_revisions SET value='{}' WHERE organization_id=$1",
          [a],
        ),
        /IMMUTABLE_HISTORY|permission denied/,
      );
    } finally {
      await forged.query("ROLLBACK");
      forged.release();
    }
    const parties = [
      createAdministrationTeardownParticipant(),
      createPlatformTeardownParticipant(),
      createStructureTeardownParticipant(),
      createGovernanceTeardownParticipant(),
      createGoalsTeardownParticipant(),
      createWorkTeardownParticipant(),
      createMeetingsTeardownParticipant(),
      createInteroperabilityTeardownParticipant(),
    ];
    let activeFence = "2";
    const context = (c: pg.PoolClient, org = a, lease = token) =>
      ({
        c,
        organizationId: org,
        jobId: deletionJob,
        lifecycleFence: activeFence,
        leaseToken: lease,
        actorAccountId: accountId,
      }) as OrganizationDeletionContext;
    const op = await operator.connect();
    try {
      await op.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      try {
        await assert.rejects(
          parties[0].runBatch(context(op), {
            phase: "QUIESCE",
            cursor: null,
            limit: 1,
          }),
          /DELETION_READ_COMMITTED_REQUIRED/,
        );
        await op.query("ROLLBACK");
        await op.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await assert.rejects(
          parties[2].runBatch(context(op), { phase: "QUIESCE", cursor: null, limit: 1 }),
          /DELETION_READ_COMMITTED_REQUIRED/,
        );
      } finally {
        await op.query("ROLLBACK");
      }
      await assert.rejects(
        parties[0].runBatch(context(op, a, randomUUID()), {
          phase: "QUIESCE",
          cursor: null,
          limit: 1,
        }),
        /LEASE_INVALID/,
      );
      await assert.rejects(
        parties[0].runBatch(context(op, b), {
          phase: "QUIESCE",
          cursor: null,
          limit: 1,
        }),
        /LEASE_INVALID/,
      );
      await assert.rejects(
        parties[0].runBatch(
          { ...context(op), lifecycleFence: "3" },
          { phase: "QUIESCE", cursor: null, limit: 1 },
        ),
        /LEASE_INVALID/,
      );
      for (const input of [context(op, a, randomUUID()), context(op, b), { ...context(op), lifecycleFence: "3" }])
        await assert.rejects(parties[2].runBatch(input, { phase: "QUIESCE", cursor: null, limit: 1 }), /LEASE_INVALID/);
      const ordinary = await pool.connect();
      try {
        await assert.rejects(
          parties[0].runBatch(context(ordinary), {
            phase: "QUIESCE",
            cursor: null,
            limit: 1,
          }),
          /permission denied/,
        );
        await assert.rejects(parties[2].runBatch(context(ordinary), { phase: "QUIESCE", cursor: null, limit: 1 }), /permission denied/);
      } finally {
        ordinary.release();
      }
      const readProgress = async (
        party: string,
        phase: OrganizationDeletionPhase,
      ) =>
        (
          await op.query(
            "SELECT orgmap_deletion_read_progress($1,$2,$3,$4,$5,$6) AS progress",
            [a, deletionJob, activeFence, token, party, phase],
          )
        ).rows[0].progress;
      const checkpoint = async (
        party: string,
        phase: OrganizationDeletionPhase,
        prev: any,
        next: any,
        refs: any[] = next.blobReferences ?? [],
        counts: any = next.counts,
      ) =>
        op.query(
          "SELECT orgmap_deletion_checkpoint($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)",
          [
            a,
            deletionJob,
            activeFence,
            token,
            party,
            phase,
            prev.revision,
            prev.cursor,
            next.nextCursor,
            next.done,
            JSON.stringify(counts),
            JSON.stringify(refs),
          ],
        );
      const readSql = "SELECT orgmap_deletion_read_progress($1,$2,$3,$4,$5,$6)";
      await assert.rejects(
        pool.query(readSql, [
          a,
          deletionJob,
          activeFence,
          token,
          "administration",
          "QUIESCE",
        ]),
        /permission denied/,
      );
      await assert.rejects(
        admin.query(readSql, [
          a,
          deletionJob,
          activeFence,
          token,
          "administration",
          "QUIESCE",
        ]),
        /AUTHORITY_REQUIRED/,
      );
      await assert.rejects(expireOrganizationFederatedSessions(context(op,a,randomUUID()),1), /LEASE_INVALID/);
      const appSessionClient=await pool.connect();
      try { await assert.rejects(expireOrganizationFederatedSessions(context(appSessionClient),1), /permission denied/); }
      finally { appSessionClient.release(); }
      // Same JOIN and row locks used by verifyReauth: B is allowed to finish
      // before the cut's session lock, but its receipt must fail afterwards.
      const verifier = await admin.connect();
      const reauthSQL = "SELECT r.id FROM provisioned_enrollment_reauth r JOIN sessions s ON s.id=r.session_id AND s.account_id=r.account_id JOIN accounts a ON a.id=r.account_id WHERE r.organization_id=$1 AND r.id=$2 AND s.expires_at>clock_timestamp() FOR UPDATE OF r FOR SHARE OF s";
      try {
        await verifier.query("BEGIN");
        assert.equal((await verifier.query(reauthSQL,[b,bReauth])).rowCount,1);
        const blockerPid=(await verifier.query("SELECT pg_backend_pid() pid")).rows[0].pid;
        const opPid=(await op.query("SELECT pg_backend_pid() pid")).rows[0].pid;
        await op.query("BEGIN");
        const revocation=expireOrganizationFederatedSessions(context(op),1);
        let revocationError: unknown;
        void revocation.catch(error=>{ revocationError=error; });
        let blocked=false;
        for (let i=0;i<200;i++) {
          blocked=(await admin.query("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked",[blockerPid,opPid])).rows[0].blocked;
          if (blocked) break;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        if (revocationError) throw revocationError;
        assert.equal(blocked,true);
        await verifier.query("COMMIT");
        assert.deepEqual(await revocation,{expired:1,remaining:false});
        await op.query("COMMIT");
        assert.equal((await admin.query(reauthSQL,[b,bReauth])).rowCount,0);
        const revoked=(await admin.query("SELECT auth_method,auth_organization_id,deletion_revoked_job_id FROM sessions WHERE id=$1",[sessionA])).rows[0];
        assert.equal(revoked.auth_method,'FEDERATED'); assert.equal(revoked.auth_organization_id,a); assert.equal(revoked.deletion_revoked_job_id,deletionJob);
        await assert.rejects(pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",[sessionA]),/SESSION_REVOCATION_IMMUTABLE/);
        await assert.rejects(pool.query("UPDATE sessions SET auth_method='LEGACY',auth_organization_id=NULL,auth_connection_id=NULL,deletion_revoked_at=NULL,deletion_revoked_job_id=NULL WHERE id=$1",[sessionA]),/SESSION_REVOCATION_IMMUTABLE/);
        assert.equal((await pool.query("DELETE FROM sessions WHERE id=$1",[sessionA])).rowCount,0);

        assert.equal((await admin.query("SELECT count(*)::int n FROM provisioned_enrollment_reauth WHERE organization_id=$1 AND id=$2",[b,bReauth])).rows[0].n,1);
        for (const [token,status] of [[tokenA,401],[tokenB,200],[passwordToken,200]] as const)
          assert.equal((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:`orgmap_session=${token}`}})).statusCode,status);
        assert.deepEqual(await expireOrganizationFederatedSessions(context(op),1),{expired:0,remaining:false});
        const sessionWriter=await pool.connect();
        try {
          await sessionWriter.query("BEGIN");
          await assert.rejects(createSessionRecord(sessionWriter,accountId,{method:'FEDERATED',organizationId:a,connectionId:randomUUID(),issuer:'fixture',subject:'fixture',verifiedAt:new Date()}));
          await sessionWriter.query("ROLLBACK");
          await sessionWriter.query("BEGIN");
          await createSessionRecord(sessionWriter,accountId,{method:'FEDERATED',organizationId:b,connectionId:randomUUID(),issuer:'fixture',subject:'fixture',verifiedAt:new Date()});
          await createSessionRecord(sessionWriter,accountId,{method:'PASSWORD'});
          await sessionWriter.query("ROLLBACK");
        } finally { await sessionWriter.query("ROLLBACK").catch(()=>{}); sessionWriter.release(); }
      } finally { await verifier.query("ROLLBACK").catch(()=>{}); verifier.release(); await op.query("ROLLBACK").catch(()=>{}); }
      for (const party of parties) {
        await assert.rejects(
          party.runBatch(context(op), {
            phase: "QUIESCE",
            cursor: null,
            limit: 1,
          }),
          /TEARDOWN_IO_DRAIN_PROOF_REQUIRED/,
        );
        await assert.rejects(
          op.query(
            "SELECT orgmap_deletion_checkpoint($1,$2,$3,$4,$5,'QUIESCE',1,NULL,NULL,true,'{}'::jsonb,'[]'::jsonb)",
            [a, deletionJob, activeFence, token, party.contextId],
          ),
          /TEARDOWN_IO_DRAIN_PROOF_REQUIRED/,
        );
        // Fixture-only checkpoint bypasses the unavailable drain port. It is
        // not evidence of real I/O quiescence and must never be used in production.
        await admin.query(
          "INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,$2,'QUIESCE',true)",
          [deletionJob, party.contextId],
        );
      }
      await admin.query(
        "UPDATE organization_deletion_jobs SET phase='INVENTORY' WHERE id=$1",
        [deletionJob],
      );
      // A retired stage without receipt or matching asset/GC is corruption, not an empty inventory.
      const corruptStage = randomUUID();
      await admin.query(`INSERT INTO administration_branding_stages(id,organization_id,actor_id,credential_scope,purpose,request_key,request_hash,lifecycle_fence,base_revision,blob_key,sha256,size,width,height,write_token,writer_host,writer_pid,state) VALUES($1,$2,$3,'test','WORKSPACE_LOGO',$1::uuid::text,$4,1,0,$5,$4,5,1,1,$6,'fixture',1,'WRITING')`, [corruptStage,a,accountId,sha,randomUUID(),randomUUID()]);
      await admin.query("UPDATE administration_branding_stages SET state='ABANDONED' WHERE id=$1", [corruptStage]);
      await assert.rejects(parties[0].runBatch(context(op), {phase:'INVENTORY',cursor:null,limit:1}), /TEARDOWN_BRANDING_STAGE_REFERENCE_MISSING/);
      await admin.query("UPDATE administration_branding_stages SET storage_removed_at=clock_timestamp() WHERE id=$1", [corruptStage]);
      // One real A reference followed by B reference: failure must roll back both
      // the first reference and checkpoint, even though the first was accepted.
      await op.query("BEGIN");
      try {
        const prev = await readProgress("administration", "INVENTORY");
        const r = await parties[0].runBatch(context(op), {
          phase: "INVENTORY",
          cursor: prev.cursor,
          limit: 1,
        });
        assert.equal(r.blobReferences?.length, 1);
        await assert.rejects(
          checkpoint("administration", "INVENTORY", prev, r, [
            ...r.blobReferences!,
            {
              namespace: "ORG_BRANDING",
              key: foreignBrandingKey,
              sha256: sha,
              size: 5,
            },
          ]),
          /DELETION_REFERENCE_NOT_OWNED/,
        );
      } finally {
        await op.query("ROLLBACK");
      }
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM organization_deletion_blobs WHERE job_id=$1",
            [deletionJob],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM organization_deletion_progress WHERE job_id=$1 AND context_id='administration' AND phase='INVENTORY'",
            [deletionJob],
          )
        ).rows[0].n,
        0,
      );
      const first = [brandingKey, gcKey, writingKey, readyKey].sort()[0];
      await admin.query(
        "INSERT INTO organization_deletion_blobs(job_id,namespace,blob_key,sha256,size) VALUES($1,'ORG_BRANDING',$2,$3,5)",
        [deletionJob, first, "b".repeat(64)],
      );
      await op.query("BEGIN");
      try {
        const prev = await readProgress("administration", "INVENTORY");
        const r = await parties[0].runBatch(context(op), {
          phase: "INVENTORY",
          cursor: prev.cursor,
          limit: 1,
        });
        await assert.rejects(
          checkpoint("administration", "INVENTORY", prev, r),
          /DELETION_REFERENCE_CONFLICT/,
        );
      } finally {
        await op.query("ROLLBACK");
      }
      await admin.query(
        "DELETE FROM organization_deletion_blobs WHERE job_id=$1 AND namespace='ORG_BRANDING' AND blob_key=$2",
        [deletionJob, first],
      );
      const collected: any[] = [];
      for (const party of parties) {
        let done = false,
          firstPage = true;
        while (!done) {
          await op.query("BEGIN");
          let prev: any, r: any;
          try {
            prev = await readProgress(party.contextId, "INVENTORY");
            r = await party.runBatch(context(op), {
              phase: "INVENTORY",
              cursor: prev.cursor,
              limit: 1,
            });
            await checkpoint(party.contextId, "INVENTORY", prev, r);
            await op.query("COMMIT");
          } catch (e) {
            await op.query("ROLLBACK");
            throw e;
          }
          collected.push(...(r.blobReferences ?? []));
          done = r.done;
          if (firstPage) {
            firstPage = false;
            await assert.rejects(
              checkpoint(party.contextId, "INVENTORY", prev, r),
              /DELETION_CHECKPOINT_CONFLICT/,
            );
          }
        }
      }
      assert.deepEqual(
        new Set(collected.map((x) => x.key)),
        new Set([brandingKey, gcKey, writingKey, readyKey, fileKey, artifactKey]),
      );
      // Compare to the reviewed migration pin; do not overwrite it.
      await op.query('BEGIN');
      let fixtureFingerprint:string;
      try {
        await op.query('SELECT pg_advisory_xact_lock(730184)');
        fixtureFingerprint=(await op.query('SELECT orgmap_deletion_schema_fingerprint($1,$2,$3,$4) AS digest',[a,deletionJob,activeFence,token])).rows[0].digest;
      } finally {await op.query('ROLLBACK');}
      assert.equal((await admin.query("SELECT fingerprint FROM organization_deletion_schema_baseline WHERE singleton")).rows[0]?.fingerprint,fixtureFingerprint!);
      const expectGuardedPurgeFailure=async (party:typeof parties[number],pattern:RegExp,cursor:string|null=null)=>{
        await op.query('BEGIN');
        try {await op.query('SELECT pg_advisory_xact_lock(730184)');await assert.rejects(party.runBatch(context(op),{phase:'PURGE',cursor,limit:1}),pattern);}
        finally {await op.query('ROLLBACK');}
      };
      await admin.query(
        "UPDATE organization_deletion_jobs SET phase='PURGE' WHERE id=$1",
        [deletionJob],
      );
      await expectGuardedPurgeFailure(parties[0],/TEARDOWN_LIFECYCLE_PURGING_REQUIRED/);
      const transition = await admin.connect();
      try {
        await transition.query("BEGIN");
        await transition.query(
          "UPDATE organization_lifecycle SET state='PURGING',fence=3 WHERE organization_id=$1",
          [a],
        );
        await transition.query(
          "UPDATE organization_deletion_jobs SET lifecycle_fence=3,lease_fence=3 WHERE id=$1",
          [deletionJob],
        );
        await transition.query("COMMIT");
      } catch (error) {
        await transition.query("ROLLBACK");
        throw error;
      } finally {
        transition.release();
      }
      activeFence = "3";
      await expectGuardedPurgeFailure(parties[0],/TEARDOWN_BRANDING_WRITER_UNRESOLVED/);
      // Simulate only a known-completed writer; no production drain is being attested.
      await admin.query("UPDATE administration_branding_stages SET state='READY' WHERE blob_key=$1", [writingKey]);

      await expectGuardedPurgeFailure(parties[7],/TEARDOWN_INTEROP_EFFECT_PROOF_REQUIRED/);
      // This pending synthetic fixture was never dispatched; no production outcome is certified.
      await admin.query("DELETE FROM interop_deliveries WHERE organization_id=$1 AND id=$2", [a,interopDelivery]);
      // Missing even one manifest ref blocks metadata purge.
      const missing = collected[0];
      await admin.query(
        "DELETE FROM organization_deletion_blobs WHERE job_id=$1 AND namespace=$2 AND blob_key=$3",
        [deletionJob, missing.namespace, missing.key],
      );
      await expectGuardedPurgeFailure(parties[0],/BLOB_MANIFEST_INCOMPLETE/);
      await admin.query(
        "INSERT INTO organization_deletion_blobs(job_id,namespace,blob_key,sha256,size) VALUES($1,$2,$3,$4,$5)",
        [
          deletionJob,
          missing.namespace,
          missing.key,
          missing.sha256,
          missing.size,
        ],
      );
      let testedRollback = false, testedGovernanceRollback = false,
        testedSameCursor = false;
      for (const party of parties) {
        let done = false,
          steps = 0;
        while (!done) {
          assert.ok(++steps < 200);
          await op.query("BEGIN");
          let prev: any, r: any;
          try {
            await op.query('SELECT pg_advisory_xact_lock(730184)');
            prev = await readProgress(party.contextId, "PURGE");
            r = await party.runBatch(context(op), {
              phase: "PURGE",
              cursor: prev.cursor,
              limit: party.contextId === "governance" ? 3 : 1,
            });
            if (!testedRollback && Object.keys(r.counts).length) {
              const table = Object.keys(r.counts)[0];
              assert.ok(party.describe().ownedSets.includes(table));
              const before = (
                await admin.query(
                  `SELECT count(*)::int n FROM public.${table} WHERE organization_id=$1`,
                  [a],
                )
              ).rows[0].n;
              await assert.rejects(
                checkpoint(party.contextId, "PURGE", prev, r, [], { rows: -1 }),
                /DELETION_COUNT_INVALID/,
              );
              await op.query("ROLLBACK");
              const after = (
                await admin.query(
                  `SELECT count(*)::int n FROM public.${table} WHERE organization_id=$1`,
                  [a],
                )
              ).rows[0].n;
              assert.equal(after, before);
              testedRollback = true;
              continue;
            }
            if (party.contextId === "governance" && r.counts.gov_documents && !testedGovernanceRollback) {
              await assert.rejects(checkpoint(party.contextId, "PURGE", prev, r, [], {rows:-1}), /DELETION_COUNT_INVALID/);
              await op.query("ROLLBACK");
              assert.equal((await admin.query("SELECT count(*)::int n FROM gov_documents WHERE organization_id=$1 AND id=$2", [a, governanceDoc])).rows[0].n, 1);
              assert.deepEqual((await admin.query("SELECT number FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2 ORDER BY number", [a, governanceDoc])).rows.map(row => row.number), [1,2]);
              testedGovernanceRollback = true;
              continue;
            }
            await checkpoint(party.contextId, "PURGE", prev, r);
            await op.query("COMMIT");
          } catch (e) {
            await op.query("ROLLBACK");
            throw e;
          }
          if (party.contextId === "governance" && r.counts.gov_document_versions && !r.counts.gov_documents) {
            await expectGuardedPurgeFailure(party,/TEARDOWN_ATOMIC_CYCLE_EXCEEDS_LIMIT/,r.nextCursor);
            assert.deepEqual((await admin.query("SELECT number FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2 ORDER BY number", [a, governanceDoc])).rows.map(row => row.number), [1, 2]);
          }
          if (prev.cursor !== null && prev.cursor === r.nextCursor) {
            await assert.rejects(
              checkpoint(party.contextId, "PURGE", prev, r),
              /DELETION_CHECKPOINT_CONFLICT/,
            );
            testedSameCursor = true;
          }
          done = r.done;
        }
        const replay = await party.runBatch(context(op), {
          phase: "PURGE",
          cursor: null,
          limit: 1,
        });
        assert.equal(replay.done, true);
        for (const table of party.describe().ownedSets) {
          const n = (
            await admin.query(
              `SELECT count(*)::int AS n FROM public.${table} WHERE organization_id=$1`,
              [a],
            )
          ).rows[0].n;
          assert.equal(n, 0, table);
        }
      }
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM structure_templates WHERE organization_id=$1 AND id=$2", [b, structureB])).rows[0].n, 1);
      assert.equal((await admin.query("SELECT count(*)::int n FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2", [b, governanceDocB])).rows[0].n, 1);
      assert.equal((await admin.query("SELECT count(*)::int n FROM goals WHERE organization_id=$1 AND id=$2", [b,goalB])).rows[0].n, 1);
      assert.equal((await admin.query("SELECT count(*)::int n FROM work_projects WHERE organization_id=$1 AND id=$2", [b,workProjectB])).rows[0].n, 1);
      assert.equal((await admin.query("SELECT count(*)::int n FROM interop_connections WHERE organization_id=$1 AND id=$2", [b,interopConnectionB])).rows[0].n, 1);
      assert.equal(testedGovernanceRollback, true);
      assert.equal(testedRollback, true);
      assert.equal(testedSameCursor, true);
    } finally {
      op.release();
    }
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM administration_revisions WHERE organization_id=$1",
          [b],
        )
      ).rows[0].n,
      1,
    );
    assert.deepEqual(
      (
        await pool.query("SELECT administration_read_public($1) AS snapshot", [
          bPublicToken,
        ])
      ).rows[0].snapshot,
      { title: "B" },
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM accounts WHERE id=$1",
          [accountId],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await app.close();
    await operator?.end();
    await acceptancePool?.end();
    if (acceptanceCreated) await admin.query(`DROP ROLE "${acceptanceRole}"`);
    if (created) await admin.query(`DROP ROLE "${role}"`);
    await admin.end();
  }
});

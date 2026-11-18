import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { pool, transaction } from "../../server/src/db.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import { authorizeOrganizationEffect } from "../../server/src/organization-effects.js";
import { deliverQueue } from "../../server/iam-mail/queue.js";
import { SmtpDeliveryError } from "../../server/src/smtp.js";
const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const operator = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/");
if (!/^\/orgmap_test_[a-f0-9]{16,32}$/.test(runtime.pathname) || runtime.pathname !== operator.pathname || runtime.host !== operator.host ||
  !["127.0.0.1","localhost","[::1]"].includes(runtime.hostname)) throw Error("EXCLUSIVE_LIFECYCLE_IAM_DATABASE_REQUIRED");
const admin = new pg.Pool({ connectionString: operator.href });
let core!: ModuleRuntime;
const app = await buildApp([foundationDefaultAdmissionPolicy, async (_app, runtime) => { core = runtime; }]);
after(async () => { await app.close(); await pool.end(); await admin.end(); });
const call = (method: "GET"|"POST", path: string, body?: unknown, user?: {cookie:string;csrf:string}) => app.inject({
  method, url:"/api/v1"+path, payload:body as any, headers:{ origin:"http://localhost:5173", "idempotency-key":randomUUID(),
    ...(user?{cookie:user.cookie,"x-csrf-token":user.csrf}:{}) },
});

test("invitation SMTP intents permit proven retry, block unknown and survive crash before I/O", async () => {
  const registered = await call("POST","/auth/register",{ email:randomUUID()+"@example.test",password:"synthetic-password-123",displayName:"Owner" });
  assert.equal(registered.statusCode,201,registered.body);
  const user = { cookie:registered.cookies[0].name+"="+registered.cookies[0].value, csrf:registered.json().data.csrfToken };
  const created = await call("POST","/organizations",{name:"IAM effects"},user);
  assert.equal(created.statusCode,201,created.body);
  const org = created.json().data.organization.id as string;
  const invite = async () => {
    const response = await call("POST",`/organizations/${org}/invitations`,{email:randomUUID()+"@example.test"},user);
    assert.equal(response.statusCode,201,response.body);
    return response.json().data.deliveryJobId as string;
  };
  let sends=0;
  const first=await invite();
  await deliverQueue("invitation",org,async()=>{ sends++; throw new SmtpDeliveryError("NOT_SENT","offline"); },core.validateInvitationDelivery);
  assert.equal(sends,1);
  assert.equal((await admin.query("SELECT state FROM organization_effects WHERE organization_id=$1 AND effect_key=$2",[org,"invitation:"+first])).rows[0].state,"NOT_SENT");
  await admin.query("UPDATE invitation_delivery SET next_attempt_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,first]);
  assert.equal(await deliverQueue("invitation",org,async()=>{ sends++; },core.validateInvitationDelivery),1);
  assert.equal(sends,2);
  assert.deepEqual((await admin.query("SELECT state FROM organization_effects WHERE organization_id=$1 AND effect_key=$2 ORDER BY authorized_at",[org,"invitation:"+first])).rows.map(r=>r.state),["NOT_SENT","CONFIRMED"]);
  const unknown=await invite();
  await deliverQueue("invitation",org,async()=>{ sends++; throw new SmtpDeliveryError("OUTCOME_UNKNOWN","lost after DATA"); },core.validateInvitationDelivery);
  assert.equal((await admin.query("SELECT state FROM invitation_delivery WHERE organization_id=$1 AND id=$2",[org,unknown])).rows[0].state,"OUTCOME_UNKNOWN");
  await deliverQueue("invitation",org,async()=>{ sends++; },core.validateInvitationDelivery);
  assert.equal(sends,3,"unknown result must not cause another send");
  const crash=await invite(), lease=randomUUID();
  await transaction(async(c)=>{
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[org]);
    await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE",[org]);
    await c.query("UPDATE invitation_delivery SET state='PROCESSING',lease_token=$3,lease_until=clock_timestamp()+interval '1 minute' WHERE organization_id=$1 AND id=$2",[org,crash,lease]);
    await authorizeOrganizationEffect(c,{organizationId:org,owner:"IAM",effectKey:"invitation:"+crash,sourceLeaseToken:lease,
      validateSourceLease:async(client,token)=>!!(await client.query("SELECT 1 FROM invitation_delivery WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND lease_until>clock_timestamp() FOR UPDATE",[org,crash,token])).rowCount});
  });
  await admin.query("UPDATE invitation_delivery SET lease_until=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",[org,crash]);
  await deliverQueue("invitation",org,async()=>{ sends++; },core.validateInvitationDelivery);
  assert.equal(sends,3,"crash after intent commit must not replay the send");
  assert.equal((await admin.query("SELECT state FROM invitation_delivery WHERE organization_id=$1 AND id=$2",[org,crash])).rows[0].state,"OUTCOME_UNKNOWN");
  assert.equal((await admin.query("SELECT state FROM organization_effects WHERE organization_id=$1 AND effect_key=$2",[org,"invitation:"+crash])).rows[0].state,"OUTCOME_UNKNOWN");
});

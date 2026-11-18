import { authorizeOrganizationEffect, recordOrganizationEffectOutcome, type EffectAuthorization } from "../src/organization-effects.js";
import { SmtpDeliveryError } from "../src/smtp.js";
import { lockActiveOrganization } from "../src/organization-lifecycle.js";
import type pg from "pg";
import { transaction } from "../src/db.js";
import { assertManagedWriter } from "../src/managed-writer.js";
import type { LocalMail } from "../src/smtp.js";
import { fail, Failure } from "../src/core.js";
import { renderInvitationMail, type InvitationMailContext } from "./invitation-template.js";
export type InvitationDeliveryValidator = (
  c: pg.PoolClient,
  organizationId: string,
  invitation: any,
) => Promise<InvitationMailContext | null>;
export type InvitationDeliveryReporter = (c: pg.PoolClient, organizationId: string, jobId: string) => Promise<void>;
/** SMTP is at-least-once. Stable Message-ID allows a sink/provider to deduplicate. */
export async function deliverQueue(
  kind: "account" | "invitation",
  organizationId: string | undefined,
  sender: (mail: LocalMail) => Promise<void>,
  validateInvitation?: InvitationDeliveryValidator,
  reportInvitation?: InvitationDeliveryReporter,
) {
  await transaction(assertManagedWriter);
  if (kind === "invitation")
    return deliverInvitationQueue(organizationId!, sender, validateInvitation, reportInvitation);
  const table = kind === "account" ? "account_mail" : "invitation_delivery";
  const scoped = async (c: pg.PoolClient) => {
    if (organizationId)
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        organizationId,
      ]);
  };
  const jobs = await transaction(async (c) => {
    await scoped(c);
    return (
      await c.query(
        `UPDATE ${table} SET state='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',attempts=attempts+1 WHERE id IN (SELECT id FROM ${table} WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (state<>'PROCESSING' OR lease_until<clock_timestamp()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING id,lease_token`,
      )
    ).rows;
  });
  let delivered = 0;
  for (const job of jobs)
    await transaction(async (c) => {
      await scoped(c);
      // Account-global mutations lock Account before its mail. Match that order
      // so email change/recovery cancellation cannot deadlock the dispatcher.
      if (kind === "account") {
        const reference = (await c.query("SELECT account_id FROM account_mail WHERE id=$1", [job.id])).rows[0];
        if (!reference) return;
        await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [reference.account_id]);
      }
      const row = (
        await c.query(
          `SELECT * FROM ${table} WHERE id=$1 AND lease_token=$2 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE`,
          [job.id, job.lease_token],
        )
      ).rows[0];
      if (!row) return;
      const valid =
        kind === "account"
          ? (
              await c.query(
                "SELECT a.email FROM password_recovery r JOIN accounts a ON a.id=r.account_id WHERE r.id=$1 AND r.used_at IS NULL AND r.expires_at>clock_timestamp() AND a.password_enabled AND r.email_revision=a.email_revision AND a.email=$2 FOR UPDATE OF r,a",
                [row.recovery_id, row.email],
              )
            ).rows[0]
          : (
              await c.query(
                "SELECT email FROM invitations WHERE organization_id=$1 AND id=$2 AND status='PENDING' AND expires_at>clock_timestamp() FOR UPDATE",
                [organizationId, row.invitation_id],
              )
            ).rows[0];
      let state = "CANCELLED",
        error: string | null = null;
      if (valid && row.token)
        try {
          await sender({
            id: row.id,
            to: valid.email,
            subject:
              kind === "account"
                ? "OrgMap local password recovery"
                : "OrgMap local organization invitation",
            text:
              (kind === "account"
                ? "Recovery token (expires in 30 minutes):\n"
                : "Local token (one-use):\n") + row.token,
          });
          state = "DELIVERED";
          delivered++;
        } catch {
          state = "FAILED";
          error = "SMTP_DELIVERY_FAILED";
        }
      await c.query(
        `UPDATE ${table} SET state=$3,token=CASE WHEN $3 IN ('DELIVERED','CANCELLED') THEN NULL ELSE token END,lease_until=NULL,lease_token=NULL,last_error=$4,next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(3600,5*power(2,LEAST(attempts,10)))::integer) WHERE id=$1 AND lease_token=$2`,
        [row.id, job.lease_token, state, error],
      );
    });
  return delivered;
}

/** Two-phase local delivery: the SMTP operation never holds a database transaction. */
async function deliverInvitationQueue(
  org: string,
  sender: (mail: LocalMail) => Promise<void>,
  validator?: InvitationDeliveryValidator,
  reporter?: InvitationDeliveryReporter,
) {
  const scoped = async (c: pg.PoolClient) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
    await lockActiveOrganization(c, org);
  };
  const jobs = await transaction(async (c) => {
    await scoped(c);
    // Exhaustion is a durable terminal outcome, including a worker that died on
    // its final lease. Unobserved authorized I/O is never automatically repeated.
    const exhausted = (await c.query(`SELECT d.* FROM invitation_delivery d WHERE organization_id=$1
      AND state IN ('PENDING','FAILED','PROCESSING') AND terminal_at IS NULL AND attempts>=5
      AND (state<>'PROCESSING' OR lease_until<clock_timestamp()) ORDER BY id FOR UPDATE LIMIT 20`, [org])).rows;
    for (const row of exhausted) {
      const unresolved = (await c.query("SELECT id,state,lifecycle_fence::text AS fence,effect_token FROM organization_effects WHERE organization_id=$1 AND owner='IAM' AND effect_key=$2 AND state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN')", [org, "invitation:" + row.id])).rows[0];
      if (unresolved?.state === "AUTHORIZED") await recordOrganizationEffectOutcome(c, { organizationId: org, id: unresolved.id, fence: unresolved.fence, token: unresolved.effect_token }, "OUTCOME_UNKNOWN");
      const observed = unresolved?.state === "CONFIRMED" ? "DELIVERED" : unresolved ? "OUTCOME_UNKNOWN" : "FAILED";
      await c.query("UPDATE invitation_delivery SET state=$3,last_error=$4,terminal_at=CASE WHEN $3='DELIVERED' THEN NULL ELSE clock_timestamp() END,completed_at=clock_timestamp(),token=NULL,lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2", [org, row.id, observed, observed === "DELIVERED" ? null : unresolved ? "EFFECT_OUTCOME_UNRESOLVED" : "INVITATION_DELIVERY_FAILED"]);
      await reporter?.(c, org, row.id);
    }
    return (
      await c.query(
        "UPDATE invitation_delivery SET state='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',attempts=attempts+1,last_attempt_at=clock_timestamp() WHERE organization_id=$1 AND id IN (SELECT id FROM invitation_delivery WHERE organization_id=$1 AND state IN ('PENDING','FAILED','PROCESSING') AND terminal_at IS NULL AND attempts<5 AND next_attempt_at<=clock_timestamp() AND (state<>'PROCESSING' OR lease_until<clock_timestamp()) ORDER BY created_at NULLS FIRST,id FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING id,lease_token",
        [org],
      )
    ).rows;
  });
  let delivered = 0;
  for (const job of jobs) {
    let mail: LocalMail | undefined,
      effect: EffectAuthorization | undefined,
      state = "CANCELLED",
      error: string | null = null;
    const valid = async (c: pg.PoolClient, row: any) => {
      if (!validator) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
      try {
        return await validator!(c, org, row);
      } catch (e) {
        if (e instanceof Failure && [403, 404, 409, 422].includes(e.status))
          return null;
        throw e;
      }
    };
    try {
      const prepared = await transaction(async (c) => {
        await scoped(c);
        const row = (
          await c.query(
            "SELECT * FROM invitation_delivery WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE",
            [org, job.id, job.lease_token],
          )
        ).rows[0];
        if (!row || !row.token) return undefined;
        const target = await valid(c, row);
        if (!target) return undefined;
        const prior = (await c.query(
          "SELECT id,state,lifecycle_fence::text AS fence,effect_token FROM organization_effects WHERE organization_id=$1 AND owner='IAM' AND effect_key=$2 AND state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN')",
          [org, "invitation:" + row.id],
        )).rows[0];
        if (prior) {
          if (prior.state === "AUTHORIZED") await recordOrganizationEffectOutcome(c, {organizationId:org,id:prior.id,fence:prior.fence,token:prior.effect_token}, "OUTCOME_UNKNOWN");
          return { blocked: true as const, confirmed: prior.state === "CONFIRMED" };
        }
        const authorization = await authorizeOrganizationEffect(c, {
          organizationId: org, owner: "IAM", effectKey: "invitation:" + row.id,
          sourceLeaseToken: job.lease_token,
          validateSourceLease: async (client, token) => !!(await client.query(
            "SELECT 1 FROM invitation_delivery WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE",
            [org, row.id, token],
          )).rowCount,
        });
        return { blocked: false as const, authorization, mail: {
          id: row.id,
          to: target.email,
          ...renderInvitationMail(target, row.token),
        }};
      });
      if (prepared?.blocked) {
        state = prepared.confirmed ? "DELIVERED" : "OUTCOME_UNKNOWN";
        error = prepared.confirmed ? null : "EFFECT_OUTCOME_UNRESOLVED";
      } else if (prepared) {
        effect = prepared.authorization;
        mail = prepared.mail;
        try {
          await sender(mail);
          state = "DELIVERED";
        } catch (sendError) {
          const disposition = sendError instanceof SmtpDeliveryError ? sendError.disposition : "OUTCOME_UNKNOWN";
          state = disposition === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "FAILED";
          error = disposition === "OUTCOME_UNKNOWN" ? "EFFECT_OUTCOME_UNRESOLVED" : "INVITATION_DELIVERY_FAILED";
          await transaction(async (c) => {
            await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
            await recordOrganizationEffectOutcome(c, effect!, disposition);
          });
          effect = undefined;
        }
        if (effect) {
          await transaction(async (c) => {
            await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
            await recordOrganizationEffectOutcome(c, effect!, "CONFIRMED");
          });
          effect = undefined;
        }
      }
    } catch {
      state = effect ? "OUTCOME_UNKNOWN" : "FAILED";
      error = effect ? "EFFECT_OUTCOME_UNRESOLVED" : "INVITATION_DELIVERY_FAILED";
    }
    const final = await transaction(async (c) => {
      await scoped(c);
      const row = (
        await c.query(
          "SELECT * FROM invitation_delivery WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE",
          [org, job.id, job.lease_token],
        )
      ).rows[0];
      if (!row) return false;
      if (state === "DELIVERED") {
        try {
          if (!(await valid(c, row))) state = "CANCELLED";
        } catch {
          state = "FAILED";
          error = "INVITATION_DELIVERY_FAILED";
        }
      }
      await c.query(
        "UPDATE invitation_delivery SET state=$4,token=CASE WHEN $4 IN ('DELIVERED','CANCELLED','OUTCOME_UNKNOWN') OR attempts>=5 THEN NULL ELSE token END,lease_until=NULL,lease_token=NULL,last_error=$5,completed_at=CASE WHEN $4 IN ('DELIVERED','CANCELLED','OUTCOME_UNKNOWN') OR attempts>=5 THEN clock_timestamp() ELSE NULL END,terminal_at=CASE WHEN $4='OUTCOME_UNKNOWN' OR ($4='FAILED' AND attempts>=5) THEN clock_timestamp() ELSE NULL END,next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(3600,5*power(2,LEAST(attempts,10)))::integer) WHERE organization_id=$1 AND id=$2 AND lease_token=$3",
        [org, job.id, job.lease_token, state, error],
      );
      await reporter?.(c, org, row.id);
      return state === "DELIVERED";
    });
    if (final) delivered++;
  }
  return delivered;
}

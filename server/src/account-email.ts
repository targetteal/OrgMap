import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { transaction } from "./db.js";
import { body, commandHash, digest, fail, Failure, id, key, secret, uuid, version } from "./core.js";
import { normalizeAdmissionEmail } from "./admission.js";
import { createSessionRecord } from "./sessions.js";
import { sendLocalMail, type LocalMail } from "./smtp.js";
import type { AccountReauthentication, AccountReauthenticationCredentials } from "./account-security-contract.js";

export type AccountEmailCore = {
  auth(request: FastifyRequest, c?: PoolClient): Promise<any>;
  envelope(request: FastifyRequest, data: any, organization?: any, resourceVersion?: number | null, owner?: boolean): any;
  reauthenticateOwnAccount(c: PoolClient, account: any, session: any, credentials: AccountReauthenticationCredentials): Promise<AccountReauthentication>;
  /** Account lock held; must invalidate global proofs without acquiring Org locks. */
  invalidateAccountEmailProofs(c: PoolClient, accountId: string, oldEmailRevision: number): Promise<void>;
};

const base = "/api/v1/account/email-change/requests";
const metadata = (row: any) => ({
  requestId: row.id,
  state: row.state,
  expiresAt: new Date(row.expires_at).toISOString(),
});
const safeAccount = (a: any) => ({
  id: a.id, email: a.email, displayName: a.display_name,
  passwordEnabled: a.password_enabled, version: a.version,
});
const sameRevision = (a: unknown, b: unknown) => String(a) === String(b);

export function createAccountEmailServices(core: AccountEmailCore) {
  async function own<T>(r: FastifyRequest, fn: (c: PoolClient, a: any, session: any) => Promise<T>): Promise<T> {
    const authenticated = await core.auth(r);
    return transaction(async (c) => {
      const a = (await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [authenticated.id])).rows[0];
      if (!a) fail(401, "UNAUTHENTICATED");
      const session = await core.auth(r, c);
      return fn(c, a, session);
    });
  }
  // A separate transaction makes the bounded rate budget survive failed proofs.
  // Its small row set is keyed by authenticated Account, never arbitrary IP/email.
  async function budget(r: FastifyRequest, operation: "REQUEST" | "COMPLETE" | "REVOKE") {
    const a = await core.auth(r);
    const limit = operation === "REQUEST" ? 6 : 60;
    const attempts = await transaction(async (c) => (await c.query(
      "INSERT INTO account_email_change_rate_budgets(account_id,operation,window_started_at,attempts) VALUES($1,$2,clock_timestamp(),1) ON CONFLICT(account_id,operation) DO UPDATE SET attempts=CASE WHEN account_email_change_rate_budgets.window_started_at<=clock_timestamp()-interval '1 hour' THEN 1 ELSE LEAST(account_email_change_rate_budgets.attempts+1,1000000) END,window_started_at=CASE WHEN account_email_change_rate_budgets.window_started_at<=clock_timestamp()-interval '1 hour' THEN clock_timestamp() ELSE account_email_change_rate_budgets.window_started_at END RETURNING attempts",
      [a.id, operation],
    )).rows[0].attempts);
    if (attempts > limit) fail(429, "RATE_LIMITED");
  }
  function command(r: FastifyRequest) {
    // Fresh credentials are authorization, not command semantics: an MFA replay
    // must accept a newly verified OTP while retaining the same mailbox intent.
    const semanticBody = Object.fromEntries(Object.entries((r.body ?? {}) as object)
      .filter(([name]) => !["currentPassword", "totpCode"].includes(name)));
    return { k: "account:" + r.method + ":" + r.url.split("?")[0] + ":" + key(r),
      hash: commandHash({ method: r.method, url: r.url, headers: r.headers, body: semanticBody } as FastifyRequest) };
  }
  async function prior(c: PoolClient, a: any, cmd: { k: string; hash: string }) {
    const row = (await c.query("SELECT hash,result FROM account_commands WHERE account_id=$1 AND key=$2", [a.id, cmd.k])).rows[0];
    if (row && row.hash !== cmd.hash) fail(409, "IDEMPOTENCY_CONFLICT");
    return row?.result;
  }
  async function remember(c: PoolClient, a: any, cmd: { k: string; hash: string }, result: any) {
    await c.query("INSERT INTO account_commands(account_id,key,hash,result) VALUES($1,$2,$3,$4)", [a.id, cmd.k, cmd.hash, result]);
  }
  async function audit(c: PoolClient, a: any, r: FastifyRequest, action: string, resource: string) {
    await c.query("INSERT INTO account_events(id,account_id,action,resource_id,request_id) VALUES($1,$2,$3,$4,$5)", [uuid(), a.id, action, resource, r.id]);
  }
  async function cancelMail(c: PoolClient, accountId: string, requestId?: string) {
    await c.query("UPDATE account_email_change_mail SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE account_id=$1 AND ($2::uuid IS NULL OR request_id=$2) AND state NOT IN ('DELIVERED','CANCELLED')", [accountId, requestId ?? null]);
  }
  async function requestRow(c: PoolClient, a: any, requestId: string) {
    const row = (await c.query("SELECT r.*,r.expires_at>clock_timestamp() AS proof_live,EXISTS(SELECT 1 FROM sessions s WHERE s.id=r.initiating_session_id AND s.account_id=r.account_id AND s.expires_at>clock_timestamp()) AS initiating_session_live FROM account_email_change_requests r WHERE r.account_id=$1 AND r.id=$2 FOR UPDATE OF r", [a.id, requestId])).rows[0];
    if (!row) fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  function pending(row: any, a: any, proof?: AccountReauthentication) {
    return row.state === "PENDING_PROOF" && row.failed_attempts < 5 &&
      row.proof_live === true && !!row.initiating_session_id && row.initiating_session_live === true &&
      a.email === row.old_email && sameRevision(a.email_revision, row.email_revision) &&
      sameRevision(a.credential_revision, row.credential_revision) &&
      (!proof || digest(proof.binding) === row.primary_binding_hash);
  }
  async function expire(c: PoolClient, a: any, row: any) {
    if (row.state === "PENDING_PROOF" && !pending(row, a)) {
      await c.query("UPDATE account_email_change_requests SET state='EXPIRED' WHERE id=$1", [row.id]);
      await cancelMail(c, a.id, row.id);
      row.state = "EXPIRED";
    }
    return row;
  }
  async function registerAccountEmailRoutes(app: FastifyInstance) {
    app.post(base, async (r, reply) => {
      const b = body(r, ["newEmail", "currentPassword", "totpCode"]),
        newEmail = normalizeAdmissionEmail(b.newEmail), cmd = command(r);
      await budget(r, "REQUEST");
      const result = await own(r, async (c, a, session) => {
        const proof = await core.reauthenticateOwnAccount(c, a, session, b);
        const cached = await prior(c, a, cmd);
        if (cached) {
          const row = await requestRow(c, a, cached.requestId);
          if (!pending(row, a, proof) || row.initiating_session_id !== session.session_id) fail(409, "EMAIL_CHANGE_INVALID");
          return cached;
        }
        version(r, a.version);
        if (newEmail === a.email) fail(422, "EMAIL_UNCHANGED");
        await c.query("UPDATE account_email_change_requests SET state='REPLACED' WHERE account_id=$1 AND state='PENDING_PROOF'", [a.id]);
        await cancelMail(c, a.id);
        const token = secret(), requestId = uuid();
        const row = (await c.query(
          "INSERT INTO account_email_change_requests(id,account_id,old_email,new_email,email_revision,credential_revision,primary_binding_hash,token_hash,initiating_session_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '30 minutes') RETURNING *",
          [requestId, a.id, a.email, newEmail, a.email_revision, a.credential_revision, digest(proof.binding), digest(token), id(session.session_id)],
        )).rows[0];
        await c.query("INSERT INTO account_email_change_mail(id,account_id,request_id,token) VALUES($1,$2,$3,$4)", [uuid(), a.id, requestId, token]);
        const result = metadata(row);
        await remember(c, a, cmd, result);
        await audit(c, a, r, "AccountEmailChangeRequested", requestId);
        return result;
      });
      reply.code(202);
      return core.envelope(r, result);
    });
    app.get(base, (r) => own(r, async (c, a) => {
      if (Object.keys((r.query ?? {}) as object).length) fail(400, "INVALID_REQUEST");
      const rows = (await c.query("SELECT r.*,r.expires_at>clock_timestamp() AS proof_live,EXISTS(SELECT 1 FROM sessions s WHERE s.id=r.initiating_session_id AND s.account_id=r.account_id AND s.expires_at>clock_timestamp()) AS initiating_session_live FROM account_email_change_requests r WHERE r.account_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 20 FOR UPDATE OF r", [a.id])).rows;
      const items = [];
      for (const row of rows) items.push(metadata(await expire(c, a, row)));
      return core.envelope(r, { items });
    }));
    app.get(base + "/:requestId", (r) => own(r, async (c, a) => {
      const row = await requestRow(c, a, id((r.params as any).requestId));
      return core.envelope(r, metadata(await expire(c, a, row)));
    }));
    app.post(base + "/:requestId/revoke", async (r) => {
      body(r, []);
      const requestId = id((r.params as any).requestId), cmd = command(r);
      await budget(r, "REVOKE");
      return own(r, async (c, a) => {
        const row = await requestRow(c, a, requestId), cached = await prior(c, a, cmd);
        if (cached) return core.envelope(r, cached);
        version(r, a.version);
        if (row.state !== "PENDING_PROOF") fail(409, "EMAIL_CHANGE_INVALID");
        await c.query("UPDATE account_email_change_requests SET state='REVOKED' WHERE id=$1", [requestId]);
        await cancelMail(c, a.id, requestId);
        const result = metadata({ ...row, state: "REVOKED" });
        await remember(c, a, cmd, result);
        await audit(c, a, r, "AccountEmailChangeRevoked", requestId);
        return core.envelope(r, result);
      });
    });
    app.post(base + "/:requestId/complete", async (r, reply) => {
      const b = body(r, ["mailboxToken", "currentPassword", "totpCode"]),
        requestId = id((r.params as any).requestId), cmd = command(r);
      // Malformed values count as invalid proof attempts too, without storing them.
      const tokenHash = typeof b.mailboxToken === "string" && b.mailboxToken.length <= 200 ? digest(b.mailboxToken) : "";
      await budget(r, "COMPLETE");
      let fresh: { token: string; csrf: string } | undefined;
      const result = await own(r, async (c, a, session) => {
        await c.query("SAVEPOINT email_reauthentication");
        const proof = await core.reauthenticateOwnAccount(c, a, session, b);
        const row = await requestRow(c, a, requestId), cached = await prior(c, a, cmd);
        if (cached) {
          if (row.state !== "COMPLETED" || row.new_email !== a.email ||
            !row.initiating_session_id || !row.completion_session_id || row.completion_session_id !== session.session_id ||
            BigInt(a.email_revision) !== BigInt(row.email_revision) + 1n ||
            !sameRevision(a.credential_revision, row.credential_revision) ||
            digest(proof.binding) !== row.primary_binding_hash || tokenHash !== row.token_hash)
            fail(409, "EMAIL_CHANGE_INVALID");
          return { data: cached };
        }
        version(r, a.version);
        if (!pending(row, a, proof) || row.initiating_session_id !== session.session_id) fail(409, "EMAIL_CHANGE_INVALID");
        if (tokenHash !== row.token_hash) {
          // Preserve only the failed-proof counter. No MFA/session changes survive.
          await c.query("ROLLBACK TO SAVEPOINT email_reauthentication");
          const failed = (await c.query("UPDATE account_email_change_requests SET failed_attempts=failed_attempts+1,state=CASE WHEN failed_attempts+1>=5 THEN 'LOCKED' ELSE state END WHERE id=$1 RETURNING *", [row.id])).rows[0];
          if (failed.state === "LOCKED") await cancelMail(c, a.id, row.id);
          return { failure: new Failure(401, "EMAIL_CHANGE_PROOF_INVALID") };
        }
        if ((await c.query("SELECT 1 FROM accounts WHERE email=$1 AND id<>$2", [row.new_email, a.id])).rowCount)
          fail(409, "EMAIL_CHANGE_UNAVAILABLE");
        let updated;
        try {
          updated = (await c.query("UPDATE accounts SET email=$2,email_verified_at=clock_timestamp(),email_revision=email_revision+1,version=version+1 WHERE id=$1 RETURNING *", [a.id, row.new_email])).rows[0];
        } catch (error: any) {
          if (error.code === "23505") fail(409, "EMAIL_CHANGE_UNAVAILABLE");
          throw error;
        }
        await core.invalidateAccountEmailProofs(c, a.id, Number(a.email_revision));
        await c.query("UPDATE account_email_change_requests SET state=CASE WHEN id=$2 THEN 'COMPLETED' ELSE 'REPLACED' END,completed_at=CASE WHEN id=$2 THEN clock_timestamp() ELSE NULL END WHERE account_id=$1 AND state='PENDING_PROOF'", [a.id, row.id]);
        await cancelMail(c, a.id);
        await c.query("DELETE FROM sessions WHERE account_id=$1", [a.id]);
        fresh = await createSessionRecord(c, a.id, proof.provenance);
        const replacement = (await c.query("SELECT id FROM sessions WHERE account_id=$1 AND token_hash=$2", [a.id, digest(fresh.token)])).rows[0];
        if (!replacement) fail(503, "ACCOUNT_SECURITY_UNAVAILABLE");
        await c.query("UPDATE account_email_change_requests SET completion_session_id=$2 WHERE id=$1", [row.id, replacement.id]);
        if (proof.mfa)
          await c.query("UPDATE sessions SET mfa_verified_at=$3,mfa_factor_revision=$4 WHERE account_id=$1 AND token_hash=$2", [a.id, digest(fresh.token), proof.mfa.verifiedAt, proof.mfa.factorRevision]);
        const data = { ...metadata({ ...row, state: "COMPLETED" }), account: safeAccount(updated) };
        await remember(c, a, cmd, data);
        await audit(c, a, r, "AccountEmailChanged", row.id);
        return { data };
      });
      if (result.failure) throw result.failure;
      const response = core.envelope(r, result.data, null, result.data!.account.version);
      if (fresh) {
        reply.setCookie("orgmap_session", fresh.token, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", maxAge: 604800 });
        // Transient response field: never stored in account_commands or replayed.
        (response.data as any).csrfToken = fresh.csrf;
      }
      return response;
    });
  }

  /** At-least-once SMTP; preparation and fenced finalization surround external I/O. */
  async function deliverAccountEmailChangeMail(sender: (mail: LocalMail) => Promise<void> = sendLocalMail) {
    const jobs = await transaction(async (c) => {
      // Expired/exhausted payloads are destroyed even when no retry is due.
      await c.query("UPDATE account_email_change_mail m SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE m.state IN ('PENDING','FAILED','PROCESSING') AND (m.state<>'PROCESSING' OR m.lease_until<clock_timestamp()) AND (m.attempts>=8 OR EXISTS(SELECT 1 FROM account_email_change_requests r JOIN accounts a ON a.id=r.account_id WHERE r.id=m.request_id AND (r.state<>'PENDING_PROOF' OR r.expires_at<=clock_timestamp() OR r.failed_attempts>=5 OR a.email_revision<>r.email_revision OR a.credential_revision<>r.credential_revision OR a.email<>r.old_email OR NOT EXISTS(SELECT 1 FROM sessions s WHERE s.id=r.initiating_session_id AND s.account_id=r.account_id AND s.expires_at>clock_timestamp()))))");
      return (await c.query(
        "UPDATE account_email_change_mail SET state='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',attempts=attempts+1 WHERE id IN (SELECT id FROM account_email_change_mail WHERE state IN ('PENDING','FAILED','PROCESSING') AND attempts<8 AND next_attempt_at<=clock_timestamp() AND (state<>'PROCESSING' OR lease_until<clock_timestamp()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING id,account_id,request_id,lease_token",
      )).rows;
    });
    let delivered = 0;
    for (const job of jobs) {
      async function validate(c: PoolClient) {
        // Preserve the same Account -> intent -> delivery ordering as commands.
        const a = (await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [job.account_id])).rows[0];
        const request = (await c.query("SELECT r.*,r.expires_at>clock_timestamp() AS proof_live,EXISTS(SELECT 1 FROM sessions s WHERE s.id=r.initiating_session_id AND s.account_id=r.account_id AND s.expires_at>clock_timestamp()) AS initiating_session_live FROM account_email_change_requests r WHERE r.account_id=$1 AND r.id=$2 FOR UPDATE OF r", [job.account_id, job.request_id])).rows[0];
        const mail = (await c.query("SELECT * FROM account_email_change_mail WHERE id=$1 AND lease_token=$2 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE", [job.id, job.lease_token])).rows[0];
        return { mail, request, valid: !!a && !!request && pending(request, a) && !!mail?.token && digest(mail.token) === request.token_hash };
      }
      const mail = await transaction(async (c) => {
        const value = await validate(c);
        if (!value.valid) {
          if (value.mail) await c.query("UPDATE account_email_change_mail SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2", [job.id, job.lease_token]);
          return undefined;
        }
        return { id: job.id, to: value.request.new_email, subject: "OrgMap local email change", text: "Email change token (expires in 30 minutes):\n" + value.mail.token };
      });
      if (!mail) continue;
      let sent = false;
      try { await sender(mail); sent = true; } catch { /* Only a generic error is durable. */ }
      const accepted = await transaction(async (c) => {
        const value = await validate(c);
        if (!value.mail) return false;
        const state = !value.valid || (!sent && value.mail.attempts >= 8) ? "CANCELLED" : sent ? "DELIVERED" : "FAILED";
        await c.query("UPDATE account_email_change_mail SET state=$3,token=CASE WHEN $3 IN ('DELIVERED','CANCELLED') THEN NULL ELSE token END,lease_token=NULL,lease_until=NULL,last_error=$4,next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(3600,5*power(2,LEAST(attempts,10)))::integer) WHERE id=$1 AND lease_token=$2", [job.id, job.lease_token, state, state === "FAILED" ? "EMAIL_CHANGE_DELIVERY_FAILED" : null]);
        return state === "DELIVERED";
      });
      if (accepted) delivered++;
    }
    return delivered;
  }
  return { registerAccountEmailRoutes, deliverAccountEmailChangeMail };
}

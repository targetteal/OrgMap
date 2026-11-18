import { authorizeOrganizationEffect, recordOrganizationEffectOutcome } from "./organization-effects.js";
import { SmtpDeliveryError } from "./smtp.js";
import { lockActiveOrganization } from "./organization-lifecycle.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { assertManagedWriter } from './managed-writer.js';
import type { Ctx, TenantOptions } from "./runtime.js";
import type { AdmissionPolicy, OrgPolicyRead } from "./admission-contract.js";
import { transaction } from "./db.js";
import {
  body,
  camel,
  commandHash,
  digest,
  event,
  fail,
  Failure,
  id,
  key,
  secret,
  text,
  uuid,
  version,
} from "./core.js";
import { sendLocalMail, type LocalMail } from "./smtp.js";

type Source = "PUBLIC_JOIN" | "INVITATION_LINK";
type Dependencies = {
  auth(r: FastifyRequest, c?: PoolClient): Promise<any>;
  envelope(
    r: FastifyRequest,
    data: any,
    org?: any,
    rv?: number | null,
    owner?: boolean,
  ): any;
  tenant(
    r: FastifyRequest,
    options: TenantOptions,
    fn: (ctx: Ctx) => Promise<any>,
  ): Promise<any>;
  changed(
    ctx: Ctx,
    r: FastifyRequest,
    resourceId: string,
    action: string,
  ): Promise<void>;
  resolveAdmissionPolicy(input: OrgPolicyRead): Promise<AdmissionPolicy>;
  assertPublicAdmission(
    policy: AdmissionPolicy,
    email: string,
    source: Source,
  ): void | Promise<void>;
  isAdmissionMailConfigured(): boolean;
};
const scope = (c: PoolClient, org: string) =>
  c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
const canonicalEmail = (email: string) => email.trim().toLowerCase();
const now = async (c: PoolClient): Promise<Date> =>
  (await c.query("SELECT clock_timestamp() AS at")).rows[0].at;
const invalid = () => fail(404, "ADMISSION_INVALID");

/** Public admission has its own Account-session UoW. It never fabricates Ctx.member. */
export function createPublicAdmissionServices(deps: Dependencies) {
  let registered = false;
  const attempts = new Map<string, { count: number; until: number }>();
  function throttle(r: FastifyRequest) {
    const at = Date.now();
    for (const [k, v] of attempts) if (v.until <= at) attempts.delete(k);
    const old = attempts.get(r.ip);
    if ((old?.count ?? 0) >= 30 || (!old && attempts.size >= 10000))
      fail(429, "RATE_LIMITED");
    attempts.set(r.ip, {
      count: (old?.count ?? 0) + 1,
      until: old?.until ?? at + 60000,
    });
  }
  async function publicUow<T>(
    r: FastifyRequest,
    fn: (c: PoolClient, org: any, account: any) => Promise<T>,
  ) {
    const initial = await deps.auth(r);
    const orgId = id((r.params as any).organizationId);
    return transaction(async (c) => {
      await scope(c, orgId);
      const org = await lockActiveOrganization(c, orgId);
      // This is the same org -> Account -> session order as core.tenant.
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        initial.id,
      ]);
      const account = await deps.auth(r, c);
      if (account.id !== initial.id) invalid();
      return fn(c, org, account);
    });
  }
  async function policy(
    c: PoolClient,
    org: string,
    email: string,
    source: Source,
  ) {
    const value = await deps.resolveAdmissionPolicy({ c, organizationId: org });
    await deps.assertPublicAdmission(value, email, source);
    if (source === "INVITATION_LINK" && !value.invitationLinkEnabled) invalid();
    return value;
  }
  async function link(
    c: PoolClient,
    org: string,
    linkId?: string,
    hash?: string,
    accepted = false,
  ) {
    const row = (
      await c.query(
        "SELECT l.*,m.status AS actor_status,m.org_role AS actor_role,m.member_type AS actor_type FROM admission_links l JOIN members m ON m.organization_id=l.organization_id AND m.id=l.created_by_member_id WHERE l.organization_id=$1 AND " +
          (linkId ? "l.id=$2" : "l.token_hash=$2") +
          " FOR UPDATE OF l",
        [org, linkId ?? hash],
      )
    ).rows[0];
    if (
      !row ||
      row.revoked_at ||
      new Date(row.expires_at) <= (await now(c)) ||
      row.actor_status !== "ACTIVE" ||
      row.actor_role !== "OWNER" ||
      row.actor_type !== "MEMBER" ||
      (!accepted && row.acceptance_count >= row.max_acceptances)
    )
      invalid();
    return row;
  }
  async function hasAcceptedLink(
    c: PoolClient,
    org: string,
    account: string,
    linkId?: string,
    hash?: string,
  ) {
    return !!(
      await c.query(
        "SELECT 1 FROM admission_requests q JOIN admission_links l ON l.organization_id=q.organization_id AND l.id=q.link_id WHERE q.organization_id=$1 AND q.account_id=$2 AND q.completed_at IS NOT NULL AND " +
          (linkId ? "l.id=$3" : "l.token_hash=$3") +
          " LIMIT 1",
        [org, account, linkId ?? hash],
      )
    ).rowCount;
  }
  async function membership(c: PoolClient, org: string, account: string) {
    const row = (
      await c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 FOR UPDATE",
        [org, account],
      )
    ).rows[0];
    if (row?.status === "SUSPENDED") fail(403, "MEMBERSHIP_SUSPENDED");
    if (row && row.member_type !== "MEMBER") fail(409, "TYPE_CHANGE_REQUIRED");
    return row;
  }
  async function prior(
    c: PoolClient,
    org: string,
    account: string,
    operation: string,
    r: FastifyRequest,
  ) {
    const row = (
      await c.query(
        "SELECT * FROM command_results WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4",
        [org, account, operation, key(r)],
      )
    ).rows[0];
    if (row && row.hash !== commandHash(r)) fail(409, "IDEMPOTENCY_CONFLICT");
    return row?.result;
  }
  async function save(
    c: PoolClient,
    org: string,
    account: string,
    operation: string,
    r: FastifyRequest,
    result: any,
  ) {
    await c.query("INSERT INTO command_results VALUES($1,$2,$3,$4,$5,$6)", [
      org,
      account,
      operation,
      key(r),
      commandHash(r),
      result,
    ]);
  }
  async function start(r: FastifyRequest, source: Source) {
    throttle(r);
    const b = body(r, source === "PUBLIC_JOIN" ? [] : ["linkToken"]);
    const linkHash =
      source === "INVITATION_LINK"
        ? digest(text(b.linkToken, 1000))
        : undefined;
    key(r);
    return publicUow(r, async (c, org, account) => {
      const email = canonicalEmail(account.email),
        p = await policy(c, org.id, email, source);
      const acceptedLink =
        source === "INVITATION_LINK" &&
        (await hasAcceptedLink(c, org.id, account.id, undefined, linkHash));
      const l =
        source === "INVITATION_LINK"
          ? await link(c, org.id, undefined, linkHash, acceptedLink)
          : undefined;
      await membership(c, org.id, account.id);
      const operation = "admission:start:" + source + ":" + org.id;
      const cached = await prior(c, org.id, account.id, operation, r);
      if (cached) {
        const old = (
          await c.query(
            "SELECT policy_revision,email,email_revision,expires_at FROM admission_requests WHERE organization_id=$1 AND id=$2 AND account_id=$3",
            [org.id, cached.requestId, account.id],
          )
        ).rows[0];
        if (
          !old ||
          old.email !== email ||
          String(old.email_revision) !== String(account.email_revision) ||
          new Date(old.expires_at) <= (await now(c))
        )
          invalid();
        if (old.policy_revision !== p.revision) fail(409, "POLICY_CHANGED");
        return deps.envelope(r, cached, org);
      }
      const count = (
        await c.query(
          "SELECT count(*)::int AS n FROM admission_requests WHERE organization_id=$1 AND account_id=$2 AND created_at>clock_timestamp()-interval '15 minutes'",
          [org.id, account.id],
        )
      ).rows[0].n;
      if (count >= 5) fail(429, "RATE_LIMITED");
      const requestId = uuid(),
        raw = secret();
      await c.query(
        "INSERT INTO admission_requests(organization_id,id,account_id,email,source,link_id,policy_revision,token_hash,email_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          org.id,
          requestId,
          account.id,
          email,
          source,
          l?.id ?? null,
          p.revision,
          digest(raw),
          account.email_revision,
        ],
      );
      await c.query(
        "INSERT INTO admission_mail(organization_id,id,request_id,token) VALUES($1,$2,$3,$4)",
        [org.id, uuid(), requestId, raw],
      );
      await event(c, org.id, account.id, requestId, "AdmissionRequested", r.id);
      const result = { requestId, state: "PENDING_PROOF" };
      await save(c, org.id, account.id, operation, r, result);
      return deps.envelope(r, result, org);
    });
  }
  async function complete(r: FastifyRequest) {
    throttle(r);
    const b = body(r, ["mailboxToken"]),
      mailboxToken = text(b.mailboxToken, 1000);
    const requestId = id((r.params as any).requestId);
    key(r);
    const output = await publicUow(r, async (c, org, account) => {
      const row = (
        await c.query(
          "SELECT * FROM admission_requests WHERE organization_id=$1 AND id=$2 AND account_id=$3 FOR UPDATE",
          [org.id, requestId, account.id],
        )
      ).rows[0];
      if (!row || row.email !== canonicalEmail(account.email) ||
          String(row.email_revision) !== String(account.email_revision)) invalid();
      const p = await policy(c, org.id, row.email, row.source);
      if (p.revision !== row.policy_revision) fail(409, "POLICY_CHANGED");
      const acceptedLink =
        row.source === "INVITATION_LINK" &&
        (await hasAcceptedLink(c, org.id, account.id, row.link_id));
      const l =
        row.source === "INVITATION_LINK"
          ? await link(c, org.id, row.link_id, undefined, acceptedLink)
          : undefined;
      if (new Date(row.expires_at) <= (await now(c)) || row.attempts >= 5)
        invalid();
      if (row.token_hash !== digest(mailboxToken)) {
        await c.query(
          "UPDATE admission_requests SET attempts=attempts+1 WHERE organization_id=$1 AND id=$2",
          [org.id, row.id],
        );
        // Returning the failure commits the attempt; throwing here would roll it back.
        return { failure: true as const };
      }
      let member = await membership(c, org.id, account.id);
      const operation = "admission:complete:" + org.id + ":" + row.id;
      const cached = await prior(c, org.id, account.id, operation, r);
      if (cached) return { result: cached, org, status: 200 };
      if (row.completed_at) fail(409, "ADMISSION_ALREADY_COMPLETED");
      const created = !member;
      if (!member) {
        member = (
          await c.query(
            "INSERT INTO members(organization_id,id,account_id,org_role,member_type) VALUES($1,$2,$3,'MEMBER','MEMBER') RETURNING *",
            [org.id, uuid(), account.id],
          )
        ).rows[0];
        await c.query(
          "UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1",
          [org.id],
        );
        await event(
          c,
          org.id,
          account.id,
          member.id,
          "PublicAdmissionAccepted",
          r.id,
        );
      }
      await c.query(
        "UPDATE admission_requests SET completed_at=clock_timestamp(),member_id=$3 WHERE organization_id=$1 AND id=$2",
        [org.id, row.id, member.id],
      );
      if (l && !acceptedLink)
        await c.query(
          "UPDATE admission_links SET acceptance_count=acceptance_count+1 WHERE organization_id=$1 AND id=$2",
          [org.id, l.id],
        );
      await c.query(
        "UPDATE admission_mail SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND request_id=$2 AND state<>'DELIVERED'",
        [org.id, row.id],
      );
      const result = {
        state: created ? "JOINED" : "ALREADY_MEMBER",
        membership: camel(member),
      };
      await save(c, org.id, account.id, operation, r, result);
      const current = (
        await c.query("SELECT * FROM organizations WHERE id=$1", [org.id])
      ).rows[0];
      return { result, org: current, status: created ? 201 : 200 };
    });
    if (output.failure) invalid();
    return output as { result: any; org: any; status: number };
  }
  async function metadata(c: PoolClient, org: string) {
    const revision =
      (
        await c.query(
          "SELECT version FROM admission_link_state WHERE organization_id=$1",
          [org],
        )
      ).rows[0]?.version ?? 0;
    const rows = (
      await c.query(
        "SELECT id,version,created_at,expires_at,max_acceptances,acceptance_count,revoked_at FROM admission_links WHERE organization_id=$1 ORDER BY created_at DESC,id LIMIT 1",
        [org],
      )
    ).rows;
    return {
      version: revision,
      link: rows[0] ? camel(rows[0]) : null,
      secretUnavailable: true,
    };
  }
  const owner = (ctx: Ctx) => {
    if (
      ctx.member.org_role !== "OWNER" ||
      ctx.member.member_type !== "MEMBER" ||
      ctx.member.status !== "ACTIVE"
    )
      fail(403, "ACTION_DENIED");
  };
  async function revokeAdmissionLinks(ctx: Ctx) {
    if (ctx.mode !== "authorization_write") fail(403, "ACTION_DENIED");
    const rows = (
      await ctx.c.query(
        "UPDATE admission_links SET revoked_at=clock_timestamp() WHERE organization_id=$1 AND revoked_at IS NULL RETURNING id",
        [ctx.org.id],
      )
    ).rows;
    if (rows.length) {
      await ctx.c.query(
        "INSERT INTO admission_link_state(organization_id,version) VALUES($1,1) ON CONFLICT(organization_id) DO UPDATE SET version=admission_link_state.version+1",
        [ctx.org.id],
      );
      await ctx.c.query(
        "UPDATE admission_mail m SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL FROM admission_requests r WHERE m.organization_id=$1 AND r.organization_id=m.organization_id AND r.id=m.request_id AND r.source='INVITATION_LINK' AND m.state<>'DELIVERED'",
        [ctx.org.id],
      );
    }
    return rows.length;
  }
  async function registerPublicAdmissionRoutes(app: FastifyInstance) {
    if (registered) throw Error("PUBLIC_ADMISSION_ROUTES_ALREADY_REGISTERED");
    registered = true;
    const base = "/api/v1/organizations/:organizationId";
    app.post(base + "/admission/requests", async (r, reply) => {
      const value = await start(r, "PUBLIC_JOIN");
      return reply.code(202).send(value);
    });
    app.post(base + "/admission/link-requests", async (r, reply) => {
      const value = await start(r, "INVITATION_LINK");
      return reply.code(202).send(value);
    });
    app.post(
      base + "/admission/requests/:requestId/complete",
      async (r, reply) => {
        const value = await complete(r);
        return reply
          .code(value.status)
          .send(
            deps.envelope(
              r,
              value.result,
              value.org,
              value.result.membership.version,
            ),
          );
      },
    );
    app.get(base + "/invitation-links", (r) =>
      deps.tenant(
        r,
        {
          mode: "read",
          authorize: (ctx) => {
            owner(ctx);
            return true;
          },
        },
        async (ctx) => metadata(ctx.c, ctx.org.id),
      ),
    );
    app.post(base + "/invitation-links", async (r) => {
      body(r, []);
      let freshSecret: string | undefined;
      const value = await deps.tenant(
        r,
        {
          mode: "authorization_write",
          authorize: async (ctx) => {
            owner(ctx);
            const p = await deps.resolveAdmissionPolicy({
              c: ctx.c,
              organizationId: ctx.org.id,
            });
            if (!p.invitationLinkEnabled || p.registrationMode === "DISABLED")
              fail(403, "ADMISSION_LINK_DISABLED");
            return true;
          },
        },
        async (ctx) => {
          const current = await metadata(ctx.c, ctx.org.id);
          version(r, current.version);
          await revokeAdmissionLinks(ctx);
          // Rotation advances one aggregate revision, independent of the revocation helper.
          const nextVersion = current.version + 1;
          await ctx.c.query(
            "INSERT INTO admission_link_state(organization_id,version) VALUES($1,$2) ON CONFLICT(organization_id) DO UPDATE SET version=$2",
            [ctx.org.id, nextVersion],
          );
          freshSecret = secret();
          const linkId = uuid();
          await ctx.c.query(
            "INSERT INTO admission_links(organization_id,id,token_hash,version,created_by_member_id) VALUES($1,$2,$3,$4,$5)",
            [
              ctx.org.id,
              linkId,
              digest(freshSecret),
              nextVersion,
              ctx.member.id,
            ],
          );
          await deps.changed(ctx, r, linkId, "InvitationLinkIssued");
          return metadata(ctx.c, ctx.org.id);
        },
      );
      // Only a newly committed issuance returns the secret. The tenant ledger contains metadata.
      return freshSecret
        ? {
            ...value,
            data: {
              ...value.data,
              linkToken: freshSecret,
              secretUnavailable: false,
            },
          }
        : value;
    });
    app.post(base + "/invitation-links/:linkId/revoke", (r) => {
      body(r, []);
      const linkId = id((r.params as any).linkId);
      return deps.tenant(
        r,
        {
          mode: "authorization_write",
          authorize: (ctx) => {
            owner(ctx);
            return true;
          },
        },
        async (ctx) => {
          const current = await metadata(ctx.c, ctx.org.id);
          version(r, current.version);
          const row = (
            await ctx.c.query(
              "SELECT id FROM admission_links WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, linkId],
            )
          ).rows[0];
          if (!row) fail(404, "RESOURCE_NOT_FOUND");
          await ctx.c.query(
            "UPDATE admission_links SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, linkId],
          );
          await ctx.c.query(
            "INSERT INTO admission_link_state(organization_id,version) VALUES($1,$2) ON CONFLICT(organization_id) DO UPDATE SET version=$2",
            [ctx.org.id, current.version + 1],
          );
          await ctx.c.query(
            "UPDATE admission_mail m SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL FROM admission_requests q WHERE m.organization_id=$1 AND q.organization_id=m.organization_id AND q.id=m.request_id AND q.link_id=$2 AND m.state<>'DELIVERED'",
            [ctx.org.id, linkId],
          );
          await deps.changed(ctx, r, linkId, "InvitationLinkRevoked");
          return metadata(ctx.c, ctx.org.id);
        },
      );
    });
  }
  async function validatePublicAdmissionReady(ctx: Ctx) {
    if (!registered || !deps.isAdmissionMailConfigured())
      fail(503, "POLICY_CONSUMER_UNAVAILABLE");
    const row = (
      await ctx.c.query(
        "SELECT to_regclass('public.admission_requests') IS NOT NULL AND to_regclass('public.admission_links') IS NOT NULL AND to_regclass('public.admission_mail') IS NOT NULL AND to_regclass('public.admission_link_state') IS NOT NULL AND to_regprocedure('iam_mail_admission_ready()') IS NOT NULL AS ready",
      )
    ).rows[0];
    if (!row.ready) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
    if (
      !(await ctx.c.query("SELECT iam_mail_admission_ready() AS ready")).rows[0]
        .ready
    )
      fail(503, "POLICY_CONSUMER_UNAVAILABLE");
  }
  async function deliverAdmissionMail(
    organizationId: string,
    sender: (mail: LocalMail) => Promise<void> = sendLocalMail,
  ) {
    const org = id(organizationId);
    const jobs = await transaction(async (c) => {
      await assertManagedWriter(c);
      await scope(c, org);
      await lockActiveOrganization(c, org);
      return (
        await c.query(
          "UPDATE admission_mail SET state='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',attempts=attempts+1 WHERE organization_id=$1 AND id IN (SELECT id FROM admission_mail WHERE organization_id=$1 AND state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (state<>'PROCESSING' OR lease_until<clock_timestamp()) FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING id,lease_token",
          [org],
        )
      ).rows;
    });
    let delivered = 0;
    for (const job of jobs) {
      const message = await transaction(async (c) => {
        await scope(c, org);
        await lockActiveOrganization(c, org);
        const reference = (
          await c.query(
            "SELECT q.account_id FROM admission_mail m JOIN admission_requests q ON q.organization_id=m.organization_id AND q.id=m.request_id WHERE m.organization_id=$1 AND m.id=$2",
            [org, job.id],
          )
        ).rows[0];
        if (!reference) return;
        const account = (
          await c.query("SELECT email,email_revision FROM accounts WHERE id=$1 FOR UPDATE", [
            reference.account_id,
          ])
        ).rows[0];
        const m = (
          await c.query(
            "SELECT * FROM admission_mail WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE",
            [org, job.id, job.lease_token],
          )
        ).rows[0];
        if (!m) return;
        const row = (
          await c.query(
            "SELECT * FROM admission_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE",
            [org, m.request_id],
          )
        ).rows[0];
        let valid = !!(
          row &&
          !row.completed_at &&
          row.attempts < 5 &&
          m.token &&
          digest(m.token) === row.token_hash &&
          new Date(row.expires_at) > (await now(c))
        );
        if (valid)
          valid = !!account && canonicalEmail(account.email) === row.email &&
            String(account.email_revision) === String(row.email_revision);
        if (valid)
          try {
            const p = await policy(c, org, row.email, row.source);
            valid = p.revision === row.policy_revision;
            if (valid && row.source === "INVITATION_LINK")
              await link(c, org, row.link_id);
            if (valid) await membership(c, org, row.account_id);
          } catch (error) {
            if (!(error instanceof Failure)) throw error;
            valid = false;
          }
        if (!valid) {
          await c.query(
            "UPDATE admission_mail SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3",
            [org, m.id, job.lease_token],
          );
          return;
        }
        const prior = (await c.query("SELECT id,state,lifecycle_fence::text AS fence,effect_token FROM organization_effects WHERE organization_id=$1 AND owner='IAM' AND effect_key=$2 AND state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN')", [org,"admission:"+m.id])).rows[0];
        if (prior) {
          if (prior.state === "AUTHORIZED") await recordOrganizationEffectOutcome(c, {organizationId:org,id:prior.id,fence:prior.fence,token:prior.effect_token}, "OUTCOME_UNKNOWN");
          await c.query("UPDATE admission_mail SET state='OUTCOME_UNKNOWN',last_error='EFFECT_OUTCOME_UNRESOLVED',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3", [org,m.id,job.lease_token]);
          return;
        }
        const authorization = await authorizeOrganizationEffect(c, { organizationId:org, owner:"IAM", effectKey:"admission:"+m.id, sourceLeaseToken:job.lease_token,
          validateSourceLease:async(client,token)=>!!(await client.query("SELECT 1 FROM admission_mail WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE", [org,m.id,token])).rowCount });
        return { authorization, message: {
          id: m.id,
          to: row.email,
          subject: "OrgMap organization admission verification",
          text:
            "Mailbox verification token for organization " +
            org +
            " and request " +
            row.id +
            " (expires in 30 minutes):\n" +
            m.token,
        }};
      });
      if (!message) continue;
      let disposition: "CONFIRMED" | "NOT_SENT" | "REJECTED" | "OUTCOME_UNKNOWN" = "OUTCOME_UNKNOWN";
      try { await sender(message.message); disposition = "CONFIRMED"; }
      catch (error) { disposition = error instanceof SmtpDeliveryError ? error.disposition : "OUTCOME_UNKNOWN"; }
      const recorded = await transaction(async (c) => {
        await scope(c, org);
        return recordOrganizationEffectOutcome(c,message.authorization,disposition);
      });
      if (recorded.cutoverOccurred) continue;
      const success = recorded.recorded && disposition === "CONFIRMED";
      const unknown = !recorded.recorded || disposition === "OUTCOME_UNKNOWN";
      const updated = await transaction(async (c) => {
        await scope(c, org);
        await lockActiveOrganization(c, org);
        return (
          await c.query(
            "UPDATE admission_mail SET state=$4,token=CASE WHEN $4='DELIVERED' THEN NULL ELSE token END,lease_token=NULL,lease_until=NULL,last_error=$5,next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(3600,5*power(2,LEAST(attempts,10)))::integer) WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() RETURNING id",
            [
              org,
              job.id,
              job.lease_token,
              success ? "DELIVERED" : unknown ? "OUTCOME_UNKNOWN" : "FAILED",
              success ? null : unknown ? "EFFECT_OUTCOME_UNRESOLVED" : "SMTP_DELIVERY_FAILED",
            ],
          )
        ).rowCount;
      });
      if (success && updated) delivered++;
    }
    return delivered;
  }
  return {
    registerPublicAdmissionRoutes,
    revokeAdmissionLinks,
    deliverAdmissionMail,
    validatePublicAdmissionReady,
  };
}

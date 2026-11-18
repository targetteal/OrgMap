import { authorizeOrganizationEffect, recordOrganizationEffectOutcome } from "./organization-effects.js";
import { SmtpDeliveryError } from "./smtp.js";
import { lockActiveOrganization } from "./organization-lifecycle.js";
import { createSessionRecord } from "./sessions.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { transaction } from "./db.js";
import { assertManagedWriter } from './managed-writer.js';
import {
  body,
  camel,
  digest,
  event,
  fail,
  id,
  key,
  secret,
  text,
  uuid,
} from "./core.js";
import { verifyPassword } from "./password.js";
import { sendLocalMail, type LocalMail } from "./smtp.js";
import type { Ctx } from "./runtime.js";
import type {
  EnrollmentSource,
  EnrollmentProfile,
  EnrollmentProjection,
  ProvisionedEnrollmentAuthority,
  VerifiedEnrollmentFederation,
  SessionProvenance,
} from "./enrollment-contract.js";
const exact = (v: unknown, max = 1000) => {
  if (
    typeof v !== "string" ||
    !v.length ||
    [...v].length > max ||
    /[\x00-\x1f\x7f]/.test(v)
  )
    fail(400, "INVALID_REQUEST");
  return v as string;
};
const token = (v: unknown) => {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
    fail(401, "ENROLLMENT_INVALID");
  return v as string;
};
const source = (s: EnrollmentSource): EnrollmentSource => ({
  connectionId: id(s?.connectionId),
  externalId: exact(s?.externalId, 512),
});
function profile(p: EnrollmentProfile): EnrollmentProfile {
  if (
    p.requestedMemberType !== undefined &&
    !["MEMBER", "GUEST"].includes(p.requestedMemberType)
  )
    fail(400, "INVALID_REQUEST");
  const email = text(p?.email, 254).toLowerCase();
  if (
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
    !p.identity ||
    !Number.isInteger(p.identity.mappingRevision) ||
    p.identity.mappingRevision < 1
  )
    fail(400, "INVALID_REQUEST");
  return {
    email,
    userName: text(p.userName, 254),
    displayName: text(p.displayName ?? p.userName),
    requestedMemberType: p.requestedMemberType ?? "MEMBER",
    identity: {
      issuer: exact(p.identity.issuer, 2048),
      claim: exact(p.identity.claim, 200),
      value: exact(p.identity.value, 1000),
      mappingRevision: p.identity.mappingRevision,
    },
  };
}
const rowProfile = (r: any): EnrollmentProfile => ({
  email: r.email,
  userName: r.user_name,
  displayName: r.display_name,
  requestedMemberType: r.requested_member_type ?? "MEMBER",
  identity: {
    issuer: r.issuer,
    claim: r.claim_name,
    value: r.claim_value,
    mappingRevision: r.mapping_revision,
  },
});
const rowSource = (r: any): EnrollmentSource => ({
  connectionId: r.connection_id,
  externalId: r.external_id,
});
const projection = (r: any): EnrollmentProjection => ({
  enrollmentId: r.id,
  provisioningState: r.state,
  memberType: r.requested_member_type ?? "MEMBER",
  active: r.active,
  version: r.version,
});
async function clock(c: PoolClient) {
  return (await c.query("SELECT clock_timestamp() AS at")).rows[0].at as Date;
}
async function record(
  c: PoolClient,
  org: string,
  actor: string,
  rid: string,
  action: string,
  requestId: string,
) {
  await c.query(
    "UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1",
    [org],
  );
  await event(c, org, actor, rid, action, requestId);
}
const provenance = (session: any): SessionProvenance => ({
  amr: session.auth_amr ?? [],
  authTime: session.auth_time ? new Date(session.auth_time) : undefined,
  method: session.auth_method ?? "LEGACY",
  organizationId: session.auth_organization_id ?? undefined,
  connectionId: session.auth_connection_id ?? undefined,
  issuer: session.auth_issuer ?? undefined,
  subject: session.auth_subject ?? undefined,
  verifiedAt: session.auth_verified_at
    ? new Date(session.auth_verified_at)
    : undefined,
});
export function createEnrollmentServices(deps: {
  auth: (r: FastifyRequest, c?: PoolClient) => Promise<any>;
  assertTargetAccountLocked: (ctx: Ctx, accountId: string) => Promise<void>;
  assertScimAdmission: (
    ctx: { c: PoolClient; organizationId: string },
    source: EnrollmentSource & { mappingRevision: number },
    operation: "CREATE" | "REACTIVATE_SCIM",
  ) => Promise<void>;
  envelope: (
    r: FastifyRequest,
    data: any,
    org?: any,
    rv?: number | null,
    owner?: boolean,
  ) => any;
}) {
  let authority: ProvisionedEnrollmentAuthority | undefined;
  function registerProvisionedEnrollmentAuthority(
    value: ProvisionedEnrollmentAuthority,
  ) {
    if (authority) throw Error("Enrollment authority already registered");
    authority = value;
  }
  function provider() {
    if (!authority) fail(503, "ENROLLMENT_UNAVAILABLE");
    return authority!;
  }
  async function requireSource(c: PoolClient, r: any, reactivation = false) {
    if (
      !(await provider().revalidateSource(
        c,
        r.organization_id,
        rowSource(r),
        rowProfile(r),
      ))
    )
      fail(
        reactivation ? 403 : 401,
        reactivation
          ? "SCIM_REACTIVATION_REQUIRES_OWNER"
          : "ENROLLMENT_INVALID",
      );
  }
  function assertAdmission(
    c: PoolClient,
    organizationId: string,
    s: EnrollmentSource,
    mappingRevision: number,
    operation: "CREATE" | "REACTIVATE_SCIM",
  ) {
    return deps.assertScimAdmission(
      { c, organizationId },
      { ...s, mappingRevision },
      operation,
    );
  }
  function command(ctx: Ctx) {
    if (ctx.mode !== "authorization_write" || ctx.member.org_role !== "OWNER")
      fail(403, "ACTION_DENIED");
  }
  async function bySource(ctx: Ctx, value: EnrollmentSource) {
    const s = source(value);
    const r = (
      await ctx.c.query(
        "SELECT * FROM provisioned_enrollments WHERE organization_id=$1 AND connection_id=$2 AND external_id=$3 FOR UPDATE",
        [ctx.org.id, s.connectionId, s.externalId],
      )
    ).rows[0];
    if (!r) fail(404, "RESOURCE_NOT_FOUND");
    return r;
  }
  async function queued(c: PoolClient, r: any, raw: string) {
    await c.query(
      "INSERT INTO provisioned_enrollment_mail(organization_id,id,enrollment_id,enrollment_version,token) VALUES($1,$2,$3,$4,$5)",
      [r.organization_id, uuid(), r.id, r.version, raw],
    );
  }
  async function beginProvisionedEnrollment(
    ctx: Ctx,
    value: EnrollmentSource,
    input: EnrollmentProfile,
    active: boolean,
  ): Promise<EnrollmentProjection> {
    command(ctx);
    const s = source(value),
      p = profile(input);
    if (typeof active !== "boolean") fail(400, "INVALID_REQUEST");
    await provider().validateSource(ctx, s, p);
    await assertAdmission(
      ctx.c,
      ctx.org.id,
      s,
      p.identity.mappingRevision,
      "CREATE",
    );
    if (
      (
        await ctx.c.query(
          "SELECT 1 FROM provisioned_enrollments WHERE organization_id=$1 AND connection_id=$2 AND external_id=$3",
          [ctx.org.id, s.connectionId, s.externalId],
        )
      ).rowCount
    )
      fail(409, "ENROLLMENT_EXISTS");
    const raw = active ? secret() : null;
    const row = (
      await ctx.c.query(
        "INSERT INTO provisioned_enrollments(organization_id,id,connection_id,external_id,user_name,email,display_name,issuer,claim_name,claim_value,mapping_revision,active,state,mailbox_token_hash,mailbox_expires_at,created_by,requested_member_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $12 THEN clock_timestamp()+interval '30 minutes' ELSE NULL END,$15,$16) RETURNING *",
        [
          ctx.org.id,
          uuid(),
          s.connectionId,
          s.externalId,
          p.userName,
          p.email,
          p.displayName,
          p.identity.issuer,
          p.identity.claim,
          p.identity.value,
          p.identity.mappingRevision,
          active,
          active ? "PENDING_ENROLLMENT" : "CANCELLED",
          raw ? digest(raw) : null,
          ctx.account.id,
          p.requestedMemberType ?? "MEMBER",
        ],
      )
    ).rows[0];
    if (raw) await queued(ctx.c, row, raw);
    await record(
      ctx.c,
      ctx.org.id,
      ctx.account.id,
      row.id,
      "ProvisionedEnrollmentBegun",
      "provisioning-command",
    );
    return projection(row);
  }
  async function getProvisionedEnrollment(
    ctx: Ctx,
    value: EnrollmentSource,
  ): Promise<EnrollmentProjection> {
    return projection(await bySource(ctx, value));
  }
  async function setProvisionedAccess(
    ctx: Ctx,
    value: EnrollmentSource,
    active: boolean,
  ): Promise<EnrollmentProjection> {
    command(ctx);
    if (typeof active !== "boolean") fail(400, "INVALID_REQUEST");
    const row = await bySource(ctx, value);
    let member: any;
    if (row.member_id) {
      member = (
        await ctx.c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [ctx.org.id, row.member_id],
        )
      ).rows[0];
      if (!member) fail(409, "ENROLLMENT_STATE_CONFLICT");
    }
    if (active) {
      const reactivation = member?.status === "SUSPENDED";
      if (reactivation) {
        const origin = member.suspension_origin;
        if (
          origin?.type !== "SCIM" ||
          origin.connectionId !== row.connection_id ||
          origin.externalId !== row.external_id ||
          origin.mappingRevision !== row.mapping_revision
        )
          fail(403, "SCIM_REACTIVATION_REQUIRES_OWNER");
      }
      await requireSource(ctx.c, row, reactivation);
      if (reactivation || !member)
        await assertAdmission(
          ctx.c,
          ctx.org.id,
          rowSource(row),
          row.mapping_revision,
          reactivation ? "REACTIVATE_SCIM" : "CREATE",
        );
    }
    if (member) {
      if (
        !active &&
        member.org_role === "OWNER" &&
        !(
          await ctx.c.query(
            "SELECT 1 FROM members WHERE organization_id=$1 AND org_role='OWNER' AND status='ACTIVE' AND id<>$2",
            [ctx.org.id, member.id],
          )
        ).rowCount
      )
        fail(422, "LAST_OWNER_PROTECTED");
      if (!active && member.status === "ACTIVE")
        await deps.assertTargetAccountLocked(ctx, member.account_id);
      // Repeating deprovisioning must never turn a manual, unknown or foreign
      // suspension into an authority this SCIM source can later undo.
      if (member.status !== (active ? "ACTIVE" : "SUSPENDED"))
        await ctx.c.query(
          "UPDATE members SET status=$3,suspension_origin=$4,version=version+1 WHERE organization_id=$1 AND id=$2",
          [
            ctx.org.id,
            member.id,
            active ? "ACTIVE" : "SUSPENDED",
            active
              ? null
              : {
                  type: "SCIM",
                  connectionId: row.connection_id,
                  externalId: row.external_id,
                  mappingRevision: row.mapping_revision,
                },
          ],
        );
    }
    const raw = active && !row.account_id ? secret() : null;
    const next = (
      await ctx.c.query(
        "UPDATE provisioned_enrollments SET active=$3,state=$4,version=version+1,mailbox_token_hash=$5,mailbox_expires_at=CASE WHEN $5::text IS NOT NULL THEN clock_timestamp()+interval '30 minutes' ELSE NULL END,mailbox_verified_at=CASE WHEN account_id IS NULL THEN NULL ELSE mailbox_verified_at END,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 RETURNING *",
        [
          ctx.org.id,
          row.id,
          active,
          active
            ? row.account_id
              ? "ACTIVE"
              : "PENDING_ENROLLMENT"
            : row.account_id
              ? "SUSPENDED"
              : "CANCELLED",
          raw ? digest(raw) : null,
        ],
      )
    ).rows[0];
    await ctx.c.query(
      "UPDATE provisioned_enrollment_mail SET state='CANCELLED',token=NULL,lease_until=NULL WHERE organization_id=$1 AND enrollment_id=$2 AND state<>'DELIVERED'",
      [ctx.org.id, row.id],
    );
    await ctx.c.query(
      "UPDATE provisioned_enrollment_flows SET consumed_at=clock_timestamp() WHERE organization_id=$1 AND enrollment_id=$2 AND consumed_at IS NULL",
      [ctx.org.id, row.id],
    );
    await ctx.c.query(
      "DELETE FROM provisioned_enrollment_reauth WHERE organization_id=$1 AND enrollment_id=$2",
      [ctx.org.id, row.id],
    );
    if (raw) await queued(ctx.c, next, raw);
    await record(
      ctx.c,
      ctx.org.id,
      ctx.account.id,
      row.id,
      "ProvisionedAccessChanged",
      "provisioning-command",
    );
    return projection(next);
  }
  async function lockByHash(
    c: PoolClient,
    hash: string,
    kind: "MAILBOX" | "FLOW",
  ) {
    const lookup = (
      await c.query("SELECT * FROM provisioned_enrollment_lookup($1,$2)", [
        hash,
        kind,
      ])
    ).rows[0];
    if (!lookup) fail(401, "ENROLLMENT_INVALID");
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      lookup.organization_id,
    ]);
    const org = await lockActiveOrganization(c, lookup.organization_id);
    const row = (
      await c.query(
        "SELECT * FROM provisioned_enrollments WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [lookup.organization_id, lookup.enrollment_id],
      )
    ).rows[0];
    if (
      !row ||
      !row.active ||
      row.state !== "PENDING_ENROLLMENT" ||
      !row.mailbox_token_hash ||
      !row.mailbox_expires_at ||
      new Date(row.mailbox_expires_at) <= (await clock(c))
    )
      fail(401, "ENROLLMENT_INVALID");
    await requireSource(c, row);
    return { org, row, lookup };
  }
  async function verifyReauth(
    c: PoolClient,
    row: any,
    accountId: string,
    receiptHash: string | undefined,
  ) {
    if (!receiptHash) fail(409, "ACTIVATION_CONFIRMATION_REQUIRED");
    const receipt = (
      await c.query(
        "SELECT r.*,a.email_revision AS current_email_revision FROM provisioned_enrollment_reauth r JOIN sessions s ON s.id=r.session_id AND s.account_id=r.account_id JOIN accounts a ON a.id=r.account_id WHERE r.organization_id=$1 AND r.enrollment_id=$2 AND r.token_hash=$3 AND s.expires_at>clock_timestamp() FOR UPDATE OF r FOR SHARE OF s",
        [row.organization_id, row.id, receiptHash],
      )
    ).rows[0];
    if (
      !receipt ||
      receipt.used_at ||
      receipt.account_id !== accountId ||
      String(receipt.email_revision) !== String(receipt.current_email_revision) ||
      receipt.enrollment_version !== row.version ||
      new Date(receipt.expires_at) <= (await clock(c)) ||
      receipt.confirmed !== true
    )
      fail(409, "ACTIVATION_CONFIRMATION_REQUIRED");
    return receipt;
  }
  async function checkTenantAuthentication(ctx: Ctx, session = ctx.account) {
    if (ctx.principal) return;
    const policy = (await authority?.authenticationPolicy?.(ctx)) ?? {
      mode: "ANY",
      connectionIds: [],
    };
    if (policy.mode === "ANY") return;
    if (policy.mode !== "SSO_REQUIRED")
      fail(503, "AUTHENTICATION_POLICY_UNAVAILABLE");
    const p = provenance(session);
    if (
      p.method !== "FEDERATED" ||
      p.organizationId !== ctx.org.id ||
      !p.connectionId ||
      !policy.connectionIds.includes(p.connectionId) ||
      !p.subject ||
      !p.issuer ||
      !authority?.validateSessionProvenance ||
      !(await authority.validateSessionProvenance(ctx, p))
    )
      fail(403, "SSO_REQUIRED");
    const sources = (
      await ctx.c.query(
        "SELECT active,state FROM provisioned_enrollments WHERE organization_id=$1 AND connection_id=$2 AND account_id=$3 AND bound_subject=$4",
        [ctx.org.id, p.connectionId, ctx.account.id, p.subject],
      )
    ).rows;
    if (
      sources.length &&
      !sources.some((r) => r.active && r.state === "ACTIVE")
    )
      fail(403, "SSO_REQUIRED");
  }
  async function completeByHash(
    c: PoolClient,
    hash: string,
    opaqueFederation: unknown,
    receiptHash?: string,
    requestId = "enrollment-activation",
  ) {
    const { org, row } = await lockByHash(c, hash, "MAILBOX");
    const proof = await provider().verifyFederationProof(c, opaqueFederation);
    const now = await clock(c);
    if (
      !proof ||
      proof.organizationId !== row.organization_id ||
      proof.connectionId !== row.connection_id ||
      proof.issuer !== row.issuer ||
      typeof proof.subject !== "string" ||
      !proof.subject ||
      !(proof.verifiedAt instanceof Date) ||
      !Number.isFinite(+proof.verifiedAt) ||
      +proof.verifiedAt < +now - 300000 ||
      +proof.verifiedAt > +now + 30000
    )
      fail(401, "ENROLLMENT_IDENTITY_MISMATCH");
    const actual =
      row.claim_name === "sub" ? proof!.subject : proof!.claims[row.claim_name];
    if (typeof actual !== "string" || actual !== row.claim_value)
      fail(401, "ENROLLMENT_IDENTITY_MISMATCH");
    await requireSource(c, row);
    await assertAdmission(
      c,
      row.organization_id,
      rowSource(row),
      row.mapping_revision,
      "CREATE",
    );
    let account = (
        await c.query("SELECT * FROM accounts WHERE email=$1 FOR UPDATE", [
          row.email,
        ])
      ).rows[0],
      created = false,
      receipt: any;
    if (!account) {
      account = (
        await c.query(
          "INSERT INTO accounts(id,email,display_name,password_hash,password_enabled,email_verified_at) VALUES($1,$2,$3,$4,false,clock_timestamp()) ON CONFLICT(email) DO NOTHING RETURNING *",
          [uuid(), row.email, row.display_name, "!FEDERATED_ONLY:" + secret()],
        )
      ).rows[0];
      created = !!account;
      if (!account)
        account = (
          await c.query("SELECT * FROM accounts WHERE email=$1 FOR UPDATE", [
            row.email,
          ])
        ).rows[0];
    }
    if (!created) receipt = await verifyReauth(c, row, account.id, receiptHash);
    else if (receiptHash) fail(409, "ACTIVATION_CONFIRMATION_REQUIRED");
    let member = (
      await c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 FOR UPDATE",
        [row.organization_id, account.id],
      )
    ).rows[0];
    if (member?.status === "SUSPENDED") fail(403, "ACTION_DENIED");
    if (
      member &&
      (member.member_type ?? "MEMBER") !==
        (row.requested_member_type ?? "MEMBER")
    )
      fail(409, "TYPE_CHANGE_REQUIRED");
    if (!member)
      member = (
        await c.query(
          "INSERT INTO members(organization_id,id,account_id,org_role,status,member_type) VALUES($1,$2,$3,'MEMBER','ACTIVE',$4) RETURNING *",
          [
            row.organization_id,
            uuid(),
            account.id,
            row.requested_member_type ?? "MEMBER",
          ],
        )
      ).rows[0];
    await provider().bindFederatedIdentity(c, {
      organizationId: row.organization_id,
      connectionId: row.connection_id,
      accountId: account.id,
      issuer: proof!.issuer,
      subject: proof!.subject,
    });
    await c.query(
      "UPDATE accounts SET email_verified_at=COALESCE(email_verified_at,clock_timestamp()) WHERE id=$1",
      [account.id],
    );
    const next = (
      await c.query(
        "UPDATE provisioned_enrollments SET state='ACTIVE',account_id=$3,member_id=$4,bound_subject=$5,mailbox_token_hash=NULL,mailbox_expires_at=NULL,mailbox_verified_at=clock_timestamp(),activated_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
        [row.organization_id, row.id, account.id, member.id, proof!.subject],
      )
    ).rows[0];
    if (receipt)
      await c.query(
        "UPDATE provisioned_enrollment_reauth SET used_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
        [row.organization_id, receipt.id],
      );
    await c.query(
      "UPDATE provisioned_enrollment_flows SET consumed_at=clock_timestamp() WHERE organization_id=$1 AND enrollment_id=$2 AND consumed_at IS NULL",
      [row.organization_id, row.id],
    );
    await c.query(
      "UPDATE provisioned_enrollment_mail SET state='CANCELLED',token=NULL,lease_until=NULL WHERE organization_id=$1 AND enrollment_id=$2 AND state IN ('PENDING','FAILED','PROCESSING')",
      [row.organization_id, row.id],
    );
    const auth = {
      ...account,
      auth_method: "FEDERATED",
      auth_organization_id: row.organization_id,
      auth_connection_id: row.connection_id,
      auth_issuer: proof!.issuer,
      auth_subject: proof!.subject,
      auth_verified_at: now,
    };
    await checkTenantAuthentication({
      c,
      org,
      member,
      account: auth,
      mode: "authorization_write",
    });
    await record(
      c,
      row.organization_id,
      account.id,
      row.id,
      "ProvisionedEnrollmentActivated",
      requestId,
    );
    await c.query(
      "INSERT INTO account_events(id,account_id,action,resource_id,request_id) VALUES($1,$2,$3,$4,$5)",
      [uuid(), account.id, "FederatedEnrollmentActivated", row.id, requestId],
    );
    return {
      account: {
        id: account.id,
        email: account.email,
        displayName: account.display_name,
      },
      membership: camel(member),
      organizationId: row.organization_id,
      connectionId: row.connection_id,
      issuer: proof!.issuer,
      subject: proof!.subject,
      enrollment: projection(next),
      amr: proof!.amr,
      authTime: proof!.authTime,
    };
  }
  async function completeProvisionedEnrollment(
    c: PoolClient,
    opaqueEnrollmentProof: unknown,
    opaqueFederationProof: unknown,
    existingAccountReauth?: string,
  ) {
    return completeByHash(
      c,
      digest(token(opaqueEnrollmentProof)),
      opaqueFederationProof,
      existingAccountReauth ? digest(token(existingAccountReauth)) : undefined,
    );
  }
  async function issue(
    c: PoolClient,
    result: Awaited<ReturnType<typeof completeByHash>>,
    r: FastifyRequest,
  ) {
    await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[result.account.id]);
    if (r.cookies.orgmap_session)
      await c.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(r.cookies.orgmap_session),
      ]);
    const fresh = await createSessionRecord(c, result.account.id, {
      method: "FEDERATED",
      organizationId: result.organizationId,
      connectionId: result.connectionId,
      issuer: result.issuer,
      subject: result.subject,
      verifiedAt: await clock(c),
      amr: result.amr,
      authTime: result.authTime,
    });
    return { raw: fresh.token, csrf: fresh.csrf };
  }
  const setSession = (reply: FastifyReply, raw: string) =>
    reply.setCookie("orgmap_session", raw, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 604800,
    });
  async function issueProvisionedEnrollmentSession(
    r: FastifyRequest,
    reply: FastifyReply,
    input: {
      enrollmentToken: string;
      federationProof: unknown;
      existingAccountReauth?: string;
    },
  ) {
    const output = await transaction(async (c) => {
      const result = await completeByHash(
        c,
        digest(token(input.enrollmentToken)),
        input.federationProof,
        input.existingAccountReauth
          ? digest(token(input.existingAccountReauth))
          : undefined,
        r.id,
      );
      return { result, ...(await issue(c, result, r)) };
    });
    setSession(reply, output.raw);
    return deps.envelope(r, { ...output.result, csrfToken: output.csrf });
  }
  async function flow(
    c: PoolClient,
    r: FastifyRequest,
    expected?: { organizationId: string; connectionId: string },
    expectedFlowId?: string,
  ) {
    const cookie = token(r.cookies.orgmap_enrollment_flow);
    const locked = await lockByHash(c, digest(cookie), "FLOW");
    const f = (
      await c.query(
        "SELECT * FROM provisioned_enrollment_flows WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [locked.org.id, locked.lookup.flow_id],
      )
    ).rows[0];
    if (
      !f ||
      f.consumed_at ||
      new Date(f.expires_at) <= (await clock(c)) ||
      f.enrollment_version !== locked.row.version ||
      f.mailbox_token_hash !== locked.row.mailbox_token_hash ||
      (expected &&
        (expected.organizationId !== locked.org.id ||
          expected.connectionId !== locked.row.connection_id)) ||
      (expectedFlowId && f.id !== expectedFlowId)
    )
      fail(401, "ENROLLMENT_INVALID");
    return { ...locked, f };
  }
  async function getProvisionedEnrollmentRequest(
    r: FastifyRequest,
    expected?: { organizationId: string; connectionId: string },
  ) {
    return transaction(async (c) => {
      const { org, row, f } = await flow(c, r, expected);
      return {
        flowId: f.id,
        organizationId: org.id,
        connectionId: row.connection_id,
        enrollmentId: row.id,
        version: row.version,
      };
    });
  }
  async function completeProvisionedEnrollmentRequest(
    r: FastifyRequest,
    reply: FastifyReply,
    proof: unknown,
    expectedFlowId: string,
  ) {
    id(expectedFlowId);
    const output = await transaction(async (c) => {
      const { row, f } = await flow(c, r, undefined, expectedFlowId);
      const result = await completeByHash(
        c,
        row.mailbox_token_hash,
        proof,
        f.reauth_token_hash ?? undefined,
        r.id,
      );
      return { result, ...(await issue(c, result, r)) };
    });
    reply.clearCookie("orgmap_enrollment_flow", { path: "/" });
    setSession(reply, output.raw);
    return deps.envelope(r, { ...output.result, csrfToken: output.csrf });
  }
  async function registerProvisionedEnrollmentRoutes(app: FastifyInstance) {
    const attempts = new Map<string, { until: number; count: number }>();
    const throttle = (r: FastifyRequest) => {
      for (const [k, v] of attempts)
        if (v.until < Date.now()) attempts.delete(k);
      const old = attempts.get(r.ip);
      if ((old && old.count >= 12) || (!old && attempts.size > 10000))
        fail(429, "RATE_LIMITED");
      attempts.set(r.ip, {
        until: old?.until ?? Date.now() + 60000,
        count: (old?.count ?? 0) + 1,
      });
    };
    app.post("/api/v1/enrollments/prepare", async (r, reply) => {
      throttle(r);
      const b = body(r, ["token", "existingAccountReauth"]);
      key(r);
      const raw = secret();
      const data = await transaction(async (c) => {
        const { org, row } = await lockByHash(
          c,
          digest(token(b.token)),
          "MAILBOX",
        );
        let receiptHash: string | null = null;
        if (b.existingAccountReauth !== undefined) {
          receiptHash = digest(token(b.existingAccountReauth));
          const receipt = (
            await c.query(
              "SELECT account_id FROM provisioned_enrollment_reauth WHERE organization_id=$1 AND enrollment_id=$2 AND token_hash=$3",
              [org.id, row.id, receiptHash],
            )
          ).rows[0];
          if (!receipt) fail(401, "ENROLLMENT_INVALID");
          await verifyReauth(c, row, receipt.account_id, receiptHash);
        }
        const flowId = uuid();
        await c.query(
          "INSERT INTO provisioned_enrollment_flows(organization_id,id,enrollment_id,enrollment_version,cookie_hash,mailbox_token_hash,reauth_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '10 minutes')",
          [
            org.id,
            flowId,
            row.id,
            row.version,
            digest(raw),
            row.mailbox_token_hash,
            receiptHash,
          ],
        );
        await c.query(
          "UPDATE provisioned_enrollments SET mailbox_verified_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
          [org.id, row.id],
        );
        return {
          flowId,
          organizationId: org.id,
          connectionId: row.connection_id,
          enrollmentId: row.id,
          version: row.version,
        };
      });
      reply.setCookie("orgmap_enrollment_flow", raw, {
        path: "/",
        httpOnly: true,
        sameSite: process.env.COOKIE_SECURE === "true" ? "none" : "lax",
        secure: process.env.COOKIE_SECURE === "true",
        maxAge: 600,
      });
      return deps.envelope(r, data);
    });
    app.post("/api/v1/enrollments/reauthenticate", async (r) => {
      throttle(r);
      const b = body(r, ["token", "confirmAccountLink", "currentPassword"]);
      key(r);
      if (b.confirmAccountLink !== true)
        fail(400, "EXPLICIT_CONFIRMATION_REQUIRED");
      await deps.auth(r);
      const raw = secret();
      await transaction(async (c) => {
        const { org, row } = await lockByHash(
          c,
          digest(token(b.token)),
          "MAILBOX",
        );
        const session = await deps.auth(r, c);
        const account = (
          await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
            session.id,
          ])
        ).rows[0];
        if (!account || account.email !== row.email)
          fail(401, "REAUTHENTICATION_REQUIRED");
        const now = await clock(c);
        let authenticated = false;
        if (typeof b.currentPassword === "string" && account.password_enabled)
          authenticated = await verifyPassword(
            b.currentPassword,
            account.password_hash,
          );
        else if (
          b.currentPassword === undefined &&
          session.auth_method !== "LEGACY" &&
          session.auth_verified_at &&
          +new Date(session.auth_verified_at) >= +now - 300000 &&
          +new Date(session.auth_verified_at) <= +now + 30000
        )
          authenticated = true;
        if (!authenticated) fail(401, "REAUTHENTICATION_REQUIRED");
        const receiptId = uuid();
        await c.query(
          "INSERT INTO provisioned_enrollment_reauth(organization_id,id,enrollment_id,enrollment_version,account_id,session_id,token_hash,expires_at,confirmed,email_revision) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '5 minutes',true,$8)",
          [
            org.id,
            receiptId,
            row.id,
            row.version,
            account.id,
            session.session_id,
            digest(raw),
            account.email_revision,
          ],
        );
        await c.query(
          "INSERT INTO account_events(id,account_id,action,resource_id,request_id) VALUES($1,$2,$3,$4,$5)",
          [uuid(), account.id, "EnrollmentLinkConfirmed", row.id, r.id],
        );
      });
      return deps.envelope(r, {
        existingAccountReauth: raw,
        expiresInSeconds: 300,
      });
    });
  }
  async function deliverProvisionedEnrollmentMail(
    organizationId: string,
    sender: (mail: LocalMail) => Promise<void> = sendLocalMail,
  ) {
    const orgId = id(organizationId);
    const scope = async (c: PoolClient) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        orgId,
      ]);
    };
    const jobs = await transaction(async (c) => {
      await assertManagedWriter(c);
      await scope(c);
      await lockActiveOrganization(c, orgId);
      return (
        await c.query(
          "UPDATE provisioned_enrollment_mail SET state='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',attempts=attempts+1 WHERE organization_id=$1 AND id IN (SELECT id FROM provisioned_enrollment_mail WHERE organization_id=$1 AND state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (state<>'PROCESSING' OR lease_until<clock_timestamp()) FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING id,lease_token",
          [orgId],
        )
      ).rows;
    });
    let delivered = 0;
    for (const job of jobs) {
      const prepared = await transaction(async (c) => {
        await scope(c);
        await lockActiveOrganization(c, orgId);
        const mail = (await c.query(
          "SELECT * FROM provisioned_enrollment_mail WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE",
          [orgId,job.id,job.lease_token])).rows[0];
        if (!mail) return;
        const row = (await c.query("SELECT * FROM provisioned_enrollments WHERE organization_id=$1 AND id=$2 FOR UPDATE", [orgId,mail.enrollment_id])).rows[0];
        let valid = !!(row && row.active && row.state === "PENDING_ENROLLMENT" && row.version === mail.enrollment_version && row.mailbox_token_hash && mail.token && row.mailbox_token_hash === digest(mail.token) && new Date(row.mailbox_expires_at) > (await clock(c)));
        if (valid) try { await requireSource(c, row); } catch { valid = false; }
        if (!valid) {
          await c.query("UPDATE provisioned_enrollment_mail SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3", [orgId,mail.id,job.lease_token]);
          return;
        }
        const prior = (await c.query("SELECT id,state,lifecycle_fence::text AS fence,effect_token FROM organization_effects WHERE organization_id=$1 AND owner='IAM' AND effect_key=$2 AND state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN')", [orgId,"enrollment:"+mail.id])).rows[0];
        if (prior) {
          if (prior.state === "AUTHORIZED") await recordOrganizationEffectOutcome(c, {organizationId:orgId,id:prior.id,fence:prior.fence,token:prior.effect_token}, "OUTCOME_UNKNOWN");
          await c.query("UPDATE provisioned_enrollment_mail SET state='OUTCOME_UNKNOWN',last_error='EFFECT_OUTCOME_UNRESOLVED',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3", [orgId,mail.id,job.lease_token]);
          return;
        }
        const authorization = await authorizeOrganizationEffect(c, { organizationId:orgId, owner:"IAM", effectKey:"enrollment:"+mail.id, sourceLeaseToken:job.lease_token,
          validateSourceLease:async(client,token)=>!!(await client.query("SELECT 1 FROM provisioned_enrollment_mail WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE", [orgId,mail.id,token])).rowCount });
        return { authorization, message: { id:mail.id, to:row.email, subject:"OrgMap local enrollment verification",
          text:"One-use mailbox verification token (expires in 30 minutes):\n"+mail.token } };
      });
      if (!prepared) continue;
      let disposition: "CONFIRMED" | "NOT_SENT" | "REJECTED" | "OUTCOME_UNKNOWN" = "OUTCOME_UNKNOWN";
      try { await sender(prepared.message); disposition = "CONFIRMED"; }
      catch (error) { disposition = error instanceof SmtpDeliveryError ? error.disposition : "OUTCOME_UNKNOWN"; }
      const recorded = await transaction(async(c) => { await scope(c); return recordOrganizationEffectOutcome(c,prepared.authorization,disposition); });
      if (recorded.cutoverOccurred) continue;
      const success = recorded.recorded && disposition === "CONFIRMED";
      const unknown = !recorded.recorded || disposition === "OUTCOME_UNKNOWN";
      const updated = await transaction(async(c) => {
        await scope(c); await lockActiveOrganization(c,orgId);
        return (await c.query("UPDATE provisioned_enrollment_mail SET state=$4,token=CASE WHEN $4='DELIVERED' THEN NULL ELSE token END,lease_until=NULL,lease_token=NULL,last_error=$5,next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(3600,5*power(2,LEAST(attempts,10)))::integer) WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() RETURNING id",
          [orgId,job.id,job.lease_token,success ? "DELIVERED" : unknown ? "OUTCOME_UNKNOWN" : "FAILED",success ? null : unknown ? "EFFECT_OUTCOME_UNRESOLVED" : "SMTP_DELIVERY_FAILED"])).rowCount;
      });
      if (success && updated) delivered++;
    }
    return delivered;
  }
  return {
    validateCredentialFederation: async (ctx: Ctx, session = ctx.account) => {
      const p = provenance(session);
      if (
        p.method !== "FEDERATED" ||
        p.organizationId !== ctx.org.id ||
        !p.connectionId ||
        !p.issuer ||
        !p.subject ||
        !authority?.validateSessionProvenance
      )
        return false;
      if (!(await authority.validateSessionProvenance(ctx, p))) return false;
      const sources = (
        await ctx.c.query(
          "SELECT active,state FROM provisioned_enrollments WHERE organization_id=$1 AND connection_id=$2 AND account_id=$3 AND bound_subject=$4",
          [ctx.org.id, p.connectionId, ctx.account.id, p.subject],
        )
      ).rows;
      return sources.every(
        (source) => source.active && source.state === "ACTIVE",
      );
    },
    registerProvisionedEnrollmentAuthority,
    beginProvisionedEnrollment,
    getProvisionedEnrollment,
    setProvisionedAccess,
    completeProvisionedEnrollment,
    issueProvisionedEnrollmentSession,
    getProvisionedEnrollmentRequest,
    completeProvisionedEnrollmentRequest,
    registerProvisionedEnrollmentRoutes,
    deliverProvisionedEnrollmentMail,
    checkTenantAuthentication,
  };
}

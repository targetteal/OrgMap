import {
  lockActiveOrganization,
  lockOrganizationIfActive,
} from "./organization-lifecycle.js";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { Ctx } from "./runtime.js";
import type { InvitationLifecycleNotifier } from "./invitation-lifecycle-contract.js";
import type { AdmissionPolicy, OrgPolicyRead } from "./admission-contract.js";
import type { InvitationAccessPlan } from "./guest-contract.js";
import { normalizeAdmissionEmail } from "./admission.js";
import { accessPlan } from "./guest.js";
import { transaction } from "./db.js";
import {
  Failure,
  body,
  camel,
  commandHash,
  digest,
  event,
  fail,
  id,
  key,
  optionalText,
  secret,
  text,
  uuid,
  version,
} from "./core.js";

export type InvitationAuthorityInput = {
  email: string;
  memberType: "MEMBER" | "GUEST";
  accessPlan: InvitationAccessPlan;
};
export type InvitationDependencies = {
  notifyInvitationLifecycle: InvitationLifecycleNotifier;
  auth: (r: FastifyRequest, c?: PoolClient) => Promise<any>;
  envelope: (r: FastifyRequest, data: any, org?: any) => any;
  changed: (
    ctx: Ctx,
    r: FastifyRequest,
    resourceId: string,
    action: string,
  ) => Promise<void>;
  resolveAdmissionPolicy: (read: OrgPolicyRead) => Promise<AdmissionPolicy>;
  organizationSettings: (ctx: Ctx) => Promise<{
    settings: { name: string; locale: string };
  }>;
  assertInvitationAuthority: (
    ctx: Ctx,
    input: InvitationAuthorityInput,
  ) => Promise<InvitationAccessPlan>;
  validateGuestAccessPlan: (
    ctx: Ctx,
    value: unknown,
  ) => Promise<InvitationAccessPlan>;
  applyGuestAccessPlan: (
    ctx: Ctx,
    memberId: string,
    value: unknown,
  ) => Promise<unknown>;
};
type Intent = InvitationAuthorityInput & {
  firstName: string;
  lastName: string;
  personalMessage: string;
};
type BatchStatus =
  | "QUEUED"
  | "EXISTING_PENDING"
  | "ALREADY_MEMBER"
  | "DUPLICATE_IN_BATCH"
  | "INVALID"
  | "DENIED"
  | "CONFLICT";
type BatchResult = {
  clientRef: string;
  status: BatchStatus;
  code?: string;
  invitation?: Record<string, any>;
  deliveryJobId?: string | null;
};
const intentKeys = [
  "email",
  "memberType",
  "accessPlan",
  "firstName",
  "lastName",
  "personalMessage",
];
const projection =
  "id,email,status,expires_at,member_type,access_plan,version,first_name,last_name,personal_message,created_at,accepted_at,revoked_at";
const closed = (value: unknown, keys: string[]): Record<string, any> => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    fail(400, "INVALID_REQUEST");
  return value as Record<string, any>;
};
const canonicalPlan = (value: unknown): InvitationAccessPlan =>
  [...accessPlan(value)].sort((a, b) =>
    (
      a.resource.context +
      ":" +
      a.resource.kind +
      ":" +
      a.resource.id
    ).localeCompare(
      b.resource.context + ":" + b.resource.kind + ":" + b.resource.id,
    ),
  );
function intent(value: unknown, message?: string): Intent {
  const b = closed(value, intentKeys);
  const memberType = b.memberType ?? "MEMBER";
  if (!["MEMBER", "GUEST"].includes(memberType))
    fail(400, "INVALID_INVITATION_TYPE");
  return {
    email: normalizeAdmissionEmail(b.email),
    memberType,
    accessPlan: canonicalPlan(b.accessPlan ?? []),
    firstName: optionalText(b.firstName, 200),
    lastName: optionalText(b.lastName, 200),
    personalMessage: message ?? optionalText(b.personalMessage, 2000),
  };
}
function sameIntent(row: any, input: Intent, memberId: string) {
  return (
    row.invited_by_member_id === memberId &&
    row.email === input.email &&
    row.member_type === input.memberType &&
    JSON.stringify(canonicalPlan(row.access_plan ?? [])) ===
      JSON.stringify(input.accessPlan) &&
    (row.first_name ?? "") === input.firstName &&
    (row.last_name ?? "") === input.lastName &&
    (row.personal_message ?? "") === input.personalMessage
  );
}
const safeFailure = (error: unknown) =>
  error instanceof Failure && error.status >= 400 && error.status < 500;

/** All mutations run in the caller's tenant UoW, except the narrow global-session acceptance UoW. */
export function createInvitationServices(deps: InvitationDependencies) {
  async function actorContext(
    ctx: Ctx,
    memberId = ctx.member?.id,
  ): Promise<Ctx> {
    const member = (
      await ctx.c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type='MEMBER'",
        [ctx.org.id, memberId],
      )
    ).rows[0];
    if (
      !member ||
      (memberId === ctx.member?.id && member.account_id !== ctx.account?.id)
    )
      fail(403, "ACTION_DENIED");
    const account = (
      await ctx.c.query(
        "SELECT id,email,display_name FROM accounts WHERE id=$1",
        [member.account_id],
      )
    ).rows[0];
    if (!account) fail(403, "ACTION_DENIED");
    // A grantor context derives exclusively from persisted rows, without caller principal powers.
    return {
      c: ctx.c,
      org: ctx.org,
      member,
      account,
      mode: "authorization_write",
      requestId: ctx.requestId,
    };
  }
  async function authorize(ctx: Ctx, input: Intent): Promise<Intent> {
    if (ctx.mode === "read") fail(403, "ACTION_DENIED");
    const plan = await deps.assertInvitationAuthority(ctx, input);
    return { ...input, accessPlan: canonicalPlan(plan) };
  }
  async function assertBatchActor(ctx: Ctx) {
    const policy = await deps.resolveAdmissionPolicy({
      c: ctx.c,
      organizationId: ctx.org.id,
    });
    if (ctx.member.org_role !== "OWNER" && !policy.membersMayInvite)
      fail(403, "ACTION_DENIED");
  }
  async function invitationCapabilities(ctx: Ctx) {
    if (
      ctx.member.status !== "ACTIVE" ||
      ctx.member.member_type !== "MEMBER" ||
      (ctx.principal && !ctx.principal.scopes.includes("orgmap:write"))
    )
      return { "members.invite": false };
    try {
      const policy = await deps.resolveAdmissionPolicy({
        c: ctx.c,
        organizationId: ctx.org.id,
      });
      return {
        "members.invite":
          ctx.member.org_role === "OWNER" || policy.membersMayInvite,
      };
    } catch (error) {
      if (
        error instanceof Failure &&
        error.code === "POLICY_CONSUMER_UNAVAILABLE"
      )
        return { "members.invite": false };
      throw error;
    }
  }
  async function pending(ctx: Ctx, email: string) {
    return (
      await ctx.c.query(
        "SELECT * FROM invitations WHERE organization_id=$1 AND email=$2 AND status='PENDING' ORDER BY id FOR UPDATE",
        [ctx.org.id, email],
      )
    ).rows;
  }
  async function existingJob(ctx: Ctx, invitationId: string) {
    return (
      (
        await ctx.c.query(
          "SELECT d.id FROM invitation_delivery d JOIN invitations i ON i.organization_id=d.organization_id AND i.id=d.invitation_id AND d.generation=i.delivery_generation WHERE d.organization_id=$1 AND d.invitation_id=$2 AND d.state<>'CANCELLED' ORDER BY d.created_at DESC NULLS LAST,d.id LIMIT 1",
          [ctx.org.id, invitationId],
        )
      ).rows[0]?.id ?? null
    );
  }
  function visible(row: any) {
    return camel(
      Object.fromEntries(projection.split(",").map((k) => [k, row[k]])),
    );
  }
  async function queue(ctx: Ctx, r: FastifyRequest, input: Intent) {
    const invitationId = uuid(),
      token = secret(),
      jobId = uuid();
    const row = (
      await ctx.c.query(
        `INSERT INTO invitations(organization_id,id,email,token_hash,expires_at,member_type,access_plan,invited_by_member_id,first_name,last_name,personal_message) VALUES($1,$2,$3,$4,clock_timestamp()+interval '7 days',$5,$6,$7,$8,$9,$10) RETURNING ${projection}`,
        [
          ctx.org.id,
          invitationId,
          input.email,
          digest(token),
          input.memberType,
          JSON.stringify(input.accessPlan),
          ctx.member.id,
          input.firstName,
          input.lastName,
          input.personalMessage,
        ],
      )
    ).rows[0];
    await ctx.c.query(
      "INSERT INTO invitation_delivery(organization_id,id,invitation_id,token,generation) SELECT $1,$2,$3,$4,delivery_generation FROM invitations WHERE organization_id=$1 AND id=$3",
      [ctx.org.id, jobId, invitationId, token],
    );
    await deps.changed(ctx, r, invitationId, "MemberInvited");
    return { invitation: camel(row), deliveryJobId: jobId };
  }
  async function issueInvitation(ctx: Ctx, r: FastifyRequest, input: unknown) {
    if (ctx.mode === "read") fail(403, "ACTION_DENIED");
    const actor = await actorContext(ctx),
      parsed = await authorize(actor, intent(input));
    const rows = await pending(actor, parsed.email);
    if (rows.length > 1) fail(409, "INVITATION_RECONCILIATION_REQUIRED");
    if (rows.length) {
      if (!sameIntent(rows[0], parsed, actor.member.id))
        fail(409, "INVITATION_CHANGE_REQUIRED");
      return {
        invitation: visible(rows[0]),
        deliveryJobId: await existingJob(actor, rows[0].id),
      };
    }
    // The nominal API preserves issue-before-accept semantics for existing Accounts/members.
    // Acceptance remains responsible for suspension/type conflicts and never upgrades them.
    return queue(actor, r, parsed);
  }
  async function issueInvitationBatch(
    ctx: Ctx,
    r: FastifyRequest,
    input: unknown,
  ) {
    if (ctx.mode === "read") fail(403, "ACTION_DENIED");
    const b = closed(input, ["items", "personalMessage"]);
    if (!Array.isArray(b.items)) fail(400, "INVALID_REQUEST");
    if (!b.items.length || b.items.length > 100)
      fail(422, "INVITATION_BATCH_LIMIT");
    const message = optionalText(b.personalMessage, 2000);
    for (const entry of b.items) {
      const row = closed(entry, [
        "clientRef",
        ...intentKeys.filter((k) => k !== "personalMessage"),
      ]);
      text(row.clientRef, 200);
    }
    const actor = await actorContext(ctx);
    await assertBatchActor(actor);
    const seen = new Set<string>();
    const prepared: { result: BatchResult; input?: Intent }[] = [];
    // Only pure/business validation may produce a per-item error. SQL errors always escape.
    for (const item of b.items) {
      const { clientRef, ...row } = item;
      const result: BatchResult = {
        clientRef,
        status: "INVALID",
        code: "INVALID_INVITATION",
      };
      let parsed: Intent;
      try {
        parsed = intent(row, message);
      } catch (error) {
        if (!safeFailure(error)) throw error;
        prepared.push({ result });
        continue;
      }
      if (seen.has(parsed.email)) {
        prepared.push({ result: { clientRef, status: "DUPLICATE_IN_BATCH" } });
        continue;
      }
      seen.add(parsed.email);
      try {
        parsed = await authorize(actor, parsed);
      } catch (error) {
        if (!safeFailure(error)) throw error;
        prepared.push({
          result: { clientRef, status: "DENIED", code: "INVITATION_DENIED" },
        });
        continue;
      }
      prepared.push({ result: { clientRef, status: "QUEUED" }, input: parsed });
    }
    for (const entry of prepared) {
      if (!entry.input) continue;
      const parsed = entry.input;
      // This is an organization-scoped membership query, not global Account discovery.
      const member = (
        await actor.c.query(
          "SELECT m.status,m.member_type FROM members m JOIN accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND a.email=$2",
          [actor.org.id, parsed.email],
        )
      ).rows[0];
      if (member) {
        entry.result.status =
          member.status !== "ACTIVE"
            ? "DENIED"
            : member.member_type !== parsed.memberType
              ? "CONFLICT"
              : "ALREADY_MEMBER";
        if (member.status !== "ACTIVE") entry.result.code = "INVITATION_DENIED";
        else if (member.member_type !== parsed.memberType)
          entry.result.code = "TYPE_CHANGE_REQUIRED";
        continue;
      }
      const rows = await pending(actor, parsed.email);
      if (rows.length > 1) {
        entry.result.status = "CONFLICT";
        entry.result.code = "INVITATION_RECONCILIATION_REQUIRED";
        continue;
      }
      if (rows.length) {
        entry.result.status = "EXISTING_PENDING";
        if (
          rows[0].invited_by_member_id !== actor.member.id &&
          actor.member.org_role !== "OWNER"
        )
          continue;
        if (!sameIntent(rows[0], parsed, actor.member.id)) {
          entry.result.status = "CONFLICT";
          entry.result.code = "INVITATION_CHANGE_REQUIRED";
          continue;
        }
        entry.result.invitation = visible(rows[0]);
        entry.result.deliveryJobId = await existingJob(actor, rows[0].id);
        continue;
      }
      Object.assign(entry.result, await queue(actor, r, parsed));
    }
    return { results: prepared.map((p) => p.result) };
  }
  async function changeInvitationAccess(
    ctx: Ctx,
    r: FastifyRequest,
    invitationId: string,
    input: unknown,
  ) {
    if (ctx.mode === "read") fail(403, "ACTION_DENIED");
    const b = closed(
        input,
        intentKeys.filter((k) => k !== "email"),
      ),
      actor = await actorContext(ctx);
    const old = (
      await actor.c.query(
        "SELECT * FROM invitations WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [actor.org.id, id(invitationId)],
      )
    ).rows[0];
    if (
      !old ||
      (actor.member.org_role !== "OWNER" &&
        old.invited_by_member_id !== actor.member.id)
    )
      fail(404, "RESOURCE_NOT_FOUND");
    version(r, old.version);
    if (old.status === "ACCEPTED") fail(409, "STATE_CONFLICT");
    await assertDeliverySettled(actor, old.id);
    const parsed = await authorize(
      actor,
      intent({
        email: old.email,
        memberType: b.memberType ?? old.member_type,
        accessPlan: b.accessPlan ?? old.access_plan,
        firstName: b.firstName ?? old.first_name,
        lastName: b.lastName ?? old.last_name,
        personalMessage: b.personalMessage ?? old.personal_message,
      }),
    );
    const peers = await pending(actor, old.email);
    if (peers.some((row) => row.id !== old.id))
      fail(409, "INVITATION_RECONCILIATION_REQUIRED");
    const token = secret(),
      jobId = uuid();
    const updated = (
      await actor.c.query(
        `UPDATE invitations SET member_type=$3,access_plan=$4,invited_by_member_id=$5,token_hash=$6,status='PENDING',revoked_at=NULL,delivery_generation=delivery_generation+1,expires_at=clock_timestamp()+interval '7 days',version=version+1,first_name=$7,last_name=$8,personal_message=$9 WHERE organization_id=$1 AND id=$2 RETURNING ${projection}`,
        [
          actor.org.id,
          old.id,
          parsed.memberType,
          JSON.stringify(parsed.accessPlan),
          actor.member.id,
          digest(token),
          parsed.firstName,
          parsed.lastName,
          parsed.personalMessage,
        ],
      )
    ).rows[0];
    await actor.c.query(
      "UPDATE invitation_delivery SET state='CANCELLED',token=NULL,lease_until=NULL,lease_token=NULL,completed_at=clock_timestamp() WHERE organization_id=$1 AND invitation_id=$2 AND state<>'DELIVERED'",
      [actor.org.id, old.id],
    );
    await actor.c.query(
      "INSERT INTO invitation_delivery(organization_id,id,invitation_id,token,generation) SELECT $1,$2,$3,$4,delivery_generation FROM invitations WHERE organization_id=$1 AND id=$3",
      [actor.org.id, jobId, old.id, token],
    );
    await deps.changed(actor, r, old.id, "InviteAccessPlanChanged");
    return { invitation: camel(updated), deliveryJobId: jobId };
  }
  async function invitationActor(c: PoolClient, org: any, invitation: any) {
    if (!invitation.invited_by_member_id) fail(403, "ACTION_DENIED");
    const seed = { c, org, mode: "authorization_write" } as Ctx;
    return actorContext(seed, invitation.invited_by_member_id);
  }
  async function validateInvitationDelivery(
    c: PoolClient,
    organizationId: string,
    invitation: any,
  ) {
    const org = await lockOrganizationIfActive(c, id(organizationId));
    if (!org) return null;
    const row = (
      await c.query(
        "SELECT * FROM invitations WHERE organization_id=$1 AND id=$2 AND status='PENDING' AND expires_at>clock_timestamp() FOR UPDATE",
        [org.id, id(invitation.invitation_id ?? invitation.id)],
      )
    ).rows[0];
    if (!row) return null;
    if (
      typeof invitation.token === "string" &&
      digest(invitation.token) !== row.token_hash
    )
      return null;
    let actor: Ctx;
    try {
      actor = await invitationActor(c, org, row);
      await authorize(
        actor,
        intent({
          email: row.email,
          memberType: row.member_type,
          accessPlan: row.access_plan,
          firstName: row.first_name,
          lastName: row.last_name,
          personalMessage: row.personal_message,
        }),
      );
    } catch (error) {
      if (!safeFailure(error)) throw error;
      return null;
    }
    const { settings } = await deps.organizationSettings(actor);
    return {
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      personalMessage: row.personal_message,
      organizationName: settings.name,
      locale: settings.locale,
      inviterName: actor.account.display_name,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }
  /** Possession of the emailed token permits only this narrow public projection.
   * Preview never authenticates, creates membership or exposes the access plan. */
  async function previewInvitation(r: FastifyRequest) {
    const b = body(r, ["token"]);
    if (typeof b.token !== "string" || !/^[a-f0-9]{64}$/i.test(b.token))
      fail(404, "RESOURCE_NOT_FOUND");
    const tokenHash = digest(b.token);
    return transaction(async (c) => {
      const lookup = (
        await c.query("SELECT organization_id FROM invitation_lookup($1)", [
          tokenHash,
        ])
      ).rows[0];
      if (!lookup) fail(404, "RESOURCE_NOT_FOUND");
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        lookup.organization_id,
      ]);
      const org = await lockActiveOrganization(c, lookup.organization_id);
      const row = (
        await c.query(
          "SELECT * FROM invitations WHERE organization_id=$1 AND token_hash=$2 AND status IN ('PENDING','ACCEPTED') AND expires_at>clock_timestamp() FOR UPDATE",
          [org.id, tokenHash],
        )
      ).rows[0];
      if (!row) fail(404, "RESOURCE_NOT_FOUND");
      let actor: Ctx;
      try {
        actor = await invitationActor(c, org, row);
        await authorize(
          actor,
          intent({
            email: row.email,
            memberType: row.member_type,
            accessPlan: row.access_plan,
            firstName: row.first_name,
            lastName: row.last_name,
            personalMessage: row.personal_message,
          }),
        );
      } catch (error) {
        if (safeFailure(error)) fail(404, "RESOURCE_NOT_FOUND");
        throw error;
      }
      const { settings } = await deps.organizationSettings(actor);
      const [local, domain] = row.email.split("@");
      return deps.envelope(r, {
        organizationName: settings.name,
        locale: settings.locale,
        emailHint: local.slice(0, 1) + "***@" + domain,
        memberType: row.member_type,
        expiresAt: new Date(row.expires_at).toISOString(),
      });
    });
  }
  async function acceptInvitation(r: FastifyRequest) {
    const initial = await deps.auth(r),
      b = body(r, ["token"]),
      tokenHash = digest(text(b.token, 200));
    return transaction(async (c) => {
      const lookup = (
        await c.query("SELECT organization_id FROM invitation_lookup($1)", [
          tokenHash,
        ])
      ).rows[0];
      if (!lookup) fail(404, "RESOURCE_NOT_FOUND");
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        lookup.organization_id,
      ]);
      // Match runtime tenant: organization, Account, then revalidated session.
      const org = await lockActiveOrganization(c, lookup.organization_id);
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        initial.id,
      ]);
      const account = await deps.auth(r, c);
      if (account.id !== initial.id) fail(401, "UNAUTHENTICATED");
      const inv = (
        await c.query(
          "SELECT * FROM invitations WHERE organization_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE",
          [org.id, tokenHash],
        )
      ).rows[0];
      if (!inv || inv.email !== account.email || inv.status === "REVOKED")
        fail(404, "RESOURCE_NOT_FOUND");
      const actor = await invitationActor(c, org, inv);
      const parsed = await authorize(
        actor,
        intent({
          email: inv.email,
          memberType: inv.member_type,
          accessPlan: inv.access_plan,
          firstName: inv.first_name,
          lastName: inv.last_name,
          personalMessage: inv.personal_message,
        }),
      );
      const commandKey = "invitation.accept:" + key(r),
        hash = commandHash(r);
      const prior = (
        await c.query(
          "SELECT * FROM account_commands WHERE account_id=$1 AND key=$2",
          [account.id, commandKey],
        )
      ).rows[0];
      if (prior?.result?.deleted === true) fail(404, "RESOURCE_NOT_FOUND");
      if (prior && prior.result?.organizationId !== org.id)
        fail(409, "IDEMPOTENCY_CONFLICT");
      if (prior && prior.hash !== hash) fail(409, "IDEMPOTENCY_CONFLICT");
      let membership = (
        await c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",
          [org.id, account.id],
        )
      ).rows[0];
      if (membership && membership.status !== "ACTIVE")
        fail(403, "ACTION_DENIED");
      if (membership && membership.member_type !== parsed.memberType)
        fail(409, "TYPE_CHANGE_REQUIRED");
      if (!membership && inv.status === "ACCEPTED") fail(409, "STATE_CONFLICT");
      if (!membership) {
        membership = (
          await c.query(
            "INSERT INTO members(organization_id,id,account_id,org_role,member_type) VALUES($1,$2,$3,'MEMBER',$4) RETURNING *",
            [org.id, uuid(), account.id, parsed.memberType],
          )
        ).rows[0];
      }
      if (inv.status !== "ACCEPTED") {
        const acceptedEventId = uuid();
        if (parsed.memberType === "GUEST")
          await deps.applyGuestAccessPlan(
            actor,
            membership.id,
            parsed.accessPlan,
          );
        await c.query(
          "UPDATE invitations SET status='ACCEPTED',accepted_at=clock_timestamp(),accepted_event_id=$3,version=version+1 WHERE organization_id=$1 AND id=$2",
          [org.id, inv.id, acceptedEventId],
        );
        await c.query(
          "UPDATE invitation_delivery SET state='CANCELLED',token=NULL,lease_until=NULL,lease_token=NULL,completed_at=clock_timestamp() WHERE organization_id=$1 AND invitation_id=$2 AND state<>'DELIVERED'",
          [org.id, inv.id],
        );
        await deps.notifyInvitationLifecycle(actor, {
          eventId: acceptedEventId,
          event: "InvitationAccepted",
          invitationId: inv.id,
          recipientMemberId: actor.member.id,
          actorName: account.display_name ?? account.displayName ?? account.email,
        });
        await event(
          c,
          org.id,
          account.id,
          membership.id,
          "OrganizationMemberJoined",
          r.id,
        );
        await c.query(
          "UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1",
          [org.id],
        );
      }
      const result = { organizationId: org.id, membership: camel(membership) };
      if (!prior)
        await c.query("INSERT INTO account_commands VALUES($1,$2,$3,$4)", [
          account.id,
          commandKey,
          hash,
          result,
        ]);
      const currentOrg = (
        await c.query("SELECT * FROM organizations WHERE id=$1", [org.id])
      ).rows[0];
      return deps.envelope(r, result, currentOrg);
    });
  }
  /** AUTHORIZED transport is an external operation in flight. Commands must not
   * rotate/revoke its authority between prepare and the observed outcome. */
  async function assertDeliverySettled(ctx: Ctx, invitationId: string) {
    if (
      (
        await ctx.c.query(
          `SELECT 1 FROM invitation_delivery d
      JOIN organization_effects e ON e.organization_id=d.organization_id AND e.owner='IAM' AND e.effect_key='invitation:'||d.id::text
      WHERE d.organization_id=$1 AND d.invitation_id=$2 AND e.state='AUTHORIZED' AND d.state='PROCESSING'`,
          [ctx.org.id, invitationId],
        )
      ).rowCount
    )
      fail(409, "INVITATION_DELIVERY_IN_PROGRESS");
  }
  async function ownedInvitation(ctx: Ctx, invitationId: string) {
    const row = (
      await ctx.c.query(
        "SELECT * FROM invitations WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [ctx.org.id, id(invitationId)],
      )
    ).rows[0];
    if (
      !row ||
      (ctx.member.org_role !== "OWNER" &&
        row.invited_by_member_id !== ctx.member.id)
    )
      fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  const rowIntent = (row: any) =>
    intent({
      email: row.email,
      memberType: row.member_type,
      accessPlan: row.access_plan,
      firstName: row.first_name,
      lastName: row.last_name,
      personalMessage: row.personal_message,
    });
  async function lifecycleInvitation(
    ctx: Ctx,
    r: FastifyRequest,
    invitationId: string,
    action: "RESEND" | "CANCEL",
  ) {
    if (ctx.mode === "read") fail(403, "ACTION_DENIED");
    closed(r.body, []);
    const actor = await actorContext(ctx),
      old = await ownedInvitation(actor, invitationId);
    version(r, old.version);
    if (
      old.status === "ACCEPTED" ||
      (action === "CANCEL" && old.status !== "PENDING")
    )
      fail(409, "STATE_CONFLICT");
    await assertDeliverySettled(actor, old.id);
    if (action === "RESEND") {
      await authorize(actor, rowIntent(old));
      const peers = await pending(actor, old.email);
      if (peers.some((row) => row.id !== old.id))
        fail(409, "INVITATION_RECONCILIATION_REQUIRED");
    }
    const token = secret();
    const row = (
      await actor.c.query(
        `UPDATE invitations SET token_hash=$3,version=version+1,delivery_generation=delivery_generation+CASE WHEN $4='PENDING' THEN 1 ELSE 0 END,
      status=$4,invited_by_member_id=CASE WHEN $4='PENDING' THEN $5 ELSE invited_by_member_id END,revoked_at=CASE WHEN $4='REVOKED' THEN clock_timestamp() ELSE NULL END,
      expires_at=CASE WHEN $4='PENDING' THEN clock_timestamp()+interval '7 days' ELSE expires_at END
      WHERE organization_id=$1 AND id=$2 RETURNING ${projection},delivery_generation`,
        [
          actor.org.id,
          old.id,
          digest(token),
          action === "CANCEL" ? "REVOKED" : "PENDING",
          actor.member.id,
        ],
      )
    ).rows[0];
    await actor.c.query(
      "UPDATE invitation_delivery SET state='CANCELLED',token=NULL,lease_until=NULL,lease_token=NULL,completed_at=clock_timestamp() WHERE organization_id=$1 AND invitation_id=$2 AND state<>'DELIVERED'",
      [actor.org.id, old.id],
    );
    let deliveryJobId: string | null = null;
    if (action === "RESEND") {
      deliveryJobId = uuid();
      await actor.c.query(
        "INSERT INTO invitation_delivery(organization_id,id,invitation_id,token,generation) VALUES($1,$2,$3,$4,$5)",
        [actor.org.id, deliveryJobId, old.id, token, row.delivery_generation],
      );
    }
    await deps.changed(
      actor,
      r,
      old.id,
      action === "CANCEL" ? "InvitationCancelled" : "InvitationResent",
    );
    return { invitation: visible(row), deliveryJobId };
  }
  async function invitationResource(ctx: Ctx, invitationId: string) {
    let actor: Ctx;
    try {
      actor = await actorContext(ctx);
    } catch (error) {
      if (safeFailure(error)) return null;
      throw error;
    }
    const row = (
      await actor.c.query(
        "SELECT * FROM invitations WHERE organization_id=$1 AND id=$2",
        [actor.org.id, id(invitationId)],
      )
    ).rows[0];
    if (
      !row ||
      (actor.member.org_role !== "OWNER" &&
        row.invited_by_member_id !== actor.member.id)
    )
      return null;
    const { settings } = await deps.organizationSettings(actor);
    return {
      id: row.id,
      title: row.email,
      email: row.email,
      organizationName: settings.name,
      locale: settings.locale,
      status: row.status,
    };
  }
  async function reportInvitationDelivery(
    c: PoolClient,
    organizationId: string,
    jobId: string,
  ) {
    const org = await lockOrganizationIfActive(c, id(organizationId));
    if (!org) return;
    const row = (
      await c.query(
        `SELECT d.*,i.invited_by_member_id FROM invitation_delivery d
      JOIN invitations i ON i.organization_id=d.organization_id AND i.id=d.invitation_id
      WHERE d.organization_id=$1 AND d.id=$2 AND d.generation=i.delivery_generation AND i.status='PENDING'
      AND d.state IN ('FAILED','OUTCOME_UNKNOWN') AND d.terminal_at IS NOT NULL AND d.failure_notified_at IS NULL FOR UPDATE OF d,i`,
        [org.id, id(jobId)],
      )
    ).rows[0];
    if (!row) return;
    let actor: Ctx;
    try {
      actor = await invitationActor(c, org, row);
    } catch (error) {
      if (safeFailure(error)) return;
      throw error;
    }
    const eventId = row.failure_event_id ?? uuid();
    await deps.notifyInvitationLifecycle(actor, {
      eventId,
      event: "InvitationDeliveryFailed",
      invitationId: row.invitation_id,
      recipientMemberId: actor.member.id,
      outcome: row.state,
      actorName: 'OrgMap',
    });
    await c.query(
      "UPDATE invitation_delivery SET failure_event_id=$3,failure_notified_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
      [org.id, row.id, eventId],
    );
  }
  async function listPendingInvitations(ctx: Ctx, r?: FastifyRequest) {
    const actor = await actorContext(ctx),
      query = (r?.query ?? {}) as Record<string, unknown>;
    if (
      Object.keys(query).some(
        (k) => !["status", "limit", "cursor", "invitationId"].includes(k),
      ) ||
      (query.status !== undefined && query.status !== "ALL")
    )
      fail(400, "INVALID_REQUEST");
    const focusedInvitationId =
      query.invitationId === undefined ? null : id(query.invitationId);
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      fail(400, "INVALID_REQUEST");
    let cursor: any = null;
    if (query.cursor !== undefined) {
      cursor = (
        await actor.c.query(
          "SELECT id,created_at::text AS created_at FROM invitations WHERE organization_id=$1 AND id=$2 AND ($3::boolean OR invited_by_member_id=$4)",
          [
            actor.org.id,
            id(query.cursor),
            actor.member.org_role === "OWNER",
            actor.member.id,
          ],
        )
      ).rows[0];
      if (!cursor) fail(400, "INVALID_REQUEST");
    }
    // UUID tie breaks pagination only; a null historical timestamp stays unknown.
    const rows = (
      await actor.c.query(
        `SELECT * FROM invitations WHERE organization_id=$1 AND ($4::boolean OR status='PENDING') AND ($2::boolean OR invited_by_member_id=$3)
      AND ($8::uuid IS NULL OR id=$8) AND ($5::uuid IS NULL OR (CASE WHEN $6::timestamptz IS NULL THEN created_at IS NULL AND id>$5 ELSE created_at<$6 OR created_at IS NULL OR (created_at=$6 AND id>$5) END))
      ORDER BY created_at DESC NULLS LAST,id LIMIT $7`,
        [
          actor.org.id,
          actor.member.org_role === "OWNER",
          actor.member.id,
          query.status === "ALL",
          cursor?.id ?? null,
          cursor?.created_at ?? null,
          limit + 1,
          focusedInvitationId,
        ],
      )
    ).rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const items = [];
    for (const row of rows) {
      let canResend = false;
      if (row.status !== "ACCEPTED") {
        try {
          await authorize(actor, rowIntent(row));
          canResend = true;
        } catch (error) {
          if (
            !safeFailure(error) &&
            !(
              error instanceof Failure &&
              error.code === "POLICY_CONSUMER_UNAVAILABLE"
            )
          )
            throw error;
        }
      }
      if (ctx.principal && !ctx.principal.scopes.includes("orgmap:write"))
        canResend = false;
      const jobs = (
        await actor.c.query(
          "SELECT * FROM invitation_delivery WHERE organization_id=$1 AND invitation_id=$2 AND generation=$3 ORDER BY created_at DESC NULLS LAST,id",
          [actor.org.id, row.id, row.delivery_generation],
        )
      ).rows;
      // Multiple historical jobs cannot be chronologically ordered by random IDs.
      const delivery = jobs.length === 1 ? jobs[0] : null;
      items.push({
        ...visible(row),
        expired:
          row.status === "PENDING" && +new Date(row.expires_at) <= Date.now(),
        canResend,
        canCancel:
          row.status === "PENDING" &&
          (!ctx.principal || ctx.principal.scopes.includes("orgmap:write")),
        delivery: delivery
          ? {
              state:
                delivery.state === "FAILED" && !delivery.terminal_at
                  ? "RETRYING"
                  : delivery.state,
              attempts: delivery.attempts,
              lastAttemptAt: delivery.last_attempt_at,
              completedAt: delivery.completed_at,
              nextAttemptAt:
                ["PENDING", "PROCESSING", "FAILED"].includes(delivery.state) &&
                !delivery.terminal_at
                  ? delivery.next_attempt_at
                  : null,
              ...(delivery.last_error
                ? {
                    errorCode:
                      delivery.state === "OUTCOME_UNKNOWN"
                        ? "EFFECT_OUTCOME_UNRESOLVED"
                        : "INVITATION_DELIVERY_FAILED",
                  }
                : {}),
            }
          : null,
      });
    }
    return {
      items,
      hasMore,
      nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
    };
  }
  type RequestKind =
    "SINGLE" | "BATCH" | "CHANGE" | "LIST" | "RESEND" | "CANCEL";
  async function authorizeInvitationRequest(
    ctx: Ctx,
    r: FastifyRequest,
    kind: RequestKind,
  ) {
    const actor = await actorContext(ctx);
    if (kind === "SINGLE") await authorize(actor, intent(r.body));
    else if (kind === "LIST") return true;
    else if (kind === "RESEND" || kind === "CANCEL") {
      closed(r.body, []);
      const old = await ownedInvitation(actor, (r.params as any).invitationId);
      if (kind === "RESEND") await authorize(actor, rowIntent(old));
    } else if (kind === "CHANGE") {
      const b = closed(
        r.body,
        intentKeys.filter((k) => k !== "email"),
      );
      const old = (
        await actor.c.query(
          "SELECT * FROM invitations WHERE organization_id=$1 AND id=$2",
          [actor.org.id, id((r.params as any).invitationId)],
        )
      ).rows[0];
      if (
        !old ||
        (actor.member.org_role !== "OWNER" &&
          old.invited_by_member_id !== actor.member.id)
      )
        fail(404, "RESOURCE_NOT_FOUND");
      await authorize(
        actor,
        intent({
          email: old.email,
          memberType: b.memberType ?? old.member_type,
          accessPlan: b.accessPlan ?? old.access_plan,
          firstName: b.firstName ?? old.first_name,
          lastName: b.lastName ?? old.last_name,
          personalMessage: b.personalMessage ?? old.personal_message,
        }),
      );
    } else await assertBatchActor(actor);
    return true;
  }
  async function validateInvitationReplay(
    ctx: Ctx,
    r: FastifyRequest,
    result: any,
    kind: RequestKind,
  ) {
    const actor = await actorContext(ctx);
    await authorizeInvitationRequest(ctx, r, kind);
    if (kind === "RESEND" || kind === "CANCEL") {
      const row = await ownedInvitation(actor, (r.params as any).invitationId);
      if (
        !result?.invitation ||
        row.version !== result.invitation.version ||
        row.status !== result.invitation.status
      )
        fail(409, "STATE_CONFLICT");
      return;
    }
    const targets: { input: Intent; invitation?: any }[] = [];
    if (kind === "SINGLE")
      targets.push({ input: intent(r.body), invitation: result?.invitation });
    if (kind === "CHANGE") {
      if (!result?.invitation) fail(409, "STATE_CONFLICT");
      const projected = Object.fromEntries(
        intentKeys.map((k) => [k, result.invitation[k]]),
      );
      targets.push({ input: intent(projected), invitation: result.invitation });
    }
    if (kind === "BATCH") {
      const b = closed(r.body, ["items", "personalMessage"]),
        message = optionalText(b.personalMessage, 2000);
      if (
        !Array.isArray(b.items) ||
        !Array.isArray(result?.results) ||
        b.items.length !== result.results.length
      )
        fail(409, "STATE_CONFLICT");
      for (let i = 0; i < b.items.length; i++) {
        const row = result.results[i];
        if (!["QUEUED", "EXISTING_PENDING"].includes(row.status)) continue;
        const { clientRef: _clientRef, ...item } = b.items[i];
        targets.push({
          input: intent(item, message),
          invitation: row.invitation,
        });
      }
    }
    for (const target of targets) {
      const input = await authorize(actor, target.input);
      if (!target.invitation) continue; // Opaque third-party pending status carries no reusable authority.
      const row = (
        await actor.c.query(
          "SELECT *,expires_at>clock_timestamp() AS unexpired FROM invitations WHERE organization_id=$1 AND id=$2",
          [actor.org.id, id(target.invitation.id)],
        )
      ).rows[0];
      if (
        !row ||
        row.status === "REVOKED" ||
        !row.unexpired ||
        row.version !== target.invitation.version ||
        !sameIntent(row, input, actor.member.id)
      )
        fail(409, "STATE_CONFLICT");
    }
  }
  return {
    issueInvitation,
    issueInvitationBatch,
    resendInvitation: (ctx: Ctx, r: FastifyRequest, invitationId: string) =>
      lifecycleInvitation(ctx, r, invitationId, "RESEND"),
    cancelInvitation: (ctx: Ctx, r: FastifyRequest, invitationId: string) =>
      lifecycleInvitation(ctx, r, invitationId, "CANCEL"),
    invitationResource,
    reportInvitationDelivery,
    changeInvitationAccess,
    acceptInvitation,
    previewInvitation,
    invitationCapabilities,
    validateInvitationDelivery,
    listPendingInvitations,
    authorizeInvitationRequest,
    validateInvitationReplay,
  };
}

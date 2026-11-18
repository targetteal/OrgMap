import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type {
  MemberIndicatorAuthorityPort,
  MemberIndicatorAction,
} from "../structure/profile-capacity-contract.js";
import { body, fail, id, uuid, version } from "../../src/core.js";
const confirmation = "AUTHORIZE_DEFINE_ON_MY_INDICATORS";
async function liveMember(ctx: Ctx, memberId: string) {
  return (
    await ctx.c.query(
      "SELECT id,version,status,member_type,account_id FROM members WHERE organization_id=$1 AND id=$2",
      [ctx.org.id, id(memberId)],
    )
  ).rows[0];
}
const eligible = (member: any) =>
  member?.status === "ACTIVE" && member.member_type === "MEMBER";
async function own(ctx: Ctx) {
  const actor = await liveMember(ctx, ctx.member.id);
  if (!eligible(actor) || actor.account_id !== ctx.account.id)
    fail(403, "ACTION_DENIED");
  return actor;
}
export function createMemberIndicatorAuthority(): MemberIndicatorAuthorityPort {
  return {
    async authorize(ctx, { memberId, action }) {
      const subject = await liveMember(ctx, memberId),
        actor = await liveMember(ctx, ctx.member.id);
      const org = (
        await ctx.c.query(
          "SELECT authorization_revision FROM organizations WHERE id=$1",
          [ctx.org.id],
        )
      ).rows[0];
      const result = {
        allowed: false,
        organizationId: ctx.org.id,
        actorMemberId: ctx.member.id,
        subjectMemberId: memberId,
        action,
        organizationAuthorizationRevision: Number(
          org?.authorization_revision ?? 0,
        ),
        subjectVersion: subject?.version ?? 0,
        reasons: [] as {
          kind: "SELF" | "EXPLICIT_GRANT";
          grantId?: string;
          grantRevision?: number;
        }[],
      };
      if (
        !org ||
        !eligible(subject) ||
        !eligible(actor) ||
        actor.account_id !== ctx.account.id ||
        !["READ", "DEFINE", "RECORD"].includes(action)
      )
        return result;
      if (actor.id === subject.id && (action === "READ" || action === "RECORD"))
        return {
          ...result,
          allowed: true,
          reasons: [{ kind: "SELF" as const }],
        };
      if (action !== "DEFINE") return result;
      const consent = (
        await ctx.c.query(
          "SELECT id,version FROM administration_indicator_consents WHERE organization_id=$1 AND subject_member_id=$2 AND delegate_member_id=$3 AND actions=ARRAY['DEFINE']::text[] AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY created_at DESC,id LIMIT 1",
          [ctx.org.id, subject.id, actor.id],
        )
      ).rows[0];
      return consent
        ? {
            ...result,
            allowed: true,
            reasons: [
              {
                kind: "EXPLICIT_GRANT" as const,
                grantId: consent.id,
                grantRevision: consent.version,
              },
            ],
          }
        : result;
    },
  };
}
const iso = (value: any) => (value ? new Date(value).toISOString() : null);
function present(row: any, now: Date) {
  return {
    id: row.id,
    subjectMemberId: row.subject_member_id,
    delegateMemberId: row.delegate_member_id,
    actions: ["DEFINE"],
    version: row.version,
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    createdAt: iso(row.created_at),
    effective:
      !row.revoked_at &&
      new Date(row.expires_at) > now &&
      row.delegate_status === "ACTIVE" &&
      row.delegate_type === "MEMBER",
  };
}
async function book(ctx: Ctx) {
  return (
    (
      await ctx.c.query(
        "SELECT revision FROM administration_indicator_consent_books WHERE organization_id=$1 AND subject_member_id=$2",
        [ctx.org.id, ctx.member.id],
      )
    ).rows[0]?.revision ?? 0
  );
}
async function existing(ctx: Ctx, consentId: string) {
  const row = (
    await ctx.c.query(
      "SELECT c.*,m.status AS delegate_status,m.member_type AS delegate_type,clock_timestamp() AS db_now FROM administration_indicator_consents c JOIN members m ON m.organization_id=c.organization_id AND m.id=c.delegate_member_id WHERE c.organization_id=$1 AND c.id=$2 AND c.subject_member_id=$3",
      [ctx.org.id, id(consentId), ctx.member.id],
    )
  ).rows[0];
  if (!row) fail(404, "RESOURCE_NOT_FOUND");
  return row;
}
async function candidate(ctx: Ctx, request: FastifyRequest) {
  const input = body(request, [
    "delegateMemberId",
    "actions",
    "expiresAt",
    "confirmation",
  ]);
  if (input.confirmation !== confirmation)
    fail(422, "INDICATOR_CONSENT_CONFIRMATION_REQUIRED");
  if (
    !Array.isArray(input.actions) ||
    input.actions.length !== 1 ||
    input.actions[0] !== "DEFINE"
  )
    fail(422, "INVALID_INDICATOR_CONSENT_ACTIONS");
  const delegate = await liveMember(ctx, id(input.delegateMemberId));
  if (!eligible(delegate)) fail(404, "RESOURCE_NOT_FOUND");
  const clock = (
    await ctx.c.query(
      "SELECT clock_timestamp() AS now,clock_timestamp()+interval '30 days' AS default_expiration,clock_timestamp()+interval '365 days' AS max_expiration",
    )
  ).rows[0];
  let expiration = clock.default_expiration as Date;
  if (input.expiresAt !== undefined) {
    if (
      typeof input.expiresAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        input.expiresAt,
      )
    )
      fail(422, "INVALID_CONSENT_EXPIRATION");
    expiration = new Date(input.expiresAt);
    const civil = input.expiresAt.slice(0, 10),
      calendar = new Date(civil + "T00:00:00Z");
    if (
      !Number.isFinite(+calendar) ||
      calendar.toISOString().slice(0, 10) !== civil ||
      Number(input.expiresAt.slice(11, 13)) > 23 ||
      Number(input.expiresAt.slice(14, 16)) > 59 ||
      Number(input.expiresAt.slice(17, 19)) > 59
    )
      fail(422, "INVALID_CONSENT_EXPIRATION");
  }
  if (
    !Number.isFinite(+expiration) ||
    expiration <= clock.now ||
    expiration > clock.max_expiration
  )
    fail(422, "INVALID_CONSENT_EXPIRATION");
  return { delegate, expiration, now: clock.now };
}
async function advance(ctx: Ctx, revision: number) {
  await ctx.c.query(
    "INSERT INTO administration_indicator_consent_books(organization_id,subject_member_id,revision) VALUES($1,$2,$3) ON CONFLICT(organization_id,subject_member_id) DO UPDATE SET revision=$3",
    [ctx.org.id, ctx.member.id, revision],
  );
  // History is inserted after the consent exists, but both remain in this UoW.
  return async (snapshot: unknown) =>
    ctx.c.query(
      "INSERT INTO administration_indicator_consent_history(organization_id,subject_member_id,book_revision,snapshot,actor_id) VALUES($1,$2,$3,$4,$5)",
      [ctx.org.id, ctx.member.id, revision, snapshot, ctx.account.id],
    );
}
export function registerMemberIndicatorConsents(
  app: FastifyInstance,
  core: ModuleRuntime,
) {
  const base =
    "/api/v1/organizations/:organizationId/administration/member-indicator-consents";
  app.get(base + "/me", (r) =>
    core.tenant(r, false, async (ctx) => {
      await own(ctx);
      const rows = (
        await ctx.c.query(
          "SELECT c.*,m.status AS delegate_status,m.member_type AS delegate_type,clock_timestamp() AS db_now FROM administration_indicator_consents c JOIN members m ON m.organization_id=c.organization_id AND m.id=c.delegate_member_id WHERE c.organization_id=$1 AND c.subject_member_id=$2 ORDER BY c.created_at DESC,c.id",
          [ctx.org.id, ctx.member.id],
        )
      ).rows;
      return {
        subjectMemberId: ctx.member.id,
        revision: await book(ctx),
        consents: rows.map((row) => present(row, row.db_now)),
        capabilities: { consentOwn: true },
      };
    }),
  );
  app.get(base + "/received", (r) =>
    core.tenant(r, false, async (ctx) => {
      await own(ctx);
      const rows = (
        await ctx.c.query(
          "SELECT c.id,c.subject_member_id,c.actions,c.version,c.expires_at FROM administration_indicator_consents c JOIN members m ON m.organization_id=c.organization_id AND m.id=c.subject_member_id WHERE c.organization_id=$1 AND c.delegate_member_id=$2 AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND m.status='ACTIVE' AND m.member_type='MEMBER' ORDER BY c.created_at DESC,c.id",
          [ctx.org.id, ctx.member.id],
        )
      ).rows;
      return {
        consents: rows.map((row) => ({
          id: row.id,
          subjectMemberId: row.subject_member_id,
          actions: row.actions,
          version: row.version,
          expiresAt: iso(row.expires_at),
        })),
      };
    }),
  );
  const authorize =
    (r: FastifyRequest, consentId?: string, revoke = false) =>
    async (ctx: Ctx) => {
      await own(ctx);
      if (consentId) {
        const row = await existing(ctx, consentId);
        if (!revoke && row.revoked_at) fail(409, "INDICATOR_CONSENT_REVOKED");
      }
      if (!revoke) {
        const delegate = await liveMember(
          ctx,
          id((r.body as any)?.delegateMemberId),
        );
        if (!eligible(delegate)) fail(404, "RESOURCE_NOT_FOUND");
      }
      return true;
    };
  const save = (r: FastifyRequest, consentId?: string) =>
    core.tenant(
      r,
      { mode: "authorization_write", authorize: authorize(r, consentId) },
      async (ctx) => {
        const next = await candidate(ctx, r),
          revision = await book(ctx);
        version(r, revision);
        const previous = consentId ? await existing(ctx, consentId) : null;
        const nextId = previous?.id ?? uuid(),
          nextVersion = (previous?.version ?? 0) + 1;
        const history = await advance(ctx, revision + 1);
        const row = (
          await ctx.c.query(
            "INSERT INTO administration_indicator_consents(organization_id,id,subject_member_id,delegate_member_id,actions,version,expires_at) VALUES($1,$2,$3,$4,ARRAY['DEFINE']::text[],$5,$6) ON CONFLICT(organization_id,id) DO UPDATE SET delegate_member_id=$4,version=$5,expires_at=$6 RETURNING *",
            [
              ctx.org.id,
              nextId,
              ctx.member.id,
              next.delegate.id,
              nextVersion,
              next.expiration,
            ],
          )
        ).rows[0];
        const consent = present(
          {
            ...row,
            delegate_status: next.delegate.status,
            delegate_type: next.delegate.member_type,
          },
          next.now,
        );
        await history(consent);
        await core.changed(
          ctx,
          r,
          nextId,
          previous
            ? "MemberIndicatorConsentUpdated"
            : "MemberIndicatorConsentGranted",
        );
        return { consent, revision: revision + 1 };
      },
    );
  app.post(base, async (r, reply) => {
    const result = await save(r);
    return reply.code(201).send(result);
  });
  app.put(base + "/:consentId", (r) =>
    save(r, id((r.params as any).consentId)),
  );
  app.post(base + "/:consentId/revoke", (r) =>
    core.tenant(
      r,
      {
        mode: "authorization_write",
        authorize: authorize(r, id((r.params as any).consentId), true),
      },
      async (ctx) => {
        body(r, []);
        const revision = await book(ctx);
        version(r, revision);
        const current = await existing(ctx, id((r.params as any).consentId));
        if (current.revoked_at)
          return { consent: present(current, current.db_now), revision };
        const row = (
          await ctx.c.query(
            "UPDATE administration_indicator_consents SET revoked_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
            [ctx.org.id, current.id],
          )
        ).rows[0];
        const consent = present(
          {
            ...row,
            delegate_status: current.delegate_status,
            delegate_type: current.delegate_type,
          },
          current.db_now,
        );
        const history = await advance(ctx, revision + 1);
        await history(consent);
        await core.changed(ctx, r, current.id, "MemberIndicatorConsentRevoked");
        return { consent, revision: revision + 1 };
      },
    ),
  );
}

import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { fail, id } from "../../src/core.js";
import { object } from "./domain.js";
import type { StructurePortsOptions } from "./ports.js";
import type {
  IndicatorSubject,
  MemberIndicatorAction,
  MemberIndicatorAuthority,
} from "./profile-capacity-contract.js";

export function storedIndicatorSubject(row: any): IndicatorSubject {
  if (row.subject_kind === "MEMBER")
    return { kind: "MEMBER", memberId: id(row.member_id).toLowerCase() };
  if (row.subject_kind === "CIRCLE")
    return { kind: "CIRCLE", circleId: id(row.entity_id).toLowerCase() };
  if (row.subject_kind === "ROLE")
    return { kind: "ROLE", roleId: id(row.entity_id).toLowerCase() };
  return fail(503, "INDICATOR_SUBJECT_INVALID");
}
export function indicatorSubjectId(subject: IndicatorSubject): string {
  return subject.kind === "MEMBER"
    ? subject.memberId
    : subject.kind === "CIRCLE"
      ? subject.circleId
      : subject.roleId;
}
export async function resolveIndicatorSubject(
  ctx: Ctx,
  core: ModuleRuntime,
  input: { entityId?: unknown; subject?: unknown },
): Promise<IndicatorSubject> {
  if (input.entityId !== undefined && input.subject !== undefined)
    fail(422, "INDICATOR_SUBJECT_AMBIGUOUS");
  if (input.subject === undefined) {
    const entity = await core.get(ctx.c, ctx.org.id, id(input.entityId));
    return entity.kind === "CIRCLE"
      ? { kind: "CIRCLE", circleId: entity.id }
      : { kind: "ROLE", roleId: entity.id };
  }
  const value = object(input.subject, [
    "kind",
    "circleId",
    "roleId",
    "memberId",
  ]);
  const keys = Object.keys(value);
  const key =
    value.kind === "CIRCLE"
      ? "circleId"
      : value.kind === "ROLE"
        ? "roleId"
        : value.kind === "MEMBER"
          ? "memberId"
          : null;
  if (!key || keys.length !== 2 || !keys.includes(key))
    fail(422, "INVALID_INDICATOR_SUBJECT");
  const subjectId = id(value[key!]).toLowerCase();
  if (value.kind === "MEMBER") return { kind: "MEMBER", memberId: subjectId };
  await core.get(ctx.c, ctx.org.id, subjectId, value.kind);
  return value.kind === "CIRCLE"
    ? { kind: "CIRCLE", circleId: subjectId }
    : { kind: "ROLE", roleId: subjectId };
}

/** Only trusted Admin composition may produce authority. No local SELF/OWNER fallback. */
export async function authorizeMemberIndicator(
  ctx: Ctx,
  options: StructurePortsOptions,
  memberId: string,
  action: MemberIndicatorAction,
): Promise<boolean> {
  memberId = id(memberId).toLowerCase();
  if (!options.memberIndicatorAuthority)
    fail(503, "SUBJECT_AUTHORITY_UNAVAILABLE");
  const actor = (
    await ctx.c.query(
      "SELECT status,member_type FROM members WHERE organization_id=$1 AND id=$2 AND account_id=$3",
      [ctx.org.id, ctx.member.id, ctx.account.id],
    )
  ).rows[0];
  if (!actor || actor.status !== "ACTIVE" || actor.member_type !== "MEMBER")
    return false;
  async function decision(
    requested: MemberIndicatorAction,
  ): Promise<MemberIndicatorAuthority> {
    const result = await options.memberIndicatorAuthority!.authorize(ctx, {
      memberId,
      action: requested,
    });
    const actual = (
      await ctx.c.query(
        "SELECT m.version,m.status,m.member_type,o.authorization_revision FROM members m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.id=$2",
        [ctx.org.id, memberId],
      )
    ).rows[0];
    if (!actual) fail(404, "RESOURCE_NOT_FOUND");
    if (
      !result ||
      typeof result.allowed !== "boolean" ||
      result.organizationId !== ctx.org.id ||
      result.actorMemberId !== ctx.member.id ||
      result.subjectMemberId !== memberId ||
      result.action !== requested ||
      result.subjectVersion !== actual.version ||
      result.organizationAuthorizationRevision !==
        Number(actual.authorization_revision) ||
      !Array.isArray(result.reasons)
    )
      fail(503, "SUBJECT_AUTHORITY_INVALID");
    if (!result.allowed) {
      if (result.reasons.length) fail(503, "SUBJECT_AUTHORITY_INVALID");
      return result;
    }
    if (
      !result.reasons.length ||
      result.reasons.some((reason) =>
        reason.kind === "SELF"
          ? ctx.member.id !== memberId || requested === "DEFINE"
          : reason.kind !== "EXPLICIT_GRANT" ||
            typeof reason.grantId !== "string" ||
            !Number.isSafeInteger(reason.grantRevision) ||
            reason.grantRevision! < 1,
      )
    )
      fail(503, "SUBJECT_AUTHORITY_INVALID");
    if (
      actual.member_type !== "MEMBER" ||
      (requested !== "READ" && actual.status !== "ACTIVE")
    )
      return { ...result, allowed: false, reasons: [] };
    return result;
  }
  const result = await decision(action);
  if (!result.allowed) return false;
  if (action === "RECORD" && !(await decision("READ")).allowed)
    fail(503, "SUBJECT_AUTHORITY_INCONSISTENT");
  return true;
}

import type { Ctx } from "./runtime.js";
import { lockActiveOrganization } from "./organization-lifecycle.js";
import { transaction } from "./db.js";
import { id, fail } from "./core.js";
export async function validateActiveMembers(
  ctx: Ctx,
  ids: string[],
): Promise<boolean> {
  if (!Array.isArray(ids) || ids.length > 1000) return false;
  const unique = [...new Set(ids.map((value) => id(value)))];
  if (!unique.length) return true;
  return (
    (
      await ctx.c.query(
        "SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",
        [ctx.org.id, unique],
      )
    ).rowCount === unique.length
  );
}
export async function withWorkerContext<T>(
  organizationId: string,
  memberId: string,
  fn: (ctx: Ctx) => Promise<T>,
  guestAuthorization?: (ctx: Ctx) => Promise<void>,
): Promise<T> {
  return transaction(async (c) => {
    const orgId = id(organizationId),
      mid = id(memberId);
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      orgId,
    ]);
    const org = await lockActiveOrganization(c, orgId);
    const member = (
      await c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
        [orgId, mid],
      )
    ).rows[0];
    if (!org || !member) fail(404, "RESOURCE_NOT_FOUND");
    const account = (
      await c.query("SELECT id,email,display_name FROM accounts WHERE id=$1", [
        member.account_id,
      ])
    ).rows[0];
    if (!account) fail(404, "RESOURCE_NOT_FOUND");
    const ctx: Ctx = { c, org, member, account, mode: "write" };
    if (member.member_type === "GUEST") {
      if (!guestAuthorization) fail(404, "RESOURCE_NOT_FOUND");
      await guestAuthorization!(ctx);
    }
    return fn(ctx);
  });
}

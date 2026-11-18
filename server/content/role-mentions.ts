import {
  collectRoleMentionIds,
  ContentValidationError,
  RICH_TEXT_FORMAT,
} from "../../packages/content/index.js";
import { fail } from "../src/core.js";
import type { Ctx } from "../src/runtime.js";

/**
 * Validate identity references in normalized content/payload, in the caller's
 * tenant transaction. Plain strings and structural entityId fields are not
 * interpreted as mentions. Existing references to archived roles remain valid;
 * role availability for inserting new mentions belongs to the chooser.
 */
export async function validateRoleMentions(
  ctx: Ctx,
  values: unknown,
): Promise<void> {
  const ids = new Set<string>(),
    seen = new Set<object>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (
      !Array.isArray(value) &&
      "format" in value &&
      value.format === RICH_TEXT_FORMAT
    ) {
      for (const roleId of collectRoleMentionIds(value)) ids.add(roleId);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  }
  try {
    visit(values);
  } catch (error) {
    if (error instanceof ContentValidationError)
      fail(422, "INVALID_RICH_DOCUMENT");
    throw error;
  }
  if (!ids.size) return;
  if (
    ctx.member.member_type !== "MEMBER" ||
    ctx.member.status !== "ACTIVE" ||
    ctx.member.organization_id !== ctx.org.id ||
    ctx.member.account_id !== ctx.account.id
  )
    fail(422, "INVALID_ROLE_MENTION");
  const rows = (
    await ctx.c.query(
      "SELECT id FROM entities WHERE organization_id=$1 AND kind='ROLE' AND id=ANY($2::uuid[])",
      [ctx.org.id, [...ids]],
    )
  ).rows;
  const available = new Set(rows.map((row) => String(row.id).toLowerCase()));
  // Missing, foreign and non-role IDs have the same response, without names.
  if ([...ids].some((roleId) => !available.has(roleId)))
    fail(422, "INVALID_ROLE_MENTION");
}

import {validateRoleMentions} from "../../content/role-mentions.js";
import {
  ContentValidationError,
  toPlainText,
  validateRichDocument,
  type RichDocument,
} from "../../../packages/content/index.js";
import { fail, id } from "../../src/core.js";
import type { Ctx } from "../../src/runtime.js";

export type EntityPurpose = {
  purpose: string;
  purposeRich: RichDocument | null;
};
export type PurposeChange = { purpose?: unknown; purposeRich?: unknown };

/** Explicit rich transport only. Legacy strings, including JSON/HTML, stay literal. */
export function normalizePurposeChange(
  input: PurposeChange,
): EntityPurpose | undefined {
  const plainProvided = input.purpose !== undefined;
  const richProvided = input.purposeRich !== undefined;
  if (!plainProvided && !richProvided) return undefined;
  if (
    plainProvided &&
    input.purpose !== null &&
    (typeof input.purpose !== "string" || [...input.purpose].length > 10000)
  )
    fail(422, "INVALID_PURPOSE");
  if (richProvided && input.purposeRich !== null) {
    let rich: RichDocument;
    try {
      rich = validateRichDocument(input.purposeRich);
    } catch (error) {
      if (error instanceof ContentValidationError)
        fail(422, "INVALID_PURPOSE_RICH");
      throw error;
    }
    const purpose = toPlainText(rich);
    if ([...purpose].length > 10000) fail(422, "INVALID_PURPOSE");
    if (plainProvided && input.purpose !== purpose)
      fail(422, "PURPOSE_TEXT_MISMATCH");
    return { purpose, purposeRich: rich };
  }
  return {
    purpose: plainProvided ? ((input.purpose as string | null) ?? "") : "",
    purposeRich: null,
  };
}

export function readPurposeRow(row: {
  purpose: string;
  purpose_rich?: unknown;
}): EntityPurpose {
  if (row.purpose_rich === undefined || row.purpose_rich === null)
    return { purpose: row.purpose, purposeRich: null };
  return normalizePurposeChange({
    purpose: row.purpose,
    purposeRich: row.purpose_rich,
  })!;
}

/** Trusted foundation composition hook. Caller owns ACL, preflight and version bump. */
export async function writeEntityPurpose(
  ctx: Ctx,
  input: PurposeChange & {
    entityId: string;
    entityVersion: number;
  },
): Promise<EntityPurpose> {
  if (ctx.mode !== "authorization_write") fail(403, "ACTION_DENIED");
  if (!Number.isSafeInteger(input.entityVersion) || input.entityVersion < 1)
    fail(400, "INVALID_REQUEST");
  const eid = id(input.entityId);
  const row = (
    await ctx.c.query(
      "SELECT purpose,purpose_rich,version FROM entities WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [ctx.org.id, eid],
    )
  ).rows[0];
  if (!row) fail(404, "RESOURCE_NOT_FOUND");
  if (row.version !== input.entityVersion) fail(409, "VERSION_CONFLICT");
  const change = normalizePurposeChange(input);
  if (!change) return readPurposeRow(row);
  await validateRoleMentions(ctx,change);
  await ctx.c.query(
    "UPDATE entities SET purpose=$3,purpose_rich=$4 WHERE organization_id=$1 AND id=$2",
    [
      ctx.org.id,
      eid,
      change.purpose,
      change.purposeRich === null ? null : JSON.stringify(change.purposeRich),
    ],
  );
  return change;
}

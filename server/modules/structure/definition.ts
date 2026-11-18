import { fail, id, text } from "../../src/core.js";
import type { Ctx } from "../../src/runtime.js";
import {
  ContentValidationError,
  toPlainText,
  validateRichDocument,
  type RichDocument,
} from "../../../packages/content/index.js";
import { validateRoleMentions } from "../../content/role-mentions.js";

export type DefinitionItem = {
  id: string;
  text: string;
  richText?: RichDocument;
};
export type DefinitionChange = {
  responsibilities?: unknown;
  artifacts?: unknown;
};

/** Whole-list replacement under the existing entity version, with stable item IDs. */
export function definitionItems(value: unknown): DefinitionItem[] {
  if (!Array.isArray(value) || value.length > 100) fail(400, "INVALID_REQUEST");
  const items = (value as unknown[]).map((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some((key) => !["id", "text", "richText"].includes(key))
    )
      fail(400, "INVALID_REQUEST");
    const item = raw as Record<string, unknown>;
    const itemId = id(item.id);
    if (item.richText === undefined)
      return { id: itemId, text: text(item.text, 10000) };
    try {
      const richText = validateRichDocument(item.richText);
      const projection = toPlainText(richText);
      // Preserve rich paragraph/whitespace boundaries, while keeping the
      // explicit text projection exact and safe for legacy read surfaces.
      if (item.text !== projection) fail(422, "DEFINITION_CONTENT_MISMATCH");
      text(projection, 10000);
      if ([...projection].length > 10000) fail(400, "INVALID_REQUEST");
      return { id: itemId, text: projection, richText };
    } catch (error) {
      if (error instanceof ContentValidationError)
        fail(422, "INVALID_RICH_DOCUMENT");
      throw error;
    }
  });
  if (new Set(items.map((item) => item.id.toLowerCase())).size !== items.length)
    fail(422, "DUPLICATE_DEFINITION_ITEM");
  return items;
}

export function normalizeDefinitionChange(input: DefinitionChange) {
  return {
    ...(input.responsibilities === undefined
      ? {}
      : { responsibilities: definitionItems(input.responsibilities) }),
    ...(input.artifacts === undefined
      ? {}
      : { artifacts: definitionItems(input.artifacts) }),
  };
}

/** Foundation owns authorization, preflight, version increment and history. */
export async function writeEntityDefinition(
  ctx: Ctx,
  input: DefinitionChange & { entityId: string; entityVersion: number },
) {
  if (ctx.mode === "read") fail(403, "ACTION_DENIED");
  if (!Number.isSafeInteger(input.entityVersion) || input.entityVersion < 1)
    fail(400, "INVALID_REQUEST");
  const change = normalizeDefinitionChange(input);
  if (!Object.keys(change).length) return;
  await validateRoleMentions(ctx, change);
  const result = await ctx.c.query(
    `UPDATE entities SET responsibilities=coalesce($4::jsonb,responsibilities),
      artifacts=coalesce($5::jsonb,artifacts)
      WHERE organization_id=$1 AND id=$2 AND version=$3 RETURNING responsibilities,artifacts`,
    [
      ctx.org.id,
      id(input.entityId),
      input.entityVersion,
      change.responsibilities === undefined
        ? null
        : JSON.stringify(change.responsibilities),
      change.artifacts === undefined ? null : JSON.stringify(change.artifacts),
    ],
  );
  if (!result.rowCount) fail(409, "VERSION_CONFLICT");
  return result.rows[0] as {
    responsibilities: DefinitionItem[];
    artifacts: DefinitionItem[];
  };
}

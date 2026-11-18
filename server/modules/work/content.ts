import {
  validateRichDocument,
  toPlainText,
  ContentValidationError,
  type RichDocument,
} from "../../../packages/content/index.js";
import { fail, optionalText } from "../../src/core.js";
/** Plain legacy text is never parsed as HTML or JSON. Rich objects are explicit and closed-schema validated. */
export function richDescriptionBody<T extends Record<string, any>>(
  b: T,
): T & { descriptionRich?: RichDocument } {
  if (b.descriptionRich === undefined) return b;
  let document: RichDocument;
  try {
    document = validateRichDocument(b.descriptionRich);
  } catch (e) {
    if (e instanceof ContentValidationError)
      return fail(400, "INVALID_RICH_DESCRIPTION");
    throw e;
  }
  const plain = toPlainText(document);
  if (plain.length > 10000) fail(400, "DESCRIPTION_TOO_LONG");
  if (
    b.description !== undefined &&
    b.description !== null &&
    b.description !== plain
  )
    fail(400, "RICH_DESCRIPTION_CONFLICT");
  return { ...b, description: plain, descriptionRich: document };
}
export const nextRichDescription = (
  b: Record<string, any>,
  old?: { description_rich?: unknown },
) =>
  b.descriptionRich ??
  (b.description !== undefined ? null : (old?.description_rich ?? null));

export const descriptionPlain = (b: Record<string, any>) =>
  b.descriptionRich !== undefined ? b.description : optionalText(b.description);

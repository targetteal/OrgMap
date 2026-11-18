import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fail, id } from "../../src/core.js";
const configuredKey = process.env.ORGMAP_CURSOR_SECRET;
const signingKey =
  configuredKey && configuredKey.length >= 32
    ? configuredKey
    : randomBytes(32).toString("hex");
export function cursor(
  position: { startAt: string; id: string },
  scope: string,
) {
  const value = Buffer.from(
    JSON.stringify({ ...position, scope, v: 1 }),
  ).toString("base64url");
  return (
    value +
    "." +
    createHmac("sha256", signingKey).update(value).digest("base64url")
  );
}
export function pageInput(query: any, scope: string) {
  if (
    query.limit !== undefined &&
    (typeof query.limit !== "string" || !/^\d{1,3}$/.test(query.limit))
  )
    fail(400, "INVALID_PAGINATION");
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail(400, "INVALID_PAGINATION");
  if (query.cursor === undefined)
    return { limit, startAt: null as string | null, id: null as string | null };
  try {
    if (typeof query.cursor !== "string" || query.cursor.length > 1500)
      throw Error();
    const [value, signature, ...extra] = query.cursor.split("."),
      expected = createHmac("sha256", signingKey).update(value).digest(),
      actual = Buffer.from(signature, "base64url");
    if (
      extra.length ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      parsed.v !== 1 ||
      parsed.scope !== scope ||
      !Number.isFinite(Date.parse(parsed.startAt))
    )
      throw Error();
    return { limit, startAt: parsed.startAt as string, id: id(parsed.id) };
  } catch {
    return fail(400, "INVALID_CURSOR");
  }
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fail } from "../../src/core.js";
const signingKey =
  process.env.GOALS_CURSOR_SECRET ?? randomBytes(32).toString("hex");
/** Cursor binds tenant, exact filter, order and current authorization revision; no resource content in token. */
export function page<T extends { id: string }>(
  items: T[],
  org: string,
  revision: number,
  query: Record<string, unknown>,
) {
  const limit =
    query.limit === undefined
      ? 50
      : typeof query.limit === "string" &&
          /^(?:[1-9]|[1-9]\d|100)$/.test(query.limit)
        ? Number(query.limit)
        : fail(400, "INVALID_REQUEST");
  const filter = JSON.stringify(
    Object.fromEntries(
      Object.entries(query)
        .filter(([k]) => !["limit", "cursor"].includes(k))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  let start = 0;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string" || query.cursor.length > 4000)
      fail(400, "INVALID_REQUEST");
    try {
      const [token, signature, ...extra] = (query.cursor as string).split(".");
      const actual = Buffer.from(signature, "base64url"),
        expected = createHmac("sha256", signingKey).update(token).digest();
      if (
        extra.length ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw Error();
      const decoded = JSON.parse(Buffer.from(token, "base64url").toString());
      if (
        decoded.org !== org ||
        decoded.filter !== filter ||
        decoded.revision !== revision ||
        decoded.order !== "createdAt,id"
      )
        throw Error();
      const index = items.findIndex((i) => i.id === decoded.last);
      if (index < 0) throw Error();
      start = index + 1;
    } catch {
      fail(400, "INVALID_CURSOR");
    }
  }
  const selected = items.slice(start, start + limit),
    hasMore = start + limit < items.length;
  let nextCursor: string | null = null;
  if (hasMore) {
    const token = Buffer.from(
      JSON.stringify({
        org,
        revision,
        filter,
        order: "createdAt,id",
        last: selected.at(-1)!.id,
      }),
    ).toString("base64url");
    nextCursor =
      token +
      "." +
      createHmac("sha256", signingKey).update(token).digest("base64url");
  }
  return {
    items: selected,
    page: { hasMore, nextCursor },
    total: items.length,
  };
}

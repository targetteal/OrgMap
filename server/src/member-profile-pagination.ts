import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fail } from "./core.js";
import type { Ctx } from "./runtime.js";
export type MemberProfileAuthority = (ctx: Ctx, memberId: string) => Promise<void>;

// A process-local key is safe by default: restart invalidates cursors, not ACLs.
const signingKey = process.env.ORGMAP_PROFILE_CURSOR_SECRET ?? randomBytes(32).toString("hex");
if (Buffer.byteLength(signingKey) < 32) throw Error("PROFILE_CURSOR_SECRET_TOO_SHORT");
export type ProfileCoverage = {
  scope: "CURRENT_VIEWER_AUTHORIZED_RELATIONS";
  completeness: "COMPLETE" | "PARTIAL";
  limitations: "ROLE_CAPACITY_UNAVAILABLE"[];
};

/** Only pass relations already filtered through the owning resource's current ACL. */
export async function memberProfilePage<T extends { id: string }>(
  ctx: Ctx, target: string, kind: "PROJECT" | "GOAL", query: Record<string, unknown>,
  authorized: T[], coverage: ProfileCoverage,
) {
  if (Object.keys(query).some((key) => !["limit", "cursor"].includes(key))) fail(400, "INVALID_REQUEST");
  const limit = query.limit === undefined ? 50 :
    typeof query.limit === "string" && /^(?:[1-9]|[1-9]\d|100)$/.test(query.limit)
      ? Number(query.limit) : fail(400, "INVALID_REQUEST");
  const binding = { org: ctx.org.id, actor: ctx.member.id, account: ctx.account.id,
    target, kind, revision: ctx.org.authorization_revision, limit };
  let start = 0;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string" || query.cursor.length > 4000) fail(400, "INVALID_CURSOR");
    try {
      const [payload, signature, ...extra] = (query.cursor as string).split(".");
      const actual = Buffer.from(signature, "base64url");
      const expected = createHmac("sha256", signingKey).update(payload).digest();
      if (extra.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error();
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
      for (const [key, value] of Object.entries(binding)) if (decoded[key] !== value) throw Error();
      const index = authorized.findIndex((item) => item.id === decoded.last);
      if (index < 0) throw Error();
      start = index + 1;
    } catch { fail(400, "INVALID_CURSOR"); }
  }
  const items = authorized.slice(start, start + limit);
  let nextCursor: string | null = null;
  if (start + limit < authorized.length) {
    const token = Buffer.from(JSON.stringify({ ...binding, last: items.at(-1)!.id })).toString("base64url");
    nextCursor = token + "." + createHmac("sha256", signingKey).update(token).digest("base64url");
  }
  const asOf = (await ctx.c.query("SELECT clock_timestamp() AS time")).rows[0].time.toISOString();
  return { items, nextCursor, asOf, coverage };
}

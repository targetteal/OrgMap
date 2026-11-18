import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fail, id } from "../../src/core.js";
const signingKey = randomBytes(32);
const signature = (body: string) =>
  createHmac("sha256", signingKey).update(body).digest("base64url");
export function cursor(after: string, scope: string) {
  const body = Buffer.from(JSON.stringify({ after, scope })).toString(
    "base64url",
  );
  return body + "." + signature(body);
}
export function pageInput(query: any, scope: string) {
  const limit = query?.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail(400, "INVALID_REQUEST");
  let after = "00000000-0000-0000-0000-000000000000";
  if (query?.cursor) {
    try {
      const [body, mac, ...rest] = String(query.cursor).split(".");
      if (rest.length || !body || !mac) throw Error();
      const expected = signature(body);
      if (
        expected.length !== mac.length ||
        !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
      )
        throw Error();
      const decoded = JSON.parse(Buffer.from(body, "base64url").toString());
      if (decoded.scope !== scope) throw Error();
      after = id(decoded.after);
    } catch {
      fail(400, "INVALID_CURSOR");
    }
  }
  return { limit, after };
}

import type { PoolClient } from "pg";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { digest, fail } from "../../src/core.js";
export type LinkAccountStamp = { sessionId: string; emailRevision: number };
export async function captureLinkAccountStamp(core: ModuleRuntime, ctx: Ctx): Promise<LinkAccountStamp> {
  if (ctx.principal || !ctx.account.session_id) fail(403, "COOKIE_SESSION_REQUIRED");
  return { sessionId: ctx.account.session_id, emailRevision: await core.accountEmailRevision(ctx.c, ctx.account.id) };
}
/** Account→Session only: global callers never acquire Org; tenant LINK callers already hold Org. */
export async function assertLinkAccountStamp(core: ModuleRuntime, c: PoolClient, accountId: string, stamp: LinkAccountStamp | undefined, browser?: { token: string | undefined }) {
  if (!stamp?.sessionId || !Number.isSafeInteger(stamp.emailRevision) || stamp.emailRevision < 1 || (browser && !browser.token)) fail(403, "ACCOUNT_PROOF_STALE");
  const account = await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [accountId]);
  if (!account.rowCount) fail(403, "ACCOUNT_PROOF_STALE");
  await core.assertAccountEmailRevision(c, accountId, stamp!.emailRevision);
  const live = await c.query("SELECT id FROM sessions WHERE id=$1 AND account_id=$2 AND expires_at>clock_timestamp() AND ($3::text IS NULL OR token_hash=$3) FOR SHARE", [stamp!.sessionId, accountId, browser ? digest(browser.token!) : null]);
  if (!live.rowCount) fail(403, "ACCOUNT_PROOF_STALE");
}

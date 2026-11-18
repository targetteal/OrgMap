import type { PoolClient } from "pg";
import { fail, id } from "./core.js";
import type { OrganizationLifecycle } from "./organization-lifecycle-contract.js";

/** Lifecycle fencing relies on fresh statement snapshots after waiting for Org. */
export async function requireLifecycleReadCommitted(c: PoolClient): Promise<void> {
  if ((await c.query("SELECT current_setting('transaction_isolation') AS level")).rows[0].level !== "read committed")
    fail(503, "LIFECYCLE_ISOLATION_UNSUPPORTED");
}

/** Call inside a transaction, before Account/session/other local locks or replay.
 * The org lock serializes against a future cutover; absent metadata fails closed.
 * Special-purpose callers must set their own RLS context before calling.
 */
export async function lockOrganizationIfActive(c: PoolClient, organizationId: string) {
  await requireLifecycleReadCommitted(c);
  // Separate statements are essential at READ COMMITTED: a joined statement can
  // take its snapshot before waiting for the organization lock and see stale state.
  const org = (await c.query(
    "SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [organizationId],
  )).rows[0];
  if (!org) return null;
  const lifecycle: OrganizationLifecycle | undefined = (await c.query(
    "SELECT state, fence::text AS fence FROM organization_lifecycle WHERE organization_id=$1",
    [organizationId],
  )).rows[0];
  if (!lifecycle || lifecycle.state !== "ACTIVE") return null;
  return org;
}

export async function lockActiveOrganization(c: PoolClient, organizationId: string) {
  const org = await lockOrganizationIfActive(c, organizationId);
  if (!org) fail(404, "RESOURCE_NOT_FOUND");
  return org;
}

/** Pure predicate; lifecycle status comes from the caller's DB read, not Interop. */
export function hasIndependentLoginMethod(
  passwordEnabled: boolean,
  closingOrganizationId: string,
  methods: readonly import("./organization-lifecycle-contract.js").LifecycleFederatedMethod[],
  activeOrganizations: ReadonlySet<string>,
): boolean {
  return passwordEnabled || methods.some((method) =>
    (method.kind === "OIDC" || method.kind === "SAML") &&
    method.enabled === true && method.verified === true &&
    method.organizationId.toLowerCase() !== closingOrganizationId.toLowerCase() &&
    activeOrganizations.has(method.organizationId.toLowerCase()));
}

/**
 * Must run in a transaction that holds no Account or session locks on entry.
 * The caller MUST commit its cutover in this transaction while these locks are
 * held; this function is not a stand-alone authorization or proof of readiness.
 * Every identity/method writer, including Interop, must use the same Account
 * locks, and affected identities must serialize on the org lock before discovery.
 * Until those integrations exist this helper must not enable deletion.
 */
export async function lockAndCheckOrganizationAuthContinuity(
  c: PoolClient,
  organizationId: string,
  port: import("./organization-lifecycle-contract.js").LifecycleAuthMethodsPort | undefined,
): Promise<{ affectedCount: number }> {
  if (!port) fail(503, "AUTH_CONTINUITY_UNAVAILABLE");
  organizationId = id(organizationId).toLowerCase();
  await lockActiveOrganization(c, organizationId);
  const accounts = [...new Set((await port!.affectedAccountIds(c, organizationId)).map(value => id(value).toLowerCase()))].sort();
  if (!accounts.length) return { affectedCount: 0 };
  const rows = (await c.query(
    "SELECT id,password_enabled FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [accounts],
  )).rows;
  if (rows.length !== accounts.length) fail(503, "AUTH_CONTINUITY_UNAVAILABLE");
  let affectedCount = 0;
  for (const account of rows) {
    const methods = await port!.methodsForAccount(c, account.id);
    // Discovery may include revoked connections, suspended memberships or
    // unconfigured adapters. Only usable methods in A are affected by its cut.
    if (!methods.some((method) =>
      id(method.organizationId).toLowerCase() === organizationId &&
      (method.kind === "OIDC" || method.kind === "SAML") &&
      method.enabled === true && method.verified === true)) continue;
    affectedCount++;
    if (account.password_enabled === true) continue;
    const alternativeIds = [...new Set(methods.map((method) => id(method.organizationId).toLowerCase())
      .filter((value) => value !== organizationId))];
    const active = alternativeIds.length ? (await c.query(
      "SELECT organization_id FROM organization_lifecycle WHERE organization_id=ANY($1::uuid[]) AND state='ACTIVE'",
      [alternativeIds],
    )).rows.map((row) => row.organization_id as string) : [];
    if (!hasIndependentLoginMethod(false, organizationId, methods, new Set(active)))
      fail(409, "AUTH_CONTINUITY_REQUIRED");
  }
  return { affectedCount };
}

import { lockActiveOrganization } from "./organization-lifecycle.js";
import { createGuestServices } from "./guest.js";
import { createEnrollmentServices } from "./enrollment.js";
import { createSessionRecord } from "./sessions.js";
import type { SessionProvenance } from "./enrollment-contract.js";
import {
  validateActiveMembers,
  withWorkerContext as rawWorkerContext,
} from "./identity.js";
import { createMfaServices } from "./mfa.js";
import { createAccountSecurityServices } from "./account-security.js";
import { createAccountEmailServices } from "./account-email.js";
import { createAccountMediaServices } from "./account-media.js";
export type { AccountFederatedReauthenticationInput, AccountFederatedReauthenticationVerifier } from "./account-security-contract.js";
import { createCredentialPolicyServices } from "./credential-policy.js";
import { createAdmissionServices } from "./admission.js";
import { createPublicAdmissionServices } from "./admission-public.js";
import { createInvitationServices } from "./invitations.js";
import type { InvitationLifecycleNotifier } from "./invitation-lifecycle-contract.js";
import { deliverInvitationsSmtp } from "./mail.js";
import { sendLocalMail, type LocalMail } from "./smtp.js";
import type { FastifyRequest, FastifyInstance, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { pool, transaction } from "./db.js";
import {
  digest,
  commandHash,
  fail,
  id,
  key,
  event,
  secret,
  uuid,
  camel,
} from "./core.js";
export type TrustedPrincipal = {
  accountId: string;
  organizationId: string;
  credentialId: string;
  scopes: readonly string[];
};
export type PrincipalResolver = (input: {
  token: string;
  organizationId: string;
  request: FastifyRequest;
  c: PoolClient;
}) => Promise<TrustedPrincipal | null>;
export type FederatedIdentityResolver = (
  proof: unknown,
  c: PoolClient,
) => Promise<{ accountId: string; provenance?: SessionProvenance } | null>;
export type Ctx = {
  c: PoolClient;
  org: any;
  member: any;
  account: any;
  mode: "read" | "write" | "authorization_write";
  principal?: TrustedPrincipal;
  requestId?: string;
  lockedAccountIds?: ReadonlySet<string>;
};
export type NotificationPublisher = (ctx: Ctx, input: import("../../packages/contracts/notifications.js").NotificationIntent) => Promise<void>;
/** All tenant commands share the organization lock with revocation and structure edits. */
export type TenantOptions = {
  /** Trusted module owns durable multi-transaction create replay (never an HTTP option). */
  moduleManagedCreateIdempotency?: true;
  beforeReplay?: (ctx: Ctx, result: any) => Promise<void>;
  credentialStepUp?: true;
  mode: "read" | "write" | "authorization_write";
  authorize?: (ctx: Ctx) => Promise<boolean> | boolean;
  /** Presentation capabilities resolved inside the current tenant guard. */
  capabilities?: (ctx: Ctx) => Promise<Record<string, boolean>>;
  requiredScopes?: readonly string[];
  /** Trusted server-owned lookup under the Org lock, before any Account/session lock. */
  accountLocks?: (c: PoolClient, organizationId: string, request: FastifyRequest) => Promise<readonly string[]>;
};
export type FederatedCallbackRegistration = {
  method: "POST";
  path: string;
  allowedOrigins?: readonly string[];
  verify: (request: FastifyRequest) => Promise<unknown>;
};
export type LocalCircleAction =
  "MEMBERSHIP_MANAGE" | "CIRCLE_CONTENT_EDIT" | "CIRCLE_LOCAL_CONFIGURATION";
export interface FoundationStructurePort {
  writeEntityDefinition?(
    ctx: Ctx,
    input: { entityId: string; entityVersion: number; responsibilities?: unknown; artifacts?: unknown },
  ): Promise<{ responsibilities: {id:string;text:string}[]; artifacts: {id:string;text:string}[] } | undefined>;
  writeEntityPurpose?(
    ctx: Ctx,
    input: {
      entityId: string;
      entityVersion: number;
      purpose?: unknown;
      purposeRich?: unknown;
    },
  ): Promise<{
    purpose: string;
    purposeRich: import("../../packages/content/index.js").RichDocument | null;
  }>;
  preflightEntityChange(
    ctx: Ctx,
    input: {
      operation: "CREATE" | "UPDATE" | "MOVE" | "ARCHIVE";
      entityId?: string;
      circleId?: string;
      targetCircleId?: string;
      changedFields?: string[];
    },
  ): Promise<unknown>;
  recordFoundationChange(
    ctx: Ctx,
    input: {
      resourceId: string;
      action: string;
      before: unknown;
      after: unknown;
    },
  ): Promise<unknown>;
  validateOccupancy(
    ctx: Ctx,
    input: { roleId: string; memberId?:string; kind: string; startsAt?:string;endsAt?: string | null },
  ): Promise<unknown>;
  authorizeCircle(
    ctx: Ctx,
    circleId: string,
    action: "ADMIN" | "ASSIGN" | "RECORD" | "DECISION",
  ): Promise<boolean>;
  structureForest?(
    ctx: Ctx,
    input: { rootCircleId?: string; depth?: number },
  ): Promise<unknown>;
  readStructureEntity?(
    ctx: Ctx,
    entityId: string,
    kind?: string,
  ): Promise<unknown>;
  authorizeLocalCircle?(
    ctx: Ctx,
    circleId: string,
    action: LocalCircleAction,
  ): Promise<boolean>;
  membershipReasons(ctx: Ctx, memberId: string): Promise<unknown>;
}
export type OrganizationSettingsView = {
  version: number;
  settings: {
    name: string;
    locale: string;
    timezone: string;
    modules: Record<string, boolean>;
    branding?: unknown;
    vocabulary?: unknown;
    oversight?: unknown;
  };
};
export type ModuleName = "work" | "goals" | "governance" | "meetings";
export type ModuleScope = {
  module: ModuleName;
  routePrefixes: readonly string[];
  resourceTypes: readonly string[];
};
export type AvailabilityResolver = (
  ctx: Ctx,
  request: FastifyRequest,
) => Promise<ModuleName[]>;
export type AccountAuthMethod = {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
  verified: boolean;
};
export function createRuntime() {
  let governanceModelPort: import('../modules/o2/contract.js').GovernanceModelPort | undefined;
  function registerGovernanceModel(port: import('../modules/o2/contract.js').GovernanceModelPort) {
    if (governanceModelPort) throw Error('Governance model provider already registered');
    governanceModelPort = port;
  }
  const governanceModel = () => governanceModelPort;
  let settingsPort:
    ((ctx: Ctx) => Promise<OrganizationSettingsView>) | undefined;
  const scopes: ModuleScope[] = [];
  const resourceModules = new Map<string, ModuleName>();
  const availabilityResolvers: AvailabilityResolver[] = [];
  const settingsCache = new WeakMap<Ctx, OrganizationSettingsView>();
  function registerOrganizationSettings(
    provider: NonNullable<typeof settingsPort>,
  ) {
    if (settingsPort)
      throw Error("Organization settings provider already registered");
    settingsPort = provider;
  }
  function registerModuleScope(scope: ModuleScope) {
    if (
      !["work", "goals", "governance", "meetings"].includes(scope.module) ||
      scopes.some((s) => s.module === scope.module) ||
      scope.routePrefixes.some(
        (p) =>
          !p.startsWith("/api/v1/organizations/:organizationId/") ||
          p.includes("*") ||
          p.includes("?"),
      )
    )
      throw Error("Invalid module scope");
    for (const type of scope.resourceTypes) {
      if (resourceModules.has(type)) throw Error("Duplicate resource module");
      resourceModules.set(type, scope.module);
    }
    scopes.push(scope);
  }
  function registerAvailabilityResolver(resolver: AvailabilityResolver) {
    availabilityResolvers.push(resolver);
  }
  async function organizationSettings(
    ctx: Ctx,
  ): Promise<OrganizationSettingsView> {
    const cached = settingsCache.get(ctx);
    if (cached) return cached;
    const view = settingsPort
      ? await settingsPort(ctx)
      : {
          version: 0,
          settings: {
            name: ctx.org.name,
            locale: ctx.org.locale,
            timezone: ctx.org.time_zone,
            modules: { structure: true },
          },
        };
    if (
      !view ||
      !view.settings ||
      typeof view.settings.name !== "string" ||
      !view.settings.modules ||
      Object.values(view.settings.modules).some((v) => typeof v !== "boolean")
    )
      fail(503, "MODULE_CONFIGURATION_UNAVAILABLE");
    settingsCache.set(ctx, view);
    return view;
  }
  async function assertModuleAvailable(ctx: Ctx, module: ModuleName) {
    const view = await organizationSettings(ctx);
    if (view.settings.modules[module] === false) fail(403, "MODULE_DISABLED");
    if (view.settings.modules[module] !== true)
      fail(503, "MODULE_CONFIGURATION_UNAVAILABLE");
  }
  async function assertResourceAvailable(ctx: Ctx, type: string) {
    const module = resourceModules.get(type);
    if (module) await assertModuleAvailable(ctx, module);
  }
  async function requestAvailability(ctx: Ctx, request: FastifyRequest) {
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    for (const scope of scopes)
      if (
        scope.routePrefixes.some(
          (prefix) => route === prefix || route.startsWith(prefix + "/"),
        )
      )
        await assertModuleAvailable(ctx, scope.module);
    const resourceType =
      (request.params as any)?.resourceType ??
      (request.body as any)?.resourceType;
    if (typeof resourceType === "string")
      await assertResourceAvailable(ctx, resourceType);
    for (const resolver of availabilityResolvers)
      for (const module of await resolver(ctx, request))
        await assertModuleAvailable(ctx, module);
  }

  let structurePort: FoundationStructurePort | undefined;
  function registerFoundationStructure(port: FoundationStructurePort) {
    if (structurePort) throw Error("Structure port already registered");
    structurePort = port;
  }
  const foundationStructure = () => structurePort;

  let lifecycleAuthMethodsPort: import("./organization-lifecycle-contract.js").LifecycleAuthMethodsPort | undefined;
  function registerLifecycleAuthMethods(port: import("./organization-lifecycle-contract.js").LifecycleAuthMethodsPort) {
    if (lifecycleAuthMethodsPort) throw Error("Lifecycle auth methods port already registered");
    lifecycleAuthMethodsPort = port;
  }
  async function assertTargetAccountLocked(ctx: Ctx, accountId: string) {
    const target = id(accountId).toLowerCase();
    if (!ctx.lockedAccountIds?.has(target)) fail(503, "ACCOUNT_LOCK_REQUIRED");
    if (!(await ctx.c.query("SELECT 1 FROM accounts WHERE id=$1", [target])).rowCount)
      fail(404, "RESOURCE_NOT_FOUND");
  }

  let authMethodsPort:
    | ((c: PoolClient, accountId: string) => Promise<AccountAuthMethod[]>)
    | undefined;
  function registerAccountAuthMethods(
    port: NonNullable<typeof authMethodsPort>,
  ) {
    if (authMethodsPort) throw Error("Auth methods port already registered");
    authMethodsPort = port;
  }
  async function accountAuthMethods(
    c: PoolClient,
    accountId: string,
    localEnabled: boolean,
  ): Promise<AccountAuthMethod[]> {
    return [
      ...(localEnabled
        ? [
            {
              id: "local-password",
              kind: "PASSWORD",
              label: "Password",
              enabled: true,
              verified: true,
            },
          ]
        : []),
      ...(authMethodsPort ? await authMethodsPort(c, accountId) : []),
    ];
  }

  async function assertLoginMethodRemovalAllowed(
    c: PoolClient,
    accountId: string,
    removingMethodId: string,
  ) {
    const account = (
      await c.query(
        "SELECT id,password_enabled FROM accounts WHERE id=$1 FOR UPDATE",
        [id(accountId)],
      )
    ).rows[0];
    if (!account) fail(404, "RESOURCE_NOT_FOUND");
    const methods = await accountAuthMethods(
      c,
      account.id,
      account.password_enabled,
    );
    if (
      !methods.some(
        (method) =>
          method.id !== removingMethodId &&
          method.enabled === true &&
          method.verified === true,
      )
    )
      fail(422, "LAST_AUTH_METHOD_PROTECTED");
  }
  const federatedCallbacks = new Map<string, FederatedCallbackRegistration>();
  const callbackProofs = new WeakMap<FastifyRequest, unknown>();
  function registerFederatedCallback(
    registration: FederatedCallbackRegistration,
  ) {
    if (
      registration.method !== "POST" ||
      !registration.path.startsWith("/") ||
      registration.path.includes("*") ||
      registration.path.includes("?") ||
      federatedCallbacks.has(registration.method + " " + registration.path)
    )
      throw Error("Invalid or duplicate federation callback");
    for (const origin of registration.allowedOrigins ?? [])
      if (new URL(origin).origin !== origin)
        throw Error("Federation Origin must be exact");
    federatedCallbacks.set(
      registration.method + " " + registration.path,
      registration,
    );
  }
  function isFederatedCallback(request: FastifyRequest) {
    return federatedCallbacks.has(
      request.method + " " + request.routeOptions.url,
    );
  }
  async function validateFederatedCallback(request: FastifyRequest) {
    const registration = federatedCallbacks.get(
      request.method + " " + request.routeOptions.url,
    );
    if (!registration) return;
    if (
      registration.allowedOrigins &&
      !registration.allowedOrigins.includes(String(request.headers.origin))
    )
      fail(403, "ORIGIN_DENIED");
    const proof = await registration.verify(request);
    if (!proof || typeof proof !== "object")
      fail(401, "FEDERATED_ASSERTION_INVALID");
    callbackProofs.set(request, proof);
  }
  function federatedCallbackProof(request: FastifyRequest) {
    const proof = callbackProofs.get(request);
    if (!proof) fail(401, "FEDERATED_ASSERTION_INVALID");
    callbackProofs.delete(request);
    return proof;
  }
  let principalResolver: PrincipalResolver | undefined;
  let federatedResolver: FederatedIdentityResolver | undefined;
  function registerPrincipalResolver(resolver: PrincipalResolver) {
    if (principalResolver) throw Error("Principal resolver already registered");
    principalResolver = resolver;
  }
  function registerFederatedIdentityResolver(
    resolver: FederatedIdentityResolver,
  ) {
    if (federatedResolver)
      throw Error("Federated identity resolver already registered");
    federatedResolver = resolver;
  }
  const hasPrincipalResolver = () => !!principalResolver;

  async function verifyBearerRequest(r: FastifyRequest) {
    const token = r.headers.authorization?.match(/^Bearer ([^ ]+)$/i)?.[1],
      organizationId = (r.params as any)?.organizationId;
    if (!principalResolver || !token || !organizationId) return false;
    return transaction(async (c) => {
      const orgId = id(organizationId);
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        orgId,
      ]);
      await lockActiveOrganization(c, orgId);
      const principal = await principalResolver!({
        token,
        organizationId: orgId,
        request: r,
        c,
      });
      if (!principal || principal.organizationId !== orgId)
        fail(401, "UNAUTHENTICATED");
      if (
        !(
          await c.query(
            "SELECT 1 FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE'",
            [orgId, id(principal!.accountId)],
          )
        ).rowCount
      )
        fail(401, "UNAUTHENTICATED");
      return true;
    });
  }
  async function auth(r: FastifyRequest, c?: PoolClient) {
    if (r.headers.authorization) fail(401, "UNAUTHENTICATED");
    const token = r.cookies.orgmap_session;
    if (!token) fail(401, "UNAUTHENTICATED");
    const row = (
      await (c ?? pool).query(
        "SELECT a.id,a.email,a.email_revision,a.display_name,s.csrf,s.id AS session_id,to_jsonb(s)->'auth_amr' AS auth_amr,to_jsonb(s)->>'auth_time' AS auth_time,to_jsonb(s)->>'mfa_verified_at' AS mfa_verified_at,to_jsonb(s)->>'mfa_factor_revision' AS mfa_factor_revision,COALESCE(to_jsonb(s)->>'auth_method','LEGACY') AS auth_method,to_jsonb(s)->>'auth_organization_id' AS auth_organization_id,to_jsonb(s)->>'auth_connection_id' AS auth_connection_id,to_jsonb(s)->>'auth_issuer' AS auth_issuer,to_jsonb(s)->>'auth_subject' AS auth_subject,COALESCE(to_jsonb(s)->>'auth_verified_at',s.created_at::text) AS auth_verified_at FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE token_hash=$1 AND expires_at>clock_timestamp()" +
          (c ? " FOR SHARE OF s" : ""),
        [digest(token!)],
      )
    ).rows[0];
    if (!row) fail(401, "UNAUTHENTICATED");
    if (r.method !== "GET" && r.headers["x-csrf-token"] !== row.csrf)
      fail(403, "CSRF_INVALID");
    return row;
  }
  const envelope = (
    r: FastifyRequest,
    data: any,
    org: any = null,
    rv: number | null = null,
    owner = false,
    capabilities: Record<string, boolean> = {},
  ) => ({
    data,
    meta: {
      requestId: r.id,
      organizationId: org?.id ?? null,
      resourceVersion: rv,
      authorizationRevision: org?.authorization_revision ?? null,
      asOf: new Date().toISOString(),
    },
    capabilities: {
      "structure.direct": owner,
      "member.manage": owner,
      "audit.read": owner,
      ...capabilities,
    },
  });

  async function tenant(
    r: FastifyRequest,
    access: boolean | TenantOptions,
    fn: (ctx: Ctx) => Promise<any>,
  ) {
    const options: TenantOptions =
      typeof access === "boolean"
        ? { mode: access ? "write" : "read" }
        : access;
    const write = options.mode !== "read";
    const bearer = r.headers.authorization?.match(/^Bearer ([^ ]+)$/i)?.[1];
    if (r.headers.authorization && !bearer) fail(401, "UNAUTHENTICATED");
    const cookieAccount = bearer ? undefined : await auth(r);
    const orgId = id((r.params as any).organizationId);
    return transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        orgId,
      ]);
      const org = await lockActiveOrganization(c, orgId);
      let principal: TrustedPrincipal | undefined;
      let a = cookieAccount;
      if (bearer) {
        if (!principalResolver) fail(401, "UNAUTHENTICATED");
        const resolved = await principalResolver!({ token: bearer, organizationId: orgId, request: r, c });
        if (!resolved || resolved.organizationId !== orgId) fail(401, "UNAUTHENTICATED");
        principal = resolved!;
        id(principal.accountId); id(principal.credentialId);
        const required = options.requiredScopes ?? [write ? "orgmap:write" : "orgmap:read"];
        if (!required.every((scope) => principal!.scopes.includes(scope))) fail(403, "CREDENTIAL_SCOPE_DENIED");
      }
      const extras = options.accountLocks ? await options.accountLocks(c, orgId, r) : [];
      if (!Array.isArray(extras) || extras.length > 100) fail(503, "AUTH_CONTINUITY_UNAVAILABLE");
      const accountIds = [...new Set([id(principal?.accountId ?? a.id).toLowerCase(), ...extras.map(value => id(value).toLowerCase())])].sort();
      const locked = await c.query("SELECT id FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [accountIds]);
      if (locked.rowCount !== accountIds.length) fail(404, "RESOURCE_NOT_FOUND");
      if (!bearer) a = await auth(r, c);
      else {
        a = (await c.query("SELECT id,email,display_name FROM accounts WHERE id=$1", [principal!.accountId])).rows[0];
        if (!a) fail(401, "UNAUTHENTICATED");
      }
      const member = (
        await c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE'",
          [orgId, a.id],
        )
      ).rows[0];
      if (!org || !member) fail(404, "RESOURCE_NOT_FOUND");

      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        orgId,
      ]);
      const ctx: Ctx = {
        c,
        org,
        member,
        account: a,
        mode: options.mode,
        principal,
        requestId: r.id,
        lockedAccountIds: new Set(accountIds),
      };
      await enrollmentServices.checkTenantAuthentication(ctx);
      const stepUp = options.credentialStepUp === true;
      if (
        stepUp &&
        (bearer ||
          ![
            "GET /api/v1/organizations/:organizationId/security/requirements",
            "POST /api/v1/organizations/:organizationId/security/attest",
          ].includes(r.method + " " + r.routeOptions.url))
      )
        fail(403, "ACTION_DENIED");
      if (!stepUp) await credentialServices.requireCredentialPolicy(ctx);
      if (!stepUp)
        await guestServices.requireGuestRoute(ctx, {
          routeId: r.routeOptions.url ?? r.url.split("?")[0],
          method: r.method,
          request: r,
          mode: ctx.mode,
        });
      await requestAvailability(ctx, r);
      const allowed = options.authorize
        ? await options.authorize(ctx)
        : !write || member.org_role === "OWNER";
      if (allowed !== true) fail(403, "ACTION_DENIED");
      let result;
      const isCreate = write && r.method === "POST" && !stepUp && !options.moduleManagedCreateIdempotency;
      const op =
          (principal
            ? "credential:" + principal.credentialId + ":"
            : "cookie:") + r.url.split("?")[0],
        hash = stepUp ? "" : commandHash(r);
      let k = "";
      if (isCreate) {
        k = key(r);
        const prior = (
          await c.query(
            "SELECT * FROM command_results WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4",
            [orgId, a.id, op, k],
          )
        ).rows[0];
        if (prior) {
          if (prior.hash !== hash) fail(409, "IDEMPOTENCY_CONFLICT");
          await options.beforeReplay?.(ctx, prior.result);
          return envelope(
            r,
            prior.result,
            org,
            null,
            member.org_role === "OWNER" &&
              (!principal || principal.scopes.includes("orgmap:write")),
          );
        }
      }
      result = await fn(ctx);
      if (isCreate)
        await c.query("INSERT INTO command_results VALUES($1,$2,$3,$4,$5,$6)", [
          orgId,
          a.id,
          op,
          k,
          hash,
          result,
        ]);
      const current = (
        await c.query("SELECT * FROM organizations WHERE id=$1", [orgId])
      ).rows[0];
      return envelope(
        r,
        result,
        current,
        result?.entity?.version ??
          result?.circle?.version ??
          result?.role?.version ??
          result?.occupancy?.version ??
          result?.membership?.version ??
          null,
        member.org_role === "OWNER" &&
          (!principal || principal.scopes.includes("orgmap:write")),
        await options.capabilities?.(ctx),
      );
    });
  }
  async function get(c: PoolClient, org: string, eid: string, kind?: string) {
    const e = (
      await c.query(
        "SELECT * FROM entities WHERE organization_id=$1 AND id=$2 AND NOT archived",
        [org, id(eid)],
      )
    ).rows[0];
    if (!e || (kind && e.kind !== kind)) fail(404, "RESOURCE_NOT_FOUND");
    return e;
  }
  async function changed(
    ctx: Ctx,
    r: FastifyRequest,
    eid: string,
    action: string,
    structure = false,
  ) {
    await ctx.c.query(
      `UPDATE organizations SET authorization_revision=authorization_revision+1${structure ? ",structure_revision=structure_revision+1" : ""} WHERE id=$1`,
      [ctx.org.id],
    );
    await event(ctx.c, ctx.org.id, ctx.account.id, eid, action, r.id);
  }

  async function issueFederatedSession(
    r: FastifyRequest,
    reply: FastifyReply,
    proof: unknown,
  ) {
    if (!federatedResolver) fail(401, "UNAUTHENTICATED");
    const token = secret(),
      csrf = secret();
    const account = await transaction(async (c) => {
      const identity = await federatedResolver!(proof, c);
      if (!identity) fail(401, "UNAUTHENTICATED");
      const account = (
        await c.query(
          "SELECT id,email,display_name FROM accounts WHERE id=$1",
          [id(identity!.accountId)],
        )
      ).rows[0];
      if (!account) fail(401, "UNAUTHENTICATED");
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[account.id]);
      if (r.cookies.orgmap_session)
        await c.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(r.cookies.orgmap_session),
        ]);
      await createSessionRecord(
        c,
        account.id,
        identity!.provenance ?? { method: "LEGACY" },
        { token, csrf },
      );
      return account;
    });
    reply.setCookie("orgmap_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: 604800,
    });
    return envelope(r, {
      account: {
        id: account.id,
        email: account.email,
        displayName: account.display_name,
      },
      csrfToken: csrf,
    });
  }
  async function provisionMembership(
    ctx: Ctx,
    r: FastifyRequest,
    input: { accountId: string; status: "ACTIVE" | "SUSPENDED" },
  ) {
    await admissionServices.assertAdminAdd(ctx);
    if (ctx.mode === "read") fail(403, "ACTION_DENIED");
    if (!["ACTIVE", "SUSPENDED"].includes(input.status))
      fail(400, "INVALID_REQUEST");
    const aid = id(input.accountId);
    if (
      !(await ctx.c.query("SELECT 1 FROM accounts WHERE id=$1", [aid])).rowCount
    )
      fail(404, "RESOURCE_NOT_FOUND");
    let m = (
      await ctx.c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",
        [ctx.org.id, aid],
      )
    ).rows[0];
    if (m?.org_role === "OWNER" && input.status !== "ACTIVE")
      fail(422, "LAST_OWNER_PROTECTED");
    if (m?.status === "ACTIVE" && input.status === "SUSPENDED")
      await assertTargetAccountLocked(ctx, m.account_id);
    if (m)
      m = (
        await ctx.c.query(
          "UPDATE members SET status=$3,suspension_origin=$4,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [
            ctx.org.id,
            m.id,
            input.status,
            input.status === "SUSPENDED" ? { type: "MANUAL" } : null,
          ],
        )
      ).rows[0];
    else
      m = (
        await ctx.c.query(
          "INSERT INTO members(organization_id,id,account_id,org_role,status,suspension_origin) VALUES($1,$2,$3,'MEMBER',$4,$5) RETURNING *",
          [
            ctx.org.id,
            uuid(),
            aid,
            input.status,
            input.status === "SUSPENDED" ? { type: "MANUAL" } : null,
          ],
        )
      ).rows[0];
    await changed(ctx, r, m.id, "OrganizationMemberProvisioned");
    return camel(m);
  }
  const guestServices = createGuestServices();
  async function withWorkerContext<T>(
    orgId: string,
    memberId: string,
    fn: (ctx: Ctx) => Promise<T>,
  ) {
    return rawWorkerContext(orgId, memberId, async (ctx) => {
      await credentialServices.requireCredentialPolicy(ctx);
      return fn(ctx);
    });
  }
  async function withResourceWorkerContext<T>(
    orgId: string,
    memberId: string,
    access: {
      resource: import("./guest-contract.js").ScopedResource;
      action: string;
    }[],
    fn: (ctx: Ctx) => Promise<T>,
  ) {
    if (!Array.isArray(access) || !access.length || access.length > 1000)
      fail(400, "INVALID_REQUEST");
    return rawWorkerContext(
      orgId,
      memberId,
      async (ctx) => {
        await credentialServices.requireCredentialPolicy(ctx);
        return fn(ctx);
      },
      async (ctx) => {
        for (const item of access)
          await guestServices.requireGuestResource(
            ctx,
            item.resource,
            item.action,
          );
      },
    );
  }
  const admissionServices = createAdmissionServices(guestServices);
  let invitationLifecycleNotifier: InvitationLifecycleNotifier | undefined;
  let notificationPublisher: NotificationPublisher | undefined;
  function registerNotificationPublisher(port: NotificationPublisher) {
    if (notificationPublisher) throw Error("Notification publisher already registered");
    notificationPublisher = port;
  }
  async function publishNotification(ctx: Ctx, input: import("../../packages/contracts/notifications.js").NotificationIntent) {
    if (ctx.mode === "read") fail(403, "ACTION_DENIED");
    await notificationPublisher?.(ctx, input);
  }
  function registerInvitationLifecycleNotifier(port: InvitationLifecycleNotifier) {
    if (invitationLifecycleNotifier) throw Error("Invitation lifecycle notifier already registered");
    invitationLifecycleNotifier = port;
  }
  const invitationServices = createInvitationServices({
    notifyInvitationLifecycle: async (ctx, notice) => { await invitationLifecycleNotifier?.(ctx, notice); },
    auth,
    envelope,
    changed,
    organizationSettings,
    ...guestServices,
    ...admissionServices,
  });
  const publicAdmissionServices = createPublicAdmissionServices({
    auth,
    envelope,
    tenant,
    changed,
    ...admissionServices,
  });
  admissionServices.registerPublicAdmissionConsumer(publicAdmissionServices);
  const enrollmentServices = createEnrollmentServices({
    auth,
    assertTargetAccountLocked,
    envelope,
    assertScimAdmission: admissionServices.assertScimAdmission,
  });
  const mfaServices = createMfaServices({ auth, envelope });
  const accountSecurityServices = createAccountSecurityServices(mfaServices);
  const accountEmailServices = createAccountEmailServices({ auth, envelope, ...accountSecurityServices });
  const accountMediaServices = createAccountMediaServices({
    auth, envelope, tenant,
    isGuest: guestServices.isGuest,
    visibleMemberIds: guestServices.visibleMemberIds,
  });
  const credentialServices = createCredentialPolicyServices({
    ...mfaServices,
    ...enrollmentServices,
  });
  return {
    deliverInvitationMail: (
      org: string,
      sender: (mail: LocalMail) => Promise<void> = sendLocalMail,
    ) =>
      deliverInvitationsSmtp(
        org,
        sender,
        invitationServices.validateInvitationDelivery,
        invitationServices.reportInvitationDelivery,
      ),
    registerInvitationLifecycleNotifier,
    registerNotificationPublisher,
    publishNotification,
    ...admissionServices,
    ...invitationServices,
    ...publicAdmissionServices,
    ...mfaServices,
    ...accountSecurityServices,
    ...accountEmailServices,
    ...accountMediaServices,
    ...credentialServices,
    ...enrollmentServices,
    ...guestServices,
    registerOrganizationSettings,
    registerGovernanceModel,
    governanceModel,
    registerModuleScope,
    registerAvailabilityResolver,
    organizationSettings,
    assertModuleAvailable,
    assertResourceAvailable,
    validateActiveMembers: async (
      ctx: Ctx,
      ids: string[],
      resource?: import("./guest-contract.js").ScopedResource,
    ) => {
      if (!Array.isArray(ids)) return false;
      if (guestServices.isGuest(ctx)) {
        const visible = await guestServices.visibleMemberIds(ctx, {
          purpose: "ASSIGNEE_PICKER",
          resource,
        });
        if (ids.some((memberId) => !visible.includes(memberId))) return false;
      }
      return validateActiveMembers(ctx, ids);
    },
    withWorkerContext,
    withResourceWorkerContext,
    registerFoundationStructure,
    foundationStructure,
    assertLoginMethodRemovalAllowed,
    registerAccountAuthMethods,
    registerLifecycleAuthMethods,
    lifecycleAuthMethods: () => lifecycleAuthMethodsPort,
    assertTargetAccountLocked,
    accountAuthMethods,
    registerFederatedCallback,
    isFederatedCallback,
    validateFederatedCallback,
    federatedCallbackProof,
    auth,
    envelope,
    tenant,
    get,
    changed,
    registerPrincipalResolver,
    hasPrincipalResolver,
    verifyBearerRequest,
    registerFederatedIdentityResolver,
    issueFederatedSession,
    provisionMembership,
  };
}
export type ModuleRuntime = ReturnType<typeof createRuntime>;
export type OrgMapModule = (
  app: FastifyInstance,
  core: ModuleRuntime,
) => Promise<void>;

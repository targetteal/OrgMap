import { assertManagedWriter } from "./managed-writer.js";
import { lockOrganizationIfActive } from "./organization-lifecycle.js";
import { accessPlan } from "./guest.js";
import { createSessionRecord } from "./sessions.js";
import { readiness } from "./readiness.js";
import { registerAccountRoutes } from "./account.js";
import { registerOrganizationDeletionRoutes, type OrganizationDeletionHttpOptions } from "./organization-deletion-http.js";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { hashPassword, verifyPassword } from "./password.js";
import { pool, transaction } from "./db.js";
import {
  uuid,
  secret,
  digest,
  commandHash,
  Failure,
  fail,
  text,
  optionalText,
  id,
  body,
  version,
  key,
  camel,
  entity,
  event,
} from "./core.js";
import { createRuntime, type Ctx, type OrgMapModule } from "./runtime.js";
import { validateMigrationSelection, type MigrationScope } from "./migration-selection.js";
export async function buildApp(
  modules: OrgMapModule[] = [],
  options: { migrationMaxPrefix?: number; migrationScope?: MigrationScope; organizationDeletion?: OrganizationDeletionHttpOptions } = {},
) {
  if (options.migrationScope !== undefined && options.migrationMaxPrefix !== undefined)
    throw Error("MIGRATION_SELECTION_CONFLICT");
  const migrationSelection = validateMigrationSelection(
    options.migrationMaxPrefix !== undefined
        ? { maxPrefix: options.migrationMaxPrefix }
        : { scope: options.migrationScope ?? "foundation" },
  );
  const app = Fastify({ logger: false, bodyLimit: 65536, genReqId: uuid });
  await app.register(cookie);
  const origins = (
    process.env.ALLOWED_ORIGINS ??
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001"
  ).split(",");
  // Foundation resource creates have stable 201 status, including idempotent replay.
  app.addHook("onSend", async (r, reply, payload) => {
    if (
      r.method === "POST" &&
      reply.statusCode === 200 &&
      (/^\/api\/v1\/organizations(?:$|\/[^/]+\/(?:circles|roles|members|invitations)$|\/[^/]+\/(?:circles\/[^/]+\/memberships|roles\/[^/]+\/occupancies)$)/.test(
        r.url.split("?")[0],
      ) ||
        r.url === "/api/v1/auth/register")
    )
      reply.code(201);
    if (r.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });
  // Guard all HTTP mutation entry points, including routes that write directly
  // through pool.query rather than the shared transaction helper.
  app.addHook("onRequest", async (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    const c = await pool.connect();
    try { await assertManagedWriter(c); }
    finally { c.release(); }
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.setErrorHandler((e, r, reply) => {
    const x = e as any;
    const f =
      e instanceof Failure
        ? e
        : new Failure(
            x.code === "23505"
              ? 409
              : x.code?.startsWith("23")
                ? 422
                : x.statusCode >= 400 && x.statusCode < 500
                  ? x.statusCode
                  : 500,
            x.code === "23505"
              ? "STATE_CONFLICT"
              : x.code?.startsWith("23")
                ? "DOMAIN_INVARIANT"
                : x.statusCode >= 400 && x.statusCode < 500
                  ? "INVALID_REQUEST"
                  : "INTERNAL_ERROR",
          );
    if (f.status === 429) reply.header("Retry-After", "60");
    reply.code(f.status).send({
      error: {
        code: f.code,
        message: f.code,
        fieldErrors: [],
        retryable: f.status === 503,
        conflictDetails: null,
      },
      meta: { requestId: r.id },
    });
  });
  app.addHook("onRequest", async (r) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(r.method) &&
      !origins.includes(String(r.headers.origin))
    ) {
      if (!core.isFederatedCallback(r) && !(await core.verifyBearerRequest(r)))
        fail(403, "ORIGIN_DENIED");
    }
  });
  const core = createRuntime();
  const { auth, envelope, tenant, get, changed } = core;
  app.addHook("preValidation", async (request) =>
    core.validateFederatedCallback(request),
  );
  async function session(
    r: FastifyRequest,
    reply: any,
    account: any,
    expectedPasswordHash?: string,
  ) {
    const token = secret(),
      csrf = secret();
    await transaction(async (c) => {
      const current = (
        await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
          account.id,
        ])
      ).rows[0];
      if (
        !current ||
        (expectedPasswordHash !== undefined &&
          (current.password_enabled === false ||
            current.password_hash !== expectedPasswordHash ||
            current.email !== account.email ||
            String(current.email_revision) !== String(account.email_revision)))
      )
        fail(401, "UNAUTHENTICATED");
      account = current;
      if (r.cookies.orgmap_session)
        await c.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(r.cookies.orgmap_session),
        ]);
      await createSessionRecord(
        c,
        account.id,
        { method: "PASSWORD" },
        { token, csrf },
      );
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
  for (const route of ["register", "login"])
    app.post("/api/v1/auth/" + route, async (r, reply) => {
      for (const [ip, entry] of attempts)
        if (entry.until <= Date.now()) attempts.delete(ip);
      if (attempts.size > 10000 && !attempts.has(r.ip))
        fail(429, "RATE_LIMITED");
      const rate = attempts.get(r.ip);
      if (rate && rate.until > Date.now() && rate.count >= 20) {
        reply.header("Retry-After", "60");
        fail(429, "RATE_LIMITED");
      }
      attempts.set(r.ip, {
        count: rate && rate.until > Date.now() ? rate.count + 1 : 1,
        until: Date.now() + 60000,
      });
      const b = body(
        r,
        route === "register"
          ? ["email", "password", "displayName"]
          : ["email", "password"],
      );
      const email = text(b.email, 254).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        fail(400, "INVALID_REQUEST");
      if (typeof b.password !== "string" || b.password.length > 1024)
        fail(400, "INVALID_REQUEST");
      const password = b.password;
      if (route === "register") {
        if (password.length < 12) fail(400, "PASSWORD_TOO_SHORT");
        const passwordHash = await hashPassword(password);
        const a = (
          await pool.query(
            "INSERT INTO accounts VALUES($1,$2,$3,$4) RETURNING id,email,display_name",
            [uuid(), email, text(b.displayName), passwordHash],
          )
        ).rows[0];
        return session(r, reply, a);
      }
      const a = (
        await pool.query("SELECT * FROM accounts WHERE email=$1", [email])
      ).rows[0];
      if (
        !(await verifyPassword(
          password,
          a?.password_enabled === false ? undefined : a?.password_hash,
        ))
      )
        fail(401, "UNAUTHENTICATED");
      return session(r, reply, a, a.password_hash);
    });
  app.get("/api/v1/me", async (r) => {
    const initial = await auth(r);
    const rows = await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.account_id',$1,true)", [
        initial.id,
      ]);
      return (
        await c.query(
          "SELECT o.id FROM organizations o JOIN organization_lifecycle l ON l.organization_id=o.id AND l.state='ACTIVE' JOIN members m ON m.organization_id=o.id WHERE m.account_id=$1 AND m.status='ACTIVE' ORDER BY o.id",
          [initial.id],
        )
      ).rows;
    });
    const orgs = [];
    // Each organization has its own guard. Never hold an Account/session lock
    // while waiting for another organization (including the first one).
    for (const row of rows) {
      const item = await transaction(async (c) => {
        await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
          row.id,
        ]);
        const org = await lockOrganizationIfActive(c, row.id);
        if (!org) return null;
        await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
          initial.id,
        ]);
        const account = await auth(r, c);
        const member = (
          await c.query(
            "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE'",
            [row.id, account.id],
          )
        ).rows[0];
        if (!org || !member) return null;
        const view = await core.organizationSettings({
          c,
          org,
          member,
          account,
          mode: "read",
        });
        return {
          id: org.id,
          name: view.settings.name,
          memberId: member.id,
          orgRole: member.org_role,
          memberType: member.member_type,
        };
      });
      if (item) orgs.push(item);
    }
    const a = await auth(r);
    return envelope(r, {
      account: { id: a.id, email: a.email, displayName: a.display_name },
      organizations: orgs,
      csrfToken: a.csrf,
    });
  });
  app.post("/api/v1/auth/logout", async (r, reply) => {
    await auth(r);
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(r.cookies.orgmap_session!),
    ]);
    reply.clearCookie("orgmap_session", { path: "/" });
    return envelope(r, { loggedOut: true });
  });
  app.post("/api/v1/organizations", async (r) => {
    const a = await auth(r),
      b = body(r, ["name", "locale", "timeZone"]);
    const k = "organization.create:" + key(r),
      hash = commandHash(r);
    const retryReplay = Symbol("retry-organization-replay");
    for (;;) {
      const outcome = await transaction(async (c) => {
        // Discover only. Never hold an Account lock while waiting for Org.
        const discovered = (await c.query(
          "SELECT result FROM account_commands WHERE account_id=$1 AND key=$2", [a.id,k],
        )).rows[0];
        if (discovered) {
          const orgId = discovered.result?.organization?.id;
          if (typeof orgId !== "string") fail(404,"RESOURCE_NOT_FOUND");
          await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[orgId]);
          const lockedOrg = await lockOrganizationIfActive(c,orgId);
          if (!lockedOrg) fail(404,"RESOURCE_NOT_FOUND");
          await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[a.id]);
          const current = await auth(r,c);
          if (current.id !== a.id) fail(401,"UNAUTHENTICATED");
          const prior = (await c.query("SELECT hash,result FROM account_commands WHERE account_id=$1 AND key=$2",[a.id,k])).rows[0];
          if (!prior || prior.result?.organization?.id !== orgId) return retryReplay;
          if (prior.result?.deleted === true) fail(404,"RESOURCE_NOT_FOUND");
          if (prior.hash !== hash) fail(409,"IDEMPOTENCY_CONFLICT");
          const membership = (await c.query(
            "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE'", [orgId,a.id],
          )).rows[0];
          if (!membership) fail(404,"RESOURCE_NOT_FOUND");
          return envelope(r,prior.result,lockedOrg,null,membership.org_role === "OWNER");
        }
        await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[a.id]);
        const current = await auth(r,c);
        if (current.id !== a.id) fail(401,"UNAUTHENTICATED");
        // A competing create can have committed since discovery. Release all
        // locks, then rediscover and re-enter in Org→Account order.
        if ((await c.query("SELECT 1 FROM account_commands WHERE account_id=$1 AND key=$2",[a.id,k])).rowCount) return retryReplay;
      const orgId = uuid(),
        memberId = uuid(),
        rootId = uuid();
      const zone = b.timeZone ?? "America/Sao_Paulo";
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
      } catch {
        fail(400, "INVALID_REQUEST");
      }
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        orgId,
      ]);
      await c.query(
        "INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,$2,$3,$4)",
        [orgId, text(b.name), text(b.locale ?? "pt-BR"), zone],
      );
      await c.query(
        "INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')",
        [orgId, memberId, a.id],
      );
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        orgId,
      ]);
      const root = (
        await c.query(
          "INSERT INTO entities(organization_id,id,node_id,kind,name) VALUES($1,$2,$3,'CIRCLE',$4) RETURNING *",
          [orgId, rootId, uuid(), text(b.name)],
        )
      ).rows[0];
      await event(c, orgId, a.id, orgId, "OrganizationCreated", r.id);
      const org = (
        await c.query("SELECT * FROM organizations WHERE id=$1", [orgId])
      ).rows[0];
      const result = {
        organization: camel(org),
        membership: { id: memberId, orgRole: "OWNER" },
        rootCircle: entity(root),
      };
      await c.query("INSERT INTO account_commands VALUES($1,$2,$3,$4)", [
        a.id,
        k,
        hash,
        result,
      ]);
      return envelope(r, result, org, 1, true);
      });
      if (outcome !== retryReplay) return outcome;
    }
  });
  function structureAccess(
    r: import("fastify").FastifyRequest,
    operation:
      | "CREATE"
      | "UPDATE"
      | "MOVE"
      | "ARCHIVE"
      | "ASSIGN"
      | "ASSOCIATE"
      | "END"
      | "END_ASSOCIATION",
    parentKey?: string,
  ): import("./runtime.js").TenantOptions {
    return {
      mode: "authorization_write",
      authorize: async (ctx) => {
        const port = core.foundationStructure();
        if (!port) return ctx.member.org_role === "OWNER";
        const params = r.params as any,
          b = (r.body ?? {}) as any;
        let circle: string;
        let localAction: import("./runtime.js").LocalCircleAction | undefined;
        if (operation === 'ASSOCIATE' || operation === 'END_ASSOCIATION') {
          const model=await core.governanceModel()?.state(ctx);
          if(model?.rules.membership==='OCCUPANCY')return false;
        }
        if (operation === "CREATE") circle = id(b[parentKey!]);
        else if (operation === "ASSOCIATE") {
          circle = id(params.circleId);
          localAction = "MEMBERSHIP_MANAGE";
        } else if (operation === "END_ASSOCIATION") {
          const membership = (
            await ctx.c.query(
              "SELECT circle_id FROM circle_memberships WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, id(params.membershipId)],
            )
          ).rows[0];
          if (!membership) fail(404, "RESOURCE_NOT_FOUND");
          circle = membership.circle_id;
          localAction = "MEMBERSHIP_MANAGE";
        } else if (operation === "ASSIGN") {
          const e = await get(ctx.c, ctx.org.id, params.roleId, "ROLE");
          const modeled = await core.governanceModel()?.authorizeAssignment(ctx, {roleId:e.id,memberId:id(b.memberId),kind:b.kind,endsAt:b.endsAt});
          if (typeof modeled === 'boolean') return modeled;
          circle = e.parent_id;
        } else if (operation === "END") {
          const o = (
            await ctx.c.query(
              "SELECT role_id FROM occupancies WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, id(params.occupancyId)],
            )
          ).rows[0];
          if (!o) fail(404, "RESOURCE_NOT_FOUND");
          const modeled = await core.governanceModel()?.authorizeEnd(ctx, 'OCCUPANCY', id(params.occupancyId));
          if (typeof modeled === 'boolean') return modeled;
          circle = (await get(ctx.c, ctx.org.id, o.role_id, "ROLE")).parent_id;
        } else {
          const e = await get(ctx.c, ctx.org.id, params.entityId);
          if (operation === "UPDATE" && e.kind === "CIRCLE")
            localAction = "CIRCLE_CONTENT_EDIT";
          circle =
            operation === "UPDATE" && e.kind === "CIRCLE"
              ? e.id
              : (e.parent_id ?? e.id);
        }
        const granted = await port.authorizeCircle(
          ctx,
          circle,
          operation === "ASSIGN" || operation === "END" ? "ASSIGN" : "ADMIN",
        );
        if (
          !granted &&
          !(
            localAction &&
            (await port.authorizeLocalCircle?.(ctx, circle, localAction))
          )
        )
          return false;
        // Current governed-field policy is an authorization barrier, including replays.
        if (operation === "UPDATE")
          await port.preflightEntityChange(ctx, {
            operation: "UPDATE",
            entityId: id(params.entityId),
            changedFields: Object.keys(b).filter((k) => k !== "mode"),
          });
        if (
          operation === "MOVE" &&
          !(await port.authorizeCircle(ctx, id(b.targetCircleId), "ADMIN"))
        )
          return false;
        return true;
      },
    };
  }
  async function recordStructure(
    ctx: Ctx,
    resourceId: string,
    action: string,
    before: unknown,
    after: unknown,
  ) {
    await core
      .foundationStructure()
      ?.recordFoundationChange(ctx, { resourceId, action, before, after });
  }
  const base = "/api/v1/organizations/:organizationId";
  app.get(base + "/bootstrap", (r) =>
    tenant(r, { mode: "read", capabilities: core.invitationCapabilities }, async (ctx) => {
      const view = await core.organizationSettings(ctx),
        settings = view.settings;
      if (core.isGuest(ctx)) {
        const scope = await core.guestStructureScope(ctx),
          grants = await core.guestGrants(ctx);
        return {
          organization: { id: ctx.org.id, name: settings.name },
          membership: {
            id: ctx.member.id,
            memberType: ctx.member.member_type,
            orgRole: ctx.member.org_role,
            status: ctx.member.status,
            version: ctx.member.version,
          },
          rootCircleId: null,
          modules: {
            structure: scope.roots.length > 0,
            work: grants.some((g) => g.resource.context === "work"),
            goals: grants.some((g) => g.resource.context === "goals"),
            governance: grants.some((g) => g.resource.context === "governance"),
            meetings: grants.some((g) => g.resource.context === "meetings"),
          },
          sharedResources: grants.map((g) => g.resource),
          authorizationRevision: ctx.org.authorization_revision,
        };
      }
      const root = (
        await ctx.c.query(
          "SELECT id FROM entities WHERE organization_id=$1 AND parent_id IS NULL",
          [ctx.org.id],
        )
      ).rows[0].id;
      return {
        organization: {
          ...camel(ctx.org),
          name: settings.name,
          locale: settings.locale,
          timeZone: settings.timezone,
          branding: settings.branding,
          vocabulary: settings.vocabulary,
          settingsVersion: view.version,
        },
        membership: camel(ctx.member),
        rootCircleId: root,
        modules: {
          structure: true,
          ...settings.modules,
          ...(settings.modules.work === undefined
            ? {}
            : { projects: settings.modules.work }),
        },
        policies: {
          structureMode: core.foundationStructure()
            ? "CONTEXT_POLICY"
            : "DIRECT_OWNER",
        },
        configuration: settings,
        governanceModel: await core.governanceModel()?.state(ctx) ?? null,
        authorizationRevision: ctx.org.authorization_revision,
      };
    }),
  );
  app.get(base + "/structure", (r) =>
    tenant(r, false, async (ctx) => {
      const { c, org } = ctx;
      const q = r.query as any;
      if (Object.keys(q).some((k) => !["rootCircleId", "depth"].includes(k)))
        fail(400, "INVALID_REQUEST");
      const depth = q.depth === undefined ? 20 : Number(q.depth);
      if (!Number.isInteger(depth) || depth < 1 || depth > 50)
        fail(400, "INVALID_REQUEST");
      if (core.isGuest(ctx)) {
        const port = core.foundationStructure();
        if (port?.structureForest)
          return port.structureForest(ctx, {
            rootCircleId: q.rootCircleId,
            depth,
          });
        const scope = await core.guestStructureScope(ctx);
        let ids = scope.roots.map((ref) => ref.id);
        if (q.rootCircleId) {
          const root = id(q.rootCircleId);
          if (!ids.includes(root)) fail(404, "RESOURCE_NOT_FOUND");
          ids = [root];
        }
        const es = (
          await c.query(
            "SELECT * FROM entities WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND NOT archived ORDER BY id",
            [org.id, ids],
          )
        ).rows;
        const visible = new Set(es.map((e) => e.id)),
          members = await core.visibleMemberIds(ctx, { purpose: "DIRECTORY" });
        const redacted = (e: any) => ({
          ...entity({
            ...e,
            parent_id: visible.has(e.parent_id) ? e.parent_id : null,
          }),
          pathRedacted: !!e.parent_id && !visible.has(e.parent_id),
        });
        return {
          structureRevision: org.structure_revision,
          nodes: es.map((e) => ({
            nodeId: e.node_id,
            entityId: e.id,
            kind: e.kind,
            parentNodeId: es.find((p) => p.id === e.parent_id)?.node_id ?? null,
            pathRedacted: !!e.parent_id && !visible.has(e.parent_id),
            name: e.name,
            version: e.version,
          })),
          circles: es.filter((e) => e.kind === "CIRCLE").map(redacted),
          roles: es.filter((e) => e.kind === "ROLE").map(redacted),
          memberships: (
            await c.query(
              "SELECT * FROM circle_memberships WHERE organization_id=$1 AND circle_id=ANY($2::uuid[]) AND member_id=ANY($3::uuid[])",
              [org.id, ids, members],
            )
          ).rows.map(camel),
          occupancies: (
            await c.query(
              "SELECT * FROM occupancies WHERE organization_id=$1 AND role_id=ANY($2::uuid[]) AND member_id=ANY($3::uuid[])",
              [org.id, ids, members],
            )
          ).rows.map(camel),
          coverage: {
            complete: true,
            pathRedacted: es.some(
              (e) => e.parent_id && !visible.has(e.parent_id),
            ),
          },
        };
      }
      const all = (
        await c.query(
          "SELECT * FROM entities WHERE organization_id=$1 AND NOT archived ORDER BY id",
          [org.id],
        )
      ).rows;
      const root = q.rootCircleId
        ? await get(c, org.id, q.rootCircleId, "CIRCLE")
        : all.find((e) => !e.parent_id);
      const included = new Map<string, number>([[root.id, 0]]);
      for (let d = 1; d <= depth; d++)
        for (const e of all)
          if (included.get(e.parent_id) === d - 1) included.set(e.id, d);
      const es = all.filter((e) => included.has(e.id));
      const limited = all.some((e) => included.get(e.parent_id) === depth);
      return {
        structureRevision: org.structure_revision,
        nodes: es.map((e) => ({
          nodeId: e.node_id,
          entityId: e.id,
          kind: e.kind,
          parentNodeId: all.find((p) => p.id === e.parent_id)?.node_id ?? null,
          name: e.name,
          version: e.version,
        })),
        circles: es.filter((e) => e.kind === "CIRCLE").map(entity),
        roles: es.filter((e) => e.kind === "ROLE").map(entity),
        memberships: (
          await c.query(
            "SELECT * FROM circle_memberships WHERE organization_id=$1",
            [org.id],
          )
        ).rows.map(camel),
        occupancies: (
          await c.query(
            "SELECT o.*,e.parent_id AS circle_id FROM occupancies o JOIN entities e ON e.organization_id=o.organization_id AND e.id=o.role_id WHERE o.organization_id=$1",
            [org.id],
          )
        ).rows.map(camel),
        coverage: {
          complete: !limited,
          depthLimited: limited,
          degradedReasons: [],
        },
      };
    }),
  );
  for (const [route, kind, parentKey] of [
    ["circles", "CIRCLE", "parentCircleId"],
    ["roles", "ROLE", "circleId"],
  ]) {
    app.post(base + "/" + route, (r) =>
      tenant(r, structureAccess(r, "CREATE", parentKey), async (ctx) => {
        const b = body(r, [
          parentKey,
          "name",
          "purpose",
          "purposeRich",
          "responsibilities",
          "artifacts",
          "mode",
        ]);
        if (
          b.purposeRich !== undefined &&
          !core.foundationStructure()?.writeEntityPurpose
        )
          fail(503, "STRUCTURE_CONFIGURATION_REQUIRED");
        if (b.mode !== "DIRECT") fail(422, "DOMAIN_INVARIANT");
        if ((b.responsibilities !== undefined || b.artifacts !== undefined) &&
          !core.foundationStructure()?.writeEntityDefinition)
          fail(503, "STRUCTURE_CONFIGURATION_REQUIRED");
        await get(ctx.c, ctx.org.id, b[parentKey], "CIRCLE");
        await core.foundationStructure()?.preflightEntityChange(ctx, {
          operation: "CREATE",
          circleId: id(b[parentKey]),
          changedFields: Object.keys(b).filter(
            (k) => k !== "mode" && k !== parentKey,
          ),
        });
        const e = (
          await ctx.c.query(
            "INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name,purpose) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              ctx.org.id,
              uuid(),
              uuid(),
              kind,
              b[parentKey],
              text(b.name),
              b.purpose === undefined ? "" : optionalText(b.purpose, 10000),
            ],
          )
        ).rows[0];
        const purpose = await core
          .foundationStructure()
          ?.writeEntityPurpose?.(ctx, {
            entityId: e.id,
            entityVersion: e.version,
            ...(Object.hasOwn(b, "purpose") ? { purpose: b.purpose } : {}),
            ...(Object.hasOwn(b, "purposeRich")
              ? { purposeRich: b.purposeRich }
              : {}),
          });
        if (purpose)
          Object.assign(e, {
            purpose: purpose.purpose,
            purpose_rich: purpose.purposeRich,
          });
        const definition = await core.foundationStructure()?.writeEntityDefinition?.(ctx, {
          entityId: e.id, entityVersion: e.version,
          responsibilities: b.responsibilities, artifacts: b.artifacts,
        });
        if (definition) Object.assign(e, definition);
        await recordStructure(ctx, e.id, kind + "Created", null, e);
        await changed(ctx, r, e.id, kind + "Created", true);
        return {
          [kind === "CIRCLE" ? "circle" : "role"]: entity(e),
          structureRevision: ctx.org.structure_revision + 1,
        };
      }),
    );
    app.get(base + "/" + route + "/:entityId", (r) =>
      tenant(r, false, async (ctx) => {
        if (core.isGuest(ctx)) {
          const port = core.foundationStructure();
          if (!port?.readStructureEntity) fail(404, "RESOURCE_NOT_FOUND");
          return {
            entity: await port!.readStructureEntity!(
              ctx,
              id((r.params as any).entityId),
              kind,
            ),
          };
        }
        return {
          entity: entity(
            await get(ctx.c, ctx.org.id, (r.params as any).entityId, kind),
          ),
        };
      }),
    );
    app.patch(base + "/" + route + "/:entityId", (r) =>
      tenant(r, structureAccess(r, "UPDATE"), async (ctx) => {
        const b = body(r, ["name", "purpose", "purposeRich", "responsibilities", "artifacts", "mode"]);
        if ((b.responsibilities !== undefined || b.artifacts !== undefined) &&
          !core.foundationStructure()?.writeEntityDefinition)
          fail(503, "STRUCTURE_CONFIGURATION_REQUIRED");
        if (
          b.purposeRich !== undefined &&
          !core.foundationStructure()?.writeEntityPurpose
        )
          fail(503, "STRUCTURE_CONFIGURATION_REQUIRED");
        if (b.mode !== "DIRECT") fail(422, "DOMAIN_INVARIANT");
        const e = await get(
          ctx.c,
          ctx.org.id,
          (r.params as any).entityId,
          kind,
        );
        if (
          e.purpose_rich != null &&
          b.purpose !== undefined &&
          !core.foundationStructure()?.writeEntityPurpose
        )
          fail(503, "STRUCTURE_CONFIGURATION_REQUIRED");
        version(r, e.version);
        await core.foundationStructure()?.preflightEntityChange(ctx, {
          operation: "UPDATE",
          entityId: e.id,
          changedFields: Object.keys(b).filter((k) => k !== "mode"),
        });
        const updated = (
          await ctx.c.query(
            "UPDATE entities SET name=$3,purpose=$4,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
            [
              ctx.org.id,
              e.id,
              b.name === undefined ? e.name : text(b.name),
              b.purpose === undefined
                ? e.purpose
                : b.purpose === null
                  ? ""
                  : text(b.purpose, 10000),
            ],
          )
        ).rows[0];
        const purpose = await core
          .foundationStructure()
          ?.writeEntityPurpose?.(ctx, {
            entityId: updated.id,
            entityVersion: updated.version,
            ...(Object.hasOwn(b, "purpose") ? { purpose: b.purpose } : {}),
            ...(Object.hasOwn(b, "purposeRich")
              ? { purposeRich: b.purposeRich }
              : {}),
          });
        if (purpose)
          Object.assign(updated, {
            purpose: purpose.purpose,
            purpose_rich: purpose.purposeRich,
          });
        const definition = await core.foundationStructure()?.writeEntityDefinition?.(ctx, {
          entityId: updated.id, entityVersion: updated.version,
          responsibilities: b.responsibilities, artifacts: b.artifacts,
        });
        if (definition) Object.assign(updated, definition);
        await recordStructure(ctx, e.id, "StructureEntityUpdated", e, updated);
        await changed(ctx, r, e.id, "StructureEntityUpdated", true);
        return {
          entity: entity(updated),
          structureRevision: ctx.org.structure_revision + 1,
        };
      }),
    );
  }
  app.post(base + "/structure/:entityId/move", (r) =>
    tenant(r, structureAccess(r, "MOVE"), async (ctx) => {
      const b = body(r, ["targetCircleId", "mode"]);
      if (b.mode !== "DIRECT") fail(422, "DOMAIN_INVARIANT");
      const e = await get(ctx.c, ctx.org.id, (r.params as any).entityId);
      version(r, e.version);
      if (!e.parent_id) fail(422, "ANCHOR_PROTECTED");
      await core.foundationStructure()?.preflightEntityChange(ctx, {
        operation: "MOVE",
        entityId: e.id,
        targetCircleId: id(b.targetCircleId),
      });
      let p = await get(ctx.c, ctx.org.id, b.targetCircleId, "CIRCLE");
      while (p) {
        if (p.id === e.id) fail(422, "STRUCTURE_CYCLE");
        p = p.parent_id ? await get(ctx.c, ctx.org.id, p.parent_id) : null;
      }
      const updated = (
        await ctx.c.query(
          "UPDATE entities SET parent_id=$3,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [ctx.org.id, e.id, b.targetCircleId],
        )
      ).rows[0];
      await recordStructure(ctx, e.id, "StructureEntityMoved", e, updated);
      await changed(ctx, r, e.id, "StructureEntityMoved", true);
      return {
        entity: entity(updated),
        structureRevision: ctx.org.structure_revision + 1,
      };
    }),
  );
  app.post(base + "/structure/:entityId/archive", (r) =>
    tenant(r, structureAccess(r, "ARCHIVE"), async (ctx) => {
      body(r, []);
      const e = await get(ctx.c, ctx.org.id, (r.params as any).entityId);
      version(r, e.version);
      if (!e.parent_id) fail(422, "ANCHOR_PROTECTED");
      await core
        .foundationStructure()
        ?.preflightEntityChange(ctx, { operation: "ARCHIVE", entityId: e.id });
      const refs = await ctx.c.query(
        "SELECT 1 FROM entities WHERE organization_id=$1 AND parent_id=$2 AND NOT archived UNION ALL SELECT 1 FROM occupancies WHERE organization_id=$1 AND role_id=$2 AND (ends_at IS NULL OR ends_at>now()) UNION ALL SELECT 1 FROM circle_memberships WHERE organization_id=$1 AND circle_id=$2 AND (ends_at IS NULL OR ends_at>now())",
        [ctx.org.id, e.id],
      );
      if (refs.rowCount) fail(409, "STATE_CONFLICT");
      await ctx.c.query(
        "UPDATE entities SET archived=true,version=version+1 WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, e.id],
      );
      await recordStructure(ctx, e.id, "StructureEntityArchived", e, {
        ...e,
        archived: true,
        version: e.version + 1,
      });
      await changed(ctx, r, e.id, "StructureEntityArchived", true);
      return {
        entity: { ...entity(e), archived: true, version: e.version + 1 },
      };
    }),
  );
  app.get(base + "/members", (r) =>
    tenant(r, false, async (ctx) => {
      const { c, org } = ctx;
      const q = r.query as any;
      if (Object.keys(q).some((k) => !["cursor", "limit", "query"].includes(k)))
        fail(400, "INVALID_REQUEST");
      const limit = q.limit === undefined ? 50 : Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(400, "INVALID_REQUEST");
      const filter = q.query ?? "";
      if (typeof filter !== "string" || filter.length > 200)
        fail(400, "INVALID_REQUEST");
      let last = "00000000-0000-0000-0000-000000000000";
      if (q.cursor) {
        try {
          const cursor = JSON.parse(
            Buffer.from(q.cursor, "base64url").toString(),
          );
          if (cursor.org !== org.id || cursor.filter !== filter)
            fail(400, "INVALID_REQUEST");
          last = id(cursor.last);
        } catch {
          fail(400, "INVALID_REQUEST");
        }
      }
      const guest = core.isGuest(ctx),
        visible = guest
          ? await core.visibleMemberIds(ctx, { purpose: "DIRECTORY" })
          : null;
      const rows = (
        await c.query(
          "SELECT m.id,a.display_name" +
            (guest
              ? ""
              : ",m.account_id,m.status,m.org_role,m.member_type,m.version") +
            " FROM members m JOIN accounts a ON a.id=m.account_id WHERE organization_id=$1 AND a.display_name ILIKE $2 AND m.id>$4 AND ($5::uuid[] IS NULL OR m.id=ANY($5::uuid[])) ORDER BY m.id LIMIT $3",
          [org.id, "%" + filter + "%", limit + 1, last, visible],
        )
      ).rows;
      const hasMore = rows.length > limit,
        items = rows.slice(0, limit);
      return {
        items: items.map((x) =>
          guest
            ? { id: x.id, displayName: x.display_name, avatar: null }
            : camel(x),
        ),
        page: {
          nextCursor: hasMore
            ? Buffer.from(
                JSON.stringify({ org: org.id, filter, last: items.at(-1)!.id }),
              ).toString("base64url")
            : null,
          hasMore,
        },
      };
    }),
  );
  app.post(base + "/members", (r) =>
    tenant(
      r,
      {
        mode: "authorization_write",
        authorize: async (ctx) => {
          await core.assertAdminAdd(ctx);
          return true;
        },
        beforeReplay: async (ctx, result) => {
          const input = body(r, ["accountId", "memberType", "accessPlan"]);
          const current = (
            await ctx.c.query(
              "SELECT * FROM members WHERE organization_id=$1 AND id=$2 AND account_id=$3",
              [ctx.org.id, result.membership.id, id(input.accountId)],
            )
          ).rows[0];
          if (!current || current.status !== "ACTIVE")
            fail(403, "ACTION_DENIED");
          if (current.member_type !== (input.memberType ?? "MEMBER"))
            fail(409, "TYPE_CHANGE_REQUIRED");
          await core.validateGuestAccessPlan(ctx, input.accessPlan ?? []);
        },
      },
      async (ctx) => {
        const b = body(r, ["accountId", "memberType", "accessPlan"]);
        const memberType = b.memberType ?? "MEMBER";
        if (!["MEMBER", "GUEST"].includes(memberType))
          fail(400, "INVALID_REQUEST");
        const plan = await core.validateGuestAccessPlan(
          ctx,
          b.accessPlan ?? [],
        );
        const aid = id(b.accountId);
        if (
          !(await ctx.c.query("SELECT 1 FROM accounts WHERE id=$1", [aid]))
            .rowCount
        )
          fail(404, "RESOURCE_NOT_FOUND");
        const m = (
          await ctx.c.query(
            "INSERT INTO members(organization_id,id,account_id,org_role,member_type) VALUES($1,$2,$3,'MEMBER',$4) RETURNING *",
            [ctx.org.id, uuid(), aid, memberType],
          )
        ).rows[0];
        await core.applyGuestAccessPlan(ctx, m.id, plan);
        await ctx.c.query(
          "INSERT INTO audit_events VALUES($1,$2,$3,$4,'OrganizationAdministrativeAdmissionGranted',clock_timestamp(),$5)",
          [ctx.org.id, uuid(), ctx.account.id, m.id, r.id],
        );
        await changed(ctx, r, m.id, "OrganizationMemberJoined");
        return { membership: camel(m) };
      },
    ),
  );
  app.patch(base + "/members/:memberId", (r) =>
    tenant(r, {
      mode: "write",
      accountLocks: async (c, org, request) => {
        const member = (await c.query("SELECT account_id FROM members WHERE organization_id=$1 AND id=$2", [org, id((request.params as any).memberId)])).rows[0];
        return member ? [member.account_id] : [];
      },
    }, async (ctx) => {
      const b = body(r, ["status"]);
      if (!["ACTIVE", "SUSPENDED"].includes(b.status))
        fail(400, "INVALID_REQUEST");
      const m = (
        await ctx.c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, id((r.params as any).memberId)],
        )
      ).rows[0];
      if (!m) fail(404, "RESOURCE_NOT_FOUND");
      version(r, m.version);
      if (m.org_role === "OWNER") fail(422, "LAST_OWNER_PROTECTED");
      if (b.status === "SUSPENDED" && m.status === "ACTIVE")
        await core.assertTargetAccountLocked(ctx, m.account_id);
      const updated = (
        await ctx.c.query(
          "UPDATE members SET status=$3,suspension_origin=$4,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [
            ctx.org.id,
            m.id,
            b.status,
            b.status === "SUSPENDED" ? { type: "MANUAL" } : null,
          ],
        )
      ).rows[0];
      await changed(ctx, r, m.id, "OrganizationMemberStatusChanged");
      return { membership: camel(updated) };
    }),
  );
  app.post(base + "/members/:memberId/actions/change-type", (r) =>
    tenant(r, { mode: "authorization_write" }, async (ctx) => {
      const b = body(r, ["memberType", "confirmVisibilityChange"]);
      if (
        !["MEMBER", "GUEST"].includes(b.memberType) ||
        b.confirmVisibilityChange !== true
      )
        fail(400, "EXPLICIT_CONFIRMATION_REQUIRED");
      const member = (
        await ctx.c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [ctx.org.id, id((r.params as any).memberId)],
        )
      ).rows[0];
      if (!member) fail(404, "RESOURCE_NOT_FOUND");
      version(r, member.version);
      if (member.org_role === "OWNER" && b.memberType === "GUEST")
        fail(422, "OWNER_TYPE_CHANGE_PROTECTED");
      const updated = (
        await ctx.c.query(
          "UPDATE members SET member_type=$3,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [ctx.org.id, member.id, b.memberType],
        )
      ).rows[0];
      await changed(ctx, r, member.id, "OrganizationMemberTypeChanged");
      return {
        membership: camel(updated),
        visibilityImpact:
          b.memberType === "GUEST"
            ? "EXPLICIT_SHARED_RESOURCES_ONLY"
            : "MEMBER_PERMISSIONS",
      };
    }),
  );
  app.get(base + "/members/:memberId/access-grants", (r) =>
    tenant(
      r,
      { mode: "read", authorize: (ctx) => ctx.member.org_role === "OWNER" },
      async (ctx) => ({
        items: (
          await ctx.c.query(
            "SELECT id,context,kind,resource_id,actions,version,revoked_at FROM guest_resource_grants WHERE organization_id=$1 AND member_id=$2 ORDER BY id",
            [ctx.org.id, id((r.params as any).memberId)],
          )
        ).rows.map(camel),
      }),
    ),
  );
  app.post(base + "/members/:memberId/access-grants", (r) =>
    tenant(r, { mode: "authorization_write" }, async (ctx) => {
      const b = body(r, ["accessPlan"]);
      const plan = await core.applyGuestAccessPlan(
        ctx,
        id((r.params as any).memberId),
        b.accessPlan,
      );
      // The port records authorization revision + audit/outbox in the same transaction.
      return { accessPlan: plan };
    }),
  );
  app.post(base + "/members/:memberId/access-grants/:grantId/revoke", (r) =>
    tenant(r, { mode: "authorization_write" }, async (ctx) => {
      body(r, []);
      const grant = (
        await ctx.c.query(
          "SELECT * FROM guest_resource_grants WHERE organization_id=$1 AND member_id=$2 AND id=$3 FOR UPDATE",
          [
            ctx.org.id,
            id((r.params as any).memberId),
            id((r.params as any).grantId),
          ],
        )
      ).rows[0];
      if (!grant) fail(404, "RESOURCE_NOT_FOUND");
      version(r, grant.version);
      await ctx.c.query(
        "UPDATE guest_resource_grants SET revoked_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, grant.id],
      );
      await changed(ctx, r, grant.id, "MemberResourceAccessRevoked");
      return { revoked: true };
    }),
  );
  async function validMember(ctx: Ctx, mid: any) {
    if (
      !(
        await ctx.c.query(
          "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
          [ctx.org.id, id(mid)],
        )
      ).rowCount
    )
      fail(404, "RESOURCE_NOT_FOUND");
  }
  function dates(b: any) {
    if (
      (b.startsAt !== undefined && typeof b.startsAt !== "string") ||
      (b.endsAt !== undefined &&
        b.endsAt !== null &&
        typeof b.endsAt !== "string")
    )
      fail(400, "INVALID_REQUEST");
    const start = new Date(b.startsAt ?? Date.now());
    const end = b.endsAt ? new Date(b.endsAt) : null;
    if (
      !Number.isFinite(+start) ||
      (end && (!Number.isFinite(+end) || +end <= +start))
    )
      fail(422, "DOMAIN_INVARIANT");
    return [start, end];
  }
  app.post(base + "/circles/:circleId/memberships", (r) =>
    tenant(r, structureAccess(r, "ASSOCIATE"), async (ctx) => {
      const b = body(r, ["memberId", "startsAt", "endsAt"]);
      const circle = await get(
        ctx.c,
        ctx.org.id,
        (r.params as any).circleId,
        "CIRCLE",
      );
      await validMember(ctx, b.memberId);
      const [start, end] = dates(b);
      if (
        (
          await ctx.c.query(
            "SELECT 1 FROM circle_memberships WHERE organization_id=$1 AND member_id=$2 AND circle_id=$3 AND tstzrange(starts_at,ends_at,'[)') && tstzrange($4,$5,'[)')",
            [ctx.org.id, b.memberId, circle.id, start, end],
          )
        ).rowCount
      )
        fail(409, "STATE_CONFLICT");
      const m = (
        await ctx.c.query(
          "INSERT INTO circle_memberships(organization_id,id,member_id,circle_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [ctx.org.id, uuid(), b.memberId, circle.id, start, end],
        )
      ).rows[0];
      await recordStructure(ctx, m.id, "CircleMemberAssociated", null, m);
      await changed(ctx, r, m.id, "CircleMemberAssociated");
      return { membership: { ...camel(m), origin: "EXPLICIT" } };
    }),
  );
  app.post(base + "/circle-memberships/:membershipId/end", (r) =>
    tenant(r, structureAccess(r, "END_ASSOCIATION"), async (ctx) => {
      const b = body(r, ["endsAt"]);
      const membership = (
        await ctx.c.query(
          "SELECT * FROM circle_memberships WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [ctx.org.id, id((r.params as any).membershipId)],
        )
      ).rows[0];
      if (!membership) fail(404, "RESOURCE_NOT_FOUND");
      await get(ctx.c, ctx.org.id, membership.circle_id, "CIRCLE");
      version(r, membership.version);
      if (b.endsAt !== undefined && typeof b.endsAt !== "string")
        fail(400, "INVALID_REQUEST");
      const now = (await ctx.c.query("SELECT clock_timestamp() AS at")).rows[0]
        .at as Date;
      if (membership.ends_at && new Date(membership.ends_at) <= now)
        fail(409, "STATE_CONFLICT");
      const endsAt = b.endsAt === undefined ? now : new Date(b.endsAt);
      if (
        !Number.isFinite(+endsAt) ||
        +endsAt <= +new Date(membership.starts_at) ||
        (membership.ends_at && +endsAt > +new Date(membership.ends_at))
      )
        fail(422, "DOMAIN_INVARIANT");
      const updated = (
        await ctx.c.query(
          "UPDATE circle_memberships SET ends_at=$3,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [ctx.org.id, membership.id, endsAt],
        )
      ).rows[0];
      await recordStructure(
        ctx,
        membership.id,
        "CircleMembershipEnded",
        membership,
        updated,
      );
      await changed(ctx, r, membership.id, "CircleMembershipEnded");
      return { membership: { ...camel(updated), origin: "EXPLICIT" } };
    }),
  );
  app.post(base + "/roles/:roleId/occupancies", (r) =>
    tenant(r, structureAccess(r, "ASSIGN"), async (ctx) => {
      const b = body(r, ["memberId", "kind", "scope", "startsAt", "endsAt"]);
      if (!["DIRECT", "INTERIM"].includes(b.kind)) fail(400, "INVALID_REQUEST");
      if (b.kind === "INTERIM" && !b.endsAt) fail(422, "INTERIM_END_REQUIRED");
      const role = await get(
        ctx.c,
        ctx.org.id,
        (r.params as any).roleId,
        "ROLE",
      );
      await validMember(ctx, b.memberId);
      await core.foundationStructure()?.validateOccupancy(ctx, {
        roleId: role.id,
        memberId: id(b.memberId),
        kind: b.kind,
        startsAt:b.startsAt,
        endsAt: b.endsAt,
      });
      const [start, end] = dates(b);
      const o = (
        await ctx.c.query(
          "INSERT INTO occupancies(organization_id,id,member_id,role_id,kind,scope,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            ctx.org.id,
            uuid(),
            b.memberId,
            role.id,
            b.kind,
            optionalText(b.scope, 10000),
            start,
            end,
          ],
        )
      ).rows[0];
      await core.governanceModel()?.recordOccupancy(ctx, 'OCCUPANCY', o);
      await recordStructure(ctx, o.id, "RoleOccupied", null, o);
      await changed(ctx, r, o.id, "RoleOccupied");
      return { occupancy: { ...camel(o), circleId: role.parent_id } };
    }),
  );
  app.post(base + "/occupancies/:occupancyId/end", (r) =>
    tenant(r, structureAccess(r, "END"), async (ctx) => {
      const b = body(r, ["endsAt"]);
      const o = (
        await ctx.c.query(
          "SELECT * FROM occupancies WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, id((r.params as any).occupancyId)],
        )
      ).rows[0];
      if (!o) fail(404, "RESOURCE_NOT_FOUND");
      version(r, o.version);
      if (b.endsAt !== undefined && typeof b.endsAt !== "string")
        fail(400, "INVALID_REQUEST");
      const end = new Date(b.endsAt ?? Date.now());
      if (!Number.isFinite(+end) || +end <= +new Date(o.starts_at))
        fail(422, "DOMAIN_INVARIANT");
      if(await core.governanceModel()?.state(ctx)) {
        if(o.ends_at && +end>+new Date(o.ends_at))fail(422,'OCCUPANCY_END_CANNOT_EXTEND');
      }
      const updated = (
        await ctx.c.query(
          "UPDATE occupancies SET ends_at=$3,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [ctx.org.id, o.id, end],
        )
      ).rows[0];
      await core.governanceModel()?.recordEnd(ctx, 'OCCUPANCY', updated);
      await recordStructure(ctx, o.id, "RoleOccupancyEnded", o, updated);
      await changed(ctx, r, o.id, "RoleOccupancyEnded");
      return { occupancy: camel(updated) };
    }),
  );
  for (const [path, kind] of [
    ["/invitations", "SINGLE"],
    ["/invitations/batch", "BATCH"],
    ["/invitations/:invitationId/actions/change-access", "CHANGE"],
    ["/invitations/:invitationId/actions/resend", "RESEND"],
    ["/invitations/:invitationId/actions/cancel", "CANCEL"],
  ] as const) {
    app.post(base + path, (r) =>
      tenant(
        r,
        {
          mode: "authorization_write",
          authorize: (ctx) => core.authorizeInvitationRequest(ctx, r, kind),
          beforeReplay: (ctx, result) =>
            core.validateInvitationReplay(ctx, r, result, kind),
        },
        (ctx) =>
          kind === "SINGLE"
            ? core.issueInvitation(ctx, r, r.body)
            : kind === "BATCH"
              ? core.issueInvitationBatch(ctx, r, r.body)
              : kind === "RESEND"
                ? core.resendInvitation(ctx, r, id((r.params as any).invitationId))
                : kind === "CANCEL"
                  ? core.cancelInvitation(ctx, r, id((r.params as any).invitationId))
                  : core.changeInvitationAccess(
                  ctx,
                  r,
                  id((r.params as any).invitationId),
                  r.body,
                ),
      ),
    );
  }
  app.get(base + "/invitations", (r) =>
    tenant(
      r,
      {
        mode: "read",
        authorize: (ctx) => core.authorizeInvitationRequest(ctx, r, "LIST"),
      },
      (ctx) => core.listPendingInvitations(ctx, r),
    ),
  );
  const invitationPreviews = new Map<string, { count: number; until: number }>();
  app.post("/api/v1/invitations/preview", (r) => {
    const now = Date.now();
    for (const [ip, entry] of invitationPreviews)
      if (entry.until <= now) invitationPreviews.delete(ip);
    const rate = invitationPreviews.get(r.ip);
    if ((rate && rate.count >= 60) || (!rate && invitationPreviews.size >= 10000))
      fail(429, "RATE_LIMITED");
    invitationPreviews.set(r.ip, { count: (rate?.count ?? 0) + 1, until: rate?.until ?? now + 60000 });
    return core.previewInvitation(r);
  });
  app.post("/api/v1/invitations/accept", (r) => core.acceptInvitation(r));
  app.get(base + "/audit-events", (r) =>
    tenant(r, true, async (ctx) => {
      const q = r.query as any;
      if (
        Object.keys(q).some(
          (k) => !["cursor", "limit", "resourceId"].includes(k),
        )
      )
        fail(400, "INVALID_REQUEST");
      const limit = q.limit === undefined ? 50 : Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(400, "INVALID_REQUEST");
      const resource = q.resourceId ? id(q.resourceId) : null;
      let at = "9999-01-01T00:00:00Z",
        last = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      if (q.cursor) {
        try {
          const cursor = JSON.parse(
            Buffer.from(q.cursor, "base64url").toString(),
          );
          if (cursor.org !== ctx.org.id || cursor.resource !== resource)
            fail(400, "INVALID_REQUEST");
          at = cursor.at;
          last = id(cursor.last);
          if (typeof at !== "string" || !Number.isFinite(+new Date(at)))
            fail(400, "INVALID_REQUEST");
        } catch {
          fail(400, "INVALID_REQUEST");
        }
      }
      const rows = (
        await ctx.c.query(
          "SELECT id,action,actor_id,resource_id,at,request_id,to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS cursor_at FROM audit_events WHERE organization_id=$1 AND ($2::uuid IS NULL OR resource_id=$2) AND (at,id)<($3::timestamptz,$4::uuid) ORDER BY at DESC,id DESC LIMIT $5",
          [ctx.org.id, resource, at, last, limit + 1],
        )
      ).rows;
      const items = rows.slice(0, limit),
        hasMore = rows.length > limit;
      return {
        items: items.map(({ cursor_at, ...x }) => camel(x)),
        page: {
          hasMore,
          nextCursor: hasMore
            ? Buffer.from(
                JSON.stringify({
                  org: ctx.org.id,
                  resource,
                  at: items.at(-1)!.cursor_at + "Z",
                  last: items.at(-1)!.id,
                }),
              ).toString("base64url")
            : null,
        },
      };
    }),
  );
  app.get("/api/live", async () => ({ status: "alive" }));
  for (const route of ["/api/health", "/api/ready"])
    app.get(route, async (_r, reply) => {
      const result = await readiness(migrationSelection);
      if (result.status !== "ok") reply.code(503);
      return result;
    });
  await registerAccountRoutes(app, core);
  await core.registerMfaRoutes(app);
  await core.registerAccountEmailRoutes(app);
  await core.registerAccountMediaRoutes(app);
  app.get(
    "/api/v1/organizations/:organizationId/security/requirements",
    async (r) =>
      core.tenant(
        r,
        { mode: "read", credentialStepUp: true, authorize: () => true },
        (ctx) => core.credentialRequirements(ctx),
      ),
  );
  app.post(
    "/api/v1/organizations/:organizationId/security/attest",
    async (r) => {
      const input = body(r, ["password", "totpCode"]);
      key(r);
      return core.tenant(
        r,
        { mode: "write", credentialStepUp: true, authorize: () => true },
        (ctx) => core.attestCredential(ctx, input),
      );
    },
  );
  await core.registerProvisionedEnrollmentRoutes(app);
  await core.registerPublicAdmissionRoutes(app);
  for (const module of modules) await module(app, core);
  if (migrationSelection.scope === 'all' || (migrationSelection.maxPrefix ?? 0) >= 924)
    await registerOrganizationDeletionRoutes(app,core,options.organizationDeletion);
  return app;
}

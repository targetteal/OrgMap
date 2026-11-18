import type { FastifyRequest } from "fastify";
import type { Ctx } from "./runtime.js";
import { id, fail, uuid, event } from "./core.js";
import type {
  GuestAccessAdapter,
  GuestGrant,
  InvitationAccessPlan,
  ScopedResource,
} from "./guest-contract.js";
export const isGuest = (ctx: Ctx) => ctx.member.member_type === "GUEST";
const label = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value)
  )
    fail(400, "INVALID_ACCESS_PLAN");
  return value as string;
};
export function accessPlan(value: unknown): InvitationAccessPlan {
  if (!Array.isArray(value) || value.length > 100)
    fail(400, "INVALID_ACCESS_PLAN");
  const seen = new Set<string>();
  return (value as any[]).map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Object.keys(entry).some((k) => !["resource", "actions"].includes(k)) ||
      !entry.resource ||
      Object.keys(entry.resource).some(
        (k) => !["context", "kind", "id"].includes(k),
      ) ||
      !Array.isArray(entry.actions) ||
      !entry.actions.length ||
      entry.actions.length > 16
    )
      fail(400, "INVALID_ACCESS_PLAN");
    const resource = {
        context: label(entry.resource.context),
        kind: label(entry.resource.kind),
        id: id(entry.resource.id),
      },
      key = resource.context + ":" + resource.kind + ":" + resource.id;
    if (seen.has(key)) fail(400, "INVALID_ACCESS_PLAN");
    seen.add(key);
    const actions = [...new Set<string>(entry.actions.map(label))].sort();
    return { resource, actions };
  });
}
const refEqual = (a: ScopedResource, b: ScopedResource) =>
  a.context === b.context && a.kind === b.kind && a.id === b.id;
export function createGuestServices() {
  const adapters = new Map<string, GuestAccessAdapter>();
  function registerGuestAccessAdapter(adapter: GuestAccessAdapter) {
    label(adapter.context);
    if (adapters.has(adapter.context))
      throw Error("Guest adapter already registered");
    for (const route of adapter.routes) {
      if (
        !route.path.startsWith("/api/") ||
        !route.action ||
        (!route.collection && !route.resolve && !route.transport) ||
        (route.collection && route.method !== "GET") ||
        (route.transport && (route.resolve || route.collection))
      )
        throw Error("Invalid Guest route");
    }
    adapters.set(adapter.context, adapter);
  }
  async function validateGuestAccessPlan(ctx: Ctx, value: unknown) {
    if (isGuest(ctx)) fail(403, "ACTION_DENIED");
    const plan = accessPlan(value);
    for (const context of new Set(plan.map((p) => p.resource.context))) {
      const adapter = adapters.get(context);
      if (!adapter) fail(503, "GUEST_CONTEXT_UNAVAILABLE");
      if (
        !(await adapter!.validateSharePlan(
          ctx,
          plan.filter((p) => p.resource.context === context),
        ))
      )
        fail(403, "ACTION_DENIED");
    }
    return plan;
  }
  async function revalidateGrant(ctx: Ctx, row: any) {
    const adapter = adapters.get(row.context);
    if (!adapter) return false;
    const grantor = (
      await ctx.c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type='MEMBER'",
        [ctx.org.id, row.grantor_member_id],
      )
    ).rows[0];
    if (!grantor) return false;
    const account = (
      await ctx.c.query(
        "SELECT id,email,display_name FROM accounts WHERE id=$1",
        [grantor.account_id],
      )
    ).rows[0];
    if (!account) return false;
    try {
      const { principal: _principal, ...sourceContext } = ctx;
      return await adapter.validateSharePlan(
        { ...sourceContext, member: grantor, account },
        [
          {
            resource: {
              context: row.context,
              kind: row.kind,
              id: row.resource_id,
            },
            actions: row.actions,
          },
        ],
      );
    } catch {
      return false;
    }
  }
  async function guestGrants(ctx: Ctx): Promise<GuestGrant[]> {
    const result: GuestGrant[] = [];
    for (const row of (
      await ctx.c.query(
        "SELECT * FROM guest_resource_grants WHERE organization_id=$1 AND member_id=$2 AND revoked_at IS NULL ORDER BY id",
        [ctx.org.id, ctx.member.id],
      )
    ).rows) {
      if (await revalidateGrant(ctx, row))
        result.push({
          id: row.id,
          resource: {
            context: row.context,
            kind: row.kind,
            id: row.resource_id,
          },
          actions: row.actions,
          grantorMemberId: row.grantor_member_id,
          version: row.version,
        });
    }
    return result;
  }
  async function requireGuestResource(
    ctx: Ctx,
    resource: ScopedResource,
    action: string,
  ) {
    if (!isGuest(ctx)) return;
    const target = {
      context: label(resource.context),
      kind: label(resource.kind),
      id: id(resource.id),
    };
    if (
      !(await guestGrants(ctx)).some(
        (g) => refEqual(g.resource, target) && g.actions.includes(action),
      )
    )
      fail(404, "RESOURCE_NOT_FOUND");
  }
  async function guestResourceIds(
    ctx: Ctx,
    input: { context: string; kind: string; action: string },
  ): Promise<readonly string[]> {
    return (await guestGrants(ctx))
      .filter(
        (g) =>
          g.resource.context === input.context &&
          g.resource.kind === input.kind &&
          g.actions.includes(input.action),
      )
      .map((g) => g.resource.id);
  }
  async function guestStructureScope(ctx: Ctx) {
    return {
      roots: (await guestGrants(ctx))
        .filter(
          (g) =>
            g.resource.context === "structure" &&
            ["circle", "role"].includes(g.resource.kind) &&
            g.actions.includes("read"),
        )
        .map((g) => g.resource),
      authorizationRevision: Number(ctx.org.authorization_revision),
    };
  }
  async function visibleMemberIds(
    ctx: Ctx,
    input: {
      purpose: "DIRECTORY" | "ASSIGNEE_PICKER";
      resource?: ScopedResource;
    },
  ): Promise<readonly string[]> {
    if (!isGuest(ctx))
      return (
        await ctx.c.query(
          "SELECT id FROM members WHERE organization_id=$1 AND status='ACTIVE'",
          [ctx.org.id],
        )
      ).rows.map((r) => r.id);
    if (input.resource) await requireGuestResource(ctx, input.resource, "read");
    const resources = (await guestGrants(ctx))
      .filter(
        (g) =>
          g.actions.includes("read") &&
          (!input.resource || refEqual(g.resource, input.resource)),
      )
      .map((g) => g.resource);
    const ids = new Set<string>([ctx.member.id]);
    for (const context of new Set(resources.map((r) => r.context))) {
      const adapter = adapters.get(context);
      for (const memberId of (await adapter?.visibleMemberIds?.(
        ctx,
        resources.filter((r) => r.context === context),
        input.purpose,
      )) ?? [])
        ids.add(id(memberId));
    }
    return (
      await ctx.c.query(
        "SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",
        [ctx.org.id, [...ids]],
      )
    ).rows.map((r) => r.id);
  }
  async function requireGuestRoute(
    ctx: Ctx,
    input: {
      routeId: string;
      method: string;
      request: FastifyRequest;
      mode: Ctx["mode"];
    },
  ) {
    if (!isGuest(ctx)) return;
    const base = "/api/v1/organizations/:organizationId";
    if (
      input.method === "GET" &&
      ["/bootstrap", "/structure", "/members", "/members/:memberId/avatar", "/branding/workspace", "/branding/workspace-logo"].some(
        (path) => base + path === input.routeId,
      )
    )
      return;
    for (const adapter of adapters.values())
      for (const route of adapter.routes) {
        if (route.path !== input.routeId || route.method !== input.method)
          continue;
        if (route.transport || route.collection) return;
        await requireGuestResource(
          ctx,
          await route.resolve!(ctx, input.request),
          route.action,
        );
        return;
      }
    fail(404, "RESOURCE_NOT_FOUND");
  }
  async function applyGuestAccessPlan(
    ctx: Ctx,
    memberId: string,
    value: unknown,
  ) {
    if (ctx.mode === "read") fail(403, "ACTION_DENIED");
    const plan = await validateGuestAccessPlan(ctx, value);
    const target = (
      await ctx.c.query(
        "SELECT id FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
        [ctx.org.id, id(memberId)],
      )
    ).rows[0];
    if (!target) fail(404, "RESOURCE_NOT_FOUND");
    for (const item of plan)
      await ctx.c.query(
        "INSERT INTO guest_resource_grants(organization_id,id,member_id,grantor_member_id,context,kind,resource_id,actions) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id,member_id,context,kind,resource_id) DO UPDATE SET actions=excluded.actions,grantor_member_id=excluded.grantor_member_id,revoked_at=NULL,version=guest_resource_grants.version+1",
        [
          ctx.org.id,
          uuid(),
          target.id,
          ctx.member.id,
          item.resource.context,
          item.resource.kind,
          item.resource.id,
          JSON.stringify(item.actions),
        ],
      );
    if (plan.length) {
      await ctx.c.query(
        "UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1",
        [ctx.org.id],
      );
      await event(
        ctx.c,
        ctx.org.id,
        ctx.account.id,
        target.id,
        "MemberResourceAccessGranted",
        ctx.requestId ?? uuid(),
      );
    }
    return plan;
  }
  return {
    isGuest,
    registerGuestAccessAdapter,
    validateGuestAccessPlan,
    applyGuestAccessPlan,
    guestGrants,
    guestResourceIds,
    guestStructureScope,
    requireGuestResource,
    requireGuestRoute,
    visibleMemberIds,
  };
}

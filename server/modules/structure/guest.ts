import type {
  GuestAccessAdapter,
  ScopedResource,
} from "../../src/guest-contract.js";
import type { ModuleRuntime, Ctx } from "../../src/runtime.js";
import type { StructurePortsOptions } from "./ports.js";
import { StructureService } from "./service.js";
import { id } from "../../src/core.js";
/** Baseline structural shares are READ-only explicit roots, never inherited. */
export function createStructureGuestAccessAdapter(
  core: ModuleRuntime,
  options: StructurePortsOptions = {},
): GuestAccessAdapter {
  const base = "/api/v1/organizations/:organizationId";
  return {
    context: "structure",
    routes: [
      {
        method: "GET",
        path: base + "/structure",
        action: "read",
        collection: true,
      },
      {
        method: "GET",
        path: base + "/structure-advanced/graph",
        action: "read",
        collection: true,
      },
      ...(["circle", "role"] as const).map((kind) => ({
        method: "GET" as const,
        path: base + "/" + kind + "s/:entityId",
        action: "read",
        resolve: async (_ctx: Ctx, request: any): Promise<ScopedResource> => ({
          context: "structure",
          kind,
          id: id(request.params.entityId),
        }),
      })),
    ],
    async validateSharePlan(ctx, plan) {
      if (ctx.member.member_type === "GUEST" || ctx.member.status !== "ACTIVE")
        return false;
      const service = new StructureService(ctx, core, undefined, options);
      for (const item of plan) {
        if (
          item.resource.context !== "structure" ||
          !["circle", "role"].includes(item.resource.kind) ||
          item.actions.length !== 1 ||
          item.actions[0] !== "read"
        )
          return false;
        try {
          const entity = await service.entity(
            id(item.resource.id),
            item.resource.kind.toUpperCase(),
          );
          if (!(await service.canEntity(entity.id, "ADMIN"))) return false;
        } catch {
          return false;
        }
      }
      return true;
    },
    async visibleMemberIds(ctx) {
      return [ctx.member.id];
    },
  };
}

import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type {
  GuestAccessAdapter,
  ScopedResource,
} from "../../src/guest-contract.js";
import { fail, id, text } from "../../src/core.js";
import type { ResourceRef } from "./ports.js";
export interface PlatformGuestMappingPort {
  /** Trusted host/domain mapping. Never populated from a request body or a platform grant. */
  resolveOriginalResource(
    ctx: Ctx,
    ref: ResourceRef,
  ): Promise<ScopedResource | undefined>;
}
/** Register exactly once in the shared HTTP/worker factory. No grants belong to this wrapper. */
export function createPlatformGuestAccessAdapter(
  core: ModuleRuntime,
  mapping: PlatformGuestMappingPort,
): GuestAccessAdapter {
  const base = "/api/v1/organizations/:organizationId/platform";
  const resolve = async (ctx: Ctx, ref: ResourceRef, action: string) => {
    const resource = await mapping.resolveOriginalResource(ctx, ref);
    if (!resource || resource.context === "platform-wrapper")
      fail(404, "RESOURCE_NOT_FOUND");
    await core.requireGuestResource(ctx, resource!, action);
    return resource!;
  };
  return {
    context: "platform-wrapper",
    validateSharePlan: async () => false,
    routes: [
      {
        method: "GET",
        path: base + "/search",
        action: "read",
        collection: true,
      },
      {
        method: "GET",
        path: base + "/favorites",
        action: "read",
        collection: true,
      },
      {
        method: "GET",
        path: base + "/notifications",
        action: "read",
        collection: true,
      },
      {
        method: "POST",
        path: base + "/notifications/:deliveryId/read",
        action: "read",
        resolve: async (ctx, request) => {
          const delivery = (
            await ctx.c.query(
              "SELECT resource_type,resource_id FROM platform_deliveries WHERE organization_id=$1 AND recipient_id=$2 AND id=$3",
              [
                ctx.org.id,
                ctx.member.id,
                id((request.params as any).deliveryId),
              ],
            )
          ).rows[0];
          if (!delivery) fail(404, "RESOURCE_NOT_FOUND");
          return resolve(
            ctx,
            { type: delivery.resource_type, id: delivery.resource_id },
            "read",
          );
        },
      },
      ...(
        [
          ["GET", "capabilities", "read"],
          ["GET", "comments", "read"],
          ["GET", "files", "read"],
          ["POST", "comments", "comment"],
          ["POST", "uploads", "attach"],
          ["POST", "favorite", "read"],
          ["POST", "follow", "follow"],
        ] as const
      ).map(([method, suffix, action]) => ({
        method,
        path: base + "/resources/:resourceType/:resourceId/" + suffix,
        action,
        resolve: async (ctx: Ctx, request: any) =>
          resolve(
            ctx,
            {
              type: text(request.params.resourceType, 50),
              id: id(request.params.resourceId),
            },
            action,
          ),
      })),
      {
        method: "GET",
        path: base + "/files/:fileId/download",
        action: "read",
        resolve: async (ctx, request) => {
          // Only wrapper metadata, before original-resource authorization; never bytes/title/body.
          const file = (
            await ctx.c.query(
              "SELECT resource_type,resource_id FROM platform_files WHERE organization_id=$1 AND id=$2 AND state='READY'",
              [ctx.org.id, id((request.params as any).fileId)],
            )
          ).rows[0];
          if (!file) fail(404, "RESOURCE_NOT_FOUND");
          return resolve(
            ctx,
            { type: file.resource_type, id: file.resource_id },
            "read",
          );
        },
      },
    ],
  };
}

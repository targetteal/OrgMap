import type { GuestAccessAdapter } from "../../src/guest-contract.js";
import { canManage } from "./index.js";

/** Explicit entry-only share. Never grants settings, directory or public-page drafts. */
export function createAdministrationGuestAccessAdapter(): GuestAccessAdapter {
  const path = "/api/v1/organizations/:organizationId/entry";
  return {
    context: "administration",
    routes: [
      {
        method: "GET",
        path,
        action: "read",
        resolve: async (ctx) => ({
          context: "administration",
          kind: "entry",
          id: ctx.org.id,
        }),
      },
      {
        method: "POST",
        path: path + "/acknowledge",
        action: "acknowledge",
        resolve: async (ctx) => ({
          context: "administration",
          kind: "entry",
          id: ctx.org.id,
        }),
      },
    ],
    async validateSharePlan(ctx, plan) {
      if (
        ctx.member.member_type === "GUEST" ||
        ctx.member.status !== "ACTIVE" ||
        !(await canManage(ctx, "settings.manage"))
      )
        return false;
      return plan.every(
        (item) =>
          item.resource.context === "administration" &&
          item.resource.kind === "entry" &&
          item.resource.id === ctx.org.id &&
          item.actions.includes("read") &&
          item.actions.every(
            (action) => action === "read" || action === "acknowledge",
          ),
      );
    },
    async visibleMemberIds(ctx) {
      return [ctx.member.id];
    },
  };
}

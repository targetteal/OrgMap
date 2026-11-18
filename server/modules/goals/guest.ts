import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type { GuestAccessAdapter } from "../../src/guest-contract.js";
import { id, Failure } from "../../src/core.js";
import { goalManageAccess } from "./ports.js";

/** Exact resource grants. No public, parent, circle or goal-to-KR inheritance. */
export function createGoalsGuestAccessAdapter(core: Pick<ModuleRuntime,"assertModuleAvailable">): GuestAccessAdapter {
  const base = "/api/v1/organizations/:organizationId";
  return {
    context: "goals",
    routes: [
      { method: "GET", path: base + "/goals", action: "read", collection: true },
      { method: "GET", path: base + "/goal-periods", action: "read", collection: true },
      { method: "GET", path: base + "/goals/:goalId", action: "read",
        resolve: async (_ctx, request) => ({context:"goals",kind:"goal",id:id((request.params as any).goalId)}) },
      { method: "GET", path: base + "/goals/key-results/:keyResultId", action: "read",
        resolve: async (_ctx, request) => ({context:"goals",kind:"key-result",id:id((request.params as any).keyResultId)}) },
    ],
    async validateSharePlan(ctx, plan) {
      await core.assertModuleAvailable(ctx,"goals");
      if (ctx.member.member_type === "GUEST" || ctx.member.status !== "ACTIVE") return false;
      for (const item of plan) {
        if(item.resource.context !== "goals" || !["goal","key-result"].includes(item.resource.kind) || item.actions.some(action=>action!=="read")) return false;
        const result = item.resource.kind === "goal"
          ? await ctx.c.query("SELECT * FROM goals WHERE organization_id=$1 AND id=$2",[ctx.org.id,id(item.resource.id)])
          : await ctx.c.query("SELECT g.* FROM goal_key_results k JOIN goals g ON g.organization_id=k.organization_id AND g.id=k.goal_id WHERE k.organization_id=$1 AND k.id=$2",[ctx.org.id,id(item.resource.id)]);
        if(!result.rows[0] || !(await goalManageAccess(ctx,result.rows[0]))) return false;
      }
      return true;
    },
  };
}
export async function guestGoalRead(core: Pick<ModuleRuntime,"requireGuestResource">, ctx: Ctx, kind: "goal"|"key-result", resourceId: string): Promise<boolean> {
  try { await core.requireGuestResource(ctx,{context:"goals",kind,id:resourceId},"read"); return true; }
  catch(error) { if(error instanceof Failure && [403,404].includes(error.status)) return false; throw error; }
}

import type { Ctx } from "../../src/runtime.js";
import { id, uuid, fail } from "../../src/core.js";
export interface ScopeSchedulingPort {
  /** In the producer/retry transaction; recipient validation belongs to its domain/IAM port. */
  schedule(
    ctx: Ctx,
    options?: { availableAt?: Date; memberId?: string },
  ): Promise<void>;
}
export function createPlatformScheduling(
  participant: string,
): ScopeSchedulingPort {
  if (!/^[a-z][a-z0-9-]{0,49}$/.test(participant))
    throw Error("Invalid scheduling participant");
  return {
    async schedule(ctx, options = {}) {
      if (ctx.mode === "read") fail(403, "WRITE_CONTEXT_REQUIRED");
      const memberId = id(options.memberId ?? ctx.member.id),
        availableAt = options.availableAt ?? null;
      if (availableAt && !Number.isFinite(availableAt.getTime()))
        fail(400, "INVALID_SCHEDULE");
      await ctx.c.query(
        "INSERT INTO platform_worker_scopes(organization_id,member_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [ctx.org.id, memberId],
      );
      await ctx.c.query(
        "INSERT INTO platform_scope_wakes(organization_id,id,member_id,participant,available_at) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,clock_timestamp()))",
        [ctx.org.id, uuid(), memberId, participant, availableAt],
      );
    },
  };
}

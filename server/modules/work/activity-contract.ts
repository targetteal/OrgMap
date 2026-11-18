import type { Ctx } from "../../src/runtime.js";
/** Work supplies only IDs authorized in its current transaction; Foundation owns audit storage. */
export interface WorkActivityPort {
  read(ctx: Ctx, input: { resourceIds: string[]; limit: number }): Promise<{
    entries: { id: string; resourceId: string; action: string; at: string; actorMemberId: string | null }[];
    coverage: "CANONICAL_AUDIT";
    hasMore: boolean;
  }>;
}

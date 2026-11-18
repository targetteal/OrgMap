import type { Ctx } from "../../src/runtime.js";
import { fail, id } from "../../src/core.js";
import { createGovernanceResourceAdapters } from "./ports.js";
import {Governance,type GovernancePorts } from "./service.js";
export type GovernanceMeetingItem = {
  id: string;
  kind: "PROPOSAL";
  title: string;
  circleId: string;
  url: string;
};
export function createGovernanceMeetingItems(ports: GovernancePorts = {}) {
  const adapter = createGovernanceResourceAdapters(ports).proposal;
  return async function listMeetingItems(
    ctx: Ctx,
    input: { circleIds: string[] },
  ): Promise<GovernanceMeetingItem[]> {
    if (!Array.isArray(input.circleIds) || input.circleIds.length > 1000)
      fail(400, "INVALID_REQUEST");
    const circles = [...new Set(input.circleIds.map(id))];
    if (!circles.length) return [];
    const g=new Governance(ctx,{} as any,ports),guestIds=g.isGuest()?await g.guestIds("proposal"):null;
    const rows = (
      await ctx.c.query(
        "SELECT id,title,circle_id FROM gov_proposals WHERE organization_id=$1 AND circle_id=ANY($2::uuid[]) AND state IN ('DRAFT','REVIEW') AND ($3::uuid[] IS NULL OR id=ANY($3::uuid[])) ORDER BY id",
        [ctx.org.id, circles,guestIds],
      )
    ).rows;
    const items: GovernanceMeetingItem[] = [];
    for (const row of rows) {
      if (await adapter.authorize(ctx, row.id, "read"))
        items.push({
          id: row.id,
          kind: "PROPOSAL",
          title: row.title,
          circleId: row.circle_id,
          url: "/structure/proposals/" + row.id,
        });
    }
    return items;
  };
}
export const listMeetingItems = createGovernanceMeetingItems();

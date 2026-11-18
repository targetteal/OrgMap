import type { Ctx } from "../../src/runtime.js";
import { id, text, uuid, fail, event, camel } from "../../src/core.js";
import { goalAccess } from "./ports.js";
export type LinkedGoalMeetingItem = {
  id: string;
  kind: "GOAL";
  title: string;
  circleId: string;
  url: string;
};
/** Caller already owns the transaction/organization guard and validates the tension source. */
export async function createGoalFromTension(
  ctx: Ctx,
  input: { title: string; circleId: string; tensionId: string },
): Promise<{ id: string }> {
  if (
    ctx.mode === "read" ||
    ctx.member.status !== "ACTIVE" ||
    ctx.member.org_role !== "OWNER"
  )
    fail(403, "ACTION_DENIED");
  const circleId = id(input.circleId),
    tensionId = id(input.tensionId),
    title = text(input.title);
  if (
    !(
      await ctx.c.query(
        "SELECT 1 FROM entities WHERE organization_id=$1 AND id=$2 AND kind='CIRCLE' AND NOT archived",
        [ctx.org.id, circleId],
      )
    ).rowCount
  )
    fail(404, "RESOURCE_NOT_FOUND");
  const prior = (
    await ctx.c.query(
      "SELECT g.* FROM goal_origins o JOIN goals g ON g.organization_id=o.organization_id AND g.id=o.goal_id WHERE o.organization_id=$1 AND o.source_kind='TENSION' AND o.source_id=$2",
      [ctx.org.id, tensionId],
    )
  ).rows[0];
  if (prior) {
    if (!(await goalAccess(ctx, prior))) fail(404, "RESOURCE_NOT_FOUND");
    return { id: prior.id };
  }
  // No arbitrary choice between overlapping periods, and no unconfigured/fictitious period.
  const periods = (
    await ctx.c.query(
      "SELECT id FROM goal_periods WHERE organization_id=$1 AND NOT archived AND starts_on<=(now() AT TIME ZONE $2)::date AND ends_on>=(now() AT TIME ZONE $2)::date ORDER BY starts_on,id",
      [ctx.org.id, ctx.org.time_zone],
    )
  ).rows;
  if (periods.length !== 1) fail(422, "GOAL_PERIOD_SELECTION_REQUIRED");
  const gid = uuid();
  const g = (
    await ctx.c.query(
      "INSERT INTO goals(organization_id,id,title,owner_type,owner_id,circle_id) VALUES($1,$2,$3,'CIRCLE',$4,$4) RETURNING *",
      [ctx.org.id, gid, title, circleId],
    )
  ).rows[0];
  await ctx.c.query("INSERT INTO goal_period_links VALUES($1,$2,$3)", [
    ctx.org.id,
    gid,
    periods[0].id,
  ]);
  await ctx.c.query(
    "INSERT INTO goal_assignments VALUES($1,$2,$3,NULL,$4,'LEAD',NULL)",
    [ctx.org.id, uuid(), gid, ctx.member.id],
  );
  await ctx.c.query("INSERT INTO goal_origins VALUES($1,$2,'TENSION',$3)", [
    ctx.org.id,
    gid,
    tensionId,
  ]);
  await ctx.c.query(
    "INSERT INTO goal_history(organization_id,id,goal_id,actor_id,action,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
    [
      ctx.org.id,
      uuid(),
      gid,
      ctx.account.id,
      "goal.created.from-tension",
      {
        formulaVersion: "orgmap-progress-v1",
        goal: camel(g),
        origin: { kind: "TENSION", id: tensionId },
      },
    ],
  );
  await ctx.c.query(
    "UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1",
    [ctx.org.id],
  );
  await event(
    ctx.c,
    ctx.org.id,
    ctx.account.id,
    gid,
    "goal.created.from-tension",
    uuid(),
  );
  return { id: gid };
}
export async function listMeetingItems(
  ctx: Ctx,
  input: { circleIds: string[] },
): Promise<LinkedGoalMeetingItem[]> {
  if (!Array.isArray(input.circleIds) || input.circleIds.length > 100)
    fail(400, "INVALID_REQUEST");
  const ids = [...new Set(input.circleIds.map(id))];
  if (!ids.length) return [];
  const rows = (
    await ctx.c.query(
      "SELECT * FROM goals WHERE organization_id=$1 AND circle_id=ANY($2::uuid[]) AND lifecycle NOT IN ('ARCHIVED','CLOSED') ORDER BY title,id",
      [ctx.org.id, ids],
    )
  ).rows;
  const result: LinkedGoalMeetingItem[] = [];
  for (const g of rows)
    if (await goalAccess(ctx, g))
      result.push({
        id: g.id,
        kind: "GOAL",
        title: g.title,
        circleId: g.circle_id,
        url: "/goals/" + g.id,
      });
  return result;
}

import { guestGoalRead } from "./guest.js";
import { publishGoalNotifications } from "./notifications.js";
import type { OrgMapModule, Ctx } from "../../src/runtime.js";
import type { MemberProfileAuthority } from "../../src/member-profile-pagination.js";
import { memberGoals } from "./member-profile.js";
import type { FastifyRequest } from "fastify";
import {
  body as parseBody,
  camel,
  fail,
  id,
  text,
  optionalText,
  uuid,
  version,
} from "../../src/core.js";
import { page } from "./pagination.js";
import {validateRichDocument,toPlainText,ContentValidationError} from "../../../packages/content/index.js";
function richDescription(value: unknown) {
  try { const document=validateRichDocument(value);return {document,plain:toPlainText(document)}; }
  catch(error) {if(error instanceof ContentValidationError)fail(400,"INVALID_RICH_DOCUMENT");throw error;}
}
function descriptionBody(b:Record<string,any>) {
  if(b.descriptionRich===undefined)return b;
  const rich=richDescription(b.descriptionRich);
  return {...b,description:rich.plain,descriptionRich:rich.document};
}
import { goalAccess, goalManageAccess } from "./ports.js";
import { aggregate, progress, decimal, choice, bool, date, calendarPeriodEnd, currentMonthWindow } from "./domain.js";
function body(r: FastifyRequest, keys: string[]) {
  const b = parseBody(r, keys);
  for (const [key, value] of Object.entries(b))
    if (
      value === null &&
      ![
        "description",
        "unit",
        "ownerViaRoleId",
        "parentId",
        "comment",
        "confidenceLevel",
      ].includes(key)
    )
      fail(400, "INVALID_REQUEST");
  return b;
}
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "INVALID_REQUEST");
  return value as Record<string, any>;
}
const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"] as const;
const HEALTH = ["ON_TRACK", "AT_RISK", "BLOCKED"] as const;
export type GoalLinkResolver = (
  ctx: Ctx,
  kind: "TASK" | "PROJECT",
  resourceId: string,
) => Promise<{ id: string; title: string; titleSource?: "FALLBACK" } | null>;
export function createGoalsModule(
  options: { resolveLink?: GoalLinkResolver; requireMemberProfileRead?: MemberProfileAuthority; trace?: import('../../src/traceability.js').TraceabilityPort } = {},
): OrgMapModule {
  return async (app, core) => {
    const base = "/api/v1/organizations/:organizationId";
    const owner = (x: Ctx) => x.member.member_type !== "GUEST" && x.member.org_role === "OWNER";
    async function load(x: Ctx, gid: string) {
      const g = (
        await x.c.query(
          "SELECT * FROM goals WHERE organization_id=$1 AND id=$2",
          [x.org.id, id(gid)],
        )
      ).rows[0];
      if (!g) fail(404, "RESOURCE_NOT_FOUND");
      return g;
    }
    const allowed = async (x: Ctx, g: any, write = false) => x.member.member_type === "GUEST"
      ? !write && x.member.status === "ACTIVE" && guestGoalRead(core,x,"goal",g.id)
      : goalAccess(x,g,write);
    async function requireGoal(x: Ctx, gid: string, write = false) {
      const g = await load(x, gid);
      if (!(await allowed(x, g, write)))
        fail(write ? 403 : 404, write ? "ACTION_DENIED" : "RESOURCE_NOT_FOUND");
      return g;
    }
    async function member(x: Ctx, mid: string) {
      if (
        !(
          await x.c.query(
            "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
            [x.org.id, id(mid)],
          )
        ).rowCount
      )
        fail(404, "RESOURCE_NOT_FOUND");
    }
    async function viaRole(x: Ctx, mid: string, rid: unknown) {
      if (rid === null || rid === undefined) return null;
      await core.get(x.c, x.org.id, id(rid), "ROLE");
      if (
        !(
          await x.c.query(
            "SELECT 1 FROM occupancies WHERE organization_id=$1 AND member_id=$2 AND role_id=$3 AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())",
            [x.org.id, mid, rid],
          )
        ).rowCount
      )
        fail(422, "DOMAIN_INVARIANT");
      return rid;
    }
    async function detail(
      x: Ctx,
      gid: string,
      visited = new Set<string>(),
    ): Promise<any> {
      if (visited.has(gid)) fail(422, "DOMAIN_INVARIANT");
      visited.add(gid);
      const g = await requireGoal(x, gid);
      let krs: any[] = (
        await x.c.query(
          "SELECT * FROM goal_key_results WHERE organization_id=$1 AND goal_id=$2 ORDER BY id",
          [x.org.id, gid],
        )
      ).rows.map((k) => ({
        ...camel(k),
        progress: progress(k.initial_value, k.current_value, k.target_value),
      }));
      const guest = x.member.member_type === "GUEST";
      let hiddenKrContributor = false;
      if (guest) {
        const visible = [];
        for (const k of krs) {
          if (await guestGoalRead(core,x,"key-result",k.id)) visible.push(k);
          else if (!k.excluded && !k.archived && decimal(k.weight)>0) hiddenKrContributor = true;
        }
        krs = visible;
      }
      const children = (
        await x.c.query(
          "SELECT * FROM goals WHERE organization_id=$1 AND parent_id=$2 ORDER BY id",
          [x.org.id, gid],
        )
      ).rows;
      const childItems = [];
      let hidden = false;
      let hiddenContributor = false;
      for (const c of children) {
        if (await allowed(x, c))
          childItems.push(await detail(x, c.id, new Set(visited)));
        else {
          hidden = true;
          if (
            !c.excluded &&
            c.lifecycle !== "ARCHIVED" &&
            decimal(c.weight) > 0
          )
            hiddenContributor = true;
        }
      }
      for (const k of krs) {
        k.links = [];
        if (options.resolveLink && !guest) {
          const links = (
            await x.c.query(
              "SELECT resource_kind,resource_id FROM goal_resource_links WHERE organization_id=$1 AND key_result_id=$2",
              [x.org.id, k.id],
            )
          ).rows;
          for (const link of links) {
            const resolved = await options.resolveLink(
              x,
              link.resource_kind,
              link.resource_id,
            );
            if (resolved)
              k.links.push({ kind: link.resource_kind, ...resolved });
          }
        }
      }
      const calculated = aggregate(
        g.source,
        g.manual_progress,
        krs.map((k) => ({
          id: k.id,
          progress: k.progress.display,
          weight: k.weight,
          excluded: k.excluded,
          archived: k.archived,
        })),
        childItems.map((c) => ({
          id: c.id,
          progress: c.progress.display,
          weight: c.weight,
          excluded: c.excluded,
          archived: c.lifecycle === "ARCHIVED",
        })),
        g.kr_weight,
        g.child_weight,
      );
      if (
        (hiddenKrContributor && (g.source === "KEY_RESULTS" || (g.source === "BOTH" && decimal(g.kr_weight)>0))) ||
        hiddenContributor &&
        (g.source === "CHILD_GOALS" ||
          (g.source === "BOTH" && decimal(g.child_weight) > 0))
      ) {
        calculated.raw = null;
        calculated.display = null;
        calculated.reason = "INCOMPLETE_AUTHORIZED_COVERAGE";
      }
      return {
        ...camel(g),
        ...(guest ? {ownerId:null,ownerViaRoleId:null,circleId:null,parentId:g.parent_id && await guestGoalRead(core,x,"goal",g.parent_id) ? g.parent_id : null} : {}),
        progress: calculated,
        progressBreakdown: {
          formulaVersion: calculated.formulaVersion,
          source: g.source,
          krWeight: g.kr_weight,
          childWeight: g.child_weight,
          keyResults: krs.map((k) => ({
            id: k.id,
            version: k.version,
            progress: k.progress,
            weight: k.weight,
            excluded: k.excluded,
            archived: k.archived,
          })),
          children: childItems.map((c) => ({
            id: c.id,
            version: c.version,
            progress: c.progress,
            weight: c.weight,
            excluded: c.excluded,
            lifecycle: c.lifecycle,
          })),
          coverage: hidden || hiddenKrContributor ? "INCOMPLETE_AUTHORIZED_COVERAGE" : "COMPLETE",
        },
        keyResults: krs,
        children: childItems,
        periodIds: (
          await x.c.query(
            "SELECT period_id FROM goal_period_links WHERE organization_id=$1 AND goal_id=$2",
            [x.org.id, gid],
          )
        ).rows.map((p) => p.period_id),
        assignments: guest ? [] : (
          await x.c.query(
            "SELECT * FROM goal_assignments WHERE organization_id=$1 AND goal_id=$2",
            [x.org.id, gid],
          )
        ).rows.map(camel),
        capabilities: {
          update: (await allowed(x, g, true)) && g.lifecycle !== "ARCHIVED",
          configure:
            (await goalManageAccess(x, g)) && g.lifecycle !== "ARCHIVED",
          assign: (await goalManageAccess(x, g)) && g.lifecycle !== "ARCHIVED",
          transition: await goalManageAccess(x, g),
          link: !guest && !!options.resolveLink,
          history: !guest,
        },
      };
    }
    async function changed(
      x: Ctx,
      r: FastifyRequest,
      gid: string,
      action: string,
      comment = "",
      progressUpdate?: {keyResultId:string;previousValue:string;value:string;confidenceLevel:string|null},
    ) {
      const previous = (await x.c.query("SELECT snapshot FROM goal_history WHERE organization_id=$1 AND goal_id=$2 AND snapshot->'goal'->>'version'=(SELECT version::text FROM goals WHERE organization_id=$1 AND id=$2) ORDER BY at DESC,id DESC LIMIT 1",[x.org.id,gid])).rows[0]?.snapshot ?? null;
      await x.c.query(
        "UPDATE goals SET version=version+1 WHERE organization_id=$1 AND id=$2",
        [x.org.id, gid],
      );
      const g = await load(x, gid);
      const snapshot = {
        formulaVersion: "orgmap-progress-v1",
        ...(progressUpdate ? {progressUpdate} : {}),
        goal: camel(g),
        keyResults: (
          await x.c.query(
            "SELECT * FROM goal_key_results WHERE organization_id=$1 AND goal_id=$2",
            [x.org.id, gid],
          )
        ).rows.map(camel),
        assignments: (
          await x.c.query(
            "SELECT * FROM goal_assignments WHERE organization_id=$1 AND goal_id=$2",
            [x.org.id, gid],
          )
        ).rows.map(camel),
      };
      const eventId=uuid();
      await x.c.query(
        "INSERT INTO goal_history(organization_id,id,goal_id,actor_id,action,snapshot,comment) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [x.org.id, eventId, gid, x.account.id, action, snapshot, comment],
      );
      await core.changed(x, r, gid, action);
      await publishGoalNotifications(core,x,action,eventId,previous,snapshot);
      return (await allowed(x, g))
        ? detail(x, gid)
        : { id: gid, version: g.version, accessRevoked: true };
    }

    const access = (r: FastifyRequest) => ({
      mode: "write" as const,
      authorize: async (x: Ctx) =>
        allowed(x, await requireGoal(x, (r.params as any).goalId), true),
    });
    const manageMode = (r: FastifyRequest) => ({
      mode: "write" as const,
      authorize: async (x: Ctx) =>
        goalManageAccess(x, await requireGoal(x, (r.params as any).goalId)),
    });
    function editable(g: any) {
      if (g.lifecycle === "ARCHIVED") fail(409, "STATE_CONFLICT");
    }
    async function validateGoal(x: Ctx, b: any, gid?: string) {
      const ownerType = choice(b.ownerType, ["MEMBER", "ROLE", "CIRCLE"]);
      const oid = id(b.ownerId);
      if (ownerType === "MEMBER") await member(x, oid);
      else await core.get(x.c, x.org.id, oid, ownerType);
      const vr =
        ownerType === "MEMBER" ? await viaRole(x, oid, b.ownerViaRoleId) : null;
      if (ownerType !== "MEMBER" && b.ownerViaRoleId)
        fail(422, "DOMAIN_INVARIANT");
      if (
        !Array.isArray(b.periodIds) ||
        !b.periodIds.length ||
        b.periodIds.length > 100 ||
        new Set(b.periodIds).size !== b.periodIds.length
      )
        fail(400, "INVALID_REQUEST");
      for (const p of b.periodIds)
        if (
          !(
            await x.c.query(
              "SELECT 1 FROM goal_periods WHERE organization_id=$1 AND id=$2 AND NOT archived",
              [x.org.id, id(p)],
            )
          ).rowCount
        )
          fail(404, "RESOURCE_NOT_FOUND");
      const parent =
        b.parentId === null || b.parentId === undefined ? null : id(b.parentId);
      if (parent) {
        let cursor = parent;
        const seen = new Set([gid]);
        while (cursor) {
          if (seen.has(cursor)) fail(422, "DOMAIN_INVARIANT");
          seen.add(cursor);
          const p = await requireGoal(x, cursor);
          editable(p);
          cursor = p.parent_id;
        }
      }
      return [
        text(b.title),
        optionalText(b.description),
        ownerType,
        oid,
        vr,
        parent,
        choice(b.privacy ?? "PUBLIC", ["PUBLIC", "PRIVATE"]),
        choice(b.category ?? "TEAM", ["TEAM", "COMPANY", "INDIVIDUAL"]),
        choice(b.health ?? "ON_TRACK", HEALTH),
        ownerType === "CIRCLE"
          ? oid
          : ownerType === "ROLE"
            ? (await core.get(x.c, x.org.id, oid, "ROLE")).parent_id
            : vr
              ? (await core.get(x.c, x.org.id, vr as string, "ROLE")).parent_id
              : null,
      ];
    }
    async function periods(x: Ctx, gid: string, ids: string[]) {
      await x.c.query(
        "DELETE FROM goal_period_links WHERE organization_id=$1 AND goal_id=$2",
        [x.org.id, gid],
      );
      for (const pid of ids)
        await x.c.query("INSERT INTO goal_period_links VALUES($1,$2,$3)", [
          x.org.id,
          gid,
          pid,
        ]);
    }
    app.get(base + "/goal-periods", (r) =>
      core.tenant(r, false, async (x) => ({
        items: (
          await x.c.query(
            "SELECT id,title,starts_on::text,ends_on::text,version,archived FROM goal_periods p WHERE organization_id=$1 AND ($2::uuid[] IS NULL OR EXISTS(SELECT 1 FROM goal_period_links l WHERE l.organization_id=p.organization_id AND l.period_id=p.id AND l.goal_id=ANY($2::uuid[]))) ORDER BY starts_on,id",
            [x.org.id,x.member.member_type === "GUEST" ? await core.guestResourceIds(x,{context:"goals",kind:"goal",action:"read"}) : null],
          )
        ).rows.map(camel),
      })),
    );
    app.post(base + "/goal-periods", async (r, reply) => {
      const b = body(r, ["title", "startsOn", "endsOn", "frequency", "calendarUnit"]);
      const calendar = b.frequency !== undefined || b.calendarUnit !== undefined;
      if (calendar && (b.endsOn !== undefined || b.calendarUnit !== "MONTH")) fail(400,"INVALID_REQUEST");
      const start = date(b.startsOn),
        end = calendar ? calendarPeriodEnd(start,b.frequency) : date(b.endsOn);
      if (end < start) fail(422, "DOMAIN_INVARIANT");
      const out = await core.tenant(r, true, async (x) => {
        const p = (
          await x.c.query(
            "INSERT INTO goal_periods(organization_id,id,title,starts_on,ends_on) VALUES($1,$2,$3,$4,$5) RETURNING id,title,starts_on::text,ends_on::text,version,archived",
            [x.org.id, uuid(), text(b.title), start, end],
          )
        ).rows[0];
        await core.changed(x, r, p.id, "goal.period.created");
        return camel(p);
      });
      return reply.code(201).send(out);
    });
    app.patch(base + "/goal-periods/:periodId", (r) => {
      const b = body(r, ["title", "startsOn", "endsOn", "archived"]);
      return core.tenant(r, true, async (x) => {
        const pid = id((r.params as any).periodId);
        const p = (
          await x.c.query(
            "SELECT *,starts_on::text AS start,ends_on::text AS finish FROM goal_periods WHERE organization_id=$1 AND id=$2",
            [x.org.id, pid],
          )
        ).rows[0];
        if (!p) fail(404, "RESOURCE_NOT_FOUND");
        version(r, p.version);
        const start = date(b.startsOn ?? p.start),
          end = date(b.endsOn ?? p.finish);
        if (end < start) fail(422, "DOMAIN_INVARIANT");
        const out = (
          await x.c.query(
            "UPDATE goal_periods SET title=$3,starts_on=$4,ends_on=$5,archived=$6,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING id,title,starts_on::text,ends_on::text,version,archived",
            [
              x.org.id,
              pid,
              b.title === undefined ? p.title : text(b.title),
              start,
              end,
              b.archived === undefined ? p.archived : bool(b.archived),
            ],
          )
        ).rows[0];
        await core.changed(x, r, pid, "goal.period.updated");
        return camel(out);
      });
    });
    app.get(base + "/goals/members/:memberId/goals", (r) =>
      core.tenant(r, false, (x) => memberGoals(x, (r.params as any).memberId, r.query as Record<string, unknown>, options.requireMemberProfileRead)));
    app.get(base + "/goals", (r) =>
      core.tenant(r, false, async (x) => {
        const q = r.query as any;
        if (
          Object.keys(q).some(
            (k) =>
              ![
                "search",
                "periodId",
                "health",
                "lifecycle",
                "ownerId",
                "category",
                "view",
                "limit",
                "cursor",
              ].includes(k),
          )
        )
          fail(400, "INVALID_REQUEST");
        if (q.periodId !== undefined) id(q.periodId);
        if (q.ownerId !== undefined) {
          if(x.member.member_type === "GUEST")fail(403,"ACTION_DENIED");
          id(q.ownerId);
        }
        if (q.search !== undefined) text(q.search);
        if (q.health !== undefined) choice(q.health, HEALTH);
        if (q.lifecycle !== undefined) choice(q.lifecycle, ["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"]);
        if (q.category !== undefined) choice(q.category, ["TEAM", "COMPANY", "INDIVIDUAL"]);
        if (q.view !== undefined) choice(q.view, ["list", "hierarchy", "timeline"]);
        const rows = (
          await x.c.query(
            "SELECT * FROM goals WHERE organization_id=$1 AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) ORDER BY created_at,id",
            [x.org.id,x.member.member_type === "GUEST" ? await core.guestResourceIds(x,{context:"goals",kind:"goal",action:"read"}) : null],
          )
        ).rows;
        const items = [];
        for (const g of rows) {
          if (!(await allowed(x, g))) continue;
          if (
            (q.search &&
              !g.title.toLowerCase().includes(text(q.search).toLowerCase())) ||
            (q.health && g.health !== q.health) ||
            (q.lifecycle && g.lifecycle !== q.lifecycle) ||
            (q.ownerId && g.owner_id !== id(q.ownerId)) ||
            (q.category && g.category !== q.category)
          )
            continue;
          const d = await detail(x, g.id);
          if (q.periodId && !d.periodIds.includes(id(q.periodId))) continue;
          items.push(d);
        }
        return {
          ...page(items, x.org.id, x.org.authorization_revision, q),
          coverage: { complete: true, source: "OrgMap" },
          asOf: new Date().toISOString(),
          projectionVersion: 1,
          sharedKeyResults: x.member.member_type === "GUEST" ? (await x.c.query(
            "SELECT id,title,description,description_rich,result_type,current_value,target_value,unit,archived,version FROM goal_key_results WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY title,id",
            [x.org.id,await core.guestResourceIds(x,{context:"goals",kind:"key-result",action:"read"})]
          )).rows.map(camel) : [],
          capabilities: { create: owner(x), periodManage: owner(x), statistics: x.member.member_type !== "GUEST" },
        };
      }),
    );
    const keys = [
      "title",
      "description",
      "descriptionRich",
      "ownerType",
      "ownerId",
      "ownerViaRoleId",
      "periodIds",
      "parentId",
      "privacy",
      "category",
      "health",
    ];
    app.post(base + "/goals", async (r, reply) => {
      const b = descriptionBody(body(r, keys));
      const out = await core.tenant(r, true, async (x) => {
        const values = await validateGoal(x, b);
        const gid = uuid();
        await x.c.query(
          "INSERT INTO goals(organization_id,id,title,description,owner_type,owner_id,owner_via_role_id,parent_id,privacy,category,health,circle_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [x.org.id, gid, ...values],
        );
        await x.c.query(
          "INSERT INTO goal_assignments VALUES($1,$2,$3,NULL,$4,'LEAD',NULL)",
          [x.org.id, uuid(), gid, x.member.id],
        );
        if(b.descriptionRich!==undefined)await x.c.query("UPDATE goals SET description_rich=$3 WHERE organization_id=$1 AND id=$2",[x.org.id,gid,b.descriptionRich]);
        await periods(x, gid, b.periodIds);
        return changed(x, r, gid, "goal.created");
      });
      return reply.code(201).send(out);
    });
    app.get(base + "/goals/key-results/:keyResultId", r => core.tenant(r,false,async x => {
      const kid=id((r.params as any).keyResultId);
      const k=(await x.c.query("SELECT * FROM goal_key_results WHERE organization_id=$1 AND id=$2",[x.org.id,kid])).rows[0];
      if(!k)fail(404,"RESOURCE_NOT_FOUND");
      const guest=x.member.member_type === "GUEST";
      if(guest) { if(!(await guestGoalRead(core,x,"key-result",kid)))fail(404,"RESOURCE_NOT_FOUND"); }
      else await requireGoal(x,k.goal_id);
      return {...camel(k),...(guest?{goalId:await guestGoalRead(core,x,"goal",k.goal_id)?k.goal_id:null}:{}),progress:progress(k.initial_value,k.current_value,k.target_value)};
    }));
    app.get(base+'/goals/:goalId/origin',r=>core.tenant(r,{mode:'read'},async ctx=>{
      if(ctx.member.member_type==='GUEST')fail(404,'RESOURCE_NOT_FOUND');
      const goal=await requireGoal(ctx,id((r.params as any).goalId));
      return {origin:options.trace ? await options.trace.goalOrigin(ctx,goal.id) : null};
    }));
    app.get(base + "/goals/:goalId", (r) =>
      core.tenant(r, false, (x) => detail(x, id((r.params as any).goalId))),
    );
    app.patch(base + "/goals/:goalId", (r) => {
      const b = descriptionBody(body(r, keys));
      return core.tenant(r, access(r), async (x) => {
        const gid = id((r.params as any).goalId),
          g = await requireGoal(x, gid, true);
        editable(g);
        version(r, g.version);
        if (
          !(await goalManageAccess(x, g)) &&
          [
            "ownerType",
            "ownerId",
            "ownerViaRoleId",
            "privacy",
            "parentId",
          ].some((k) => k in b)
        )
          fail(403, "ACTION_DENIED");
        const old = await detail(x, gid);
        const values = await validateGoal(x, { ...old, ...b }, gid);
        await x.c.query(
          "UPDATE goals SET title=$3,description=$4,owner_type=$5,owner_id=$6,owner_via_role_id=$7,parent_id=$8,privacy=$9,category=$10,health=$11,circle_id=$12 WHERE organization_id=$1 AND id=$2",
          [x.org.id, gid, ...values],
        );
        if (b.periodIds) await periods(x, gid, b.periodIds);
        if(b.descriptionRich!==undefined||b.description!==undefined)await x.c.query("UPDATE goals SET description_rich=$3 WHERE organization_id=$1 AND id=$2",[x.org.id,gid,b.descriptionRich??null]);
        return changed(x, r, gid, "goal.updated");
      });
    });
    app.post(base + "/goals/:goalId/lifecycle", (r) => {
      const b = body(r, ["lifecycle"]);
      return core.tenant(r, manageMode(r), async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId);
        version(r, g.version);
        const state = choice(b.lifecycle, [
          "DRAFT",
          "ACTIVE",
          "CLOSED",
          "ARCHIVED",
        ]);
        await x.c.query(
          "UPDATE goals SET lifecycle=$3 WHERE organization_id=$1 AND id=$2",
          [x.org.id, g.id, state],
        );
        return changed(x, r, g.id, "goal.lifecycle.changed");
      });
    });
    app.post(base + "/goals/:goalId/progress", (r) => {
      const b = body(r, ["value", "health", "comment"]);
      return core.tenant(r, access(r), async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId, true);
        editable(g);
        version(r, g.version);
        if (g.source !== "MANUAL") fail(409, "STATE_CONFLICT");
        if (decimal(b.value) > 100) fail(422, "DOMAIN_INVARIANT");
        await x.c.query(
          "UPDATE goals SET manual_progress=$3,health=$4 WHERE organization_id=$1 AND id=$2",
          [x.org.id, g.id, b.value, choice(b.health ?? g.health, HEALTH)],
        );
        return changed(
          x,
          r,
          g.id,
          "goal.progress.updated",
          optionalText(b.comment, 1000),
        );
      });
    });
    app.post(base + "/goals/:goalId/progress-config", (r) => {
      const b = body(r, [
        "source",
        "manualProgress",
        "krWeight",
        "childWeight",
        "keyResults",
        "children",
      ]);
      return core.tenant(r, manageMode(r), async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId, true);
        editable(g);
        version(r, g.version);
        const source = choice(b.source, [
          "MANUAL",
          "KEY_RESULTS",
          "CHILD_GOALS",
          "BOTH",
        ]);
        const manual = decimal(b.manualProgress),
          kw = decimal(b.krWeight),
          cw = decimal(b.childWeight);
        if (
          manual > 100 ||
          (source === "BOTH" && Math.abs(kw + cw - 100) > 1e-9)
        )
          fail(422, "DOMAIN_INVARIANT");
        for (const [field, table, parent] of [
          ["keyResults", "goal_key_results", "goal_id"],
          ["children", "goals", "parent_id"],
        ]) {
          const rows = (
            await x.c.query(
              `SELECT id FROM ${table} WHERE organization_id=$1 AND ${parent}=$2`,
              [x.org.id, g.id],
            )
          ).rows;
          const list = b[field];
          if (
            !Array.isArray(list) ||
            list.length !== rows.length ||
            new Set(list.map((i: any) => record(i).id)).size !== list.length
          )
            fail(422, "DOMAIN_INVARIANT");
          for (const item of list) {
            if (
              Object.keys(record(item)).some(
                (k) => !["id", "weight", "excluded"].includes(k),
              ) ||
              !rows.some((v) => v.id === id(item.id))
            )
              fail(422, "DOMAIN_INVARIANT");
            decimal(item.weight);
            bool(item.excluded);
            if (table === "goals") await requireGoal(x, item.id);
            await x.c.query(
              `UPDATE ${table} SET weight=$3,excluded=$4,version=version+1 WHERE organization_id=$1 AND id=$2`,
              [x.org.id, item.id, item.weight, item.excluded],
            );
          }
        }
        await x.c.query(
          "UPDATE goals SET source=$3,manual_progress=$4,kr_weight=$5,child_weight=$6 WHERE organization_id=$1 AND id=$2",
          [x.org.id, g.id, source, b.manualProgress, b.krWeight, b.childWeight],
        );
        return changed(x, r, g.id, "goal.progress.configured");
      });
    });
    app.post(base + "/goals/:goalId/key-results", async (r, reply) => {
      const b = descriptionBody(body(r, [
        "title",
        "description",
        "descriptionRich",
        "resultType",
        "initialValue",
        "targetValue",
        "unit",
        "excluded",
        "health",
      ]));
      const out = await core.tenant(r, access(r), async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId, true);
        editable(g);
        version(r, g.version);
        const type = choice(b.resultType, [
          "QUANTITATIVE",
          "PERCENTAGE",
          "MILESTONE",
          "BINARY",
          "CUSTOM",
        ]);
        const initial = ["MILESTONE","BINARY"].includes(type) ? "0" : (b.initialValue ?? "0"),
          target = type === "BINARY" ? "1" : type === "MILESTONE" ? "100" : (b.targetValue ?? "100");
        progress(initial, initial, target);
        const inserted = await x.c.query(
          "INSERT INTO goal_key_results(organization_id,id,goal_id,title,description,result_type,initial_value,current_value,target_value,unit,excluded,health) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11) RETURNING id",
          [
            x.org.id,
            uuid(),
            g.id,
            text(b.title),
            optionalText(b.description),
            type,
            initial,
            target,
            optionalText(b.unit, 50),
            b.excluded === undefined ? false : bool(b.excluded),
            choice(b.health ?? "ON_TRACK", HEALTH),
          ],
        );
        if(b.descriptionRich!==undefined)await x.c.query("UPDATE goal_key_results SET description_rich=$3 WHERE organization_id=$1 AND id=$2",[x.org.id,inserted.rows[0].id,b.descriptionRich]);
        return changed(x, r, g.id, "goal.key-result.created");
      });
      return reply.code(201).send(out);
    });
    app.post(base + "/goals/:goalId/key-results/:keyResultId/progress", (r) => {
      const b = body(r, ["value", "health", "comment", "confidenceLevel"]);
      return core.tenant(r, access(r), async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId, true);
        editable(g);
        const kr = (
          await x.c.query(
            "SELECT * FROM goal_key_results WHERE organization_id=$1 AND goal_id=$2 AND id=$3",
            [x.org.id, g.id, id((r.params as any).keyResultId)],
          )
        ).rows[0];
        if (!kr) fail(404, "RESOURCE_NOT_FOUND");
        if (kr.archived) fail(409, "STATE_CONFLICT");
        version(r, kr.version);
        let value = b.value;
        if (kr.result_type === "MILESTONE") value = bool(value) ? "100" : "0";
        if (kr.result_type === "BINARY") value = bool(value) ? "1" : "0";
        progress(kr.initial_value, value, kr.target_value);
        optionalText(b.comment, 1000);
        await x.c.query(
          "UPDATE goal_key_results SET current_value=$3,health=$4,confidence_level=$5,version=version+1 WHERE organization_id=$1 AND id=$2",
          [x.org.id, kr.id, value, choice(b.health ?? kr.health, HEALTH), b.confidenceLevel === undefined ? kr.confidence_level : b.confidenceLevel === null ? null : choice(b.confidenceLevel, CONFIDENCE)],
        );
        return changed(
          x,
          r,
          g.id,
          "goal.key-result.progressed",
          optionalText(b.comment, 1000),
          {keyResultId:kr.id,previousValue:kr.current_value,value,confidenceLevel:b.confidenceLevel === undefined ? kr.confidence_level : b.confidenceLevel ?? null},
        );
      });
    });
    app.post(base + "/goals/:goalId/assignments", (r) => {
      const b = body(r, ["assignments"]);
      return core.tenant(r, manageMode(r), async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId);
        editable(g);
        version(r, g.version);
        if (!Array.isArray(b.assignments) || b.assignments.length > 500)
          fail(400, "INVALID_REQUEST");
        await x.c.query(
          "DELETE FROM goal_assignments WHERE organization_id=$1 AND goal_id=$2",
          [x.org.id, g.id],
        );
        for (const a of b.assignments) {
          if (
            Object.keys(record(a)).some(
              (k) =>
                ![
                  "memberId",
                  "functionalRole",
                  "viaRoleId",
                  "keyResultId",
                ].includes(k),
            )
          )
            fail(400, "INVALID_REQUEST");
          await member(x, id(a.memberId));
          const role = choice(a.functionalRole, [
            "LEAD",
            "CONTRIBUTOR",
            "FOLLOWER",
          ]);
          const vr = await viaRole(x, a.memberId, a.viaRoleId);
          const kid = a.keyResultId ? id(a.keyResultId) : null;
          if (
            kid &&
            !(
              await x.c.query(
                "SELECT 1 FROM goal_key_results WHERE organization_id=$1 AND goal_id=$2 AND id=$3",
                [x.org.id, g.id, kid],
              )
            ).rowCount
          )
            fail(404, "RESOURCE_NOT_FOUND");
          await x.c.query(
            "INSERT INTO goal_assignments VALUES($1,$2,$3,$4,$5,$6,$7)",
            [x.org.id, uuid(), g.id, kid, a.memberId, role, vr],
          );
        }
        return changed(x, r, g.id, "goal.assignments.updated");
      });
    });
    app.patch(base + "/goals/:goalId/key-results/:keyResultId", (r) => {
      const b = descriptionBody(body(r, [
        "title",
        "description",
        "descriptionRich",
        "targetValue",
        "unit",
        "health",
        "excluded",
        "archived",
      ]));
      return core.tenant(r, access(r), async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId, true);
        editable(g);
        const k = (
          await x.c.query(
            "SELECT * FROM goal_key_results WHERE organization_id=$1 AND goal_id=$2 AND id=$3",
            [x.org.id, g.id, id((r.params as any).keyResultId)],
          )
        ).rows[0];
        if (!k) fail(404, "RESOURCE_NOT_FOUND");
        version(r, k.version);
        if (k.archived && b.archived !== false) fail(409, "STATE_CONFLICT");
        const target = b.targetValue ?? k.target_value;
        if (k.result_type === "MILESTONE" && target !== "100")
          fail(422, "DOMAIN_INVARIANT");
        if (k.result_type === "BINARY" && target !== "1") fail(422,"DOMAIN_INVARIANT");
        progress(k.initial_value, k.current_value, target);
        await x.c.query(
          "UPDATE goal_key_results SET title=$3,description=$4,target_value=$5,unit=$6,health=$7,excluded=$8,archived=$9,version=version+1 WHERE organization_id=$1 AND id=$2",
          [
            x.org.id,
            k.id,
            b.title === undefined ? k.title : text(b.title),
            b.description === undefined
              ? k.description
              : optionalText(b.description),
            target,
            b.unit === undefined ? k.unit : optionalText(b.unit, 50),
            choice(b.health ?? k.health, HEALTH),
            b.excluded === undefined ? k.excluded : bool(b.excluded),
            b.archived === undefined ? k.archived : bool(b.archived),
          ],
        );
        if(b.descriptionRich!==undefined||b.description!==undefined)await x.c.query("UPDATE goal_key_results SET description_rich=$3 WHERE organization_id=$1 AND id=$2",[x.org.id,k.id,b.descriptionRich??null]);
        return changed(x, r, g.id, "goal.key-result.updated");
      });
    });
    app.post(base + "/goals/:goalId/key-results/:keyResultId/links", (r) => {
      const b = body(r, ["links"]);
      return core.tenant(r, access(r), async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId, true);
        editable(g);
        const kid = id((r.params as any).keyResultId),
          k = (
            await x.c.query(
              "SELECT * FROM goal_key_results WHERE organization_id=$1 AND goal_id=$2 AND id=$3",
              [x.org.id, g.id, kid],
            )
          ).rows[0];
        if (!k) fail(404, "RESOURCE_NOT_FOUND");
        if (k.archived) fail(409, "STATE_CONFLICT");
        version(r, k.version);
        if (!options.resolveLink) fail(503, "WORK_LINK_RESOLVER_REQUIRED");
        if (!Array.isArray(b.links) || b.links.length > 100)
          fail(400, "INVALID_REQUEST");
        await x.c.query(
          "DELETE FROM goal_resource_links WHERE organization_id=$1 AND key_result_id=$2",
          [x.org.id, kid],
        );
        for (const link of b.links) {
          if (
            Object.keys(record(link)).some((k) => !["kind", "id"].includes(k))
          )
            fail(400, "INVALID_REQUEST");
          const kind = choice(link.kind, ["TASK", "PROJECT"]);
          const rid = id(link.id);
          if (!(await options.resolveLink!(x, kind, rid)))
            fail(404, "RESOURCE_NOT_FOUND");
          await x.c.query(
            "INSERT INTO goal_resource_links VALUES($1,$2,$3,$4,$5)",
            [x.org.id, g.id, kid, kind, rid],
          );
        }
        await x.c.query(
          "UPDATE goal_key_results SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [x.org.id, kid],
        );
        return changed(x, r, g.id, "goal.links.updated");
      });
    });
    app.get(base + "/goals/statistics", (r) =>
      core.tenant(r, false, async (x) => {
        const q = r.query as any;
        if (Object.keys(q).some((k) => !["periodId","window"].includes(k)))
          fail(400, "INVALID_REQUEST");
        if (q.periodId !== undefined) id(q.periodId);
        const asOf = new Date().toISOString();
        const windowKind = choice(q.window ?? "ALL",["ALL","CURRENT_MONTH"]);
        const windowBounds = windowKind === "CURRENT_MONTH" ? currentMonthWindow(x.org.time_zone,asOf) : null;
        const overlapping = windowBounds ? new Set((await x.c.query("SELECT id FROM goal_periods WHERE organization_id=$1 AND starts_on <= $3::date AND ends_on >= $2::date",[x.org.id,windowBounds.startsOn,windowBounds.endsOn])).rows.map(p=>p.id)) : null;
        const all = (
          await x.c.query("SELECT * FROM goals WHERE organization_id=$1", [
            x.org.id,
          ])
        ).rows;
        const items: any[] = [];
        for (const g of all)
          if (await allowed(x, g)) {
            const d = await detail(x, g.id);
            if ((!q.periodId || d.periodIds.includes(id(q.periodId))) && (!overlapping || d.periodIds.some((p:string)=>overlapping.has(p))))
              items.push(d);
          }
        const known = items.filter((g) => g.progress.display !== null);
        const current = items.filter((g) => g.lifecycle !== "ARCHIVED");
        const closed = current.filter((g) => g.lifecycle === "CLOSED").length;
        const ownerKey = (g: any) => `${g.ownerType}:${g.ownerId}:${g.ownerViaRoleId ?? ""}`;
        const owners = new Set(current.map(ownerKey));
        const activeOwners = new Set(current.filter((g) => g.lifecycle === "ACTIVE").map(ownerKey));
        return {
          periodId: q.periodId ?? null,
          window: {kind:windowKind,...windowBounds,basis:"GOAL_PERIOD_OVERLAP"},
          zone: x.org.time_zone,
          denominator: items.length,
          keyResultCount: items.reduce((sum, g) => sum + g.keyResults.filter((k: any) => !k.archived).length, 0),
          completion: { numerator: closed, denominator: current.length, percent: current.length ? closed / current.length * 100 : null },
          activeOwners: { numerator: activeOwners.size, denominator: owners.size, percent: owners.size ? activeOwners.size / owners.size * 100 : null },
          metricDefinitionVersion: "orgmap-goal-statistics-v1",
          knownProgressDenominator: known.length,
          averageProgress: known.length
            ? known.reduce((s, g) => s + g.progress.display, 0) / known.length
            : null,
          lifecycle: Object.fromEntries(
            ["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"].map((s) => [
              s,
              items.filter((g) => g.lifecycle === s).length,
            ]),
          ),
          health: Object.fromEntries(
            HEALTH.map((s) => [s, items.filter((g) => g.health === s).length]),
          ),
          asOf,
          projectionVersion: 2,
          formulaVersion: "orgmap-progress-v1",
          coverage: { scope: "AUTHORIZED_ONLY", complete: true },
          estimated: false,
        };
      }),
    );
    app.get(base + "/goals/:goalId/history", (r) =>
      core.tenant(r, false, async (x) => {
        const g = await requireGoal(x, (r.params as any).goalId);
        return {
          items: (
            await x.c.query(
              "SELECT id,actor_id,action,at,comment,snapshot->'progressUpdate' AS progress_update FROM goal_history WHERE organization_id=$1 AND goal_id=$2 ORDER BY at DESC,id",
              [x.org.id, g.id],
            )
          ).rows.map(camel),
          coverage: { complete: true },
        };
      }),
    );
  };
}
export const registerContext = createGoalsModule();
export default registerContext;

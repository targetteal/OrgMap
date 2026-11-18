import { workActor } from "./statistics.js";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { id, text, uuid, event, Failure, fail } from "../../src/core.js";
import {
  authorizedProject,
  authorizedTask,
  listAccessibleTasks,
  mayCreateWork,
} from "./index.js";
import { workSettings } from "./policy.js";
import { createProjectDefinition } from "./templates.js";

export type LinkedWorkItem = {
  id: string;
  kind: "PROJECT" | "TASK";
  title: string;
  circleId: string;
  url: string;
};
/** Caller must validate source tension existence/ACL in the same tenant UoW before invoking this target port. */
export function createWorkApplicationPorts(core: ModuleRuntime) {
  /** STRUCTURE supplies an authoritative creation event, not browser input. Same guarded ctx.c/UoW. */
  async function onCircleCreated(
    ctx: Ctx,
    input: {
      circleId: string;
      occurredAt: string;
      eventId?: string;
      requestId?: string;
    },
  ): Promise<{ created: boolean; projectId?: string; reason?: string }> {
    if (!mayCreateWork(ctx)) fail(403, "ACTION_DENIED");
    const circle = await core.get(
      ctx.c,
      ctx.org.id,
      id(input.circleId),
      "CIRCLE",
    );
    const occurred = Date.parse(input.occurredAt);
    if (!Number.isFinite(occurred) || occurred > Date.now() + 60000)
      fail(400, "INVALID_CIRCLE_EVENT");
    const existing = (
      await ctx.c.query(
        "SELECT * FROM work_circle_provisioning WHERE organization_id=$1 AND circle_id=$2",
        [ctx.org.id, circle.id],
      )
    ).rows[0];
    if (existing) {
      if (existing.project_id) {
        try {
          await authorizedProject(ctx, existing.project_id);
          return {
            created: false,
            projectId: existing.project_id,
            reason: "ALREADY_PROVISIONED",
          };
        } catch (e) {
          if (!(e instanceof Failure && [403, 404].includes(e.status))) throw e;
        }
      }
      return { created: false, reason: "ALREADY_PROVISIONED" };
    }
    const settings = await workSettings(ctx);
    if (!settings.autoCreateForNewCircles || !settings.autoCreateEnabledAt)
      return { created: false, reason: "NOT_ENABLED_AT_CREATION" };
    const eligible = (
      await ctx.c.query(
        "SELECT $2::timestamptz >= auto_create_enabled_at AS eligible FROM work_settings WHERE organization_id=$1",
        [ctx.org.id, input.occurredAt],
      )
    ).rows[0]?.eligible;
    if (eligible !== true)
      return { created: false, reason: "NOT_ENABLED_AT_CREATION" };
    const sourceEvent = input.eventId ? id(input.eventId) : null;
    if (
      !settings.allowMultipleProjectsPerCircle &&
      (
        await ctx.c.query(
          "SELECT 1 FROM work_projects WHERE organization_id=$1 AND circle_id=$2 AND NOT archived LIMIT 1",
          [ctx.org.id, circle.id],
        )
      ).rowCount
    ) {
      await ctx.c.query(
        "INSERT INTO work_circle_provisioning VALUES($1,$2,NULL,'CAPACITY',$3,$4)",
        [ctx.org.id, circle.id, input.occurredAt, sourceEvent],
      );
      await event(
        ctx.c,
        ctx.org.id,
        ctx.account.id,
        circle.id,
        "AutoProjectSkipped",
        input.requestId ?? uuid(),
      );
      return { created: false, reason: "CIRCLE_CAPACITY" };
    }
    const created = await createProjectDefinition(ctx, {
      title: circle.name,
      description: `Projeto criado automaticamente para o círculo ${circle.name}.`,
      circleId: circle.id,
    });
    const projectId = created.id;
    await ctx.c.query(
      "INSERT INTO work_circle_provisioning VALUES($1,$2,$3,'CREATED',$4,$5)",
      [ctx.org.id, circle.id, projectId, input.occurredAt, sourceEvent],
    );
    await ctx.c.query(
      "UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1",
      [ctx.org.id],
    );
    await event(
      ctx.c,
      ctx.org.id,
      ctx.account.id,
      projectId,
      "ProjectAutoCreated",
      input.requestId ?? uuid(),
    );
    return { created: true, projectId };
  }
  /** Project authorization is separate so Governance can recheck it before
   * returning an idempotent replay, using the same tenant transaction. */
  async function authorizeTensionTaskProject(ctx: Ctx, projectId: string): Promise<void> {
    if (!mayCreateWork(ctx)) fail(403, "ACTION_DENIED");
    await core.assertModuleAvailable(ctx, "work");
    await authorizedProject(ctx, id(projectId), true);
  }
  async function verifyTensionTaskProject(ctx: Ctx, taskId: string, projectId: string, tensionId: string): Promise<void> {
    await authorizeTensionTaskProject(ctx,projectId);
    const task = await authorizedTask(ctx,id(taskId),true);
    if (task.project_id !== id(projectId) || task.source_tension_id !== id(tensionId)) fail(409,"TENSION_TARGET_PROJECT_MISMATCH");
  }
  async function createTaskFromTension(
    ctx: Ctx,
    input: {
      title: string;
      circleId: string;
      tensionId: string;
      projectId?: string | null;
      requestId?: string;
    },
  ): Promise<{ id: string }> {
    if (!mayCreateWork(ctx)) fail(403, "ACTION_DENIED");
    const circle = await core.get(
      ctx.c,
      ctx.org.id,
      id(input.circleId),
      "CIRCLE",
    );
    if(input.projectId != null) await authorizeTensionTaskProject(ctx,input.projectId);
    await workActor(ctx);
    const taskId = uuid();
    await ctx.c.query(
      "INSERT INTO work_tasks(organization_id,id,creator_id,title,circle_id,source_tension_id,project_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        ctx.org.id,
        taskId,
        ctx.member.id,
        text(input.title),
        circle.id,
        id(input.tensionId),
        input.projectId == null ? null : id(input.projectId),
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
      taskId,
      "TaskCreatedFromTension",
      input.requestId ?? uuid(),
    );
    return { id: taskId };
  }
  async function listMeetingItems(
    ctx: Ctx,
    input: { circleIds: string[] },
  ): Promise<LinkedWorkItem[]> {
    if (ctx.member.member_type === "GUEST") return [];
    const circleIds = [...new Set(input.circleIds.map(id))];
    for (const circleId of circleIds)
      await core.get(ctx.c, ctx.org.id, circleId, "CIRCLE");
    const found: LinkedWorkItem[] = [];
    const ps = (
      await ctx.c.query(
        "SELECT id,title,circle_id FROM work_projects WHERE organization_id=$1 AND circle_id=ANY($2::uuid[]) AND NOT archived ORDER BY title,id",
        [ctx.org.id, circleIds],
      )
    ).rows;
    for (const p of ps) {
      try {
        await authorizedProject(ctx, p.id);
        found.push({
          id: p.id,
          kind: "PROJECT",
          title: p.title,
          circleId: p.circle_id,
          url: "/projects/" + p.id,
        });
      } catch (e) {
        if (!(e instanceof Failure && [403, 404].includes(e.status))) throw e;
      }
    }
    for (const t of await listAccessibleTasks(ctx)) {
      const circleId = t.effective_circle_id;
      if (circleIds.includes(circleId))
        found.push({
          id: t.id,
          kind: "TASK",
          title: t.title,
          circleId,
          url: "/projects/tasks/" + t.id,
        });
    }
    return found;
  }
  return { createTaskFromTension, authorizeTensionTaskProject, verifyTensionTaskProject, listMeetingItems, onCircleCreated };
}

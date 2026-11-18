import { taskPrincipals } from "./assignments.js";
import type { RoleCapacityPort } from "../structure/profile-capacity-contract.js";
import { taskProperties } from "./task-properties.js";
import { workExportWorkbook } from "./export-workbook.js";
import type { Ctx, OrgMapModule } from "../../src/runtime.js";
import type { ResourceAccessPort } from "../platform/ports.js";
import type { ExportJobPort } from "../platform/export-jobs.js";
import { body, fail, Failure, id, uuid, key } from "../../src/core.js";
import { workMonth, projectPeriodStatistics } from "./statistics.js";
export type WorkExportComposition = {
  roleCapacity?: RoleCapacityPort;
  exportJobs?: ExportJobPort;
  privateOperationalExport?: (ctx: Ctx) => boolean | Promise<boolean>;
  tabularExports?: boolean;
};
type Access = {
  project: (ctx: Ctx, id: string) => Promise<unknown>;
  mayCreate: (ctx: Ctx) => boolean;
};
async function privateIntent(ctx: Ctx, options: WorkExportComposition) {
  if (
    ctx.member.org_role !== "OWNER" ||
    ctx.member.status !== "ACTIVE" ||
    (await options.privateOperationalExport?.(ctx)) !== true
  )
    fail(403, "PRIVATE_EXPORT_DENIED");
}
export async function authorizedExportSelection(
  ctx: Ctx,
  options: WorkExportComposition,
  input: { includePrivate?: boolean; circleId?: string | null },
) {
  if (ctx.member.member_type === "GUEST") fail(403, "ACTION_DENIED");
  if (input.includePrivate) await privateIntent(ctx, options);
  return (
    await ctx.c.query(
      `SELECT p.id FROM work_projects p LEFT JOIN work_access a ON a.organization_id=p.organization_id AND a.project_id=p.id AND a.member_id=$2 WHERE p.organization_id=$1 AND NOT p.archived AND ($3::boolean OR p.visibility='PUBLIC' OR a.role IS NOT NULL) AND ($4::uuid IS NULL OR p.circle_id=$4) ORDER BY p.title,p.id`,
      [
        ctx.org.id,
        ctx.member.id,
        input.includePrivate === true,
        input.circleId ?? null,
      ],
    )
  ).rows.map((r) => r.id as string);
}
async function selection(
  ctx: Ctx,
  rid: string,
  options: WorkExportComposition,
  access: Access,
  intent: boolean,
) {
  if (ctx.member.member_type === "GUEST") fail(403, "ACTION_DENIED");
  const row = (
    await ctx.c.query(
      "SELECT * FROM work_export_selections WHERE organization_id=$1 AND id=$2 AND owner_id=$3",
      [ctx.org.id, id(rid), ctx.member.id],
    )
  ).rows[0];
  if (!row) fail(404, "RESOURCE_NOT_FOUND");
  if (row.include_private !== intent) fail(403, "EXPORT_INTENT_REQUIRED");
  if (intent) await privateIntent(ctx, options);
  for (const pid of row.project_ids) {
    if (intent) {
      if (
        !(
          await ctx.c.query(
            "SELECT 1 FROM work_projects WHERE organization_id=$1 AND id=$2 AND NOT archived",
            [ctx.org.id, pid],
          )
        ).rowCount
      )
        fail(404, "RESOURCE_NOT_FOUND");
    } else await access.project(ctx, pid);
  }
  return row;
}
export function createOrganizationExportAdapter(
  options: WorkExportComposition,
  access: Access,
): ResourceAccessPort {
  return {
    supportsPrivateExport:
      typeof options.privateOperationalExport === "function",
    exportKinds: ["TASKS", "STATISTICS"],
    authorize: async (ctx, rid, action) => {
      if (!["export", "export-private"].includes(action)) return false;
      try {
        await selection(ctx, rid, options, access, action === "export-private");
        return true;
      } catch (e) {
        if (e instanceof Failure && [403, 404].includes(e.status)) return false;
        throw e;
      }
    },
    export: async (ctx, ids, kind, request) => {
      if (ids.length !== 1) fail(400, "INVALID_EXPORT_SELECTION");
      const s = await selection(
        ctx,
        ids[0],
        options,
        access,
        request?.includePrivate === true,
      );
      if (kind !== s.kind) fail(400, "INVALID_EXPORT_KIND");
      if (kind === "STATISTICS") {
        const records = [];
        for (const month of s.months)
          records.push(
            await projectPeriodStatistics(
              ctx,
              s.project_ids,
              month,
              options.roleCapacity,
            ),
          );
        return {
          records,
          workbook: workExportWorkbook(kind, records, request?.format),
          coverage:
            "Série de25meses UTC; UNAVAILABLE/null não é zero. Sem estimativas ou histórico fabricado. Escopo de projetos/participantes atual; tarefas pessoais excluídas. Definições e denominadores em cada registro.",
          estimated: false,
        };
      }
      const records = [];
      for (const pid of s.project_ids) {
        const p = (
            await ctx.c.query(
              "SELECT * FROM work_projects WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, pid],
            )
          ).rows[0],
          sections = (
            await ctx.c.query(
              "SELECT * FROM work_sections WHERE organization_id=$1 AND project_id=$2 ORDER BY position,id",
              [ctx.org.id, pid],
            )
          ).rows,
          ts = (
            await ctx.c.query(
              "SELECT * FROM work_tasks WHERE organization_id=$1 AND project_id=$2 AND NOT archived ORDER BY position,title,id",
              [ctx.org.id, pid],
            )
          ).rows;
        const byId = new Map(ts.map((t) => [t.id, t])),
          seen = new Set<string>(),
          ordered: any[] = [];
        const visit = (t: any) => {
          if (seen.has(t.id)) return;
          seen.add(t.id);
          ordered.push(t);
          for (const child of ts.filter((x) => x.parent_id === t.id))
            visit(child);
        };
        for (const t of ts.filter((t) => !byId.has(t.parent_id))) visit(t);
        for (const t of ts) visit(t);
        const tasks = [];
        for (const t of ordered) {
          const checklist = (
              await ctx.c.query(
                "SELECT title,done FROM work_checklist WHERE organization_id=$1 AND task_id=$2 ORDER BY id",
                [ctx.org.id, t.id],
              )
            ).rows,
            assignments = (
              await ctx.c.query(
                "SELECT member_id FROM work_assignments WHERE organization_id=$1 AND task_id=$2 ORDER BY member_id",
                [ctx.org.id, t.id],
              )
            ).rows;
          tasks.push({
            sourceId: t.id,
            title: t.title,
            description: t.description,
            ...(t.description_rich
              ? { descriptionRich: t.description_rich }
              : {}),
            status: t.status,
            customStatusId: t.custom_status_id,
            customFields: t.custom_fields,
            externalLinks: t.external_links,
            taskChecklists:t.task_checklists,
            planningIntent:t.planning_intent,
            parentSourceId: byId.has(t.parent_id) ? t.parent_id : null,
            sectionIndex:
              sections.findIndex((x) => x.id === t.section_id) < 0
                ? null
                : sections.findIndex((x) => x.id === t.section_id),
            ...taskProperties({}, t),
            startsAt: t.starts_at ? new Date(t.starts_at).toISOString() : null,
            endsAt: t.ends_at ? new Date(t.ends_at).toISOString() : null,
            checklist,
            assigneeMemberIds: assignments.map((a) => a.member_id),
            principals: await taskPrincipals(ctx, t.id),
          });
        }
        const dependencies = (
          await ctx.c.query(
            "SELECT * FROM work_dependencies WHERE organization_id=$1 AND predecessor_id=ANY($2::uuid[]) AND successor_id=ANY($2::uuid[]) ORDER BY predecessor_id,successor_id",
            [ctx.org.id, [...byId.keys()]],
          )
        ).rows.map((d) => ({
          predecessorSourceId: d.predecessor_id,
          successorSourceId: d.successor_id,
          type: d.type,
          lagMinutes: d.lag_minutes,
        }));
        records.push({
          schemaVersion: 2,
          sourceOrganizationId: ctx.org.id,
          sourceId: p.id,
          title: p.title,
          description: p.description,
          ...(p.description_rich
            ? { descriptionRich: p.description_rich }
            : {}),
          visibility: p.visibility,
          circleId: p.circle_id,
          startsAt: p.starts_at ? new Date(p.starts_at).toISOString() : null,
          endsAt: p.ends_at ? new Date(p.ends_at).toISOString() : null,
          tags: p.tags,
          customFields: p.custom_fields,
          projectChecklists: p.project_checklists,
          externalLinks: p.external_links,
          leadMemberId: p.lead_member_id,
          planningIntent:p.planning_intent,
          priority:p.priority,sectionName:p.section_name,
          contextLinks: p.context_links,
          taskStates: p.task_states,
          projectStateId: p.project_state_id,
          definition: {
            views: p.views,
            sections: sections.map((x) => ({
              name: x.name,
              semantic: x.semantic,
            })),
            defaultDoneSection:
              sections.findIndex((x) => x.id === p.default_done_section_id) < 0
                ? null
                : sections.findIndex((x) => x.id === p.default_done_section_id),
          },
          tasks,
          dependencies,
        });
      }
      if (Buffer.byteLength(JSON.stringify(records)) > 5 * 1024 * 1024)
        fail(413, "EXPORT_TOO_LARGE");
      return {
        records,
        workbook: workExportWorkbook(kind, records, request?.format),
        coverage:
          "Todos os projetos selecionados e suas tarefas ativas, incluindo subtarefas após o pai, seções, datas, responsáveis por memberId, checklist e dependências locais. Exclui tarefas pessoais, projetos/tarefas arquivados, comentários, anexos, grants, grupos e histórico. JSON pode ser importado para criar cópias; vínculos de contexto exigem a organização de origem e não concedem acessos. Atribuições, comentários, anexos, grants, grupos e histórico não são restaurados.",
        estimated: false,
      };
    },
  };
}
export function organizationExportModule(
  options: WorkExportComposition,
  access: Access,
): OrgMapModule {
  return async (app, core) => {
    const base = "/api/v1/organizations/:organizationId/work/exports";
    app.get(base + "/capabilities", (r) =>
      core.tenant(r, { mode: "read" }, async (ctx) => ({
        queueAvailable: !!options.exportJobs,
        tabularAvailable: options.tabularExports === true,
        privateAvailable:
          ctx.member.org_role === "OWNER" &&
          (await options.privateOperationalExport?.(ctx)) === true,
      })),
    );
    app.post(base, async (r, reply) =>
      reply.code(202).send(
        await core.tenant(
          r,
          {
            mode: "write",
            authorize: async (ctx) => {
              if (!access.mayCreate(ctx)) return false;
              const prior = (
                await ctx.c.query(
                  "SELECT id,include_private FROM work_export_selections WHERE organization_id=$1 AND account_id=$2 AND command_key=$3",
                  [ctx.org.id, ctx.account.id, key(r)],
                )
              ).rows[0];
              if (prior)
                await selection(
                  ctx,
                  prior.id,
                  options,
                  access,
                  prior.include_private,
                );
              return true;
            },
          },
          async (ctx) => {
            const jobs = options.exportJobs;
            if (!jobs) return fail(503, "WORK_EXPORT_QUEUE_UNAVAILABLE");
            const b = body(r, [
              "kind",
              "format",
              "includePrivate",
              "circleId",
              "endMonth",
            ]);
            if (
              !["TASKS", "STATISTICS"].includes(b.kind) ||
              !["JSON", "CSV", "XLSX"].includes(b.format ?? "JSON") ||
              (b.includePrivate !== undefined &&
                typeof b.includePrivate !== "boolean")
            )
              fail(400, "INVALID_REQUEST");
            const format = b.format ?? "JSON";
            if (format !== "JSON" && !options.tabularExports)
              fail(503, "WORK_TABULAR_EXPORT_UNAVAILABLE");
            const circleId = b.circleId ? id(b.circleId) : null;
            if (circleId) await core.get(ctx.c, ctx.org.id, circleId, "CIRCLE");
            if (b.kind === "TASKS" && b.endMonth !== undefined)
              fail(400, "INVALID_REQUEST");
            const projects = await authorizedExportSelection(ctx, options, {
              includePrivate: b.includePrivate === true,
              circleId,
            });
            if (projects.length > 1000) fail(422, "EXPORT_TOO_MANY_PROJECTS");
            const end = workMonth(b.endMonth).month,
              months =
                b.kind === "STATISTICS"
                  ? Array.from({ length: 25 }, (_, i) => {
                      const d = new Date(end + "-01T00:00:00Z");
                      d.setUTCMonth(d.getUTCMonth() - (24 - i));
                      return d.toISOString().slice(0, 7);
                    })
                  : [],
              sid = uuid();
            await ctx.c.query(
              "INSERT INTO work_export_selections(organization_id,id,owner_id,account_id,command_key,kind,include_private,project_ids,months) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                ctx.org.id,
                sid,
                ctx.member.id,
                ctx.account.id,
                key(r),
                b.kind,
                b.includePrivate === true,
                projects,
                months,
              ],
            );
            const job = await jobs.enqueue(ctx, {
              resourceType: "work-export",
              resourceIds: [sid],
              exportKind: b.kind,
              format,
              includePrivate: b.includePrivate === true,
              requestId: r.id,
            });
            await core.changed(
              ctx,
              r,
              sid,
              b.includePrivate
                ? "WorkPrivateOrganizationExportRequested"
                : "WorkOrganizationExportRequested",
            );
            return {
              job,
              selection: {
                projects: projects.length,
                months: months.length,
                personalTasksExcluded: true,
              },
              jobsPath: "/platform/jobs",
            };
          },
        ),
      ),
    );
  };
}

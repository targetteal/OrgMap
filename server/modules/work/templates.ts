import {
  richDescriptionBody,
  nextRichDescription,
  descriptionPlain,
} from "./content.js";
import { workActor } from "./statistics.js";
import type { Ctx, OrgMapModule } from "../../src/runtime.js";
import {
  body,
  camel,
  fail,
  id,
  text,
  optionalText,
  uuid,
  version,
} from "../../src/core.js";
import { workSettings, requireCircleProjectCapacity } from "./policy.js";
import { templateContent, applyTemplateContent, type TemplateContent } from "./template-content.js";
export type ProjectDefinition = {
  views: string[];
  sections: { name: string; semantic: "NONE" | "DONE" }[];
  defaultDoneSection: number | null;
} & TemplateContent;
export const templateGallery = [
  {
    key: "DEFAULT",
    name: "Default",
    definition: {
      views: ["LIST", "BOARD", "TIMELINE", "CALENDAR"],
      sections: [],
      defaultDoneSection: null,
    },
  },
  {
    key: "WORKFLOW",
    name: "Fluxo de trabalho",
    definition: {
      views: ["BOARD", "LIST", "TIMELINE", "CALENDAR"],
      sections: [
        { name: "A fazer", semantic: "NONE" },
        { name: "Em andamento", semantic: "NONE" },
        { name: "Concluído", semantic: "DONE" },
      ],
      defaultDoneSection: 2,
    },
  },
] as const;
export function validateProjectDefinition(raw: unknown): ProjectDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail(400, "INVALID_TEMPLATE");
  const d = raw as any;
  if (
    Object.keys(d).some(
      (k) => !["views", "sections", "defaultDoneSection", "description", "descriptionRich", "tags", "checklists", "tasks", "groups", "dependencies", "links"].includes(k),
    ) ||
    !Array.isArray(d.views) ||
    !d.views.length ||
    d.views.length > 4 ||
    d.views.some(
      (v: unknown) =>
        !["LIST", "BOARD", "TIMELINE", "CALENDAR"].includes(v as string),
    ) ||
    new Set(d.views).size !== d.views.length ||
    !Array.isArray(d.sections) ||
    d.sections.length > 100
  )
    fail(400, "INVALID_TEMPLATE");
  const sections = d.sections.map((s: any) => {
    if (
      !s ||
      typeof s !== "object" ||
      Object.keys(s).some((k) => !["name", "semantic"].includes(k)) ||
      !["NONE", "DONE"].includes(s.semantic)
    )
      fail(400, "INVALID_TEMPLATE");
    return { name: text(s.name), semantic: s.semantic };
  });
  const done = d.defaultDoneSection ?? null;
  if (
    done !== null &&
    (!Number.isInteger(done) ||
      !sections[done] ||
      sections[done].semantic !== "DONE")
  )
    fail(400, "INVALID_TEMPLATE");
  return { views: [...d.views], sections, defaultDoneSection: done, ...templateContent(d, sections.length) };
}
export async function defaultTemplate(ctx: Ctx) {
  let row = (
    await ctx.c.query(
      "SELECT * FROM work_templates WHERE organization_id=$1 AND is_default",
      [ctx.org.id],
    )
  ).rows[0];
  if (!row)
    row = (
      await ctx.c.query(
        "INSERT INTO work_templates(organization_id,id,name,definition,is_default) VALUES($1,$2,$3,$4,true) RETURNING *",
        [
          ctx.org.id,
          uuid(),
          "Default",
          JSON.stringify(templateGallery[0].definition),
        ],
      )
    ).rows[0];
  return row;
}
/** Caller owns the guarded write UoW and its audit event. All project entry points share policy and template application. */
export async function createProjectDefinition(
  ctx: Ctx,
  input: {
    title: unknown;
    description?: unknown;
    descriptionRich?: unknown;
    visibility?: unknown;
    circleId?: string | null;
    templateId?: unknown;
    definition?: ProjectDefinition;
  },
) {
  await workActor(ctx);
  const settings = await workSettings(ctx),
    circleId = input.circleId ?? null;
  await requireCircleProjectCapacity(ctx, circleId);
  let definition = input.definition;
  if (!definition) {
    const template = input.templateId
      ? (
          await ctx.c.query(
            "SELECT * FROM work_templates WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, id(input.templateId)],
          )
        ).rows[0]
      : await defaultTemplate(ctx);
    if (!template) fail(404, "RESOURCE_NOT_FOUND");
    definition = validateProjectDefinition(template.definition);
  }
  const content = richDescriptionBody(input.description === undefined && input.descriptionRich === undefined ? { ...input, description: definition.description, ...(definition.descriptionRich ? { descriptionRich: definition.descriptionRich } : {}) } : input);
  const visibility = input.visibility ?? settings.defaultPrivacy;
  if (!["PUBLIC", "PRIVATE"].includes(visibility as string))
    fail(400, "INVALID_REQUEST");
  const pid = uuid();
  await ctx.c.query(
    "INSERT INTO work_projects(organization_id,id,title,description,visibility,creator_id,circle_id,assignment_mode,assignment_permission,views,description_rich) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      ctx.org.id,
      pid,
      text(input.title),
      descriptionPlain(content),
      visibility,
      ctx.member.id,
      circleId,
      settings.defaultAssignmentMode,
      settings.defaultAssignmentPermission,
      definition.views,
      nextRichDescription(content),
    ],
  );
  await ctx.c.query("INSERT INTO work_access VALUES($1,$2,$3,'MANAGER')", [
    ctx.org.id,
    pid,
    ctx.member.id,
  ]);
  const sectionIds: string[] = [];
  for (const [position, section] of definition.sections.entries()) {
    const sid = uuid();
    sectionIds.push(sid);
    await ctx.c.query("INSERT INTO work_sections VALUES($1,$2,$3,$4,$5,$6)", [
      ctx.org.id,
      sid,
      pid,
      section.name,
      section.semantic,
      position,
    ]);
    if (position === definition.defaultDoneSection)
      await ctx.c.query(
        "UPDATE work_projects SET default_done_section_id=$3 WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, pid, sid],
      );
  }
  await applyTemplateContent(ctx, pid, definition, sectionIds);
  return (
    await ctx.c.query(
      "SELECT * FROM work_projects WHERE organization_id=$1 AND id=$2",
      [ctx.org.id, pid],
    )
  ).rows[0];
}
export const workTemplatesModule: OrgMapModule = async (app, core) => {
  const base = "/api/v1/organizations/:organizationId/work/templates",
    owner = (ctx: Ctx) => ctx.member.org_role === "OWNER";
  app.get(base, (r) =>
    core.tenant(r, { mode: "read" }, async (ctx) => ({
      templates: (
        await ctx.c.query(
          "SELECT * FROM work_templates WHERE organization_id=$1 ORDER BY is_default DESC,name,id",
          [ctx.org.id],
        )
      ).rows.map(camel),
      gallery: templateGallery,
      capabilities: { manage: owner(ctx) },
    })),
  );
  app.post(base, async (r, reply) =>
    reply.code(201).send(
      await core.tenant(r, { mode: "write", authorize: owner }, async (ctx) => {
        const b = body(r, ["name", "definition", "galleryKey"]);
        const catalog = b.galleryKey
          ? templateGallery.find((t) => t.key === b.galleryKey)
          : null;
        if (b.galleryKey && !catalog) fail(400, "INVALID_TEMPLATE");
        const definition = validateProjectDefinition(
            b.definition ?? catalog?.definition,
          ),
          name = text(b.name ?? catalog?.name),
          tid = uuid();
        const first = !(
          await ctx.c.query(
            "SELECT 1 FROM work_templates WHERE organization_id=$1 AND is_default",
            [ctx.org.id],
          )
        ).rowCount;
        const row = (
          await ctx.c.query(
            "INSERT INTO work_templates(organization_id,id,name,definition,is_default) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [ctx.org.id, tid, name, JSON.stringify(definition), first],
          )
        ).rows[0];
        await core.changed(ctx, r, tid, "WorkTemplateCreated");
        return { template: camel(row) };
      }),
    ),
  );
  app.patch(base + "/:templateId", (r) =>
    core.tenant(r, { mode: "write", authorize: owner }, async (ctx) => {
      const tid = id((r.params as any).templateId),
        b = body(r, ["name", "definition", "isDefault"]),
        row = (
          await ctx.c.query(
            "SELECT * FROM work_templates WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, tid],
          )
        ).rows[0];
      if (!row) fail(404, "RESOURCE_NOT_FOUND");
      version(r, row.version);
      if (b.isDefault !== undefined && b.isDefault !== true)
        fail(400, "DEFAULT_TEMPLATE_REQUIRED");
      if (b.isDefault === true)
        await ctx.c.query(
          "UPDATE work_templates SET is_default=false,version=version+1 WHERE organization_id=$1 AND is_default AND id<>$2",
          [ctx.org.id, tid],
        );
      const next = (
        await ctx.c.query(
          "UPDATE work_templates SET name=$3,definition=$4,is_default=$5,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [
            ctx.org.id,
            tid,
            b.name === undefined ? row.name : text(b.name),
            JSON.stringify(
              b.definition === undefined
                ? row.definition
                : validateProjectDefinition(b.definition),
            ),
            b.isDefault === true || row.is_default,
          ],
        )
      ).rows[0];
      await core.changed(ctx, r, tid, "WorkTemplateChanged");
      return { template: camel(next) };
    }),
  );
  app.delete(base + "/:templateId", (r) =>
    core.tenant(r, { mode: "write", authorize: owner }, async (ctx) => {
      const tid = id((r.params as any).templateId),
        row = (
          await ctx.c.query(
            "SELECT * FROM work_templates WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, tid],
          )
        ).rows[0];
      if (!row) fail(404, "RESOURCE_NOT_FOUND");
      version(r, row.version);
      if (row.is_default) fail(422, "DEFAULT_TEMPLATE_REQUIRED");
      await ctx.c.query(
        "DELETE FROM work_templates WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, tid],
      );
      await core.changed(ctx, r, tid, "WorkTemplateDeleted");
      return { deleted: true };
    }),
  );
};

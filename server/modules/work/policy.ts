import type { Ctx, OrgMapModule } from "../../src/runtime.js";
import { body, version, fail, camel, id } from "../../src/core.js";
export type WorkSettings = {
  showAllUnassigned: boolean;
  autoCreateForNewCircles: boolean;
  autoCreateEnabledAt: string | null;
  allowMultipleProjectsPerCircle: boolean;
  defaultPrivacy: "PUBLIC" | "PRIVATE";
  lockProjectConfiguration: boolean;
  defaultAssignmentMode: "SINGLE" | "MULTIPLE";
  defaultAssignmentPermission: "EDITORS" | "MANAGERS";
  version: number;
};
/** OrgMap initial policy, not an inferred universal default from the reference tenant. */
export const initialWorkSettings: Readonly<WorkSettings> = Object.freeze({
  showAllUnassigned: true,
  autoCreateForNewCircles: false,
  autoCreateEnabledAt: null,
  allowMultipleProjectsPerCircle: true,
  defaultPrivacy: "PUBLIC",
  lockProjectConfiguration: false,
  defaultAssignmentMode: "MULTIPLE",
  defaultAssignmentPermission: "EDITORS",
  version: 0,
});
export async function workSettings(ctx: Ctx): Promise<WorkSettings> {
  const row = (
    await ctx.c.query("SELECT * FROM work_settings WHERE organization_id=$1", [
      ctx.org.id,
    ])
  ).rows[0];
  if (!row) return { ...initialWorkSettings };
  const { organizationId, ...settings } = camel(row);
  return settings as WorkSettings;
}
export async function requireProjectConfigurationMutable(ctx: Ctx) {
  if ((await workSettings(ctx)).lockProjectConfiguration)
    fail(403, "PROJECT_CONFIGURATION_LOCKED");
}
export async function requireCircleProjectCapacity(
  ctx: Ctx,
  circleId: string | null,
  exceptId?: string,
) {
  if (!circleId || (await workSettings(ctx)).allowMultipleProjectsPerCircle)
    return;
  const found = await ctx.c.query(
    "SELECT 1 FROM work_projects WHERE organization_id=$1 AND circle_id=$2 AND NOT archived AND ($3::uuid IS NULL OR id<>$3::uuid) LIMIT 1",
    [ctx.org.id, id(circleId), exceptId ?? null],
  );
  if (found.rowCount) fail(409, "CIRCLE_PROJECT_LIMIT");
}
export function canAssignProject(
  ctx: Ctx,
  p: { access_role: string; assignment_permission: string; frozen: boolean },
) {
  return (
    !p.frozen &&
    (p.access_role === "MANAGER" ||
      (p.access_role === "EDITOR" && p.assignment_permission === "EDITORS"))
  );
}
const keys = [
  "showAllUnassigned",
  "autoCreateForNewCircles",
  "allowMultipleProjectsPerCircle",
  "defaultPrivacy",
  "lockProjectConfiguration",
  "defaultAssignmentMode",
  "defaultAssignmentPermission",
];
const bool = (v: unknown) => {
  if (typeof v !== "boolean") fail(400, "INVALID_REQUEST");
  return v as boolean;
};
const pick = (v: unknown, allowed: string[]) => {
  if (typeof v !== "string" || !allowed.includes(v))
    fail(400, "INVALID_REQUEST");
  return v as string;
};
export const workPolicyModule: OrgMapModule = async (app, core) => {
  const url = "/api/v1/organizations/:organizationId/work/settings";
  app.get(url, (r) =>
    core.tenant(r, { mode: "read" }, async (ctx) => ({
      settings: await workSettings(ctx),
      capabilities: { manage: ctx.member.org_role === "OWNER" },
    })),
  );
  app.post(url, (r) =>
    core.tenant(
      r,
      { mode: "write", authorize: (ctx) => ctx.member.org_role === "OWNER" },
      async (ctx) => {
        const current = await workSettings(ctx);
        version(r, current.version);
        const b = body(r, keys),
          next = { ...current };
        for (const key of [
          "showAllUnassigned",
          "autoCreateForNewCircles",
          "allowMultipleProjectsPerCircle",
          "lockProjectConfiguration",
        ] as const)
          if (b[key] !== undefined) next[key] = bool(b[key]);
        if (b.defaultPrivacy !== undefined)
          next.defaultPrivacy = pick(b.defaultPrivacy, [
            "PUBLIC",
            "PRIVATE",
          ]) as WorkSettings["defaultPrivacy"];
        if (b.defaultAssignmentMode !== undefined)
          next.defaultAssignmentMode = pick(b.defaultAssignmentMode, [
            "SINGLE",
            "MULTIPLE",
          ]) as WorkSettings["defaultAssignmentMode"];
        if (b.defaultAssignmentPermission !== undefined)
          next.defaultAssignmentPermission = pick(
            b.defaultAssignmentPermission,
            ["EDITORS", "MANAGERS"],
          ) as WorkSettings["defaultAssignmentPermission"];
        if (
          !next.allowMultipleProjectsPerCircle &&
          current.allowMultipleProjectsPerCircle &&
          (
            await ctx.c.query(
              "SELECT 1 FROM work_projects WHERE organization_id=$1 AND circle_id IS NOT NULL AND NOT archived GROUP BY circle_id HAVING count(*)>1 LIMIT 1",
              [ctx.org.id],
            )
          ).rowCount
        )
          fail(422, "MULTIPLE_CIRCLE_PROJECTS_EXIST");
        await ctx.c.query(
          "INSERT INTO work_settings(organization_id,show_all_unassigned,auto_create_for_new_circles,allow_multiple_projects_per_circle,default_privacy,lock_project_configuration,default_assignment_mode,default_assignment_permission,version,auto_create_enabled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,CASE WHEN $3 THEN clock_timestamp() ELSE NULL END) ON CONFLICT(organization_id) DO UPDATE SET show_all_unassigned=excluded.show_all_unassigned,auto_create_for_new_circles=excluded.auto_create_for_new_circles,allow_multiple_projects_per_circle=excluded.allow_multiple_projects_per_circle,default_privacy=excluded.default_privacy,lock_project_configuration=excluded.lock_project_configuration,default_assignment_mode=excluded.default_assignment_mode,default_assignment_permission=excluded.default_assignment_permission,auto_create_enabled_at=CASE WHEN NOT excluded.auto_create_for_new_circles THEN NULL WHEN NOT work_settings.auto_create_for_new_circles OR work_settings.auto_create_enabled_at IS NULL THEN clock_timestamp() ELSE work_settings.auto_create_enabled_at END,version=work_settings.version+1",
          [
            ctx.org.id,
            next.showAllUnassigned,
            next.autoCreateForNewCircles,
            next.allowMultipleProjectsPerCircle,
            next.defaultPrivacy,
            next.lockProjectConfiguration,
            next.defaultAssignmentMode,
            next.defaultAssignmentPermission,
          ],
        );
        await core.changed(ctx, r, ctx.org.id, "WorkSettingsChanged");
        return { settings: await workSettings(ctx) };
      },
    ),
  );
};

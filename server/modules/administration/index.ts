import type { OrgMapModule, Ctx } from "../../src/runtime.js";
import { pool } from "../../src/db.js";
import { body, fail, id, uuid, version } from "../../src/core.js";
import { authorizeColorTheme } from "./color-theme.js";
import {
  kinds,
  type Kind,
  validate,
  settings,
  defaults,
  fieldValue,
} from "./domain.js";
import {
  commandSchema,
  commandResponseSchema,
  schemaValid,
} from "./schemas.js";
import type { FastifyRequest, FastifyReply } from "fastify";
import { readContent, renderHTML } from "../../../packages/content/index.js";
import {
  registerCredentialPolicyAdministration,
  type CredentialPolicyReadiness,
} from "./security.js";
export { readCredentialPolicy } from "./security.js";
import {
  registerAdmissionPolicyAdministration,
  type AdmissionPolicyConsumer,
} from "./admission.js";
export { readAdmissionPolicy, canonicalAdmissionDomain } from "./admission.js";
export type {
  OrgPolicyRead,
  AdmissionPolicy,
  AdmissionPolicyConsumer,
} from "./admission.js";
import {
  registerUploadPolicyAdministration,
  type UploadPolicyConsumer,
} from "./upload.js";
import { registerMemberIndicatorConsents } from "./member-indicators.js";
export { createMemberIndicatorAuthority } from "./member-indicators.js";
export { readUploadPolicy, UPLOAD_ALLOWLIST_KINDS } from "./upload.js";
export type {
  UploadPolicy,
  UploadPolicyConsumer,
  AllowlistedFileKind,
} from "./upload.js";
export async function canManage(ctx: Ctx, action: string, resourceId?: string) {
  if (ctx.member.org_role === "OWNER") return true;
  return !!(
    await ctx.c.query(
      "SELECT 1 FROM administration_grants WHERE organization_id=$1 AND member_id=$2 AND action=$3 AND active AND (resource_id IS NULL OR resource_id=$4)",
      [ctx.org.id, ctx.member.id, action, resourceId ?? null],
    )
  ).rowCount;
}
export async function organizationSettings(ctx: Ctx) {
  const row = (
    await ctx.c.query(
      "SELECT version,settings FROM administration_settings WHERE organization_id=$1",
      [ctx.org.id],
    )
  ).rows[0];
  const notificationSettings = row?.settings?.notifications;
  if (notificationSettings !== undefined &&
      (!notificationSettings || typeof notificationSettings !== "object" || Array.isArray(notificationSettings) ||
        typeof notificationSettings.emailEnabled !== "boolean" || Object.keys(notificationSettings).some(key => key !== "emailEnabled")))
    fail(503, "NOTIFICATION_CONFIGURATION_INVALID");
  return {
    version: row?.version ?? 0,
    settings: {
      ...defaults(ctx.org.name, ctx.org.locale, ctx.org.time_zone),
      ...(row?.settings ?? {}),
      branding: {
        ...defaults(ctx.org.name).branding,
        ...row?.settings?.branding,
      },
      onboarding: {
        ...defaults(ctx.org.name).onboarding,
        ...row?.settings?.onboarding,
      },
      notifications: {
        ...defaults(ctx.org.name).notifications,
        ...row?.settings?.notifications,
      },
      legal: { ...defaults(ctx.org.name).legal, ...row?.settings?.legal },
    },
  };
}
/** Safe entry projection. Caller supplies a current authenticated tenant context. */
export async function organizationEntry(ctx: Ctx) {
  const { version, settings: current } = await organizationSettings(ctx);
  const guest = ctx.member.member_type === "GUEST";
  const welcome = current.onboarding;
  const custom =
    welcome.enabled &&
    (welcome.audience === "ALL" ||
      welcome.audience === (guest ? "GUEST" : "MEMBER"));
  let destination = guest ? "SHARED" : welcome.destination;
  const module = (
    { GOALS: "goals", WORK: "work", MEETINGS: "meetings" } as Record<
      string,
      string
    >
  )[destination];
  if (module && !current.modules[module]) destination = "HOME";
  return {
    revision: version,
    acknowledged: !!(
      await ctx.c.query(
        "SELECT 1 FROM administration_entry_acknowledgements WHERE organization_id=$1 AND member_id=$2",
        [ctx.org.id, ctx.member.id],
      )
    ).rowCount,
    destination,
    welcome: custom
      ? {
          mode: "CUSTOM",
          title: welcome.title,
          body: readContent(welcome.body),
          videoUrl: welcome.videoUrl,
          videoMode: welcome.videoUrl ? "CUSTOM" : "DEFAULT",
          attachmentUrl: welcome.attachmentUrl,
        }
      : {
          mode: "DEFAULT",
          title: "Boas-vindas",
          body: readContent(
            "Conheça sua organização e os espaços de colaboração disponíveis para você.",
          ),
          videoUrl: null,
          videoMode: "DEFAULT",
          attachmentUrl: null,
        },
    legal: {
      name: current.legal.name,
      address: current.legal.address,
      termsUrl: current.legal.termsUrl,
      privacyUrl: current.legal.privacyUrl,
      contactName: current.legal.contactName,
      contactEmail: current.legal.contactEmail,
      contactPhone: current.legal.contactPhone,
    },
  };
}
export async function effectivePolicy(
  ctx: Ctx,
  key: string,
  overrideId?: string,
) {
  const rows = (
    await ctx.c.query(
      "SELECT id,version,value FROM administration_records WHERE organization_id=$1 AND kind='policy' AND value->>'key'=$2",
      [ctx.org.id, key],
    )
  ).rows;
  const row = overrideId
    ? rows.find((r) => r.id === overrideId)
    : rows.find((r) => !r.value.parentId);
  if (!row) return null;
  return {
    id: row.id,
    value: row.value.value,
    revision: row.version,
    parentId: row.value.parentId,
  };
}
/** Organization root only. Domain consumers resolve their own local overrides. */
export async function readOrganizationalPolicy(ctx: Ctx, key: string) {
  const row = (
    await ctx.c.query(
      "SELECT id,version,value FROM administration_records WHERE organization_id=$1 AND kind='policy' AND value->>'key'=$2 AND value->>'parentId' IS NULL",
      [ctx.org.id, key],
    )
  ).rows[0];
  return row
    ? {
        id: row.id as string,
        value: row.value.value as unknown,
        allowOverride: row.value.allowOverride === true,
        revision: row.version as number,
      }
    : null;
}
/** Explicit oversight is a read permission only; callers still enforce resource deny/window. */
export async function oversight(
  ctx: Ctx,
  action: "readMeeting" | "privateOperationalExport",
) {
  if (ctx.member.org_role !== "OWNER") return false;
  const row = (
    await ctx.c.query(
      "SELECT settings FROM administration_settings WHERE organization_id=$1",
      [ctx.org.id],
    )
  ).rows[0];
  return row?.settings.oversight[action] === true;
}
export interface AdministrationOptions {
  uploadPolicyConsumer?: UploadPolicyConsumer;
  admissionPolicyConsumer?: AdmissionPolicyConsumer;
  credentialPolicyReadiness?: CredentialPolicyReadiness;
  validateGovernancePolicyChange?: (
    ctx: Ctx,
    next: {
      key: "governance.method";
      value: string;
      allowOverride: boolean;
      revision: number;
    },
  ) => Promise<unknown>;
  validateOrganizationPolicyChange?: (
    ctx: Ctx,
    next: { enabled: boolean; allowCircleOverride: boolean; revision: number },
  ) => Promise<unknown>;
}
export function createAdministration(
  options: AdministrationOptions = {},
): OrgMapModule {
  return async (app, core) => {
    registerMemberIndicatorConsents(app, core);
    registerUploadPolicyAdministration(
      app,
      core,
      (ctx) => canManage(ctx, "settings.manage"),
      options.uploadPolicyConsumer,
    );
    registerAdmissionPolicyAdministration(
      app,
      core,
      (ctx) => canManage(ctx, "settings.manage"),
      options.admissionPolicyConsumer,
    );
    registerCredentialPolicyAdministration(
      app,
      core,
      (ctx) => canManage(ctx, "policy.manage"),
      options.credentialPolicyReadiness,
    );
    const policySupported = (key: string) =>
      key === "structure.collectiveManagement"
        ? !!options.validateOrganizationPolicyChange
        : key === "governance.method" &&
          !!options.validateGovernancePolicyChange;
    const base = "/api/v1/organizations/:organizationId/administration";
    const validatorCompiler =
      ({ schema }: any) =>
      (data: unknown) =>
        schemaValid(schema, data)
          ? { value: data }
          : { error: new Error("INVALID_REQUEST") };
    const post = (
      path: string,
      handler: (r: FastifyRequest, reply: FastifyReply) => any,
    ) =>
      app.post(
        path,
        {
          schema: {
            body: commandSchema(path),
            response: {
              200: commandResponseSchema(path),
              201: commandResponseSchema(path),
            },
          },
          validatorCompiler,
        },
        (r, reply) => {
          if (
            /\/administration\/(policies|fields|templates|groups|profiles|pages|grants)$/.test(
              path,
            )
          )
            reply.code(201);
          return handler(r, reply);
        },
      );
    const put = (
      path: string,
      handler: (r: FastifyRequest, reply: FastifyReply) => any,
    ) =>
      app.put(
        path,
        {
          schema: {
            body: commandSchema(path),
            response: {
              200: commandResponseSchema(path),
              201: commandResponseSchema(path),
            },
          },
          validatorCompiler,
        },
        handler,
      );
    const owner = (ctx: Ctx) => ctx.member.org_role === "OWNER";
    const all = async (ctx: Ctx, kind: Kind) =>
      (
        await ctx.c.query(
          "SELECT r.id,r.version,r.value,CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('active',p.active,'token',p.token,'revision',p.revision,'slug',p.snapshot->>'slug') END AS publication FROM administration_records r LEFT JOIN administration_publications p ON p.organization_id=r.organization_id AND p.id=r.id WHERE r.organization_id=$1 AND r.kind=$2 ORDER BY r.id",
          [ctx.org.id, kind],
        )
      ).rows;
    const get = async (ctx: Ctx, rid: string, kind: Kind) => {
      const row = (
        await ctx.c.query(
          "SELECT id,version,value FROM administration_records WHERE organization_id=$1 AND id=$2 AND kind=$3",
          [ctx.org.id, id(rid), kind],
        )
      ).rows[0];
      if (!row) fail(404, "RESOURCE_NOT_FOUND");
      return row;
    };
    const member = async (ctx: Ctx, mid: string) => {
      if (
        !(
          await ctx.c.query(
            "SELECT id FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
            [ctx.org.id, id(mid)],
          )
        ).rowCount
      )
        fail(404, "RESOURCE_NOT_FOUND");
    };
    const entryPath = "/api/v1/organizations/:organizationId/entry";
    app.get(entryPath, (r) => core.tenant(r, false, organizationEntry));
    app.post(entryPath + "/acknowledge", (r) =>
      core.tenant(r, { mode: "write", authorize: () => true }, async (ctx) => {
        body(r, []);
        const entry = await organizationEntry(ctx);
        version(r, entry.revision);
        const result = await ctx.c.query(
          "INSERT INTO administration_entry_acknowledgements(organization_id,member_id,settings_revision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING member_id",
          [ctx.org.id, ctx.member.id, entry.revision],
        );
        if (result.rowCount)
          await core.changed(
            ctx,
            r,
            ctx.member.id,
            "OrganizationWelcomeAcknowledged",
          );
        return { acknowledged: true, revision: entry.revision };
      }),
    );
    app.get(base + "/settings", (r) =>
      core.tenant(r, false, async (ctx) => {
        return {
          ...(await organizationSettings(ctx)),
          capabilities: {
            manage: await canManage(ctx, "settings.manage"),
            manageTheme: ctx.member.org_role === "OWNER",
            supervisionEditsPrivate: false,
          },
        };
      }),
    );
    put(base + "/settings", (r) =>
      core.tenant(
        r,
        {
          mode: "authorization_write",
          authorize: (ctx) => canManage(ctx, "settings.manage"),
        },
        async (ctx) => {
          const b = body(r, ["settings", "oversightAcknowledged"]);
          const value = settings(b.settings);
          const definitions = await all(ctx, "field");
          for (const key of [
            ...value.display.directoryFields,
            ...value.display.hoverFields,
          ])
            if (
              !definitions.some(
                (f) =>
                  f.value.key === key && f.value.visibility === "organization",
              )
            )
              fail(422, "INVALID_DISPLAY_FIELD");
          const old = (
            await ctx.c.query(
              "SELECT * FROM administration_settings WHERE organization_id=$1",
              [ctx.org.id],
            )
          ).rows[0];
          version(r, old?.version ?? 0);
          value.branding.colorTheme = authorizeColorTheme(b.settings.branding, old?.settings?.branding, ctx.member.org_role === "OWNER");
          // Older clients do not know this setting; their unrelated edits must
          // not silently re-enable organization notification emails.
          if (value.notifications === undefined)
            value.notifications = old?.settings?.notifications ?? defaults(ctx.org.name).notifications;
          if (
            JSON.stringify(
              old?.settings.oversight ??
                defaults(ctx.org.name, ctx.org.locale, ctx.org.time_zone)
                  .oversight,
            ) !== JSON.stringify(value.oversight) &&
            b.oversightAcknowledged !== true
          )
            fail(422, "OVERSIGHT_ACKNOWLEDGEMENT_REQUIRED");
          const row = (
            await ctx.c.query(
              "INSERT INTO administration_settings(organization_id,id,settings) VALUES($1,$2,$3) ON CONFLICT(organization_id) DO UPDATE SET settings=$3,version=administration_settings.version+1 RETURNING version,settings",
              [ctx.org.id, uuid(), value],
            )
          ).rows[0];
          await ctx.c.query(
            "INSERT INTO administration_settings_revisions(organization_id,version,settings,actor_id) VALUES($1,$2,$3,$4)",
            [ctx.org.id, row.version, value, ctx.account.id],
          );
          await core.changed(ctx, r, ctx.org.id, "OrganizationSettingsChanged");
          return row;
        },
      ),
    );
    app.get(base + "/settings/history", (r) =>
      core.tenant(
        r,
        { mode: "read", authorize: (ctx) => canManage(ctx, "settings.manage") },
        async (ctx) => ({
          items: (
            await ctx.c.query(
              "SELECT version,settings,created_at FROM administration_settings_revisions WHERE organization_id=$1 ORDER BY version DESC",
              [ctx.org.id],
            )
          ).rows,
        }),
      ),
    );
    for (const kind of kinds) {
      const route = base + "/" + (kind === "policy" ? "policies" : kind + "s");
      const authorize =
        (r: FastifyRequest, rid?: string) => async (ctx: Ctx) => {
          if (kind === "policy") {
            const value = (r.body as any).value;
            if (!policySupported(value.key) || value.parentId)
              fail(422, "POLICY_UNSUPPORTED");
          }
          if (kind !== "profile") return canManage(ctx, kind + ".manage", rid);
          const target = (r.body as any).value.memberId;
          const current = rid
            ? await get(ctx, rid, "profile")
            : (await all(ctx, "profile")).find(
                (p) => p.value.memberId === target,
              );
          if (
            current?.value.visibility === "private" &&
            current.value.memberId !== ctx.member.id
          )
            fail(404, "RESOURCE_NOT_FOUND");
          if (current && current.value.memberId !== target) return false;
          if (target !== ctx.member.id) {
            const values = (r.body as any).value.values;
            if (
              (await all(ctx, "field")).some(
                (field) =>
                  field.value.visibility === "private" &&
                  Object.hasOwn(values, field.value.key),
              )
            )
              fail(403, "PRIVATE_FIELD_RESTRICTED");
          }
          return (
            target === ctx.member.id ||
            (await canManage(ctx, "profile.manage", rid))
          );
        };
      app.get(route, (r) =>
        core.tenant(r, false, async (ctx) => {
          const rows = await all(ctx, kind);
          const permitted = new Set<string>();
          for (const row of rows)
            if (await canManage(ctx, kind + ".manage", row.id))
              permitted.add(row.id);
          const fields = kind === "profile" ? await all(ctx, "field") : [];
          return {
            items: rows
              .filter((row) =>
                kind === "profile"
                  ? row.value.visibility === "organization" ||
                    row.value.memberId === ctx.member.id
                  : kind === "field"
                    ? true
                    : permitted.has(row.id),
              )
              .map((row) =>
                kind === "profile" && row.value.memberId !== ctx.member.id
                  ? {
                      ...row,
                      value: {
                        ...row.value,
                        values: Object.fromEntries(
                          Object.entries(row.value.values).filter(([key]) =>
                            fields.some(
                              (f) =>
                                f.value.key === key &&
                                f.value.visibility === "organization",
                            ),
                          ),
                        ),
                      },
                    }
                  : row,
              )
              .map((row) => ({
                ...row,
                ...(kind === "policy"
                  ? { supported: policySupported(row.value.key) }
                  : {}),
                capabilities: {
                  update:
                    (kind !== "policy" ||
                      (policySupported(row.value.key) &&
                        !row.value.parentId)) &&
                    (permitted.has(row.id) ||
                      (kind === "profile" &&
                        row.value.memberId === ctx.member.id)),
                  history:
                    kind === "profile"
                      ? row.value.memberId === ctx.member.id
                      : permitted.has(row.id),
                },
              })),
            capabilities: {
              ...(kind === "policy"
                ? {
                    governancePolicy: policySupported("governance.method"),
                    collectivePolicy: policySupported(
                      "structure.collectiveManagement",
                    ),
                  }
                : {}),
              create:
                (await canManage(ctx, kind + ".manage")) || kind === "profile",
              manage: await canManage(ctx, kind + ".manage"),
            },
          };
        }),
      );
      async function save(r: any, ctx: Ctx, existing?: any) {
        const b = body(r, ["value", "planId"]);
        const value = structuredClone(validate(kind, b.value));
        const rid = existing?.id ?? uuid();
        if (existing) version(r, existing.version);
        if (kind === "profile") {
          await member(ctx, value.memberId);
          if (existing && value.memberId !== existing.value.memberId)
            fail(422, "PROFILE_MEMBER_IMMUTABLE");
          if (
            !(await canManage(ctx, "profile.manage", rid)) &&
            value.memberId !== ctx.member.id
          )
            fail(403, "ACTION_DENIED");
          if (
            existing?.value.visibility === "private" &&
            existing.value.memberId !== ctx.member.id
          )
            fail(404, "RESOURCE_NOT_FOUND");
          if (value.managerId) {
            await member(ctx, value.managerId);
            let next = value.managerId;
            const seen = new Set([value.memberId]);
            const profiles = await all(ctx, "profile");
            while (next) {
              if (seen.has(next)) fail(422, "HIERARCHY_CYCLE");
              seen.add(next);
              next = profiles.find((p) => p.value.memberId === next)?.value
                .managerId;
            }
          }
          const fields = await all(ctx, "field");
          if (
            Object.keys(value.values).some(
              (k) => !fields.some((f) => f.value.key === k),
            )
          )
            fail(422, "UNKNOWN_FIELD");
          for (const f of fields) {
            if (
              value.memberId !== ctx.member.id &&
              f.value.visibility === "private"
            ) {
              if (Object.hasOwn(value.values, f.value.key))
                fail(403, "PRIVATE_FIELD_RESTRICTED");
              if (existing && Object.hasOwn(existing.value.values, f.value.key))
                value.values[f.value.key] = existing.value.values[f.value.key];
            }
            fieldValue(f.value, value.values[f.value.key]);
            if (
              f.value.locked &&
              JSON.stringify(existing?.value.values[f.value.key]) !==
                JSON.stringify(value.values[f.value.key])
            )
              fail(403, "FIELD_LOCKED");
          }
          if (
            (await all(ctx, "profile")).some(
              (p) => p.id !== rid && p.value.memberId === value.memberId,
            )
          )
            fail(409, "PROFILE_EXISTS");
        }
        if (kind === "group") {
          for (const mid of value.memberIds) await member(ctx, mid);
          let next = value.parentId;
          const seen = new Set([rid]);
          while (next) {
            if (seen.has(next)) fail(422, "HIERARCHY_CYCLE");
            seen.add(next);
            next = (await get(ctx, next, "group")).value.parentId;
          }
        }
        if (kind === "policy") {
          if (!policySupported(value.key) || value.parentId)
            fail(422, "POLICY_UNSUPPORTED");
          const policies = await all(ctx, "policy");
          if (
            policies.some(
              (p) =>
                p.id !== rid &&
                p.value.key === value.key &&
                (p.value.parentId ?? null) === (value.parentId ?? null),
            )
          )
            fail(409, "POLICY_EXISTS");
          if (existing && existing.value.key !== value.key)
            fail(422, "POLICY_KEY_IMMUTABLE");
          if (
            !value.allowOverride &&
            policies.some((p) => p.value.parentId === rid)
          )
            fail(422, "OVERRIDES_EXIST");
          if (value.parentId) {
            const parent = await get(ctx, value.parentId, "policy");
            if (!parent.value.allowOverride || parent.value.key !== value.key)
              fail(422, "OVERRIDE_DENIED");
            let next = value.parentId;
            const seen = new Set([rid]);
            while (next) {
              if (seen.has(next)) fail(422, "POLICY_CYCLE");
              seen.add(next);
              next = (await get(ctx, next, "policy")).value.parentId;
            }
          }
        }
        if (kind === "template")
          for (const fid of value.fields) await get(ctx, fid, "field");
        if (kind === "field") {
          if (existing && value.key !== existing.value.key)
            fail(422, "FIELD_KEY_IMMUTABLE");
          if (
            (await all(ctx, "field")).some(
              (f) => f.id !== rid && f.value.key === value.key,
            )
          )
            fail(409, "FIELD_KEY_EXISTS");
          for (const p of await all(ctx, "profile"))
            fieldValue(value, p.value.values[value.key]);
          if (
            existing &&
            existing.value.visibility === "private" &&
            value.visibility === "organization" &&
            (await all(ctx, "profile")).some(
              (p) =>
                p.value.values[value.key] !== undefined &&
                p.value.values[value.key] !== null,
            )
          )
            fail(403, "PRIVATE_FIELD_RECLASSIFICATION_DENIED");
          if (
            existing &&
            (existing.value.type !== value.type ||
              JSON.stringify(existing.value.options) !==
                JSON.stringify(value.options))
          ) {
            if (!b.planId) fail(409, "SCHEMA_PLAN_REQUIRED");
            const coverage = (await all(ctx, "profile")).map((p) => ({
              id: p.id,
              version: p.version,
            }));
            const planned = await ctx.c.query(
              "SELECT id FROM administration_schema_plans WHERE organization_id=$1 AND id=$2 AND field_id=$3 AND field_version=$4 AND proposed=$5::jsonb AND profile_versions=$6::jsonb AND can_apply AND NOT applied AND expires_at>clock_timestamp()",
              [
                ctx.org.id,
                id(b.planId),
                rid,
                existing.version,
                JSON.stringify(value),
                JSON.stringify(coverage),
              ],
            );
            if (!planned.rowCount) fail(409, "SCHEMA_PLAN_STALE");
            await ctx.c.query(
              "UPDATE administration_schema_plans SET applied=true WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, b.planId],
            );
          }
        }
        if (
          kind === "policy" &&
          value.key === "structure.collectiveManagement" &&
          !value.parentId
        ) {
          if (!options.validateOrganizationPolicyChange)
            fail(422, "POLICY_UNSUPPORTED");
          await options.validateOrganizationPolicyChange!(ctx, {
            enabled: value.value,
            allowCircleOverride: value.allowOverride,
            revision: (existing?.version ?? 0) + 1,
          });
        }
        if (kind === "policy" && value.key === "governance.method")
          await options.validateGovernancePolicyChange!(ctx, {
            key: "governance.method",
            value: value.value,
            allowOverride: value.allowOverride,
            revision: (existing?.version ?? 0) + 1,
          });
        const row = (
          await ctx.c.query(
            "INSERT INTO administration_records(organization_id,id,kind,value) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,id) DO UPDATE SET value=$4,version=administration_records.version+1 RETURNING id,version,value",
            [ctx.org.id, rid, kind, value],
          )
        ).rows[0];
        if (kind === "profile")
          await ctx.c.query(
            "INSERT INTO administration_profile_relations VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,id) DO UPDATE SET manager_id=$4",
            [ctx.org.id, rid, value.memberId, value.managerId ?? null],
          );
        if (kind === "group") {
          await ctx.c.query(
            "INSERT INTO administration_group_relations VALUES($1,$2,$3) ON CONFLICT(organization_id,id) DO UPDATE SET parent_id=$3",
            [ctx.org.id, rid, value.parentId ?? null],
          );
          await ctx.c.query(
            "DELETE FROM administration_group_members WHERE organization_id=$1 AND group_id=$2",
            [ctx.org.id, rid],
          );
          for (const mid of value.memberIds)
            await ctx.c.query(
              "INSERT INTO administration_group_members VALUES($1,$2,$3)",
              [ctx.org.id, rid, mid],
            );
        }
        await ctx.c.query(
          "INSERT INTO administration_revisions(organization_id,id,version,value,actor_id) VALUES($1,$2,$3,$4,$5)",
          [ctx.org.id, rid, row.version, value, ctx.account.id],
        );
        await core.changed(ctx, r, rid, kind + "Changed");
        if (kind === "profile" && value.memberId !== ctx.member.id) {
          const fields = await all(ctx, "field");
          return {
            ...row,
            value: {
              ...row.value,
              values: Object.fromEntries(
                Object.entries(row.value.values).filter(([key]) =>
                  fields.some(
                    (f) =>
                      f.value.key === key &&
                      f.value.visibility === "organization",
                  ),
                ),
              ),
            },
          };
        }
        return row;
      }
      post(route, (r) =>
        core.tenant(
          r,
          { mode: "authorization_write", authorize: authorize(r) },
          (ctx) => save(r, ctx),
        ),
      );
      put(route + "/:id", (r) =>
        core.tenant(
          r,
          {
            mode: "authorization_write",
            authorize: authorize(r, (r.params as any).id),
          },
          async (ctx) =>
            save(r, ctx, await get(ctx, (r.params as any).id, kind)),
        ),
      );
      app.get(route + "/:id/history", (r) =>
        core.tenant(
          r,
          {
            mode: "read",
            authorize: async (ctx) =>
              kind === "profile" ||
              (await canManage(ctx, kind + ".manage", (r.params as any).id)),
          },
          async (ctx) => {
            const row = await get(ctx, (r.params as any).id, kind);
            if (kind === "profile" && row.value.memberId !== ctx.member.id)
              fail(404, "RESOURCE_NOT_FOUND");
            return {
              items: (
                await ctx.c.query(
                  "SELECT version,value,created_at FROM administration_revisions WHERE organization_id=$1 AND id=$2 ORDER BY version DESC",
                  [ctx.org.id, (r.params as any).id],
                )
              ).rows,
            };
          },
        ),
      );
    }
    post(base + "/fields/:id/plan", (r) =>
      core.tenant(
        r,
        {
          mode: "write",
          authorize: (ctx) =>
            canManage(ctx, "field.manage", (r.params as any).id),
        },
        async (ctx) => {
          const old = await get(ctx, (r.params as any).id, "field");
          version(r, old.version);
          const b = body(r, ["value"]);
          const value = validate("field", b.value);
          const profiles = await all(ctx, "profile");
          const incompatible: string[] = [];
          for (const p of profiles)
            try {
              fieldValue(value, p.value.values[old.value.key]);
            } catch {
              incompatible.push(
                (p.value.visibility === "private" ||
                  old.value.visibility === "private" ||
                  value.visibility === "private") &&
                  p.value.memberId !== ctx.member.id
                  ? "RESTRICTED_PROFILE"
                  : p.id,
              );
            }
          const planId = uuid();
          const canApply =
            incompatible.length === 0 && value.key === old.value.key;
          await ctx.c.query(
            "INSERT INTO administration_schema_plans(organization_id,id,field_id,field_version,proposed,profile_versions,can_apply) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              ctx.org.id,
              planId,
              old.id,
              old.version,
              value,
              JSON.stringify(
                profiles.map((p) => ({ id: p.id, version: p.version })),
              ),
              canApply,
            ],
          );
          await core.changed(ctx, r, planId, "FieldSchemaChangePlanned");
          return {
            planId,
            sourceVersion: old.version,
            profiles: profiles.length,
            incompatible,
            canApply,
            valuesPreserved: true,
          };
        },
      ),
    );
    post(base + "/pages/:id/preview", (r) =>
      core.tenant(
        r,
        {
          mode: "write",
          authorize: (ctx) =>
            canManage(ctx, "page.manage", (r.params as any).id),
        },
        async (ctx) => {
          const row = await get(ctx, (r.params as any).id, "page");
          version(r, row.version);
          return {
            snapshot: validate("page", row.value),
            revision: row.version,
            public: false,
          };
        },
      ),
    );
    post(base + "/pages/:id/publish", (r) =>
      core.tenant(
        r,
        {
          mode: "authorization_write",
          authorize: (ctx) =>
            canManage(ctx, "page.manage", (r.params as any).id),
        },
        async (ctx) => {
          const row = await get(ctx, (r.params as any).id, "page");
          version(r, row.version);
          const b = body(r, ["approvedRevision"]);
          if (b.approvedRevision !== row.version)
            fail(409, "PREVIEW_REVISION_CONFLICT");
          const token = uuid();
          await ctx.c.query(
            "INSERT INTO administration_publications VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(organization_id,id) DO UPDATE SET token=$3,revision=$4,snapshot=$5,active=true",
            [
              ctx.org.id,
              row.id,
              token,
              row.version,
              validate("page", row.value),
            ],
          );
          await ctx.c.query(
            "UPDATE administration_records SET version=version+1 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, row.id],
          );
          await ctx.c.query(
            "INSERT INTO administration_revisions(organization_id,id,version,value,actor_id) VALUES($1,$2,$3,$4,$5)",
            [ctx.org.id, row.id, row.version + 1, row.value, ctx.account.id],
          );
          await core.changed(ctx, r, row.id, "PagePublished");
          return {
            page: { ...row, version: row.version + 1 },
            url: "/public/pages/" + token + "/" + row.value.slug,
            apiUrl: "/api/v1/public/pages/" + token,
            revision: row.version,
          };
        },
      ),
    );
    post(base + "/pages/:id/unpublish", (r) =>
      core.tenant(
        r,
        {
          mode: "authorization_write",
          authorize: (ctx) =>
            canManage(ctx, "page.manage", (r.params as any).id),
        },
        async (ctx) => {
          const row = await get(ctx, (r.params as any).id, "page");
          version(r, row.version);
          await ctx.c.query(
            "UPDATE administration_publications SET active=false WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, row.id],
          );
          await ctx.c.query(
            "UPDATE administration_records SET version=version+1 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, row.id],
          );
          await ctx.c.query(
            "INSERT INTO administration_revisions(organization_id,id,version,value,actor_id) VALUES($1,$2,$3,$4,$5)",
            [ctx.org.id, row.id, row.version + 1, row.value, ctx.account.id],
          );
          await core.changed(ctx, r, row.id, "PageUnpublished");
          return { revoked: true, page: { ...row, version: row.version + 1 } };
        },
      ),
    );
    const publicSnapshot = async (token: string) => {
      const row = (
        await pool.query("SELECT administration_read_public($1) AS snapshot", [
          id(token),
        ])
      ).rows[0];
      if (!row?.snapshot) fail(404, "RESOURCE_NOT_FOUND");
      return row.snapshot;
    };
    app.get("/api/v1/public/pages/:token", async (r, reply) => {
      reply.header("Cache-Control", "no-store");
      return { data: await publicSnapshot((r.params as any).token) };
    });
    const renderPublic = async (r: FastifyRequest, reply: FastifyReply) => {
      reply
        .header("Cache-Control", "no-store")
        .header(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        )
        .type("text/html");
      let snapshot;
      try {
        snapshot = await publicSnapshot((r.params as any).token);
        if (
          (r.params as any).slug !== undefined &&
          (r.params as any).slug !== snapshot.slug
        )
          fail(404, "RESOURCE_NOT_FOUND");
      } catch (e) {
        if ((e as any).status !== 404) throw e;
        return reply
          .code(404)
          .send(
            '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página indisponível</title><main><h1>Página indisponível</h1><p>Esta página não está publicada ou foi revogada.</p></main></html>',
          );
      }
      const escape = (s: string) =>
        s.replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c]!,
        );
      reply
        .header("Cache-Control", "no-store")
        .header(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        )
        .type("text/html");
      return (
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
        escape(snapshot.title) +
        "</title><style>body{font:18px/1.6 system-ui;color:#292524;background:#f8f7f4;margin:0}main{max-width:780px;margin:60px auto;padding:24px}section{margin:40px 0}p{white-space:pre-wrap}a{color:#147d92}</style><main><h1>" +
        escape(snapshot.title) +
        "</h1>" +
        snapshot.sections
          .map(
            (s: any) =>
              "<section><h2>" +
              escape(s.heading) +
              "</h2>" +
              renderHTML(readContent(s.text)) +
              (s.link
                ? '<a rel="noopener noreferrer" href="' +
                  escape(s.link) +
                  '">Saiba mais</a>'
                : "") +
              "</section>",
          )
          .join("") +
        "</main></html>"
      );
    };
    app.get("/public/pages/:token", renderPublic);
    app.get("/public/pages/:token/:slug", renderPublic);
    app.get(base + "/grants", (r) =>
      core.tenant(r, { mode: "read", authorize: owner }, async (ctx) => ({
        items: (
          await ctx.c.query(
            "SELECT id,member_id,action,resource_id,version,active FROM administration_grants WHERE organization_id=$1 ORDER BY id",
            [ctx.org.id],
          )
        ).rows,
      })),
    );
    post(base + "/grants", (r) =>
      core.tenant(r, { mode: "authorization_write" }, async (ctx) => {
        const b = body(r, ["memberId", "action", "resourceId"]);
        await member(ctx, b.memberId);
        if (
          !["settings.manage", ...kinds.map((k) => k + ".manage")].includes(
            b.action,
          )
        )
          fail(422, "INVALID_ACTION");
        if (b.resourceId) await get(ctx, b.resourceId, b.action.split(".")[0]);
        const row = (
          await ctx.c.query(
            "INSERT INTO administration_grants(organization_id,id,member_id,action,resource_id) VALUES($1,$2,$3,$4,$5) RETURNING id,version",
            [ctx.org.id, uuid(), b.memberId, b.action, b.resourceId ?? null],
          )
        ).rows[0];
        await core.changed(ctx, r, row.id, "AdministrationGrantCreated");
        return row;
      }),
    );
    post(base + "/grants/:id/revoke", (r) =>
      core.tenant(r, { mode: "authorization_write" }, async (ctx) => {
        const row = (
          await ctx.c.query(
            "SELECT * FROM administration_grants WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, id((r.params as any).id)],
          )
        ).rows[0];
        if (!row) fail(404, "RESOURCE_NOT_FOUND");
        version(r, row.version);
        await ctx.c.query(
          "UPDATE administration_grants SET active=false,version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, row.id],
        );
        await core.changed(ctx, r, row.id, "AdministrationGrantRevoked");
        return { revoked: true };
      }),
    );
  };
}
const administration = createAdministration();
export default administration;

import { storedIndicatorSubject } from "./indicator-subject.js";
import type { StructurePortsOptions } from "./ports.js";
import type { OrgMapModule, Ctx } from "../../src/runtime.js";
import type { FastifyRequest } from "fastify";
import { body, id, version, camel, fail } from "../../src/core.js";
import { StructureService } from "./service.js";
import { initialView, viewConfig, integer } from "./domain.js";
export { createStructurePorts } from "./applier.js";
const prefix = "/api/v1/organizations/:organizationId/structure-advanced";
export function createStructureModule(
  options: StructurePortsOptions = {},
): OrgMapModule {
  return async (app, core) => {
    const service = (ctx: Ctx, r?: FastifyRequest) =>
      new StructureService(ctx, core, r, options);
    const owner = (ctx: Ctx) =>
      ctx.member.org_role === "OWNER" && ctx.member.member_type !== "GUEST";
    const write = (
      r: FastifyRequest,
      fn: (s: StructureService) => Promise<any>,
      authorize?: (ctx: Ctx) => Promise<boolean> | boolean,
    ) =>
      core.tenant(
        r,
        {
          mode: "authorization_write",
          authorize: async (ctx) => {
            if (
              ctx.member.member_type === "GUEST" &&
              !/^\/api\/v1\/organizations\/[^/]+\/structure-advanced\/views(?:\/[^/]+)?$/.test(
                r.url.split("?")[0],
              )
            )
              return false;
            return (authorize ?? owner)(ctx);
          },
        },
        (ctx) => fn(service(ctx, r)),
      );
    const read = (
      r: FastifyRequest,
      fn: (s: StructureService) => Promise<any>,
    ) =>
      core.tenant(r, { mode: "read" }, (ctx) => {
        if (
          ctx.member.member_type === "GUEST" &&
          !/^\/api\/v1\/organizations\/[^/]+\/structure-advanced\/(graph|views(?:\/[^/]+)?)$/.test(
            r.url.split("?")[0],
          )
        )
          fail(404, "RESOURCE_NOT_FOUND");
        return fn(service(ctx));
      });
    const param = (r: FastifyRequest, k: string) => id((r.params as any)[k]);
    const expected = (r: FastifyRequest) => {
      const h = r.headers["if-match"];
      if (!h) fail(428, "PRECONDITION_REQUIRED");
      if (typeof h !== "string" || !/^"[0-9]+"$/.test(h))
        fail(409, "VERSION_CONFLICT");
      return integer(Number((h as string).slice(1, -1)));
    };
    app.get(prefix + "/circles/:id/collective", (r) =>
      read(r, (s) => s.collectivePolicy(param(r, "id"))),
    );
    app.put(prefix + "/circles/:id/collective", (r) =>
      write(
        r,
        (s) =>
          s.configureCollective(
            param(r, "id"),
            body(r, ["enabled"]),
            expected(r),
          ),
        (ctx) => service(ctx).can(param(r, "id"), "ADMIN"),
      ),
    );
    app.get(prefix + "/circles/:id/display-preferences", (r) =>
      read(r, (s) => s.circleDisplay(param(r, "id"))),
    );
    app.put(prefix + "/circles/:id/display-preferences", (r) =>
      write(
        r,
        (s) =>
          s.configureCircleDisplay(
            param(r, "id"),
            body(r, ["labels", "avatars", "minimap"]),
            expected(r),
          ),
        (ctx) =>
          service(ctx).authorizeLocalCircle(
            param(r, "id"),
            "CIRCLE_LOCAL_CONFIGURATION",
          ),
      ),
    );
    app.put(prefix + "/circles/:id/policy", (r) =>
      write(r, (s) =>
        s.circlePolicy(
          param(r, "id"),
          body(r, ["governedFields"]),
          expected(r),
        ),
      ),
    );
    app.get(prefix + "/circles/:id/policy", (r) =>
      read(r, async (s) => {
        await s.entity(param(r, "id"), "CIRCLE");
        const row = (
          await s.ctx.c.query(
            "SELECT * FROM structure_circle_policies WHERE organization_id=$1 AND circle_id=$2",
            [s.org, param(r, "id")],
          )
        ).rows[0];
        return row
          ? camel(row)
          : { circleId: param(r, "id"), governedFields: [], version: 0 };
      }),
    );
    app.post(prefix + "/fields/:id/migrate", (r) =>
      write(r, async (s) => {
        const f = await s.one("structure_fields", "id", param(r, "id"));
        version(r, f.version);
        return s.migrateField(f.id, body(r, ["definition", "values"]));
      }),
    );
    app.get(prefix + "/catalog", (r) =>
      read(r, async (s) => ({
        templates: (
          await s.ctx.c.query(
            "SELECT * FROM structure_templates WHERE organization_id=$1 ORDER BY name,id",
            [s.org],
          )
        ).rows.map(camel),
        fields: (
          await s.ctx.c.query(
            "SELECT * FROM structure_fields WHERE organization_id=$1 ORDER BY key",
            [s.org],
          )
        ).rows.map(camel),
        roleSettings: (
          await s.ctx.c.query(
            "SELECT * FROM structure_role_settings WHERE organization_id=$1",
            [s.org],
          )
        ).rows.map(camel),
        indicators: (
          await s.ctx.c.query(
            "SELECT i.* FROM structure_indicators i JOIN entities e ON e.organization_id=i.organization_id AND e.id=i.entity_id WHERE i.organization_id=$1 AND NOT e.archived AND NOT i.archived ORDER BY name,id",
            [s.org],
          )
        ).rows.map(camel),
        capabilities: { configure: s.ctx.member.org_role === "OWNER" },
        views: (
          await s.ctx.c.query(
            "SELECT * FROM structure_views WHERE organization_id=$1 AND member_id=$2 AND deleted_at IS NULL ORDER BY name,id",
            [s.org, s.ctx.member.id],
          )
        ).rows.map(camel),
        snapshots: (
          await s.ctx.c.query(
            "SELECT id,name,at,structure_revision FROM structure_snapshots WHERE organization_id=$1 ORDER BY at DESC,id LIMIT 100",
            [s.org],
          )
        ).rows.map(camel),
      })),
    );
    app.post(prefix + "/templates", async (r, reply) => {
      const result = await write(r, (s) =>
        s.template(body(r, ["name", "flags", "purpose", "purposeRich"])),
      );
      reply.code(201);
      return result;
    });
    app.patch(prefix + "/templates/:id", (r) =>
      write(r, async (s) => {
        const t = await s.one("structure_templates", "id", param(r, "id"));
        version(r, t.version);
        return s.template(
          body(r, ["name", "flags", "purpose", "purposeRich"]),
          t,
        );
      }),
    );
    app.get(prefix + "/roles/:id/function", (r) =>
      read(r, async (s) => ({
        ...(await s.roleFunction(param(r, "id"))),
        capabilities: { manage: owner(s.ctx) },
      })),
    );
    app.put(prefix + "/roles/:id/function", (r) =>
      write(r, (s) =>
        s.setRoleFunction(
          param(r, "id"),
          body(r, ["functionCode"]),
          expected(r),
        ),
      ),
    );
    app.put(prefix + "/roles/:id/settings", (r) =>
      write(r, (s) =>
        s.configureRole(
          param(r, "id"),
          body(r, ["templateId", "flags"]),
          expected(r),
        ),
      ),
    );
    app.get(prefix + "/members/:id/reasons", (r) =>
      read(r, (s) => s.reasons(param(r, "id"))),
    );
    app.post(prefix + "/mandates", async (r, reply) => {
      const p = body(r, [
        "roleId",
        "memberId",
        "kind",
        "startsAt",
        "endsAt",
        "scope",
      ]);
      const out = await write(
        r,
        (s) => s.mandate(p),
        async (ctx) => {
          const modeled=await core.governanceModel()?.authorizeAssignment(ctx,{roleId:id(p.roleId),memberId:id(p.memberId),kind:p.kind,endsAt:p.endsAt});
          return modeled ?? service(ctx).canEntity(id(p.roleId), "ASSIGN");
        },
      );
      reply.code(201);
      return out;
    });
    app.get(prefix + "/roles/:id/mandates", (r) =>
      read(r, async (s) => {
        await s.entity(param(r, "id"), "ROLE");
        return {
          items: (
            await s.ctx.c.query(
              "SELECT * FROM structure_mandates WHERE organization_id=$1 AND role_id=$2 ORDER BY starts_at,id",
              [s.org, param(r, "id")],
            )
          ).rows.map(camel),
        };
      }),
    );
    app.post(prefix + "/mandates/:id/end", (r) =>
      write(
        r,
        async (s) => {
          body(r, []);
          const m = await s.one("structure_mandates", "id", param(r, "id"));
          version(r, m.version);
          return s.endMandate(m.id);
        },
        async (ctx) => {
          const s = service(ctx),
            m = await s.one("structure_mandates", "id", param(r, "id"));
          const modeled=await core.governanceModel()?.authorizeEnd(ctx,'MANDATE',m.id);
          if(typeof modeled==='boolean')return modeled;
          return s.canEntity(m.role_id, "ASSIGN");
        },
      ),
    );
    app.post(prefix + "/aliases", async (r, reply) => {
      const out = await write(r, (s) =>
        s.alias(body(r, ["sourceRoleId", "circleId", "label"])),
      );
      reply.code(201);
      return out;
    });
    app.post(prefix + "/fields", async (r, reply) => {
      const out = await write(r, (s) =>
        s.defineField(
          body(r, ["key", "label", "target", "schema", "governed"]),
        ),
      );
      reply.code(201);
      return out;
    });
    app.patch(prefix + "/fields/:id", (r) =>
      write(r, async (s) => {
        const f = await s.one("structure_fields", "id", param(r, "id"));
        version(r, f.version);
        return s.defineField(
          body(r, ["key", "label", "target", "schema", "governed"]),
          f,
        );
      }),
    );
    app.post(prefix + "/fields/:id/preview", (r) =>
      write(r, async (s) => {
        const f = await s.one("structure_fields", "id", param(r, "id"));
        version(r, f.version);
        return s.defineField(
          body(r, ["key", "label", "target", "schema", "governed"]),
          f,
          true,
        );
      }),
    );
    app.get(prefix + "/entities/:id/fields", (r) =>
      read(r, (s) => s.values(param(r, "id"))),
    );
    app.put(prefix + "/entities/:id/fields/:fieldId", (r) =>
      write(
        r,
        (s) => {
          const p = body(r, ["value"]);
          return s.setValue(
            param(r, "id"),
            param(r, "fieldId"),
            p.value,
            expected(r),
          );
        },
        (ctx) => service(ctx).canEntity(param(r, "id"), "ADMIN"),
      ),
    );
    app.post(prefix + "/indicators", async (r, reply) => {
      const p = body(r, [
        "entityId",
        "subject",
        "name",
        "kind",
        "valueType",
        "unit",
        "requiredUnits",
      ]);
      const out = await write(
        r,
        (s) => s.indicator(p),
        async (ctx) => {
          const s = service(ctx);
          return s.canIndicatorSubject(
            await s.inputIndicatorSubject(p),
            "DEFINE",
          );
        },
      );
      reply.code(201);
      return out;
    });
    const authorizeDefinition = async (ctx: Ctx, r: FastifyRequest) => {
      const s = service(ctx);
      const row = await s.one("structure_indicators", "id", param(r, "id"));
      return s.canIndicatorSubject(storedIndicatorSubject(row), "DEFINE");
    };
    app.patch(prefix + "/indicators/:id", (r) =>
      write(
        r,
        (s) =>
          s.updateIndicator(
            param(r, "id"),
            body(r, ["name", "kind", "valueType", "unit", "requiredUnits"]),
            expected(r),
          ),
        (ctx) => authorizeDefinition(ctx, r),
      ),
    );
    app.delete(prefix + "/indicators/:id", (r) =>
      write(
        r,
        (s) =>
          s.updateIndicator(param(r, "id"), body(r, []), expected(r), true),
        (ctx) => authorizeDefinition(ctx, r),
      ),
    );
    app.post(prefix + "/indicators/:id/records", (r) =>
      write(
        r,
        (s) =>
          s.record(
            param(r, "id"),
            body(r, ["period", "unitKey", "value"]),
            expected(r),
          ),
        async (ctx) => {
          const s = service(ctx),
            i = await s.one("structure_indicators", "id", param(r, "id"));
          return s.canIndicatorSubject(storedIndicatorSubject(i), "RECORD");
        },
      ),
    );
    app.get(prefix + "/indicators/:id/records", (r) =>
      read(r, (s) =>
        s.indicatorPeriod(param(r, "id"), (r.query as any).period),
      ),
    );
    app.get(prefix + "/subjects/member/:memberId/indicators", (r) =>
      read(r, (s) => s.memberIndicators(param(r, "memberId"))),
    );
    app.get(prefix + "/subjects/member/:memberId/history", (r) =>
      read(r, (s) => s.memberIndicatorHistory(param(r, "memberId"))),
    );
    app.get(prefix + "/graph", (r) =>
      read(r, async (s) => {
        const q = r.query as any;
        if (Object.keys(q).some((k) => !["viewId", "config"].includes(k)))
          fail(400, "INVALID_REQUEST");
        if (q.config) {
          if (
            q.viewId ||
            typeof q.config !== "string" ||
            q.config.length > 10000
          )
            fail(400, "INVALID_REQUEST");
          let config;
          try {
            config = JSON.parse(q.config);
          } catch {
            fail(400, "INVALID_REQUEST");
          }
          return s.graph(viewConfig(config));
        }
        if (!q.viewId) return s.graph();
        const v = await s.privateView(id(q.viewId));
        return s.graph(viewConfig(v.config));
      }),
    );
    app.get(prefix + "/views", (r) => read(r, (s) => s.listViews(r.query)));
    app.get(prefix + "/views/:id", (r) =>
      read(r, async (s) => camel(await s.privateView(param(r, "id")))),
    );
    app.delete(prefix + "/views/:id", (r) =>
      write(
        r,
        (s) => s.deleteView(param(r, "id"), expected(r)),
        () => true,
      ),
    );
    app.post(prefix + "/views", async (r, reply) => {
      const out = await write(
        r,
        (s) => s.saveView(body(r, ["name", "config"])),
        () => true,
      );
      reply.code(201);
      return out;
    });
    app.patch(prefix + "/views/:id", (r) =>
      write(
        r,
        async (s) => {
          const v = await s.privateView(param(r, "id"));
          version(r, v.version);
          return s.saveView(body(r, ["name", "config"]), v);
        },
        () => true,
      ),
    );
    app.post(prefix + "/snapshots", async (r, reply) => {
      const out = await write(r, (s) => s.snapshot(body(r, ["name"]).name));
      reply.code(201);
      return out;
    });
    app.get(prefix + "/snapshots/:id", (r) =>
      read(r, async (s) => {
        const row = await s.one("structure_snapshots", "id", param(r, "id"));
        return {
          ...camel(row),
          coverage: {
            coverageStart: row.at,
            degraded: false,
            scope: "CAPTURE_ONLY",
          },
        };
      }),
    );
    app.get(prefix + "/entities/:id/history", (r) =>
      read(r, async (s) => {
        await s.one("entities", "id", param(r, "id"));
        const q = r.query as any;
        if (Object.keys(q).some((k) => !["before", "limit"].includes(k)))
          fail(400, "INVALID_REQUEST");
        const limit = q.limit === undefined ? 50 : Number(q.limit);
        integer(limit, 1, 100);
        let before = null;
        if (q.before) {
          const cursor = await s.one("structure_history", "id", id(q.before));
          if (cursor.indicator_subject_kind === "MEMBER")
            fail(404, "RESOURCE_NOT_FOUND");
          if (cursor.resource_id !== param(r, "id"))
            fail(400, "INVALID_CURSOR");
          before = cursor.id;
        }
        const rows = (
          await s.ctx.c.query(
            `SELECT * FROM structure_history WHERE organization_id=$1 AND resource_id=$2 AND indicator_subject_kind IS DISTINCT FROM 'MEMBER' AND ($3::uuid IS NULL OR (at,id)<(SELECT at,id FROM structure_history WHERE organization_id=$1 AND id=$3)) ORDER BY at DESC,id DESC LIMIT $4`,
            [s.org, param(r, "id"), before, limit + 1],
          )
        ).rows;
        return {
          items: rows.slice(0, limit).map(camel),
          page: {
            hasMore: rows.length > limit,
            nextCursor: rows.length > limit ? rows[limit - 1].id : null,
          },
          coverage: {
            scope: "MODULE_COMMANDS",
            degraded: true,
            reason:
              "Foundation history is available separately through audit-events",
          },
        };
      }),
    );
  };
}
export const registerContext: OrgMapModule = createStructureModule();
export default registerContext;

import type { StructurePortsOptions } from "./ports.js";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type { ResourceAccessPort } from "../platform/ports.js";
import { id, fail, text, uuid } from "../../src/core.js";
import { object, integer, initialView } from "./domain.js";
import { StructureService } from "./service.js";
import { normalizePurposeChange, readPurposeRow } from "./purpose.js";
import { createStructurePorts } from "./applier.js";
import { normalizeDefinitionChange } from "./definition.js";
export function createStructureResourceAdapters(
  core: ModuleRuntime,
  options: StructurePortsOptions = {},
): Record<"circle" | "role", ResourceAccessPort> {
  const make = (kind: "CIRCLE" | "ROLE"): ResourceAccessPort => ({
    async authorize(ctx, resourceId, action) {
      const s = new StructureService(ctx, core, undefined, options);
      let e: any;
      try {
        e = await s.readableEntity(id(resourceId), kind);
      } catch {
        return false;
      }
      if (s.isGuest()) return action === "read";
      if (action === "read" || action === "follow" || action === "export")
        return true;
      if (action === "comment") return s.canEntity(e.id, "RECORD");
      if (action === "attach") return s.canEntity(e.id, "ADMIN");
      if (action === "import") return s.canEntity(e.id, "ADMIN");
      return false;
    },
    async lookup(ctx, resourceId) {
      const s = new StructureService(ctx, core, undefined, options);
      const e = await s.readableEntity(id(resourceId), kind);
      return { id: e.id, title: e.name };
    },
    async search(ctx, query, limit) {
      const s = new StructureService(ctx, core, undefined, options);
      if (typeof query !== "string" || query.length > 200)
        fail(400, "INVALID_REQUEST");
      integer(limit, 1, 100);
      const needle = query.toLocaleLowerCase();
      const contentMatch = (e: any) =>
        [
          e.name,
          e.purpose,
          ...(Array.isArray(e.responsibilities) ? e.responsibilities : []).map(
            (item: any) => item?.text,
          ),
          ...(Array.isArray(e.artifacts) ? e.artifacts : []).map(
            (item: any) => item?.text,
          ),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle);
      if (s.isGuest()) {
        const graph = await s.graph({
          ...initialView,
          view: "DIRECTORY",
          kind,
          query: "",
        });
        return graph.entities
          .filter(contentMatch)
          .slice(0, limit)
          .map((e) => ({
            type: kind === "CIRCLE" ? "circle" : "role",
            id: e.id,
            title: e.name,
            description: e.purpose,
          }));
      }
      return (
        await ctx.c.query(
          `SELECT id,name,purpose FROM entities WHERE organization_id=$1 AND kind=$2 AND NOT archived AND (strpos(lower(name),lower($3))>0 OR strpos(lower(purpose),lower($3))>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements((CASE WHEN jsonb_typeof(responsibilities)='array' THEN responsibilities ELSE '[]'::jsonb END)||(CASE WHEN jsonb_typeof(artifacts)='array' THEN artifacts ELSE '[]'::jsonb END)) item WHERE strpos(lower(item->>'text'),lower($3))>0)) ORDER BY name,id LIMIT $4`,
          [s.org, kind, query, limit],
        )
      ).rows.map((e) => ({
        type: kind === "CIRCLE" ? "circle" : "role",
        id: e.id,
        title: e.name,
        description: e.purpose,
      }));
    },
    async export(ctx, ids, exportKind) {
      if (ctx.member.member_type === "GUEST") fail(403, "ACTION_DENIED");
      if (exportKind !== "STRUCTURE") fail(422, "EXPORT_KIND_REQUIRED");
      if (!Array.isArray(ids) || ids.length > 1000)
        fail(400, "INVALID_REQUEST");
      const s = new StructureService(ctx, core, undefined, options);
      const records = [];
      for (const eid of ids) {
        const e = await s.entity(id(eid), kind);
        records.push({
          schema: "orgmap-structure-v1",
          id: e.id,
          kind: e.kind,
          parentCircleId: e.parent_id,
          name: e.name,
          ...readPurposeRow(e),
          responsibilities: e.responsibilities,
          artifacts: e.artifacts,
          version: e.version,
        });
      }
      return {
        records,
        coverage: "EXPLICIT_IDS_ACTIVE_STRUCTURE",
        estimated: false,
      };
    },
    async validateImport(ctx, records, importKind) {
      if (ctx.member.member_type === "GUEST") fail(403, "ACTION_DENIED");
      if (importKind !== "STRUCTURE") fail(422, "IMPORT_KIND_REQUIRED");
      if (!Array.isArray(records) || records.length < 1 || records.length > 100)
        fail(400, "INVALID_REQUEST");
      const s = new StructureService(ctx, core, undefined, options);
      const operations: Record<string, any>[] = [];
      for (const raw of records) {
        const r = object(raw, [
          "schema",
          "id",
          "kind",
          "parentCircleId",
          "name",
          "purpose",
          "purposeRich",
          "responsibilities",
          "artifacts",
          "version",
        ]);
        if (r.schema !== "orgmap-structure-v1" || r.kind !== kind)
          fail(422, "IMPORT_SCHEMA_INVALID");
        const eid = r.id ? id(r.id) : uuid();
        const exists = (
          await ctx.c.query(
            "SELECT * FROM entities WHERE organization_id=$1 AND id=$2",
            [s.org, eid],
          )
        ).rows[0];
        if (exists) {
          if (exists.kind !== kind || exists.archived)
            fail(404, "RESOURCE_NOT_FOUND");
          if (!(await s.canEntity(eid, "ADMIN"))) fail(403, "ACTION_DENIED");
          if (exists.version !== integer(r.version, 1))
            fail(409, "VERSION_CONFLICT");
          if (r.parentCircleId !== exists.parent_id)
            fail(422, "IMPORT_MOVE_REQUIRES_ARCHITECT");
          await s.preflightEntityChange({
            operation: "UPDATE",
            entityId: eid,
            changedFields: ["name", "purpose", ...Object.keys(normalizeDefinitionChange(r))],
          });
          operations.push({
            kind: "UPDATE",
            entityId: eid,
            baseVersion: r.version,
            name: text(r.name),
            ...(normalizePurposeChange(r) ?? {}),
            ...normalizeDefinitionChange(r),
          });
        } else {
          const parent = await s.entity(id(r.parentCircleId), "CIRCLE");
          if (!(await s.can(parent.id, "ADMIN"))) fail(403, "ACTION_DENIED");
          await s.preflightEntityChange({
            operation: "CREATE",
            circleId: parent.id,
          });
          operations.push({
            kind: "CREATE",
            entityId: eid,
            entityKind: kind,
            parentCircleId: parent.id,
            name: text(r.name),
            ...(normalizePurposeChange(r) ?? { purpose: "" }),
            ...normalizeDefinitionChange(r),
          });
        }
      }
      if (new Set(operations.map((o) => o.entityId)).size !== operations.length)
        fail(422, "DUPLICATE_ENTITY_CHANGE");
      return {
        plan: {
          schema: "orgmap-structure-import-plan-v1",
          kind,
          records: records.map((r: any, i) => ({
            ...r,
            id: operations[i].entityId,
          })),
          operations,
        },
        warnings: [
          "Omission does not delete or move entities. Models, fields and membership relations are not imported by this schema.",
        ],
      };
    },
    async applyImport(ctx, plan, importKind) {
      if (ctx.mode === "read") fail(403, "ACTION_DENIED");
      const p = object(plan, ["schema", "kind", "records", "operations"]);
      if (p.schema !== "orgmap-structure-import-plan-v1" || p.kind !== kind)
        fail(422, "IMPORT_SCHEMA_INVALID");
      const adapter = make(kind);
      const validated = await adapter.validateImport!(
        ctx,
        p.records,
        importKind,
      );
      const v = validated.plan as any;
      await createStructurePorts(core, options).applyStructure(ctx, {
        changes: v.operations,
        proposalId: uuid(),
        revision: 1,
      });
      return {
        idMap: Object.fromEntries(
          v.operations.map((x: any) => [x.entityId, x.entityId]),
        ),
      };
    },
  });
  return { circle: make("CIRCLE"), role: make("ROLE") };
}

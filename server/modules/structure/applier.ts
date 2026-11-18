import { createRoleCapacityPort } from "./role-capacity.js";
import type {
  StructurePortsOptions,
  CollectiveOrganizationPolicy,
  LocalCircleAction,
} from "./ports.js";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { fail, id, text, uuid, entity } from "../../src/core.js";
import { object, integer } from "./domain.js";
import {
  normalizePurposeChange,
  readPurposeRow,
  writeEntityPurpose,
} from "./purpose.js";
import { StructureService } from "./service.js";
import { normalizeDefinitionChange, writeEntityDefinition } from "./definition.js";
// Only server composition supplies these ports to the governance application service.
// No browser endpoint accepts approval booleans or proposal claims.
export function createStructurePorts(
  core: ModuleRuntime,
  options: StructurePortsOptions = {},
) {
  const authorizationAudit = new WeakMap<
    Ctx,
    Awaited<ReturnType<StructureService["localCircleAuthorization"]>>[]
  >();
  return {
    ...createRoleCapacityPort(core),
    writeEntityPurpose,
    writeEntityDefinition,
    async applyStructure(
      ctx: Ctx,
      input: {
        changes: unknown[];
        proposalId: string;
        revision: number;
        branchId?: string;
      },
    ) {
      if (ctx.mode === "read") fail(403, "ACTION_DENIED");
      id(input.proposalId);
      integer(input.revision, 1);
      if (
        !Array.isArray(input.changes) ||
        input.changes.length < 1 ||
        input.changes.length > 100
      )
        fail(400, "INVALID_REQUEST");
      const s = new StructureService(ctx, core, undefined, options);
      const originals = (
        await ctx.c.query("SELECT * FROM entities WHERE organization_id=$1", [
          ctx.org.id,
        ])
      ).rows;
      const final = new Map(originals.map((e) => [e.id, { ...e }]));
      const seen = new Set<string>();
      const operations = new Map<string, {kind:string; baseVersion:number}>();
      const paired = new Set<string>();
      for (const raw of input.changes) {
        const p = object(raw, [
          "kind",
          "entityId",
          "baseVersion",
          "entityKind",
          "parentCircleId",
          "name",
          "purpose",
          "purposeRich",
          "responsibilities",
          "artifacts",
        ]);
        if (p.kind !== 'CREATE') await core.governanceModel()?.preflight(ctx,{operation:p.kind,entityId:p.entityId,changedFields:p.kind==='UPDATE'?Object.keys(p):[]});
        id(p.entityId);
        const previous = operations.get(p.entityId);
        if (previous) {
          if (paired.has(p.entityId)) fail(422, "DUPLICATE_ENTITY_CHANGE");
          if (!((previous.kind === "UPDATE" && p.kind === "MOVE") || (previous.kind === "MOVE" && p.kind === "UPDATE"))) fail(422, "DUPLICATE_ENTITY_CHANGE");
          if (previous.baseVersion !== p.baseVersion) fail(409, "VERSION_CONFLICT");
          paired.add(p.entityId);
        } else operations.set(p.entityId, {kind:p.kind, baseVersion:p.baseVersion});
        seen.add(p.entityId);
        if (p.kind === "CREATE") {
          if (final.has(p.entityId)) fail(409, "VERSION_CONFLICT");
          if (!["CIRCLE", "ROLE"].includes(p.entityKind))
            fail(400, "INVALID_REQUEST");
          const purpose = normalizePurposeChange(p) ?? {
            purpose: "",
            purposeRich: null,
          };
          final.set(p.entityId, {
            organization_id: ctx.org.id,
            id: p.entityId,
            node_id: uuid(),
            kind: p.entityKind,
            parent_id: id(p.parentCircleId),
            name: text(p.name),
            purpose: purpose.purpose,
            purpose_rich: purpose.purposeRich,
            responsibilities: [],
            artifacts: [],
            ...normalizeDefinitionChange(p),
            archived: false,
            version: 1,
          });
          continue;
        }
        const e = final.get(p.entityId);
        if (!e) fail(404, "RESOURCE_NOT_FOUND");
        const original = originals.find((row) => row.id === p.entityId);
        if (!original || integer(p.baseVersion, 1) !== original.version)
          fail(409, "VERSION_CONFLICT");
        switch (p.kind) {
          case "UPDATE":
            Object.assign(e, normalizeDefinitionChange(p));
            if (p.name !== undefined) e.name = text(p.name);
            const purpose = normalizePurposeChange(p);
            if (purpose) {
              e.purpose = purpose.purpose;
              e.purpose_rich = purpose.purposeRich;
            }
            break;
          case "MOVE":
            if (!e.parent_id) fail(422, "ROOT_PROTECTED");
            e.parent_id = id(p.parentCircleId);
            break;
          case "ARCHIVE":
            if (!e.parent_id) fail(422, "ROOT_PROTECTED");
            e.archived = true;
            break;
          case "RESTORE":
            e.archived = false;
            break;
          default:
            fail(400, "INVALID_REQUEST");
        }
        e.version = original.version + 1;
      }
      for (const e of final.values()) {
        if (e.parent_id) {
          const parent = final.get(e.parent_id);
          if (
            !parent ||
            parent.kind !== "CIRCLE" ||
            (!e.archived && parent.archived)
          )
            fail(422, "INVALID_PARENT");
          const visited = new Set([e.id]);
          let p = parent;
          while (p) {
            if (visited.has(p.id)) fail(422, "STRUCTURE_CYCLE");
            visited.add(p.id);
            p = final.get(p.parent_id);
          }
        } else if (e.kind !== "CIRCLE" || e.archived)
          fail(422, "ROOT_PROTECTED");
      }
      for (const eid of seen) {
        const e = final.get(eid)!;
        const old = originals.find((x) => x.id === eid);
        if (e.archived && !old?.archived) {
          const at = await s.clock();
          const active = await ctx.c.query(
            `SELECT 1 FROM occupancies WHERE organization_id=$1 AND role_id=$2 AND starts_at<=$3 AND (ends_at IS NULL OR ends_at>$3) UNION ALL SELECT 1 FROM structure_mandates WHERE organization_id=$1 AND role_id=$2 AND starts_at<=$3 AND (ends_at IS NULL OR ends_at>$3) AND (ended_at IS NULL OR ended_at>$3) UNION ALL SELECT 1 FROM circle_memberships WHERE organization_id=$1 AND circle_id=$2 AND starts_at<=$3 AND (ends_at IS NULL OR ends_at>$3)`,
            [ctx.org.id, eid, at],
          );
          if (active.rowCount) fail(409, "STATE_CONFLICT");
        }
      }
      // Insert/create/move in parent-first order so foundation parent-kind trigger sees valid parents.
      const pending = new Set(seen);
      while (pending.size) {
        let advanced = false;
        for (const eid of pending) {
          const e = final.get(eid)!;
          if (e.archived) {
            if (
              [...pending].some(
                (childId) => final.get(childId)?.parent_id === eid,
              )
            )
              continue;
          } else if (e.parent_id && pending.has(e.parent_id)) continue;
          const before = originals.find((x) => x.id === eid);
          if (!before)
            await ctx.c.query(
              "INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name,purpose,archived,version,purpose_rich) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
              [
                ctx.org.id,
                e.id,
                e.node_id,
                e.kind,
                e.parent_id,
                e.name,
                e.purpose,
                e.archived,
                e.version,
                e.purpose_rich === null ? null : JSON.stringify(e.purpose_rich),
              ],
            );
          else
            await ctx.c.query(
              "UPDATE entities SET parent_id=$3,name=$4,purpose=$5,archived=$6,version=$7,purpose_rich=$8 WHERE organization_id=$1 AND id=$2",
              [
                ctx.org.id,
                e.id,
                e.parent_id,
                e.name,
                e.purpose,
                e.archived,
                e.version,
                e.purpose_rich === null ? null : JSON.stringify(e.purpose_rich),
              ],
            );
          await writeEntityDefinition(ctx, {
            entityId: eid, entityVersion: e.version,
            responsibilities: e.responsibilities, artifacts: e.artifacts,
          });
          await s.history(eid, "StructureChangeSetApplied", before, e);
          if (!before && e.kind === "CIRCLE") await s.circleCreated(eid);
          pending.delete(eid);
          advanced = true;
        }
        if (!advanced) fail(422, "STRUCTURE_CYCLE");
      }
      return {
        entityIds: [...seen],
        proposalId: input.proposalId,
        revision: input.revision,
      };
    },
    async applyElection(
      ctx: Ctx,
      input: {
        proposalId: string;
        revision: number;
        roleId: string;
        winnerId: string;
        mandateEnd: string;
      },
    ) {
      const s = new StructureService(ctx, core, undefined, options);
      const f = await s.roleFlags(input.roleId);
      const model=await core.governanceModel()?.state(ctx);
      if (!model && !f.electable) fail(422, "ROLE_NOT_ELECTABLE");
      const role=await s.entity(input.roleId,'ROLE');
      await core.governanceModel()?.validateElection(ctx,{circleId:role.parent_id,roleId:role.id,winnerId:input.winnerId,mandateEnd:input.mandateEnd});
      id(input.proposalId);
      integer(input.revision, 1);
      return s.mandate(
        {
          roleId: input.roleId,
          memberId: input.winnerId,
          kind: "ELECTED",
          startsAt: (await s.clock()).toISOString(),
          endsAt: input.mandateEnd,
          scope: "",
        },
        { proposalId: input.proposalId, revision: input.revision },
      );
    },
    async applyField(
      ctx: Ctx,
      input: {
        entityId: string;
        fieldId: string;
        value: unknown;
        baseVersion: number;
      },
    ) {
      return new StructureService(ctx, core, undefined, options).setValue(
        id(input.entityId),
        id(input.fieldId),
        input.value,
        integer(input.baseVersion),
        true,
      );
    },
    async isLeadLink(ctx: Ctx, input: { circleId: string; memberId: string }) {
      return new StructureService(ctx, core, undefined, options).isLeadLink(
        input,
      );
    },
    async readStructureEntity(
      ctx: Ctx,
      entityId: string,
      kind?: "CIRCLE" | "ROLE",
    ) {
      const row = await new StructureService(
        ctx,
        core,
        undefined,
        options,
      ).readableEntity(entityId, kind);
      return { ...entity(row), ...readPurposeRow(row) };
    },
    async structureForest(
      ctx: Ctx,
      input: { rootCircleId?: string; depth?: number } = {},
    ) {
      return new StructureService(
        ctx,
        core,
        undefined,
        options,
      ).structureForest(input);
    },
    async organizationPolicy(ctx: Ctx) {
      return new StructureService(
        ctx,
        core,
        undefined,
        options,
      ).organizationPolicy();
    },
    async validateOrganizationPolicyChange(
      ctx: Ctx,
      next: CollectiveOrganizationPolicy,
    ) {
      return new StructureService(
        ctx,
        core,
        undefined,
        options,
      ).validateOrganizationPolicyChange(next);
    },
    async authorizeLocalCircle(
      ctx: Ctx,
      circleId: string,
      action: LocalCircleAction,
    ) {
      const decision = await new StructureService(
        ctx,
        core,
        undefined,
        options,
      ).localCircleAuthorization(circleId, action);
      if (decision.source === "COLLECTIVE")
        authorizationAudit.set(ctx, [
          ...(authorizationAudit.get(ctx) ?? []),
          decision,
        ]);
      return decision.allowed;
    },
    async circleScope(
      ctx: Ctx,
      input: { circleId: string; includeSubcircles: boolean },
    ) {
      return new StructureService(ctx, core, undefined, options).circleScope(
        input,
      );
    },
    async resolveMeetingRoster(
      ctx: Ctx,
      input: {
        circleId: string;
        includeSubcircles: boolean;
        roleIds: string[];
      },
    ) {
      const s = new StructureService(ctx, core, undefined, options);
      await s.entity(id(input.circleId), "CIRCLE");
      if (
        typeof input.includeSubcircles !== "boolean" ||
        !Array.isArray(input.roleIds) ||
        input.roleIds.length > 100
      )
        fail(400, "INVALID_REQUEST");
      for (const rid of input.roleIds) await s.entity(id(rid), "ROLE");
      const circles = new Set(await s.circleScope(input));
      const members = (
        await ctx.c.query(
          "SELECT id FROM members WHERE organization_id=$1 AND status='ACTIVE' AND member_type='MEMBER'",
          [s.org],
        )
      ).rows;
      const result: {
        memberId: string;
        origin: "CIRCLE" | "ROLE" | "UMBRELLA";
        participationRole: "REQUIRED" | "OPTIONAL";
        access: "READ" | "EDIT";
      }[] = [];
      for (const member of members) {
        const reasons = await s.reasons(member.id);
        const matches = reasons.reasons.filter(
          (r) =>
            (r.capability === "MEMBER" && circles.has(r.circleId)) ||
            (r.roleId &&
              input.roleIds.includes(r.roleId) &&
              r.capability === "MEMBER"),
        );
        const seen = new Set<string>();
        for (const reason of matches) {
          const origin: "CIRCLE" | "ROLE" | "UMBRELLA" =
            reason.roleId && input.roleIds.includes(reason.roleId)
              ? "ROLE"
              : reason.circleId === input.circleId
                ? "CIRCLE"
                : "UMBRELLA";
          if (seen.has(origin)) continue;
          seen.add(origin);
          result.push({
            memberId: member.id,
            origin,
            participationRole: "OPTIONAL",
            access: "READ",
          });
        }
      }
      return result;
    },
    async preflightEntityChange(
      ctx: Ctx,
      input: {
        operation: "CREATE" | "UPDATE" | "MOVE" | "ARCHIVE";
        entityId?: string;
        circleId?: string;
        targetCircleId?: string;
        changedFields?: string[];
      },
    ) {
      return new StructureService(
        ctx,
        core,
        undefined,
        options,
      ).preflightEntityChange(input);
    },
    async recordFoundationChange(
      ctx: Ctx,
      input: {
        resourceId: string;
        action: string;
        before: unknown;
        after: unknown;
      },
    ) {
      await new StructureService(
        ctx,
        core,
        undefined,
        options,
      ).recordFoundationChange(input);
      const decisions = authorizationAudit.get(ctx) ?? [];
      authorizationAudit.delete(ctx);
      for (const decision of decisions) {
        await ctx.c.query(
          "INSERT INTO structure_history(organization_id,id,resource_id,action,before_value,after_value,actor_id) VALUES($1,$2,$3,$4,NULL,$5,$6)",
          [
            ctx.org.id,
            uuid(),
            input.resourceId,
            "CollectiveActionAuthorized",
            JSON.stringify(decision),
            ctx.member.id,
          ],
        );
      }
    },
    async validateOccupancy(
      ctx: Ctx,
      input: { roleId: string; memberId?:string; kind: string; startsAt?:string;endsAt?: string | null },
    ) {
      return new StructureService(
        ctx,
        core,
        undefined,
        options,
      ).validateOccupancy(input);
    },
    async membershipReasons(ctx: Ctx, memberId: string) {
      return new StructureService(ctx, core, undefined, options).reasons(
        id(memberId),
      );
    },
    async authorizeCircle(
      ctx: Ctx,
      circleId: string,
      action: "ADMIN" | "ASSIGN" | "RECORD" | "DECISION",
    ) {
      return new StructureService(ctx, core, undefined, options).can(
        id(circleId),
        action,
      );
    },
  };
}

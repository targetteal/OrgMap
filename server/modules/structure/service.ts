import { indicatorDefinition } from "./indicator-definition.js";
import {
  authorizeMemberIndicator,
  resolveIndicatorSubject,
  storedIndicatorSubject,
  indicatorSubjectId,
} from "./indicator-subject.js";
import type {
  IndicatorSubject,
  MemberIndicatorAction,
} from "./profile-capacity-contract.js";
import { normalizePurposeChange, readPurposeRow } from "./purpose.js";
import {
  defaultCollectivePolicy,
  collectiveLocalActions,
  type StructurePortsOptions,
  type CollectiveOrganizationPolicy,
  type LocalCircleAction,
} from "./ports.js";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type { FastifyRequest } from "fastify";
import type { NotificationContext, NotificationDetailKey, NotificationEvent } from "../../../packages/contracts/notifications.js";
import {
  fail,
  id,
  text,
  optionalText,
  uuid,
  camel,
  event,
} from "../../src/core.js";
import {
  flags,
  defaultFlags,
  fieldSchema,
  fieldValue,
  object,
  timestamp,
  integer,
  viewConfig,
  initialView,
  type Flags,
  type ViewConfig,
} from "./domain.js";
export class StructureService {
  constructor(
    public ctx: Ctx,
    public core: ModuleRuntime,
    public request?: FastifyRequest,
    public options: StructurePortsOptions = {},
  ) {}
  assertWrite() {
    if (this.ctx.mode === "read") fail(403, "ACTION_DENIED");
  }
  get org() {
    return this.ctx.org.id as string;
  }
  isGuest() {
    return this.ctx.member.member_type === "GUEST";
  }
  async structureRows() {
    if (!this.isGuest())
      return (
        await this.ctx.c.query(
          "SELECT * FROM entities WHERE organization_id=$1 AND NOT archived ORDER BY name,id",
          [this.org],
        )
      ).rows;
    if (this.ctx.member.status !== "ACTIVE") return [];
    const scope = this.options.guestStructureScope
      ? await this.options.guestStructureScope(this.ctx)
      : {
          roots: [],
          authorizationRevision: this.ctx.org.authorization_revision,
        };
    const refs = scope.roots.filter(
      (r) => r.context === "structure" && ["circle", "role"].includes(r.kind),
    );
    if (!refs.length) return [];
    const ids = [...new Set(refs.map((r) => id(r.id)))];
    const rows = (
      await this.ctx.c.query(
        "SELECT * FROM entities WHERE organization_id=$1 AND NOT archived AND id=ANY($2::uuid[]) ORDER BY name,id",
        [this.org, ids],
      )
    ).rows.filter((e) =>
      refs.some((r) => r.id === e.id && r.kind === e.kind.toLowerCase()),
    );
    const visible = new Set(rows.map((r) => r.id));
    return rows.map((e) => ({
      ...e,
      parent_id: visible.has(e.parent_id) ? e.parent_id : null,
      path_redacted: !!e.parent_id && !visible.has(e.parent_id),
    }));
  }
  async readableEntity(eid: string, kind?: string) {
    if (!this.isGuest()) return this.entity(eid, kind);
    const row = (await this.structureRows()).find(
      (e) => e.id === id(eid) && (!kind || e.kind === kind),
    );
    if (!row) fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  async one(table: string, key: string, value: string) {
    const row = (
      await this.ctx.c.query(
        `SELECT * FROM ${table} WHERE organization_id=$1 AND ${key}=$2`,
        [this.org, id(value)],
      )
    ).rows[0];
    if (!row) fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  async entity(eid: string, kind?: string) {
    return this.core.get(this.ctx.c, this.org, id(eid), kind);
  }
  async member(mid: string) {
    const m = await this.one("members", "id", mid);
    if (m.status !== "ACTIVE") fail(422, "MEMBER_INACTIVE");
    return m;
  }
  async clock() {
    return (await this.ctx.c.query("SELECT clock_timestamp() AS at")).rows[0]
      .at as Date;
  }
  async history(
    resource: string,
    action: string,
    before: unknown,
    after: unknown,
    structure = true,
    indicatorSubjectKind?: IndicatorSubject["kind"],
  ) {
    this.assertWrite();
    const historyId = uuid();
    await this.ctx.c.query(
      "INSERT INTO structure_history(organization_id,id,resource_id,action,before_value,after_value,actor_id,indicator_subject_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        this.org,
        historyId,
        resource,
        action,
        before === undefined ? null : JSON.stringify(before),
        after === undefined ? null : JSON.stringify(after),
        this.ctx.member.id,
        indicatorSubjectKind ?? null,
      ],
    );
    await this.core.governanceModel()?.recordStructureChange(this.ctx,{resourceId:resource,action,before,after});
    if (this.request)
      await this.core.changed(
        this.ctx,
        this.request,
        resource,
        action,
        structure,
      );
    else {
      await this.ctx.c.query(
        `UPDATE organizations SET authorization_revision=authorization_revision+1${structure ? ",structure_revision=structure_revision+1" : ""} WHERE id=$1`,
        [this.org],
      );
      await event(
        this.ctx.c,
        this.org,
        this.ctx.account.id,
        resource,
        action,
        "structure-port",
      );
    }
    await this.notifyChange(historyId, action, before, after);
  }
  /** Both foundation commands and governance appliers report through this domain port. */
  private async notifyChange(eventId: string, action: string, beforeValue: unknown, afterValue: unknown) {
    const before = beforeValue as any, after = afterValue as any;
    let notification: NotificationEvent | undefined, entityId: string | undefined;
    let recipients: string[] = [];
    const details: NonNullable<NotificationContext["details"]> = [];
    const detail = (key: NotificationDetailKey, value: unknown) => {
      if (value === null || value === undefined || value === "") return;
      details.push({ key, value: (value instanceof Date ? value.toISOString() : String(value)).slice(0, 2000) });
    };
    const instant = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();
    if (action === "RoleOccupied" && !before && after?.role_id && after?.member_id) {
      notification = "RoleAssigned"; entityId = after.role_id; recipients = [after.member_id];
    } else if (action === "RoleOccupancyEnded" && before?.role_id && after?.member_id) {
      if (instant(before.ended_at ?? before.ends_at) === instant(after.ended_at ?? after.ends_at)) return;
      notification = "RoleUnassigned"; entityId = before.role_id; recipients = [after.member_id];
    } else if (action === "CircleMemberAssociated" && !before && after?.circle_id && after?.member_id) {
      notification = "CircleAssigned"; entityId = after.circle_id; recipients = [after.member_id];
    } else if (action === "CircleMembershipEnded" && before?.circle_id && after?.member_id) {
      if (instant(before.ends_at) === instant(after.ends_at)) return;
      notification = "CircleUnassigned"; entityId = before.circle_id; recipients = [after.member_id];
    } else if (before?.kind === "ROLE" && after?.kind === "ROLE" && !before.archived && !after.archived &&
      ["StructureEntityUpdated", "StructureChangeSetApplied", "StructureEntityMoved"].includes(action)) {
      const changed = ["name", "parent_id", "purpose", "purpose_rich", "responsibilities", "artifacts"]
        .some(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
      if (!changed) return;
      notification = "RoleScopeUpdated"; entityId = after.id;
      recipients = (await this.ctx.c.query(
        `SELECT DISTINCT member_id FROM (
          SELECT member_id,starts_at,ends_at,NULL::timestamptz AS ended_at FROM occupancies WHERE organization_id=$1 AND role_id=$2
          UNION ALL SELECT member_id,starts_at,ends_at,ended_at FROM structure_mandates WHERE organization_id=$1 AND role_id=$2
        ) occupations WHERE starts_at<=clock_timestamp() AND (ends_at IS NULL OR ends_at>clock_timestamp()) AND (ended_at IS NULL OR ended_at>clock_timestamp())`,
        [this.org, entityId],
      )).rows.map(row => row.member_id);
      const definition = (value: any) => [value.purpose,
        ...(Array.isArray(value.responsibilities) ? value.responsibilities.map((item: any) => item.text) : []),
        ...(Array.isArray(value.artifacts) ? value.artifacts.map((item: any) => item.text) : []),
      ].filter(Boolean).join("\n");
      detail("previousScope", definition(before)); detail("scope", definition(after));
    }
    if (!notification || !entityId || !recipients.length) return;
    const resource = await this.entity(entityId);
    if (resource.archived) return;
    const active = (await this.ctx.c.query(
      "SELECT m.id,a.display_name FROM members m JOIN accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND m.status='ACTIVE'",
      [this.org, recipients],
    )).rows;
    if (!active.length) return;
    detail(resource.kind === "ROLE" ? "role" : "circle", resource.name);
    if (resource.kind === "ROLE" && resource.parent_id) detail("circle", (await this.entity(resource.parent_id, "CIRCLE")).name);
    if (notification !== "RoleScopeUpdated") {
      detail("person", active[0].display_name);
      detail("scope", after.scope);
      detail("startsAt", after.starts_at);
      detail("endsAt", after.ended_at ?? after.ends_at);
    }
    await this.core.publishNotification(this.ctx, {
      eventId, event: notification, ref: { type: resource.kind === "ROLE" ? "role" : "circle", id: resource.id },
      recipients: active.map(member => ({ memberId: member.id, nominal: true })),
      context: { resourceTitle: resource.name, details },
    });
  }
  async circleScope(input: { circleId: string; includeSubcircles: boolean }) {
    await this.entity(id(input.circleId), "CIRCLE");
    if (typeof input.includeSubcircles !== "boolean")
      fail(400, "INVALID_REQUEST");
    if (this.ctx.member.status !== "ACTIVE") fail(403, "ACTION_DENIED");
    if (!input.includeSubcircles) return [input.circleId];
    return (
      await this.ctx.c.query(
        `WITH RECURSIVE subtree AS (SELECT id FROM entities WHERE organization_id=$1 AND id=$2 AND NOT archived UNION ALL SELECT e.id FROM entities e JOIN subtree p ON e.parent_id=p.id WHERE e.organization_id=$1 AND e.kind='CIRCLE' AND NOT e.archived) SELECT id FROM subtree`,
        [this.org, input.circleId],
      )
    ).rows.map((r) => r.id as string);
  }
  async roleFlags(rid: string): Promise<Flags> {
    await this.entity(rid, "ROLE");
    const row = (
      await this.ctx.c.query(
        "SELECT flags FROM structure_role_settings WHERE organization_id=$1 AND role_id=$2",
        [this.org, rid],
      )
    ).rows[0];
    return row?.flags ?? defaultFlags;
  }
  async reasons(mid: string, legacyAuthority = false) {
    await this.member(mid);
    const modeled = legacyAuthority ? null : await this.core.governanceModel()?.reasons(this.ctx, mid);
    if (modeled) return modeled;
    const at = await this.clock();
    const explicit = (
      await this.ctx.c.query(
        `SELECT cm.id,cm.circle_id FROM circle_memberships cm JOIN entities e ON e.organization_id=cm.organization_id AND e.id=cm.circle_id WHERE cm.organization_id=$1 AND cm.member_id=$2 AND cm.starts_at<=$3 AND (cm.ends_at IS NULL OR cm.ends_at>$3) AND NOT e.archived`,
        [this.org, mid, at],
      )
    ).rows.map((r) => ({
      circleId: r.circle_id,
      sourceId: r.id,
      source: "EXPLICIT",
      capability: "MEMBER",
    }));
    const occupations = (
      await this.ctx.c.query(
        `SELECT o.id,o.role_id,e.parent_id,rs.flags FROM (SELECT id,organization_id,member_id,role_id,starts_at,ends_at,NULL::timestamptz ended_at FROM occupancies UNION ALL SELECT id,organization_id,member_id,role_id,starts_at,ends_at,ended_at FROM structure_mandates) o JOIN entities e ON e.organization_id=o.organization_id AND e.id=o.role_id LEFT JOIN structure_role_settings rs ON rs.organization_id=e.organization_id AND rs.role_id=e.id JOIN entities p ON p.organization_id=e.organization_id AND p.id=e.parent_id WHERE o.organization_id=$1 AND o.member_id=$2 AND o.starts_at<=$3 AND (o.ends_at IS NULL OR o.ends_at>$3) AND (o.ended_at IS NULL OR o.ended_at>$3) AND NOT e.archived AND NOT p.archived`,
        [this.org, mid, at],
      )
    ).rows;
    const result: any[] = [...explicit];
    for (const o of occupations) {
      const f = o.flags ?? defaultFlags;
      result.push({
        circleId: o.parent_id,
        roleId: o.role_id,
        sourceId: o.id,
        source: "OCCUPANCY",
        capability: "MEMBER",
      });
      for (const [flag, capability] of [
        ["core", "DECISION"],
        ["assigner", "ASSIGN"],
        ["admin", "ADMIN"],
      ] as const)
        if (f[flag])
          result.push({
            circleId: o.parent_id,
            roleId: o.role_id,
            sourceId: o.id,
            source: "ROLE_FLAG",
            capability,
          });
      if (f.representative) {
        const p = await this.entity(o.parent_id, "CIRCLE");
        if (p.parent_id)
          result.push({
            circleId: p.parent_id,
            roleId: o.role_id,
            sourceId: o.id,
            source: "REPRESENTATIVE",
            capability: "DECISION",
          });
      }
    }
    return {
      memberId: mid,
      asOf: at.toISOString(),
      reasons: result,
      circles: [...new Set(result.map((r) => r.circleId))],
    };
  }
  async can(
    circleId: string,
    action: "ADMIN" | "ASSIGN" | "RECORD" | "DECISION",
  ) {
    await this.entity(circleId, "CIRCLE");
    const modeled = await this.core.governanceModel()?.authorizeCircle(this.ctx, circleId, action);
    if (typeof modeled === 'boolean') return modeled;
    if (this.isGuest() || this.ctx.member.status !== "ACTIVE") return false;
    if (this.ctx.member.org_role === "OWNER") return true;
    const r = await this.reasons(this.ctx.member.id, action === 'ASSIGN' || action === 'ADMIN' || action === 'RECORD');
    return r.reasons.some(
      (x) =>
        x.circleId === circleId &&
        (x.capability === action ||
          (action === "RECORD" && x.capability === "MEMBER") ||
          (action === "ASSIGN" && x.capability === "ADMIN")),
    );
  }
  async canEntity(eid: string, action: "ADMIN" | "ASSIGN" | "RECORD") {
    const e = await this.entity(eid);
    return this.can(e.kind === "CIRCLE" ? e.id : e.parent_id, action);
  }

  validateCollectivePolicy(value: CollectiveOrganizationPolicy) {
    if (
      !value ||
      typeof value.enabled !== "boolean" ||
      typeof value.allowCircleOverride !== "boolean" ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0
    )
      fail(503, "INVALID_ORGANIZATION_POLICY_PORT");
    return value;
  }
  async organizationPolicy() {
    return this.validateCollectivePolicy(
      this.options.organizationPolicy
        ? await this.options.organizationPolicy(this.ctx)
        : { ...defaultCollectivePolicy },
    );
  }
  async validateOrganizationPolicyChange(next: CollectiveOrganizationPolicy) {
    this.assertWrite();
    this.validateCollectivePolicy(next);
    const rows = (
      await this.ctx.c.query(
        "SELECT p.circle_id FROM structure_collective_policies p JOIN entities e ON e.organization_id=p.organization_id AND e.id=p.circle_id WHERE p.organization_id=$1 AND p.enabled IS NOT NULL AND NOT e.archived",
        [this.org],
      )
    ).rows;
    if (!next.allowCircleOverride && rows.length)
      fail(409, "CIRCLE_POLICY_RECONCILIATION_REQUIRED");
    return { valid: true, overrideCount: rows.length };
  }
  async collectivePolicy(circleId: string) {
    await this.entity(circleId, "CIRCLE");
    const org = await this.organizationPolicy();
    const local = (
      await this.ctx.c.query(
        "SELECT * FROM structure_collective_policies WHERE organization_id=$1 AND circle_id=$2",
        [this.org, circleId],
      )
    ).rows[0];
    return {
      circleId,
      enabled:
        org.allowCircleOverride &&
        local?.enabled !== null &&
        local?.enabled !== undefined
          ? local.enabled
          : org.enabled,
      override: local?.enabled ?? null,
      version: local?.version ?? 0,
      organizationPolicy: org,
      source:
        org.allowCircleOverride &&
        local?.enabled !== null &&
        local?.enabled !== undefined
          ? "CIRCLE_OVERRIDE"
          : "ORGANIZATION_DEFAULT",
    };
  }
  async hasCurrentAdministrator(circleId: string) {
    const at = await this.clock();
    return !!(
      await this.ctx.c.query(
        `SELECT 1 FROM (SELECT organization_id,role_id,member_id,starts_at,ends_at,NULL::timestamptz ended_at FROM occupancies UNION ALL SELECT organization_id,role_id,member_id,starts_at,ends_at,ended_at FROM structure_mandates) o JOIN entities r ON r.organization_id=o.organization_id AND r.id=o.role_id JOIN structure_role_settings f ON f.organization_id=r.organization_id AND f.role_id=r.id JOIN members m ON m.organization_id=o.organization_id AND m.id=o.member_id WHERE o.organization_id=$1 AND r.parent_id=$2 AND NOT r.archived AND m.status='ACTIVE' AND (f.flags->>'admin')::boolean=true AND o.starts_at<=$3 AND (o.ends_at IS NULL OR o.ends_at>$3) AND (o.ended_at IS NULL OR o.ended_at>$3) LIMIT 1`,
        [this.org, circleId, at],
      )
    ).rowCount;
  }
  async localCircleAuthorization(circleId: string, action: LocalCircleAction) {
    await this.entity(circleId, "CIRCLE");
    const denied = {
      allowed: false,
      source: "DENIED",
      circleId,
      action,
      organizationRevision: 0,
      circleRevision: 0,
    };
    if (
      !collectiveLocalActions.includes(action) ||
      this.isGuest() ||
      this.ctx.member.status !== "ACTIVE"
    )
      return denied;
    const model=await this.core.governanceModel()?.state(this.ctx);
    if(action==='CIRCLE_CONTENT_EDIT'&&model?.phase==='OPERATING'&&model.rules.structureChanges==='GOVERNANCE')return denied;
    if (this.ctx.member.org_role === "OWNER")
      return { ...denied, allowed: true, source: "OWNER" };
    const reasons = await this.reasons(this.ctx.member.id);
    if (
      reasons.reasons.some(
        (r) => r.circleId === circleId && r.capability === "ADMIN",
      )
    )
      return { ...denied, allowed: true, source: "CIRCLE_ADMIN" };
    const policy = await this.collectivePolicy(circleId);
    if (!policy.enabled || (await this.hasCurrentAdministrator(circleId)))
      return denied;
    if (
      !reasons.reasons.some(
        (r) => r.circleId === circleId && r.capability === "MEMBER",
      )
    )
      return denied;
    return {
      ...denied,
      allowed: true,
      source: "COLLECTIVE",
      organizationRevision: policy.organizationPolicy.revision,
      circleRevision: policy.version,
    };
  }
  async authorizeLocalCircle(circleId: string, action: LocalCircleAction) {
    return (await this.localCircleAuthorization(circleId, action)).allowed;
  }
  async configureCollective(
    circleId: string,
    input: unknown,
    expected: number,
  ) {
    this.assertWrite();
    const p = object(input, ["enabled"]);
    if (p.enabled !== null && typeof p.enabled !== "boolean")
      fail(400, "INVALID_REQUEST");
    const current = await this.collectivePolicy(circleId);
    if (current.version !== expected) fail(409, "VERSION_CONFLICT");
    if (p.enabled !== null && !current.organizationPolicy.allowCircleOverride)
      fail(422, "CIRCLE_OVERRIDE_DENIED");
    // The collective fallback must never activate, disable or otherwise manage itself.
    if (!(await this.can(circleId, "ADMIN"))) fail(403, "ACTION_DENIED");
    const actingAs = {
      source: this.ctx.member.org_role === "OWNER" ? "OWNER" : "CIRCLE_ADMIN",
      action: "COLLECTIVE_POLICY_CONFIGURE",
    };
    const before = (
      await this.ctx.c.query(
        "SELECT * FROM structure_collective_policies WHERE organization_id=$1 AND circle_id=$2",
        [this.org, circleId],
      )
    ).rows[0];
    await this.ctx.c.query(
      "INSERT INTO structure_collective_policies(organization_id,circle_id,enabled) VALUES($1,$2,$3) ON CONFLICT(organization_id,circle_id) DO UPDATE SET enabled=excluded.enabled,version=structure_collective_policies.version+1",
      [this.org, circleId, p.enabled],
    );
    const result = await this.collectivePolicy(circleId);
    await this.history(
      circleId,
      "CircleCollectivePolicyConfigured",
      before,
      { ...result, actingAs },
      false,
    );
    return result;
  }
  async circleDisplay(circleId: string) {
    await this.entity(circleId, "CIRCLE");
    const row = (
      await this.ctx.c.query(
        "SELECT labels,avatars,minimap,version FROM structure_circle_display WHERE organization_id=$1 AND circle_id=$2",
        [this.org, circleId],
      )
    ).rows[0];
    return {
      circleId,
      preferences: row
        ? { labels: row.labels, avatars: row.avatars, minimap: row.minimap }
        : { labels: true, avatars: true, minimap: true },
      version: row?.version ?? 0,
    };
  }
  async configureCircleDisplay(
    circleId: string,
    input: unknown,
    expected: number,
  ) {
    this.assertWrite();
    const p = object(input, ["labels", "avatars", "minimap"]);
    if (
      ["labels", "avatars", "minimap"].some(
        (key) => typeof p[key] !== "boolean",
      )
    )
      fail(400, "INVALID_REQUEST");
    const actingAs = await this.localCircleAuthorization(
      circleId,
      "CIRCLE_LOCAL_CONFIGURATION",
    );
    if (!actingAs.allowed) fail(403, "ACTION_DENIED");
    const before = await this.circleDisplay(circleId);
    if (before.version !== expected) fail(409, "VERSION_CONFLICT");
    await this.ctx.c.query(
      "INSERT INTO structure_circle_display(organization_id,circle_id,labels,avatars,minimap) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,circle_id) DO UPDATE SET labels=excluded.labels,avatars=excluded.avatars,minimap=excluded.minimap,version=structure_circle_display.version+1",
      [this.org, circleId, p.labels, p.avatars, p.minimap],
    );
    const out = await this.circleDisplay(circleId);
    await this.history(
      circleId,
      "CircleDisplayPreferencesChanged",
      before,
      { ...out, actingAs },
      false,
    );
    return out;
  }
  async circleCreated(circleId: string, requestId?: string) {
    this.assertWrite();
    await this.entity(circleId, "CIRCLE");
    const result = (
      await this.ctx.c.query(
        `INSERT INTO structure_circle_creations(organization_id,circle_id,event_id,request_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,circle_id) DO NOTHING RETURNING *,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at_iso`,
        [this.org, circleId, uuid(), requestId ?? this.request?.id ?? null],
      )
    ).rows[0];
    if (!result) return;
    await this.ctx.c.query(
      "INSERT INTO domain_events(organization_id,id,action,resource_id,at) SELECT organization_id,event_id,'StructureCircleCreated',circle_id,occurred_at FROM structure_circle_creations WHERE organization_id=$1 AND circle_id=$2",
      [this.org, circleId],
    );
    await this.ctx.c.query(
      "INSERT INTO outbox(organization_id,id,event_id) VALUES($1,$2,$3)",
      [this.org, uuid(), result.event_id],
    );
    await this.options.onCircleCreated?.(this.ctx, {
      circleId,
      eventId: result.event_id,
      occurredAt: result.occurred_at_iso,
      ...(result.request_id ? { requestId: result.request_id } : {}),
    });
  }
  async roleFunction(roleId: string) {
    await this.entity(roleId, "ROLE");
    const row = (
      await this.ctx.c.query(
        "SELECT function_code,version FROM structure_role_functions WHERE organization_id=$1 AND role_id=$2",
        [this.org, roleId],
      )
    ).rows[0];
    return {
      roleId,
      functionCode: row?.function_code ?? null,
      version: row?.version ?? 0,
    };
  }
  async setRoleFunction(roleId: string, input: unknown, expected: number) {
    this.assertWrite();
    if (this.isGuest() || this.ctx.member.org_role !== "OWNER")
      fail(403, "ACTION_DENIED");
    const p = object(input, ["functionCode"]);
    if (p.functionCode !== null && p.functionCode !== "LEAD_LINK")
      fail(400, "INVALID_REQUEST");
    const before = await this.roleFunction(roleId);
    if (before.version !== expected) fail(409, "VERSION_CONFLICT");
    await this.ctx.c.query(
      "INSERT INTO structure_role_functions(organization_id,role_id,function_code) VALUES($1,$2,$3) ON CONFLICT(organization_id,role_id) DO UPDATE SET function_code=excluded.function_code,version=structure_role_functions.version+1",
      [this.org, roleId, p.functionCode],
    );
    const out = await this.roleFunction(roleId);
    await this.history(
      roleId,
      "CanonicalRoleFunctionConfigured",
      before,
      out,
      false,
    );
    return out;
  }
  async isLeadLink(input: { circleId: string; memberId: string }) {
    await this.entity(id(input.circleId), "CIRCLE");
    const at = await this.clock();
    return !!(
      await this.ctx.c.query(
        `SELECT 1 FROM (SELECT organization_id,role_id,member_id,starts_at,ends_at,NULL::timestamptz ended_at FROM occupancies UNION ALL SELECT organization_id,role_id,member_id,starts_at,ends_at,ended_at FROM structure_mandates) o JOIN entities r ON r.organization_id=o.organization_id AND r.id=o.role_id JOIN structure_role_functions f ON f.organization_id=r.organization_id AND f.role_id=r.id JOIN members m ON m.organization_id=o.organization_id AND m.id=o.member_id WHERE o.organization_id=$1 AND o.member_id=$2 AND r.parent_id=$3 AND r.kind='ROLE' AND NOT r.archived AND f.function_code='LEAD_LINK' AND m.status='ACTIVE' AND coalesce(to_jsonb(m)->>'member_type','MEMBER')='MEMBER' AND o.starts_at<=$4 AND (o.ends_at IS NULL OR o.ends_at>$4) AND (o.ended_at IS NULL OR o.ended_at>$4) LIMIT 1`,
        [this.org, id(input.memberId), input.circleId, at],
      )
    ).rowCount;
  }
  async template(input: unknown, existing?: any) {
    this.assertWrite();
    const p = object(input, ["name", "flags", "purpose", "purposeRich"]);
    const purpose =
      normalizePurposeChange(p) ??
      (existing
        ? readPurposeRow(existing)
        : { purpose: "", purposeRich: null });
    const f = flags(p.flags),
      name = text(p.name);
    const tid = existing?.id ?? uuid();
    if (existing)
      await this.ctx.c.query(
        "UPDATE structure_templates SET name=$3,flags=$4,purpose=$5,purpose_rich=$6,version=version+1 WHERE organization_id=$1 AND id=$2",
        [
          this.org,
          tid,
          name,
          f,
          purpose.purpose,
          purpose.purposeRich === null
            ? null
            : JSON.stringify(purpose.purposeRich),
        ],
      );
    else
      await this.ctx.c.query(
        "INSERT INTO structure_templates(organization_id,id,name,flags,purpose,purpose_rich) VALUES($1,$2,$3,$4,$5,$6)",
        [
          this.org,
          tid,
          name,
          f,
          purpose.purpose,
          purpose.purposeRich === null
            ? null
            : JSON.stringify(purpose.purposeRich),
        ],
      );
    const out = await this.one("structure_templates", "id", tid);
    await this.history(tid, "RoleTemplateSaved", existing, out);
    return camel(out);
  }
  async configureRole(rid: string, input: unknown, expected: number) {
    this.assertWrite();
    await this.entity(rid, "ROLE");
    const p = object(input, ["templateId", "flags"]);
    const before = (
      await this.ctx.c.query(
        "SELECT * FROM structure_role_settings WHERE organization_id=$1 AND role_id=$2",
        [this.org, rid],
      )
    ).rows[0];
    if ((before?.version ?? 0) !== expected) fail(409, "VERSION_CONFLICT");
    let f: Flags;
    if (p.templateId) {
      const t = await this.one("structure_templates", "id", p.templateId);
      f = t.flags;
      if (p.flags !== undefined) fail(400, "INVALID_REQUEST");
    } else f = flags(p.flags);
    await this.ctx.c.query(
      "INSERT INTO structure_role_settings(organization_id,role_id,template_id,flags) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,role_id) DO UPDATE SET template_id=excluded.template_id,flags=excluded.flags,version=structure_role_settings.version+1",
      [this.org, rid, p.templateId ?? null, f],
    );
    const row = await this.one("structure_role_settings", "role_id", rid);
    await this.history(rid, "RoleFlagsConfigured", before, row);
    return camel(row);
  }
  /** Foundation MUST call before any direct occupancy command. Current role flags evaluated inside its tenant lock. */
  async validateOccupancy(
    input: { roleId: string; memberId?:string; kind: string; startsAt?:string;endsAt?: string | null },
    election = false,
  ) {
    if (input.memberId && await this.core.governanceModel()?.validateAssignment(this.ctx, {...input,memberId:input.memberId,election})) return;
    const f = await this.roleFlags(input.roleId);
    if (f.electable && input.kind !== "INTERIM" && !election)
      fail(422, "ELECTION_REQUIRED");
    if (input.kind === "INTERIM" && !input.endsAt)
      fail(422, "INTERIM_END_REQUIRED");
  }
  async mandate(
    input: unknown,
    election?: { proposalId: string; revision: number },
  ) {
    this.assertWrite();
    const p = object(input, [
      "roleId",
      "memberId",
      "kind",
      "startsAt",
      "endsAt",
      "scope",
    ]);
    const role = await this.entity(id(p.roleId), "ROLE");
    await this.member(id(p.memberId));
    if (!election) {
      const modeled = await this.core.governanceModel()?.authorizeAssignment(this.ctx, {roleId:role.id,memberId:p.memberId,kind:p.kind,endsAt:p.endsAt});
      if (modeled === false) fail(403, 'ACTION_DENIED');
    }
    if (!["DIRECT", "INTERIM", "ELECTED"].includes(p.kind))
      fail(400, "INVALID_REQUEST");
    if (p.kind === "ELECTED" && !election) fail(422, "ELECTION_REQUIRED");
    await this.validateOccupancy(
      { roleId: p.roleId, memberId:p.memberId, kind: p.kind, startsAt:p.startsAt,endsAt: p.endsAt },
      !!election,
    );
    const start = timestamp(p.startsAt),
      end = p.endsAt == null ? null : timestamp(p.endsAt);
    if (end && Date.parse(end) <= Date.parse(start))
      fail(422, "DOMAIN_INVARIANT");
    if (p.kind !== "DIRECT" && !end) fail(422, "INTERIM_END_REQUIRED");
    if (end && Date.parse(end) <= (await this.clock()).getTime())
      fail(422, "MANDATE_EXPIRED");
    const mid = uuid();
    await this.ctx.c.query(
      "INSERT INTO structure_mandates(organization_id,id,role_id,member_id,kind,scope,starts_at,ends_at,proposal_id,proposal_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        this.org,
        mid,
        role.id,
        p.memberId,
        p.kind,
        optionalText(p.scope, 1000),
        start,
        end,
        election?.proposalId ?? null,
        election?.revision ?? null,
      ],
    );
    const row = await this.one("structure_mandates", "id", mid);
    await this.core.governanceModel()?.recordOccupancy(this.ctx, 'MANDATE', row);
    await this.history(role.id, "RoleOccupied", undefined, row);
    return camel(row);
  }
  async endMandate(mid: string) {
    this.assertWrite();
    const before = await this.one("structure_mandates", "id", mid);
    const modeled = await this.core.governanceModel()?.authorizeEnd(this.ctx, 'MANDATE', mid);
    if (modeled === false) fail(403, 'ACTION_DENIED');
    if (before.ended_at) fail(409, "STATE_CONFLICT");
    await this.ctx.c.query(
      "UPDATE structure_mandates SET ended_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2",
      [this.org, mid],
    );
    const row = await this.one("structure_mandates", "id", mid);
    await this.core.governanceModel()?.recordEnd(this.ctx, 'MANDATE', row);
    await this.history(before.role_id, "RoleOccupancyEnded", before, row);
    return camel(row);
  }
  async alias(input: unknown) {
    this.assertWrite();
    const p = object(input, ["sourceRoleId", "circleId", "label"]);
    const source = await this.entity(id(p.sourceRoleId), "ROLE");
    await this.entity(id(p.circleId), "CIRCLE");
    if (source.parent_id === p.circleId) fail(422, "ALIAS_SAME_CIRCLE");
    if (
      (
        await this.ctx.c.query(
          "SELECT 1 FROM structure_aliases WHERE organization_id=$1 AND source_role_id=$2 AND circle_id=$3",
          [this.org, source.id, p.circleId],
        )
      ).rowCount
    )
      fail(409, "ALIAS_EXISTS");
    const aid = uuid();
    await this.ctx.c.query(
      "INSERT INTO structure_aliases(organization_id,id,source_role_id,circle_id,label) VALUES($1,$2,$3,$4,$5)",
      [this.org, aid, source.id, p.circleId, text(p.label)],
    );
    const row = await this.one("structure_aliases", "id", aid);
    await this.history(aid, "RoleAliasCreated", undefined, row);
    return { ...camel(row), readOnly: true };
  }
  async validateFieldDependents(fid: string, schema: any, target: string) {
    const dependents = (
      await this.ctx.c.query(
        "SELECT * FROM structure_fields WHERE organization_id=$1 AND (schema->'formula'->'fieldIds') ? $2",
        [this.org, fid],
      )
    ).rows;
    for (const dependent of dependents) {
      if (
        schema.type === "COMPUTED" ||
        (dependent.schema.formula.op === "SUM" && schema.type !== "NUMBER") ||
        (target !== "BOTH" && target !== dependent.target)
      )
        fail(422, "FORMULA_DEPENDENCY_INVALID");
    }
  }
  async defineField(input: unknown, existing?: any, preview = false) {
    this.assertWrite();
    const p = object(input, ["key", "label", "target", "schema", "governed"]);
    const key = text(p.key, 100);
    if (
      !/^[a-z][a-z0-9_]*$/.test(key) ||
      !["CIRCLE", "ROLE", "BOTH"].includes(p.target) ||
      typeof p.governed !== "boolean"
    )
      fail(400, "INVALID_REQUEST");
    if (existing && key !== existing.key) fail(422, "FIELD_KEY_IMMUTABLE");
    const s = fieldSchema(p.schema);
    if (s.type === "COMPUTED" && p.governed) fail(422, "COMPUTED_NOT_GOVERNED");
    if (s.type === "COMPUTED") {
      for (const fid of s.formula!.fieldIds) {
        const dep = await this.one("structure_fields", "id", fid);
        if (
          dep.schema.type === "COMPUTED" ||
          (s.formula!.op === "SUM" && dep.schema.type !== "NUMBER") ||
          (dep.target !== p.target && dep.target !== "BOTH")
        )
          fail(422, "FORMULA_DEPENDENCY_INVALID");
      }
    }
    const fid = existing?.id ?? uuid();
    await this.validateFieldDependents(fid, s, p.target);
    const values = existing
      ? (
          await this.ctx.c.query(
            "SELECT v.*,e.kind FROM structure_values v JOIN entities e ON e.organization_id=v.organization_id AND e.id=v.entity_id WHERE v.organization_id=$1 AND field_id=$2",
            [this.org, fid],
          )
        ).rows
      : [];
    const invalid: string[] = [];
    for (const v of values) {
      try {
        if (p.target !== "BOTH" && p.target !== v.kind) throw Error();
        fieldValue(s, v.value);
      } catch {
        invalid.push(v.entity_id);
      }
    }
    if (preview)
      return {
        valid: !invalid.length,
        invalidEntityIds: invalid,
        affected: values.length,
        baseVersion: existing?.version ?? 0,
      };
    if (invalid.length) fail(422, "SCHEMA_MIGRATION_REQUIRED");
    if (existing && existing.schema.type !== s.type && values.length)
      fail(422, "SCHEMA_MIGRATION_REQUIRED");
    const dup = (
      await this.ctx.c.query(
        "SELECT id FROM structure_fields WHERE organization_id=$1 AND key=$2 AND id<>$3",
        [this.org, key, fid],
      )
    ).rows[0];
    if (dup) fail(409, "FIELD_KEY_EXISTS");
    if (existing)
      await this.ctx.c.query(
        "UPDATE structure_fields SET label=$3,target=$4,schema=$5,governed=$6,version=version+1 WHERE organization_id=$1 AND id=$2",
        [this.org, fid, text(p.label), p.target, s, p.governed],
      );
    else
      await this.ctx.c.query(
        "INSERT INTO structure_fields(organization_id,id,key,label,target,schema,governed) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [this.org, fid, key, text(p.label), p.target, s, p.governed],
      );
    const out = await this.one("structure_fields", "id", fid);
    await this.ctx.c.query(
      "INSERT INTO structure_field_revisions(organization_id,field_id,version,definition) VALUES($1,$2,$3,$4)",
      [this.org, fid, out.version, out],
    );
    await this.history(fid, "StructureFieldDefined", existing, out);
    return camel(out);
  }
  async setValue(
    eid: string,
    fid: string,
    value: unknown,
    expected: number,
    governed = false,
  ) {
    this.assertWrite();
    const e = await this.entity(eid),
      f = await this.one("structure_fields", "id", fid);
    if (f.target !== "BOTH" && f.target !== e.kind) fail(422, "FIELD_TARGET");
    if (f.governed && !governed) fail(422, "FIELD_GOVERNED");
    fieldValue(f.schema, value);
    const before = (
      await this.ctx.c.query(
        "SELECT * FROM structure_values WHERE organization_id=$1 AND entity_id=$2 AND field_id=$3",
        [this.org, eid, fid],
      )
    ).rows[0];
    if ((before?.version ?? 0) !== expected) fail(409, "VERSION_CONFLICT");
    await this.ctx.c.query(
      "INSERT INTO structure_values(organization_id,entity_id,field_id,value,schema_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,entity_id,field_id) DO UPDATE SET value=excluded.value,schema_version=excluded.schema_version,version=structure_values.version+1",
      [this.org, eid, fid, JSON.stringify(value), f.version],
    );
    const out = (
      await this.ctx.c.query(
        "SELECT * FROM structure_values WHERE organization_id=$1 AND entity_id=$2 AND field_id=$3",
        [this.org, eid, fid],
      )
    ).rows[0];
    await this.history(eid, "StructureFieldValueChanged", before, out);
    return camel(out);
  }
  async values(eid: string) {
    const e = await this.entity(eid);
    const fields = (
      await this.ctx.c.query(
        `SELECT * FROM structure_fields WHERE organization_id=$1 AND target IN ($2,'BOTH') ORDER BY key`,
        [this.org, e.kind],
      )
    ).rows;
    const rows = (
      await this.ctx.c.query(
        "SELECT * FROM structure_values WHERE organization_id=$1 AND entity_id=$2",
        [this.org, eid],
      )
    ).rows;
    return fields.map((f) => {
      const row = rows.find((v) => v.field_id === f.id);
      let value = row?.value ?? null;
      if (f.schema.type === "COMPUTED") {
        const deps = f.schema.formula.fieldIds.map(
          (fid: string) => rows.find((v) => v.field_id === fid)?.value,
        );
        value = deps.some((x: unknown) => x === undefined || x === null)
          ? null
          : f.schema.formula.op === "COUNT"
            ? deps.length
            : deps.reduce((a: number, b: number) => a + b, 0);
      }
      if (
        f.schema.type === "COMPUTED" &&
        typeof value === "number" &&
        !Number.isFinite(value)
      )
        value = null;
      return {
        field: camel(f),
        value,
        status: value === null ? "UNKNOWN" : "KNOWN",
        version: row?.version ?? 0,
        schemaVersion: row?.schema_version ?? f.version,
      };
    });
  }
  async inputIndicatorSubject(input: {
    entityId?: unknown;
    subject?: unknown;
  }) {
    return resolveIndicatorSubject(this.ctx, this.core, input);
  }
  async canIndicatorSubject(
    subject: IndicatorSubject,
    action: MemberIndicatorAction,
  ) {
    if (subject.kind === "MEMBER")
      return authorizeMemberIndicator(
        this.ctx,
        this.options,
        subject.memberId,
        action,
      );
    const eid = indicatorSubjectId(subject);
    await this.entity(eid, subject.kind);
    if (action === "READ")
      return this.ctx.member.status === "ACTIVE" && !this.isGuest();
    return this.canEntity(eid, action === "DEFINE" ? "ADMIN" : "RECORD");
  }
  async requireIndicatorSubject(
    subject: IndicatorSubject,
    action: MemberIndicatorAction,
  ) {
    if (!(await this.canIndicatorSubject(subject, action)))
      fail(
        action === "READ" ? 404 : 403,
        action === "READ" ? "RESOURCE_NOT_FOUND" : "ACTION_DENIED",
      );
  }
  async memberIndicators(memberId: string) {
    memberId = id(memberId).toLowerCase();
    const subject: IndicatorSubject = {
      kind: "MEMBER",
      memberId: id(memberId),
    };
    await this.requireIndicatorSubject(subject, "READ");
    const rows = (
      await this.ctx.c.query(
        "SELECT * FROM structure_indicators WHERE organization_id=$1 AND subject_kind='MEMBER' AND member_id=$2 AND NOT archived ORDER BY name,id",
        [this.org, memberId],
      )
    ).rows;
    return {
      subject,
      items: rows.map((row) => ({
        ...camel(row),
        subject: storedIndicatorSubject(row),
      })),
      capabilities: {
        define: await this.canIndicatorSubject(subject, "DEFINE"),
        record: await this.canIndicatorSubject(subject, "RECORD"),
      },
    };
  }
  async memberIndicatorHistory(memberId: string) {
    memberId = id(memberId).toLowerCase();
    await this.requireIndicatorSubject(
      { kind: "MEMBER", memberId: id(memberId) },
      "READ",
    );
    const rows = (
      await this.ctx.c.query(
        "SELECT * FROM structure_history WHERE organization_id=$1 AND resource_id=$2 AND indicator_subject_kind='MEMBER' AND action IN ('StructureIndicatorDefined','StructureIndicatorUpdated','StructureIndicatorArchived','MetricRecorded','ChecklistChecked') ORDER BY at DESC,id DESC LIMIT 100",
        [this.org, memberId],
      )
    ).rows;
    return {
      items: rows.map(camel),
      coverage: { scope: "MEMBER_INDICATORS", complete: rows.length < 100 },
    };
  }
  async indicator(input: unknown) {
    this.assertWrite();
    const p = object(input, [
      "entityId",
      "subject",
      "name",
      "kind",
      "valueType",
      "unit",
      "requiredUnits",
    ]);
    const subject = await this.inputIndicatorSubject(p);
    await this.requireIndicatorSubject(subject, "DEFINE");
    const definition = indicatorDefinition(p),
      iid = uuid();
    await this.ctx.c.query(
      "INSERT INTO structure_indicators(organization_id,id,entity_id,name,kind,value_type,unit,required_units,subject_kind,member_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        this.org,
        iid,
        subject.kind === "MEMBER" ? null : indicatorSubjectId(subject),
        definition.name,
        definition.kind,
        definition.valueType,
        definition.unit,
        JSON.stringify(definition.requiredUnits),
        subject.kind,
        subject.kind === "MEMBER" ? subject.memberId : null,
      ],
    );
    const out = await this.one("structure_indicators", "id", iid);
    await this.history(
      indicatorSubjectId(subject),
      "StructureIndicatorDefined",
      undefined,
      out,
      false,
      subject.kind,
    );
    return { ...camel(out), subject };
  }
  async updateIndicator(
    iid: string,
    input: unknown,
    expected: number,
    archive = false,
  ) {
    this.assertWrite();
    const before = await this.one("structure_indicators", "id", iid),
      subject = storedIndicatorSubject(before);
    await this.requireIndicatorSubject(subject, "DEFINE");
    if (before.version !== expected) fail(409, "VERSION_CONFLICT");
    if (before.archived) fail(409, "INDICATOR_ARCHIVED");
    const patch = object(
      input,
      archive ? [] : ["name", "kind", "valueType", "unit", "requiredUnits"],
    );
    if (!archive && !Object.keys(patch).length) fail(400, "INVALID_REQUEST");
    const next = indicatorDefinition({ ...camel(before), ...patch });
    const schemaChanged =
      next.kind !== before.kind ||
      next.valueType !== before.value_type ||
      next.unit !== before.unit ||
      JSON.stringify(next.requiredUnits) !==
        JSON.stringify(before.required_units);
    if (
      schemaChanged &&
      (
        await this.ctx.c.query(
          "SELECT 1 FROM structure_records WHERE organization_id=$1 AND indicator_id=$2 LIMIT 1",
          [this.org, iid],
        )
      ).rowCount
    )
      fail(422, "INDICATOR_SCHEMA_CHANGE_REQUIRES_PLAN");
    await this.ctx.c.query(
      "UPDATE structure_indicators SET name=$3,kind=$4,value_type=$5,unit=$6,required_units=$7,archived=$8,version=version+1 WHERE organization_id=$1 AND id=$2",
      [
        this.org,
        iid,
        next.name,
        next.kind,
        next.valueType,
        next.unit,
        JSON.stringify(next.requiredUnits),
        archive,
      ],
    );
    const after = await this.one("structure_indicators", "id", iid);
    await this.history(
      indicatorSubjectId(subject),
      archive ? "StructureIndicatorArchived" : "StructureIndicatorUpdated",
      before,
      after,
      false,
      subject.kind,
    );
    return { ...camel(after), subject };
  }
  async record(iid: string, input: unknown, expected: number) {
    this.assertWrite();
    const i = await this.one("structure_indicators", "id", iid);
    const subject = storedIndicatorSubject(i);
    await this.requireIndicatorSubject(subject, "RECORD");
    if (i.archived) fail(409, "INDICATOR_ARCHIVED");
    const p = object(input, ["period", "unitKey", "value"]);
    const period = text(p.period, 100),
      unit = text(p.unitKey, 100);
    if (i.required_units.length && !i.required_units.includes(unit))
      fail(422, "UNIT_NOT_REQUIRED");
    fieldValue({ type: i.value_type, required: true }, p.value);
    const old = (
      await this.ctx.c.query(
        "SELECT * FROM structure_records WHERE organization_id=$1 AND indicator_id=$2 AND period=$3 AND unit_key=$4 ORDER BY version DESC LIMIT 1",
        [this.org, iid, period, unit],
      )
    ).rows[0];
    if ((old?.version ?? 0) !== expected) fail(409, "VERSION_CONFLICT");
    const rid = uuid();
    await this.ctx.c.query(
      "INSERT INTO structure_records(organization_id,id,indicator_id,period,unit_key,value,recorded_by,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        this.org,
        rid,
        iid,
        period,
        unit,
        JSON.stringify(p.value),
        this.ctx.member.id,
        expected + 1,
      ],
    );
    const row = await this.one("structure_records", "id", rid);
    await this.history(
      indicatorSubjectId(subject),
      i.kind === "METRIC" ? "MetricRecorded" : "ChecklistChecked",
      old,
      row,
      false,
      subject.kind,
    );
    return camel(row);
  }
  async indicatorPeriod(iid: string, period: string) {
    const i = await this.one("structure_indicators", "id", iid);
    await this.requireIndicatorSubject(storedIndicatorSubject(i), "READ");
    const records = (
      await this.ctx.c.query(
        "SELECT * FROM structure_records WHERE organization_id=$1 AND indicator_id=$2 AND period=$3 ORDER BY at,id",
        [this.org, iid, text(period, 100)],
      )
    ).rows;
    const latest = new Map<string, any>();
    for (const r of records) latest.set(r.unit_key, r);
    const denom = i.required_units.length;
    return {
      indicator: { ...camel(i), subject: storedIndicatorSubject(i) },
      capabilities: {
        record:
          !i.archived &&
          (await this.canIndicatorSubject(storedIndicatorSubject(i), "RECORD")),
      },
      period,
      records: records.map(camel),
      latest: [...latest.values()].map(camel),
      status: latest.size ? "KNOWN" : "UNKNOWN",
      completion:
        i.kind === "CHECKLIST" && denom
          ? {
              status: "KNOWN",
              numerator: i.required_units.filter(
                (u: string) => latest.get(u)?.value === true,
              ).length,
              denominator: denom,
              rate:
                (100 *
                  i.required_units.filter(
                    (u: string) => latest.get(u)?.value === true,
                  ).length) /
                denom,
            }
          : {
              status: "UNKNOWN",
              numerator: null,
              denominator: i.kind === "CHECKLIST" ? denom : null,
              rate: null,
            },
    };
  }
  async graph(config: ViewConfig = initialView) {
    const guest = this.isGuest();
    const entities = await this.structureRows();
    const roles = guest
      ? []
      : (
          await this.ctx.c.query(
            "SELECT * FROM structure_role_settings WHERE organization_id=$1",
            [this.org],
          )
        ).rows;
    if (guest) {
      if (config.memberId && config.memberId !== this.ctx.member.id)
        fail(404, "RESOURCE_NOT_FOUND");
      if (config.rootId) await this.readableEntity(config.rootId, "CIRCLE");
      if (config.field || config.flag) fail(404, "RESOURCE_NOT_FOUND");
    }
    let candidates = entities;
    let allowed: Set<string> | undefined;
    if (config.memberId) {
      const r = await this.reasons(config.memberId);
      allowed = new Set(
        r.reasons.flatMap((x: any) => [
          x.circleId,
          ...(x.roleId ? [x.roleId] : []),
        ]),
      );
    }
    if (config.rootId) await this.readableEntity(config.rootId, "CIRCLE");
    if (config.field) {
      const f = await this.one("structure_fields", "id", config.field.fieldId);
      if (config.field.equals !== null)
        fieldValue(
          f.schema.type === "COMPUTED"
            ? { type: "NUMBER", required: false }
            : { ...f.schema, required: false },
          config.field.equals,
        );
    }
    let depthLimited = false;
    const visible: any[] = [];
    for (const e of candidates) {
      let depth = 0,
        cur = e;
      const seen = new Set<string>();
      while (cur.parent_id && cur.id !== config.rootId) {
        if (seen.has(cur.id)) fail(422, "STRUCTURE_CYCLE");
        seen.add(cur.id);
        cur = entities.find((x) => x.id === cur.parent_id);
        if (!cur) break;
        depth++;
      }
      if (config.rootId && cur?.id !== config.rootId) continue;
      if (depth >= config.maxDepth) {
        depthLimited = true;
        continue;
      }
      if (config.kind !== "ALL" && e.kind !== config.kind) continue;
      if (
        !e.name.toLocaleLowerCase().includes(config.query.toLocaleLowerCase())
      )
        continue;
      if (allowed && !allowed.has(e.id)) continue;
      const settings = roles.find((r) => r.role_id === e.id);
      if (config.flag && !settings?.flags[config.flag]) continue;
      if (config.field) {
        const values = await this.values(e.id);
        if (
          !values.some(
            (v) =>
              v.field.id === config.field!.fieldId &&
              (config.field!.equals === null
                ? v.status === "UNKNOWN"
                : v.status === "KNOWN" &&
                  JSON.stringify(v.value) ===
                    JSON.stringify(config.field!.equals)),
          )
        )
          continue;
      }
      visible.push({
        ...camel(e),
        ...readPurposeRow(e),
        depth,
        ...(guest
          ? {}
          : {
              flags: settings?.flags ?? defaultFlags,
              settingsVersion: settings?.version ?? 0,
            }),
      });
    }
    const ids = new Set(visible.map((e) => e.id));
    const aliases = (
      await this.ctx.c.query(
        "SELECT a.* FROM structure_aliases a JOIN entities e ON e.organization_id=a.organization_id AND e.id=a.source_role_id WHERE a.organization_id=$1 AND NOT e.archived AND a.circle_id=ANY($2::uuid[]) AND a.source_role_id=ANY($2::uuid[])",
        [this.org, [...ids]],
      )
    ).rows
      .filter((a) => ids.has(a.circle_id) && ids.has(a.source_role_id))
      .map((a) => ({ ...camel(a), readOnly: true }));
    return {
      entities: visible,
      aliases,
      edges: visible
        .filter((e) => e.parentId && ids.has(e.parentId))
        .map((e) => ({ from: e.parentId, to: e.id, kind: "PARENT" })),
      view: config.view,
      ...(config.presentation ? { presentation: config.presentation } : {}),
      coverage: {
        complete: !depthLimited,
        depthLimited,
        asOf: (await this.clock()).toISOString(),
        ...(guest
          ? {
              scope: "AUTHORIZED_FOREST",
              relationships: "NOT_SHARED",
              degradedReasons: ["GUEST_SCOPE_REDACTION"],
            }
          : {}),
      },
      structureRevision: this.ctx.org.structure_revision,
    };
  }
  async structureForest(input: { rootCircleId?: string; depth?: number } = {}) {
    const depth = input.depth ?? 20;
    integer(depth, 1, 50);
    const graph = await this.graph({
      ...initialView,
      rootId: input.rootCircleId ?? null,
      maxDepth: depth + 1,
    });
    const es = graph.entities;
    return {
      structureRevision: graph.structureRevision,
      nodes: es.map((e) => ({
        nodeId: e.nodeId,
        entityId: e.id,
        kind: e.kind,
        parentNodeId: es.find((p) => p.id === e.parentId)?.nodeId ?? null,
        name: e.name,
        version: e.version,
        ...(this.isGuest() ? { pathRedacted: e.pathRedacted === true } : {}),
      })),
      circles: es
        .filter((e) => e.kind === "CIRCLE")
        .map((e) => ({ ...e, parentCircleId: e.parentId })),
      roles: es
        .filter((e) => e.kind === "ROLE")
        .map((e) => ({
          ...e,
          parentCircleId: e.parentId,
          circleId: e.parentId,
        })),
      memberships: this.isGuest()
        ? []
        : (
            await this.ctx.c.query(
              "SELECT * FROM circle_memberships WHERE organization_id=$1 AND circle_id=ANY($2::uuid[])",
              [
                this.org,
                es.filter((e) => e.kind === "CIRCLE").map((e) => e.id),
              ],
            )
          ).rows.map(camel),
      occupancies: this.isGuest()
        ? []
        : (
            await this.ctx.c.query(
              "SELECT o.*,e.parent_id AS circle_id FROM occupancies o JOIN entities e ON e.organization_id=o.organization_id AND e.id=o.role_id WHERE o.organization_id=$1 AND o.role_id=ANY($2::uuid[])",
              [this.org, es.filter((e) => e.kind === "ROLE").map((e) => e.id)],
            )
          ).rows.map(camel),
      coverage: graph.coverage,
    };
  }
  async privateView(viewId: string) {
    const row = await this.one("structure_views", "id", viewId);
    if (row.member_id !== this.ctx.member.id || row.deleted_at)
      fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  async listViews(input: unknown) {
    const q = object(input, ["cursor", "limit"]);
    const limit = q.limit === undefined ? 50 : Number(q.limit);
    integer(limit, 1, 100);
    let cursor = null;
    if (q.cursor) {
      const row = await this.privateView(id(q.cursor));
      cursor = row.id;
    }
    const rows = (
      await this.ctx.c.query(
        "SELECT * FROM structure_views WHERE organization_id=$1 AND member_id=$2 AND deleted_at IS NULL AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
        [this.org, this.ctx.member.id, cursor, limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, limit).map(camel),
      page: {
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      },
      contract: {
        version: 1,
        viewModes: ["PACK", "TREE", "DIRECTORY", "NETWORK"],
        presentation: true,
      },
    };
  }
  async deleteView(viewId: string, expected: number) {
    this.assertWrite();
    const before = await this.privateView(viewId);
    if (before.version !== expected) fail(409, "VERSION_CONFLICT");
    const row = (
      await this.ctx.c.query(
        "UPDATE structure_views SET deleted_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
        [this.org, viewId],
      )
    ).rows[0];
    await this.history(viewId, "StructureViewDeleted", before, row, false);
    return { id: row.id, version: row.version, deleted: true };
  }
  async saveView(input: unknown, existing?: any) {
    this.assertWrite();
    const p = object(input, ["name", "config"]);
    const config = viewConfig(p.config);
    if (
      this.isGuest() &&
      ((config.memberId && config.memberId !== this.ctx.member.id) ||
        config.field ||
        config.flag)
    )
      fail(404, "RESOURCE_NOT_FOUND");
    if (config.rootId) await this.readableEntity(config.rootId, "CIRCLE");
    if (config.memberId) await this.member(config.memberId);
    if (config.field) {
      const f = await this.one("structure_fields", "id", config.field.fieldId);
      if (config.field.equals !== null)
        fieldValue(
          f.schema.type === "COMPUTED"
            ? { type: "NUMBER", required: false }
            : { ...f.schema, required: false },
          config.field.equals,
        );
    }
    if (
      existing &&
      (existing.member_id !== this.ctx.member.id || existing.deleted_at)
    )
      fail(404, "RESOURCE_NOT_FOUND");
    const vid = existing?.id ?? uuid();
    if (existing)
      await this.ctx.c.query(
        "UPDATE structure_views SET name=$3,config=$4,version=version+1 WHERE organization_id=$1 AND id=$2",
        [this.org, vid, text(p.name), config],
      );
    else
      await this.ctx.c.query(
        "INSERT INTO structure_views(organization_id,id,member_id,name,config) VALUES($1,$2,$3,$4,$5)",
        [this.org, vid, this.ctx.member.id, text(p.name), config],
      );
    const row = await this.one("structure_views", "id", vid);
    await this.history(vid, "StructureViewSaved", existing, row, false);
    return camel(row);
  }
  async snapshot(name: string) {
    this.assertWrite();
    const graph: any = await this.graph();
    graph.fields = (
      await this.ctx.c.query(
        "SELECT * FROM structure_fields WHERE organization_id=$1",
        [this.org],
      )
    ).rows.map(camel);
    graph.values = (
      await this.ctx.c.query(
        "SELECT * FROM structure_values WHERE organization_id=$1",
        [this.org],
      )
    ).rows.map(camel);
    graph.policies = (
      await this.ctx.c.query(
        "SELECT * FROM structure_circle_policies WHERE organization_id=$1",
        [this.org],
      )
    ).rows.map(camel);
    graph.memberships = (
      await this.ctx.c.query(
        "SELECT * FROM circle_memberships WHERE organization_id=$1",
        [this.org],
      )
    ).rows.map(camel);
    graph.mandates = (
      await this.ctx.c.query(
        "SELECT * FROM structure_mandates WHERE organization_id=$1",
        [this.org],
      )
    ).rows.map(camel);
    graph.occupancies = (
      await this.ctx.c.query(
        "SELECT * FROM occupancies WHERE organization_id=$1",
        [this.org],
      )
    ).rows.map(camel);
    const sid = uuid();
    await this.ctx.c.query(
      "INSERT INTO structure_snapshots(organization_id,id,name,structure_revision,graph) VALUES($1,$2,$3,$4,$5)",
      [this.org, sid, text(name), this.ctx.org.structure_revision, graph],
    );
    const row = await this.one("structure_snapshots", "id", sid);
    await this.history(sid, "StructureSnapshotCreated", undefined, row, false);
    return camel(row);
  }
  async circlePolicy(circleId: string, input: unknown, expected: number) {
    this.assertWrite();
    await this.entity(circleId, "CIRCLE");
    const p = object(input, ["governedFields"]);
    if (
      !Array.isArray(p.governedFields) ||
      new Set(p.governedFields).size !== p.governedFields.length ||
      p.governedFields.some(
        (f: unknown) =>
          !["name", "purpose", "responsibilities", "artifacts", "CREATE", "MOVE", "ARCHIVE"].includes(
            f as string,
          ),
      )
    )
      fail(400, "INVALID_REQUEST");
    const before = (
      await this.ctx.c.query(
        "SELECT * FROM structure_circle_policies WHERE organization_id=$1 AND circle_id=$2",
        [this.org, circleId],
      )
    ).rows[0];
    if ((before?.version ?? 0) !== expected) fail(409, "VERSION_CONFLICT");
    await this.ctx.c.query(
      "INSERT INTO structure_circle_policies(organization_id,circle_id,governed_fields) VALUES($1,$2,$3) ON CONFLICT(organization_id,circle_id) DO UPDATE SET governed_fields=excluded.governed_fields,version=structure_circle_policies.version+1",
      [this.org, circleId, JSON.stringify(p.governedFields)],
    );
    const out = await this.one(
      "structure_circle_policies",
      "circle_id",
      circleId,
    );
    await this.history(circleId, "StructurePolicyConfigured", before, out);
    return camel(out);
  }
  async preflightEntityChange(input: {
    operation: "CREATE" | "UPDATE" | "MOVE" | "ARCHIVE";
    entityId?: string;
    circleId?: string;
    targetCircleId?: string;
    changedFields?: string[];
  }) {
    await this.core.governanceModel()?.preflight(this.ctx, input);
    const model = await this.core.governanceModel()?.state(this.ctx);
    if (model?.phase === 'PREPARATION' && this.ctx.member.org_role === 'OWNER') return;
    const circles = new Set<string>();
    let entity: any;
    if (input.entityId) {
      entity = await this.entity(input.entityId);
      circles.add(entity.kind === "CIRCLE" ? entity.id : entity.parent_id);
      if (entity.kind === "CIRCLE" && entity.parent_id)
        circles.add(entity.parent_id);
    }
    if (input.circleId) {
      await this.entity(input.circleId, "CIRCLE");
      circles.add(input.circleId);
    }
    if (input.targetCircleId) {
      await this.entity(input.targetCircleId, "CIRCLE");
      circles.add(input.targetCircleId);
    }
    for (const cid of circles) {
      const p = (
        await this.ctx.c.query(
          "SELECT governed_fields FROM structure_circle_policies WHERE organization_id=$1 AND circle_id=$2",
          [this.org, cid],
        )
      ).rows[0];
      if (
        p?.governed_fields.some((f: string) =>
          [
            input.operation,
            ...(input.changedFields ?? []).map((field) =>
              field === "purposeRich" ? "purpose" : field,
            ),
          ].includes(f),
        )
      )
        fail(422, "FIELD_GOVERNED");
    }
    if (input.operation === "ARCHIVE" && entity) {
      const at = await this.clock();
      if (
        (
          await this.ctx.c.query(
            "SELECT 1 FROM structure_mandates WHERE organization_id=$1 AND role_id=$2 AND starts_at<=$3 AND (ends_at IS NULL OR ends_at>$3) AND (ended_at IS NULL OR ended_at>$3)",
            [this.org, entity.id, at],
          )
        ).rowCount
      )
        fail(409, "STATE_CONFLICT");
    }
  }
  async recordFoundationChange(input: {
    resourceId: string;
    action: string;
    before: unknown;
    after: unknown;
  }) {
    this.assertWrite();
    const historyId = uuid();
    await this.ctx.c.query(
      "INSERT INTO structure_history(organization_id,id,resource_id,action,before_value,after_value,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        this.org,
        historyId,
        id(input.resourceId),
        text(input.action),
        JSON.stringify(input.before ?? null),
        JSON.stringify(input.after ?? null),
        this.ctx.member.id,
      ],
    );
    if (input.action === "CIRCLECreated" && input.before == null)
      await this.circleCreated(input.resourceId);
    await this.notifyChange(historyId, input.action, input.before, input.after);
  }
  async migrateField(fid: string, input: unknown) {
    this.assertWrite();
    const before = await this.one("structure_fields", "id", fid);
    if (before.governed) fail(422, "FIELD_GOVERNED");
    const p = object(input, ["definition", "values"]);
    const definition = object(p.definition, [
      "key",
      "label",
      "target",
      "schema",
      "governed",
    ]);
    if (definition.key !== before.key) fail(422, "FIELD_KEY_IMMUTABLE");
    const schema = fieldSchema(definition.schema);
    if (schema.type === "COMPUTED") fail(422, "SCHEMA_MIGRATION_REQUIRED");
    await this.validateFieldDependents(fid, schema, definition.target);
    if (!Array.isArray(p.values) || p.values.length > 1000)
      fail(400, "INVALID_REQUEST");
    const current = (
      await this.ctx.c.query(
        "SELECT * FROM structure_values WHERE organization_id=$1 AND field_id=$2",
        [this.org, fid],
      )
    ).rows;
    if (
      current.length !== p.values.length ||
      new Set(p.values.map((v: any) => v.entityId)).size !== p.values.length
    )
      fail(422, "MIGRATION_COVERAGE_REQUIRED");
    for (const raw of p.values) {
      const v = object(raw, ["entityId", "baseVersion", "value"]);
      const old = current.find((r) => r.entity_id === id(v.entityId));
      if (!old || old.version !== integer(v.baseVersion, 1))
        fail(409, "VERSION_CONFLICT");
      const e = await this.entity(v.entityId);
      if (definition.target !== "BOTH" && definition.target !== e.kind)
        fail(422, "FIELD_TARGET");
      fieldValue(schema, v.value);
    }
    // Validated complete rewrite; preserve before/after values and original schema revisions in history.
    if (
      !["CIRCLE", "ROLE", "BOTH"].includes(definition.target) ||
      typeof definition.governed !== "boolean"
    )
      fail(400, "INVALID_REQUEST");
    await this.ctx.c.query(
      "UPDATE structure_fields SET label=$3,target=$4,schema=$5,governed=$6,version=version+1 WHERE organization_id=$1 AND id=$2",
      [
        this.org,
        fid,
        text(definition.label),
        definition.target,
        schema,
        definition.governed,
      ],
    );
    const out = await this.one("structure_fields", "id", fid);
    await this.ctx.c.query(
      "INSERT INTO structure_field_revisions(organization_id,field_id,version,definition) VALUES($1,$2,$3,$4)",
      [this.org, fid, out.version, out],
    );
    for (const v of p.values) {
      await this.ctx.c.query(
        "UPDATE structure_values SET value=$4,schema_version=$5,version=version+1 WHERE organization_id=$1 AND field_id=$2 AND entity_id=$3",
        [this.org, fid, v.entityId, JSON.stringify(v.value), out.version],
      );
      await this.history(
        v.entityId,
        "StructureFieldMigrated",
        current.find((r) => r.entity_id === v.entityId),
        { ...v, schemaVersion: out.version },
      );
    }
    await this.history(fid, "StructureFieldSchemaMigrated", before, out);
    return camel(out);
  }
}

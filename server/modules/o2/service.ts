import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { camel, fail, id, optionalText, text, uuid } from "../../src/core.js";
import {
  functionCodes,
  type AssignmentInput,
  type ModelReasons,
  type ModelState,
  type RoleFunction,
} from "./contract.js";
import {
  definitions,
  essentialDefinitionDefaults,
  o2Package,
  o2GovernanceDefaults,
  resolveRules,
} from "./package.js";
import {
  validateOccupancyCompatibility,
  validateGovernanceDocumentScope,
} from "./safeguards.js";
import { parseGovernanceArchive } from "./import-archive.js";

const isOwner = (ctx: Ctx) =>
  ctx.member.status === "ACTIVE" &&
  ctx.member.member_type !== "GUEST" &&
  ctx.member.org_role === "OWNER";
const writable = (ctx: Ctx) => {
  if (
    ctx.mode === "read" ||
    ctx.member.member_type === "GUEST" ||
    ctx.member.status !== "ACTIVE"
  )
    fail(403, "ACTION_DENIED");
};
export class GovernanceModel {
  constructor(
    public ctx: Ctx,
    public core?: ModuleRuntime,
  ) {}
  get org() {
    return this.ctx.org.id as string;
  }
  async model(): Promise<ModelState | null> {
    const row = (
      await this.ctx.c.query(
        "SELECT * FROM structure_governance_models WHERE organization_id=$1",
        [this.org],
      )
    ).rows[0];
    if (!row) return null;
    if (
      row.package_id !== o2Package.id ||
      row.package_version !== o2Package.version
    )
      fail(503, "MODEL_VERSION_UNAVAILABLE");
    return {
      packageId: row.package_id,
      packageVersion: row.package_version,
      sourceReference: row.source_reference,
      installedAt: new Date(row.installed_at).toISOString(),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      phase: row.phase as "PREPARATION" | "OPERATING",
      revision: row.revision as number,
      ...resolveRules(row.overrides),
    };
  }
  async entity(entityId: string, kind?: string) {
    const e = (
      await this.ctx.c.query(
        "SELECT * FROM entities WHERE organization_id=$1 AND id=$2 AND NOT archived",
        [this.org, id(entityId)],
      )
    ).rows[0];
    if (!e || (kind && e.kind !== kind)) fail(404, "RESOURCE_NOT_FOUND");
    return e;
  }
  async governancePolicy() {
    const model = await this.model();
    return model
      ? {
          configuration: { ...o2GovernanceDefaults },
          packageId: model.packageId,
          packageVersion: model.packageVersion,
          modelRevision: model.revision,
        }
      : null;
  }
  async member(memberId: string) {
    const m = (
      await this.ctx.c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND coalesce(to_jsonb(members)->>'member_type','MEMBER')='MEMBER'",
        [this.org, id(memberId)],
      )
    ).rows[0];
    if (!m) fail(404, "RESOURCE_NOT_FOUND");
    return m;
  }
  async binding(roleId: string) {
    await this.entity(roleId, "ROLE");
    const row = (
      await this.ctx.c.query(
        "SELECT function_code,version FROM structure_model_functions WHERE organization_id=$1 AND role_id=$2",
        [this.org, id(roleId)],
      )
    ).rows[0];
    return {
      roleId,
      functionCode: (row?.function_code ?? null) as RoleFunction | null,
      version: row?.version ?? 0,
    };
  }
  async circle(circleId: string) {
    await this.entity(circleId, "CIRCLE");
    const row = (
      await this.ctx.c.query(
        "SELECT * FROM structure_model_circles WHERE organization_id=$1 AND circle_id=$2",
        [this.org, id(circleId)],
      )
    ).rows[0];
    return {
      circleId,
      selfAssignment: row?.self_assignment ?? false,
      version: row?.version ?? 0,
    };
  }
  async active(memberId?: string) {
    return (
      await this.ctx.c.query(
        `SELECT o.*,r.parent_id,r.name,f.function_code,p.parent_id AS external_circle_id
   FROM (SELECT id,organization_id,role_id,member_id,starts_at,ends_at,NULL::timestamptz ended_at FROM occupancies
    UNION ALL SELECT id,organization_id,role_id,member_id,starts_at,ends_at,ended_at FROM structure_mandates) o
   JOIN entities r ON r.organization_id=o.organization_id AND r.id=o.role_id
   JOIN entities p ON p.organization_id=r.organization_id AND p.id=r.parent_id
   JOIN members m ON m.organization_id=o.organization_id AND m.id=o.member_id
   LEFT JOIN structure_model_functions f ON f.organization_id=r.organization_id AND f.role_id=r.id
   WHERE o.organization_id=$1 AND ($2::uuid IS NULL OR o.member_id=$2) AND NOT r.archived AND NOT p.archived
   AND m.status='ACTIVE' AND coalesce(to_jsonb(m)->>'member_type','MEMBER')='MEMBER'
   AND o.starts_at<=clock_timestamp() AND (o.ends_at IS NULL OR o.ends_at>clock_timestamp())
   AND (o.ended_at IS NULL OR o.ended_at>clock_timestamp())`,
        [this.org, memberId ?? null],
      )
    ).rows;
  }
  async hasFunction(
    circleId: string,
    code: RoleFunction,
    memberId = this.ctx.member.id,
  ) {
    if (!(await this.model())) return false;
    await this.entity(circleId, "CIRCLE");
    return (await this.active(memberId)).some(
      (r) => r.parent_id === circleId && r.function_code === code,
    );
  }
  async roleFunctions(circleId: string) {
    if (!(await this.model())) return null;
    await this.entity(circleId, "CIRCLE");
    const active = (await this.active()).filter(
      (row) => row.parent_id === circleId,
    );
    const bindings = (
      await this.ctx.c.query(
        "SELECT f.role_id,f.function_code FROM structure_model_functions f JOIN entities e ON e.organization_id=f.organization_id AND e.id=f.role_id WHERE f.organization_id=$1 AND e.parent_id=$2 AND NOT e.archived AND f.function_code IS NOT NULL ORDER BY f.function_code,f.role_id",
        [this.org, circleId],
      )
    ).rows;
    return bindings.map((row) => ({
      roleId: row.role_id as string,
      functionCode: row.function_code as RoleFunction,
      occupants: active
        .filter((o) => o.role_id === row.role_id)
        .map((o) => ({
          memberId: o.member_id as string,
          occupancyId: o.id as string,
          startsAt: new Date(o.starts_at).toISOString(),
          endsAt: o.ends_at ? new Date(o.ends_at).toISOString() : null,
        })),
    }));
  }
  async reasons(memberId: string): Promise<ModelReasons | null> {
    const model = await this.model();
    if (!model || model.rules.membership === "LEGACY") return null;
    await this.member(memberId);
    const reasons: ModelReasons["reasons"] = [];
    for (const o of await this.active(memberId)) {
      reasons.push({
        circleId: o.parent_id,
        roleId: o.role_id,
        sourceId: o.id,
        source: "OCCUPANCY",
        capability: "MEMBER",
      });
      if (
        o.external_circle_id &&
        ["GUIDE", "REPRESENTATIVE"].includes(o.function_code)
      )
        reasons.push({
          circleId: o.external_circle_id,
          roleId: o.role_id,
          sourceId: o.id,
          source: o.function_code,
          capability: "MEMBER",
        });
    }
    return {
      memberId,
      asOf: (await this.now()).toISOString(),
      reasons,
      circles: [...new Set(reasons.map((r) => r.circleId))],
    };
  }
  async now(): Promise<Date> {
    return (await this.ctx.c.query("SELECT clock_timestamp() AS at")).rows[0]
      .at;
  }
  async participates(circleId: string): Promise<boolean | null> {
    const model = await this.model();
    if (!model || model.rules.membership === "LEGACY") return null;
    await this.entity(circleId, "CIRCLE");
    if (this.ctx.member.member_type === "GUEST") return false;
    if (model.phase === "PREPARATION" && isOwner(this.ctx)) return true;
    return !!(await this.reasons(this.ctx.member.id))?.circles.includes(
      circleId,
    );
  }
  async authorizeCircle(
    circleId: string,
    action: string,
  ): Promise<boolean | null> {
    const model = await this.model();
    if (!model) return null;
    await this.entity(circleId, "CIRCLE");
    if (this.ctx.member.member_type === "GUEST") return false;
    if (model.phase === "PREPARATION" && isOwner(this.ctx)) return true;
    if (action === "ASSIGN")
      return model.rules.assignment === "LEGACY"
        ? null
        : this.hasFunction(circleId, "GUIDE");
    if (action === "DECISION")
      return this.participates(circleId);
    if(action==='RECORD')return null; // operational content keeps its existing technical authority.
    // Direct structure editing remains configurable through the chosen model.
    if (action === "ADMIN")
      return model.rules.structureChanges === "GOVERNANCE" ? false : null;
    return null;
  }
  async authorizeAssignment(input: AssignmentInput): Promise<boolean | null> {
    const model = await this.model();
    if (!model) return null;
    const role = await this.entity(input.roleId, "ROLE");
    await this.member(input.memberId);
    if (this.ctx.member.member_type === "GUEST") return false;
    if (model.phase === "PREPARATION") return isOwner(this.ctx);
    const binding = await this.binding(role.id),
      fn = binding.functionCode;
    if (fn && model.rules.electedFunctions.includes(fn))
      return input.election === true;
    if (fn === "GUIDE" && model.rules.guideSelection === "PARENT_GUIDE") {
      const circle = await this.entity(role.parent_id, "CIRCLE");
      return !!circle.parent_id && this.hasFunction(circle.parent_id, "GUIDE");
    }
    if (fn === "GUIDE") return null;
    if (model.rules.assignment === "LEGACY") return null;
    if (await this.hasFunction(role.parent_id, "GUIDE")) return true;
    return (
      input.memberId === this.ctx.member.id &&
      (await this.circle(role.parent_id)).selfAssignment === true &&
      (await this.memberCircles(input.memberId)).includes(role.parent_id)
    );
  }
  async assignmentAllowed(input: AssignmentInput) {
    const decision = await this.authorizeAssignment(input);
    if (decision !== null) return decision;
    const role = await this.entity(input.roleId, "ROLE");
    return (
      (await this.core
        ?.foundationStructure()
        ?.authorizeCircle(this.ctx, role.parent_id, "ASSIGN")) ?? false
    );
  }
  async endAllowed(source: string, occupancyId: string) {
    const decision = await this.authorizeEnd(source, occupancyId);
    if (decision !== null) return decision;
    const row = await this.occupancy(source, occupancyId),
      role = await this.entity(row.role_id, "ROLE");
    return (
      (await this.core
        ?.foundationStructure()
        ?.authorizeCircle(this.ctx, role.parent_id, "ASSIGN")) ?? false
    );
  }
  async memberCircles(memberId: string) {
    const reasons = await this.reasons(memberId);
    if (reasons) return reasons.circles;
    const legacy = (await this.core
      ?.foundationStructure()
      ?.membershipReasons(this.ctx, memberId)) as ModelReasons | undefined;
    return legacy?.circles ?? [];
  }
  async validateAssignment(input: AssignmentInput) {
    const model = await this.model();
    if (!model) return false;
    const role = await this.entity(input.roleId, "ROLE");
    await this.member(input.memberId);
    const fn = (await this.binding(role.id)).functionCode;
    if (model.phase === "PREPARATION" && isOwner(this.ctx)) return true;
    if (fn && model.rules.electedFunctions.includes(fn) && !input.election)
      fail(422, "ELECTION_REQUIRED");
    if (input.election) {
      if (!fn || !model.rules.electedFunctions.includes(fn))
        fail(422, "ROLE_NOT_ELECTABLE");
      if (
        model.rules.enforceEligibility &&
        !(await this.memberCircles(input.memberId)).includes(role.parent_id)
      )
        fail(422, "ELECTION_MEMBER_REQUIRED");
    }
    if (model.rules.enforceEligibility && fn)
      await validateOccupancyCompatibility(this.ctx, input, fn);
    return true;
  }
  async occupancy(source: string, occupancyId: string) {
    if (!["OCCUPANCY", "MANDATE"].includes(source))
      fail(400, "INVALID_OCCUPANCY_SOURCE");
    const table = source === "OCCUPANCY" ? "occupancies" : "structure_mandates";
    const row = (
      await this.ctx.c.query(
        `SELECT * FROM ${table} WHERE organization_id=$1 AND id=$2`,
        [this.org, id(occupancyId)],
      )
    ).rows[0];
    if (!row) fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  async authorizeEnd(
    source: string,
    occupancyId: string,
  ): Promise<boolean | null> {
    const model = await this.model();
    if (!model) return null;
    const row = await this.occupancy(source, occupancyId),
      role = await this.entity(row.role_id, "ROLE");
    if (this.ctx.member.member_type === "GUEST") return false;
    if (
      row.ended_at ||
      (row.ends_at && new Date(row.ends_at) <= (await this.now()))
    )
      return false;
    if (model.phase === "PREPARATION") return isOwner(this.ctx);
    if (row.member_id === this.ctx.member.id) {
      const agreement = (
        await this.ctx.c.query(
          "SELECT exit_not_before FROM structure_model_occupancy_context WHERE organization_id=$1 AND source=$2 AND occupancy_id=$3",
          [this.org, source, row.id],
        )
      ).rows[0];
      if (
        agreement?.exit_not_before &&
        new Date(agreement.exit_not_before) > (await this.now())
      )
        fail(422, "EXIT_AGREEMENT_ACTIVE");
      return true;
    }
    const fn = (await this.binding(role.id)).functionCode;
    if (
      (fn === "GUIDE" && model.rules.guideSelection === "PARENT_GUIDE") ||
      (fn && model.rules.electedFunctions.includes(fn))
    )
      return false; // removal of others from these functions has not been authorized.
    return model.rules.assignment === "LEGACY"
      ? null
      : this.hasFunction(role.parent_id, "GUIDE");
  }
  async audit(resourceId: string, action: string, snapshot: unknown) {
    const model = await this.model();
    if (!model) return;
    await this.ctx.c.query(
      "INSERT INTO structure_model_events(organization_id,id,resource_id,action,model_revision,snapshot,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        this.org,
        uuid(),
        resourceId,
        action,
        model.revision,
        JSON.stringify(snapshot),
        this.ctx.member.id,
      ],
    );
  }
  async recordOccupancy(
    source: string,
    row: any,
    origin?: string,
    agreement: { exitNotBefore?: string; exitAgreement?: string } = {},
  ) {
    const model = await this.model();
    if (!model) return;
    const label =
      origin ??
      (model.phase === "PREPARATION"
        ? "OWNER_PREPARATION"
        : row.kind === "ELECTED"
          ? "ELECTION"
          : "OPERATING_ASSIGNMENT");
    await this.ctx.c.query(
      `INSERT INTO structure_model_occupancy_context(organization_id,source,occupancy_id,model_revision,origin,exit_not_before,exit_agreement) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [
        this.org,
        source,
        row.id,
        model.revision,
        label,
        agreement.exitNotBefore ?? null,
        agreement.exitAgreement ?? null,
      ],
    );
    const role = await this.entity(row.role_id, "ROLE");
    await this.audit(row.role_id, "RoleEnergized", {
      occupancy: camel(row),
      source,
      origin: label,
      phase: model.phase,
      rules: model.rules,
      function: await this.binding(role.id),
      circleConfiguration: await this.circle(role.parent_id),
      agreement,
    });
  }
  async recordEnd(source: string, row: any) {
    await this.audit(row.role_id, "RoleEnergizationEnded", {
      occupancy: camel(row),
      source,
    });
  }
  async revision() {
    const model = await this.model();
    const functions = (
      await this.ctx.c.query(
        "SELECT role_id,function_code,version FROM structure_model_functions WHERE organization_id=$1",
        [this.org],
      )
    ).rows.map(camel);
    await this.ctx.c.query(
      "INSERT INTO structure_model_revisions(organization_id,revision,snapshot,actor_id) VALUES($1,$2,$3,$4)",
      [
        this.org,
        model!.revision,
        JSON.stringify({ ...model, functions }),
        this.ctx.member.id,
      ],
    );
  }
  async ensureCircle(circleId: string) {
    const model = await this.model();
    if (!model) return;
    const circle = await this.entity(circleId, "CIRCLE");
    const created = await this.ctx.c.query(
      "INSERT INTO structure_model_circles(organization_id,circle_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING circle_id",
      [this.org, circleId],
    );
    if (!created.rowCount) return; // deliberately do not resurrect locally removed roles.
    for (const code of model.rules.essentialFunctions) {
      const d = {name:definitions[code].name,...model.rules.essentialDefinitions[code]},
        roleId = uuid();
      const items = (values: string[]) =>
        values.map((value) => ({ id: uuid(), text: value }));
      await this.ctx.c.query(
        `INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name,purpose,responsibilities,artifacts) VALUES($1,$2,$3,'ROLE',$4,$5,$6,$7,$8)`,
        [
          this.org,
          roleId,
          uuid(),
          circle.id,
          d.name,
          ["GUIDE", "REPRESENTATIVE"].includes(code) && model.overrides.essentialDefinitions?.[code]?.purpose === undefined
            ? circle.purpose
            : d.purpose,
          JSON.stringify(items(d.responsibilities)),
          JSON.stringify(items(d.artifacts)),
        ],
      );
      await this.ctx.c.query(
        "INSERT INTO structure_model_functions(organization_id,role_id,function_code) VALUES($1,$2,$3)",
        [this.org, roleId, code],
      );
      await this.ctx.c.query(
        "INSERT INTO structure_role_settings(organization_id,role_id,flags) VALUES($1,$2,$3)",
        [
          this.org,
          roleId,
          JSON.stringify({
            core: false,
            electable: model.rules.electedFunctions.includes(code),
            assigner: false,
            representative: false,
            admin: false,
          }),
        ],
      );
    }
    await this.audit(circleId, "O2CircleInitialized", {
      functions: model.rules.essentialFunctions,
    });
  }
  async install() {
    writable(this.ctx);
    if (!isOwner(this.ctx)) fail(403, "ACTION_DENIED");
    if (await this.model()) return this.summary();
    await this.ctx.c.query(
      "INSERT INTO structure_governance_models(organization_id,package_id,package_version,source_reference,phase) VALUES($1,$2,$3,$4,'PREPARATION')",
      [
        this.org,
        o2Package.id,
        o2Package.version,
        JSON.stringify(o2Package.reference),
      ],
    );
    for (const row of (
      await this.ctx.c.query(
        "SELECT id FROM entities WHERE organization_id=$1 AND kind='CIRCLE' AND NOT archived ORDER BY id",
        [this.org],
      )
    ).rows)
      await this.ensureCircle(row.id);
    await this.revision();
    await this.audit(this.org, "GovernancePackageInstalled", {
      package: o2Package,
    });
    return this.summary();
  }
  async update(overrides: unknown) {
    writable(this.ctx);
    if (!isOwner(this.ctx)) fail(403, "ACTION_DENIED");
    const validated = resolveRules(overrides);
    if (!(await this.model())) fail(409, "MODEL_NOT_INSTALLED");
    await this.ctx.c.query(
      "UPDATE structure_governance_models SET overrides=$2,revision=revision+1 WHERE organization_id=$1",
      [this.org, JSON.stringify(validated.overrides)],
    );
    await this.revision();
    await this.audit(this.org, "GovernanceModelAdapted", validated);
    return this.summary();
  }
  async start() {
    writable(this.ctx);
    if (!isOwner(this.ctx)) fail(403, "ACTION_DENIED");
    if (!(await this.model())) fail(409, "MODEL_NOT_INSTALLED");
    await this.ctx.c.query(
      "UPDATE structure_governance_models SET phase='OPERATING',started_at=clock_timestamp(),revision=revision+1 WHERE organization_id=$1 AND phase='PREPARATION'",
      [this.org],
    );
    const exists = (
      await this.ctx.c.query(
        "SELECT 1 FROM structure_model_revisions WHERE organization_id=$1 AND revision=$2",
        [this.org, (await this.model())!.revision],
      )
    ).rowCount;
    if (!exists) {
      await this.revision();
      await this.audit(this.org, "OrganizationOperationStarted", {});
    }
    return this.summary();
  }
  async pause() {
    writable(this.ctx);
    if (!isOwner(this.ctx)) fail(403, "ACTION_DENIED");
    if (!(await this.model())) fail(409, "MODEL_NOT_INSTALLED");
    await this.ctx.c.query(
      "UPDATE structure_governance_models SET phase='PREPARATION',revision=revision+1 WHERE organization_id=$1 AND phase='OPERATING'",
      [this.org],
    );
    const exists = (
      await this.ctx.c.query(
        "SELECT 1 FROM structure_model_revisions WHERE organization_id=$1 AND revision=$2",
        [this.org, (await this.model())!.revision],
      )
    ).rowCount;
    if (!exists) {
      await this.revision();
      await this.audit(this.org, "OrganizationOperationPaused", {});
    }
    return this.summary();
  }
  async importArchive(bytes: Buffer) {
    writable(this.ctx);
    if (!isOwner(this.ctx)) fail(403, "ACTION_DENIED");
    const model = await this.model();
    if (!model) fail(409, "MODEL_NOT_INSTALLED");
    if (model!.phase !== "PREPARATION") fail(409, "IMPORT_REQUIRES_PREPARATION");
    const foundation = this.core?.foundationStructure();
    if (!foundation?.recordFoundationChange)
      fail(503, "STRUCTURE_CONFIGURATION_REQUIRED");
    const port = foundation!;
    const source = parseGovernanceArchive(bytes),
      skipped: { file: string; reference: string; reason: string }[] = [],
      skip = (file: string, reference: string, reason: string) => {
        if (skipped.length < 100) skipped.push({ file, reference, reason });
      },
      items = (lines: string) =>
        lines
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 100)
          .map((value) => ({ id: uuid(), text: value }));
    const root = (
      await this.ctx.c.query(
        "SELECT * FROM entities WHERE organization_id=$1 AND kind='CIRCLE' AND parent_id IS NULL AND NOT archived",
        [this.org],
      )
    ).rows[0];
    if (!root) fail(409, "STATE_CONFLICT");
    const circles = new Map<string, string>(),
      members = new Map<string, string>(),
      pending = new Map(source.circles.map((row) => [row.sourceId, row])),
      strategies: { circleId: string; value: string }[] = [];
    for (const row of (
      await this.ctx.c.query(
        "SELECT m.id,a.email FROM members m JOIN accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND m.status='ACTIVE' AND coalesce(to_jsonb(m)->>'member_type','MEMBER')='MEMBER'",
        [this.org],
      )
    ).rows)
      members.set(String(row.email).toLowerCase(), row.id);
    let anchor: (typeof source.circles)[number] | undefined;
    for (const row of source.circles)
      if (!row.parentSourceId && !anchor) anchor = row;
    const createEntity = async (
      kind: "CIRCLE" | "ROLE",
      parentId: string,
      input: {
        name: string;
        purpose: string;
        responsibilities: { id: string; text: string }[];
        artifacts: { id: string; text: string }[];
      },
    ) => {
      const entityId = uuid(),
        e = (
          await this.ctx.c.query(
            "INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name,purpose) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              this.org,
              entityId,
              uuid(),
              kind,
              parentId,
              text(input.name, 400),
              optionalText(input.purpose, 10000),
            ],
          )
        ).rows[0];
      const definition = await port.writeEntityDefinition?.(this.ctx, {
        entityId,
        entityVersion: e.version,
        responsibilities: input.responsibilities,
        artifacts: input.artifacts,
      });
      if (definition) Object.assign(e, definition);
      await port.recordFoundationChange(this.ctx, {
        resourceId: entityId,
        action: kind + "Created",
        before: null,
        after: e,
      });
      return e;
    };
    // Anchor circle merges into the existing organization root.
    if (anchor) {
      pending.delete(anchor.sourceId);
      circles.set(anchor.sourceId, root.id);
      const responsibilities = items(anchor.accountabilities),
        artifacts = items(anchor.domains);
      if (
        anchor.purpose.trim() ||
        responsibilities.length ||
        artifacts.length ||
        anchor.strategy.trim()
      ) {
        const before = { ...root };
        if (anchor.purpose.trim())
          await port.writeEntityPurpose?.(this.ctx, {
            entityId: root.id,
            entityVersion: root.version,
            purpose: anchor.purpose,
          });
        const definition = await port.writeEntityDefinition?.(this.ctx, {
          entityId: root.id,
          entityVersion: root.version,
          responsibilities: [
            ...(root.responsibilities ?? []),
            ...responsibilities,
          ],
          artifacts: [...(root.artifacts ?? []), ...artifacts],
        });
        if (definition) Object.assign(root, definition);
        Object.assign(
          root,
          (
            await this.ctx.c.query(
              "UPDATE entities SET version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
              [this.org, root.id],
            )
          ).rows[0],
        );
        await port.recordFoundationChange(this.ctx, {
          resourceId: root.id,
          action: "StructureEntityUpdated",
          before,
          after: root,
        });
      }
      if (anchor.strategy.trim())
        strategies.push({ circleId: root.id, value: anchor.strategy.trim() });
    }
    let advanced = true;
    while (pending.size && advanced) {
      advanced = false;
      for (const [sourceId, row] of pending) {
        const parentId = circles.get(row.parentSourceId);
        if (!parentId) {
          if (![...pending.keys()].includes(row.parentSourceId)) {
            skip("circles.csv", row.name || sourceId, "PARENT_NOT_FOUND");
            pending.delete(sourceId);
          }
          continue;
        }
        if (!row.name) {
          skip("circles.csv", sourceId, "NAME_REQUIRED");
          pending.delete(sourceId);
          continue;
        }
        const e = await createEntity("CIRCLE", parentId, {
          name: row.name,
          purpose: row.purpose,
          responsibilities: items(row.accountabilities),
          artifacts: items(row.domains),
        });
        circles.set(sourceId, e.id);
        if (row.strategy.trim())
          strategies.push({ circleId: e.id, value: row.strategy.trim() });
        pending.delete(sourceId);
        advanced = true;
      }
    }
    for (const [sourceId, row] of pending)
      skip("circles.csv", row.name || sourceId, "PARENT_NOT_FOUND");
    const report = {
      circles: circles.size,
      roles: 0,
      assignments: 0,
      policies: 0,
      documents: 0,
      strategies: 0,
      skipped,
      unmatchedMembers: [] as string[],
      rootCircleId: root.id,
    };
    const roles = new Map<string, string>();
    for (const row of source.roles) {
      const parentId = circles.get(row.circleSourceId);
      if (!parentId) {
        skip("roles.csv", row.name || row.sourceId, "CIRCLE_NOT_FOUND");
        continue;
      }
      if (!row.name) {
        skip("roles.csv", row.sourceId, "NAME_REQUIRED");
        continue;
      }
      const e = await createEntity("ROLE", parentId, {
        name: row.name,
        purpose: row.purpose,
        responsibilities: items(row.accountabilities + "\n" + row.extraAccountabilities),
        artifacts: items(row.domains + "\n" + row.extraDomains),
      });
      roles.set(row.sourceId, e.id);
      report.roles++;
    }
    if (strategies.length) {
      let field = (
        await this.ctx.c.query(
          "SELECT * FROM structure_fields WHERE organization_id=$1 AND key='strategy'",
          [this.org],
        )
      ).rows[0];
      if (!field) {
        const fieldId = uuid();
        field = (
          await this.ctx.c.query(
            "INSERT INTO structure_fields(organization_id,id,key,label,target,schema,governed) VALUES($1,$2,'strategy','Strategy','CIRCLE',$3,false) RETURNING *",
            [this.org, fieldId, JSON.stringify({ type: "TEXT", required: false })],
          )
        ).rows[0];
        await this.ctx.c.query(
          "INSERT INTO structure_field_revisions(organization_id,field_id,version,definition) VALUES($1,$2,$3,$4)",
          [this.org, fieldId, field.version, JSON.stringify(camel(field))],
        );
        await port.recordFoundationChange(this.ctx, {
          resourceId: fieldId,
          action: "StructureFieldDefined",
          before: null,
          after: field,
        });
      }
      if (
        !["CIRCLE", "BOTH"].includes(field.target) ||
        field.schema?.type !== "TEXT"
      )
        skip("circles.csv", "Strategy", "FIELD_SCHEMA_INCOMPATIBLE");
      else
        for (const entry of strategies) {
          const value = (
            await this.ctx.c.query(
              "INSERT INTO structure_values(organization_id,entity_id,field_id,value,schema_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,entity_id,field_id) DO UPDATE SET value=excluded.value,schema_version=excluded.schema_version,version=structure_values.version+1 RETURNING *",
              [
                this.org,
                entry.circleId,
                field.id,
                JSON.stringify(entry.value.slice(0, 10000)),
                field.version,
              ],
            )
          ).rows[0];
          await port.recordFoundationChange(this.ctx, {
            resourceId: entry.circleId,
            action: "StructureFieldValueChanged",
            before: null,
            after: value,
          });
          report.strategies++;
        }
    }
    const unmatched = new Set<string>(),
      energized = new Set<string>();
    for (const row of source.assignments) {
      const roleId = roles.get(row.roleSourceId);
      if (!roleId) {
        skip("assignments.csv", row.memberEmail || row.roleSourceId, "ROLE_NOT_FOUND");
        continue;
      }
      const memberId = members.get(row.memberEmail.toLowerCase());
      if (!memberId) {
        unmatched.add(row.memberEmail);
        continue;
      }
      const key = memberId + ":" + roleId;
      if (energized.has(key)) {
        skip("assignments.csv", row.memberEmail, "DUPLICATE_ENERGIZATION");
        continue;
      }
      energized.add(key);
      const since = row.since ? new Date(row.since) : null,
        until = row.until ? new Date(row.until) : null;
      await this.assign(roleId, {
        memberId,
        scope: optionalText(row.scope, 10000) || undefined,
        startsAt:
          since && Number.isFinite(+since) ? since.toISOString() : undefined,
        endsAt:
          until && Number.isFinite(+until) && (!since || +until > +since)
            ? until.toISOString()
            : undefined,
      });
      report.assignments++;
    }
    report.unmatchedMembers = [...unmatched].slice(0, 100);
    const documentTypes = new Map<string, string>(),
      documentType = async (name: string) => {
        const key = (name.trim() || "Other").toLowerCase();
        if (!documentTypes.has(key)) {
          const found = (
            await this.ctx.c.query(
              "SELECT id FROM gov_document_types WHERE organization_id=$1 AND lower(name)=$2 AND active",
              [this.org, key],
            )
          ).rows[0];
          let typeId = found?.id as string | undefined;
          if (!typeId) {
            typeId = uuid();
            await this.ctx.c.query(
              "INSERT INTO gov_document_types(organization_id,id,name,workflow) VALUES($1,$2,$3,'DIRECT')",
              [this.org, typeId, text(name.trim() || "Other", 200)],
            );
            await this.ctx.c.query(
              "INSERT INTO gov_history(organization_id,id,resource_id,actor_id,action,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
              [
                this.org,
                uuid(),
                typeId,
                this.ctx.member.id,
                "DocumentTypeChanged",
                JSON.stringify({ id: typeId, name: name.trim() || "Other", workflow: "DIRECT" }),
              ],
            );
          }
          documentTypes.set(key, typeId);
        }
        return documentTypes.get(key)!;
      },
      createDocument = async (input: {
        ownerId: string;
        title: string;
        content: string;
        visibility: "ORGANIZATION" | "AUTHOR";
        typeId?: string;
        authorId: string;
        publish: boolean;
      }) => {
        const documentId = uuid(),
          row = (
            await this.ctx.c.query(
              "INSERT INTO gov_documents(organization_id,id,owner_id,title,workflow,visibility,author_id,type_id,published_version) VALUES($1,$2,$3,$4,'DIRECT',$5,$6,$7,$8) RETURNING *",
              [
                this.org,
                documentId,
                input.ownerId,
                text(input.title, 400),
                input.visibility,
                input.authorId,
                input.typeId ?? null,
                input.publish ? 1 : null,
              ],
            )
          ).rows[0];
        await this.ctx.c.query(
          "INSERT INTO gov_document_versions(organization_id,document_id,number,content,created_by) VALUES($1,$2,1,$3,$4)",
          [this.org, documentId, optionalText(input.content, 50000), input.authorId],
        );
        await this.ctx.c.query(
          "INSERT INTO gov_history(organization_id,id,resource_id,actor_id,action,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
          [
            this.org,
            uuid(),
            documentId,
            this.ctx.member.id,
            "DocumentDrafted",
            JSON.stringify(row),
          ],
        );
        return row;
      };
    for (const row of source.policies) {
      const ownerId = row.roleSourceId
        ? roles.get(row.roleSourceId)
        : circles.get(row.circleSourceId);
      if (!ownerId || !row.title) {
        skip("policies.csv", row.title || row.circleSourceId, ownerId ? "TITLE_REQUIRED" : "OWNER_NOT_FOUND");
        continue;
      }
      await createDocument({
        ownerId,
        title: row.title,
        content: (row.domain.trim() ? "Domínio: " + row.domain.trim() + "\n\n" : "") + row.description,
        visibility: "ORGANIZATION",
        typeId: await documentType("Política"),
        authorId: this.ctx.member.id,
        publish: true,
      });
      report.policies++;
    }
    for (const row of source.documents) {
      const ownerId = row.roleSourceId
        ? roles.get(row.roleSourceId)
        : circles.get(row.circleSourceId);
      if (!ownerId || !row.title) {
        skip("documents.csv", row.title || row.circleSourceId, ownerId ? "TITLE_REQUIRED" : "OWNER_NOT_FOUND");
        continue;
      }
      await createDocument({
        ownerId,
        title: row.title,
        content: row.description,
        visibility: row.privacy === "PRIVATE" ? "AUTHOR" : "ORGANIZATION",
        typeId: await documentType(row.type),
        authorId:
          members.get(row.memberEmail.toLowerCase()) ?? this.ctx.member.id,
        publish: row.status === "PUBLISHED",
      });
      report.documents++;
    }
    await this.ctx.c.query(
      "UPDATE structure_governance_models SET revision=revision+1 WHERE organization_id=$1",
      [this.org],
    );
    await this.revision();
    await this.audit(this.org, "GovernanceStructureImported", report);
    return { ...(await this.summary()), import: report };
  }
  async configureCircle(circleId: string, selfAssignment: unknown) {
    writable(this.ctx);
    if (typeof selfAssignment !== "boolean") fail(400, "INVALID_REQUEST");
    if (!(await this.model())) fail(409, "MODEL_NOT_INSTALLED");
    await this.entity(circleId, "CIRCLE");
    if (!isOwner(this.ctx) && !(await this.hasFunction(circleId, "GUIDE")))
      fail(403, "ACTION_DENIED");
    await this.ctx.c.query(
      `INSERT INTO structure_model_circles(organization_id,circle_id,self_assignment,version) VALUES($1,$2,$3,1) ON CONFLICT(organization_id,circle_id) DO UPDATE SET self_assignment=$3,version=structure_model_circles.version+1`,
      [this.org, circleId, selfAssignment],
    );
    const result = await this.circle(circleId);
    await this.audit(circleId, "SelfAssignmentConfigured", result);
    return result;
  }
  async setFunction(roleId: string, code: unknown) {
    writable(this.ctx);
    if (!isOwner(this.ctx)) fail(403, "ACTION_DENIED");
    if (code !== null && !functionCodes.includes(code as RoleFunction))
      fail(422, "UNSUPPORTED_ROLE_FUNCTION");
    const role = await this.entity(roleId, "ROLE"),
      model = await this.model();
    if (!model) fail(409, "MODEL_NOT_INSTALLED");
    const before = await this.binding(roleId);
    if (
      code &&
      (
        await this.ctx.c.query(
          `SELECT 1 FROM structure_model_functions f JOIN entities r ON r.organization_id=f.organization_id AND r.id=f.role_id WHERE f.organization_id=$1 AND r.parent_id=$2 AND NOT r.archived AND f.role_id<>$3 AND f.function_code=$4`,
          [this.org, role.parent_id, roleId, code],
        )
      ).rowCount
    )
      fail(409, "ROLE_FUNCTION_ALREADY_BOUND");
    await this.ctx.c.query(
      `INSERT INTO structure_model_functions(organization_id,role_id,function_code) VALUES($1,$2,$3) ON CONFLICT(organization_id,role_id) DO UPDATE SET function_code=$3,version=structure_model_functions.version+1`,
      [this.org, roleId, code],
    );
    await this.ctx.c.query(
      "UPDATE structure_governance_models SET revision=revision+1 WHERE organization_id=$1",
      [this.org],
    );
    await this.revision();
    const after = await this.binding(roleId);
    await this.audit(roleId, "RoleFunctionBound", { before, after });
    return after;
  }
  async preflight(input: {
    operation: string;
    entityId?: string;
    changedFields?: string[];
  }) {
    const model = await this.model();
    if (
      !model ||
      model.phase === "PREPARATION" ||
      !model.rules.protectEssentials ||
      !input.entityId
    )
      return;
    const e = await this.entity(input.entityId);
    if (e.kind !== "ROLE") return;
    const fn = (await this.binding(e.id)).functionCode;
    if (!fn || !model.rules.essentialFunctions.includes(fn)) return;
    if (
      input.operation === "ARCHIVE" ||
      input.operation === "MOVE" ||
      input.changedFields?.some((k) =>
        ["name", "purpose", "purposeRich"].includes(k),
      )
    )
      fail(422, "ESSENTIAL_ROLE_PROTECTED");
    // Definition changes requiring delegation remain explicit; custom models can revise this rule.
    if (
      input.changedFields?.some((k) =>
        ["responsibilities", "artifacts"].includes(k),
      )
    )
      fail(422, "ESSENTIAL_DEFINITION_REQUIRES_MODEL_ADAPTATION");
  }
  async validateElection(input: {
    circleId: string;
    roleId: string;
    winnerId?: string | null;
    mandateEnd?: string;
  }) {
    const model = await this.model();
    if (!model) return;
    const role = await this.entity(input.roleId, "ROLE");
    if (role.parent_id !== input.circleId)
      fail(422, "ELECTION_CIRCLE_MISMATCH");
    const fn = (await this.binding(role.id)).functionCode;
    if (!fn || !model.rules.electedFunctions.includes(fn))
      fail(422, "ROLE_NOT_ELECTABLE");
    if (input.winnerId)
      await this.validateAssignment({
        roleId: role.id,
        memberId: input.winnerId,
        election: true,
        endsAt: input.mandateEnd,
      });
  }
  async governedChanges() {
    const model = await this.model();
    return (
      !!model &&
      model.phase === "OPERATING" &&
      model.rules.structureChanges === "GOVERNANCE"
    );
  }
  async validateDocument(input: { circleId: string; documentId: string }) {
    const model = await this.model();
    if (
      !model ||
      model.phase === "PREPARATION" ||
      model.rules.structureChanges === "LEGACY"
    )
      return;
    await validateGovernanceDocumentScope(this.ctx, input);
  }
  async validateChanges(input: { circleId: string; changes: any[] }) {
    const model = await this.model();
    if (
      !model ||
      model.phase === "PREPARATION" ||
      model.rules.structureChanges === "LEGACY"
    )
      return;
    const created = new Map(
      input.changes
        .filter((c) => c.kind === "CREATE")
        .map((c) => [
          c.entityId,
          { id: c.entityId, parent_id: c.parentCircleId, kind: c.entityKind },
        ]),
    );
    const lookup = async (entityId: string) =>
      created.get(entityId) ?? this.entity(entityId);
    for (const change of input.changes) {
      if (change.kind === "CREATE") {
        if (change.parentCircleId !== input.circleId) {
          const parent = await lookup(change.parentCircleId);
          if (parent.parent_id !== input.circleId || !created.has(parent.id))
            fail(422, "GOVERNANCE_CIRCLE_SCOPE");
        }
        continue;
      }
      const e = await lookup(change.entityId);
      if (change.kind === "MOVE") {
        const target = await lookup(change.parentCircleId),
          parent = await lookup(e.parent_id);
        if (!(
          (e.parent_id === input.circleId &&
            target.parent_id === input.circleId) ||
          (parent.parent_id === input.circleId && target.id === input.circleId)
        ))
          fail(422, "GOVERNANCE_CIRCLE_SCOPE");
      } else if (e.parent_id !== input.circleId)
        fail(422, "GOVERNANCE_CIRCLE_SCOPE");
    }
  }
  async summary() {
    const model = await this.model();
    if (!model)
      return {
        installed: false,
        package: o2Package,
        canManage: isOwner(this.ctx),
      };
    const memberCircles = new Map<string, string[]>();
    for (const m of (
      await this.ctx.c.query(
        "SELECT id FROM members WHERE organization_id=$1 AND status='ACTIVE' AND coalesce(to_jsonb(members)->>'member_type','MEMBER')='MEMBER'",
        [this.org],
      )
    ).rows)
      memberCircles.set(m.id, await this.memberCircles(m.id));
    const circles = [];
    for (const row of (
      await this.ctx.c.query(
        "SELECT id FROM entities WHERE organization_id=$1 AND kind='CIRCLE' AND NOT archived ORDER BY name,id",
        [this.org],
      )
    ).rows)
      circles.push({
        ...(await this.circle(row.id)),
        memberIds: [...memberCircles]
          .filter(([, circles]) => circles.includes(row.id))
          .map(([memberId]) => memberId),
        canConfigure:
          isOwner(this.ctx) || (await this.hasFunction(row.id, "GUIDE")),
      });
    const bindings = (
      await this.ctx.c.query(
        "SELECT role_id,function_code,version FROM structure_model_functions WHERE organization_id=$1",
        [this.org],
      )
    ).rows.map(camel);
    return {
      installed: true,
      package: o2Package,
      ...model,
      essentialDefinitionDefaults: structuredClone(essentialDefinitionDefaults),
      canManage: isOwner(this.ctx),
      circles,
      bindings,
    };
  }
  async roleDetail(roleId: string) {
    const role = await this.entity(roleId, "ROLE");
    if (!(await this.model())) fail(409, "MODEL_NOT_INSTALLED");
    const members = (
      await this.ctx.c.query(
        "SELECT m.id,a.display_name,a.email FROM members m JOIN accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND m.status='ACTIVE' AND coalesce(to_jsonb(m)->>'member_type','MEMBER')='MEMBER' ORDER BY a.display_name,m.id",
        [this.org],
      )
    ).rows.map(camel);
    const occupancies: any[] = [];
    for (const source of ["OCCUPANCY", "MANDATE"]) {
      const table =
        source === "OCCUPANCY" ? "occupancies" : "structure_mandates";
      for (const row of (
        await this.ctx.c.query(
          `SELECT o.*,c.exit_not_before,c.exit_agreement,c.origin,c.model_revision FROM ${table} o LEFT JOIN structure_model_occupancy_context c ON c.organization_id=o.organization_id AND c.occupancy_id=o.id AND c.source=$3 WHERE o.organization_id=$1 AND o.role_id=$2 ORDER BY starts_at,id`,
          [this.org, role.id, source],
        )
      ).rows) {
        let canEnd = false;
        try {
          canEnd = await this.endAllowed(source, row.id);
        } catch {}
        occupancies.push({
          ...camel(row),
          source,
          canEnd:
            canEnd &&
            !row.ended_at &&
            (!row.ends_at || new Date(row.ends_at) > (await this.now())),
        });
      }
    }
    const canSelfAssign = await this.assignmentAllowed({
      roleId,
      memberId: this.ctx.member.id,
    });
    const other = members.find((m) => m.id !== this.ctx.member.id);
    const canAssignOthers = other
      ? await this.assignmentAllowed({ roleId, memberId: other.id })
      : false;
    return {
      ...(await this.binding(roleId)),
      canAssign: canSelfAssign || canAssignOthers,
      canSelfAssign,
      canAssignOthers,
      canLeave: occupancies.some(
        (o) => o.memberId === this.ctx.member.id && o.canEnd,
      ),
      occupancies,
      members,
    };
  }
  async assign(roleId: string, input: any) {
    writable(this.ctx);
    const role = await this.entity(roleId, "ROLE");
    if (
      !(await this.assignmentAllowed({ roleId, memberId: id(input.memberId) }))
    )
      fail(403, "ACTION_DENIED");
    await this.validateAssignment({
      roleId,
      memberId: input.memberId,
      kind: "DIRECT",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    const start =
        input.startsAt === undefined
          ? await this.now()
          : new Date(input.startsAt),
      end = input.endsAt ? new Date(input.endsAt) : null;
    const exit = input.exitNotBefore ? new Date(input.exitNotBefore) : null;
    if (
      !Number.isFinite(+start) ||
      (end && (!Number.isFinite(+end) || end <= start)) ||
      (exit && !Number.isFinite(+exit))
    )
      fail(422, "DOMAIN_INVARIANT");
    if (input.exitAgreement && !exit)
      fail(422, "STRUCTURED_EXIT_AGREEMENT_REQUIRED");
    const row = (
      await this.ctx.c.query(
        "INSERT INTO occupancies(organization_id,id,role_id,member_id,kind,scope,starts_at,ends_at) VALUES($1,$2,$3,$4,'DIRECT',$5,$6,$7) RETURNING *",
        [
          this.org,
          uuid(),
          roleId,
          input.memberId,
          optionalText(input.scope, 10000),
          start,
          end,
        ],
      )
    ).rows[0];
    await this.recordOccupancy("OCCUPANCY", row, undefined, {
      exitNotBefore: exit?.toISOString(),
      exitAgreement: input.exitAgreement
        ? text(input.exitAgreement, 2000)
        : undefined,
    });
    await this.core?.foundationStructure()?.recordFoundationChange(this.ctx, {
      resourceId: row.id, action: "RoleOccupied", before: null, after: row,
    });
    return { occupancy: { ...camel(row), circleId: role.parent_id } };
  }
  async end(source: string, occupancyId: string) {
    writable(this.ctx);
    if (!(await this.endAllowed(source, occupancyId)))
      fail(403, "ACTION_DENIED");
    const before = await this.occupancy(source, occupancyId);
    if (
      before.ended_at ||
      (before.ends_at && new Date(before.ends_at) <= (await this.now()))
    )
      fail(409, "STATE_CONFLICT");
    const table = source === "OCCUPANCY" ? "occupancies" : "structure_mandates",
      column = source === "OCCUPANCY" ? "ends_at" : "ended_at";
    const row = (
      await this.ctx.c.query(
        `UPDATE ${table} SET ${column}=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [this.org, id(occupancyId)],
      )
    ).rows[0];
    await this.recordEnd(source, row);
    await this.core?.foundationStructure()?.recordFoundationChange(this.ctx, {
      resourceId: row.id, action: "RoleOccupancyEnded", before, after: row,
    });
    return { occupancy: camel(row) };
  }
}

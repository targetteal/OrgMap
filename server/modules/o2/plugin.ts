import type { Ctx, OrgMapModule, ModuleRuntime } from "../../src/runtime.js";
import { body, fail, id, version } from "../../src/core.js";
import { GovernanceModel } from "./service.js";
import { o2Package } from "./package.js";
import type { GovernanceModelPort } from "./contract.js";
export function createGovernanceModelPort(
  core: ModuleRuntime,
): GovernanceModelPort {
  const service = (ctx: Ctx) => new GovernanceModel(ctx, core);
  return {
    state: (ctx) => service(ctx).model(),
    governancePolicy: (ctx) => service(ctx).governancePolicy(),
    summary: (ctx) => service(ctx).summary(),
    roleFunctions: (ctx, circleId) => service(ctx).roleFunctions(circleId),
    hasFunction: (ctx, circleId, code, memberId) =>
      service(ctx).hasFunction(circleId, code, memberId),
    reasons: (ctx, m) => service(ctx).reasons(m),
    participates: (ctx, c) => service(ctx).participates(c),
    authorizeCircle: (ctx, c, a) => service(ctx).authorizeCircle(c, a),
    authorizeAssignment: (ctx, i) => service(ctx).authorizeAssignment(i),
    authorizeEnd: (ctx, s, i) => service(ctx).authorizeEnd(s, i),
    validateAssignment: (ctx, i) => service(ctx).validateAssignment(i),
    recordOccupancy: (ctx, s, r, o, a) =>
      service(ctx).recordOccupancy(s, r, o, a),
    recordEnd: (ctx, s, r) => service(ctx).recordEnd(s, r),
    recordStructureChange:async(ctx,input)=>{const s=service(ctx),m=await s.model();if(m)await s.audit(input.resourceId,input.action,{...input,origin:m.phase==='PREPARATION'?'OWNER_PREPARATION':'OPERATING_CHANGE',phase:m.phase});},
    ensureCircle: (ctx, c) => service(ctx).ensureCircle(c),
    preflight: (ctx, i) => service(ctx).preflight(i),
    validateElection: (ctx, i) => service(ctx).validateElection(i),
    validateChanges: (ctx, i) => service(ctx).validateChanges(i),
    validateDocument: (ctx, i) => service(ctx).validateDocument(i),
    governedChanges: (ctx) => service(ctx).governedChanges(),
  };
}
export function createGovernanceModelModule(): OrgMapModule {
  return async (app, core) => {
    const base = "/api/v1/organizations/:organizationId/governance-model";
    const owner = (ctx: Ctx) =>
      ctx.member.org_role === "OWNER" && ctx.member.member_type !== "GUEST";
    const read = (r: any, fn: (s: GovernanceModel) => Promise<any>) =>
      core.tenant(
        r,
        {
          mode: "read",
          authorize: (ctx) => ctx.member.member_type !== "GUEST",
        },
        (ctx) => fn(new GovernanceModel(ctx, core)),
      );
    const write = (
      r: any,
      fn: (s: GovernanceModel) => Promise<any>,
      authorize: (ctx: Ctx) => Promise<boolean> | boolean = owner,
    ) =>
      core.tenant(
        r,
        { mode: "authorization_write", authorize },
        async (ctx) => {
          const previous = await core.governanceModel()!.state(ctx);
          const result = await fn(new GovernanceModel(ctx, core));
          const path = r.url.split("?")[0];
          if (
            (path.endsWith("/install") && previous) ||
            (path.endsWith("/start") && previous?.phase === "OPERATING") ||
            (path.endsWith("/pause") && previous?.phase !== "OPERATING")
          )
            return result;
          await core.changed(
            ctx,
            r,
            ctx.org.id,
            "GovernanceModelChanged",
            true,
          );
          return result;
        },
      );
    app.get(base, (r) => read(r, (s) => s.summary()));
    app.get(base + "/history", (r) =>
      read(r, async (s) => ({
        items: (
          await s.ctx.c.query(
            "SELECT revision,snapshot,actor_id,created_at FROM structure_model_revisions WHERE organization_id=$1 ORDER BY revision DESC",
            [s.org],
          )
        ).rows,
      })),
    );
    app.get(base + "/events", (r) =>
      read(r, async (s) => ({
        items: (
          await s.ctx.c.query(
            "SELECT * FROM structure_model_events WHERE organization_id=$1 ORDER BY created_at,id",
            [s.org],
          )
        ).rows,
      })),
    );
    app.post(base + "/install", (r) =>
      write(r, async (s) => {
        const b = body(r, ["packageId"]);
        if (b.packageId !== o2Package.id)
          fail(422, "UNSUPPORTED_GOVERNANCE_PACKAGE");
        return s.install();
      }),
    );
    app.put(base, (r) =>
      write(r, async (s) => {
        const b = body(r, ["overrides"]);
        const m = await s.model();
        if (!m) fail(409, "MODEL_NOT_INSTALLED");
        version(r, m!.revision);
        return s.update(b.overrides);
      }),
    );
    app.post(base + "/start", (r) =>
      write(r, async (s) => {
        body(r, []);
        const m = await s.model();
        if (!m) fail(409, "MODEL_NOT_INSTALLED");
        version(r, m!.revision);
        return s.start();
      }),
    );
    app.post(base + "/pause", (r) =>
      write(r, async (s) => {
        body(r, []);
        const m = await s.model();
        if (!m) fail(409, "MODEL_NOT_INSTALLED");
        version(r, m!.revision);
        return s.pause();
      }),
    );
    for (const contentType of [
      "application/zip",
      "application/x-zip-compressed",
      "application/octet-stream",
    ])
      app.addContentTypeParser(
        contentType,
        { parseAs: "buffer", bodyLimit: 8 * 1024 * 1024 },
        (_request, data, done) => done(null, data),
      );
    app.post(base + "/import", (r) =>
      write(r, async (s) => {
        if (!Buffer.isBuffer(r.body) || !(r.body as Buffer).length)
          fail(400, "INVALID_REQUEST");
        const m = await s.model();
        if (!m) fail(409, "MODEL_NOT_INSTALLED");
        version(r, m!.revision);
        return s.importArchive(r.body as Buffer);
      }),
    );
    app.put(base + "/circles/:circleId", (r) =>
      write(
        r,
        async (s) => {
          const circleId = id((r.params as any).circleId),
            b = body(r, ["selfAssignment"]);
          version(r, (await s.circle(circleId)).version);
          return s.configureCircle(circleId, b.selfAssignment);
        },
        async (ctx) => {
          const s = new GovernanceModel(ctx),
            circleId = id((r.params as any).circleId);
          await s.entity(circleId, "CIRCLE");
          return owner(ctx) || s.hasFunction(circleId, "GUIDE");
        },
      ),
    );
    app.put(base + "/roles/:roleId/function", (r) =>
      write(r, async (s) => {
        const roleId = id((r.params as any).roleId),
          b = body(r, ["functionCode"]);
        version(r, (await s.binding(roleId)).version);
        return s.setFunction(roleId, b.functionCode);
      }),
    );
    app.get(base + "/roles/:roleId", (r) =>
      read(r, (s) => s.roleDetail(id((r.params as any).roleId))),
    );
    app.post(base + "/roles/:roleId/occupancies", (r) =>
      write(
        r,
        (s) =>
          s.assign(
            id((r.params as any).roleId),
            body(r, [
              "memberId",
              "startsAt",
              "endsAt",
              "scope",
              "exitNotBefore",
              "exitAgreement",
            ]),
          ),
        async (ctx) => {
          const b = body(r, [
            "memberId",
            "startsAt",
            "endsAt",
            "scope",
            "exitNotBefore",
            "exitAgreement",
          ]);
          return new GovernanceModel(ctx, core).assignmentAllowed({
            roleId: id((r.params as any).roleId),
            memberId: id(b.memberId),
          });
        },
      ),
    );
    app.post(base + "/occupancies/:source/:occupancyId/end", (r) =>
      write(
        r,
        async (s) => {
          body(r, []);
          const p = r.params as any;
          version(r, (await s.occupancy(p.source, id(p.occupancyId))).version);
          return s.end(p.source, p.occupancyId);
        },
        async (ctx) => {
          const p = r.params as any;
          return new GovernanceModel(ctx, core).endAllowed(
            p.source,
            id(p.occupancyId),
          );
        },
      ),
    );
  };
}

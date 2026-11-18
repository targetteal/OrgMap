import type { FastifyInstance } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import {
  body,
  fail,
  id,
  text,
  optionalText,
  uuid,
  version,
} from "../../src/core.js";
import type {
  EnrollmentConfiguration,
  ProvisioningProfile,
  ProvisioningProjection,
} from "./enrollment-ports.js";
const schema = "urn:ietf:params:scim:schemas:core:2.0:User",
  extension = "urn:orgmap:params:scim:schemas:extension:enrollment:2.0:User";
const opaque = (value: unknown, max = 255) => {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    value.includes("\0")
  )
    fail(400, "INVALID_REQUEST");
  return value as string;
};
function profileInput(b: Record<string, any>) {
  if (
    !Array.isArray(b.schemas) ||
    b.schemas.length !== 1 ||
    b.schemas[0] !== schema ||
    typeof b.active !== "boolean" ||
    !Array.isArray(b.emails) ||
    b.emails.length !== 1
  )
    fail(400, "INVALID_REQUEST");
  const email = b.emails[0];
  if (
    !email ||
    typeof email !== "object" ||
    Object.keys(email).some((k) => !["value", "type", "primary"].includes(k)) ||
    typeof email.value !== "string" ||
    email.value.includes("\0") ||
    (email.primary !== undefined && typeof email.primary !== "boolean") ||
    (email.type !== undefined && typeof email.type !== "string") ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value) ||
    email.value.length > 254
  )
    fail(400, "INVALID_REQUEST");
  return {
    externalId: opaque(b.externalId),
    userName: text(b.userName, 254),
    email: email.value.toLowerCase(),
    displayName: optionalText(b.displayName, 200),
    active: b.active as boolean,
  };
}
const dto = (row: any, projection: ProvisioningProjection) => ({
  schemas: [schema, extension],
  id: row.id,
  externalId: row.external_id,
  userName: row.user_name,
  displayName: row.display_name,
  emails: [{ value: row.email, primary: true }],
  active: row.administrative_active,
  [extension]: {
    provisioningState: projection.provisioningState,
    effectiveAccess:
      projection.provisioningState === "ACTIVE" && projection.active,
    enrollmentVersion: projection.version,
  },
  meta: { resourceType: "User", version: `"${row.version}"` },
});
export async function registerEnrollmentScim(
  app: FastifyInstance,
  core: ModuleRuntime,
  base: string,
  configuration: EnrollmentConfiguration,
) {
  const root = base + "/scim/v2",
    iam = core;
  async function connection(ctx: Ctx) {
    if (!ctx.principal) fail(403, "SCIM_CREDENTIAL_REQUIRED");
    const row = (
      await ctx.c.query(
        "SELECT k.connection_id FROM interop_credentials k JOIN interop_connections c ON c.organization_id=k.organization_id AND c.id=k.connection_id WHERE k.organization_id=$1 AND k.id=$2 AND k.kind='SCIM' AND c.state<>'REVOKED'",
        [ctx.org.id, ctx.principal!.credentialId],
      )
    ).rows[0];
    if (!row?.connection_id) fail(403, "SCIM_CONNECTION_REQUIRED");
    return row.connection_id as string;
  }
  const access = {
    mode: "authorization_write" as const,
    requiredScopes: ["members.provision"],
  };
  async function projection(ctx: Ctx, row: any) {
    const state = await iam.getProvisionedEnrollment(ctx, {
      connectionId: row.connection_id,
      externalId: row.external_id,
    });
    if (!state) fail(503, "PROVISIONING_STATE_UNAVAILABLE");
    return state!;
  }
  app.addHook("onSend", async (r, reply, payload) => {
    if (!r.routeOptions.url?.startsWith(root) || reply.statusCode < 400)
      return payload;
    let detail = "SCIM_REQUEST_FAILED";
    try {
      detail = JSON.parse(String(payload)).error?.code ?? detail;
    } catch {}
    reply.type("application/scim+json");
    return JSON.stringify({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(reply.statusCode),
      detail,
    });
  });
  app.get(root + "/ServiceProviderConfig", async (r, reply) => {
    await core.tenant(
      r,
      {
        mode: "read",
        requiredScopes: ["members.provision"],
        authorize: (ctx) => ctx.member.org_role === "OWNER",
      },
      async (ctx) => {
        await connection(ctx);
      },
    );
    return reply.type("application/scim+json").send({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: false },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: false, maxResults: 0 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: true },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Connection-scoped provisioning",
          description:
            "Pending enrollment requires mailbox and configured IdP proof",
        },
      ],
    });
  });
  app.post(root + "/Users", async (r, reply) => {
    const result = await core.tenant(r, access, async (ctx) => {
      const connectionId = await connection(ctx),
        b = body(r, [
          "schemas",
          "externalId",
          "userName",
          "displayName",
          "emails",
          "active",
        ]),
        p = profileInput(b),
        mapping = configuration[ctx.org.id + ":" + connectionId],
        value = mapping?.externalIdToValue[p.externalId];
      if (!mapping || value === undefined)
        fail(503, "PROVISIONING_MAPPING_REQUIRED");
      const requestedMemberType = mapping.requestedMemberType ?? "MEMBER";
      if (!["MEMBER", "GUEST"].includes(requestedMemberType))
        fail(503, "PROVISIONING_MAPPING_REQUIRED");
      const existing = (
        await ctx.c.query(
          "SELECT id FROM interop_scim_sources WHERE organization_id=$1 AND connection_id=$2 AND external_id=$3",
          [ctx.org.id, connectionId, p.externalId],
        )
      ).rows[0];
      if (existing) fail(409, "SCIM_USER_EXISTS");
      const row = (
        await ctx.c.query(
          "INSERT INTO interop_scim_sources(organization_id,id,connection_id,external_id,user_name,email,display_name,immutable_subject,administrative_active,requested_member_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            ctx.org.id,
            uuid(),
            connectionId,
            p.externalId,
            p.userName,
            p.email,
            p.displayName,
            value,
            p.active,
            requestedMemberType,
          ],
        )
      ).rows[0];
      const profile: ProvisioningProfile = {
        requestedMemberType,
        userName: p.userName,
        email: p.email,
        displayName: p.displayName || p.userName,
        identity: {
          issuer: mapping.issuer,
          claim: mapping.claim,
          value,
          mappingRevision: mapping.mappingRevision,
        },
      };
      const state = await iam.beginProvisionedEnrollment(
        ctx,
        { connectionId, externalId: p.externalId },
        profile,
        p.active,
      );
      await ctx.c.query(
        "UPDATE interop_scim_sources SET iam_enrollment_id=$3 WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, row.id, state.enrollmentId],
      );
      await core.changed(ctx, r, row.id, "ScimEnrollmentCreated");
      return dto(row, state);
    });
    return reply
      .code(201)
      .type("application/scim+json")
      .header("ETag", result.data.meta.version)
      .send(result.data);
  });
  app.get(root + "/Users", async (r, reply) => {
    const q = r.query as Record<string, string>;
    if (
      Object.keys(q).some((k) => !["startIndex", "count"].includes(k)) ||
      [q.startIndex, q.count].some(
        (v) => v !== undefined && !/^\d{1,9}$/.test(v),
      )
    )
      fail(400, "INVALID_SCIM_PAGINATION");
    const startIndex = Number(q.startIndex ?? 1),
      count = Math.min(100, Number(q.count ?? 100));
    if (startIndex < 1) fail(400, "INVALID_SCIM_PAGINATION");
    const result = await core.tenant(
      r,
      {
        mode: "read",
        requiredScopes: ["members.provision"],
        authorize: (ctx) => ctx.member.org_role === "OWNER",
      },
      async (ctx) => {
        const cid = await connection(ctx),
          total = Number(
            (
              await ctx.c.query(
                "SELECT count(*) AS n FROM interop_scim_sources WHERE organization_id=$1 AND connection_id=$2 AND deleted_at IS NULL",
                [ctx.org.id, cid],
              )
            ).rows[0].n,
          ),
          rows = (
            await ctx.c.query(
              "SELECT * FROM interop_scim_sources WHERE organization_id=$1 AND connection_id=$2 AND deleted_at IS NULL ORDER BY id LIMIT $3 OFFSET $4",
              [ctx.org.id, cid, count, startIndex - 1],
            )
          ).rows;
        const items = [];
        for (const row of rows)
          items.push(dto(row, await projection(ctx, row)));
        return { total, items };
      },
    );
    return reply.type("application/scim+json").send({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: result.data.total,
      startIndex,
      itemsPerPage: result.data.items.length,
      Resources: result.data.items,
    });
  });
  app.get(root + "/Users/:userId", async (r, reply) => {
    const result = await core.tenant(
      r,
      {
        mode: "read",
        requiredScopes: ["members.provision"],
        authorize: (ctx) => ctx.member.org_role === "OWNER",
      },
      async (ctx) => {
        const cid = await connection(ctx),
          row = (
            await ctx.c.query(
              "SELECT * FROM interop_scim_sources WHERE organization_id=$1 AND connection_id=$2 AND id=$3 AND deleted_at IS NULL",
              [ctx.org.id, cid, id((r.params as any).userId)],
            )
          ).rows[0];
        if (!row) fail(404, "RESOURCE_NOT_FOUND");
        return dto(row, await projection(ctx, row));
      },
    );
    return reply
      .type("application/scim+json")
      .header("ETag", result.data.meta.version)
      .send(result.data);
  });
  for (const method of ["PUT", "DELETE"] as const)
    app.route({
      method,
      url: root + "/Users/:userId",
      handler: async (r, reply) => {
        const result = await core.tenant(r, {
          ...access,
          accountLocks: async (c, org, request) => {
            const member = (await c.query(
              `SELECT m.account_id FROM interop_scim_sources s
               JOIN provisioned_enrollments e ON e.organization_id=s.organization_id AND e.id::text=s.iam_enrollment_id
               JOIN members m ON m.organization_id=e.organization_id AND m.id=e.member_id
               WHERE s.organization_id=$1 AND s.id=$2 AND s.deleted_at IS NULL`,
              [org, id((request.params as any).userId)],
            )).rows[0];
            return member ? [member.account_id] : [];
          },
        }, async (ctx) => {
          const cid = await connection(ctx),
            row = (
              await ctx.c.query(
                "SELECT * FROM interop_scim_sources WHERE organization_id=$1 AND connection_id=$2 AND id=$3 AND deleted_at IS NULL",
                [ctx.org.id, cid, id((r.params as any).userId)],
              )
            ).rows[0];
          if (!row) fail(404, "RESOURCE_NOT_FOUND");
          version(r, row.version);
          let active = false;
          if (method === "PUT") {
            const p = profileInput(
              body(r, [
                "schemas",
                "externalId",
                "userName",
                "displayName",
                "emails",
                "active",
              ]),
            );
            if (
              p.externalId !== row.external_id ||
              p.userName !== row.user_name ||
              p.email !== row.email ||
              p.displayName !== row.display_name
            )
              fail(400, "SCIM_IMMUTABLE_PROFILE");
            active = p.active;
          }
          const updated = (
            await ctx.c.query(
              "UPDATE interop_scim_sources SET administrative_active=$3,deleted_at=CASE WHEN $4 THEN now() ELSE NULL END,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
              [ctx.org.id, row.id, active, method === "DELETE"],
            )
          ).rows[0];
          const state = await iam.setProvisionedAccess(
            ctx,
            { connectionId: cid, externalId: row.external_id },
            active,
          );
          await core.changed(ctx, r, row.id, "ScimAdministrativeAccessChanged");
          return dto(updated, state);
        });
        if (method === "DELETE") return reply.code(204).send();
        return reply
          .type("application/scim+json")
          .header("ETag", result.data.meta.version)
          .send(result.data);
      },
    });
}

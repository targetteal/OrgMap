import type { FastifyInstance } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import { body, fail, id, text, uuid, version } from "../../src/core.js";
const schema = "urn:ietf:params:scim:schemas:core:2.0:User";
const dto = (row: any) => ({
  schemas: [schema],
  id: row.id,
  externalId: row.external_id,
  userName: row.user_name,
  active: row.active,
  meta: { resourceType: "User", version: `"${row.version}"` },
});
export async function registerScim(
  app: FastifyInstance,
  core: ModuleRuntime,
  base: string,
) {
  const root = base + "/scim/v2";
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
  const access = {
    mode: "authorization_write" as const,
    requiredScopes: ["members.provision"],
  };
  // Server-owned membership lookup under the Org lock; request IDs never grant locks directly.
  const targetLocks = async (c: import("pg").PoolClient, org: string, r: import("fastify").FastifyRequest) => {
    const userId = (r.params as any).userId;
    const account = userId
      ? (await c.query("SELECT m.account_id FROM interop_scim_users s JOIN members m ON m.organization_id=s.organization_id AND m.id=s.member_id WHERE s.organization_id=$1 AND s.id=$2", [org, id(userId)])).rows[0]
      : (await c.query("SELECT account_id FROM members WHERE organization_id=$1 AND account_id=$2", [org, id((r.body as any)?.externalId)])).rows[0];
    return account ? [account.account_id] : [];
  };
  app.get(root + "/ServiceProviderConfig", async (r, reply) => {
    await core.tenant(
      r,
      { mode: "read", requiredScopes: ["members.provision"] },
      async () => null,
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
          name: "Scoped bearer",
          description: "Organization scoped provisioning credential",
        },
      ],
    });
  });
  app.get(root + "/Users", async (r, reply) => {
    const query = r.query as Record<string, string>;
    if (Object.keys(query).some((k) => !["startIndex", "count"].includes(k)))
      fail(400, "SCIM_QUERY_UNSUPPORTED");
    if (
      [query.startIndex, query.count].some(
        (v) => v !== undefined && !/^\d{1,9}$/.test(v),
      )
    )
      fail(400, "INVALID_SCIM_PAGINATION");
    const startIndex = Number(query.startIndex ?? 1),
      count = Math.min(100, Number(query.count ?? 100));
    if (startIndex < 1) fail(400, "INVALID_SCIM_PAGINATION");
    const result = await core.tenant(
      r,
      {
        mode: "read",
        requiredScopes: ["members.provision"],
        authorize: (ctx) => ctx.member.org_role === "OWNER",
      },
      async (ctx) => ({
        total: Number(
          (
            await ctx.c.query(
              "SELECT count(*) AS n FROM interop_scim_users WHERE organization_id=$1",
              [ctx.org.id],
            )
          ).rows[0].n,
        ),
        items: (
          await ctx.c.query(
            "SELECT * FROM interop_scim_users WHERE organization_id=$1 ORDER BY id LIMIT $2 OFFSET $3",
            [ctx.org.id, count, startIndex - 1],
          )
        ).rows,
      }),
    );
    return reply.type("application/scim+json").send({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: result.data.total,
      startIndex,
      itemsPerPage: result.data.items.length,
      Resources: result.data.items.map(dto),
    });
  });
  app.post(root + "/Users", async (r, reply) => {
    const result = await core.tenant(r, { ...access, accountLocks: targetLocks }, async (ctx) => {
      const b = body(r, ["schemas", "externalId", "userName", "active"]);
      if (
        !Array.isArray(b.schemas) ||
        b.schemas.length !== 1 ||
        b.schemas[0] !== schema ||
        typeof b.active !== "boolean"
      )
        fail(400, "INVALID_REQUEST");
      // Local adapter contract: externalId references an existing OrgMap account. No guessed account or automatic email linking.
      const accountId = id(b.externalId),
        userName = text(b.userName, 254);
      const existing = (
        await ctx.c.query(
          "SELECT * FROM interop_scim_users WHERE organization_id=$1 AND external_id=$2",
          [ctx.org.id, accountId],
        )
      ).rows[0];
      if (existing) fail(409, "SCIM_USER_EXISTS");
      const member = await core.provisionMembership(ctx, r, {
        accountId,
        status: b.active ? "ACTIVE" : "SUSPENDED",
      });
      const row = (
        await ctx.c.query(
          "INSERT INTO interop_scim_users(organization_id,id,external_id,user_name,member_id,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [ctx.org.id, uuid(), accountId, userName, member.id, b.active],
        )
      ).rows[0];
      return dto(row);
    });
    return reply.code(201).type("application/scim+json").send(result.data);
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
        const row = (
          await ctx.c.query(
            "SELECT * FROM interop_scim_users WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, id((r.params as any).userId)],
          )
        ).rows[0];
        if (!row) fail(404, "RESOURCE_NOT_FOUND");
        return dto(row);
      },
    );
    return reply
      .type("application/scim+json")
      .header("ETag", result.data.meta.version)
      .send(result.data);
  });
  app.put(root + "/Users/:userId", async (r, reply) => {
    const result = await core.tenant(r, { ...access, accountLocks: targetLocks }, async (ctx) => {
      const b = body(r, ["schemas", "externalId", "userName", "active"]);
      const row = (
        await ctx.c.query(
          "SELECT * FROM interop_scim_users WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, id((r.params as any).userId)],
        )
      ).rows[0];
      if (!row) fail(404, "RESOURCE_NOT_FOUND");
      version(r, row.version);
      if (
        b.externalId !== row.external_id ||
        b.userName !== row.user_name ||
        typeof b.active !== "boolean" ||
        !Array.isArray(b.schemas) ||
        b.schemas.length !== 1 ||
        b.schemas[0] !== schema
      )
        fail(400, "INVALID_REQUEST");
      await core.provisionMembership(ctx, r, {
        accountId: row.external_id,
        status: b.active ? "ACTIVE" : "SUSPENDED",
      });
      return dto(
        (
          await ctx.c.query(
            "UPDATE interop_scim_users SET active=$3,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
            [ctx.org.id, row.id, b.active],
          )
        ).rows[0],
      );
    });
    return reply
      .type("application/scim+json")
      .header("ETag", result.data.meta.version)
      .send(result.data);
  });
  app.delete(root + "/Users/:userId", async (r, reply) => {
    await core.tenant(r, { ...access, accountLocks: targetLocks }, async (ctx) => {
      const row = (
        await ctx.c.query(
          "SELECT * FROM interop_scim_users WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, id((r.params as any).userId)],
        )
      ).rows[0];
      if (!row) fail(404, "RESOURCE_NOT_FOUND");
      version(r, row.version);
      await core.provisionMembership(ctx, r, {
        accountId: row.external_id,
        status: "SUSPENDED",
      });
      await ctx.c.query(
        "UPDATE interop_scim_users SET active=false,version=version+1 WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, row.id],
      );
      return null;
    });
    return reply.code(204).send();
  });
}

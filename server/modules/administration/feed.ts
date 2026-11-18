import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import {
  body,
  fail,
  id,
  key,
  text,
  uuid,
  version,
  commandHash,
} from "../../src/core.js";
import { validateRichDocument } from "../../../packages/content/index.js";
import {
  createPublicationExportSource,
  directGroup,
  type PublicationLifecycleGate,
  type PublicationExportSource,
} from "./feed-source.js";

export interface PublicationEnqueuePort {
  enqueue(
    ctx: Ctx,
    input: { selectionId: string; accountId: string; memberId: string },
  ): Promise<unknown>;
}
function content(r: FastifyRequest) {
  const input = body(r, ["title", "bodyRichDocument"]),
    title = text(input.title, 200);
  let doc;
  try {
    doc = validateRichDocument(input.bodyRichDocument);
  } catch {
    return fail(422, "INVALID_RICH_DOCUMENT");
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > 512 * 1024)
    fail(422, "INVALID_RICH_DOCUMENT");
  return { title, doc };
}
async function post(
  ctx: Ctx,
  postId: string,
  own = false,
  allowArchived = false,
) {
  const p = (
    await ctx.c.query(
      "SELECT * FROM administration_feed_posts WHERE organization_id=$1 AND id=$2",
      [ctx.org.id, id(postId)],
    )
  ).rows[0];
  if (!p) fail(404, "RESOURCE_NOT_FOUND");
  await directGroup(ctx, p.group_id);
  if (
    (p.state === "ARCHIVED" && !allowArchived) ||
    (own && p.author_member_id !== ctx.member.id) ||
    (p.state === "DRAFT" && p.author_member_id !== ctx.member.id)
  )
    fail(404, "RESOURCE_NOT_FOUND");
  return p;
}
function show(p: any, draft: boolean) {
  return {
    id: p.id,
    organizationId: p.organization_id,
    groupId: p.group_id,
    authorMemberId: p.author_member_id,
    state: p.state,
    version: p.version,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
    publishedVersion: p.published_version,
    ...(draft
      ? { title: p.draft_title, bodyRichDocument: p.draft_body }
      : {
          title: p.title,
          bodyRichDocument: p.body,
          publishedAt: p.published_at?.toISOString(),
        }),
  };
}
export function registerAdministrationFeed(
  app: FastifyInstance,
  core: ModuleRuntime,
  opts: { gate: PublicationLifecycleGate; enqueue?: PublicationEnqueuePort },
): PublicationExportSource {
  const source = createPublicationExportSource(opts.gate),
    base = "/api/v1/organizations/:organizationId/publications",
    exportsBase =
      "/api/v1/organizations/:organizationId/administration/publication-exports";
  const groupId = (r: FastifyRequest) => id((r.params as any).groupId),
    postId = (r: FastifyRequest) => id((r.params as any).id);
  const gate = async (ctx: Ctx) => {
    await opts.gate(ctx);
    return true;
  };
  const groupAuth = (r: FastifyRequest) => async (ctx: Ctx) => {
    await gate(ctx);
    await directGroup(ctx, groupId(r));
    return true;
  };
  const postAuth =
    (r: FastifyRequest, own = false) =>
    async (ctx: Ctx) => {
      await gate(ctx);
      await post(ctx, postId(r), own);
      return true;
    };
  app.get(base + "/groups", (r) =>
    core.tenant(r, false, async (ctx) => {
      await gate(ctx);
      if (ctx.member.member_type !== "MEMBER") fail(404, "RESOURCE_NOT_FOUND");
      const rows = (
        await ctx.c.query(
          "SELECT r.id,r.version,r.value FROM administration_records r JOIN administration_group_members gm ON gm.organization_id=r.organization_id AND gm.group_id=r.id WHERE r.organization_id=$1 AND r.kind='group' AND gm.member_id=$2 ORDER BY r.id",
          [ctx.org.id, ctx.member.id],
        )
      ).rows;
      return {
        groups: rows.map((x) => ({
          id: x.id,
          name: x.value.name,
          version: x.version,
        })),
      };
    }),
  );
  app.post(base + "/groups/:groupId/posts", { bodyLimit: 512 * 1024 + 8192 }, (r) =>
    core.tenant(r, { mode: "write", authorize: groupAuth(r) }, async (ctx) => {
      const { title, doc } = content(r),
        pid = uuid();
      const p = (
        await ctx.c.query(
          "INSERT INTO administration_feed_posts(organization_id,id,group_id,author_member_id,state,version,draft_title,draft_body) VALUES($1,$2,$3,$4,'DRAFT',1,$5,$6) RETURNING *",
          [ctx.org.id, pid, groupId(r), ctx.member.id, title, doc],
        )
      ).rows[0];
      await core.changed(ctx, r, pid, "PublicationDraftCreated");
      return { post: show(p, true) };
    }),
  );
  app.get(base + "/groups/:groupId/posts", (r) =>
    core.tenant(r, { mode: "read", authorize: groupAuth(r) }, async (ctx) => {
      const q = (r.query ?? {}) as any;
      if (
        Object.keys(q).some(
          (k) => !["drafts", "cursor", "limit"].includes(k),
        ) ||
        (q.drafts !== undefined && q.drafts !== "true" && q.drafts !== "false")
      )
        fail(400, "INVALID_REQUEST");
      const limit = q.limit === undefined ? 50 : Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(400, "INVALID_REQUEST");
      let cursor: string | null = null;
      if (q.cursor !== undefined) cursor = id(q.cursor);
      const rows = (
        await ctx.c.query(
          `SELECT p.*,v.title,v.body,v.published_at FROM administration_feed_posts p LEFT JOIN administration_feed_versions v ON v.organization_id=p.organization_id AND v.post_id=p.id AND v.number=p.published_version WHERE p.organization_id=$1 AND p.group_id=$2 AND (p.state='PUBLISHED' OR ($3::boolean AND p.state='DRAFT' AND p.author_member_id=$4)) AND ($5::uuid IS NULL OR p.id>$5) ORDER BY p.id LIMIT $6`,
          [
            ctx.org.id,
            groupId(r),
            q.drafts === "true",
            ctx.member.id,
            cursor,
            limit + 1,
          ],
        )
      ).rows;
      const more = rows.length > limit,
        page = rows.slice(0, limit);
      return {
        posts: page.map((p) => show(p, p.state === "DRAFT")),
        nextCursor: more ? page[page.length - 1].id : null,
      };
    }),
  );
  app.get(base + "/posts/:id", (r) =>
    core.tenant(r, { mode: "read", authorize: postAuth(r) }, async (ctx) => {
      const p = await post(ctx, postId(r));
      const q = (r.query ?? {}) as any;
      if (
        Object.keys(q).some((k) => k !== "draft") ||
        (q.draft !== undefined && q.draft !== "true")
      )
        fail(400, "INVALID_REQUEST");
      if (q.draft === "true" && p.author_member_id !== ctx.member.id)
        fail(404, "RESOURCE_NOT_FOUND");
      if (p.state === "DRAFT" || q.draft === "true")
        return { post: show(p, true) };
      const v = (
        await ctx.c.query(
          "SELECT title,body,published_at FROM administration_feed_versions WHERE organization_id=$1 AND post_id=$2 AND number=$3",
          [ctx.org.id, p.id, p.published_version],
        )
      ).rows[0];
      if (!v) fail(503, "PUBLICATION_VERSION_UNAVAILABLE");
      return { post: show({ ...p, ...v }, false) };
    }),
  );
  app.patch(base + "/posts/:id", { bodyLimit: 512 * 1024 + 8192 }, (r) =>
    core.tenant(
      r,
      { mode: "write", authorize: postAuth(r, true) },
      async (ctx) => {
        const k = key(r),
          op =
            (ctx.principal
              ? "credential:" + ctx.principal.credentialId + ":"
              : "cookie:") +
            "feed-patch:" +
            postId(r),
          hash = commandHash(r);
        const prior = (
          await ctx.c.query(
            "SELECT hash,result FROM command_results WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4",
            [ctx.org.id, ctx.account.id, op, k],
          )
        ).rows[0];
        if (prior) {
          if (prior.hash !== hash) fail(409, "IDEMPOTENCY_CONFLICT");
          return prior.result;
        }
        const p = await post(ctx, postId(r), true);
        version(r, p.version);
        const { title, doc } = content(r);
        const updated = (
          await ctx.c.query(
            "UPDATE administration_feed_posts SET draft_title=$3,draft_body=$4,version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 RETURNING *",
            [ctx.org.id, p.id, title, doc],
          )
        ).rows[0];
        await core.changed(ctx, r, p.id, "PublicationDraftUpdated");
        const result = { post: show(updated, true) };
        await ctx.c.query(
          "INSERT INTO command_results VALUES($1,$2,$3,$4,$5,$6)",
          [ctx.org.id, ctx.account.id, op, k, hash, result],
        );
        return result;
      },
    ),
  );
  app.post(base + "/posts/:id/publish", (r) =>
    core.tenant(
      r,
      { mode: "write", authorize: postAuth(r, true) },
      async (ctx) => {
        body(r, []);
        const p = await post(ctx, postId(r), true);
        version(r, p.version);
        const n = (p.published_version ?? 0) + 1;
        await ctx.c.query(
          "INSERT INTO administration_feed_versions(organization_id,post_id,number,title,body) VALUES($1,$2,$3,$4,$5)",
          [ctx.org.id, p.id, n, p.draft_title, p.draft_body],
        );
        const updated = (
          await ctx.c.query(
            "UPDATE administration_feed_posts SET state='PUBLISHED',published_version=$3,version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 RETURNING *",
            [ctx.org.id, p.id, n],
          )
        ).rows[0];
        await core.changed(ctx, r, p.id, "PublicationPublished");
        return { post: show(updated, true) };
      },
    ),
  );
  app.post(base + "/posts/:id/archive", (r) =>
    core.tenant(
      r,
      {
        mode: "write",
        authorize: async (ctx) => {
          await gate(ctx);
          await post(ctx, postId(r), true, true);
          return true;
        },
      },
      async (ctx) => {
        body(r, []);
        const p = await post(ctx, postId(r), true);
        version(r, p.version);
        const updated = (
          await ctx.c.query(
            "UPDATE administration_feed_posts SET state='ARCHIVED',version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 RETURNING *",
            [ctx.org.id, p.id],
          )
        ).rows[0];
        await core.changed(ctx, r, p.id, "PublicationArchived");
        return { post: show(updated, true) };
      },
    ),
  );
  app.post(exportsBase, (r) =>
    core.tenant(
      r,
      {
        mode: "write",
        authorize: async (ctx) => {
          await gate(ctx);
          if (
            ctx.member.member_type !== "MEMBER" ||
            ctx.member.org_role !== "OWNER"
          )
            fail(403, "ACTION_DENIED");
          return true;
        },
        beforeReplay: async (ctx, result) =>
          source.authorizeCurrent(ctx, {
            selectionId: result.selection.selectionId,
          }),
      },
      async (ctx) => {
        const b = body(r, ["groupIds"]);
        version(r, ctx.org.authorization_revision);
        if (!opts.enqueue) fail(503, "PUBLICATION_EXPORT_UNAVAILABLE");
        const selection = await source.prepare(ctx, { groupIds: b.groupIds });
        const job = await opts.enqueue!.enqueue(ctx, {
          selectionId: selection.selectionId,
          accountId: ctx.account.id,
          memberId: ctx.member.id,
        });
        await core.changed(
          ctx,
          r,
          selection.selectionId,
          "PublicationExportRequested",
        );
        return { selection, job };
      },
    ),
  );
  return source;
}

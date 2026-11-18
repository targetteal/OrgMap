import type { ModuleRuntime, Ctx } from "../../src/runtime.js";
import { fail, id, text, uuid } from "../../src/core.js";
import {
  validateRichDocument,
  toPlainText,
  ContentValidationError,
} from "../../../packages/content/index.js";
import { ResourceRegistry } from "./ports.js";
import { enqueueNotification } from "./notifications.js";
import { commentEventFor } from "./catalog.js";
import type {
  CommentThreadPort,
  CommentPosition,
  ThreadComment,
  LegacyTaskCommentSource,
} from "./comments-contract.js";
const timestamp = `to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export function validateCommentPosition(p: CommentPosition) {
  if (
    !p ||
    Object.keys(p).some((k) => !["createdAt", "id", "source"].includes(k)) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(p.createdAt) ||
    !["WORK_LEGACY", "PLATFORM"].includes(p.source)
  )
    fail(400, "INVALID_COMMENT_CURSOR");
  id(p.id);
  return p;
}
export function createCommentThreadPort(options: {
  core: Pick<
    ModuleRuntime,
    "validateActiveMembers" | "assertResourceAvailable"
  >;
  registry: ResourceRegistry;
  legacyTaskComments?: LegacyTaskCommentSource;
}): CommentThreadPort {
  const { core, registry, legacyTaskComments } = options;
  if (registry.get("task") && !legacyTaskComments)
    throw Error("COMMENT_THREAD_UNAVAILABLE");
  const present = (
    ctx: Ctx,
    type: string,
    row: any,
    source: "WORK_LEGACY" | "PLATFORM",
  ): ThreadComment => ({
    id: row.id,
    key: (source === "PLATFORM" ? "platform:" : "work-legacy:") + row.id,
    source,
    authorId:
      type === "task" && ctx.member.member_type === "GUEST"
        ? null
        : row.author_id,
    content: row.content,
    contentRich: source === "PLATFORM" ? row.content_rich : null,
    createdAt: row.created_at,
    version: source === "PLATFORM" ? row.version : null,
    immutable: true,
  });
  return {
    async list(ctx, { ref, after, limit = 50 }) {
      id(ref.id);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(400, "INVALID_PAGE_LIMIT");
      if (after) validateCommentPosition(after);
      await core.assertResourceAvailable(ctx, ref.type);
      await registry.require(ctx, ref, "read");
      if (ref.type === "task" && !legacyTaskComments)
        fail(503, "COMMENT_THREAD_UNAVAILABLE");
      const rows = (
        await ctx.c.query(
          `SELECT id,author_id,content,content_rich,version,${timestamp} AS created_at FROM platform_comments WHERE organization_id=$1 AND resource_type=$2 AND resource_id=$3 AND ($4::timestamptz IS NULL OR (created_at,id,1)>($4::timestamptz,$5::uuid,$6::int)) ORDER BY created_at,id LIMIT $7`,
          [
            ctx.org.id,
            ref.type,
            ref.id,
            after?.createdAt ?? null,
            after?.id ?? null,
            after?.source === "PLATFORM" ? 1 : 0,
            limit + 1,
          ],
        )
      ).rows;
      const merged = rows.map((row) => present(ctx, ref.type, row, "PLATFORM"));
      if (ref.type === "task")
        for (const row of await legacyTaskComments!.list(ctx, {
          taskId: ref.id,
          after,
          take: limit + 1,
        }))
          merged.push(
            present(
              ctx,
              ref.type,
              {
                id: row.id,
                author_id: row.authorId,
                content: row.content,
                created_at: row.createdAt,
              },
              "WORK_LEGACY",
            ),
          );
      merged.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id) ||
          (a.source === b.source ? 0 : a.source === "WORK_LEGACY" ? -1 : 1),
      );
      const items = merged.slice(0, limit),
        last = items.at(-1);
      return {
        items,
        page: {
          hasMore: merged.length > limit,
          after: last
            ? { createdAt: last.createdAt, id: last.id, source: last.source }
            : null,
        },
      };
    },
    async append(ctx, { ref, body }) {
      if (ctx.mode !== "write" && ctx.mode !== "authorization_write")
        fail(403, "WRITE_CONTEXT_REQUIRED");
      await core.assertResourceAvailable(ctx, ref.type);
      await registry.require(ctx, ref, "comment");
      if (
        !body ||
        Object.keys(body).some(
          (k) => !["content", "contentRich"].includes(k),
        ) ||
        (body.content !== undefined) === (body.contentRich !== undefined)
      )
        fail(400, "INVALID_REQUEST");
      let rich = null,
        content: string;
      if (body.contentRich !== undefined) {
        try {
          rich = validateRichDocument(body.contentRich);
        } catch (error) {
          if (error instanceof ContentValidationError)
            fail(422, "INVALID_RICH_DOCUMENT");
          throw error;
        }
        content = toPlainText(rich);
        text(content, 10000);
      } else content = text(body.content, 10000);
      if (/[\x00-\x08]/.test(content)) fail(422, "UNSAFE_CONTENT");
      const row = (
        await ctx.c.query(
          `INSERT INTO platform_comments(organization_id,id,resource_type,resource_id,author_id,content,content_rich) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,author_id,content,content_rich,version,${timestamp} AS created_at`,
          [
            ctx.org.id,
            uuid(),
            ref.type,
            id(ref.id),
            ctx.member.id,
            content,
            rich,
          ],
        )
      ).rows[0];
      const followers = (
        await ctx.c.query(
          "SELECT member_id FROM platform_follows WHERE organization_id=$1 AND resource_type=$2 AND resource_id=$3 AND enabled",
          [ctx.org.id, ref.type, ref.id],
        )
      ).rows;
      const recipients = [];
      for (const follower of followers)
        if (await core.validateActiveMembers(ctx, [follower.member_id]))
          recipients.push({ memberId: follower.member_id, nominal: false });
      await enqueueNotification(ctx, registry, {
        eventId: row.id,
        event: commentEventFor(ref.type),
        ref,
        recipients,
        context: {resourceTitle:(await registry.get(ref.type)?.lookup?.(ctx,ref.id))?.title,excerpt:content},
      });
      return present(ctx, ref.type, row, "PLATFORM");
    },
  };
}

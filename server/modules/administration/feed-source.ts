import type { Ctx } from "../../src/runtime.js";
import { fail, id, uuid } from "../../src/core.js";
import {
  validateRichDocument,
  toPlainText,
  type RichDocument,
} from "../../../packages/content/index.js";

/** The closed editor schema has no attachment nodes. Redact recognizable attachment links and signed URLs; arbitrary plain user text is not a secret scanner. */
export function projectPublicationDocument(input: unknown) {
  const doc = validateRichDocument(input);
  let omittedAttachmentCount = 0;
  // Decode ASCII percent escapes a bounded number of times. A still-encoded
  // component after the bound is omitted conservatively rather than guessing.
  const decode = (input: string) => {
    let value = input;
    for (let i = 0; i < 3; i++) {
      const next = value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
      if (next === value) break;
      value = next;
    }
    return {
      value: value.toLowerCase(),
      unresolved: /%[0-9a-f]{2}/i.test(value),
    };
  };
  const secretKey = (input: string) => {
    const decoded = decode(input);
    const key = decoded.value.replace(/[-_]/g, "");
    return (
      decoded.unresolved ||
      [
        "token",
        "accesstoken",
        "refreshtoken",
        "idtoken",
        "authtoken",
        "authorization",
        "signature",
        "sig",
        "credential",
        "expires",
        "apikey",
        "secret",
      ].includes(key) ||
      key.startsWith("xamz") ||
      key.startsWith("xgoog")
    );
  };
  const parametersSensitive = (parameters: URLSearchParams) => {
    for (const key of parameters.keys()) if (secretKey(key)) return true;
    return false;
  };
  const sensitive = (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return true;
    const path = decode(url.pathname);
    if (
      path.unresolved ||
      path.value
        .split("/")
        .some((segment) =>
          /^(attachments?|files?|downloads?|artifacts?)$/.test(segment),
        )
    )
      return true;
    if (parametersSensitive(url.searchParams)) return true;
    // Fragments are never fetched; OAuth and similar capabilities can still
    // appear there. Only recognizable key/value forms are projected out.
    const fragment = url.hash.slice(1);
    const query = fragment.includes("?")
      ? fragment.slice(fragment.indexOf("?") + 1)
      : fragment;
    return parametersSensitive(new URLSearchParams(query));
  };
  const visit = (node: any): void => {
    if (node.type === "text") {
      const link = node.marks?.find((m: any) => m.type === "link");
      if (link && sensitive(link.attrs.href)) {
        node.text = "[Anexo omitido]";
        delete node.marks;
        omittedAttachmentCount++;
      } else {
        node.text = node.text.replace(
          /https?:\/\/[^\s<>"\u0000-\u001f]+/gi,
          (url: string) => {
            if (!sensitive(url)) return url;
            omittedAttachmentCount++;
            return "[Anexo omitido]";
          },
        );
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc.doc);
  return {
    bodyRichDocument: validateRichDocument(doc),
    omittedAttachmentCount,
  };
}
export interface PublicationExportSnapshot {
  schema: "orgmap.publications.export.v1";
  asOf: string;
  groups: Array<{
    id: string;
    name: string;
    version: number;
    posts: Array<{
      id: string;
      authorMemberId: string;
      publishedVersion: number;
      publishedAt: string;
      title: string;
      bodyRichDocument: RichDocument;
      bodyPlain: string;
      omittedAttachmentCount: number;
    }>;
  }>;
}
export interface PublicationExportSource {
  prepare(
    ctx: Ctx,
    input: { groupIds?: string[] },
  ): Promise<{
    selectionId: string;
    asOf: string;
    scope: "CURRENT_AUTHORIZED_GROUPS";
    groupCount: number;
    publicationCount: number;
  }>;
  materialize(
    ctx: Ctx,
    input: { selectionId: string },
  ): Promise<PublicationExportSnapshot>;
  authorizeCurrent(ctx: Ctx, input: { selectionId: string }): Promise<void>;
}
/** Required LF04 gate. Callers must implement this using current persisted lifecycle, in the same transaction. */
export type PublicationLifecycleGate = (ctx: Ctx) => Promise<void>;
export async function directGroup(ctx: Ctx, groupId: string) {
  const row = (
    await ctx.c.query(
      `SELECT r.id,r.version,r.value FROM administration_records r
    JOIN administration_group_members gm ON gm.organization_id=r.organization_id AND gm.group_id=r.id
    JOIN members m ON m.organization_id=gm.organization_id AND m.id=gm.member_id
    WHERE r.organization_id=$1 AND r.id=$2 AND r.kind='group' AND gm.member_id=$3 AND m.account_id=$4 AND m.status='ACTIVE' AND m.member_type='MEMBER'`,
      [ctx.org.id, id(groupId), ctx.member.id, ctx.account.id],
    )
  ).rows[0];
  if (!row) fail(404, "RESOURCE_NOT_FOUND");
  return row;
}
async function owner(ctx: Ctx) {
  const row = (
    await ctx.c.query(
      "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND account_id=$3 AND status='ACTIVE' AND member_type='MEMBER' AND org_role='OWNER'",
      [ctx.org.id, ctx.member.id, ctx.account.id],
    )
  ).rowCount;
  if (!row) fail(403, "ACTION_DENIED");
}
export function createPublicationExportSource(
  gate: PublicationLifecycleGate,
): PublicationExportSource {
  if (typeof gate !== "function")
    throw Error("Publication lifecycle gate is required");
  async function selection(ctx: Ctx, selectionId: string) {
    await gate(ctx);
    await owner(ctx);
    const row = (
      await ctx.c.query(
        "SELECT * FROM administration_feed_selections WHERE organization_id=$1 AND id=$2 AND account_id=$3 AND member_id=$4",
        [ctx.org.id, id(selectionId), ctx.account.id, ctx.member.id],
      )
    ).rows[0];
    if (!row) fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  async function authorizeCurrent(ctx: Ctx, input: { selectionId: string }) {
    const row = await selection(ctx, input.selectionId),
      snapshot = row.snapshot as PublicationExportSnapshot;
    for (const group of snapshot.groups) {
      await directGroup(ctx, group.id);
      for (const post of group.posts) {
        const current = (
          await ctx.c.query(
            "SELECT state FROM administration_feed_posts WHERE organization_id=$1 AND id=$2 AND group_id=$3",
            [ctx.org.id, post.id, group.id],
          )
        ).rows[0];
        if (!current || current.state !== "PUBLISHED")
          fail(403, "EXPORT_ACCESS_REVOKED");
      }
    }
  }
  return {
    async prepare(ctx, input) {
      await gate(ctx);
      await owner(ctx);
      if (
        input.groupIds !== undefined &&
        (!Array.isArray(input.groupIds) || input.groupIds.length > 100)
      )
        fail(422, "EXPORT_SCOPE_TOO_LARGE");
      const ids = input.groupIds?.map((x) => id(x).toLowerCase());
      if (ids && new Set(ids).size !== ids.length) fail(400, "INVALID_REQUEST");
      const groups =
        input.groupIds === undefined
          ? (
              await ctx.c.query(
                `SELECT r.id,r.version,r.value FROM administration_records r JOIN administration_group_members gm ON gm.organization_id=r.organization_id AND gm.group_id=r.id WHERE r.organization_id=$1 AND r.kind='group' AND gm.member_id=$2 ORDER BY r.id`,
                [ctx.org.id, ctx.member.id],
              )
            ).rows
          : await Promise.all(ids!.map((g) => directGroup(ctx, g)));
      if (groups.length > 100) fail(422, "EXPORT_SCOPE_TOO_LARGE");
      groups.sort((a, b) => a.id.localeCompare(b.id));
      const asOf = (
        await ctx.c.query("SELECT clock_timestamp() AS now")
      ).rows[0].now.toISOString();
      let count = 0;
      const output: PublicationExportSnapshot["groups"] = [];
      for (const group of groups) {
        const rows = (
          await ctx.c.query(
            `SELECT p.id,p.author_member_id,v.number,v.published_at,v.title,v.body FROM administration_feed_posts p JOIN administration_feed_versions v ON v.organization_id=p.organization_id AND v.post_id=p.id AND v.number=p.published_version WHERE p.organization_id=$1 AND p.group_id=$2 AND p.state='PUBLISHED' ORDER BY v.published_at,p.id`,
            [ctx.org.id, group.id],
          )
        ).rows;
        count += rows.length;
        if (count > 5000) fail(422, "EXPORT_SCOPE_TOO_LARGE");
        output.push({
          id: group.id,
          name: group.value.name,
          version: group.version,
          posts: rows.map((p) => {
            const projected = projectPublicationDocument(p.body);
            return {
              id: p.id,
              authorMemberId: p.author_member_id,
              publishedVersion: p.number,
              publishedAt: p.published_at.toISOString(),
              title: p.title,
              ...projected,
              bodyPlain: toPlainText(projected.bodyRichDocument),
            };
          }),
        });
      }
      const snapshot: PublicationExportSnapshot = {
        schema: "orgmap.publications.export.v1",
        asOf,
        groups: output,
      };
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 5 * 1024 * 1024)
        fail(422, "EXPORT_SCOPE_TOO_LARGE");
      const selectionId = uuid();
      await ctx.c.query(
        "INSERT INTO administration_feed_selections(organization_id,id,account_id,member_id,as_of,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
        [
          ctx.org.id,
          selectionId,
          ctx.account.id,
          ctx.member.id,
          asOf,
          snapshot,
        ],
      );
      return {
        selectionId,
        asOf,
        scope: "CURRENT_AUTHORIZED_GROUPS",
        groupCount: groups.length,
        publicationCount: count,
      };
    },
    async authorizeCurrent(ctx, input) {
      await authorizeCurrent(ctx, input);
    },
    async materialize(ctx, input) {
      await authorizeCurrent(ctx, input);
      return (await selection(ctx, input.selectionId))
        .snapshot as PublicationExportSnapshot;
    },
  };
}

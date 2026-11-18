import { createHash } from "node:crypto";
import { fail } from "../../src/core.js";
import {
  validateRichDocument,
  toPlainText,
} from "../../../packages/content/index.js";
import type { PublicationExportSnapshot } from "../administration/feed-source.js";
import { zip } from "./xlsx.js";
const invalid = (): never => fail(422, "INVALID_PUBLICATION_PACKAGE");
const uid = (v: unknown): string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
    ? v
    : invalid();
function object(v: unknown, keys: string[]): any {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    invalid();
  return v;
}
function string(v: unknown, max: number): string {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    [...v].length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    invalid();
  return v as string;
}
function instant(v: unknown): string {
  const s = string(v, 40);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(s) ||
    !Number.isFinite(Date.parse(s))
  )
    invalid();
  return s;
}
function integer(v: unknown, min: number) {
  if (!Number.isSafeInteger(v) || Number(v) < min) invalid();
  return v as number;
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** Strict allowlist before encoding, including deterministic order and plain/rich consistency. */
export function serializePublicationExport(
  selection: unknown,
  input: unknown,
): Buffer {
  const selectionId = uid(selection),
    source = object(input, ["schema", "asOf", "groups"]);
  if (source.schema !== "orgmap.publications.export.v1") invalid();
  const asOf = instant(source.asOf);
  if (!Array.isArray(source.groups) || source.groups.length > 100)
    fail(422, "EXPORT_SCOPE_TOO_LARGE");
  const files: Array<{
      path: string;
      size: number;
      sha256: string;
      postCount: number;
    }> = [],
    entries: Record<string, Buffer> = {};
  let total = 0,
    previous = "";
  const seenPosts = new Set<string>();
  for (const raw of source.groups) {
    const g = object(raw, ["id", "name", "version", "posts"]),
      groupId = uid(g.id),
      name = string(g.name, 200),
      version = integer(g.version, 1);
    if (groupId <= previous) invalid();
    previous = groupId;
    if (!Array.isArray(g.posts)) invalid();
    total += g.posts.length;
    if (total > 5000) fail(422, "EXPORT_SCOPE_TOO_LARGE");
    let last = "";
    const posts = g.posts.map((rawPost: unknown) => {
      const p = object(rawPost, [
          "id",
          "authorMemberId",
          "publishedVersion",
          "publishedAt",
          "title",
          "bodyRichDocument",
          "bodyPlain",
          "omittedAttachmentCount",
        ]),
        pid = uid(p.id),
        authorMemberId = uid(p.authorMemberId),
        publishedVersion = integer(p.publishedVersion, 1),
        publishedAt = instant(p.publishedAt),
        title = string(p.title, 200),
        omittedAttachmentCount = integer(p.omittedAttachmentCount, 0);
      if (seenPosts.has(pid) || publishedAt > asOf) invalid();
      seenPosts.add(pid);
      const order = publishedAt + "/" + pid;
      if (last && order <= last) invalid();
      last = order;
      let doc;
      try {
        doc = validateRichDocument(p.bodyRichDocument);
      } catch {
        return invalid();
      }
      const plain = toPlainText(doc);
      if (p.bodyPlain !== plain) invalid();
      return {
        id: pid,
        authorMemberId,
        publishedVersion,
        publishedAt,
        title,
        bodyRichDocument: doc,
        bodyPlain: plain,
        omittedAttachmentCount,
      };
    });
    const path = `groups/${groupId}.json`,
      data = Buffer.from(
        JSON.stringify({
          schema: "orgmap.publications.group.v1",
          asOf,
          group: { id: groupId, name, version },
          posts,
        }),
        "utf8",
      );
    entries[path] = data;
    files.push({
      path,
      size: data.length,
      sha256: sha(data),
      postCount: posts.length,
    });
  }
  const manifest = {
    schema: "orgmap.publications.manifest.v1",
    selectionId,
    asOf,
    scope: "CURRENT_AUTHORIZED_GROUPS",
    groupCount: files.length,
    publicationCount: total,
    files,
    exclusions: [
      "drafts",
      "archived",
      "history",
      "chat",
      "comments",
      "attachments",
      "binary files",
    ],
    projection:
      "attachment references replaced by omission text; plain text derived from projected document",
    ...(files.length === 0
      ? { notice: "Nenhum grupo autorizado selecionado." }
      : {}),
  };
  const bytes = zip({
    "manifest.json": Buffer.from(JSON.stringify(manifest), "utf8"),
    ...entries,
  });
  if (bytes.length > 5 * 1024 * 1024) fail(422, "EXPORT_SCOPE_TOO_LARGE");
  return bytes;
}

import { createHash } from "node:crypto";
import * as Y from "yjs";
import { ContentValidationError, emptyRichDocument } from "@orgmap/content";
import {
  createRichYDoc,
  readRichSnapshot,
  hasPendingYUpdates,
  migrateLegacyNotes,
  RICH_TEXT_PROTOCOL,
  validateRichUpdate,
} from "@orgmap/content/collaboration";
import type { Ctx } from "../../src/runtime.js";
import { fail } from "../../src/core.js";
export const LEGACY_PROTOCOL = "orgmap-ytext-v1";
export { RICH_TEXT_PROTOCOL };
export function protocol(value: unknown) {
  if (value !== LEGACY_PROTOCOL && value !== RICH_TEXT_PROTOCOL)
    fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
  return value as typeof LEGACY_PROTOCOL | typeof RICH_TEXT_PROTOCOL;
}
export function requireProtocol(d: any, input: any) {
  if (d.schema_version !== 1) fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
  const incoming = input?.protocol ?? LEGACY_PROTOCOL,
    version =
      input?.schemaVersion ?? (incoming === LEGACY_PROTOCOL ? 1 : undefined);
  if (incoming !== d.protocol || version !== d.schema_version)
    fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
  protocol(d.protocol);
}
export function initialDocument(format: string) {
  const rich = format === RICH_TEXT_PROTOCOL;
  protocol(format);
  const d = rich ? createRichYDoc(emptyRichDocument()) : new Y.Doc();
  try {
    return Buffer.from(Y.encodeStateAsUpdate(d));
  } finally {
    d.destroy();
  }
}
function invalid(e: unknown): never {
  if (e instanceof ContentValidationError) {
    if (e.message.includes("LEGACY_PENDING_UPDATES"))
      return fail(409, "PENDING_UPDATES_REQUIRE_RESOLUTION");
    return fail(422, "INVALID_RICH_DOCUMENT");
  }
  if ((e as any)?.status) throw e;
  return fail(400, "INVALID_UPDATE");
}
export function candidate(d: any, update: Uint8Array): Buffer {
  try {
    if (d.protocol === RICH_TEXT_PROTOCOL)
      return Buffer.from(validateRichUpdate(d.snapshot, update).snapshot);
    if (d.protocol !== LEGACY_PROTOCOL)
      fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, d.snapshot);
      Y.applyUpdate(doc, update);
      if (
        doc.getText("notes").length > 200000 ||
        [...doc.share.keys()].some((k) => k !== "notes")
      )
        fail(422, "INVALID_DOCUMENT");
      const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
      if (snapshot.length > 2_000_000) fail(413, "DOCUMENT_TOO_LARGE");
      return snapshot;
    } finally {
      doc.destroy();
    }
  } catch (e) {
    return invalid(e);
  }
}
export function documentWire(d: any, barrier = false) {
  try {
    protocol(d.protocol);
    if (d.schema_version !== 1) fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
    const doc = new Y.Doc();
    let pending: boolean;
    try {
      Y.applyUpdate(doc, d.snapshot);
      pending = hasPendingYUpdates(doc);
    } finally {
      doc.destroy();
    }
    if (barrier && pending) fail(409, "PENDING_UPDATES_REQUIRE_RESOLUTION");
    return {
      sectionId: d.section_id,
      epoch: d.epoch,
      sequence: d.sequence,
      protocol: d.protocol,
      schemaVersion: d.schema_version,
      format:
        d.protocol === RICH_TEXT_PROTOCOL ? "orgmap-richtext" : "plain-text",
      snapshot: d.snapshot.toString("base64"),
      pending,
      ...(d.protocol === RICH_TEXT_PROTOCOL
        ? { document: readRichSnapshot(d.snapshot) }
        : {}),
    };
  } catch (e) {
    return invalid(e);
  }
}
export async function archiveEpoch(ctx: Ctx, d: any, reason: string) {
  await ctx.c.query(
    "INSERT INTO meeting_document_epochs(organization_id,meeting_id,section_id,epoch,protocol,schema_version,sequence,snapshot,sha256,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      ctx.org.id,
      d.meeting_id,
      d.section_id,
      d.epoch,
      d.protocol,
      d.schema_version,
      d.sequence,
      d.snapshot,
      createHash("sha256").update(d.snapshot).digest("hex"),
      ctx.member.id,
      reason,
    ],
  );
}
export function migrateSnapshot(snapshot: Uint8Array) {
  try {
    return migrateLegacyNotes(snapshot);
  } catch (e) {
    return invalid(e);
  }
}
export function restoreSnapshot(current: any, old: any) {
  if ((old.schemaVersion ?? 1) !== 1)
    fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
  const previous = protocol(old.protocol ?? LEGACY_PROTOCOL),
    target =
      current.protocol === RICH_TEXT_PROTOCOL || previous === RICH_TEXT_PROTOCOL
        ? RICH_TEXT_PROTOCOL
        : LEGACY_PROTOCOL;
  const source = Buffer.from(old.snapshot, "base64");
  const snapshot =
    target === RICH_TEXT_PROTOCOL && previous === LEGACY_PROTOCOL
      ? Buffer.from(migrateSnapshot(source).snapshot)
      : source;
  documentWire(
    { ...current, protocol: target, schema_version: 1, snapshot },
    true,
  );
  return { protocol: target, snapshot };
}

import * as Y from "yjs";
import {
  prosemirrorJSONToYDoc,
  yXmlFragmentToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import {
  ContentValidationError,
  RICH_TEXT_FORMAT,
  toPlainText,
  validateRichDocument,
  type RichDocument,
} from "./index.js";
import { richTextSchema } from "./schema.js";

export const RICH_TEXT_PROTOCOL = "orgmap-richtext-yjs-v1" as const;
export const RICH_TEXT_FRAGMENT = "richtext" as const;
export const RICH_TEXT_POSITION_METADATA =
  "__tiptap_position_migrations:root:richtext" as const;
export const YJS_LIMITS = Object.freeze({
  snapshotBytes: 2_000_000,
  updateBytes: 1_000_000,
});
function invalid(reason: string): never {
  throw new ContentValidationError("$yjs", reason);
}
function bytes(value: Uint8Array, max: number) {
  if (!(value instanceof Uint8Array) || value.byteLength > max)
    invalid("tamanho binário inválido");
}
function validatePositionMetadata(doc: Y.Doc) {
  if (!doc.share.has(RICH_TEXT_POSITION_METADATA)) return;
  const map = doc.getMap(RICH_TEXT_POSITION_METADATA);
  if (map._start) invalid("tipo de metadados incompatível");
  if (map.size > 10_000) invalid("metadados excedem o limite");
  const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const obj = (value: unknown, allowed: string[]): Record<string, any> => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some((k) => !allowed.includes(k))
    )
      invalid("metadados incompatíveis");
    return value as Record<string, any>;
  };
  const id = (value: unknown) => {
    const v = value instanceof Y.ID ? value : obj(value, ["client", "clock"]);
    if (!integer(v.client) || !integer(v.clock))
      invalid("ID de posição incompatível");
  };
  let total = 0;
  for (const [key, value] of map) {
    const v = obj(value, ["version", "client", "clock", "seen", "transfers"]);
    if (
      v.version !== 1 ||
      !integer(v.client) ||
      !integer(v.clock) ||
      key !== `${v.client}:${v.clock}` ||
      !Array.isArray(v.seen) ||
      !Array.isArray(v.transfers) ||
      (total += v.seen.length + v.transfers.length) > 20_000
    )
      invalid("metadados de posição inválidos");
    for (const pair of v.seen)
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(integer))
        invalid("vetor de posição inválido");
    for (const value of v.transfers) {
      const transfer = obj(value, ["source", "target"]);
      const source = obj(transfer.source, [
        "client",
        "clock",
        "length",
        "boundary",
      ]);
      if (
        !integer(source.client) ||
        !integer(source.clock) ||
        !integer(source.length) ||
        (source.boundary !== undefined &&
          !["start", "end"].includes(source.boundary))
      )
        invalid("origem de posição inválida");
      if (transfer.target !== null) {
        const target = obj(transfer.target, [
          "client",
          "clock",
          "type",
          "tname",
          "assoc",
          "boundary",
        ]);
        if (
          !integer(target.client) ||
          !integer(target.clock) ||
          (target.tname !== undefined && target.tname !== RICH_TEXT_FRAGMENT) ||
          (target.assoc !== undefined && ![-1, 0, 1].includes(target.assoc)) ||
          (target.boundary !== undefined &&
            !["start", "end"].includes(target.boundary))
        )
          invalid("destino de posição inválido");
        if (target.type !== null) id(target.type);
      }
    }
  }
}
/** Conversion happens only after our allowlist validation; PM alone silently drops unknown fields. */
export function createRichYDoc(input: RichDocument): Y.Doc {
  const document = validateRichDocument(input);
  const doc = prosemirrorJSONToYDoc(
    richTextSchema,
    document.doc,
    RICH_TEXT_FRAGMENT,
  );
  readRichYDoc(doc);
  return doc;
}
export function hasPendingYUpdates(doc: Y.Doc): boolean {
  // Explicit dependency on Yjs 13.6.33 store internals: covered by out-of-order regression tests.
  return doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
}
/** Validate every integrated XML node/attribute; refuse hidden roots/subdocs and oversized trees. */
export function readRichYDoc(doc: Y.Doc): RichDocument {
  if (doc.getSubdocs().size) invalid("subdocumentos não permitidos");
  for (const key of doc.share.keys())
    if (key !== RICH_TEXT_FRAGMENT && key !== RICH_TEXT_POSITION_METADATA)
      invalid("raiz desconhecida");
  validatePositionMetadata(doc);
  let fragment: Y.XmlFragment;
  try {
    fragment = doc.getXmlFragment(RICH_TEXT_FRAGMENT);
  } catch {
    return invalid("tipo de raiz incompatível");
  }
  if ([...fragment._map.values()].some((item) => !item.deleted))
    invalid("atributos ocultos na raiz");
  let nodes = 0;
  const stack: { node: unknown; depth: number }[] = fragment
    .toArray()
    .map((node) => ({ node, depth: 1 }));
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++nodes > 10_000 || depth > 12) invalid("árvore excede os limites");
    if (node instanceof Y.XmlText) {
      if (Object.keys(node.getAttributes()).length)
        invalid("atributos ocultos no texto");
      for (const delta of node.toDelta())
        for (const attrs of Object.values(delta.attributes ?? {})) {
          if (!attrs || typeof attrs !== "object" || Array.isArray(attrs))
            invalid("marcação XML incompatível");
        }
    } else if (node instanceof Y.XmlElement)
      stack.push(
        ...node.toArray().map((child) => ({ node: child, depth: depth + 1 })),
      );
    else invalid("tipo XML não permitido");
  }
  let raw: any;
  try {
    raw = yXmlFragmentToProsemirrorJSON(fragment);
  } catch {
    return invalid("XML incompatível");
  }
  // Official binding emits attrs:{} for attrless marks. Remove precisely that empty representation.
  const normalize = (n: any) => {
    for (const mark of n.marks ?? [])
      if (
        mark.attrs &&
        Object.keys(mark.attrs).length === 0 &&
        mark.type !== "link"
      )
        delete mark.attrs;
    for (const child of n.content ?? []) normalize(child);
  };
  normalize(raw);
  const value = validateRichDocument({
    format: RICH_TEXT_FORMAT,
    version: 1,
    doc: raw,
  });
  const pm = richTextSchema.nodeFromJSON(value.doc);
  pm.check();
  return value;
}
export function readRichSnapshot(snapshot: Uint8Array): RichDocument {
  bytes(snapshot, YJS_LIMITS.snapshotBytes);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, snapshot);
    return readRichYDoc(doc);
  } catch (e) {
    if (e instanceof ContentValidationError) throw e;
    return invalid("snapshot inválido");
  } finally {
    doc.destroy();
  }
}
/** Pure candidate validation. Never mutates the live doc or ACKs/persists anything. */
export function validateRichUpdate(
  snapshot: Uint8Array,
  update: Uint8Array,
): { snapshot: Uint8Array; document: RichDocument; pending: boolean } {
  bytes(snapshot, YJS_LIMITS.snapshotBytes);
  bytes(update, YJS_LIMITS.updateBytes);
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, snapshot);
    Y.applyUpdate(candidate, update);
    const document = readRichYDoc(candidate),
      result = Y.encodeStateAsUpdate(candidate);
    bytes(result, YJS_LIMITS.snapshotBytes);
    return {
      snapshot: result,
      document,
      pending: hasPendingYUpdates(candidate),
    };
  } catch (e) {
    if (e instanceof ContentValidationError) throw e;
    return invalid("update inválido");
  } finally {
    candidate.destroy();
  }
}
/** Domain owner must archive original bytes/seq/hash and atomically install this on a NEW epoch. */
export function migrateLegacyNotes(snapshot: Uint8Array): {
  originalSnapshot: Uint8Array;
  snapshot: Uint8Array;
  document: RichDocument;
  protocol: typeof RICH_TEXT_PROTOCOL;
} {
  bytes(snapshot, YJS_LIMITS.snapshotBytes);
  const legacy = new Y.Doc();
  try {
    Y.applyUpdate(legacy, snapshot);
    if (hasPendingYUpdates(legacy))
      invalid(
        "LEGACY_PENDING_UPDATES: resolva updates pendentes antes de migrar",
      );
    if (
      legacy.getSubdocs().size ||
      [...legacy.share.keys()].some((k) => k !== "notes")
    )
      invalid("raiz legada desconhecida");
    let text: Y.Text;
    try {
      text = legacy.getText("notes");
    } catch {
      return invalid("tipo legado incompatível");
    }
    const delta = text.toDelta();
    if (
      Object.keys(text.getAttributes()).length ||
      delta.some(
        (d: { insert?: unknown; attributes?: Record<string, unknown> }) =>
          typeof d.insert !== "string" ||
          (d.attributes && Object.keys(d.attributes).length),
      )
    )
      invalid(
        "legado contém atributos/embeds: recuperação explícita necessária",
      );
    const plain = text.toString();
    // Unlike a new plain input, migration preserves CRLF, CR, blank and trailing lines exactly.
    const document = validateRichDocument({
      format: RICH_TEXT_FORMAT,
      version: 1,
      doc: {
        type: "doc",
        content: plain
          .split("\n")
          .map((t) => ({
            type: "paragraph",
            ...(t ? { content: [{ type: "text", text: t }] } : {}),
          })),
      },
    });
    if (toPlainText(document) !== plain)
      invalid("migração não preserva o texto");
    const fresh = createRichYDoc(document);
    try {
      return {
        originalSnapshot: snapshot.slice(),
        snapshot: Y.encodeStateAsUpdate(fresh),
        document,
        protocol: RICH_TEXT_PROTOCOL,
      };
    } finally {
      fresh.destroy();
    }
  } catch (e) {
    if (e instanceof ContentValidationError) throw e;
    return invalid("snapshot legado inválido");
  } finally {
    legacy.destroy();
  }
}

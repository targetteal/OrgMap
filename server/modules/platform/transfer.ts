import { digest, fail } from "../../src/core.js";
import { encodeXlsx, decodeXlsx } from "./xlsx.js";
export type TransferKind = string;
export const isTransferKind = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(v);
export type TransferDocument = {
  schemaVersion: "orgmap-transfer-v1";
  resourceType: string;
  kind: TransferKind;
  records: unknown[];
  manifest: { coverage: string; estimated: boolean; recordCount: number };
};
export function validateDocument(value: unknown): TransferDocument {
  const v = value as TransferDocument;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (k) =>
        ![
          "schemaVersion",
          "resourceType",
          "kind",
          "records",
          "manifest",
        ].includes(k),
    ) ||
    v.schemaVersion !== "orgmap-transfer-v1" ||
    typeof v.resourceType !== "string" ||
    !isTransferKind(v.kind) ||
    !Array.isArray(v.records) ||
    v.records.length > 1000
  )
    fail(422, "INVALID_TRANSFER_SCHEMA");
  if (
    !v.manifest ||
    Object.keys(v.manifest).some(
      (k) => !["coverage", "estimated", "recordCount"].includes(k),
    ) ||
    typeof v.manifest.coverage !== "string" ||
    typeof v.manifest.estimated !== "boolean" ||
    v.manifest.recordCount !== v.records.length
  )
    fail(422, "INVALID_MANIFEST");
  return v;
}
function canonical(v: any): any {
  return Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
}
export const planHash = (v: unknown) => digest(JSON.stringify(canonical(v)));
/** CSV has one JSON record per row, preserving typed values and explicit manifest for reversible interchange. */
export function encodeTransfer(doc: TransferDocument, format: string) {
  if (format === "JSON") return Buffer.from(JSON.stringify(doc));
  if (format === "XLSX")
    return encodeXlsx([
      JSON.stringify({ ...doc, records: [] }),
      ...doc.records.map((v) => JSON.stringify(v)),
    ]);
  const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
  return Buffer.from(
    "orgmap-transfer-v1\r\n" +
      quote(JSON.stringify({ ...doc, records: [] })) +
      "\r\nrecord_json\r\n" +
      doc.records.map((v) => quote(JSON.stringify(v))).join("\r\n") +
      "\r\n",
  );
}
export function decodeTransfer(
  bytes: Buffer,
  format: string,
): TransferDocument {
  if (bytes.length > 5 * 1024 * 1024) fail(413, "FILE_TOO_LARGE");
  if (format === "JSON") {
    try {
      return validateDocument(JSON.parse(bytes.toString("utf8")));
    } catch {
      return fail(422, "INVALID_TRANSFER_SCHEMA");
    }
  }
  if (format === "XLSX") {
    try {
      const rows = decodeXlsx(bytes),
        doc = JSON.parse(rows[0]);
      doc.records = rows.slice(1).map((v) => JSON.parse(v));
      return validateDocument(doc);
    } catch {
      return fail(422, "INVALID_XLSX");
    }
  }
  if (format !== "CSV") fail(422, "INVALID_FORMAT");
  const rows: string[] = [];
  const s = bytes.toString("utf8");
  let value = "",
    quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (quoted && s[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "\n" && !quoted) {
      rows.push(value.replace(/\r$/, ""));
      value = "";
    } else value += c;
  }
  if (
    quoted ||
    value ||
    rows[0] !== "orgmap-transfer-v1" ||
    rows[2] !== "record_json"
  )
    fail(422, "INVALID_CSV");
  try {
    const doc = JSON.parse(rows[1]);
    doc.records = rows
      .slice(3)
      .filter(Boolean)
      .map((v) => JSON.parse(v));
    return validateDocument(doc);
  } catch {
    return fail(422, "INVALID_CSV");
  }
}

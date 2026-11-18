import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { fail } from "../../src/core.js";
import {
  validateRichDocument,
  ContentValidationError,
} from "../../../packages/content/index.js";
import type {
  PdfBundlePayload,
  ReportRenderDocument,
  ReportPdfRenderer,
} from "../meetings/export-contract.js";
import { encodeWorkbook } from "./workbook.js";
import { zip } from "./xlsx.js";
export type {
  PdfBundlePayload,
  ReportRenderDocument,
  ReportPdfRenderer,
} from "../meetings/export-contract.js";
export const REPORT_EXPORT_BUDGETS = Object.freeze({
  maxReports: 100,
  maxPagesPerPdf: 50,
  maxArtifactBytes: 5 * 1024 * 1024,
});
const invalid = (): never => fail(422, "INVALID_REPORT_PACKAGE");
function object(value: unknown, keys: string[]): any {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    invalid();
  return value;
}
function str(value: unknown, max = 500, empty = false): string {
  if (
    typeof value !== "string" ||
    [...value].length > max ||
    (!empty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    invalid();
  return value as string;
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  )
    invalid();
  return value as string;
}
function integer(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return value as number;
}
function instant(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  const s = str(value, 40);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(s) ||
    !Number.isFinite(Date.parse(s))
  )
    invalid();
  try {
    Temporal.Instant.from(s);
  } catch {
    invalid();
  }
  return s;
}
function timezone(value: unknown): string {
  const s = str(value, 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: s });
  } catch {
    invalid();
  }
  return s;
}
function rows(value: unknown, max = 1000): any[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value as any[];
}
function oneOf(value: unknown, values: readonly string[]): string {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as string;
}
export function validateReportDocument(value: unknown): ReportRenderDocument {
  const d = object(value, [
    "schemaVersion",
    "ref",
    "title",
    "circle",
    "state",
    "meeting",
    "sections",
    "roster",
    "agenda",
    "actions",
    "capturedAt",
    "coverage",
  ]);
  if (d.schemaVersion !== 1) invalid();
  const ref = object(d.ref, [
      "reportId",
      "meetingId",
      "reportVersion",
      "publishedVersion",
      "epoch",
      "notesSeq",
    ]),
    circle = object(d.circle, ["id", "label"]),
    meeting = object(d.meeting, [
      "plannedStart",
      "actualStart",
      "actualEnd",
      "timezone",
    ]);
  uuid(ref.reportId);
  uuid(ref.meetingId);
  integer(ref.reportVersion, true);
  integer(ref.publishedVersion, true);
  integer(ref.epoch);
  uuid(circle.id);
  str(circle.label);
  str(d.title);
  oneOf(d.state, ["DRAFT", "PUBLISHED"]);
  if (d.state === "PUBLISHED" && ref.publishedVersion === null) invalid();
  instant(meeting.plannedStart);
  instant(meeting.actualStart, true);
  instant(meeting.actualEnd, true);
  timezone(meeting.timezone);
  instant(d.capturedAt);
  str(d.coverage, 10000, true);
  const sectionIds = new Set<string>();
  const sections = rows(d.sections, 100).map((s) => {
    object(s, ["id", "heading", "body"]);
    const id = str(s.id, 100);
    if (sectionIds.has(id)) invalid();
    sectionIds.add(id);
    str(s.heading);
    try {
      return { ...s, body: validateRichDocument(s.body) };
    } catch (e) {
      if (e instanceof ContentValidationError)
        fail(422, "INVALID_REPORT_RICH_DOCUMENT");
      throw e;
    }
  });
  if (
    !ref.notesSeq ||
    typeof ref.notesSeq !== "object" ||
    Array.isArray(ref.notesSeq) ||
    Object.keys(ref.notesSeq).length !== sectionIds.size
  )
    invalid();
  for (const [key, seq] of Object.entries(ref.notesSeq)) {
    if (!sectionIds.has(key)) invalid();
    integer(seq);
  }
  for (const r of rows(d.roster)) {
    object(r, ["memberId", "label", "attendance", "participationRole"]);
    uuid(r.memberId);
    str(r.label);
    oneOf(r.attendance, ["INVITED", "PRESENT", "ABSENT"]);
    oneOf(r.participationRole, ["REQUIRED", "OPTIONAL"]);
  }
  for (const a of rows(d.agenda)) {
    object(a, [
      "id",
      "title",
      "presenterId",
      "durationMinutes",
      "status",
      "skipped",
    ]);
    uuid(a.id);
    str(a.title, 1000);
    uuid(a.presenterId);
    integer(a.durationMinutes, true);
    oneOf(a.status, ["OPEN", "COMPLETED", "TRANSFERRED", "WITHDRAWN"]);
    if (typeof a.skipped !== "boolean") invalid();
  }
  for (const a of rows(d.actions)) {
    object(a, ["id", "agendaId", "title", "assigneeId", "state"]);
    uuid(a.id);
    if (a.agendaId !== null) uuid(a.agendaId);
    str(a.title, 1000);
    uuid(a.assigneeId);
    oneOf(a.state, ["OPEN", "DONE"]);
  }
  return { ...d, sections };
}
export function validateReportPackage(value: unknown): PdfBundlePayload {
  const p = object(value, [
    "schema",
    "documents",
    "selectionId",
    "asOf",
    "timezone",
    "reportSource",
    "coverage",
    "notices",
  ]);
  if (p.schema !== "orgmap-meeting-pdf-bundle-v1") invalid();
  uuid(p.selectionId);
  instant(p.asOf);
  timezone(p.timezone);
  oneOf(p.reportSource, ["PUBLISHED", "CURRENT_AUTHORIZED"]);
  str(p.coverage, 10000, true);
  rows(p.notices, 2).forEach((n) =>
    oneOf(n, ["EMPTY_AUTHORIZED_SELECTION", "NO_PUBLISHED_REPORT"]),
  );
  if (!Array.isArray(p.documents)) invalid();
  if (p.documents.length > REPORT_EXPORT_BUDGETS.maxReports)
    fail(413, "REPORT_COUNT_LIMIT");
  const documents = p.documents.map(validateReportDocument),
    refs = new Set<string>();
  for (const d of documents) {
    const key = d.ref.reportId.toLowerCase();
    if (refs.has(key)) invalid();
    refs.add(key);
    if (p.reportSource === "PUBLISHED" && d.state !== "PUBLISHED") invalid();
  }
  if (!documents.length && !p.notices.includes("EMPTY_AUTHORIZED_SELECTION"))
    invalid();
  if (
    Buffer.byteLength(JSON.stringify(p)) >
    REPORT_EXPORT_BUDGETS.maxArtifactBytes
  )
    fail(413, "REPORT_PACKAGE_TOO_LARGE");
  return { ...p, documents };
}
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export function createReportPackageSerializer(renderer: ReportPdfRenderer) {
  return {
    budgets: REPORT_EXPORT_BUDGETS,
    async serialize(value: unknown, format: "PDF" | "ZIP") {
      if (format !== "PDF" && format !== "ZIP")
        fail(422, "INVALID_REPORT_FORMAT");
      const payload = validateReportPackage(value);
      if (format === "PDF" && payload.documents.length !== 1)
        fail(422, "SINGLE_REPORT_REQUIRED");
      const entries: Record<string, Buffer> = {},
        index: (string | number | null)[][] = [],
        manifestFiles: {
          path: string;
          sha256: string;
          size: number;
          pages: number;
          ref: ReportRenderDocument["ref"];
          rendererVersion: string;
        }[] = [];
      let generatedBytes = 0;
      for (const document of payload.documents) {
        const result = await renderer.render(document),
          bytes = Buffer.from(result.bytes);
        if (
          !Number.isInteger(result.pages) ||
          result.pages < 1 ||
          result.pages > REPORT_EXPORT_BUDGETS.maxPagesPerPdf
        )
          fail(413, "REPORT_PAGE_LIMIT");
        if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
          fail(422, "INVALID_RENDERED_PDF");
        if (bytes.length > REPORT_EXPORT_BUDGETS.maxArtifactBytes)
          fail(413, "EXPORT_TOO_LARGE");
        generatedBytes += bytes.length;
        if (generatedBytes > REPORT_EXPORT_BUDGETS.maxArtifactBytes)
          fail(413, "EXPORT_TOO_LARGE");
        const path = `circle-${document.circle.id.toLowerCase()}/report-${document.ref.reportId.toLowerCase()}-v${document.ref.reportVersion ?? "draft"}.pdf`;
        if (Object.hasOwn(entries, path)) invalid();
        entries[path] = bytes;
        manifestFiles.push({
          path,
          sha256: sha(bytes),
          size: bytes.length,
          pages: result.pages,
          ref: document.ref,
          rendererVersion: str(result.rendererVersion, 100),
        });
        index.push([
          document.ref.reportId,
          document.ref.meetingId,
          document.title,
          document.circle.label,
          document.meeting.plannedStart,
          document.state,
          document.ref.reportVersion,
          document.ref.epoch,
          JSON.stringify(document.ref.notesSeq),
          path,
          result.pages,
          document.coverage,
          result.rendererVersion,
        ]);
      }
      if (format === "PDF") return entries[manifestFiles[0].path];
      const indexBytes = encodeWorkbook(
        {
          sheets: [
            {
              name: "Índice",
              columns: [
                "reportId",
                "meetingId",
                "title",
                "circleLabel",
                "meetingDate",
                "state",
                "sourceVersion",
                "epoch",
                "notesSeqSummary",
                "relativeFilePath",
                "pages",
                "coverage",
                "rendererVersion",
              ],
              rows: index,
            },
          ],
        },
        "XLSX",
      );
      entries["index.xlsx"] = indexBytes;
      entries["manifest.json"] = Buffer.from(
        JSON.stringify(
          {
            schema: "orgmap-meeting-pdf-bundle-manifest-v1",
            selectionId: payload.selectionId,
            asOf: payload.asOf,
            timezone: payload.timezone,
            reportSource: payload.reportSource,
            coverage: payload.coverage,
            notices: payload.notices,
            count: manifestFiles.length,
            files: manifestFiles,
            index: {
              path: "index.xlsx",
              sha256: sha(indexBytes),
              size: indexBytes.length,
            },
          },
          null,
          2,
        ),
      );
      const bytes = zip(entries);
      if (bytes.length > REPORT_EXPORT_BUDGETS.maxArtifactBytes)
        fail(413, "EXPORT_TOO_LARGE");
      return bytes;
    },
  };
}

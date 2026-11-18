import { fail } from "../../src/core.js";
import { zip } from "./xlsx.js";
export type WorkbookCell = string | number | boolean | null;
export type ExportWorkbook = {
  sheets: { name: string; columns: string[]; rows: WorkbookCell[][] }[];
};
const keys = (v: object, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const text = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 32767 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(v);
export function validateWorkbook(value: unknown): ExportWorkbook {
  const v = value as ExportWorkbook;
  if (
    !v ||
    !keys(v, ["sheets"]) ||
    !Array.isArray(v.sheets) ||
    !v.sheets.length ||
    v.sheets.length > 16
  )
    fail(422, "INVALID_WORKBOOK");
  const names = new Set<string>();
  let cells = 0,
    bytes = 0;
  for (const s of v.sheets) {
    if (
      !s ||
      !keys(s, ["name", "columns", "rows"]) ||
      !text(s.name) ||
      !s.name.length ||
      s.name.length > 31 ||
      /[\\/?*\[\]:]/u.test(s.name) ||
      /^'|'$/u.test(s.name) ||
      names.has(s.name.toLowerCase()) ||
      !Array.isArray(s.columns) ||
      !s.columns.length ||
      s.columns.length > 128 ||
      !s.columns.every((c) => text(c) && c.length > 0) ||
      new Set(s.columns).size !== s.columns.length ||
      !Array.isArray(s.rows) ||
      s.rows.length > 10000
    )
      fail(422, "INVALID_WORKBOOK");
    names.add(s.name.toLowerCase());
    bytes += Buffer.byteLength(s.name + s.columns.join(""));
    for (const row of s.rows) {
      if (
        !Array.isArray(row) ||
        row.length !== s.columns.length ||
        !row.every(
          (c) =>
            c === null ||
            typeof c === "boolean" ||
            (typeof c === "number" && Number.isFinite(c)) ||
            text(c),
        )
      )
        fail(422, "INVALID_WORKBOOK");
      cells += row.length;
      bytes += row.reduce<number>(
        (n, c) => n + (c === null ? 0 : Buffer.byteLength(String(c))),
        0,
      );
      if (cells > 100000 || bytes > 4 * 1024 * 1024)
        fail(413, "WORKBOOK_TOO_LARGE");
    }
  }
  return v;
}
const xml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const col = (index: number): string =>
  index < 26
    ? String.fromCharCode(65 + index)
    : col(Math.floor(index / 26) - 1) + col(index % 26);
/** Export-only workbook. Strings are inlineStr, never formulas or external relationships. */
export function encodeWorkbook(value: unknown, format: "XLSX" | "CSV"): Buffer {
  if (format !== "XLSX" && format !== "CSV")
    fail(422, "INVALID_WORKBOOK_FORMAT");
  const workbook = validateWorkbook(value);
  if (format === "CSV") {
    if (workbook.sheets.length !== 1) fail(422, "CSV_REQUIRES_SINGLE_SHEET");
    const quote = (cell: WorkbookCell) => {
      let s = cell === null ? "" : String(cell);
      if (typeof cell === "string" && /^[\s]*[=+@-]/u.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const sheet = workbook.sheets[0];
    return Buffer.from(
      [sheet.columns, ...sheet.rows]
        .map((row) => row.map(quote).join(","))
        .join("\r\n") + "\r\n",
    );
  }
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const entries: Record<string, string> = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      workbook.sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      "</Types>",
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":
      `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>` +
      workbook.sheets
        .map(
          (s, i) =>
            `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("") +
      "</sheets></workbook>",
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      workbook.sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      "</Relationships>",
  };
  workbook.sheets.forEach((s, i) => {
    entries[`xl/worksheets/sheet${i + 1}.xml`] =
      `<worksheet xmlns="${ns}"><sheetData>` +
      [s.columns, ...s.rows]
        .map(
          (row, r) =>
            `<row r="${r + 1}">` +
            row
              .map((c, k) => {
                const ref = col(k) + (r + 1);
                return c === null
                  ? `<c r="${ref}"/>`
                  : typeof c === "number"
                    ? `<c r="${ref}"><v>${c}</v></c>`
                    : typeof c === "boolean"
                      ? `<c r="${ref}" t="b"><v>${c ? 1 : 0}</v></c>`
                      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(c)}</t></is></c>`;
              })
              .join("") +
            "</row>",
        )
        .join("") +
      "</sheetData></worksheet>";
  });
  return zip(entries);
}

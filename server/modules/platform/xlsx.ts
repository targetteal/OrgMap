import { inflateRawSync } from "node:zlib";
import { fail } from "../../src/core.js";
// Deliberately bounded OOXML dialect for OrgMap transfer sheets (inline UTF-8 strings).
// Does not execute formulas, macros, external links, shared-string references or XML entities.
const crc = (data: Buffer) => {
  let n = 0xffffffff;
  for (const byte of data) {
    n ^= byte;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
};
const xml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const unxml = (s: string) => {
  if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(s)) fail(422, "INVALID_XLSX");
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
};
export function zip(entries: Record<string, string | Buffer>) {
  const names = Object.keys(entries);
  if (names.length > 512) fail(413, "ZIP_ENTRY_LIMIT");
  for (const name of names)
    if (
      name.length > 200 ||
      !/^[A-Za-z0-9_.\[\]/-]+$/.test(name) ||
      name.split("/").some((part) => !part || part === "." || part === "..")
    )
      fail(422, "INVALID_ZIP_PATH");
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, source] of Object.entries(entries)) {
    const filename = Buffer.from(name),
      data = Buffer.from(source),
      head = Buffer.alloc(30),
      directory = Buffer.alloc(46),
      checksum = crc(data);
    head.writeUInt32LE(0x04034b50);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(checksum, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(head, filename, data);
    central.push(directory, filename);
    offset += head.length + filename.length + data.length;
  }
  const body = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(body.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, body, end]);
}
const permitted = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/worksheets/sheet1.xml",
];
export function encodeXlsx(rows: string[]) {
  const cell = (s: string, n: number) =>
    `<row r="${n}"><c r="A${n}" t="inlineStr"><is><t xml:space="preserve">${xml(s)}</t></is></c></row>`;
  return zip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OrgMap" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml":
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rows.map((s, i) => cell(s, i + 1)).join("") +
      "</sheetData></worksheet>",
  });
}
export function decodeXlsx(bytes: Buffer) {
  let offset = 0,
    total = 0;
  const entries = new Map<string, string>();
  while (
    offset + 4 <= bytes.length &&
    bytes.readUInt32LE(offset) === 0x04034b50
  ) {
    if (offset + 30 > bytes.length) fail(422, "INVALID_XLSX");
    const flags = bytes.readUInt16LE(offset + 6),
      method = bytes.readUInt16LE(offset + 8),
      checksum = bytes.readUInt32LE(offset + 14),
      size = bytes.readUInt32LE(offset + 18),
      expanded = bytes.readUInt32LE(offset + 22),
      len = bytes.readUInt16LE(offset + 26),
      extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + len).toString(),
      start = offset + 30 + len + extra;
    total += expanded;
    if (
      flags !== 0 ||
      ![0, 8].includes(method) ||
      !permitted.includes(name) ||
      entries.has(name) ||
      total > 8 * 1024 * 1024 ||
      start + size > bytes.length
    )
      fail(422, "INVALID_XLSX");
    const compressed = bytes.subarray(start, start + size);
    let data: Buffer;
    try {
      data =
        method === 0
          ? compressed
          : inflateRawSync(compressed, { maxOutputLength: 8 * 1024 * 1024 });
    } catch {
      return fail(422, "INVALID_XLSX");
    }
    if (data.length !== expanded || crc(data) !== checksum)
      fail(422, "INVALID_XLSX");
    const source = data.toString("utf8");
    if (
      /<!DOCTYPE|<!ENTITY|<f[ >]|TargetMode\s*=|<external|<v[ >]/i.test(source)
    )
      fail(422, "UNSAFE_XLSX");
    entries.set(name, source);
    offset = start + size;
  }
  if (
    entries.size !== permitted.length ||
    offset + 4 > bytes.length ||
    bytes.readUInt32LE(offset) !== 0x02014b50
  )
    fail(422, "INVALID_XLSX");
  const sheet = entries.get("xl/worksheets/sheet1.xml")!;
  const rows = [
    ...sheet.matchAll(
      /<row r="\d+"><c r="A\d+" t="inlineStr"><is><t xml:space="preserve">([\s\S]*?)<\/t><\/is><\/c><\/row>/g,
    ),
  ].map((m) => unxml(m[1]));
  if (rows.length < 1 || rows.length > 1002) fail(422, "INVALID_XLSX");
  return rows;
}

import { inflateRawSync } from "node:zlib";
import { fail } from "../../src/core.js";

// Bounded reader for external governance exports (flat CSV files inside a zip).
// Reads the central directory so entries with data descriptors still resolve.
const KNOWN_FILES = [
  "circles.csv",
  "roles.csv",
  "assignments.csv",
  "policies.csv",
  "documents.csv",
] as const;
export type GovernanceFile = (typeof KNOWN_FILES)[number];
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 5000;

function archiveEntries(bytes: Buffer): Map<GovernanceFile, Buffer> {
  const entries = new Map<GovernanceFile, Buffer>();
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) fail(422, "INVALID_GOVERNANCE_ARCHIVE");
  // End of central directory may be followed by a comment of up to 65535 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) fail(422, "INVALID_GOVERNANCE_ARCHIVE");
  const count = bytes.readUInt16LE(eocd + 10),
    directorySize = bytes.readUInt32LE(eocd + 12),
    directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (
    count > 512 ||
    directoryOffset + directorySize > eocd ||
    bytes.readUInt32LE(directoryOffset) !== 0x02014b50
  )
    fail(422, "INVALID_GOVERNANCE_ARCHIVE");
  let total = 0,
    position = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (position + 46 > bytes.length || bytes.readUInt32LE(position) !== 0x02014b50)
      fail(422, "INVALID_GOVERNANCE_ARCHIVE");
    const method = bytes.readUInt16LE(position + 10),
      compressed = bytes.readUInt32LE(position + 20),
      expanded = bytes.readUInt32LE(position + 24),
      nameLength = bytes.readUInt16LE(position + 28),
      extraLength = bytes.readUInt16LE(position + 30),
      commentLength = bytes.readUInt16LE(position + 32),
      localOffset = bytes.readUInt32LE(position + 42);
    const name = bytes
        .subarray(position + 46, position + 46 + nameLength)
        .toString("utf8")
        .split("/")
        .pop()!
        .toLowerCase() as GovernanceFile,
      next = position + 46 + nameLength + extraLength + commentLength;
    position = next;
    if (!KNOWN_FILES.includes(name) || entries.has(name)) continue;
    if (
      ![0, 8].includes(method) ||
      expanded > MAX_FILE_BYTES ||
      (total += expanded) > MAX_TOTAL_BYTES ||
      localOffset + 30 > bytes.length ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    )
      fail(422, "INVALID_GOVERNANCE_ARCHIVE");
    const localName = bytes.readUInt16LE(localOffset + 26),
      localExtra = bytes.readUInt16LE(localOffset + 28),
      start = localOffset + 30 + localName + localExtra;
    if (start + compressed > bytes.length) fail(422, "INVALID_GOVERNANCE_ARCHIVE");
    const source = bytes.subarray(start, start + compressed);
    let data: Buffer;
    try {
      data =
        method === 0
          ? source
          : inflateRawSync(source, { maxOutputLength: MAX_FILE_BYTES });
    } catch {
      return fail(422, "INVALID_GOVERNANCE_ARCHIVE");
    }
    if (data.length !== expanded) fail(422, "INVALID_GOVERNANCE_ARCHIVE");
    entries.set(name, data);
  }
  return entries;
}

export function parseCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let field = "",
    row: string[] = [],
    quoted = false,
    started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && !started) {
      quoted = true;
      started = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      started = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      started = false;
      rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS) fail(422, "INVALID_GOVERNANCE_ARCHIVE");
    } else {
      field += c;
      started = true;
    }
  }
  if (quoted) fail(422, "INVALID_GOVERNANCE_ARCHIVE");
  if (started || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function table(
  rows: string[][] | undefined,
  required: string[],
): Record<string, string>[] {
  if (rows === undefined) return [];
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  for (const column of required)
    if (!header.includes(column)) fail(422, "INVALID_GOVERNANCE_ARCHIVE");
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) =>
      Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""])),
    );
}

export type GovernanceArchive = {
  circles: {
    sourceId: string;
    name: string;
    parentSourceId: string;
    purpose: string;
    domains: string;
    accountabilities: string;
    strategy: string;
  }[];
  roles: {
    sourceId: string;
    circleSourceId: string;
    name: string;
    purpose: string;
    domains: string;
    accountabilities: string;
    extraDomains: string;
    extraAccountabilities: string;
  }[];
  assignments: {
    memberEmail: string;
    memberName: string;
    roleSourceId: string;
    since: string;
    until: string;
    scope: string;
  }[];
  policies: {
    circleSourceId: string;
    roleSourceId: string;
    domain: string;
    title: string;
    description: string;
  }[];
  documents: {
    circleSourceId: string;
    roleSourceId: string;
    memberEmail: string;
    title: string;
    description: string;
    type: string;
    status: string;
    privacy: string;
  }[];
};

export function parseGovernanceArchive(bytes: Buffer): GovernanceArchive {
  const entries = archiveEntries(bytes);
  if (!entries.size || !entries.has("circles.csv"))
    fail(422, "INVALID_GOVERNANCE_ARCHIVE");
  const read = (name: GovernanceFile) => {
    const data = entries.get(name);
    return data === undefined ? undefined : parseCsv(data.toString("utf8"));
  };
  const circles = table(read("circles.csv"), ["circle_id", "circle_name"]).map(
    (row) => ({
      sourceId: row.circle_id.trim(),
      name: row.circle_name.trim(),
      parentSourceId: (row.parent_circle_id ?? "").trim(),
      purpose: row.purpose ?? "",
      domains: row.domains ?? "",
      accountabilities: row.accountabilities ?? "",
      strategy: row.strategy ?? "",
    }),
  );
  const roles = table(read("roles.csv"), [
    "circle_id",
    "role_id",
    "role_name",
  ]).map((row) => ({
    sourceId: row.role_id.trim(),
    circleSourceId: row.circle_id.trim(),
    name: row.role_name.trim(),
    purpose: row.purpose ?? "",
    domains: row.domains ?? "",
    accountabilities: row.accountabilities ?? "",
    extraDomains: row.extra_domains ?? "",
    extraAccountabilities: row.extra_accountabilities ?? "",
  }));
  const assignments = table(read("assignments.csv"), [
    "member_email",
    "role_id",
  ]).map((row) => ({
    memberEmail: row.member_email.trim(),
    memberName: (row.member_display_name ?? "").trim(),
    roleSourceId: row.role_id.trim(),
    since: (row.since ?? "").trim(),
    until: (row.until ?? "").trim(),
    scope: row.scope ?? "",
  }));
  const policies = table(read("policies.csv"), ["policy"]).map((row) => ({
    circleSourceId: (row.circle_id ?? "").trim(),
    roleSourceId: (row.role_id ?? "").trim(),
    domain: row.domain ?? "",
    title: row.policy.trim(),
    description: row.description ?? "",
  }));
  const documents = table(read("documents.csv"), ["title"]).map((row) => ({
    circleSourceId: (row.circle_id ?? "").trim(),
    roleSourceId: (row.role_id ?? "").trim(),
    memberEmail: (row.member_email ?? "").trim(),
    title: row.title.trim(),
    description: row.description ?? "",
    type: (row.type ?? "").trim(),
    status: (row.status ?? "").trim().toUpperCase(),
    privacy: (row.privacy ?? "").trim().toUpperCase(),
  }));
  return { circles, roles, assignments, policies, documents };
}

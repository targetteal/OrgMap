import { fail, id, text } from "../../src/core.js";
export function object(v: unknown, keys: string[]): Record<string, any> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(400, "INVALID_REQUEST");
  return v as Record<string, any>;
}
export const flagNames = [
  "core",
  "electable",
  "assigner",
  "representative",
  "admin",
] as const;
export type Flags = Record<(typeof flagNames)[number], boolean>;
export function flags(v: unknown): Flags {
  const p = object(v, [...flagNames]);
  if (flagNames.some((k) => typeof p[k] !== "boolean"))
    fail(400, "INVALID_REQUEST");
  return p as Flags;
}
export const defaultFlags: Flags = {
  core: false,
  electable: false,
  assigner: false,
  representative: false,
  admin: false,
};
export function integer(v: unknown, min = 0, max = 100000) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    fail(400, "INVALID_REQUEST");
  return v as number;
}
export function timestamp(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail(400, "INVALID_REQUEST");
  return new Date(v as string).toISOString();
}
export type FieldSchema = {
  type:
    "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "SELECT" | "MULTI" | "COMPUTED";
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  formula?: { op: "SUM" | "COUNT"; fieldIds: string[] };
};
export function fieldSchema(v: unknown): FieldSchema {
  const s = object(v, ["type", "required", "options", "min", "max", "formula"]);
  if (
    ![
      "TEXT",
      "NUMBER",
      "BOOLEAN",
      "DATE",
      "SELECT",
      "MULTI",
      "COMPUTED",
    ].includes(s.type) ||
    typeof s.required !== "boolean"
  )
    fail(400, "INVALID_REQUEST");
  if (
    s.min !== undefined &&
    (!Number.isFinite(s.min) || typeof s.min !== "number")
  )
    fail(400, "INVALID_REQUEST");
  if (
    s.max !== undefined &&
    (!Number.isFinite(s.max) || typeof s.max !== "number")
  )
    fail(400, "INVALID_REQUEST");
  if (s.min !== undefined && s.max !== undefined && s.min > s.max)
    fail(422, "DOMAIN_INVARIANT");
  if (["SELECT", "MULTI"].includes(s.type)) {
    if (
      !Array.isArray(s.options) ||
      !s.options.length ||
      s.options.length > 100 ||
      new Set(s.options).size !== s.options.length
    )
      fail(400, "INVALID_REQUEST");
    s.options = s.options.map((x: unknown) => text(x, 100));
  } else if (s.options !== undefined) fail(400, "INVALID_REQUEST");
  if (s.type === "COMPUTED") {
    const f = object(s.formula, ["op", "fieldIds"]);
    if (
      !["SUM", "COUNT"].includes(f.op) ||
      !Array.isArray(f.fieldIds) ||
      !f.fieldIds.length ||
      f.fieldIds.length > 20
    )
      fail(400, "INVALID_REQUEST");
    f.fieldIds = f.fieldIds.map(id);
  } else if (s.formula !== undefined) fail(400, "INVALID_REQUEST");
  return s as FieldSchema;
}
export function fieldValue(s: FieldSchema, v: unknown) {
  if (v === null) {
    if (s.required) fail(422, "FIELD_REQUIRED");
    return null;
  }
  switch (s.type) {
    case "COMPUTED":
      fail(422, "COMPUTED_READ_ONLY");
    case "TEXT":
      text(v, s.max ?? 10000);
      if ((v as string).length < (s.min ?? 0)) fail(422, "FIELD_LIMIT");
      break;
    case "NUMBER":
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        (s.min !== undefined && v < s.min) ||
        (s.max !== undefined && v > s.max)
      )
        fail(422, "FIELD_TYPE");
      break;
    case "BOOLEAN":
      if (typeof v !== "boolean") fail(422, "FIELD_TYPE");
      break;
    case "DATE":
      if (
        typeof v !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v
      )
        fail(422, "FIELD_TYPE");
      break;
    case "SELECT":
      if (!s.options?.includes(v as string)) fail(422, "FIELD_TYPE");
      break;
    case "MULTI":
      if (
        !Array.isArray(v) ||
        new Set(v).size !== v.length ||
        v.some((x) => !s.options?.includes(x))
      )
        fail(422, "FIELD_TYPE");
      break;
  }
  return v;
}
export type ViewConfig = {
  view: "PACK" | "TREE" | "DIRECTORY" | "NETWORK";
  query: string;
  kind: "ALL" | "CIRCLE" | "ROLE";
  rootId: string | null;
  memberId: string | null;
  flag: string | null;
  maxDepth: number;
  field?: { fieldId: string; equals: unknown };
  presentation?: {
    quick:
      "none" | "my-roles" | "my-circles" | "no-purpose" | "members-no-role";
    highlight: "none" | "mine" | "vacant";
    labels: boolean;
    avatars: boolean;
    minimap: boolean;
  };
};
export function viewConfig(v: unknown): ViewConfig {
  const x = object(v, [
    "view",
    "query",
    "kind",
    "rootId",
    "memberId",
    "flag",
    "maxDepth",
    "field",
    "presentation",
  ]);
  if (
    !["PACK", "TREE", "DIRECTORY", "NETWORK"].includes(x.view) ||
    !["ALL", "CIRCLE", "ROLE"].includes(x.kind) ||
    typeof x.query !== "string" ||
    x.query.length > 200
  )
    fail(400, "INVALID_REQUEST");
  if (x.rootId !== null) id(x.rootId);
  if (x.memberId !== null) id(x.memberId);
  if (x.flag !== null && !flagNames.includes(x.flag))
    fail(400, "INVALID_REQUEST");
  integer(x.maxDepth, 1, 100);
  if (x.field) {
    object(x.field, ["fieldId", "equals"]);
    id(x.field.fieldId);
  }
  if (x.presentation !== undefined) {
    const p = object(x.presentation, [
      "quick",
      "highlight",
      "labels",
      "avatars",
      "minimap",
    ]);
    if (
      ![
        "none",
        "my-roles",
        "my-circles",
        "no-purpose",
        "members-no-role",
      ].includes(p.quick) ||
      !["none", "mine", "vacant"].includes(p.highlight) ||
      ["labels", "avatars", "minimap"].some((k) => typeof p[k] !== "boolean")
    )
      fail(400, "INVALID_REQUEST");
  }
  return x as ViewConfig;
}
export const initialView: ViewConfig = {
  view: "TREE",
  query: "",
  kind: "ALL",
  rootId: null,
  memberId: null,
  flag: null,
  maxDepth: 100,
};

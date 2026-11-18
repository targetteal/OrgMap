import { fail, text } from "../../src/core.js";
import { colorTheme } from "./color-theme.js";
import {
  readContent,
  toPlainText,
  isSafeLink,
} from "../../../packages/content/index.js";
function content(value: unknown, required = false) {
  try {
    const doc = readContent(value);
    const plain = toPlainText(doc);
    if (plain.length > 20000 || (required && !plain.trim()))
      fail(422, "INVALID_RICH_DOCUMENT");
  } catch {
    fail(422, "INVALID_RICH_DOCUMENT");
  }
}
export const kinds = [
  "policy",
  "field",
  "template",
  "group",
  "profile",
  "page",
] as const;
export type Kind = (typeof kinds)[number];
export function object(v: unknown, keys: string[]): any {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(400, "INVALID_REQUEST");
  return v;
}
export function settings(v: unknown) {
  const x = object(v, [
    "name",
    "locale",
    "timezone",
    "branding",
    "vocabulary",
    "modules",
    "oversight",
    "onboarding",
    "legal",
    "display",
    "notifications",
  ]);
  text(x.name);
  text(x.locale, 30);
  text(x.timezone, 100);
  if (x.notifications !== undefined) {
    const notifications = object(x.notifications, ["emailEnabled"]);
    if (typeof notifications.emailEnabled !== "boolean")
      fail(422, "INVALID_NOTIFICATION_SETTINGS");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: x.timezone }).format();
  } catch {
    fail(422, "INVALID_TIMEZONE");
  }
  const b = object(x.branding, ["color", "colorTheme", "logoUrl", "showOrganizationName"]);
  if (b.colorTheme !== undefined) colorTheme(b.colorTheme);
  if (
    b.showOrganizationName !== undefined &&
    typeof b.showOrganizationName !== "boolean"
  )
    fail(422, "INVALID_BRANDING");
  if (
    !/^#[0-9a-f]{6}$/i.test(b.color) ||
    (b.logoUrl !== null && !/^https:\/\/[^\s]+$/.test(b.logoUrl))
  )
    fail(422, "INVALID_BRANDING");
  object(x.vocabulary, ["circle", "role", "member"]);
  Object.values(x.vocabulary).forEach((v) => text(v, 80));
  object(x.modules, ["goals", "work", "meetings", "governance"]);
  if (Object.values(x.modules).some((v) => typeof v !== "boolean"))
    fail(422, "INVALID_MODULES");
  object(x.oversight, ["readMeeting", "privateOperationalExport"]);
  if (Object.values(x.oversight).some((v) => typeof v !== "boolean"))
    fail(422, "INVALID_OVERSIGHT");
  object(x.onboarding, [
    "enabled",
    "title",
    "body",
    "audience",
    "destination",
    "videoUrl",
    "attachmentUrl",
  ]);
  if (typeof x.onboarding.enabled !== "boolean")
    fail(422, "INVALID_ONBOARDING");
  text(x.onboarding.title, 200);
  content(x.onboarding.body);
  if (
    x.onboarding.audience !== undefined &&
    !["MEMBER", "GUEST", "ALL"].includes(x.onboarding.audience)
  )
    fail(422, "INVALID_ONBOARDING");
  if (
    x.onboarding.destination !== undefined &&
    !["HOME", "STRUCTURE", "GOALS", "WORK", "MEETINGS"].includes(
      x.onboarding.destination,
    )
  )
    fail(422, "INVALID_ONBOARDING");
  for (const k of ["videoUrl", "attachmentUrl"])
    if (
      x.onboarding[k] !== undefined &&
      x.onboarding[k] !== null &&
      (!isSafeLink(x.onboarding[k]) || !x.onboarding[k].startsWith("https://"))
    )
      fail(422, "UNSAFE_LINK");
  if (
    x.onboarding.videoUrl &&
    !/\.mp4$/i.test(new URL(x.onboarding.videoUrl).pathname)
  )
    fail(422, "INVALID_ONBOARDING_VIDEO");
  object(x.legal, [
    "name",
    "address",
    "termsUrl",
    "privacyUrl",
    "contactName",
    "contactEmail",
    "contactPhone",
  ]);
  for (const k of [
    "name",
    "address",
    "contactName",
    "contactEmail",
    "contactPhone",
  ])
    if (x.legal[k] !== undefined)
      if (typeof x.legal[k] !== "string" || x.legal[k].length > 2000)
        fail(422, "INVALID_LEGAL");
  if (
    x.legal.contactEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.legal.contactEmail)
  )
    fail(422, "INVALID_LEGAL");
  for (const k of ["termsUrl", "privacyUrl"])
    if (x.legal[k] !== null && !/^https:\/\/[^\s]+$/.test(x.legal[k]))
      fail(422, "INVALID_LEGAL");
  object(x.display, ["directoryFields", "hoverFields"]);
  for (const [key, max] of [
    ["directoryFields", 2],
    ["hoverFields", 3],
  ] as const)
    if (
      !Array.isArray(x.display[key]) ||
      x.display[key].length > max ||
      x.display[key].some((k: any) => typeof k !== "string") ||
      new Set(x.display[key]).size !== x.display[key].length
    )
      fail(422, "PROFILE_DISPLAY_LIMIT");
  return {
    ...x,
    branding: { ...defaults(x.name).branding, ...x.branding },
    onboarding: { ...defaults(x.name).onboarding, ...x.onboarding },
    legal: { ...defaults(x.name).legal, ...x.legal },
  };
}
export const defaults = (
  name: string,
  locale = "pt-BR",
  timezone = "America/Sao_Paulo",
) => ({
  name,
  locale,
  timezone,
  branding: { color: "#0B7077", colorTheme: "mare", logoUrl: null, showOrganizationName: true },
  vocabulary: { circle: "Círculo", role: "Papel", member: "Membro" },
  modules: { goals: false, work: true, meetings: true, governance: true },
  oversight: { readMeeting: false, privateOperationalExport: false },
  notifications: { emailEnabled: true },
  onboarding: {
    enabled: false,
    title: "Boas-vindas",
    body: "",
    audience: "MEMBER",
    destination: "HOME",
    videoUrl: null,
    attachmentUrl: null,
  },
  legal: {
    name: "",
    address: "",
    termsUrl: null,
    privacyUrl: null,
    contactName: "",
    contactEmail: "",
    contactPhone: "",
  },
  display: { directoryFields: [], hoverFields: [] },
});
export function validate(kind: Kind, input: unknown) {
  const keys: Record<Kind, string[]> = {
    policy: ["key", "value", "allowOverride", "parentId"],
    field: [
      "key",
      "label",
      "type",
      "required",
      "locked",
      "options",
      "visibility",
    ],
    template: ["name", "fields"],
    group: ["name", "parentId", "memberIds"],
    profile: ["memberId", "managerId", "visibility", "values"],
    page: ["title", "slug", "sections"],
  };
  const x = object(input, keys[kind]);
  if (kind === "field") {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(x.key) ||
      ["constructor", "prototype"].includes(x.key)
    )
      fail(422, "INVALID_FIELD_KEY");
    text(x.label);
    if (
      !["text", "number", "boolean", "date", "select", "multi"].includes(
        x.type,
      ) ||
      typeof x.required !== "boolean" ||
      typeof x.locked !== "boolean" ||
      !["organization", "private"].includes(x.visibility)
    )
      fail(422, "INVALID_FIELD");
    if (
      !Array.isArray(x.options) ||
      x.options.length > 100 ||
      new Set(x.options).size !== x.options.length ||
      x.options.some(
        (v: any) => typeof v !== "string" || !v.trim().length || v.length > 200,
      )
    )
      fail(422, "INVALID_OPTIONS");
  }
  if (kind === "policy") {
    if (
      !/^[a-z][a-zA-Z0-9.]{0,79}$/.test(x.key) ||
      typeof x.allowOverride !== "boolean" ||
      !("value" in x)
    )
      fail(422, "INVALID_POLICY");
    const valid =
      x.key === "governance.method"
        ? ["MANUAL_FACILITATED", "CONSENT_ROUND", "CONSENT_WINDOW"].includes(
            x.value,
          )
        : [
              "organization.allowGuests",
              "structure.collectiveManagement",
            ].includes(x.key)
          ? typeof x.value === "boolean"
          : x.key === "member.profileVisibility"
            ? ["organization", "private"].includes(x.value)
            : x.key === "security.minimumPasswordLength"
              ? Number.isInteger(x.value) && x.value >= 12 && x.value <= 128
              : false;
    if (!valid) fail(422, "INVALID_POLICY_VALUE");
  }
  if (kind === "group") {
    text(x.name);
    if (
      !Array.isArray(x.memberIds) ||
      new Set(x.memberIds).size !== x.memberIds.length
    )
      fail(422, "INVALID_MEMBERS");
  }
  if (kind === "profile") {
    if (!["organization", "private"].includes(x.visibility))
      fail(422, "INVALID_VISIBILITY");
    if (!x.values || typeof x.values !== "object" || Array.isArray(x.values))
      fail(422, "INVALID_VALUES");
  }
  if (kind === "template") {
    text(x.name);
    if (!Array.isArray(x.fields) || new Set(x.fields).size !== x.fields.length)
      fail(422, "INVALID_FIELDS");
  }
  if (kind === "page") {
    text(x.title);
    if (
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(x.slug) ||
      !Array.isArray(x.sections) ||
      x.sections.length > 30
    )
      fail(422, "INVALID_PAGE");
    x.sections.forEach((s: any) => {
      object(s, ["heading", "text", "link"]);
      text(s.heading);
      content(s.text, true);
      if (s.link !== null && !/^https:\/\/[^\s]+$/.test(s.link))
        fail(422, "UNSAFE_LINK");
    });
  }
  return x;
}
export function fieldValue(field: any, v: any) {
  if (
    field.required &&
    ((Array.isArray(v) && v.length === 0) ||
      (typeof v === "string" && !v.trim()))
  )
    fail(422, "REQUIRED_FIELD");
  if (v === undefined || v === null || v === "") {
    if (field.required) fail(422, "REQUIRED_FIELD");
    return;
  }
  const ok =
    field.type === "text"
      ? typeof v === "string" && v.length <= 10000
      : field.type === "number"
        ? typeof v === "number" && Number.isFinite(v)
        : field.type === "boolean"
          ? typeof v === "boolean"
          : field.type === "date"
            ? typeof v === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(v) &&
              !Number.isNaN(Date.parse(v)) &&
              new Date(v).toISOString().slice(0, 10) === v
            : field.type === "select"
              ? field.options.includes(v)
              : Array.isArray(v) &&
                v.every((i) => field.options.includes(i)) &&
                new Set(v).size === v.length;
  if (!ok) fail(422, "FIELD_TYPE_MISMATCH");
}

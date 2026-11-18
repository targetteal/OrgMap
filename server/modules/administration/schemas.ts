const string = { type: "string" };
const nullableId = {
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
};
const uuid = { type: "string", format: "uuid" };
const bool = { type: "boolean" };
const closed = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const strings = { type: "array", items: string, maxItems: 100 };
// Envelope validation here; the shared content validator checks the closed node grammar.
const content = {
  anyOf: [
    string,
    closed({
      format: { enum: ["orgmap-richtext"] },
      version: { enum: [1] },
      doc: { type: "object", additionalProperties: true },
    }),
  ],
};
const valueSchemas: Record<string, unknown> = {
  policies: closed({
    key: string,
    value: { anyOf: [string, bool, { type: "integer" }] },
    allowOverride: bool,
    parentId: nullableId,
  }),
  fields: closed({
    key: string,
    label: string,
    type: { enum: ["text", "number", "boolean", "date", "select", "multi"] },
    required: bool,
    locked: bool,
    options: strings,
    visibility: { enum: ["organization", "private"] },
  }),
  templates: closed({
    name: string,
    fields: { type: "array", items: uuid, maxItems: 100 },
  }),
  groups: closed({
    name: string,
    parentId: nullableId,
    memberIds: { type: "array", items: uuid, maxItems: 1000 },
  }),
  profiles: closed({
    memberId: uuid,
    managerId: nullableId,
    visibility: { enum: ["organization", "private"] },
    values: {
      type: "object",
      additionalProperties: {
        anyOf: [string, bool, { type: "number" }, { type: "null" }, strings],
      },
    },
  }),
  pages: closed({
    title: string,
    slug: string,
    sections: {
      type: "array",
      maxItems: 30,
      items: closed({
        heading: string,
        text: content,
        link: { anyOf: [string, { type: "null" }] },
      }),
    },
  }),
};
export function commandSchema(path: string) {
  const parts = path.split("/");
  const collection = parts[parts.indexOf("administration") + 1];
  if (
    path.endsWith("/revoke") ||
    path.endsWith("/unpublish") ||
    path.endsWith("/preview")
  )
    return closed({});
  if (path.endsWith("/publish"))
    return closed({ approvedRevision: { type: "integer", minimum: 1 } });
  if (collection === "settings")
    return closed(
      {
        settings: closed({
          name: string,
          locale: string,
          timezone: string,
          branding: closed(
            {
              color: string,
              colorTheme: string,
              logoUrl: { anyOf: [string, { type: "null" }] },
              showOrganizationName: bool,
            },
            ["color", "logoUrl"],
          ),
          vocabulary: closed({ circle: string, role: string, member: string }),
          modules: closed({
            goals: bool,
            work: bool,
            meetings: bool,
            governance: bool,
          }),
          oversight: closed({
            readMeeting: bool,
            privateOperationalExport: bool,
          }),
          onboarding: closed(
            {
              enabled: bool,
              title: string,
              body: content,
              audience: { enum: ["MEMBER", "GUEST", "ALL"] },
              destination: {
                enum: ["HOME", "STRUCTURE", "GOALS", "WORK", "MEETINGS"],
              },
              videoUrl: { anyOf: [string, { type: "null" }] },
              attachmentUrl: { anyOf: [string, { type: "null" }] },
            },
            ["enabled", "title", "body"],
          ),
          legal: closed(
            {
              name: string,
              address: string,
              termsUrl: { anyOf: [string, { type: "null" }] },
              privacyUrl: { anyOf: [string, { type: "null" }] },
              contactName: string,
              contactEmail: string,
              contactPhone: string,
            },
            ["name", "address", "termsUrl", "privacyUrl"],
          ),
          display: closed({
            directoryFields: { type: "array", items: string, maxItems: 2 },
            hoverFields: { type: "array", items: string, maxItems: 3 },
          }),
          notifications: closed({ emailEnabled: bool }),
        }, ["name", "locale", "timezone", "branding", "vocabulary", "modules", "oversight", "onboarding", "legal", "display"]),
        oversightAcknowledged: bool,
      },
      ["settings"],
    );
  if (collection === "grants")
    return closed({ memberId: uuid, action: string, resourceId: nullableId }, [
      "memberId",
      "action",
    ]);
  return closed(
    {
      value: valueSchemas[collection] ?? { type: "object" },
      ...(collection === "fields" && !path.endsWith("/plan")
        ? { planId: uuid }
        : {}),
    },
    ["value"],
  );
}
/** Non-mutating validator: do not let a shared AJV default strip unknown keys or coerce values. */
export function schemaValid(s: any, v: any): boolean {
  if (s.anyOf) return s.anyOf.some((option: any) => schemaValid(option, v));
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.type === "null") return v === null;
  if (s.type === "string")
    return (
      typeof v === "string" &&
      (s.format !== "uuid" ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          v,
        ))
    );
  if (s.type === "boolean") return typeof v === "boolean";
  if (s.type === "number" || s.type === "integer")
    return (
      typeof v === "number" &&
      Number.isFinite(v) &&
      (s.type !== "integer" || Number.isInteger(v)) &&
      (s.minimum === undefined || v >= s.minimum)
    );
  if (s.type === "array")
    return (
      Array.isArray(v) &&
      (s.maxItems === undefined || v.length <= s.maxItems) &&
      v.every((item) => schemaValid(s.items, item))
    );
  if (s.type === "object")
    return (
      !!v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      (s.required ?? []).every((k: string) => Object.hasOwn(v, k)) &&
      Object.entries(v).every(([k, value]) =>
        s.properties?.[k]
          ? schemaValid(s.properties[k], value)
          : s.additionalProperties === false
            ? false
            : typeof s.additionalProperties === "object"
              ? schemaValid(s.additionalProperties, value)
              : true,
      )
    );
  return true;
}
export function commandResponseSchema(path: string) {
  const collection =
    path.split("/")[path.split("/").indexOf("administration") + 1];
  const row = closed({
    id: uuid,
    version: { type: "integer" },
    value: valueSchemas[collection] ?? { type: "object" },
  });
  const page = closed({
    id: uuid,
    version: { type: "integer" },
    value: valueSchemas.pages,
  });
  let data: any = row;
  if (collection === "settings")
    data = closed({
      version: { type: "integer" },
      settings: (commandSchema(path) as any).properties.settings,
    });
  if (collection === "grants")
    data = path.endsWith("/revoke")
      ? closed({ revoked: bool })
      : closed({ id: uuid, version: { type: "integer" } });
  if (path.endsWith("/plan"))
    data = closed({
      planId: uuid,
      sourceVersion: { type: "integer" },
      profiles: { type: "integer" },
      incompatible: strings,
      canApply: bool,
      valuesPreserved: bool,
    });
  if (path.endsWith("/preview"))
    data = closed({
      snapshot: valueSchemas.pages,
      revision: { type: "integer" },
      public: bool,
    });
  if (path.endsWith("/publish"))
    data = closed({
      page,
      url: string,
      apiUrl: string,
      revision: { type: "integer" },
    });
  if (path.endsWith("/unpublish")) data = closed({ revoked: bool, page });
  return closed({
    data,
    meta: closed({
      requestId: string,
      organizationId: { anyOf: [uuid, { type: "null" }] },
      resourceVersion: { anyOf: [{ type: "integer" }, { type: "null" }] },
      authorizationRevision: { anyOf: [{ type: "integer" }, { type: "null" }] },
      asOf: string,
    }),
    capabilities: { type: "object", additionalProperties: bool },
  });
}

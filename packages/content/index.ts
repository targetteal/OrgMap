/** OrgMap rich text v1. No HTML parser, browser globals, or database dependency. */
export const RICH_TEXT_FORMAT = "orgmap-richtext" as const;
export const RICH_TEXT_VERSION = 1 as const;
export const CONTENT_LIMITS = Object.freeze({
  bytes: 1_000_000,
  text: 200_000,
  nodes: 10_000,
  depth: 12,
  url: 2048,
  mentionLabel: 200,
});
export type RichMark =
  | { type: "bold" | "italic" | "underline" | "strike" }
  | { type: "link"; attrs: { href: string } };
export type RichInline =
  | { type: "text"; text: string; marks?: RichMark[] }
  | { type: "hardBreak" }
  | { type: "roleMention"; attrs: { roleId: string; label: string } };
export type RichParagraph = { type: "paragraph"; content?: RichInline[] };
export type RichList =
  | { type: "bulletList"; content: RichListItem[] }
  | { type: "orderedList"; attrs?: { start: number }; content: RichListItem[] };
export type RichListItem = {
  type: "listItem";
  content: [RichParagraph, ...(RichParagraph | RichList)[]];
};
export type RichNode = RichParagraph | RichList;
export type RichDocument = {
  format: typeof RICH_TEXT_FORMAT;
  version: 1;
  doc: { type: "doc"; content: RichNode[] };
};
export class ContentValidationError extends Error {
  readonly code = "INVALID_RICH_DOCUMENT";
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "ContentValidationError";
  }
}
function fail(path: string, reason: string): never {
  throw new ContentValidationError(path, reason);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(path, "objeto esperado");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const k of Object.keys(value))
    if (!allowed.includes(k)) fail(`${path}.${k}`, "campo desconhecido");
}
function array(value: unknown, path: string, nonempty = false): unknown[] {
  if (!Array.isArray(value) || (nonempty && !value.length))
    fail(path, "lista inválida");
  return value;
}
export function isSafeLink(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > CONTENT_LIMITS.url ||
    /[\s\u0000-\u001f\u007f<>"`\\]/u.test(value)
  )
    return false;
  try {
    const u = new URL(value);
    if (u.protocol === "http:" || u.protocol === "https:")
      return (
        /^https?:\/\/[^/]/i.test(value) &&
        !!u.hostname &&
        !u.username &&
        !u.password
      );
    if (u.protocol === "mailto:") {
      const address = decodeURIComponent(u.pathname);
      return (
        /^[^\s?@:<>"\\\u0000-\u001f\u007f]+@[^\s?@:<>"\\\u0000-\u001f\u007f]+$/u.test(
          address,
        ) &&
        !u.search &&
        !u.hash
      );
    }
    return false;
  } catch {
    return false;
  }
}
/** Validate and return a detached canonical value. Reject unknown content; never strip silently. */
export function validateRichDocument(value: unknown): RichDocument {
  let count = 0,
    chars = 0;
  const ancestors = new Set<unknown>();
  function node(
    input: unknown,
    parent: string,
    path: string,
    depth: number,
  ): any {
    if (++count > CONTENT_LIMITS.nodes || depth > CONTENT_LIMITS.depth)
      fail(path, "documento excede os limites");
    if (ancestors.has(input)) fail(path, "referência circular");
    const n = object(input, path);
    ancestors.add(input);
    const type = n.type;
    const allowed =
      parent === "doc"
        ? ["paragraph", "bulletList", "orderedList"]
        : parent === "paragraph"
          ? ["text", "hardBreak", "roleMention"]
          : parent === "listItem"
            ? ["paragraph", "bulletList", "orderedList"]
            : ["listItem"];
    if (typeof type !== "string" || !allowed.includes(type))
      fail(`${path}.type`, "nó não permitido");
    let out: any;
    if (type === "text") {
      keys(n, ["type", "text", "marks"], path);
      if (
        typeof n.text !== "string" ||
        !n.text.length ||
        /[\u0000\ud800-\udfff]/u.test(
          n.text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""),
        )
      )
        fail(`${path}.text`, "texto inválido");
      chars += n.text.length;
      if (chars > CONTENT_LIMITS.text) fail(path, "texto excede o limite");
      out = { type, text: n.text };
      if (n.marks !== undefined) {
        const seen = new Set<string>();
        const marks = array(n.marks, `${path}.marks`).map((m, i) => {
          const p = `${path}.marks[${i}]`,
            mark = object(m, p),
            t = mark.type;
          if (
            typeof t !== "string" ||
            !["bold", "italic", "underline", "strike", "link"].includes(t) ||
            seen.has(t)
          )
            fail(p, "marcação inválida ou duplicada");
          seen.add(t);
          keys(mark, t === "link" ? ["type", "attrs"] : ["type"], p);
          if (t === "link") {
            const attrs = object(mark.attrs, `${p}.attrs`);
            keys(attrs, ["href"], `${p}.attrs`);
            if (!isSafeLink(attrs.href))
              fail(`${p}.attrs.href`, "URL não permitida");
            return { type: t, attrs: { href: attrs.href } };
          }
          return { type: t };
        });
        const order = ["bold", "italic", "underline", "strike", "link"];
        if (marks.length)
          out.marks = marks.sort(
            (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
          );
      }
    } else if (type === "roleMention") {
      keys(n, ["type", "attrs"], path);
      const attrs = object(n.attrs, `${path}.attrs`);
      keys(attrs, ["roleId", "label"], `${path}.attrs`);
      if (
        typeof attrs.roleId !== "string" ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(attrs.roleId)
      )
        fail(`${path}.attrs.roleId`, "identidade de papel inválida");
      if (
        typeof attrs.label !== "string" ||
        !attrs.label.trim() ||
        [...attrs.label].length > CONTENT_LIMITS.mentionLabel ||
        /[\u0000\ud800-\udfff]/u.test(
          attrs.label.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""),
        )
      )
        fail(`${path}.attrs.label`, "nome de papel inválido");
      // Count the textual projection too, including the visible @ prefix.
      chars += attrs.label.length + 1;
      if (chars > CONTENT_LIMITS.text) fail(path, "texto excede o limite");
      out = {
        type,
        attrs: { roleId: attrs.roleId.toLowerCase(), label: attrs.label },
      };
    } else if (type === "hardBreak") {
      keys(n, ["type"], path);
      out = { type };
    } else {
      keys(
        n,
        type === "orderedList"
          ? ["type", "content", "attrs"]
          : ["type", "content"],
        path,
      );
      const children =
        n.content === undefined && type === "paragraph"
          ? []
          : array(n.content, `${path}.content`, type !== "paragraph");
      if (type === "listItem" && object(children[0], path).type !== "paragraph")
        fail(path, "item deve começar com parágrafo");
      out = { type };
      if (type === "orderedList") {
        const attrs =
          n.attrs === undefined
            ? { start: 1 }
            : object(n.attrs, `${path}.attrs`);
        keys(attrs, ["start"], path);
        if (
          !Number.isSafeInteger(attrs.start) ||
          (attrs.start as number) < 1 ||
          (attrs.start as number) > 1_000_000
        )
          fail(path, "início de lista inválido");
        out.attrs = { start: attrs.start };
      }
      if (children.length || type !== "paragraph")
        out.content = children.map((c, i) =>
          node(c, type, `${path}.content[${i}]`, depth + 1),
        );
    }
    ancestors.delete(input);
    return out;
  }
  const root = object(value, "$");
  keys(root, ["format", "version", "doc"], "$");
  if (root.format !== RICH_TEXT_FORMAT || root.version !== 1)
    fail("$", "formato ou versão não suportado");
  const doc = object(root.doc, "$.doc");
  keys(doc, ["type", "content"], "$.doc");
  if (doc.type !== "doc") fail("$.doc.type", "doc esperado");
  const result: RichDocument = {
    format: RICH_TEXT_FORMAT,
    version: 1,
    doc: {
      type: "doc",
      content: array(doc.content, "$.doc.content", true).map((n, i) =>
        node(n, "doc", `$.doc.content[${i}]`, 1),
      ),
    },
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).length >
    CONTENT_LIMITS.bytes
  )
    fail("$", "documento excede o limite em bytes");
  return result;
}
export function fromPlainText(text: string): RichDocument {
  if (typeof text !== "string") fail("$", "texto esperado");
  // Plain strings are literal, never interpreted as HTML or JSON. Newlines retain paragraph boundaries.
  return validateRichDocument({
    format: RICH_TEXT_FORMAT,
    version: 1,
    doc: {
      type: "doc",
      content: text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((t) => ({
          type: "paragraph",
          ...(t ? { content: [{ type: "text", text: t }] } : {}),
        })),
    },
  });
}
export const emptyRichDocument = (): RichDocument => fromPlainText("");
export function toPlainText(input: RichDocument): string {
  const value = validateRichDocument(input);
  function text(n: any): string {
    return n.type === "text"
      ? n.text
      : n.type === "roleMention"
        ? `@${n.attrs.label}`
        : n.type === "hardBreak"
          ? "\n"
          : (n.content ?? [])
              .map(text)
              .join(n.type === "paragraph" ? "" : "\n");
  }
  return value.doc.content.map(text).join("\n");
}
const escapeHTML = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Only HTML generated from the closed schema is suitable for an HTML sink. */
export function renderHTML(input: RichDocument): string {
  const value = validateRichDocument(input);
  function html(n: any): string {
    if (n.type === "hardBreak") return "<br>";
    if (n.type === "roleMention")
      return `<span data-role-id="${n.attrs.roleId}">@${escapeHTML(n.attrs.label)}</span>`;
    if (n.type === "text")
      return (n.marks ?? []).reduce(
        (s: string, m: RichMark) =>
          m.type === "link"
            ? `<a href="${escapeHTML(m.attrs.href)}" rel="noopener noreferrer nofollow">${s}</a>`
            : `<${({ bold: "strong", italic: "em", underline: "u", strike: "s" } as const)[m.type]}>${s}</${({ bold: "strong", italic: "em", underline: "u", strike: "s" } as const)[m.type]}>`,
        escapeHTML(n.text),
      );
    const tag = (
      {
        paragraph: "p",
        bulletList: "ul",
        orderedList: "ol",
        listItem: "li",
      } as Record<string, string>
    )[n.type];
    return `<${tag}${n.type === "orderedList" ? ` start="${n.attrs.start}"` : ""}>${(n.content ?? []).map(html).join("")}</${tag}>`;
  }
  return value.doc.content.map(html).join("");
}
export function serializeRichDocument(input: RichDocument): string {
  return JSON.stringify(validateRichDocument(input));
}
export function parseRichDocument(input: string): RichDocument {
  if (new TextEncoder().encode(input).length > CONTENT_LIMITS.bytes)
    fail("$", "documento excede o limite em bytes");
  try {
    return validateRichDocument(JSON.parse(input));
  } catch (e) {
    if (e instanceof ContentValidationError) throw e;
    return fail("$", "JSON inválido");
  }
}
/** Transport adapter: rich data is explicit; old string fields remain literal. */
export function readContent(value: unknown): RichDocument {
  return typeof value === "string"
    ? fromPlainText(value)
    : validateRichDocument(value);
}

/** IDs are content references only; they never grant membership or authority. */
export function collectRoleMentionIds(input: unknown): string[] {
  const value = validateRichDocument(input),
    ids = new Set<string>();
  function visit(node: any) {
    if (node.type === "roleMention") ids.add(node.attrs.roleId);
    for (const child of node.content ?? []) visit(child);
  }
  visit(value.doc);
  return [...ids];
}

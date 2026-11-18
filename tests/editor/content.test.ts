import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_LIMITS,
  ContentValidationError,
  collectRoleMentionIds,
  emptyRichDocument,
  fromPlainText,
  isSafeLink,
  parseRichDocument,
  readContent,
  renderHTML,
  serializeRichDocument,
  toPlainText,
  validateRichDocument,
} from "../../packages/content/index.ts";

const rich = (content: unknown[]) => ({
  format: "orgmap-richtext",
  version: 1,
  doc: { type: "doc", content },
});
export const fixture = validateRichDocument(
  rich([
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Olá 👩🏽‍💻 — e\u0301 漢字",
          marks: [
            { type: "bold" },
            { type: "italic" },
            { type: "underline" },
            { type: "strike" },
            { type: "link", attrs: { href: "https://example.org/?x=1&y=2" } },
          ],
        },
        { type: "hardBreak" },
        { type: "text", text: '<script>alert("x")</script>' },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Uma linha" }],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Outra linha" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]),
);

test("closed rich grammar roundtrips Unicode, every mark, hard breaks and nested lists", () => {
  assert.deepEqual(parseRichDocument(serializeRichDocument(fixture)), fixture);
  assert.equal(
    toPlainText(fixture),
    'Olá 👩🏽‍💻 — e\u0301 漢字\n<script>alert("x")</script>\nUma linha\nOutra linha',
  );
  const html = renderHTML(fixture);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<strong>/);
  assert.match(html, /<em>/);
  assert.match(html, /<u>/);
  assert.match(html, /<s>/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  const copy = validateRichDocument(fixture);
  copy.doc.content.length = 0;
  assert.equal(fixture.doc.content.length, 2);
});

test("legacy strings remain literal; empty and line boundaries survive without HTML/JSON guessing", () => {
  for (const text of [
    "",
    "a\n\nb\n",
    "<img src=x onerror=alert(1)>",
    '{"format":"orgmap-richtext"}',
    "   ",
    "👩🏽‍💻",
  ])
    assert.equal(toPlainText(readContent(text)), text);
  assert.equal(toPlainText(fromPlainText("a\r\nb\rc")), "a\nb\nc");
  assert.equal(renderHTML(emptyRichDocument()), "<p></p>");
});

test("URLs disallow executable protocols, attributes, controls, credentials and relative targets", () => {
  for (const link of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>",
    "vbscript:x",
    "file:///tmp/x",
    "//evil.test",
    "/relative",
    "https:relative.test",
    "https:///ambiguous.test",
    "https://a.test/\nx",
    "https://user:pass@a.test",
    'https://a.test/"onclick="x',
    "mailto:a@b.test?body=secret",
    "mailto:a@b.test#x",
    "mailto:a%0d%0abcc:evil@b.test",
    "https:\\evil.test",
    "",
    "https://a.test/" + "x".repeat(2048),
  ]) {
    assert.equal(isSafeLink(link), false, link);
    assert.throws(
      () =>
        validateRichDocument(
          rich([
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "x",
                  marks: [{ type: "link", attrs: { href: link } }],
                },
              ],
            },
          ]),
        ),
      ContentValidationError,
    );
  }
  for (const link of [
    "https://example.org",
    "http://localhost:3000/a?b=c",
    "mailto:ola@example.org",
    "https://例え.テスト/Olá",
  ])
    assert.equal(isSafeLink(link), true, link);
});

test("unknown schema, invalid shapes/attributes, duplicate marks, malformed Unicode are rejected", () => {
  const invalid = [
    null,
    [],
    {},
    { ...fixture, version: 2 },
    { ...fixture, html: "<script>" },
    rich([]),
    rich([{ type: "heading" }]),
    rich([{ type: "paragraph", attrs: { onclick: "x" } }]),
    rich([{ type: "text", text: "root text" }]),
    rich([{ type: "bulletList", content: [] }]),
    rich([
      {
        type: "orderedList",
        attrs: { start: 0 },
        content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
      },
    ]),
    rich([{ type: "paragraph", content: [{ type: "text", text: "" }] }]),
    rich([{ type: "paragraph", content: [{ type: "text", text: "\ud800" }] }]),
    rich([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "x",
            marks: [{ type: "bold", attrs: { style: "x" } }],
          },
        ],
      },
    ]),
    rich([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "x",
            marks: [{ type: "bold" }, { type: "bold" }],
          },
        ],
      },
    ]),
    rich([{ type: "paragraph", content: [{ type: "hardBreak", attrs: {} }] }]),
  ];
  for (const value of invalid)
    assert.throws(() => validateRichDocument(value), ContentValidationError);
  assert.throws(() => parseRichDocument("{bad"), ContentValidationError);
});

test("text, node, depth and encoded-byte limits are enforced before persistence", () => {
  assert.throws(
    () => fromPlainText("x".repeat(CONTENT_LIMITS.text + 1)),
    /limite/,
  );
  assert.throws(
    () =>
      validateRichDocument(
        rich(
          Array.from({ length: CONTENT_LIMITS.nodes + 1 }, () => ({
            type: "paragraph",
          })),
        ),
      ),
    /limite/,
  );
  let nested: unknown = { type: "paragraph" };
  for (let i = 0; i < 8; i++)
    nested = {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph" }, nested] }],
    };
  assert.throws(() => validateRichDocument(rich([nested])), /limite/);
  assert.throws(
    () => parseRichDocument(" ".repeat(CONTENT_LIMITS.bytes + 1)),
    /bytes/,
  );
  const cyclic: any = { type: "bulletList", content: [] };
  cyclic.content.push({
    type: "listItem",
    content: [{ type: "paragraph" }, cyclic],
  });
  assert.throws(() => validateRichDocument(rich([cyclic])), /circular/);
});

const roleId = "a1111111-b222-4333-8444-c55555555555";
const mention = (label = "Guardião dos Acordos", role = roleId) => ({
  type: "roleMention",
  attrs: { roleId: role, label },
});

test("role mention identity roundtrips independently of its label and legacy @ strings stay literal", () => {
  const document = validateRichDocument(
    rich([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Consultar " },
          mention(),
          { type: "text", text: " e " },
          mention("Nome histórico", roleId.toUpperCase()),
        ],
      },
    ]),
  );
  assert.deepEqual(
    parseRichDocument(serializeRichDocument(document)),
    document,
  );
  assert.deepEqual(collectRoleMentionIds(document), [roleId]);
  assert.equal(
    toPlainText(document),
    "Consultar @Guardião dos Acordos e @Nome histórico",
  );
  const inline =
    document.doc.content[0].type === "paragraph"
      ? document.doc.content[0].content!
      : [];
  assert.equal(
    inline[3].type === "roleMention" && inline[3].attrs.roleId,
    roleId,
  );
  const literal = fromPlainText("Consultar @Guardião dos Acordos");
  assert.deepEqual(collectRoleMentionIds(literal), []);
  assert.equal(renderHTML(literal), "<p>Consultar @Guardião dos Acordos</p>");
  assert.deepEqual(
    collectRoleMentionIds(
      validateRichDocument(
        rich([
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [mention()] }],
              },
            ],
          },
        ]),
      ),
    ),
    [roleId],
  );
});

test("role mentions escape their labels and never render executable links or authority", () => {
  const document = validateRichDocument(
    rich([
      {
        type: "paragraph",
        content: [mention('<img src=x onerror="alert(1)"> & Alice')],
      },
    ]),
  );
  const html = renderHTML(document);
  assert.equal(
    html,
    `<p><span data-role-id="${roleId}">@&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Alice</span></p>`,
  );
  assert.doesNotMatch(html, /<img|<a |href=|onclick=/);
});

test("role mentions reject malformed identities, attributes, positions, labels and attached marks", () => {
  for (const invalid of [
    mention("Name", "javascript:alert(1)"),
    mention("Name", roleId + '" onclick="x'),
    mention("Name", "  " + roleId),
    mention("Name", "not-a-uuid"),
    mention(""),
    mention("  "),
    mention("x".repeat(CONTENT_LIMITS.mentionLabel + 1)),
    mention("bad\u0000label"),
    mention("bad\ud800label"),
    {
      type: "roleMention",
      attrs: { roleId, label: "Name", href: "https://evil.test" },
    },
    { type: "roleMention", attrs: { roleId } },
    { ...mention(), marks: [{ type: "bold" }] },
    { ...mention(), text: "Name" },
    { ...mention(), content: [{ type: "text", text: "Name" }] },
  ])
    assert.throws(
      () =>
        validateRichDocument(rich([{ type: "paragraph", content: [invalid] }])),
      ContentValidationError,
    );
  assert.throws(
    () => validateRichDocument(rich([mention()])),
    ContentValidationError,
  );
  // The label limit counts Unicode code points, and the document limit counts
  // the full @label textual projection like the rest of rich content.
  assert.doesNotThrow(() =>
    validateRichDocument(
      rich([
        {
          type: "paragraph",
          content: [mention("😀".repeat(CONTENT_LIMITS.mentionLabel))],
        },
      ]),
    ),
  );
  assert.throws(
    () =>
      validateRichDocument(
        rich([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x".repeat(CONTENT_LIMITS.text - 1) },
              mention("A"),
            ],
          },
        ]),
      ),
    /limite/,
  );
});

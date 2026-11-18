import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRichDocument,
  toPlainText,
} from "../../packages/content/index.js";
import { projectPublicationDocument } from "../../server/modules/administration/feed-source.js";

const capabilities = [
  "https://orgmap.localhost/api/v1/organizations/a/platform/artifacts/abc",
  "https://example.test/download",
  "https://example.test/%2561rtifacts/id",
  "https://example.test/api%2Ffiles%2Fabc",
  "https://example.test/api/attachments",
  "https://example.test/api/artifacts",
  "https://example.test/ordinary?%74oken=secreto",
  "https://example.test/ordinary?%2573ignature=secreto",
  "https://example.test/ordinary#access_token=secreto",
  "https://example.test/ordinary#%74oken=secreto",
  "https://example.test/ordinary?X-Amz-Signature=secreto",
];
test("omits known encoded, terminal and artifact capability references in link marks and literal URLs", () => {
  const nodes = capabilities.flatMap((href) => [
    { type: "text", text: "anexo", marks: [{ type: "link", attrs: { href } }] },
    { type: "text", text: ` veja ${href} fim ` },
  ]);
  const doc = validateRichDocument({
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Olá 🌿 " }, ...nodes],
        },
      ],
    },
  });
  const result = projectPublicationDocument(doc),
    json = JSON.stringify(result.bodyRichDocument),
    plain = toPlainText(result.bodyRichDocument);
  assert.equal(result.omittedAttachmentCount, capabilities.length * 2);
  for (const href of capabilities) {
    assert.ok(!json.includes(href), href);
    assert.ok(!plain.includes(href), href);
  }
  assert.ok(!json.includes("secreto"));
  assert.ok(!plain.includes("secreto"));
  assert.ok(plain.startsWith("Olá 🌿"));
});
test("keeps ordinary web links, literal URLs and Unicode text", () => {
  const href =
    "https://example.test/artifacts-of-culture?topic=files#download-guide";
  const doc = validateRichDocument({
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Café 🌿",
              marks: [{ type: "link", attrs: { href } }],
            },
            { type: "text", text: ` e https://example.test/guide?topic=tools` },
          ],
        },
      ],
    },
  });
  const result = projectPublicationDocument(doc);
  assert.equal(result.omittedAttachmentCount, 0);
  assert.deepEqual(result.bodyRichDocument, doc);
  assert.equal(
    toPlainText(result.bodyRichDocument),
    "Café 🌿 e https://example.test/guide?topic=tools",
  );
});
test('literal basic-auth credentials are omitted even though link marks reject that URL form', () => {
  const doc = validateRichDocument({ format: 'orgmap-richtext', version: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Link https://user:password@example.test/guide e texto comum.' }] }] } });
  const projected = projectPublicationDocument(doc);
  assert.equal(projected.omittedAttachmentCount, 1);
  assert.equal(toPlainText(projected.bodyRichDocument), 'Link [Anexo omitido] e texto comum.');
});

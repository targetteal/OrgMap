import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { richEditorExtensions } from "../../web/src/editor/extensions.ts";
import { richTextSchema } from "../../packages/content/schema.ts";
import {
  createRichYDoc,
  readRichYDoc,
} from "../../packages/content/collaboration.ts";
import {
  toPlainText,
  validateRichDocument,
} from "../../packages/content/index.ts";

test("frontend official extensions and server schema preserve exactly the same durable grammar/attributes", () => {
  const frontend = getSchema(richEditorExtensions());
  assert.deepEqual(
    Object.keys(frontend.nodes).sort(),
    Object.keys(richTextSchema.nodes).sort(),
  );
  assert.deepEqual(
    Object.keys(frontend.marks).sort(),
    Object.keys(richTextSchema.marks).sort(),
  );
  for (const type of ["nodes", "marks"] as const)
    for (const name of Object.keys(frontend[type])) {
      assert.deepEqual(
        frontend[type][name].spec.attrs ?? {},
        richTextSchema[type][name].spec.attrs ?? {},
        `${type}.${name}`,
      );
    }
  for (const key of ["group", "inline", "atom", "selectable", "marks"] as const)
    assert.equal(
      frontend.nodes.roleMention.spec[key],
      richTextSchema.nodes.roleMention.spec[key],
      `roleMention.${key}`,
    );
  const rich = validateRichDocument({
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 7 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Unicode 👩🏽‍💻",
                      marks: [
                        {
                          type: "link",
                          attrs: { href: "https://example.org" },
                        },
                        { type: "bold" },
                        { type: "italic" },
                        { type: "underline" },
                        { type: "strike" },
                      ],
                    },
                    {
                      type: "roleMention",
                      attrs: {
                        roleId: "a1111111-b222-4333-8444-c55555555555",
                        label: "Guardião dos Acordos 👩🏽‍💻",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const node = frontend.nodeFromJSON(rich.doc);
  node.check();
  const frontendDocument = validateRichDocument({
    ...rich,
    doc: node.toJSON(),
  });
  const ydoc = createRichYDoc(frontendDocument);
  try {
    assert.deepEqual(readRichYDoc(ydoc), rich);
    assert.equal(
      toPlainText(readRichYDoc(ydoc)),
      "Unicode 👩🏽‍💻@Guardião dos Acordos 👩🏽‍💻",
    );
  } finally {
    ydoc.destroy();
  }
});

test("collaboration installs Yjs history exclusively; standalone keeps normal undo history", () => {
  const standalone = richEditorExtensions();
  assert.equal(
    standalone.some((e) => e.name === "collaboration"),
    false,
  );
  const doc = createRichYDoc(
    validateRichDocument({
      format: "orgmap-richtext",
      version: 1,
      doc: { type: "doc", content: [{ type: "paragraph" }] },
    }),
  );
  try {
    const collaborative = richEditorExtensions({
      fragment: doc.getXmlFragment("richtext"),
    });
    assert.equal(
      collaborative.some((e) => e.name === "collaboration"),
      true,
    );
    assert.equal(
      collaborative.find((e) => e.name === "starterKit")?.options.undoRedo,
      false,
    );
    assert.deepEqual(
      Object.keys(getSchema(collaborative).nodes).sort(),
      Object.keys(richTextSchema.nodes).sort(),
    );
  } finally {
    doc.destroy();
  }
});

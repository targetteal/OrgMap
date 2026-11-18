import { createMessageTranslator } from "../../localization";
import { valueEditorMessages } from "./messages";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ValueEditor } from "./ValueEditor";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editorIdentity,
  initialMulti,
  multiPayload,
  toggleOption,
  type EditorItem,
} from "./value-editor-state";
test("MULTI keeps literal comma/Unicode/whitespace values and empty selection distinct from UNKNOWN", () => {
  const values = ["Pesquisa, inovação", "  Ação — 日本語  ", "duas  palavras"];
  let selected = initialMulti(values);
  assert.deepEqual(multiPayload(selected, false, false), values);
  selected = toggleOption(selected, values[0], false);
  assert.deepEqual(selected, values.slice(1));
  selected = toggleOption(selected, values[0], true);
  assert.deepEqual(selected, [...values.slice(1), values[0]]);
  assert.deepEqual(multiPayload([], false, false), []);
  assert.equal(multiPayload([], true, false), null);
  assert.throws(() => multiPayload([], false, true));
  assert.throws(() => multiPayload([], true, true));
  assert.deepEqual(initialMulti(null), []);
  assert.deepEqual(multiPayload(selected, false, false), selected);
});
test("editor identity resets drafts on org/entity/field/value or schema revision changes", () => {
  const item: EditorItem = {
    field: {
      id: "field",
      version: 1,
      label: "Options",
      governed: false,
      schema: { type: "MULTI", required: false, options: ["A,B"] },
    },
    value: ["A,B"],
    status: "KNOWN",
    version: 1,
    schemaVersion: 1,
  };
  const current = editorIdentity("orgA", "entity", item);
  assert.notEqual(editorIdentity("orgB", "entity", item), current);
  assert.notEqual(editorIdentity("orgA", "other", item), current);
  assert.notEqual(
    editorIdentity("orgA", "entity", { ...item, version: 2 }),
    current,
  );
  assert.notEqual(
    editorIdentity("orgA", "entity", { ...item, schemaVersion: 2 }),
    current,
  );
  assert.notEqual(
    editorIdentity("orgA", "entity", {
      ...item,
      field: { ...item.field, id: "other" },
    }),
    current,
  );
  assert.notEqual(
    editorIdentity("orgA", "entity", {
      ...item,
      field: { ...item.field, version: 2 },
    }),
    current,
  );
});

test("MULTI renders a labeled checkbox group and governed/computed fields cannot submit", () => {
  const item: EditorItem = {
    field: {
      id: "field",
      label: "Áreas",
      governed: false,
      schema: {
        type: "MULTI",
        required: false,
        options: ["Pesquisa, inovação", "  Ação — 日本語  "],
      },
    },
    value: ["Pesquisa, inovação"],
    status: "KNOWN",
    version: 1,
  };
  const render = (v: EditorItem) =>
    renderToStaticMarkup(
      createElement(ValueEditor, {
        organizationId: "org",
        entityId: "entity",
        item: v,
        disabled: false,
        onSave: async () => true,
      }),
    );
  const html = render(item);
  assert.ok(html.includes("<legend>Áreas"));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.ok(html.includes("Pesquisa, inovação"));
  assert.ok(html.includes("  Ação — 日本語  "));
  assert.ok(!html.includes('type="text"'));
  const governed = render({
    ...item,
    field: { ...item.field, governed: true },
  });
  assert.ok(governed.includes("disabled"));
  assert.ok(!governed.includes("Salvar campo"));
  const computed = render({
    ...item,
    field: { ...item.field, schema: { type: "COMPUTED", required: false } },
  });
  assert.ok(computed.includes("Calculado"));
  assert.ok(!computed.includes("Salvar campo"));
});

test("field-editor catalog covers eight locales while preserving data and explicit fallback", () => {
  const keys = Object.keys(valueEditorMessages["pt-BR"]).sort();
  assert.equal(Object.keys(valueEditorMessages).length, 8);
  for (const catalog of Object.values(valueEditorMessages)) {
    assert.deepEqual(Object.keys(catalog).sort(), keys);
    assert.ok(
      Object.values(catalog).every(
        (value) => typeof value === "string" && value.length > 0,
      ),
    );
    assert.ok(catalog.version.includes("{version}"));
  }
  assert.equal(
    createMessageTranslator("ja-JP", valueEditorMessages)("clear"),
    "選択をクリア",
  );
  assert.equal(
    createMessageTranslator("en-US", valueEditorMessages)("save"),
    "Save field",
  );
  assert.equal(
    createMessageTranslator("unknown", valueEditorMessages)("save"),
    "Salvar campo",
  );
  assert.deepEqual(
    multiPayload(["Pesquisa, inovação", "Ação — 日本語"], false, false),
    ["Pesquisa, inovação", "Ação — 日本語"],
  );
});

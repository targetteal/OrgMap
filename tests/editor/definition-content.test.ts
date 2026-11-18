import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import {
  definitionItems,
  normalizeDefinitionChange,
  writeEntityDefinition,
} from "../../server/modules/structure/definition.ts";
import { changeSchema } from "../../server/modules/governance/schemas.ts";
import { Failure } from "../../server/src/core.ts";
import type { Ctx } from "../../server/src/runtime.ts";
import {
  fromPlainText,
  toPlainText,
  validateRichDocument,
} from "../../packages/content/index.ts";

const itemId = "a1111111-b222-4333-8444-c55555555555";
const roleId = "b1111111-c222-4333-8444-d55555555555";
const orgId = "c1111111-d222-4333-8444-e55555555555";
const rich = validateRichDocument({
  format: "orgmap-richtext",
  version: 1,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Consultar ", marks: [{ type: "bold" }] },
          { type: "roleMention", attrs: { roleId, label: "Guia" } },
        ],
      },
    ],
  },
});
const richItem = () => ({
  id: itemId,
  text: toPlainText(rich),
  richText: rich,
});
const code = (expected: string) => (error: unknown) =>
  error instanceof Failure && error.code === expected;

test("legacy definition items retain exact shape and trim behavior; optional rich lists preserve item identity", () => {
  assert.deepEqual(
    definitionItems([{ id: itemId, text: "  Acordo antigo  " }]),
    [{ id: itemId, text: "Acordo antigo" }],
  );
  assert.deepEqual(definitionItems([]), []);
  assert.deepEqual(
    normalizeDefinitionChange({
      responsibilities: [richItem()],
      artifacts: [{ id: itemId, text: "Artefato" }],
    }),
    {
      responsibilities: [richItem()],
      artifacts: [{ id: itemId, text: "Artefato" }],
    },
  );
  const result = definitionItems([richItem()]);
  assert.equal(result[0].id, itemId);
  assert.equal(result[0].text, "Consultar @Guia");
  assert.deepEqual(result[0].richText, rich);
  assert.notEqual(result[0].richText, rich);
  assert.equal(result[0].richText!.doc.content[0].type, "paragraph");
});

test("rich definition items preserve exact paragraph boundaries and reject mismatched or empty projections", () => {
  const paragraph = fromPlainText(" Acordo\n");
  const result = definitionItems([
    { id: itemId, text: " Acordo\n", richText: paragraph },
  ]);
  assert.equal(result[0].text, toPlainText(result[0].richText!));
  assert.throws(
    () => definitionItems([{ ...richItem(), text: "Texto divergente" }]),
    code("DEFINITION_CONTENT_MISMATCH"),
  );
  assert.throws(
    () =>
      definitionItems([{ id: itemId, text: "", richText: fromPlainText("") }]),
    code("INVALID_REQUEST"),
  );
  assert.throws(
    () =>
      definitionItems([
        { id: itemId, text: "  ", richText: fromPlainText("  ") },
      ]),
    code("INVALID_REQUEST"),
  );
  const tooLong = "x".repeat(10001);
  assert.throws(
    () =>
      definitionItems([
        { id: itemId, text: tooLong, richText: fromPlainText(tooLong) },
      ]),
    code("INVALID_REQUEST"),
  );
  const whitespace = "x" + " ".repeat(10000);
  assert.throws(
    () =>
      definitionItems([
        { id: itemId, text: whitespace, richText: fromPlainText(whitespace) },
      ]),
    code("INVALID_REQUEST"),
  );
});

test("definition items reject duplicate UUIDs, unknown fields and malformed rich content without silently stripping it", () => {
  for (const value of [
    [{ ...richItem(), unknown: true }],
    [{ ...richItem(), id: "invalid" }],
    [{ ...richItem(), richText: null }],
    [{ ...richItem(), richText: { ...rich, html: "<script>" } }],
    [
      {
        ...richItem(),
        richText: {
          format: "orgmap-richtext",
          version: 1,
          doc: { type: "doc", content: [{ type: "heading" }] },
        },
      },
    ],
    Array.from({ length: 101 }, () => richItem()),
  ])
    assert.throws(() => definitionItems(value));
  assert.throws(
    () =>
      definitionItems([
        richItem(),
        { id: itemId.toUpperCase(), text: "Duplicado" },
      ]),
    code("DUPLICATE_DEFINITION_ITEM"),
  );
});

test("governance change schema accepts rich definition items and keeps the outer item closed", () => {
  const ajv = new Ajv();
  ajv.addFormat("uuid", /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  const validate = ajv.compile(changeSchema);
  const change = {
    kind: "UPDATE",
    entityId: roleId,
    baseVersion: 1,
    responsibilities: [richItem()],
    artifacts: [richItem()],
  };
  assert.equal(validate(change), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({
      ...change,
      responsibilities: [{ ...richItem(), unknown: true }],
    }),
    false,
  );
  assert.equal(
    validate({
      ...change,
      artifacts: [{ ...richItem(), richText: "not an AST" }],
    }),
    false,
  );
});

function context(roleAvailable = true) {
  const calls: { sql: string; params: any[] }[] = [];
  const ctx = {
    org: { id: orgId },
    account: { id: "account" },
    member: {
      organization_id: orgId,
      account_id: "account",
      member_type: "MEMBER",
      status: "ACTIVE",
    },
    mode: "write",
    c: {
      async query(sql: string, params: any[]) {
        calls.push({ sql, params });
        if (sql.startsWith("SELECT"))
          return {
            rows: roleAvailable ? [{ id: roleId }] : [],
            rowCount: roleAvailable ? 1 : 0,
          };
        return {
          rows: [
            {
              responsibilities: JSON.parse(params[3] ?? "[]"),
              artifacts: JSON.parse(params[4] ?? "[]"),
            },
          ],
          rowCount: 1,
        };
      },
    },
  } as unknown as Ctx;
  return { ctx, calls };
}

test("definition writes validate scoped mentions before preserving the rich JSONB item payload", async () => {
  const { ctx, calls } = context();
  const result = await writeEntityDefinition(ctx, {
    entityId: roleId,
    entityVersion: 3,
    responsibilities: [richItem()],
    artifacts: [],
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /organization_id=\$1 AND kind='ROLE'/);
  assert.deepEqual(calls[0].params, [orgId, [roleId]]);
  assert.match(
    calls[1].sql,
    /WHERE organization_id=\$1 AND id=\$2 AND version=\$3/,
  );
  assert.deepEqual(calls[1].params.slice(0, 3), [orgId, roleId, 3]);
  assert.deepEqual(result, { responsibilities: [richItem()], artifacts: [] });
  const denied = context(false);
  await assert.rejects(
    writeEntityDefinition(denied.ctx, {
      entityId: roleId,
      entityVersion: 3,
      artifacts: [richItem()],
    }),
    code("INVALID_ROLE_MENTION"),
  );
  assert.equal(denied.calls.length, 1);
  assert.ok(!denied.calls.some((call) => call.sql.startsWith("UPDATE")));
});

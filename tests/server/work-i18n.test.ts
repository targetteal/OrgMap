import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  workLocales,
  workMessages,
  workTranslator,
} from "../../web/src/features/work/messages.js";
test("Work statistics and calendar catalogs cover eight locales without losing interpolation or user literals", async () => {
  const base = workMessages["pt-BR"],
    placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.equal(workLocales.length, 8);
  for (const locale of workLocales) {
    const catalog = workMessages[locale],
      text = workTranslator(locale);
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(base).sort());
    for (const [key, value] of Object.entries(catalog)) {
      assert.ok(value.trim(), locale + ": " + key);
      assert.deepEqual(
        placeholders(value),
        placeholders(key),
        locale + ": " + key,
      );
    }
    const count = text(
      "{active} de {total} círculos vinculados aos projetos do escopo atual.",
      { active: "3", total: "8" },
    );
    assert.ok(count.includes("3") && count.includes("8"));
    assert.ok(!count.includes("{"));
    assert.equal(
      text("Título literal 日本語 <script> &"),
      "Título literal 日本語 <script> &",
    );
  }
  const source = await readFile(
    "web/src/features/work/statistics-view.tsx",
    "utf8",
  );
  for (const match of source.matchAll(/text\("([^"]+)"/g))
    assert.ok(
      base[match[1]],
      "Statistics product text has no catalog: " + match[1],
    );
  assert.equal(
    workTranslator("en-US")("Carregando estatísticas…"),
    "Loading statistics…",
  );
  assert.equal(workTranslator("ja-JP")("Hoje"), "今日");
});

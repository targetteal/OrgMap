import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeWorkbook,
  validateWorkbook,
} from "../../server/modules/platform/workbook.js";
test("platform tabular workbook validates closed shapes and emits typed OOXML without formula evaluation", () => {
  const sheet = {
    name: "Tarefas",
    columns: ["Título", "Pontos", "Feita", "Nota"],
    rows: [
      ["Ação ü", 3, true, "=1+1"],
      ["Outra", null, false, "@cmd"],
    ],
  };
  const workbook = {
    sheets: [
      sheet,
      {
        name: "Projetos",
        columns: ["Nome", "Total"],
        rows: [["Projeto Ç", 2]],
      },
    ],
  };
  const bytes = encodeWorkbook(workbook, "XLSX");
  const source = bytes.toString();
  assert.ok(source.includes('name="Tarefas"'));
  assert.ok(source.includes('name="Projetos"'));
  assert.ok(source.includes('<c r="B2"><v>3</v></c>'));
  assert.ok(source.includes('<c r="C2" t="b"><v>1</v></c>'));
  assert.ok(source.includes(">=1+1</t>"));
  assert.ok(!source.includes("<f>"));
  assert.throws(() => encodeWorkbook(workbook, "CSV"));
  const csv = encodeWorkbook({ sheets: [sheet] }, "CSV").toString();
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'@cmd"'));
  for (const invalid of [
    { ...workbook, extra: true },
    { sheets: [{ ...sheet, name: "Bad/Name" }] },
    { sheets: [sheet, { ...sheet, name: "tarefas" }] },
    { sheets: [{ ...sheet, rows: [[Infinity, 1, true, null]] }] },
    { sheets: [{ ...sheet, rows: [["short"]] }] },
    { sheets: [{ ...sheet, rows: [["\u0000", 1, true, null]] }] },
  ])
    assert.throws(() => validateWorkbook(invalid));
});

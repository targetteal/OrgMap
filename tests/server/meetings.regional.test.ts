import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  meetingMessages,
  meetingTranslator,
} from "../../web/src/features/meetings/messages.js";
import {
  meetingWeek,
  meetingWeekBounds,
  shiftMeetingWeek,
} from "../../web/src/features/meetings/regional.js";
import {
  dateAtInstant,
  formatInstant,
  formatDate,
  SUPPORTED_LOCALES,
} from "../../packages/i18n/index.js";
const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
test("Meetings catalogs cover all eight locales with exact keys, parameters and stable machine types", async () => {
  const expected = JSON.parse(
    await readFile("web/src/features/meetings/messages/keys.json", "utf8"),
  ).sort();
  assert.ok(expected.length >= 225);
  assert.ok(expected.includes("Registrada no módulo"));
  assert.ok(expected.includes("Todos os círculos"));
  for (const locale of SUPPORTED_LOCALES) {
    const messages = meetingMessages[locale];
    assert.deepEqual(Object.keys(messages).sort(), expected, locale);
    for (const key of expected) {
      assert.ok(messages[key].trim(), locale + " " + key);
      assert.deepEqual(
        placeholders(messages[key]),
        placeholders(meetingMessages["pt-BR"][key]),
        locale + " " + key,
      );
    }
    assert.deepEqual(
      messages["Exemplo de etapas"].split("\n").map((x) => x.split("|")[0]),
      ["CHECKIN", "AGENDA", "PROJECTS", "CHECKOUT"],
    );
  }
  assert.equal(meetingTranslator("en-US")("Reuniões"), "Meetings");
  assert.equal(meetingTranslator("ja-JP")("Reuniões"), "会議");
  assert.equal(meetingTranslator("pt-BR")("Reuniões"), "Reuniões");
  assert.equal(
    meetingTranslator("en-US")("Primeira publicação: {date}", {
      date: "2026-10-19",
    }),
    "First published: 2026-10-19",
  );
  for (const file of [
    "index.tsx",
    "collaboration.tsx",
    "linked-items.tsx",
    "header-actions.tsx",
  ]) {
    const path = "web/src/features/meetings/" + file,
      source = await readFile(path, "utf8"),
      ast = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        assert.ok(
          Object.hasOwn(meetingMessages["pt-BR"], node.arguments[0].text),
          file + ": " + node.arguments[0].text,
        );
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(
      !/toLocale(?:String|DateString|TimeString)\(\s*["']pt-BR/.test(source),
      file,
    );
  }
});
test("Calendar uses saved zone civil keys and exact DST week bounds without changing event instants", () => {
  const instant = "2026-10-19T15:00:00Z",
    la = {
      locale: "en-US",
      timeZone: "America/Los_Angeles",
      dateFormat: "MM/DD/YYYY",
    },
    tokyo = {
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
      dateFormat: "YYYY-MM-DD",
    };
  assert.equal(dateAtInstant(instant, la), "2026-10-19");
  assert.equal(dateAtInstant(instant, tokyo), "2026-10-20");
  assert.match(
    formatInstant(instant, la, true, { hour: "2-digit", minute: "2-digit" }),
    /08:00/,
  );
  assert.match(
    formatInstant(instant, tokyo, true, { hour: "2-digit", minute: "2-digit" }),
    /00:00|0:00/,
  );
  assert.deepEqual(meetingWeek("2026-10-20"), [
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
  assert.equal(shiftMeetingWeek("2026-10-19", -1), "2026-10-12");
  const spring = meetingWeekBounds("2026-03-08", "America/Los_Angeles");
  assert.equal(spring.from, "2026-03-02T08:00:00Z");
  assert.equal(spring.until, "2026-03-09T07:00:00Z");
  assert.equal(
    (Date.parse(spring.until) - Date.parse(spring.from)) / 3600000,
    167,
  );
  const fall = meetingWeekBounds("2026-11-01", "America/Los_Angeles");
  assert.equal((Date.parse(fall.until) - Date.parse(fall.from)) / 3600000, 169);
  assert.equal(formatDate("2026-10-19", tokyo), "2026-10-19");
  assert.equal(instant, "2026-10-19T15:00:00Z");
});

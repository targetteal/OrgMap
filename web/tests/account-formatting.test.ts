import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatAccountDate,
  preferencesPayload,
} from "../src/account/formatting.ts";
test("account date preferences respect civil date at timezone boundary and chosen order", () => {
  const preferences = {
    locale: "pt-BR",
    timeZone: "America/Sao_Paulo",
    dateFormat: "DD/MM/YYYY",
    reducedMotion: false,
    theme: "system",
  };
  assert.equal(
    formatAccountDate("2026-01-01T02:00:00Z", preferences),
    "31/12/2025",
  );
  assert.equal(
    formatAccountDate("2026-01-01T02:00:00Z", {
      ...preferences,
      timeZone: "UTC",
      dateFormat: "YYYY-MM-DD",
    }),
    "2026-01-01",
  );
  assert.equal(formatAccountDate("invalid", preferences), "—");
});

test("preference mutation excludes server-only metadata after first persistence", () => {
  const persisted = {
    locale: "pt-BR",
    timeZone: "America/Sao_Paulo",
    dateFormat: "DD/MM/YYYY",
    theme: "system",
    reducedMotion: false,
    version: 2,
    accountId: "private-id",
  };
  const payload = preferencesPayload(persisted);
  assert.deepEqual(Object.keys(payload).sort(), [
    "dateFormat",
    "locale",
    "reducedMotion",
    "theme",
    "timeZone",
  ]);
  assert.equal(payload.reducedMotion, false);
});

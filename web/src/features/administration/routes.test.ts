import { test } from "node:test";
import assert from "node:assert/strict";
import {
  administrationTabs,
  matchesAdministrationRoute,
  resolveAdministrationRoute,
} from "./routes.js";
for (const tab of administrationTabs)
  test(`administration route ${tab} preserves selection with query/hash`, () => {
    for (const suffix of [
      "",
      "/",
      "?view=all",
      "?next=/administration/profiles#section",
      "#section",
    ]) {
      assert.equal(
        resolveAdministrationRoute("/administration/" + tab + suffix),
        tab,
      );
      assert.equal(
        matchesAdministrationRoute("/administration/" + tab + suffix),
        true,
      );
    }
  });
test("administration root and invalid/foreign paths", () => {
  for (const root of [
    "/administration",
    "/administration/",
    "/administration?from=identity",
  ])
    assert.equal(resolveAdministrationRoute(root), "settings");
  for (const path of [
    "/members",
    "/settings",
    "/administrations",
    "/administration-invalid/pages",
    "/administration/unknown",
    "/administration/pages/extra",
    "//administration/pages",
    "https://example.test/administration/pages",
    "/administration/%70ages",
  ]) {
    assert.equal(resolveAdministrationRoute(path), null);
    assert.equal(matchesAdministrationRoute(path), false);
  }
});

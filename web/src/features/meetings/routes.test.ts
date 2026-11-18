import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMeetingRoute,
  matchesMeetingRoute,
  meetingHref,
} from "./routes";
const id = "12345678-1234-4234-8234-123456789abc";
for (const prefix of ["/meetings", "/app/meeting"])
  for (const suffix of [
    "",
    "/",
    "/reports",
    "/agenda-items",
    "/templates",
    "/" + id,
    "/" + id + "?step=agenda#notes",
  ])
    test(`same meetings feature resolves ${prefix + suffix}`, () => {
      const r = resolveMeetingRoute(prefix + suffix);
      assert.ok(r);
      assert.equal(matchesMeetingRoute(prefix + suffix), true);
      assert.equal(
        r.path,
        (prefix + suffix)
          .split(/[?#]/)[0]
          .replace("/app/meeting", "/meetings")
          .replace(/\/$/, ""),
      );
      if (suffix.includes("?step=")) {
        assert.equal(r.id, id);
        assert.equal(r.sectionId, "agenda");
        assert.equal(r.hash, "#notes");
      }
    });
for (const path of [
  "/meeting",
  "/meetings-other",
  "/projects",
  "/goals",
  "/app/meetings",
  "/meetings/invalid-id",
  "/meetings/templates/unknown",
  "https://example.test/meetings",
  "//example.test/meetings",
])
  test(`meetings does not claim ${path}`, () =>
    assert.equal(matchesMeetingRoute(path), false));
test("all produced internal meeting links resolve through the same canonical contract", () => {
  for (const link of [
    meetingHref(),
    meetingHref(id),
    meetingHref(id, "custom-1"),
  ])
    assert.ok(resolveMeetingRoute(link));
  assert.equal(
    meetingHref(id, "custom-1"),
    "/meetings/" + id + "?step=custom-1",
  );
});

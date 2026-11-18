import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import {
  moduleLinks,
  resolveRoute,
  routeParts,
  canonicalRoute,
  NavigationGate,
} from "../src/navigation.ts";
test("actual registered features resolve every rail, menu and canonical/legacy deep link", async () => {
  const vite = await createServer({
    root: new URL("../", import.meta.url).pathname,
    configFile: false,
    logLevel: "error",
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    appType: "custom",
  });
  try {
    const { features } = await vite.ssrLoadModule("/src/features/registry.ts");
    for (const item of moduleLinks)
      assert.equal(
        resolveRoute(item.path, features)?.module,
        item.module,
        "rail " + item.path,
      );
    for (const feature of features)
      for (const nav of feature.navigation ?? [])
        assert.ok(resolveRoute(nav.path, features), "menu " + nav.path);
    const id = "de305d54-75b4-431b-adb2-eb6b9e546014";
    for (const [path, module] of [
      [`/meetings/${id}?step=abc#notes`, "meetings"],
      [`/app/meeting/${id}?step=abc#notes`, "meetings"],
      ["/meetings/reports", "meetings"],
      ["/meetings/templates", "meetings"],
      ["/app/goal?view=timeline#period", "goals"],
      [`/projects/tasks/${id}`, "projects"],
      ["/administration/settings", "administration"],
      ["/platform/jobs", "platform"],
      ["/interoperability", "interoperability"],
      ["/account/security", "account"],
      ["/account/accessibility", "account"],
      ["/structure/advanced", "structure"],
      [`/structure/proposals/${id}`, "structure"],
    ])
      assert.equal(resolveRoute(path, features)?.module, module, path);
    assert.equal(
      canonicalRoute("/app/meeting/" + id + "?step=abc#notes"),
      "/meetings/" + id + "?step=abc#notes",
    );
    assert.deepEqual(routeParts("/app/meeting?view=list#top"), {
      canonical: "/meetings?view=list#top",
      matchPath: "/meetings?view=list",
      pathname: "/meetings",
      hash: "#top",
    });
  } finally {
    await vite.close();
  }
});
test("navigation guard retains pending notes until acknowledged or unregistered", () => {
  const gate = new NavigationGate();
  let pending = 1;
  const cleanup = gate.register(() =>
    pending ? "Aguarde a confirmação das notas." : null,
  );
  assert.equal(gate.reason(), "Aguarde a confirmação das notas.");
  pending = 0;
  assert.equal(gate.reason(), null);
  pending = 1;
  cleanup();
  assert.equal(gate.reason(), null);
  gate.register(() => "Outro rascunho");
  gate.clear();
  assert.equal(gate.reason(), null);
});

test("public credential-entry routes never retain tokens in app history",()=>{assert.equal(canonicalRoute('/enrollment?token=synthetic-secret#code=synthetic'),'/enrollment');assert.equal(canonicalRoute('/reset-password?code=synthetic-secret'),'/reset-password');assert.equal(canonicalRoute('/meetings?view=list#notes'),'/meetings?view=list#notes')});

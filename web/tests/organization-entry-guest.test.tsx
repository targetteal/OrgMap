import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><main></main>", { url: "http://entry.localhost/structure" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "FormData"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : (dom.window as any)[key], configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
const { createRoot } = await import("react-dom/client");
const vite = await createServer({ root: new URL("../", import.meta.url).pathname, configFile: false, logLevel: "error", server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: "custom" });
const { OrganizationEntry } = await vite.ssrLoadModule("/src/OrganizationEntry.tsx");
const originalFetch = globalThis.fetch;
test.after(async () => { globalThis.fetch = originalFetch; await vite.close(); dom.window.close(); });

test("missing optional Guest entry resolves without masking errors for regular members", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "RESOURCE_NOT_FOUND" } }), { status: 404 });
  const container = dom.window.document.querySelector("main")!, root = createRoot(container);
  let resolved = 0;
  const props = { accountId: "account-a", organizationId: "org-a", path: "/structure", implicitLanding: true, onResolved: () => { resolved++; }, navigate: () => {} };
  try {
    await act(async () => root.render(<OrganizationEntry {...props} bootstrap={{ membership: { memberType: "GUEST" }, modules: {} }} />));
    assert.equal(resolved, 1); assert.equal(container.textContent, "");
    await act(async () => root.render(<OrganizationEntry {...props} accountId="account-b" bootstrap={{ membership: { memberType: "MEMBER" }, modules: {} }} />));
    assert.equal(resolved, 1); assert.match(container.textContent!, /Não foi possível carregar as boas-vindas/);
  } finally { await act(async () => root.unmount()); }
});

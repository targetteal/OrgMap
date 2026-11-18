import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><main></main>", { url: "http://qa.localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "FormData"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : (dom.window as any)[key], configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createRoot } = await import("react-dom/client");
const vite = await createServer({
  root: new URL("../", import.meta.url).pathname, configFile: false, logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: "custom",
});
const { GlobalSearch } = await vite.ssrLoadModule("/src/features/platform/index.tsx");
const { LocalizationProvider } = await vite.ssrLoadModule("/src/localization/index.tsx");
test.after(async () => { await vite.close(); dom.window.close(); });
const context = (vocabulary: Record<string, string> = {}, id = "org") => ({
  organizationId: id,
  bootstrap: { organization: { id, vocabulary }, membership: { id: "self", memberType: "MEMBER" } },
  api: async () => ({ data: { items: [] } }), navigate() {},
});

test("the real global search header and open overlay follow vocabulary after organization context changes", async () => {
  const root = createRoot(document.querySelector("main")!);
  const render = (value: ReturnType<typeof context>) => act(async () => root.render(
    <LocalizationProvider preferences={{ locale: "pt-BR" }}><GlobalSearch context={value} /></LocalizationProvider>,
  ));
  try {
    await render(context());
    assert.match(document.querySelector(".platform-global-search")!.textContent!, /Pesquisar papéis, círculos, membros, projetos/);
    await act(async () => (document.querySelector(".platform-global-search") as HTMLButtonElement).click());
    assert.equal(document.querySelector<HTMLInputElement>(".platform-search-overlay input")!.placeholder, "Papéis, círculos, membros, projetos…");
    await render(context({ circle: "Área", role: "Cargo", member: "Pessoa" }, "other-org"));
    assert.match(document.querySelector(".platform-global-search")!.textContent!, /Pesquisar Cargo, Área, Pessoa, projetos/);
    assert.equal(document.querySelector<HTMLInputElement>(".platform-search-overlay input")!.placeholder, "Cargo, Área, Pessoa, projetos…");
    assert.doesNotMatch(document.querySelector(".platform-search-overlay input")!.getAttribute("placeholder")!, /Papéis|círculos|membros/);
  } finally { await act(async () => root.unmount()); }
});

test("default vocabulary retains localized global search text", async () => {
  const root = createRoot(document.querySelector("main")!);
  try {
    await act(async () => root.render(
      <LocalizationProvider preferences={{ locale: "en-US" }}><GlobalSearch context={context()} /></LocalizationProvider>,
    ));
    assert.match(document.querySelector(".platform-global-search")!.textContent!, /Search roles, circles, members, projects/);
    await act(async () => (document.querySelector(".platform-global-search") as HTMLButtonElement).click());
    assert.equal(document.querySelector<HTMLInputElement>(".platform-search-overlay input")!.placeholder, "Roles, circles, members, projects…");
  } finally { await act(async () => root.unmount()); }
});

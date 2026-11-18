import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createServer } from "vite";
import { randomUUID } from "node:crypto";
const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  { url: "http://publications.localhost" },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Element",
  "Node",
  "Event",
  "DOMParser",
  "MutationObserver",
  "getComputedStyle",
])
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom.window : (dom.window as any)[key],
    configurable: true,
  });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID },
  configurable: true,
});
const { createRoot } = await import("react-dom/client");
const vite = await createServer({
  root: new URL("../", import.meta.url).pathname,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: "custom",
});
const { Publications } = await vite.ssrLoadModule(
    "/src/features/publications/index.tsx",
  ),
  { RequestError } = await vite.ssrLoadModule("/src/api.ts");
const container = document.querySelector("main")!;
const doc = {
  format: "orgmap-richtext",
  version: 1,
  doc: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Texto" }] },
    ],
  },
};
const post = {
  id: "post",
  groupId: "group",
  authorMemberId: "owner",
  state: "PUBLISHED",
  version: 1,
  title: "Original",
  bodyRichDocument: doc,
};
const group = { id: "group", name: "Pesquisa", version: 1 };
const response = (data: any, revision = 7) => ({
  data,
  meta: { authorizationRevision: revision },
});
const button = (label: string) => {
  const b = [...container.querySelectorAll("button")].find(
    (e) => e.textContent?.trim() === label,
  );
  assert.ok(b, label);
  return b;
};
const context = (api: any, role = "OWNER", type = "MEMBER", org = "a") => ({
  organizationId: org,
  session: { account: { id: "account" } },
  bootstrap: { membership: { id: "owner", orgRole: role, memberType: type } },
  api,
  navigate: () => {},
  notify: () => {},
  registerNavigationGuard: () => () => {},
});
async function click(label: string) {
  await act(async () => {
    button(label).click();
    await Promise.resolve();
  });
}
async function inputTitle(value: string) {
  const input = container.querySelector("input[required]") as HTMLInputElement;
  assert.ok(input);
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
test.after(async () => {
  await vite.close();
  dom.window.close();
});
test("draft conflict preserves text and refreshes version explicitly", async () => {
  const calls: any[] = [];
  let fail = true;
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, ...options });
    if (path.endsWith("/groups")) return response({ groups: [group] });
    if (path.includes("/groups/group/posts?"))
      return response({ posts: [post], nextCursor: null });
    if (path.endsWith("/posts/post?draft=true"))
      return response({ post: { ...post, version: fail ? 1 : 2 } });
    if (path.endsWith("/posts/post") && options.method === "PATCH") {
      if (fail) {
        fail = false;
        throw new RequestError("VERSION_CONFLICT", "conflict");
      }
      return response({
        post: { ...post, version: 3, title: options.body.title },
      });
    }
    if (path.endsWith("/posts/post")) return response({ post });
    throw Error(path);
  };
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<Publications context={context(api) as any} />),
    );
    await click("OriginalPublicada");
    await click("Editar meu rascunho");
    await inputTitle("Meu texto preservado");
    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    assert.match(container.textContent!, /mudou em outra sessão/);
    assert.equal(
      (container.querySelector("input[required]") as HTMLInputElement).value,
      "Meu texto preservado",
    );
    await click("Atualizar versão");
    assert.equal(
      (container.querySelector("input[required]") as HTMLInputElement).value,
      "Meu texto preservado",
    );
    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    const patches = calls.filter((x) => x.method === "PATCH");
    assert.deepEqual(
      patches.map((x) => x.version),
      [1, 2],
    );
    assert.equal(patches[1].body.title, "Meu texto preservado");
  } finally {
    await act(async () => root.unmount());
  }
});
test("export retries lost response with same version and key; Guest sends no requests", async () => {
  const calls: any[] = [];
  let attempt = 0;
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, ...options });
    if (path.endsWith("/groups"))
      return response({ groups: [group] }, 7 + attempt);
    if (path.includes("/groups/group/posts?"))
      return response({ posts: [], nextCursor: null });
    if (path.endsWith("/publication-exports")) {
      attempt++;
      if (attempt === 1) throw new RequestError("NETWORK_ERROR", "offline");
      return response({ job: { id: "job" } });
    }
    throw Error(path);
  };
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<Publications context={context(api) as any} />),
    );
    await click("Exportar publicações");
    await click("Solicitar exportação");
    assert.match(container.textContent!, /Confira a conexão/);
    await click("Solicitar exportação");
    const exports = calls.filter((x) =>
      x.path.endsWith("/publication-exports"),
    );
    assert.equal(exports.length, 2);
    assert.equal(exports[0].key, exports[1].key);
    assert.equal(exports[0].version, exports[1].version);
    assert.match(container.textContent!, /Exportação solicitada/);
    await act(async () =>
      root.render(
        <Publications context={context(api, "MEMBER", "GUEST", "b") as any} />,
      ),
    );
    assert.equal(container.textContent, "");
    assert.equal(
      calls.filter((x) => x.path.includes("/organizations/b/")).length,
      0,
    );
  } finally {
    await act(async () => root.unmount());
  }
});
test("creates a draft, publishes and requires confirmation before archiving", async () => {
  const calls: any[] = [];
  let current: any = null;
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, ...options });
    if (path.endsWith("/groups")) return response({ groups: [group] });
    if (path.includes("/groups/group/posts?"))
      return response({
        posts: current?.state === "PUBLISHED" ? [current] : [],
        nextCursor: null,
      });
    if (path.endsWith("/groups/group/posts") && options.method === "POST") {
      current = { ...post, ...options.body, state: "DRAFT", version: 1 };
      return response({ post: current });
    }
    if (path.endsWith("/posts/post/publish")) {
      assert.equal(options.version, 1);
      current = { ...current, state: "PUBLISHED", version: 2 };
      return response({ post: current });
    }
    if (path.endsWith("/posts/post/archive")) {
      assert.equal(options.version, 2);
      current = null;
      return response({ post: {} });
    }
    throw Error(path);
  };
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<Publications context={context(api) as any} />),
    );
    assert.match(container.textContent!, /Ainda não há publicações/);
    await click("Nova publicação");
    await inputTitle("Uma publicação");
    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    assert.match(container.textContent!, /Rascunho salvo/);
    await click("Publicar");
    assert.match(container.textContent!, /compartilhada com o grupo/);
    await click("Arquivar");
    assert.equal(
      calls.some((x) => x.path.endsWith("/archive")),
      false,
    );
    await click("Confirmar arquivamento");
    assert.equal(calls.filter((x) => x.path.endsWith("/archive")).length, 1);
    assert.match(container.textContent!, /Publicação arquivada/);
  } finally {
    await act(async () => root.unmount());
  }
});

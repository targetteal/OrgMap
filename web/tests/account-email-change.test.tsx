import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>", { url: "http://email.localhost/account/general" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "FormData"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : (dom.window as any)[key], configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
const { createRoot } = await import("react-dom/client");
const vite = await createServer({ root: new URL("../", import.meta.url).pathname, configFile: false, logLevel: "error", server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: "custom" });
const { EmailChange } = await vite.ssrLoadModule("/src/account/EmailChange.tsx");
const { LocalizationProvider } = await vite.ssrLoadModule("/src/localization/index.tsx");
const originalFetch = globalThis.fetch;
const result = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
const account = { id: "account-a", email: "old@example.test", version: 4, passwordEnabled: true };
const container = dom.window.document.querySelector("main")!;
const field = (text: string) => {
  const label = [...container.querySelectorAll("label")].find((element) => element.textContent?.includes(text));
  assert.ok(label); const input = label.querySelector("input"); assert.ok(input); return input;
};
async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
}
test.after(async () => { globalThis.fetch = originalFetch; await vite.close(); dom.window.close(); });

test("email change asks for mailbox proof and reauthentication, then refreshes session", async () => {
  const calls: Array<{ path: string; options: RequestInit; body: any }> = [];
  const pending = { requestId: "00000000-0000-4000-8000-000000000001", state: "PENDING_PROOF", expiresAt: "2030-01-01T00:00:00Z" };
  let changed = 0;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ path: String(url), options, body: options.body ? JSON.parse(String(options.body)) : null });
    if (calls.length === 1) return result({ items: [] });
    if (calls.length === 2) return result(pending, 202);
    if (calls.length === 3) return result({ csrfToken: "new-csrf" });
    throw Error("Unexpected request");
  };
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{ locale: "pt-BR" }}><EmailChange account={account} onChanged={async () => { changed++; }} /></LocalizationProvider>));
    await enter(field("Novo e-mail"), "new@example.test");
    await enter(field("Senha atual"), "test-password");
    await submit();
    assert.deepEqual(calls[1].body, { newEmail: "new@example.test", currentPassword: "test-password" });
    assert.equal((calls[1].options.headers as Record<string, string>)["If-Match"], '"4"');
    assert.match(container.textContent!, /Solicitação criada/);
    assert.equal(field("Senha atual").value, "");
    await enter(field("Código recebido"), "mail-proof");
    await enter(field("Senha atual"), "test-password");
    await submit();
    assert.equal(calls[2].path, `/api/v1/account/email-change/requests/${pending.requestId}/complete`);
    assert.deepEqual(calls[2].body, { mailboxToken: "mail-proof", currentPassword: "test-password" });
    assert.equal(changed, 1);
    assert.match(container.textContent!, /E-mail alterado/);
    assert.ok(!container.textContent!.includes("mail-proof"));
  } finally { await act(async () => root.unmount()); }
});

test("unavailable request list fails closed and offers retry", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "UNAVAILABLE" } }), { status: 503 });
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{ locale: "pt-BR" }}><EmailChange account={account} onChanged={async () => {}} /></LocalizationProvider>));
    assert.ok(container.querySelector('[role="alert"]'));
    assert.equal(container.querySelector("form"), null);
    assert.match(container.textContent!, /Tentar novamente/);
  } finally { await act(async () => root.unmount()); }
});

test("unavailable request list gives a localized error without exposing the form", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "UNAVAILABLE" } }), { status: 503 });
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{ locale: "es-ES" }}><EmailChange account={account} onChanged={async () => {}} /></LocalizationProvider>));
    assert.match(container.textContent!, /No se pudo completar la acción/);
    assert.match(container.textContent!, /Reintentar/);
    assert.equal(container.querySelector("form"), null);
  } finally { await act(async () => root.unmount()); }
});

test("unsaved account edits block starting an email change", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return result({ items: [] }); };
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{ locale: "pt-BR" }}><EmailChange account={account} disabled onChanged={async () => {}} /></LocalizationProvider>));
    assert.equal(field("Novo e-mail").closest("fieldset")?.disabled, true);
    await submit();
    assert.equal(calls, 1);
    assert.match(container.textContent!, /Salve ou descarte/);
  } finally { await act(async () => root.unmount()); }
});

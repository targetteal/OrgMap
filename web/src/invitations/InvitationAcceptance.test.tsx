import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act, useState } from "react";

const dom = new JSDOM("<!doctype html><html><body><div id='test-root'></div></body></html>", {
  url: "http://invitations.localhost/invitations/accept",
});
for (const key of ["window", "document", "navigator", "location", "HTMLElement", "HTMLInputElement", "Event", "FormData"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : (dom.window as any)[key], configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
const { createRoot } = await import("react-dom/client");
const vite = await createServer({
  root: new URL("../../", import.meta.url).pathname,
  configFile: false, logLevel: "error", appType: "custom",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
});
const { InvitationAcceptance } = await vite.ssrLoadModule("/src/invitations/InvitationAcceptance.tsx");
const { RequestError } = await vite.ssrLoadModule("/src/api.ts");
const token = "a".repeat(64), organizationId = "11111111-1111-4111-8111-111111111111";
const metadata = { organizationName: "Workspace sintético", locale: "pt-BR", emailHint: "p***@example.test", memberType: "MEMBER", expiresAt: "2026-12-01T14:00:00Z" };
const session = { account: { id: "account-synthetic", email: "person@example.test", displayName: "Pessoa" }, organizations: [], csrfToken: "synthetic" };
const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic" } });
type Call = { path: string; options: any };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

async function mount(options: {
  token?: string | null; authenticated?: boolean; preview?: typeof metadata;
  handler?: (path: string, options: any) => Promise<any> | any;
  onAccepted?: (organizationId: string) => Promise<void>;
} = {}) {
  const calls: Call[] = [], auth: boolean[] = [], locales: string[] = [], tokens: string[] = [], opened: string[] = [];
  let switches = 0;
  const api = async (path: string, requestOptions: any = {}) => {
    calls.push({ path, options: requestOptions });
    const custom = options.handler?.(path, requestOptions);
    if (custom !== undefined) return await custom;
    if (path === "/invitations/preview") return envelope(options.preview ?? metadata);
    if (path === "/invitations/accept") return envelope({ organizationId });
    throw Error("Unexpected fixture request " + path);
  };
  function Harness() {
    const [locale, setLocale] = useState("en-US");
    return <InvitationAcceptance token={options.token === null ? undefined : options.token ?? token}
      session={options.authenticated ? session : null} locale={locale} api={api}
      onLocaleChange={(value: string) => { locales.push(value); setLocale(value); }}
      onToken={(value: string) => tokens.push(value)} onAuth={(register: boolean) => auth.push(register)}
      onSwitchAccount={async () => { switches++; }} onBack={() => {}}
      onAccepted={async (id: string) => { opened.push(id); await options.onAccepted?.(id); }} />;
  }
  const container = document.querySelector("#test-root")!, root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
  return { container, calls, auth, locales, tokens, opened, switches: () => switches,
    unmount: async () => { await act(async () => root.unmount()); } };
}
function button(container: Element, label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  assert.ok(element, "Missing button " + label); return element;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
after(async () => { await vite.close(); dom.window.close(); });

test("public invitation adopts workspace language and only offers authentication before an explicit acceptance", async () => {
  const ui = await mount({ preview: { ...metadata, locale: "es-ES" } });
  try {
    assert.deepEqual(ui.locales, ["es-ES"]);
    assert.match(ui.container.textContent ?? "", /Invitación a Workspace sintético/);
    assert.match(ui.container.textContent ?? "", /p\*\*\*@example\.test/);
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].path, "/invitations/preview");
    assert.equal(ui.calls[0].options.method, "POST");
    assert.deepEqual(ui.calls[0].options.body, { token });
    assert.equal(ui.container.querySelector("input[name=invitationCode]"), null);
    await click(button(ui.container, "Iniciar sesión para continuar"));
    await click(button(ui.container, "Crear una cuenta"));
    assert.deepEqual(ui.auth, [false, true]);
    assert.equal(ui.calls.filter(call => call.path === "/invitations/accept").length, 0);
    assert.equal(location.hash, "");
    assert.equal(document.documentElement.lang, "es-ES");
    assert.equal(dom.window.sessionStorage.length, 0);
  } finally { await ui.unmount(); }
});

test("authenticated acceptance guards double click and reuses the command key after an uncertain network failure", async () => {
  const pending = deferred<any>(); let accepts = 0;
  const ui = await mount({ authenticated: true, handler: path => {
    if (path !== "/invitations/accept") return;
    accepts++; if (accepts === 1) return Promise.reject(new TypeError("synthetic network uncertainty"));
    return pending.promise;
  } });
  try {
    assert.equal(accepts, 0);
    await click(button(ui.container, "Aceitar convite"));
    assert.match(ui.container.textContent ?? "", /Não foi possível aceitar/);
    await act(async () => { const accept = button(ui.container, "Aceitar convite"); accept.click(); accept.click(); });
    assert.equal(accepts, 2);
    const commands = ui.calls.filter(call => call.path === "/invitations/accept");
    assert.ok(commands[0].options.key);
    assert.equal(commands[0].options.key, commands[1].options.key);
    assert.deepEqual(commands[0].options.body, { token });
    assert.deepEqual(commands[0].options.body, commands[1].options.body);
    await act(async () => pending.resolve(envelope({ organizationId })));
    assert.deepEqual(ui.opened, [organizationId]);
  } finally { pending.resolve(envelope({ organizationId })); await ui.unmount(); }
});

test("wrong-account rejection retains invitation context and permits an explicit account switch", async () => {
  const ui = await mount({ authenticated: true, handler: path => path === "/invitations/accept" ? Promise.reject(new RequestError("RESOURCE_NOT_FOUND", "synthetic private failure")) : undefined });
  try {
    await click(button(ui.container, "Aceitar convite"));
    assert.match(ui.container.textContent ?? "", /Não foi possível aceitar o convite com esta conta/);
    assert.match(ui.container.textContent ?? "", /Workspace sintético/);
    assert.match(ui.container.textContent ?? "", /person@example\.test/);
    assert.doesNotMatch(ui.container.textContent ?? "", /synthetic private failure/);
    assert.equal(ui.opened.length, 0);
    await click(button(ui.container, "Usar outra conta"));
    assert.equal(ui.switches(), 1);
    assert.equal(ui.calls.filter(call => call.path === "/invitations/accept").length, 1);
  } finally { await ui.unmount(); }
});

test("confirmed acceptance retries only organization opening when shell refresh fails", async () => {
  let openings = 0;
  const ui = await mount({ authenticated: true, onAccepted: async () => { if (++openings === 1) throw Error("synthetic refresh failure"); } });
  try {
    await click(button(ui.container, "Aceitar convite"));
    assert.match(ui.container.textContent ?? "", /Seu acesso foi confirmado/);
    assert.match(ui.container.textContent ?? "", /Convite aceito/);
    await click(button(ui.container, "Abrir organização"));
    assert.deepEqual(ui.opened, [organizationId, organizationId]);
    assert.equal(ui.calls.filter(call => call.path === "/invitations/accept").length, 1);
  } finally { await ui.unmount(); }
});

test("unmount aborts public preview and ignores a late response", async () => {
  const pending = deferred<any>();
  const ui = await mount({ handler: path => path === "/invitations/preview" ? pending.promise : undefined });
  assert.equal(ui.calls.length, 1);
  const signal = ui.calls[0].options.signal as AbortSignal;
  assert.equal(signal.aborted, false);
  await ui.unmount();
  assert.equal(signal.aborted, true);
  await act(async () => pending.resolve(envelope(metadata)));
  assert.deepEqual(ui.locales, []);
  assert.equal(ui.container.textContent, "");
});

test("manual-code fallback validates locally and clears the proof field after preparing preview", async () => {
  const ui = await mount({ token: null });
  try {
    assert.equal(ui.calls.length, 0);
    const input = ui.container.querySelector<HTMLInputElement>("input[name=invitationCode]")!;
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "invalid");
      input.form!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(ui.calls.length, 0);
    await act(async () => {
      setValue.call(input, token);
      input.form!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.deepEqual(ui.tokens, [token]);
    assert.equal(ui.calls[0].path, "/invitations/preview");
    assert.deepEqual(ui.calls[0].options.body, { token });
    assert.equal(input.value, "");
    assert.equal(ui.container.querySelector("input[name=invitationCode]"), null);
    assert.equal(ui.calls.filter(call => call.path === "/invitations/accept").length, 0);
  } finally { await ui.unmount(); }
});

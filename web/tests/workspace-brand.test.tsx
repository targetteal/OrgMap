import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act, useLayoutEffect } from "react";
import { createServer } from "vite";
const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  { url: "http://brand.localhost" },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
])
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom.window : (dom.window as any)[key],
    configurable: true,
  });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
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
const { WorkspaceBrand, WorkspaceBrandingShell, previewOrganizationTheme } = await vite.ssrLoadModule(
  "/src/WorkspaceBrand.tsx",
);
const container = document.querySelector("main")!,
  originalFetch = globalThis.fetch;
const reply = (id: string, color: string, show: boolean, colorTheme = "mare") =>
  new Response(
    JSON.stringify({
      data: {
        asset: {
          origin: "UPLOADED",
          revision: 1,
          readUrl: `/api/v1/organizations/${id}/branding/workspace-logo`,
        },
        appearance: { color, showOrganizationName: show, colorTheme },
      },
      meta: {},
      capabilities: {},
    }),
    { status: 200 },
  );
const deferred = () => {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test.after(async () => {
  globalThis.fetch = originalFetch;
  await vite.close();
  dom.window.close();
});
test("scope changes hide A in the commit before effects and ignore a late A response", async () => {
  const old = deferred(),
    next = deferred();
  let aRequests = 0;
  const seen: Array<{
    src: string | null;
    color: string | null;
    text: string | null;
  }> = [];
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.includes("/organizations/a/")) {
      aRequests++;
      return aRequests === 1 ? reply("a", "#112233", false) : old.promise;
    }
    if (path.includes("/organizations/b/")) return next.promise;
    throw Error(path);
  };
  const capture = () => {
    const img = container.querySelector("img"),
      mark = container.querySelector(
        ".workspace-brand-mark",
      ) as HTMLElement | null;
    seen.push({
      src: img?.getAttribute("src") ?? null,
      color: mark?.style.backgroundColor ?? null,
      text: container.textContent,
    });
  };
  function Probe() {
    useLayoutEffect(capture);
    return null;
  }
  const view = (
    organizationId: string | null,
    accountId: string,
    name: string,
  ) => (
    <>
      <WorkspaceBrand
        organizationId={organizationId}
        accountId={accountId}
        name={name}
      />
      <Probe />
    </>
  );
  const root = createRoot(container);
  try {
    await act(async () => root.render(view("a", "account-a", "Organização A")));
    assert.match(
      container.querySelector("img")!.getAttribute("src")!,
      /organizations\/a\//,
    );
    assert.equal(container.textContent, "");
    await act(async () =>
      window.dispatchEvent(new dom.window.Event("orgmap:branding-changed")),
    );
    assert.equal(aRequests, 2);
    await act(async () => root.render(view(null, "account-b", "Conta B")));
    assert.equal(seen.at(-1)!.src, null);
    assert.notEqual(seen.at(-1)!.color, "rgb(17, 34, 51)");
    assert.equal(seen.at(-1)!.text, "Conta B");
    assert.equal(container.querySelector("img"), null);
    assert.equal(container.textContent, "Conta B");
    await act(async () => root.render(view("b", "account-b", "Organização B")));
    assert.equal(seen.at(-1)!.src, null);
    assert.notEqual(seen.at(-1)!.color, "rgb(17, 34, 51)");
    assert.equal(seen.at(-1)!.text, "Organização B");
    assert.equal(container.querySelector("img"), null);
    await act(async () => old.resolve(reply("a", "#112233", false)));
    assert.equal(container.querySelector("img"), null);
    assert.equal(container.textContent, "Organização B");
    await act(async () => next.resolve(reply("b", "#aabbcc", true)));
    assert.match(
      container.querySelector("img")!.getAttribute("src")!,
      /organizations\/b\//,
    );
    assert.equal(container.textContent, "Organização B");
  } finally {
    await act(async () => root.unmount());
  }
});

test("workspace palette follows the organization and ignores a late response from another scope", async () => {
  const old=deferred(), next=deferred(); let requests=0;
  globalThis.fetch=async input=>{const path=String(input);if(path.includes('/organizations/a/')) return ++requests === 1 ? reply('a','#f7e400',true,'cobalto') : old.promise;if(path.includes('/organizations/b/'))return next.promise;throw Error(path)};
  const root=createRoot(container);
  const view=(organizationId:string|null,accountId:string)=><WorkspaceBrandingShell organizationId={organizationId} accountId={accountId} className="qa-shell"><button>Ação</button></WorkspaceBrandingShell>;
  const theme=()=>container.querySelector('.qa-shell')!.getAttribute('data-org-theme');
  try {
    await act(async()=>root.render(view('a','account-a'))); assert.equal(theme(),'cobalto');
    assert.equal((container.querySelector('.qa-shell') as HTMLElement).style.getPropertyValue('--orange'),'','legacy accent does not override palette');
    await act(async()=>window.dispatchEvent(new dom.window.Event('orgmap:branding-changed')));
    await act(async()=>root.render(view('b','account-b'))); assert.equal(theme(),'mare');
    await act(async()=>old.resolve(reply('a','#f7e400',true,'argila'))); assert.equal(theme(),'mare');
    await act(async()=>next.resolve(reply('b','#153452',true,'grafite'))); assert.equal(theme(),'grafite');
  } finally {await act(async()=>root.unmount())}
});


test("palette preview is scoped to account and organization and cancel restores the saved palette",async()=>{
 globalThis.fetch=async(input)=>reply(String(input).includes('/organizations/b/')?'b':'a','#123456',true,String(input).includes('/organizations/b/')?'cobalto':'mare');
 const root=createRoot(container);
 const view=(org:string,account:string)=><WorkspaceBrandingShell organizationId={org} accountId={account} className="test-shell"><span>Content</span></WorkspaceBrandingShell>;
 try{
  await act(async()=>root.render(view('a','account-a')));
  const theme=()=>container.querySelector('.test-shell')?.getAttribute('data-org-theme');
  assert.equal(theme(),'mare');
  await act(async()=>previewOrganizationTheme('b','account-a','argila'));assert.equal(theme(),'mare');
  await act(async()=>previewOrganizationTheme('a','account-b','argila'));assert.equal(theme(),'mare');
  await act(async()=>previewOrganizationTheme('a','account-a','argila'));assert.equal(theme(),'argila');
  await act(async()=>previewOrganizationTheme('a','account-a',null));assert.equal(theme(),'mare');
  await act(async()=>previewOrganizationTheme('a','account-a','grafite'));assert.equal(theme(),'grafite');
  await act(async()=>root.render(view('b','account-a')));assert.equal(theme(),'cobalto');
  await act(async()=>previewOrganizationTheme('a','account-a',null));assert.equal(theme(),'cobalto');
 }finally{await act(async()=>root.unmount());}
});

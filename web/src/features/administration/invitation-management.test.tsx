import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";
const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  { url: "http://administration.localhost/organization-invitations" },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "location",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "Event",
  "FormData",
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
  root: new URL("../../../", import.meta.url).pathname,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: "custom",
});
const { InvitationManagement } = await vite.ssrLoadModule(
  "/src/features/administration/invitation-management.tsx",
);
const { InvitationComposer } = await vite.ssrLoadModule("/src/features/administration/InvitationComposer.tsx");
const { InvitationTracking } = await vite.ssrLoadModule("/src/features/administration/InvitationTracking.tsx");
const { invitationTrackingMessages } = await vite.ssrLoadModule("/src/features/administration/invitation-tracking-messages.ts");
const { invitationComposerMessages } = await vite.ssrLoadModule("/src/features/administration/invitation-composer-messages.ts");
const { LocalizationProvider } = await vite.ssrLoadModule(
  "/src/localization/index.tsx",
);
const { request, setCsrf } = await vite.ssrLoadModule("/src/api.ts");
const org = "11111111-1111-4111-8111-111111111111",
  entity = "22222222-2222-4222-8222-222222222222",
  node = "33333333-3333-4333-8333-333333333333",
  linkId = "44444444-4444-4444-8444-444444444444";
const base = "/api/v1/organizations/" + org;
const response = (data: any) =>
  new Response(JSON.stringify({ data, meta: { requestId: "synthetic" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const originalFetch = globalThis.fetch;
function fixture(
  handler?: (
    path: string,
    body: any,
    options: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const calls: { path: string; body: any; options: RequestInit }[] = [];
  let link: any = null,
    revision = 0;
  globalThis.fetch = async (input, options = {}) => {
    const path = String(input),
      body = options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ path, body, options });
    const custom = await handler?.(path, body, options);
    if (custom) return custom;
    if ((path === base + "/invitations" || path.startsWith(base+"/invitations?")) && (options.method ?? "GET") === "GET")
      return response({ items: [] });
    if (
      path === base + "/invitation-links" &&
      (options.method ?? "GET") === "GET"
    )
      return response({ version: revision, link, secretUnavailable: true });
    if (path === base + "/administration/admission-policy")
      return response({
        supported: true,
        policy: { registrationMode: "OPEN", invitationLinkEnabled: true },
      });
    if (path === base + "/invitation-links" && options.method === "POST") {
      revision++;
      link = { id: linkId, expiresAt: "2026-11-19T12:00:00Z", revokedAt: null };
      return response({
        version: revision,
        link,
        linkToken: "synthetic-fragment-capability",
        secretUnavailable: false,
      });
    }
    if (path === base + "/invitation-links/" + linkId + "/revoke") {
      assert.equal(new Headers(options.headers).get("If-Match"), '"1"');
      link = { ...link, revokedAt: "2026-10-19T12:00:00Z" };
      revision++;
      return response({ version: revision, link, secretUnavailable: true });
    }
    throw new Error("Unexpected fixture request " + path);
  };
  return calls;
}
async function mount(owner = true, composerOnly = false, locale = "pt-BR", trackingOnly = false) {
  const container = document.querySelector("main")!,
    root = createRoot(container);
  const context: any = {
    organizationId: org,
    bootstrap: {
      organization: { id: org, name: "Organização sintética" },
      membership: { orgRole: owner ? "OWNER" : "MEMBER", memberType: "MEMBER" },
    },
    structure: {
      nodes: [
        {
          nodeId: node,
          entityId: entity,
          kind: "CIRCLE",
          name: "Núcleo permitido",
        },
      ],
    },
    members: [],
    api: request,
    notify: () => {},
  };
  setCsrf("fixture-csrf");
  await act(async () => {
    root.render(
      <LocalizationProvider preferences={{ locale }}>
        {trackingOnly ? <InvitationTracking context={context} /> : composerOnly ? <InvitationComposer context={context} /> : <InvitationManagement context={context} />}
      </LocalizationProvider>,
    );
  });
  return {
    container,
    context,
    rerender: async (updates:any) => { Object.assign(context,updates);await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><InvitationTracking context={context}/></LocalizationProvider>)); },
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}
function field(container: Element, label: string, index = 0) {
  const labels = Array.from(container.querySelectorAll("label.field")).filter(
    (el) => el.firstChild?.textContent?.trim() === label,
  );
  assert.ok(labels[index], "Missing field " + label);
  return labels[index].querySelector("input,select,textarea") as
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}
async function fill(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element.tagName === "SELECT"
        ? dom.window.HTMLSelectElement.prototype
        : element.tagName === "TEXTAREA"
          ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
function button(container: Element, label: string) {
  const result = Array.from(container.querySelectorAll("button")).find(
    (el) => el.textContent?.trim() === label,
  );
  assert.ok(result, "Missing button " + label);
  return result as HTMLButtonElement;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
after(async () => {
  globalThis.fetch = originalFetch;
  await vite.close();
  dom.window.close();
});
test("simple composer accepts pasted addresses and reports existing invitations without claiming a resend", async () => {
  const calls = fixture((path, body) => path === base + "/invitations/batch" ? response({
    results: body.items.map((item: any, index: number) => ({clientRef: item.clientRef, status: ["QUEUED", "EXISTING_PENDING", "INVALID", "DUPLICATE_IN_BATCH"][index]})),
  }) : undefined);
  const ui = await mount(false, true);
  try {
    await fill(field(ui.container, "E-mails"), "one@example.test, two@example.test;invalid\none@example.test");
    await fill(field(ui.container, "Mensagem pessoal opcional"), "Vamos aprender 🌿");
    await click(button(ui.container, "Enviar convite"));
    const sent = calls.find(call => call.path === base + "/invitations/batch")!;
    assert.deepEqual(sent.body.items.map((item: any) => item.email), ["one@example.test", "two@example.test", "invalid", "one@example.test"]);
    assert.equal(new Set(sent.body.items.map((item: any) => item.clientRef)).size, 4);
    assert.ok(sent.body.items.every((item: any) => item.memberType === "MEMBER" && !("accessPlan" in item)));
    assert.equal(sent.body.personalMessage, "Vamos aprender 🌿");
    assert.match(ui.container.textContent ?? "", /nenhum novo e-mail foi enviado/);
    assert.match(ui.container.textContent ?? "", /Revise este e-mail/);
    assert.match(ui.container.textContent ?? "", /E-mail repetido nesta lista/);
    assert.match(ui.container.textContent ?? "", /Organização sintética/);
  } finally { await ui.unmount(); }
});
test("simple composer guards double click and retries the identical batch command after network uncertainty", async () => {
  let attempts = 0;
  const calls = fixture((path, body) => {
    if (path !== base + "/invitations/batch") return;
    attempts++;
    if (attempts === 1) throw new TypeError("synthetic network failure");
    return response({results: body.items.map((item: any) => ({clientRef: item.clientRef, status: "QUEUED"}))});
  });
  const ui = await mount(false, true);
  try {
    await fill(field(ui.container, "E-mails"), "person@example.test");
    await act(async () => {
      const send = button(ui.container, "Enviar convite"); send.click(); send.click();
    });
    assert.equal(attempts, 1);
    await click(button(ui.container, "Enviar convite"));
    const sent = calls.filter(call => call.path === base + "/invitations/batch");
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].body, sent[1].body);
    assert.equal(new Headers(sent[0].options.headers).get("Idempotency-Key"), new Headers(sent[1].options.headers).get("Idempotency-Key"));
    assert.equal(new Headers(sent[1].options.headers).get("X-CSRF-Token"), "fixture-csrf");
  } finally { await ui.unmount(); }
});
test("simple composer follows account locale with complete eight-language controls and statuses", async () => {
  const keys = Object.keys(invitationComposerMessages["pt-BR"]);
  assert.equal(Object.keys(invitationComposerMessages).length, 8);
  for (const dictionary of Object.values(invitationComposerMessages) as Record<string, string>[]) {
    assert.deepEqual(Object.keys(dictionary), keys);
    assert.ok(Object.values(dictionary).every(value => typeof value === "string" && value.length));
  }
  fixture((path, body) => path === base + "/invitations/batch" ? response({results: body.items.map((item: any) => ({clientRef:item.clientRef,status:"EXISTING_PENDING"}))}) : undefined);
  const ui = await mount(false, true, "es-ES");
  try {
    await fill(field(ui.container, "Correos electrónicos"), "person@example.test");
    await click(button(ui.container, "Enviar invitación"));
    assert.match(ui.container.textContent ?? "", /no se envió otro correo/);
    assert.doesNotMatch(ui.container.textContent ?? "", /Convites|Enviar convite|Na fila/);
  } finally { await ui.unmount(); }
});
test("nominal Guest plan uses entity identity and retries same closed command key", async () => {
  let attempts = 0;
  const calls = fixture((path, body, options) => {
    if (path === base + "/invitations" && options.method === "POST") {
      attempts++;
      if (attempts === 1) throw new TypeError("synthetic network failure");
      return response({
        invitation: { id: "synthetic", email: body.email, memberType: "GUEST" },
      });
    }
  });
  const ui = await mount();
  try {
    await click(button(ui.container, "Acesso limitado e opções avançadas"));
    await fill(field(ui.container, "E-mail"), "guest@example.test");
    await fill(field(ui.container, "Tipo de participação"), "GUEST");
    const checkbox = Array.from(ui.container.querySelectorAll("label"))
      .find((el) => el.textContent?.includes("Círculo: Núcleo permitido"))
      ?.querySelector("input");
    assert.ok(checkbox);
    await click(checkbox);
    await click(button(ui.container, "Solicitar envio dos convites"));
    await click(button(ui.container, "Solicitar envio dos convites"));
    const sent = calls.filter(
      (call) =>
        call.options.method === "POST" && call.path === base + "/invitations",
    );
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].body, sent[1].body);
    assert.equal(
      new Headers(sent[0].options.headers).get("Idempotency-Key"),
      new Headers(sent[1].options.headers).get("Idempotency-Key"),
    );
    assert.equal(
      new Headers(sent[1].options.headers).get("X-CSRF-Token"),
      "fixture-csrf",
    );
    assert.deepEqual(sent[1].body.accessPlan, [
      {
        resource: { context: "structure", kind: "circle", id: entity },
        actions: ["read"],
      },
    ]);
    assert.equal(sent[1].body.memberType, "GUEST");
    assert.equal(sent[1].body.email, "guest@example.test");
    assert.ok(!("orgRole" in sent[1].body));
    assert.match(ui.container.textContent ?? "", /Na fila de envio/);
    assert.match(ui.container.textContent ?? "", /não confirma entrega/);
  } finally {
    await ui.unmount();
  }
});
test("batch uses per-row references and displays partial statuses without treating queue as delivery", async () => {
  const calls = fixture((path, body) =>
    path === base + "/invitations/batch"
      ? response({
          results: body.items.map((row: any, index: number) => ({
            clientRef: row.clientRef,
            status: index ? "INVALID" : "QUEUED",
          })),
        })
      : undefined,
  );
  const ui = await mount();
  try {
    await click(button(ui.container, "Acesso limitado e opções avançadas"));
    await click(button(ui.container, "Em lote"));
    await fill(field(ui.container, "E-mail"), "one@example.test");
    await click(button(ui.container, "Adicionar destinatário"));
    await fill(field(ui.container, "E-mail", 1), "two@example.test");
    await fill(
      field(ui.container, "Mensagem pessoal opcional"),
      "Vamos aprender 🌿",
    );
    await click(button(ui.container, "Solicitar envio dos convites"));
    const sent = calls.find(
      (call) => call.path === base + "/invitations/batch",
    )!;
    assert.equal(sent.body.items.length, 2);
    assert.notEqual(sent.body.items[0].clientRef, sent.body.items[1].clientRef);
    assert.equal(sent.body.personalMessage, "Vamos aprender 🌿");
    assert.match(
      ui.container.textContent ?? "",
      /one@example.test: Na fila de envio/,
    );
    assert.match(
      ui.container.textContent ?? "",
      /two@example.test: Dados inválidos/,
    );
  } finally {
    await ui.unmount();
  }
});
test("member invitation UI never submits Guest or an access plan", async () => {
  const calls = fixture((path, body, options) =>
    path === base + "/invitations/batch" && options.method === "POST"
      ? response({
          results: body.items.map((item: any) => ({clientRef: item.clientRef, status: "QUEUED"})),
        })
      : undefined,
  );
  const ui = await mount(false);
  try {
    assert.doesNotMatch(
      ui.container.textContent ?? "",
      /Tipo de participação|Gerar link de inscrição/,
    );
    await fill(field(ui.container, "E-mails"), "member@example.test");
    await click(button(ui.container, "Enviar convite"));
    const sent = calls.find((call) => call.options.method === "POST")!;
    assert.equal(sent.body.items[0].memberType, "MEMBER");
    assert.ok(!("accessPlan" in sent.body.items[0]));
  } finally {
    await ui.unmount();
  }
});
test("link capability is one-time masked memory and explicit copy uses fragment then revoke clears it", async () => {
  let copied = "";
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (value: string) => {
        copied = value;
      },
    },
    configurable: true,
  });
  const calls = fixture();
  let ui = await mount();
  try {
    await click(button(ui.container, "Gerar link de inscrição"));
    assert.doesNotMatch(
      ui.container.textContent ?? "",
      /synthetic-fragment-capability/,
    );
    assert.equal(
      ui.container.querySelectorAll('input[type="password"]').length,
      1,
    );
    await click(button(ui.container, "Copiar link gerado"));
    assert.equal(
      copied,
      "http://administration.localhost/join/" +
        org +
        "#linkToken=synthetic-fragment-capability",
    );
    assert.equal(dom.window.localStorage.length, 0);
    assert.equal(dom.window.sessionStorage.length, 0);
    await ui.unmount();
    ui = await mount();
    assert.equal(
      ui.container.querySelectorAll('input[type="password"]').length,
      0,
    );
    assert.match(ui.container.textContent ?? "", /não pode ser recuperado/);
    await click(button(ui.container, "Revogar link"));
    assert.match(ui.container.textContent ?? "", /Link revogado/);
    assert.equal(
      ui.container.querySelectorAll('input[type="password"]').length,
      0,
    );
    assert.equal(
      calls.filter((call) => call.path.endsWith("/revoke")).length,
      1,
    );
  } finally {
    await ui.unmount();
  }
});

const tracked = (overrides:any={}) => ({id:entity,email:"person@example.test",memberType:"MEMBER",version:4,status:"PENDING",expired:false,expiresAt:"2026-11-24T12:00:00Z",createdAt:"2026-11-17T12:00:00Z",accessPlan:[],canResend:true,canCancel:true,delivery:{state:"DELIVERED",attempts:1},...overrides});
test("tracking separates accepted, expired and email states with complete localized catalogs", async()=>{
  const keys=Object.keys(invitationTrackingMessages["pt-BR"]);
  for(const catalog of Object.values(invitationTrackingMessages) as Record<string,string>[]){assert.deepEqual(Object.keys(catalog),keys);assert.ok(Object.values(catalog).every(Boolean));}
  fixture((path)=>path.startsWith(base+"/invitations?")?response({items:[tracked({expired:true,delivery:{state:"OUTCOME_UNKNOWN",attempts:2}}),tracked({id:node,status:"ACCEPTED",acceptedAt:"2026-11-17T13:00:00Z",canResend:true,canCancel:true})]}):undefined);
  const ui=await mount(false,false,"pt-BR",true);
  try {
    assert.match(ui.container.textContent??"",/Convite: Expirado/);assert.match(ui.container.textContent??"",/Envio não confirmado/);assert.match(ui.container.textContent??"",/pode ter ocorrido/);
    assert.equal(ui.container.querySelectorAll("li").length,1);
    await click(button(ui.container,"Todo o histórico"));
    const accepted=ui.container.querySelectorAll("li")[1];assert.match(accepted.textContent??"",/Convite: Aceito/);assert.equal(accepted.querySelectorAll("button").length,0);
  } finally {await ui.unmount();}
});
test("tracking resend retries same key with version and refreshes changed state; cancel needs local confirmation",async()=>{
  let record=tracked(),attempts=0;
  const calls=fixture((path,body,options)=>{
    if(path.startsWith(base+"/invitations?"))return response({items:[record]});
    if(path.endsWith("/actions/resend")){attempts++;if(attempts===1)throw new TypeError("uncertain");record=tracked({version:5,delivery:{state:"PENDING",attempts:0}});return response({invitation:record});}
    if(path.endsWith("/actions/cancel")){record=tracked({status:"REVOKED",version:6,canResend:false,canCancel:false});return response({invitation:record});}
  });
  const ui=await mount(false,false,"pt-BR",true);
  try {
    await act(async()=>{button(ui.container,"Reenviar").click();button(ui.container,"Reenviar").click();});assert.equal(attempts,1);
    await click(button(ui.container,"Reenviar"));
    const resends=calls.filter(c=>c.path.endsWith("/actions/resend"));assert.equal(resends.length,2);
    assert.equal(new Headers(resends[0].options.headers).get("Idempotency-Key"),new Headers(resends[1].options.headers).get("Idempotency-Key"));assert.equal(new Headers(resends[1].options.headers).get("If-Match"),'"4"');assert.deepEqual(resends[1].body,{});
    assert.match(ui.container.textContent??"",/Reenvio solicitado/);assert.match(ui.container.textContent??"",/Na fila/);
    await click(button(ui.container,"Cancelar convite"));assert.equal(calls.filter(c=>c.path.endsWith("/actions/cancel")).length,0);
    await click(button(ui.container,"Manter convite"));assert.equal(calls.filter(c=>c.path.endsWith("/actions/cancel")).length,0);
    await click(button(ui.container,"Cancelar convite"));await click(button(ui.container,"Confirmar cancelamento"));
    assert.equal(new Headers(calls.find(c=>c.path.endsWith("/actions/cancel"))!.options.headers).get("If-Match"),'"5"');assert.equal(ui.container.querySelectorAll("li").length,0);
    await click(button(ui.container,"Todo o histórico"));assert.match(ui.container.textContent??"",/Convite: Cancelado/);
  }finally{await ui.unmount();}
});
test("tracking paginates and resets state and late results on organization changes",async()=>{
  let resolveCommand:(value:Response)=>void=()=>{};
  const other="55555555-5555-4555-8555-555555555555";
  const calls=fixture((path,body,options)=>{
    if(path===base+"/invitations?limit=50")return response({items:[tracked()],nextCursor:entity});
    if(path.includes("cursor="))return response({items:[tracked({id:node,email:"other@example.test"})],nextCursor:null});
    if(path.endsWith("/actions/resend"))return new Promise<Response>(resolve=>{resolveCommand=resolve;});
    if(path.startsWith("/api/v1/organizations/"+other))return response({items:[]});
  });
  const ui=await mount(false,false,"pt-BR",true);
  try{
    await click(button(ui.container,"Carregar mais"));assert.equal(ui.container.querySelectorAll("li").length,2);
    await act(async()=>{button(ui.container,"Reenviar").click();});
    await ui.rerender({organizationId:other});assert.doesNotMatch(ui.container.textContent??"",/person@example.test|other@example.test/);
    await act(async()=>resolveCommand(response({invitation:tracked({version:5})})));assert.doesNotMatch(ui.container.textContent??"",/Reenvio solicitado/);
    assert.equal(calls.filter(c=>c.path===base+"/invitations?limit=50").length,1);
  }finally{await ui.unmount();}
});

test("pending tracking queries its own pages even when recent history contains only completed invitations",async()=>{
  const calls=fixture(path=>{
    if(path===base+"/invitations?limit=50")return response({items:[tracked({email:"old-pending@example.test"})],nextCursor:null});
    if(path===base+"/invitations?status=ALL")return response({items:[tracked({id:node,email:"recent-accepted@example.test",status:"ACCEPTED",canResend:false,canCancel:false})],nextCursor:node});
  });
  const ui=await mount(false,false,"pt-BR",true);
  try{
    assert.match(ui.container.textContent??"",/old-pending@example.test/);
    await click(button(ui.container,"Todo o histórico"));
    assert.match(ui.container.textContent??"",/recent-accepted@example.test/);assert.doesNotMatch(ui.container.textContent??"",/old-pending@example.test/);
    await click(button(ui.container,"Pendentes"));
    assert.match(ui.container.textContent??"",/old-pending@example.test/);assert.doesNotMatch(ui.container.textContent??"",/recent-accepted@example.test/);
    assert.equal(calls.filter(call=>call.path===base+"/invitations?limit=50").length,2);
    assert.ok(!Array.from(ui.container.querySelectorAll("button")).some(item=>item.textContent==="Carregar mais"));
  }finally{await ui.unmount();}
});

test("tracking conflict refreshes immutable accepted state and busy transport explains recovery",async()=>{
  let record=tracked(),busy=true;
  fixture((path,body,options)=>{
    if(path.startsWith(base+"/invitations?"))return response({items:[record]});
    if(path.endsWith("/actions/resend")){
      if(busy){busy=false;return new Response(JSON.stringify({error:{code:"INVITATION_DELIVERY_IN_PROGRESS"}}),{status:409,headers:{"Content-Type":"application/json"}});}
      record=tracked({status:"ACCEPTED",canResend:false,canCancel:false});
      return new Response(JSON.stringify({error:{code:"VERSION_CONFLICT"}}),{status:409,headers:{"Content-Type":"application/json"}});
    }
  });
  const ui=await mount(false,false,"pt-BR",true);
  try{
    await click(button(ui.container,"Reenviar"));assert.match(ui.container.textContent??"",/Aguarde e atualize/);
    await click(button(ui.container,"Reenviar"));assert.match(ui.container.textContent??"",/Este convite mudou/);
    await click(button(ui.container,"Todo o histórico"));assert.match(ui.container.textContent??"",/Convite: Aceito/);assert.equal(ui.container.querySelectorAll("li button").length,0);
  }finally{await ui.unmount();}
});

test("tracking notification focus fetches authorized record beyond history page and highlights it",async()=>{
  const calls=fixture(path=>path.startsWith(base+"/invitations?")?response({items:path.includes("invitationId=")?[tracked({status:"ACCEPTED",canResend:false,canCancel:false})]:[],nextCursor:null}):undefined);
  const ui=await mount(false,false,"pt-BR",true);
  try{
    await ui.rerender({path:"/organization-invitations?invitationId="+entity});
    assert.ok(calls.some(call=>call.path===base+"/invitations?status=ALL&invitationId="+entity));
    const highlighted=ui.container.querySelector("li.is-highlighted");assert.ok(highlighted);assert.match(highlighted.textContent??"",/Aceito/);assert.equal(document.activeElement,highlighted);
  }finally{await ui.unmount();}
});

test("tracking visible focus and timer refresh preserve loaded history and reader focus; unmount cleans up",async()=>{
  const originalInterval=window.setInterval,originalClear=window.clearInterval;
  const visibility=Object.getOwnPropertyDescriptor(document,"visibilityState");
  let refreshTimer:(()=>void)|undefined,cleared=0,visible=true,accepted=false;
  let finishCommand:(value:Response)=>void=()=>{};
  Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>visible?"visible":"hidden"});
  window.setInterval=((callback:()=>void,delay:number)=>{assert.equal(delay,30000);refreshTimer=callback;return 71;}) as typeof window.setInterval;
  window.clearInterval=((id:number)=>{assert.equal(id,71);cleared++;}) as typeof window.clearInterval;
  const calls=fixture((path,body,options)=>{
    if(options.method==="POST")return new Promise<Response>(resolve=>{finishCommand=resolve;});
    if(!path.startsWith(base+"/invitations?"))return;
    if(path.includes("cursor="))return response({items:[tracked({id:node,email:"history@example.test",status:accepted?"ACCEPTED":"PENDING",canResend:!accepted,canCancel:!accepted})],nextCursor:null});
    if(path.includes("invitationId="))return response({items:[tracked()]});
    return response({items:[tracked()],nextCursor:entity});
  });
  const ui=await mount(false,false,"pt-BR",true);
  try{
    await ui.rerender({path:"/organization-invitations?invitationId="+entity});
    await click(button(ui.container,"Carregar mais"));assert.equal(ui.container.querySelectorAll("li").length,2);
    const readerControl=button(ui.container,"Atualizar");readerControl.focus();accepted=true;
    await act(async()=>window.dispatchEvent(new dom.window.Event("focus")));
    assert.equal(ui.container.querySelectorAll("li").length,2);assert.match(ui.container.querySelectorAll("li")[1].textContent??"",/Aceito/);assert.equal(document.activeElement,readerControl);
    const beforeHidden=calls.length;visible=false;
    await act(async()=>{window.dispatchEvent(new dom.window.Event("focus"));refreshTimer!();});assert.equal(calls.length,beforeHidden);
    visible=true;await act(async()=>refreshTimer!());assert.ok(calls.length>beforeHidden);assert.equal(document.activeElement,readerControl);
    await ui.unmount();const afterUnmount=calls.length;
    await act(async()=>window.dispatchEvent(new dom.window.Event("focus")));assert.equal(calls.length,afterUnmount);assert.ok(cleared>=1);
  }finally{
    window.setInterval=originalInterval;window.clearInterval=originalClear;
    if(visibility)Object.defineProperty(document,"visibilityState",visibility);else delete (document as any).visibilityState;
    if(ui.container.childNodes.length)await ui.unmount();
  }
});

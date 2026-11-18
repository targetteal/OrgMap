import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><main></main>", {
  url: "http://qa.localhost",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
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
  root: new URL("../", import.meta.url).pathname,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: "custom",
});
const { feature } = await vite.ssrLoadModule("/src/features/o2/index.tsx");
const { LocalizationProvider } = await vite.ssrLoadModule(
  "/src/localization/index.tsx",
);
test.after(async () => {
  await vite.close();
  dom.window.close();
});
const manifest = {
  id: "targetteal.o2",
  name: "Organização Orgânica",
  version: "0.1.0",
  reference: {
    url: "https://o2.targetteal.com/meta-acordos",
    revision: "2026-11-01",
    accessedAt: "2026-11-01",
  },
  capabilities: [],
};
const rules = {
  membership: "OCCUPANCY",
  assignment: "GUIDE",
  guideSelection: "PARENT_GUIDE",
  structureChanges: "GOVERNANCE",
  essentialFunctions: ["GUIDE", "REPRESENTATIVE", "FACILITATOR", "SCRIBE"],
  electedFunctions: ["REPRESENTATIVE", "FACILITATOR", "SCRIBE"],
  protectEssentials: true,
  enforceEligibility: true,
};
const basic = () => ({
  organizationId: "org",
  path: "/settings/governance-model",
  session: { account: { id: "account" } },
  bootstrap: {
    membership: { id: "self", orgRole: "OWNER", memberType: "MEMBER" },
    rootCircleId: "root",
    authorizationRevision: 1,
    modules: {},
  },
  structure: {
    nodes: [],
    roles: [],
    circles: [],
    memberships: [],
    occupancies: [],
  },
  members: [
    { id: "self", displayName: "Ana" },
    { id: "other", displayName: "Bia" },
  ],
  navigate() {},
  refresh() {},
  notify() {},
});
const container = document.querySelector("main")!;
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (value) => value.textContent?.trim() === label,
  )!;

test("essential deep link waits for the draft DOM and does not scroll again while typing",async()=>{
  const {essentialDefinitionDefaults}=await import("../../server/modules/o2/package.js");
  let resolveModel:(value:any)=>void=()=>{};const pending=new Promise(resolve=>{resolveModel=resolve;});
  const scrolled:string[]=[],previous=dom.window.HTMLElement.prototype.scrollIntoView;
  dom.window.HTMLElement.prototype.scrollIntoView=function(){scrolled.push(this.id);};
  const context={...basic(),hash:"#essential",api:async()=>pending};
  const root=createRoot(container);
  try{
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:"pt-BR"}}><feature.Component context={context}/></LocalizationProvider>));
    assert.deepEqual(scrolled,[]);
    await act(async()=>resolveModel({data:{installed:true,package:manifest,canManage:true,phase:"PREPARATION",revision:1,rules:{...rules,essentialDefinitions:essentialDefinitionDefaults},overrides:{},essentialDefinitionDefaults,circles:[],bindings:[]}}));
    assert.deepEqual(scrolled,["settings-essential"]);
    const input=container.querySelector('.o2-essential-definitions textarea') as HTMLTextAreaElement;
    await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Novo propósito");input.dispatchEvent(new dom.window.Event("input",{bubbles:true}));});
    assert.deepEqual(scrolled,["settings-essential"]);
    assert.ok(container.querySelector('.o2-heading h2'));
    assert.equal(document.querySelectorAll('main').length,1);
  }finally{await act(async()=>root.unmount());dom.window.HTMLElement.prototype.scrollIntoView=previous;}
});

test("essential settings edit future O2 definitions with revision, restore the reference and keep ordinary templates separate",async()=>{
  const {essentialDefinitionDefaults}=await import("../../server/modules/o2/package.js");
  let current:any={installed:true,package:manifest,canManage:true,phase:"PREPARATION",revision:4,rules:{...rules,essentialDefinitions:structuredClone(essentialDefinitionDefaults)},overrides:{},essentialDefinitionDefaults,circles:[],bindings:[]};
  const calls:any[]=[],navigation:string[]=[];
  const context={...basic(),hash:"#essential",navigate:(path:string)=>navigation.push(path),api:async(path:string,options?:any)=>{
    if(options?.method==="PUT"){calls.push({path,options});current={...current,revision:current.revision+1,rules:structuredClone(options.body.overrides),overrides:structuredClone(options.body.overrides)};}
    return {data:structuredClone(current)};
  }};
  const root=createRoot(container);
  const input=async(node:HTMLTextAreaElement,value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,"value")!.set!.call(node,value);node.dispatchEvent(new dom.window.Event("input",{bubbles:true}));});
  try{
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:"pt-BR"}}><feature.Component context={context}/></LocalizationProvider>));
    await act(async()=>button("Papéis Essenciais").click());assert.equal(navigation.at(-1),"/settings/governance-model#essential");
    await act(async()=>button("Modelos de papéis").click());assert.equal(navigation.at(-1),"/structure/advanced#role-templates");
    assert.match(container.textContent!,/somente nos novos círculos/);
    const select=container.querySelector('.o2-essential-definitions select') as HTMLSelectElement;
    await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,"value")!.set!.call(select,"FACILITATOR");select.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});
    let editors=[...container.querySelectorAll<HTMLTextAreaElement>('.o2-essential-definitions textarea')];
    await input(editors[0],"Conversas que abrem possibilidades");
    await input(editors[1],"Escutar antes de propor\nRegistrar os próximos passos\n");
    await input(editors[2],"Processo de facilitação");
    await act(async()=>button("Salvar Papéis Essenciais").click());
    assert.equal(calls.length,1);assert.equal(calls[0].options.version,4);
    const definition=calls[0].options.body.overrides.essentialDefinitions.FACILITATOR;
    assert.equal(definition.purpose,"Conversas que abrem possibilidades");
    assert.deepEqual(definition.responsibilities,["Escutar antes de propor","Registrar os próximos passos"]);
    assert.deepEqual(definition.artifacts,["Processo de facilitação"]);
    assert.equal(calls[0].path,"/organizations/org/governance-model");
    await act(async()=>button("Restaurar definição O2 desta função").click());
    await act(async()=>button("Salvar Papéis Essenciais").click());
    assert.deepEqual(calls[1].options.body.overrides.essentialDefinitions.FACILITATOR,essentialDefinitionDefaults.FACILITATOR);
    assert.equal(calls[1].options.version,5);
  }finally{await act(async()=>root.unmount());}
});

test("members read O2 essential definitions without owner editing controls",async()=>{
  const {essentialDefinitionDefaults}=await import("../../server/modules/o2/package.js");
  const context={...basic(),hash:"#essential",bootstrap:{...basic().bootstrap,membership:{id:"self",orgRole:"MEMBER",memberType:"MEMBER"}},api:async()=>({data:{installed:true,package:manifest,canManage:false,phase:"OPERATING",revision:2,rules:{...rules,essentialDefinitions:essentialDefinitionDefaults},overrides:{},essentialDefinitionDefaults,circles:[],bindings:[]}})};
  const root=createRoot(container);
  try{
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:"pt-BR"}}><feature.Component context={context}/></LocalizationProvider>));
    assert.equal(container.querySelectorAll('.o2-essential-definitions textarea').length,3);
    assert.ok([...container.querySelectorAll('.o2-essential-definitions textarea')].every(node=>node.matches(':disabled')));
    const selector=container.querySelector('.o2-essential-definitions select') as HTMLSelectElement;
    assert.equal(selector.matches(':disabled'),false,"reading another essential function does not require write permission");
    await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,"value")!.set!.call(selector,"FACILITATOR");selector.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});
    assert.equal((container.querySelector('.o2-essential-definitions textarea') as HTMLTextAreaElement).value,essentialDefinitionDefaults.FACILITATOR.purpose);
    assert.equal(button("Salvar regras do modelo"),undefined);
    assert.equal(button("Restaurar definição O2 desta função"),undefined);
  }finally{await act(async()=>root.unmount());}
});

test("choosing O2 only installs preparation, without an operation or owner assignment command", async () => {
  let installed = false;
  const calls: { path: string; options: any }[] = [];
  const context = {
    ...basic(),
    api: async (path: string, options?: any) => {
      if (options?.method === "POST") {
        calls.push({ path, options });
        installed = true;
      }
      return {
        data: installed
          ? {
              installed: true,
              package: manifest,
              canManage: true,
              phase: "PREPARATION",
              revision: 1,
              rules,
              overrides: {},
              circles: [],
              bindings: [],
            }
          : { installed: false, package: manifest, canManage: true },
      };
    },
  };
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "pt-BR" }}>
          <feature.Component context={context} />
        </LocalizationProvider>,
      ),
    );
    await act(async () => button("Escolher O2 e preparar organização").click());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/organizations/org/governance-model/install");
    assert.deepEqual(calls[0].options.body, { packageId: "targetteal.o2" });
    assert.match(container.textContent!, /Em preparação/);
    assert.ok(button("Iniciar operação"));
  } finally {
    await act(async () => root.unmount());
  }
});

test("self assignment uses the authenticated membership and does not offer another recipient", async () => {
  const calls: { path: string; options: any }[] = [];
  const context = {
    ...basic(),
    selectedEntity: {
      entityId: "role",
      nodeId: "node",
      name: "Designer",
      kind: "ROLE",
      version: 1,
      parentNodeId: "root",
    },
    api: async (path: string, options?: any) => {
      if (options?.method) calls.push({ path, options });
      return {
        data: path.endsWith("/roles/role")
          ? {
              roleId: "role",
              functionCode: null,
              canAssign: true,
              canAssignOthers: false,
              canSelfAssign: true,
              canLeave: false,
              members: [
                { id: "self", displayName: "Ana" },
                { id: "other", displayName: "Bia" },
              ],
              occupancies: [],
            }
          : {
              installed: true,
              package: manifest,
              canManage: false,
              revision: 2,
              phase: "OPERATING",
              rules,
              overrides: {},
              circles: [],
              bindings: [],
            },
      };
    },
  };
  const Sections = feature.EntitySections;
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "pt-BR" }}>
          <Sections context={context} />
        </LocalizationProvider>,
      ),
    );
    assert.equal(container.querySelector('#entity-members h3')?.textContent, 'Quem energiza');
    assert.equal(container.querySelector('.mare-role-assignment')?.hasAttribute('open'), false);
    // A role without an essential function shows no function block; bindings live in settings.
    assert.equal(container.querySelector('.mare-role-function'), null);
    assert.match(container.textContent!, /vinculada a você/);
    assert.equal(container.querySelector("select"), null);
    const form = container.querySelector("form.o2-assignment")!;
    await act(async () =>
      form.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].path,
      "/organizations/org/governance-model/roles/role/occupancies",
    );
    assert.deepEqual(calls[0].options.body, { memberId: "self" });
  } finally {
    await act(async () => root.unmount());
  }
});

test("circle integrants follow resolved membership IDs, without a direct membership action", async () => {
  let ids = ["other"];
  let membership = "OCCUPANCY";
  const destinations: string[] = [];
  const context = {
    ...basic(),
    navigate: (path: string) => destinations.push(path),
    selectedEntity: {
      entityId: "circle",
      nodeId: "circle-node",
      name: "Círculo",
      kind: "CIRCLE",
      version: 1,
      parentNodeId: "root",
    },
    api: async () => ({
      data: {
        installed: true,
        package: manifest,
        canManage: true,
        revision: 2,
        phase: "OPERATING",
        rules: {...rules,membership},
        overrides: {},
        bindings: [],
        circles: [
          {
            circleId: "circle",
            selfAssignment: false,
            version: 0,
            canConfigure: true,
            memberIds: ids,
          },
        ],
      },
    }),
  };
  const Sections = feature.EntitySections;
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "pt-BR" }}>
          <Sections context={context} />
        </LocalizationProvider>,
      ),
    );
    assert.equal(
      container.querySelector(".o2-circle-members strong")?.textContent,
      "Bia",
    );
    assert.doesNotMatch(
      container.querySelector(".o2-circle-members")!.textContent!,
      /Ana/,
    );
    assert.doesNotMatch(
      container.textContent!,
      /Adicionar integrante|Associar pessoa/,
    );
    assert.equal(container.querySelectorAll('#entity-members').length, 1);
    assert.equal(container.querySelector('#entity-members h3')?.textContent, 'Integrantes');
    assert.equal(container.querySelector('.mare-circle-options')?.hasAttribute('open'), false);
    assert.equal(container.querySelector('.mare-entity-person .avatar')?.textContent, 'B');
    await act(async () => (container.querySelector('.mare-entity-person') as HTMLButtonElement).click());
    assert.equal(destinations.at(-1), '/members/other');
    ids = [];
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "pt-BR" }}>
          <Sections
            context={{
              ...context,
              bootstrap: { ...context.bootstrap, authorizationRevision: 2 },
            }}
          />
        </LocalizationProvider>,
      ),
    );
    assert.match(container.textContent!, /Nenhuma pessoa integra este círculo/);
    membership = "LEGACY";
    await act(async () => root.render(<LocalizationProvider preferences={{locale:"pt-BR"}}><Sections context={{...context,bootstrap:{...context.bootstrap,authorizationRevision:3}}}/></LocalizationProvider>));
    assert.equal(container.querySelector('#entity-members'), null, 'legacy relations remain in the shell instead of a duplicate members section');
    assert.ok(container.querySelector('.mare-circle-options'), 'self-assignment controls remain accessible');
  } finally {
    await act(async () => root.unmount());
  }
});

test('settings navigate to real sections and circle changes preserve authority, version and unsaved state',async()=>{
 const calls:{path:string;options:any}[]=[],destinations:string[]=[];
 let guard:(()=>string|null)|null=null;
 const context={...basic(),hash:'#circle-options',structure:{...basic().structure,nodes:[{nodeId:'n1',entityId:'c1',name:'Círculo A',kind:'CIRCLE',parentNodeId:null,version:1},{nodeId:'n2',entityId:'c2',name:'Círculo B',kind:'CIRCLE',parentNodeId:null,version:1}]},navigate:(path:string)=>destinations.push(path),registerNavigationGuard:(fn:()=>string|null)=>{guard=fn;return()=>{if(guard===fn)guard=null}},api:async(path:string,options?:any)=>{if(options?.method)calls.push({path,options});return {data:{installed:true,package:manifest,canManage:true,revision:4,phase:'OPERATING',rules,overrides:{},bindings:[],circles:[{circleId:'c1',selfAssignment:false,version:7,canConfigure:true,memberIds:['self']},{circleId:'c2',selfAssignment:false,version:2,canConfigure:false,memberIds:[]}]}}}};
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><feature.Component context={context}/></LocalizationProvider>));
  const nav=container.querySelector('.settings-frame-nav')!;
  await act(async()=>[...nav.querySelectorAll('button')].find(button=>button.textContent?.includes('Papéis Essenciais'))!.click());
  assert.equal(destinations.at(-1),'/settings/governance-model#essential');
  await act(async()=>[...nav.querySelectorAll('button')].find(button=>button.textContent?.includes('Modelos de papéis'))!.click());
  assert.equal(destinations.at(-1),'/structure/advanced#role-templates');
  const section=container.querySelector('#settings-circle-options')!, select=section.querySelector('select') as HTMLSelectElement;
  await act(async()=>{select.value='c1';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
  const checkbox=section.querySelector('input[type="checkbox"]') as HTMLInputElement;
  await act(async()=>checkbox.click());
  assert.equal(select.disabled,true);assert.match(guard?.()??'',/não salvas/);
  await act(async()=>button('Descartar').click());assert.equal(select.disabled,false);
  await act(async()=>checkbox.click());
  await act(async()=>section.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/organizations/org/governance-model/circles/c1');assert.equal(calls[0].options.version,7);assert.deepEqual(calls[0].options.body,{selfAssignment:true});
  const refreshed=container.querySelector('#settings-circle-options')!, nextSelect=refreshed.querySelector('select') as HTMLSelectElement;
  await act(async()=>{nextSelect.value='c2';nextSelect.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
  assert.equal((refreshed.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled,true);
 }finally{await act(async()=>root.unmount())}
});

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createServer } from "vite";

const dom = new JSDOM(
  '<!doctype html><html><body><button id="previous">Outro controle</button><main></main></body></html>',
  { url: "http://structure.localhost/structure" },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "SVGElement",
  "Element",
  "Node",
  "Event",
  "KeyboardEvent",
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
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", {
  value: TestResizeObserver,
  configurable: true,
});
const testViewport = {width: 320, height: 500};
const rect = dom.window.Element.prototype.getBoundingClientRect;
dom.window.Element.prototype.getBoundingClientRect = function () {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: testViewport.width,
    bottom: testViewport.height,
    width: testViewport.width,
    height: testViewport.height,
    toJSON() {
      return {};
    },
  } as DOMRect;
};
const { createRoot } = await import("react-dom/client");
const vite = await createServer({
  root: new URL("../", import.meta.url).pathname,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: "custom",
});
const { StructureExplorer } = await vite.ssrLoadModule(
  "/src/StructureExplorer.tsx",
);
const { GlobalAccessibilityProvider, useAccessibility } = await vite.ssrLoadModule(
  "/src/accessibility/index.tsx",
);
const container = document.querySelector("main")!;
let apiCalls = 0,
  latest: any;
const node = {
  nodeId: "circle-node",
  entityId: "circle-visible",
  kind: "CIRCLE",
  parentNodeId: null,
  pathRedacted: true,
  name: "Círculo concedido",
  version: 1,
};
const context = {
  organizationId: "org",
  path: "/structure",
  session: { account: { id: "guest-account" } },
  bootstrap: {
    organization: { id: "org", name: "Organização" },
    membership: { id: "guest", memberType: "GUEST", orgRole: "MEMBER" },
    rootCircleId: null,
    capabilities: { "structure.direct": false },
  },
  structure: {
    structureRevision: 1,
    nodes: [node],
    circles: [{ id: "circle-visible", nodeId: "circle-node", purpose: null }],
    roles: [],
    memberships: [],
    occupancies: [],
    coverage: {
      complete: false,
      depthLimited: false,
      degradedReasons: ["RESTRICTED"],
    },
  },
  members: [],
  navigate: () => {},
  api: async () => {
    apiCalls++;
    throw Error("unexpected request");
  },
  notify: () => {},
  refresh: () => {},
};
const initialState = {
  mode: "pack",
  quick: "none",
  memberFilter: "",
  circleFilter: "",
  kindFilter: "CIRCLE",
  query: "",
  highlight: "none",
  labels: true,
  avatars: true,
  minimap: false,
  locked: false,
  collapsed: [],
  scale: 1,
  pan: { x: 0, y: 0 },
};
const stateChanged = (value: any) => {
  latest = value;
};
const trigger = () => {
  const b = container.querySelector(
    'button[title="Pesquisar no gráfico"]',
  ) as HTMLButtonElement | null;
  assert.ok(b);
  return b;
};
const input = () => {
  const el = container.querySelector(
    'input[aria-label="Pesquisar no gráfico"]',
  ) as HTMLInputElement | null;
  assert.ok(el);
  return el;
};
const setValue = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};
test('saved-view revalidation inside an entity drawer does not navigate or replace the session filters', async () => {
  const root = createRoot(container);
  const visited:string[]=[];
  const savedId='11111111-1111-4111-8111-111111111111';
  const config={view:'PACK',query:'persistida',kind:'ALL',rootId:null,memberId:null,flag:null,maxDepth:100,presentation:{quick:'none',highlight:'none',labels:true,avatars:true,minimap:false}};
  const graph={entities:[{id:node.entityId,nodeId:node.nodeId,kind:'CIRCLE',name:node.name,parentId:null,version:1}],coverage:{complete:false,depthLimited:false}};
  let snapshot:any;
  try {
    await act(async()=>root.render(<StructureExplorer
      context={{...context,path:'/structure?view=pack&savedView='+savedId,selectedEntity:{entityId:node.entityId},navigate:(path:string)=>visited.push(path),api:async(path:string)=>({data:path.includes('/views/')?{id:savedId,name:'Vista',version:1,config}:graph})}}
      initialState={{...initialState,selectedViewId:savedId,appliedConfig:config,query:'edição da sessão',scale:2,pan:{x:12,y:9}}}
      onStateChange={(value:any)=>snapshot=value}
    />));
    assert.deepEqual(visited,[]);
    assert.equal(snapshot.query,'edição da sessão');
    assert.equal(snapshot.scale,2);
    assert.deepEqual(snapshot.pan,{x:12,y:9});
  } finally {await act(async()=>root.unmount());}
});
test.after(async () => {
  dom.window.Element.prototype.getBoundingClientRect = rect;
  await vite.close();
  dom.window.close();
});
test("Escape closes graph search, restores the actual opener and preserves the Guest filter", async () => {
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <StructureExplorer
          context={context}
          onCreateCircle={() => {
            throw Error("Guest cannot create");
          }}
          initialState={initialState}
          onStateChange={stateChanged}
        />,
      ),
    );
    const previous = document.getElementById("previous") as HTMLButtonElement;
    previous.focus();
    const opener = trigger();
    assert.notEqual(document.activeElement, opener);
    await act(async () => opener.click());
    assert.equal(document.activeElement, input());
    assert.equal(opener.getAttribute("aria-expanded"), "true");
    await setValue(input(), "concedido");
    assert.equal(latest.query, "concedido");
    assert.equal(latest.kindFilter, "CIRCLE");
    const results = container.querySelector(".sx-search-list")!;
    assert.deepEqual(
      [...results.querySelectorAll("button")].map((b) => b.textContent?.trim()),
      ["Círculo concedido"],
    );
    await act(async () =>
      input().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(
      container.querySelector('input[aria-label="Pesquisar no gráfico"]'),
      null,
    );
    assert.equal(container.querySelector('.sx-search[role="region"]'), null);
    assert.equal(document.activeElement, opener);
    assert.equal(opener.getAttribute("aria-expanded"), "false");
    assert.equal(latest.query, "concedido");
    assert.equal(latest.kindFilter, "CIRCLE");
    await act(async () => opener.click());
    assert.equal(input().value, "concedido");
    assert.equal(
      container.querySelectorAll(".sx-search-list button").length,
      1,
    );
    const close = container.querySelector(
      'button[title="Fechar opções"]',
    ) as HTMLButtonElement | null;
    assert.ok(close);
    await act(async () => close.click());
    assert.equal(container.querySelector('.sx-search[role="region"]'), null);
    assert.equal(document.activeElement, opener);
    assert.equal(latest.query, "concedido");
    assert.equal(latest.kindFilter, "CIRCLE");
    assert.equal(apiCalls, 0);
    assert.doesNotMatch(container.textContent!, /Círculo secreto|Pai oculto/);
  } finally {
    await act(async () => root.unmount());
  }
});

test("hierarchy starts at reading scale and keyboard focus reveals offscreen names", async () => {
  testViewport.width = 1440; testViewport.height = 1000;
  const root = createRoot(container);
  const visited:string[] = [];
  const children = Array.from({length:8},(_,i)=>({...node,nodeId:'role-'+i,entityId:'role-'+i,kind:'ROLE',parentNodeId:node.nodeId,name:'Responsabilidade longa de articulação '+i}));
  try {
    await act(async()=>root.render(<StructureExplorer context={{...context,navigate:(path:string)=>visited.push(path),path:'/structure?view=hierarchy',structure:{...context.structure,nodes:[node,...children]}}} onCreateCircle={()=>{}}/>));
    const graph=container.querySelector('.sx-graph')!;
    const before=graph.getAttribute('viewBox')!;
    const [cx,cy,cw,ch]=before.split(' ').map(Number);
    const s=testViewport.width/cw;
    assert.ok(Math.abs(cw/ch-testViewport.width/testViewport.height)<1e-9,'camera has the viewport aspect ratio');
    assert.ok(s >= 0.999,'initial camera preserves native card reading scale');
    const rootCard=container.querySelector('[data-node="circle-node"] .sx-hierarchy-card')!;
    const rootY=Number(rootCard.getAttribute('y'))+40;
    assert.ok(Math.abs((rootY-cy)*s-80)<1e-6,'root center starts 80px from canvas top without letterboxing');
    (graph as any).setPointerCapture=()=>{};
    await act(async()=>graph.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true,clientX:200,clientY:200})));
    await act(async()=>graph.dispatchEvent(new dom.window.MouseEvent('pointermove',{bubbles:true,clientX:230,clientY:240})));
    const moved=graph.getAttribute('viewBox')!.split(' ').map(Number);
    assert.ok(Math.abs(moved[0]-(cx-30/s))<1e-6,'horizontal pan converts pixels at 1/s');
    assert.ok(Math.abs(moved[1]-(cy-40/s))<1e-6,'vertical pan converts pixels at the same 1/s');
    await act(async()=>graph.dispatchEvent(new dom.window.MouseEvent('pointerup',{bubbles:true})));
    const role=container.querySelector('[data-node="role-0"][role="link"]') as unknown as HTMLElement;
    await act(async()=>role.focus());
    assert.notEqual(graph.getAttribute('viewBox'),moved.join(' '),'keyboard focus must reveal the offscreen node');
    assert.equal(container.querySelector('[role="tooltip"] strong')?.textContent,children[0].name);
    assert.equal(role.getAttribute('aria-describedby'),'structure-node-tooltip');
    const modes=Array.from(container.querySelectorAll('.sx-modes button')).map(b=>b.textContent);
    assert.deepEqual(modes,['Círculos','Rede','Lista']);
    await act(async()=> (container.querySelector('button[title="Rede"]') as HTMLButtonElement).click());
    assert.equal(visited.at(-1),'/structure?view=network');
    await act(async()=> (container.querySelector('button[title="Lista"]') as HTMLButtonElement).click());
    assert.equal(visited.at(-1),'/structure/directory');
  } finally { await act(async()=>root.unmount()); }
});

test("camera aspect expansion preserves pack and network centers and rendered positions", async () => {
  testViewport.width=1440;testViewport.height=1000;
  const {graphScene,networkAspect}=await vite.ssrLoadModule('/src/graph-layout.ts');
  const nodes=[node,...Array.from({length:3},(_,i)=>({...node,nodeId:'position-'+i,entityId:'position-'+i,kind:'ROLE',parentNodeId:node.nodeId,name:'Papel '+i}))];
  const root=createRoot(container);
  try {
    for(const mode of ['pack','network']) {
      const zoom=1.7,pan={x:40,y:-20};
      await act(async()=>root.render(<StructureExplorer key={mode} context={{...context,path:'/structure?view='+mode,structure:{...context.structure,nodes}}} initialState={{...initialState,mode,scale:zoom,pan}} onCreateCircle={()=>{}}/>));
      const [x,y,w,h]=container.querySelector('.sx-graph')!.getAttribute('viewBox')!.split(' ').map(Number);
      const scene=graphScene(nodes,mode,new Set(),mode==='network'?networkAspect(1440,1000):1),b=scene.bounds;
      assert.ok(Math.abs(w/h-1.44)<1e-9);
      assert.ok(Math.abs(x+w/2-(b.x+b.width/2+pan.x))<1e-6);
      assert.ok(Math.abs(y+h/2-(b.y+b.height/2+pan.y))<1e-6);
      const fittedW=mode==='pack'?b.width:Math.max(b.width,1440,(Math.max(...scene.nodes.map((n:any)=>n.x))-Math.min(...scene.nodes.map((n:any)=>n.x)))/(1-160/1440));
      const fittedH=mode==='pack'?b.height:Math.max(b.height,1000);
      const s=Math.min(1440/(fittedW/zoom),1000/(fittedH/zoom));
      const oldX=b.x+b.width/2+pan.x-fittedW/zoom/2;
      const oldY=b.y+b.height/2+pan.y-fittedH/zoom/2;
      const p=scene.nodes[0];
      assert.ok(Math.abs((p.x-x)*1440/w-((1440-fittedW/zoom*s)/2+(p.x-oldX)*s))<1e-6);
      assert.ok(Math.abs((p.y-y)*1000/h-((1000-fittedH/zoom*s)/2+(p.y-oldY)*s))<1e-6);
    }
  } finally {await act(async()=>root.unmount());}
});

test('circle activation focuses before opening, while a role opens immediately', async () => {
  testViewport.width=1200; testViewport.height=800;
  Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:true,addEventListener(){},removeEventListener(){}})});
  const circle={...node,nodeId:'sub-circle',entityId:'sub-circle',parentNodeId:node.nodeId,name:'Subcírculo',pathRedacted:false};
  const role={...node,nodeId:'role-new',entityId:'role-new',parentNodeId:circle.nodeId,kind:'ROLE',name:'Papel',pathRedacted:false};
  const visited:string[]=[]; const root=createRoot(container);
  try {
    await act(async()=>root.render(<StructureExplorer context={{...context,navigate:(path:string)=>visited.push(path),structure:{...context.structure,nodes:[node,circle,role]}}}/>));
    const before=container.querySelector('.sx-graph')!.getAttribute('viewBox');
    const child=container.querySelector('[data-node="sub-circle"]')!;
    await act(async()=>child.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.equal(visited.length,0); assert.notEqual(container.querySelector('.sx-graph')!.getAttribute('viewBox'),before);
    await act(async()=>child.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.match(visited.at(-1)!,/^\/circles\/sub-circle\?/);
    const roleNode=container.querySelector('[data-node="role-new"]')!;
    await act(async()=>roleNode.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.match(visited.at(-1)!,/^\/roles\/role-new\?/);
  } finally {await act(async()=>root.unmount());}
});

test("the account's reduce-motion switch completes a camera transition immediately", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  const savedFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const savedCancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  let frameId = 0;
  const pending = new Set<number>();
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: () => {
      pending.add(++frameId);
      return frameId;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => pending.delete(id),
  });
  const child = { ...node, nodeId: "child", entityId: "child", parentNodeId: node.nodeId, name: "Subcírculo" };
  const mapContext = { ...context, structure: { ...context.structure, nodes: [node, child] } };
  function PreferenceSwitch() {
    const { update } = useAccessibility();
    return <button id="reduce-motion" onClick={() => update("motion", true)}>Reduzir movimento</button>;
  }
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <GlobalAccessibilityProvider accountId="motion-test" organizationId="org">
        <PreferenceSwitch />
        <StructureExplorer context={mapContext} />
      </GlobalAccessibilityProvider>,
    ));
    const graph = container.querySelector(".sx-graph")!;
    const initial = graph.getAttribute("viewBox");
    await act(async () => container.querySelector('[data-node="child"]')!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.equal(pending.size, 1, "the system preference is off, so the camera initially schedules motion");
    assert.equal(graph.getAttribute("viewBox"), initial);
    await act(async () => container.querySelector<HTMLButtonElement>("#reduce-motion")!.click());
    assert.equal(pending.size, 0, "changing the preference cancels the pending frame");
    assert.notEqual(graph.getAttribute("viewBox"), initial, "the camera reaches its target without stepping through frames");
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="Aumentar zoom"]')!.click());
    assert.equal(pending.size, 0, "the next camera action also skips animation");
  } finally {
    await act(async () => root.unmount());
    for (const [key, saved] of [["requestAnimationFrame", savedFrame], ["cancelAnimationFrame", savedCancel]] as const) {
      if (saved) Object.defineProperty(globalThis, key, saved);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

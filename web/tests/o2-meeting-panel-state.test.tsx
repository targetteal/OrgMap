import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";
const dom = new JSDOM("<!doctype html><main></main>", {
  url: "http://o2-panel.localhost",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "FormData", "MutationObserver"])
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom.window : (dom.window as any)[key],
    configurable: true,
  });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createRoot } = await import("react-dom/client");
const vite = await createServer({
  root: new URL("../", import.meta.url).pathname,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: "custom",
});
const { O2MeetingPanel } = await vite.ssrLoadModule(
  "/src/features/meetings/o2-panel.tsx",
);
const { LocalizationProvider } = await vite.ssrLoadModule(
  "/src/localization/index.tsx",
);
test.after(async () => {
  await vite.close();
  dom.window.close();
});
test("preparation hides the diagram; presenting starts a valid shared stage and secondary controls stay collapsed", async () => {
  const meetingId = "22222222-2222-4222-8222-222222222222";
  const circleId = "33333333-3333-4333-8333-333333333333";
  const adaptId = "44444444-4444-4444-8444-444444444444";
  const createdId = "55555555-5555-4555-8555-555555555555";
  const meeting = {
    id: meetingId,
    title: "Produto",
    circleId,
    state: "RUNNING",
    version: 1,
    currentStep: "agenda",
    notetakerId: "scribe",
    facilitatorId: "facilitator",
    sections: [{ id: "agenda", title: "Pauta", kind: "AGENDA" }],
  };
  const attendee = {
    memberId: "scribe",
    attendance: "PRESENT",
    access: "READ",
    isCircleMember: true,
  };
  const data = {
    meeting,
    agenda: [
      { id: "agenda-item", title: "Tensão", status: "OPEN" },
      { id: "sync-item", title: "Apenas título", status: "OPEN" },
      { id: adaptId, title: "Adaptar sem proposta", status: "OPEN" },
    ],
    participants: [attendee],
    actions: [],
    capabilities: { edit: false, proposeGovernance: true },
    accessMode: "PARTICIPANT",
  };
  const panel: any = {
    member: true,
    present: true,
    canConduct: true,
    canConfigure: false,
    panel: { focusId: "agenda-item", notes: "" },
    attendees: [attendee],
    review: [],
    treatments: [
      { agendaId: "agenda-item", mode: "ADAPT" },
      { agendaId: "sync-item", mode: "SYNC" },
      { agendaId: adaptId, mode: "ADAPT" },
    ],
    processes: [],
    proposals: [
      {
        agendaId: "agenda-item",
        proposal: {
          id: "proposal",
          title: "Proposta",
          state: "DRAFT",
          revision: 1,
          authorId: "scribe",
          applyState: "PENDING",
          payload: { changes: [] },
        },
      },
    ],
  };
  const calls: any[] = [],
    navigation: string[] = [];
  const c: any = {
    organizationId: "org",
    session: { account: { id: "account" } },
    path: `/meetings/${meetingId}?step=agenda`,
    bootstrap: { organization: {}, membership: { id: "scribe", memberType: "MEMBER" }, modules: {meetings:true, governance:true} },
    structure: { nodes: [{ entityId:circleId, name:"Produto", kind:"CIRCLE" }] },
    members: [{ id: "scribe", displayName: "Escriba" }],
    navigate(path: string) {
      navigation.push(path);
    },
    api: async (path: string, options: any) => {
      calls.push({ path, options });
      if (path.endsWith("/documents")) return {data:{items:[]}};
      if (path.endsWith("/outcomes")) {
        const {title,payload,agendaId}=options.body;
        panel.proposals.push({agendaId,proposal:{id:createdId,title,payload,revision:1,state:"DRAFT",authorId:"scribe"}});
        meeting.version++;
        return {data:{target:{kind:"PROPOSAL",id:createdId,title}}};
      }
      if (options?.method === "POST") {
        if (path.endsWith("/focus")) {
          panel.panel.focusId = options.body.agendaId;
        } else {
          assert.equal(options.body.action, "start");
          panel.processes = [
            {
              proposalId: "proposal",
              revision: 1,
              stage: "PRESENT",
              objections: [],
            },
          ];
        }
        meeting.version++;
        return { data: { updated: true } };
      }
      return { data: structuredClone(path.endsWith("/panel") ? panel : data) };
    },
  };
  const container = document.querySelector("main")!,
    root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "pt-BR" }}>
          <O2MeetingPanel context={c} meetingId={meetingId} />
        </LocalizationProvider>,
      ),
    );
    assert.equal(container.querySelector('[role="img"]'), null);
    assert.doesNotMatch(container.textContent ?? "", /Etapa atual: undefined/);
    assert.equal(
      (container.querySelector(".o2-controls") as HTMLDetailsElement).open,
      false,
    );
    const start = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Apresentar proposta",
    );
    assert.ok(start);
    await act(async () => start.click());
    assert.match(
      container.querySelector('[role="img"]')?.getAttribute("aria-label") ?? "",
      /Etapa atual: Apresentar proposta/,
    );
    assert.ok(
      calls.some(
        (c) =>
          c.path.endsWith("/panel/actions/process") && c.options.version === 1,
      ),
    );
    const sync = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Apenas título"),
    );
    assert.ok(sync);
    await act(async () => sync.click());
    assert.equal(
      container.querySelector(".o2-focus h2")?.textContent,
      "Apenas título",
    );
    assert.equal(container.querySelector('[role="img"]'), null);
    assert.doesNotMatch(
      container.textContent ?? "",
      /undefined|Estado do processo indisponível/,
    );
    assert.ok(
      Array.from(container.querySelectorAll("button")).some(
        (b) => b.textContent === "Registrar encaminhamento",
      ),
    );
    const adapt = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Adaptar sem proposta"),
    );
    assert.ok(adapt);
    await act(async () => adapt.click());
    const build = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Registrar encaminhamento",
    );
    assert.ok(build);
    await act(async () => build.click());
    const type = container.querySelector<HTMLSelectElement>('dialog select[name="kind"]');
    assert.ok(type);
    await act(async () => {
      type.value = "circle";
      type.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!.click());
    const composer = container.querySelector<HTMLDialogElement>(".gov-dialog");
    assert.ok(composer);
    assert.deepEqual(navigation, []);
    const name = composer.querySelector<HTMLInputElement>('input:not([name])')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value")!.set!.call(name,"Círculo de teste");
      name.dispatchEvent(new Event("input", {bubbles:true}));
    });
    await act(async () => composer.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    const write = calls.find(call => call.path.endsWith("/outcomes"));
    assert.equal(write?.options.body.agendaId, adaptId);
    assert.equal(write?.options.body.payload.changes[0]?.entityKind, "CIRCLE");
    assert.equal(container.querySelector(".gov-dialog"), null);
    assert.equal(container.querySelector(".o2-focus h2")?.textContent, "Adaptar sem proposta");
    assert.match(container.querySelector(".o2-governance")?.textContent ?? "", /Círculo de teste/);
    assert.deepEqual(navigation, []);
    // Another actor changes the server projection while this observer stays open.
    panel.panel.focusId = "agenda-item";
    panel.processes[0].stage = "REACT";
    meeting.version++;
    panel.attendees.push({
      memberId: "guest",
      attendance: "PRESENT",
      access: "READ",
      isCircleMember: false,
    });
    const before = calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2700));
    });
    assert.ok(calls.length > before);
    assert.match(
      container.querySelector('[role="img"]')?.getAttribute("aria-label") ?? "",
      /Etapa atual: Reações/,
    );
    assert.match(container.textContent ?? "", /Presentes \(2\)/);
  } finally {
    await act(async () => root.unmount());
  }
});

test("scheduled preparation browses the real agenda without starting or changing the shared step", async () => {
  const meeting = { id: "scheduled", title: "Encontro a preparar", state: "SCHEDULED", version: 4, circleId: "circle", currentStep: "checkin", startAt: "2030-02-01T12:00:00Z", durationMinutes: 60, sections: [{ id: "checkin", title: "Chegada", kind: "CHECKIN" }, { id: "agenda", title: "Pauta", kind: "AGENDA" }] };
  const detail = { meeting, agenda: [{ id: "one", title: "Primeiro assunto", status: "OPEN" }, { id: "two", title: "Segundo assunto", status: "OPEN" }], participants: [{ memberId: "scribe", access: "EDIT", attendance: "INVITED" }], capabilities: { secretaryOperation: true }, accessMode: "PARTICIPANT" };
  const panel = { member: true, present: false, canConduct: false, panel: { focusId: null, notes: "" }, attendees: [], treatments: [], proposals: [], processes: [], review: [] };
  const writes: any[] = [];
  const context: any = { organizationId: "org", session: {account:{id:"account"}}, path: "/meetings", bootstrap: { membership: { id: "scribe", memberType: "MEMBER" } }, members: [{ id: "scribe", displayName: "Pessoa" }], navigate() {}, api: async (path: string, options: any) => {
    if (options?.method === "POST") { writes.push({ path, options }); meeting.state = "RUNNING"; meeting.version++; return { data: {} }; }
    return { data: structuredClone(path.endsWith("/panel") ? panel : detail) };
  } };
  const container = document.querySelector("main")!, root = createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{ locale: "pt-BR" }}><O2MeetingPanel context={context} meetingId="scheduled" /></LocalizationProvider>));
    assert.match(container.querySelector(".o2-ready")?.textContent ?? "", /Vamos preparar o encontro/);
    const second = [...container.querySelectorAll(".o2-tension")].find(button => button.textContent?.includes("Segundo assunto")) as HTMLButtonElement;
    await act(async () => second.click());
    assert.equal(container.querySelector(".o2-focus h2")?.textContent, "Segundo assunto");
    assert.equal(writes.length, 0);
    assert.equal(meeting.currentStep, "checkin");
    assert.equal(panel.present, false);
    await act(async () => ([...container.querySelectorAll("button")].find(button => button.textContent === "Iniciar reunião") as HTMLButtonElement).click());
    assert.equal(writes.length, 1);
    assert.ok(writes[0].path.endsWith("/actions/start"));
    assert.equal(writes[0].options.version, 4);
    assert.equal(panel.present, false, "starting is independent of declaring attendance");
    assert.equal(container.querySelector(".o2-ready"), null);
  } finally { await act(async () => root.unmount()); }
});

test("closed minutes use the frozen agenda, notes and decision application state", async () => {
  const meeting = { id: "closed", title: "Ata preservada", state: "CLOSED", version: 8, currentStep: "checkout", sections: [{ id: "checkout", title: "Saída", kind: "CHECKOUT" }] };
  const detail = { meeting, agenda: [{ id: "live", title: "Agenda posterior", status: "OPEN" }], participants: [], capabilities: {} };
  const panel = { member: false, present: false, panel: { notes: "Notas posteriores" }, treatments: [], proposals: [], processes: [], minutes: { participants: [{ memberId: "member", access: "READ", attendance: "PRESENT" }], agenda: [{ id: "frozen", title: "Assunto da ata", status: "OPEN" }], actions: [{ id: "task", agendaId: "frozen", title: "Próximo passo registrado" }], documents: [], o2: { panels: [{ notes: "Notas congeladas" }], decisions: [{ id: "decision", title: "Acordo aprovado", verdict: "ADOPT", applyState: "PENDING", restrictions:[{documentId:"doc1",title:"Primeira restrição",content:"Primeiro texto preservado"},{documentId:"doc2",title:"Segunda restrição",content:"Segundo texto preservado"}] }] } } };
  const context: any = { organizationId: "org", session: {account:{id:"account"}}, path: "/meetings", bootstrap: { membership: { id: "member" } }, members: [{ id: "member", displayName: "Pessoa presente" }], navigate() {}, api: async (path: string) => ({ data: structuredClone(path.endsWith("/panel") ? panel : detail) }) };
  const container = document.querySelector("main")!, root = createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{ locale: "pt-BR" }}><O2MeetingPanel context={context} meetingId="closed" /></LocalizationProvider>));
    assert.equal(container.querySelectorAll('h1').length, 1);
    assert.equal(container.querySelector('.o2-queue'), null);
    assert.equal(container.querySelector('.o2-steps'), null);
    assert.equal(container.querySelector('.o2-notes'), null);
    const text = container.querySelector(".mare-meeting-minutes")?.textContent ?? "";
    assert.match(text, /Assunto da ata/); assert.match(text, /Notas congeladas/); assert.match(text, /Pessoa presente/); assert.match(text, /Próximo passo registrado/); assert.match(text, /Decisão aprovada · efetivação pendente/);assert.match(text,/Primeiro texto preservado/);assert.match(text,/Segundo texto preservado/);
    assert.doesNotMatch(text, /Agenda posterior|Notas posteriores|Alteração efetivada/);
  } finally { await act(async () => root.unmount()); }
});

test("step editor preserves section identities when reordering instead of rebuilding IDs by position", async () => {
  const { MeetingStepsEditor } = await vite.ssrLoadModule("/src/features/meetings/meeting-steps-editor.tsx");
  const container = document.querySelector("main")!, root = createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{locale:"pt-BR"}}><form><MeetingStepsEditor sections={[{id:"arrival",kind:"CHECKIN",title:"Chegada"},{id:"agenda",kind:"AGENDA",title:"Pauta"}]} /></form></LocalizationProvider>));
    const up = container.querySelector('[aria-label="Mover para cima: Pauta"]') as HTMLButtonElement;
    await act(async () => up.click());
    const rows = JSON.parse((container.querySelector('[name="sectionsJson"]') as HTMLInputElement).value);
    assert.deepEqual(rows.map((row: any) => row.id), ["agenda", "arrival"]);
    assert.equal(rows[0].kind, "AGENDA");
    assert.equal(container.querySelector('textarea'), null, "no encoded TIPO|Título editor");
  } finally { await act(async () => root.unmount()); }
});

test("simple scheduling keeps real recurrence, timezone and O2 request fields with no duplicate names", async () => {
  const { MeetingScheduleFields } = await vite.ssrLoadModule("/src/features/meetings/meeting-schedule-fields.tsx");
  const container = document.querySelector("main")!, root = createRoot(container);
  const c: any = {bootstrap:{governanceModel:{},membership:{id:"self"}},structure:{circles:[{id:"circle"}],nodes:[{entityId:"circle",name:"Produto"}],roles:[]},members:[{id:"self",status:"ACTIVE",displayName:"Pessoa"}]};
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{locale:"pt-BR",timeZone:"America/Sao_Paulo"}}><form><MeetingScheduleFields context={c} templates={[]} circleId="circle" /></form></LocalizationProvider>));
    const form = container.querySelector('form')!;
    let fields = new dom.window.FormData(form);
    assert.equal(fields.get('frequency'), 'ONCE'); assert.equal(fields.get('count'), '1'); assert.equal(fields.get('method'), 'HOLACRACY'); assert.equal(fields.get('circleId'), 'circle'); assert.equal(fields.get('timeZone'), 'America/Sao_Paulo');
    const repeat = container.querySelector('[name="frequency"]') as HTMLSelectElement;
    await act(async () => {repeat.value='WEEKLY';repeat.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    fields = new dom.window.FormData(form);
    assert.deepEqual(fields.getAll('interval'), ['1']);assert.deepEqual(fields.getAll('count'), ['12']);
    assert.equal(container.querySelector('details')?.open, false);
  } finally { await act(async () => root.unmount()); }
});

test("the next-step action advances the shared meeting with its version and respects conduct authority", async () => {
  const meeting = {id:"flow",title:"Encontro",state:"RUNNING",version:7,currentStep:"checkin",notetakerId:"scribe",sections:[{id:"checkin",title:"Check-in",kind:"CHECKIN"},{id:"agenda",title:"Pauta",kind:"AGENDA"}]};
  const detail = {meeting,agenda:[],participants:[],capabilities:{}};
  const panel = {member:true,present:true,canConduct:true,panel:{focusId:null,notes:""},attendees:[],review:[],treatments:[],proposals:[],processes:[]};
  const writes: any[] = [];
  const c: any = {organizationId:"org",session:{account:{id:"account"}},path:"/meetings",bootstrap:{membership:{id:"scribe",memberType:"MEMBER"}},members:[],navigate(){},api:async(path: string, options: any) => {if(options?.method==='POST'){writes.push({path,options});meeting.currentStep=options.body.sectionId;meeting.version++;}return {data:structuredClone(path.endsWith('/panel')?panel:detail)};}};
  const container = document.querySelector('main')!,root=createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{locale:"pt-BR"}}><O2MeetingPanel context={c} meetingId="flow"/></LocalizationProvider>));
    await act(async () => (container.querySelector('.o2-next-step') as HTMLButtonElement).click());
    assert.equal(writes[0].path,'/organizations/org/meetings/flow/panel/actions/step');assert.equal(writes[0].options.version,7);assert.deepEqual(writes[0].options.body,{sectionId:'agenda'});
    assert.equal(container.querySelector('.o2-steps [aria-current="step"]')?.textContent,'2Pauta');
    assert.equal(container.querySelectorAll('.o2-room-heading h1').length,1);
    panel.canConduct=false;
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2600));});
    assert.ok([...container.querySelectorAll('.o2-steps button')].every(button=>(button as HTMLButtonElement).disabled));
  } finally {await act(async()=>root.unmount());}
});

/** React/TipTap DOM regressions. jsdom is not a substitute for CUA or PostgreSQL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import {
  RichTextEditor,
  type RichTextEditorProps,
} from "../../web/src/editor/RichTextEditor.tsx";
import {RoleMentionProvider,type RoleMentionScope} from "../../web/src/editor/role-mentions.tsx";
import {
  fromPlainText,
  toPlainText,
  type RichDocument,
} from "../../packages/content/index.ts";

async function fixture(
  initial = "A",
  extra: Partial<RichTextEditorProps> = {},
  scope: RoleMentionScope|null = null,
) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
    pretendToBeVisual: true,
    url: "http://editor.localhost/",
  });
  const names = [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "DOMParser",
    "MutationObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "KeyboardEvent",
    "Event",
  ] as const;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const name of names) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: (dom.window as any)[name],
    });
  }
  originals.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  );
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const root = createRoot(document.getElementById("root")!);
  const changes: RichDocument[] = [];
  let editor: Editor | undefined;
  let props: RichTextEditorProps = {
    value: fromPlainText(initial),
    label: "Teste",
    onChange: (d) => changes.push(d),
    onReady: (e) => {
      editor = e;
    },
    ...extra,
  };
  const render = async (next: Partial<RichTextEditorProps>) => {
    props = { ...props, ...next };
    await act(async () => root.render(<RoleMentionProvider value={scope}><RichTextEditor {...props} /></RoleMentionProvider>));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  await render({});
  assert.ok(editor);
  return {
    editor: editor!,
    changes,
    render,
    renderScope:async(value:RoleMentionScope|null)=>{scope=value;await render({});},
    cleanup: async () => {
      await act(async () => root.unmount());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      dom.window.close();
      for (const [name, descriptor] of originals)
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
    },
  };
}

test("mount, readonly transitions and conflict locks do not emit synthetic changes", async () => {
  const f = await fixture("A", { readOnly: true });
  try {
    assert.equal(f.changes.length, 0);
    assert.equal(f.editor.view.dom.getAttribute("contenteditable"), "false");
    await f.render({ readOnly: false });
    assert.equal(f.changes.length, 0);
    await act(async () => {
      f.editor.commands.setTextSelection(1);
      f.editor.commands.insertContent("B");
    });
    assert.equal(f.changes.length, 1);
    await f.render({ conflict: "Versão restaurada" });
    assert.equal(f.changes.length, 1);
    assert.equal(f.editor.view.dom.getAttribute("contenteditable"), "false");
    assert.equal(document.querySelector("textarea")?.value, "BA");
  } finally {
    await f.cleanup();
  }
});

test("delayed own echoes retain the newest draft, selection and editable state", async () => {
  const f = await fixture();
  try {
    await act(async () => {
      f.editor.commands.setTextSelection(1);
      f.editor.commands.insertContent("B");
    });
    const first = f.changes[0];
    await act(async () => {
      f.editor.commands.setTextSelection(2);
      f.editor.commands.insertContent("C");
    });
    const second = f.changes[1],
      selection = f.editor.state.selection.from;
    assert.equal(toPlainText(second), "BCA");
    await f.render({ value: first });
    assert.equal(f.editor.getText(), "BCA");
    assert.equal(f.editor.state.selection.from, selection);
    assert.equal(f.editor.isEditable, true);
    assert.equal(document.querySelector(".orgmap-rich-recovery"), null);
    await f.render({ value: second });
    await f.render({ value: first });
    assert.equal(f.editor.getText(), "BCA");
    assert.equal(f.editor.isEditable, true);
  } finally {
    await f.cleanup();
  }
});

test("incompatible incoming document preserves mounted local draft and structured recovery", async () => {
  const f = await fixture();
  try {
    await act(async () => {
      f.editor.commands.setTextSelection(1);
      f.editor.commands.insertContent("👩🏽‍💻 ");
    });
    const local = f.editor.getJSON(),
      mounted = f.editor.view.dom,
      count = f.changes.length;
    await f.render({
      value: { format: "orgmap-richtext", version: 2, doc: {} } as any,
    });
    assert.equal(f.editor.view.dom, mounted);
    assert.deepEqual(f.editor.getJSON(), local);
    assert.equal(f.editor.isEditable, false);
    assert.equal(f.changes.length, count);
    assert.match(
      document.querySelector('[role="alert"]')!.textContent!,
      /incompatível/,
    );
    assert.equal(document.querySelector("textarea")?.value, "👩🏽‍💻 A");
    assert.match(
      document.querySelector(".orgmap-rich-recovery")!.textContent!,
      /Baixar rascunho com formatação/,
    );
  } finally {
    await f.cleanup();
  }
});

test("clean external replacement starts fresh history; Undo cannot erase confirmed remote text", async () => {
  const f = await fixture("original");
  try {
    await act(async () => {
      f.editor.commands.setTextSelection(9);
      f.editor.commands.insertContent(" local");
    });
    await f.render({ value: f.changes.at(-1)! });
    await f.render({ value: fromPlainText("confirmed remote") });
    assert.equal(f.editor.getText(), "confirmed remote");
    await act(async () => {
      assert.equal(f.editor.commands.undo(), false);
    });
    assert.equal(f.editor.getText(), "confirmed remote");
    assert.equal(f.changes.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("unrelated incoming change with outstanding local edits freezes and retains the draft", async () => {
  const f = await fixture("original");
  try {
    await act(async () => {
      f.editor.commands.setTextSelection(1);
      f.editor.commands.insertContent("local ");
    });
    await f.render({ value: fromPlainText("other session") });
    assert.equal(f.editor.getText(), "local original");
    assert.equal(f.editor.isEditable, false);
    assert.equal(document.querySelector("textarea")?.value, "local original");
  } finally {
    await f.cleanup();
  }
});

const roleA={id:"11111111-1111-4111-8111-111111111111",name:"Acordos"},roleB={id:"22222222-2222-4222-8222-222222222222",name:"Cuidado"};
test("accessible @ selection persists identity, formatting skips atom, rename and revocation change only presentation",async()=>{
 const scope={organizationId:"org-a",roles:[roleA,roleB,{id:"33333333-3333-4333-8333-333333333333",name:"Archived",archived:true}],locale:"pt-BR"};
 const f=await fixture("Consultar @",{},scope);
 try{
  await act(async()=>f.editor.commands.setTextSelection(f.editor.state.doc.content.size-1));
  assert.equal(document.querySelectorAll('[role="option"]').length,2);
  assert.ok(f.editor.view.dom.getAttribute('aria-controls'));
  await act(async()=>{f.editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));});
  await act(async()=>{f.editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  const node=(f.editor.getJSON().content![0].content!).find(n=>n.type==='roleMention')!;
  assert.deepEqual({...node.attrs},{roleId:roleB.id,label:roleB.name});
  await act(async()=>{f.editor.commands.selectAll();f.editor.commands.toggleBold();});
  const result=f.changes.at(-1)!;assert.match(JSON.stringify(result),/bold/);assert.equal(JSON.stringify(result).includes('"type":"roleMention","marks"'),false);
  await f.render({value:result});
  const writes=f.changes.length;
  await f.renderScope({...scope,roles:[roleA,{...roleB,name:'Cuidado renomeado'}]});
  assert.match(f.editor.view.dom.textContent!,/@Cuidado renomeado/);
  assert.equal(f.changes.length,writes);assert.deepEqual(f.editor.getJSON().content![0].content!.find(n=>n.type==='roleMention')!.attrs,node.attrs);
  await f.renderScope({...scope,roles:[roleA]});
  assert.match(f.editor.view.dom.textContent!,/@Papel indisponível/);assert.doesNotMatch(f.editor.view.dom.textContent!,/Cuidado/);
 }finally{await f.cleanup();}
});
test("Escape preserves literal @ and does not close parent; HTML cannot forge identity",async()=>{
 const f=await fixture("@",{},{organizationId:'org',roles:[roleA]});
 try{
  await act(async()=>f.editor.commands.setTextSelection(2));
  assert.equal(document.querySelectorAll('[role="option"]').length,1);
  await act(async()=>f.editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  assert.equal(document.querySelector('[role="listbox"]'),null);assert.equal(f.editor.getText(),'@');
  await act(async()=>f.editor.commands.setContent('<p><span data-role-id="'+roleB.id+'">@Cuidado</span></p>'));
  assert.doesNotMatch(JSON.stringify(f.editor.getJSON()),/roleMention/);assert.equal(f.editor.getText(),'@Cuidado');
 }finally{await f.cleanup();}
});

/** Focused DOM unit tests (jsdom), not browser/CUA or server persistence evidence. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import * as Y from "yjs";
import { richEditorExtensions } from "../../web/src/editor/extensions.ts";
import {
  fromPlainText,
  toPlainText,
  validateRichDocument,
} from "../../packages/content/index.ts";
import {
  createRichYDoc,
  readRichYDoc,
  RICH_TEXT_FRAGMENT,
  validateRichUpdate,
} from "../../packages/content/collaboration.ts";

function environment() {
  const dom = new JSDOM("<!doctype html><body></body>", {
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
  return () => {
    dom.window.close();
    for (const [name, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
  };
}
function editor(content = "Base") {
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({
    element,
    extensions: richEditorExtensions(),
    content: fromPlainText(content).doc,
  });
}

test("real ProseMirror DOM commands retain Unicode, lists, links, marks and standalone undo/redo", () => {
  const cleanup = environment(),
    e = editor("Olá 👩🏽‍💻");
  try {
    e.commands.selectAll();
    e.commands.toggleBold();
    e.commands.toggleItalic();
    e.commands.toggleUnderline();
    e.commands.toggleStrike();
    e.commands.setLink({ href: "https://example.org/referencia" });
    e.commands.toggleOrderedList();
    assert.match(e.getHTML(), /<ol>/);
    assert.match(e.getHTML(), /<strong>/);
    assert.match(e.getHTML(), /<u>/);
    assert.match(e.getHTML(), /href="https:\/\/example.org\/referencia"/);
    assert.equal(e.commands.undo(), true);
    assert.doesNotMatch(e.getHTML(), /<ol>/);
    assert.equal(e.commands.redo(), true);
    assert.match(e.getHTML(), /<ol>/);
    assert.equal(
      toPlainText(
        validateRichDocument({
          format: "orgmap-richtext",
          version: 1,
          doc: e.getJSON(),
        }),
      ),
      "Olá 👩🏽‍💻",
    );
  } finally {
    e.destroy();
    cleanup();
  }
});

test("transaction guard refuses unsafe marks and oversized input even through programmatic commands", () => {
  const cleanup = environment(),
    e = editor("confirmed");
  try {
    e.commands.selectAll();
    e.commands.setMark("link", { href: "javascript:alert(1)" });
    assert.doesNotMatch(e.getHTML(), /javascript/);
    assert.equal(e.getText(), "confirmed");
    e.commands.insertContent("x".repeat(200_001));
    assert.equal(e.getText(), "confirmed");
    e.setEditable(false);
    assert.equal(e.view.dom.getAttribute("contenteditable"), "false");
    e.setEditable(true);
    assert.equal(e.view.dom.getAttribute("contenteditable"), "true");
  } finally {
    e.destroy();
    cleanup();
  }
});

test("two live editors bind initialized fragments; local Yjs undo does not undo remote confirmed work", () => {
  const cleanup = environment(),
    a = createRichYDoc(fromPlainText("Base")),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  let durable = Y.encodeStateAsUpdate(a);
  const updates: Uint8Array[] = [];
  const connect = (from: Y.Doc, to: Y.Doc) =>
    from.on("update", (u, origin) => {
      if (origin === "remote") return;
      const candidate = validateRichUpdate(durable, u);
      durable = candidate.snapshot;
      updates.push(u);
      Y.applyUpdate(to, u, "remote");
    });
  connect(a, b);
  connect(b, a);
  const elementA = document.createElement("div"),
    elementB = document.createElement("div");
  document.body.append(elementA, elementB);
  const ea = new Editor({
    element: elementA,
    extensions: richEditorExtensions({
      fragment: a.getXmlFragment(RICH_TEXT_FRAGMENT),
    }),
  });
  const eb = new Editor({
    element: elementB,
    extensions: richEditorExtensions({
      fragment: b.getXmlFragment(RICH_TEXT_FRAGMENT),
    }),
  });
  try {
    assert.equal(ea.getText(), "Base");
    assert.equal(eb.getText(), "Base");
    ea.commands.setTextSelection(1);
    ea.commands.insertContent("A 👩🏽‍💻 ");
    eb.commands.setTextSelection(eb.state.doc.content.size - 1);
    eb.commands.insertContent(" B 漢字");
    assert.equal(ea.getText(), eb.getText());
    assert.match(ea.getText(), /A 👩🏽‍💻/);
    assert.match(ea.getText(), /B 漢字/);
    ea.commands.undo();
    assert.equal(ea.getText(), eb.getText());
    assert.doesNotMatch(ea.getText(), /A 👩🏽‍💻/);
    assert.match(ea.getText(), /B 漢字/);
    ea.commands.redo();
    assert.match(ea.getText(), /A 👩🏽‍💻/);
    assert.equal(toPlainText(readRichYDoc(a)), toPlainText(readRichYDoc(b)));
    assert.ok(updates.length >= 4);
    ea.commands.selectAll();
    ea.commands.toggleBulletList();
    assert.deepEqual(readRichYDoc(a), readRichYDoc(b));
    assert.equal(readRichYDoc(a).doc.content[0].type, "bulletList");
  } finally {
    ea.destroy();
    eb.destroy();
    a.destroy();
    b.destroy();
    cleanup();
  }
});


test("per-field rich limit keeps the prior document and counts Unicode code points",()=>{
 const cleanup=environment();const element=document.createElement('div');document.body.append(element);
 const e=new Editor({element,extensions:richEditorExtensions({maxLength:3}),content:fromPlainText('AB').doc});
 try{e.commands.setTextSelection(3);e.commands.insertContent('🌿');assert.equal(e.getText(),'AB🌿');e.commands.insertContent('X');assert.equal(e.getText(),'AB🌿');}finally{e.destroy();cleanup();}
});

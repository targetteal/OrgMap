import { strict as assert } from "node:assert";
import { test } from "node:test";
import { clearDraft, readDraft, writeDraft } from "./drafts";

test("drafts stay separated by key and survive until explicitly cleared", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {configurable:true, value:{getItem:(k:string)=>values.get(k) ?? null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
  writeDraft("org-a:project", "primeiro"); writeDraft("org-b:project", "segundo");
  assert.equal(readDraft("org-a:project"), "primeiro");
  clearDraft("org-a:project");
  assert.equal(readDraft("org-a:project"), null); assert.equal(readDraft("org-b:project"), "segundo");
  Object.defineProperty(globalThis, "localStorage", {configurable:true, get(){throw Error("storage blocked");}});
  assert.doesNotThrow(()=>writeDraft("x","texto")); assert.equal(readDraft("x"),null);
  delete (globalThis as {localStorage?: Storage}).localStorage;
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { graphScene, ancestorIds } from "../src/graph-layout.ts";
const nodes = [
  {
    nodeId: "r",
    entityId: "org-circle",
    kind: "CIRCLE" as const,
    parentNodeId: null,
    name: "Raiz",
    version: 1,
  },
  {
    nodeId: "c",
    entityId: "child-circle",
    kind: "CIRCLE" as const,
    parentNodeId: "r",
    name: "Filho",
    version: 1,
  },
  {
    nodeId: "p",
    entityId: "role",
    kind: "ROLE" as const,
    parentNodeId: "c",
    name: "Papel",
    version: 1,
  },
];
test("three scene modes retain dynamic identities and graph edges", () => {
  for (const mode of ["pack", "hierarchy", "network"] as const) {
    const scene = graphScene(nodes, mode);
    assert.equal(scene.nodes.length, 3);
    assert.equal(new Set(scene.nodes.map((n) => n.nodeId)).size, 3);
    assert.ok(
      scene.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
    );
    if (mode !== "pack") assert.equal(scene.links.length, 2);
  }
});
test("hierarchy collapse removes only descendants and small graphs keep readable card scale", () => {
  const scene = graphScene(nodes, "hierarchy", new Set(["c"]));
  assert.deepEqual(
    new Set(scene.nodes.map((n) => n.nodeId)),
    new Set(["r", "c"]),
  );
  assert.ok(scene.bounds.width >= 400);
  assert.ok(scene.bounds.height >= 200);
});
test("filter ancestry retains graph context and terminates for orphan IDs", () => {
  assert.deepEqual(
    ancestorIds(nodes, new Set(["p"])),
    new Set(["p", "c", "r"]),
  );
  assert.deepEqual(
    ancestorIds(nodes, new Set(["missing"])),
    new Set(["missing"]),
  );
});

test("all authorized disconnected roots survive every graph mode without an invented visible ancestor", () => {
 const forest = [nodes[1],nodes[2],{...nodes[0],nodeId:'other',entityId:'shared-other',parentNodeId:'hidden-parent'}];
 for(const mode of ['pack','hierarchy','network'] as const){
  const scene=graphScene(forest,mode);
  assert.deepEqual(new Set(scene.nodes.map(n=>n.nodeId)),new Set(['c','p','other']));
  assert.equal(scene.nodes.find(n=>n.nodeId==='c')?.depth,0);
  assert.equal(scene.nodes.find(n=>n.nodeId==='other')?.depth,0);
  assert.ok(scene.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
  assert.equal(scene.links.length,mode==='pack'?0:1);
  const collapsed=graphScene(forest,mode,new Set(['c']));
  if(mode!=='pack') assert.deepEqual(new Set(collapsed.nodes.map(n=>n.nodeId)),new Set(['c','other']));
 }
});

import {structureReturnPath} from '../src/model.ts';
test('structure detail return retains only a local recognized graph mode',()=>{
 assert.equal(structureReturnPath('/structure?view=network'),'/structure?view=network');
 assert.equal(structureReturnPath('/structure?view=network&savedView=11111111-1111-4111-8111-111111111111&secret=drop'),'/structure?view=network&savedView=11111111-1111-4111-8111-111111111111');
 assert.equal(structureReturnPath('/structure?view=pack&savedView=invalid'),'/structure?view=pack');
 assert.equal(structureReturnPath('/structure/directory?viewId=test-1&secret=discarded'),'/structure/directory?viewId=test-1');
 assert.equal(structureReturnPath('/structure?view=hierarchy&secret=discarded#other'),'/structure?view=hierarchy');
 for(const unsafe of ['//evil.test/structure','https://evil.test/structure','/account','/structure?view=unknown','/\\evil.test/structure',null]) assert.equal(structureReturnPath(unsafe),'/structure');
});

test("packed direct children stay inside parents and never overlap across varied hierarchies", () => {
 const many=[nodes[0],...Array.from({length:8},(_,i)=>({...nodes[1],nodeId:`c${i}`,entityId:`circle${i}`,parentNodeId:'r'})),...Array.from({length:176},(_,i)=>({...nodes[2],nodeId:`p${i}`,entityId:`role${i}`,parentNodeId:i<32?'r':`c${i%8}`}))];
 const placed=graphScene(many,'pack').nodes;
 assert.equal(placed.length,many.length);
 for(const parent of placed){ const children=placed.filter(n=>n.parentNodeId===parent.nodeId); for(const [index,a] of children.entries()){assert.ok(Math.hypot(a.x-parent.x,a.y-parent.y)+a.r<=parent.r+1e-6);for(const b of children.slice(index+1))assert.ok(Math.hypot(a.x-b.x,a.y-b.y)+1e-6>=a.r+b.r,`${a.nodeId} overlaps ${b.nodeId}`);}}
 const direct=placed.filter(n=>n.parentNodeId==='r'&&n.kind==='ROLE');assert.ok(direct.every(n=>n.r>0));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { packedNodes, safeDestination } from "../src/model.ts";
test("layout accepts arbitrary topology, names and separate node/entity IDs", () => {
  const nodes = [
    {
      nodeId: "n-root",
      entityId: "circle-a",
      kind: "CIRCLE" as const,
      parentNodeId: null,
      name: "Nova organização",
      version: 1,
    },
    {
      nodeId: "n-child",
      entityId: "circle-b",
      kind: "CIRCLE" as const,
      parentNodeId: "n-root",
      name: "Outro círculo",
      version: 1,
    },
    {
      nodeId: "n-role",
      entityId: "role-c",
      kind: "ROLE" as const,
      parentNodeId: "n-child",
      name: "Papel com nome longo",
      version: 2,
    },
  ];
  const result = packedNodes(nodes);
  assert.equal(result.length, 3);
  const root = result.find((n) => n.entityId === "circle-a")!,
    role = result.find((n) => n.entityId === "role-c")!;
  assert.equal(role.depth, 2);
  assert.ok(
    Math.hypot(role.x - root.x, role.y - root.y) + role.r <= root.r + 0.01,
  );
  assert.deepEqual(packedNodes([]), []);
});
test("return destination cannot become external or remain on auth root", () => {
  for (const path of [
    "//external.test",
    "https://external.test",
    "/login",
    "/register",
    "/",
  ])
    assert.equal(safeDestination(path), "/structure");
  assert.equal(safeDestination("/members"), " /members".trim());
});

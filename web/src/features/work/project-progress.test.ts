import { strict as assert } from "node:assert";
import { test } from "node:test";
import { projectProgress } from "./project-progress";

test("project progress counts distinct parent and subtask records, without completing the parent", () => {
  const parent = { id: "parent", projectId: "p", status: "IN_PROGRESS" };
  const child = { id: "child", projectId: "p", status: "DONE" };
  assert.deepEqual(projectProgress([parent, child, child, { id: "other", projectId: "q", status: "DONE" }], "p"), { total: 2, done: 1 });
  assert.deepEqual(projectProgress([parent, child], "empty"), { total: 0, done: 0 });
});

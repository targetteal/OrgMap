/** Counts each visible active task and subtask once; checklist items are not tasks. */
export function projectProgress<T extends { id: string; projectId: string | null; status: string }>(tasks: T[], projectId: string) {
  const unique = new Map(tasks.filter((task) => task.projectId === projectId).map((task) => [task.id, task]));
  const items = [...unique.values()];
  return { total: items.length, done: items.filter((task) => task.status === "DONE").length };
}

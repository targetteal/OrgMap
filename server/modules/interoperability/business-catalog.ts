import { Ajv, type ValidateFunction } from "ajv";
import { fail } from "../../src/core.js";
export type BusinessCommand = {
  name: string;
  scope: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  inputSchema: Record<string, unknown>;
  build: (input: Record<string, any>) => {
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  };
};
const uuid = { type: "string", format: "uuid" },
  name = { type: "string", minLength: 1, maxLength: 200 },
  long = { type: "string", maxLength: 10000 },
  version = { type: "integer", minimum: 1 },
  key = { type: "string", minLength: 1, maxLength: 200 };
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const pick = (a: Record<string, any>, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]),
  );
const commands: BusinessCommand[] = [];
function add(command: BusinessCommand) {
  commands.push(command);
}
function read(
  n: string,
  scope: string,
  path: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) {
  add({
    name: n,
    scope,
    method: "GET",
    path,
    inputSchema: object(properties, required),
    build: () => ({}),
  });
}
add({
  name: "orgmap_structure_list",
  scope: "structure.read",
  method: "GET",
  path: "/structure",
  inputSchema: object({
    rootCircleId: uuid,
    depth: { type: "integer", minimum: 1, maximum: 50 },
  }),
  build: (a) => ({ query: pick(a, ["rootCircleId", "depth"]) }),
});
for (const [kind, parent] of [
  ["circle", "parentCircleId"],
  ["role", "circleId"],
]) {
  const plural = kind + "s";
  read(
    "orgmap_" + kind + "_get",
    "structure.read",
    "/" + plural + "/:entityId",
    { entityId: uuid },
    ["entityId"],
  );
  add({
    name: "orgmap_" + kind + "_create",
    scope: "structure.create",
    method: "POST",
    path: "/" + plural,
    inputSchema: object(
      { [parent]: uuid, name, purpose: long, idempotencyKey: key },
      [parent, "name", "idempotencyKey"],
    ),
    build: (a) => ({
      body: { ...pick(a, [parent, "name", "purpose"]), mode: "DIRECT" },
    }),
  });
  add({
    name: "orgmap_" + kind + "_update",
    scope: "structure.update",
    method: "PATCH",
    path: "/" + plural + "/:entityId",
    inputSchema: object({ entityId: uuid, name, purpose: long, version }, [
      "entityId",
      "version",
    ]),
    build: (a) => ({
      body: { ...pick(a, ["name", "purpose"]), mode: "DIRECT" },
    }),
  });
}
add({
  name: "orgmap_structure_move",
  scope: "structure.move",
  method: "POST",
  path: "/structure/:entityId/move",
  inputSchema: object(
    { entityId: uuid, targetCircleId: uuid, version, idempotencyKey: key },
    ["entityId", "targetCircleId", "version", "idempotencyKey"],
  ),
  build: (a) => ({
    body: { targetCircleId: a.targetCircleId, mode: "DIRECT" },
  }),
});
add({
  name: "orgmap_structure_archive",
  scope: "structure.archive",
  method: "POST",
  path: "/structure/:entityId/archive",
  inputSchema: object({ entityId: uuid, version, idempotencyKey: key }, [
    "entityId",
    "version",
    "idempotencyKey",
  ]),
  build: () => ({ body: {} }),
});
read("orgmap_members_list", "members.read", "/members");
read("orgmap_projects_list", "work.read", "/work/projects");
read(
  "orgmap_project_get",
  "work.read",
  "/work/projects/:projectId",
  { projectId: uuid },
  ["projectId"],
);
read("orgmap_tasks_list", "work.read", "/work/tasks");
read("orgmap_task_get", "work.read", "/work/tasks/:taskId", { taskId: uuid }, [
  "taskId",
]);
read("orgmap_goals_list", "goals.read", "/goals");
read("orgmap_goal_get", "goals.read", "/goals/:goalId", { goalId: uuid }, [
  "goalId",
]);
read("orgmap_meetings_list", "meetings.read", "/meetings");
read(
  "orgmap_meeting_get",
  "meetings.read",
  "/meetings/:meetingId",
  { meetingId: uuid },
  ["meetingId"],
);
for (const family of ["tensions", "proposals", "documents"])
  read("orgmap_" + family + "_list", "governance.read", "/" + family);
add({
  name: "orgmap_tension_create",
  scope: "governance.tension.create",
  method: "POST",
  path: "/tensions",
  inputSchema: object(
    { title: name, description: long, circleId: uuid, idempotencyKey: key },
    ["title", "circleId", "idempotencyKey"],
  ),
  build: (a) => ({ body: pick(a, ["title", "description", "circleId"]) }),
});
add({
  name: "orgmap_tension_close",
  scope: "governance.tension.close",
  method: "POST",
  path: "/tensions/:id/actions/close",
  inputSchema: object({ id: uuid, version, idempotencyKey: key }, [
    "id",
    "version",
    "idempotencyKey",
  ]),
  build: () => ({ body: {} }),
});
add({
  name: "orgmap_project_create",
  scope: "work.project.create",
  method: "POST",
  path: "/work/projects",
  inputSchema: object(
    {
      title: name,
      description: long,
      visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"] },
      circleId: uuid,
      idempotencyKey: key,
    },
    ["title", "idempotencyKey"],
  ),
  build: (a) => ({
    body: pick(a, ["title", "description", "visibility", "circleId"]),
  }),
});
add({
  name: "orgmap_task_create",
  scope: "work.task.create",
  method: "POST",
  path: "/work/tasks",
  inputSchema: object(
    {
      title: name,
      description: long,
      projectId: uuid,
      sectionId: uuid,
      parentId: uuid,
      idempotencyKey: key,
    },
    ["title", "idempotencyKey"],
  ),
  build: (a) => ({
    body: pick(a, [
      "title",
      "description",
      "projectId",
      "sectionId",
      "parentId",
    ]),
  }),
});
add({
  name: "orgmap_task_update",
  scope: "work.task.update",
  method: "PATCH",
  path: "/work/tasks/:taskId",
  inputSchema: object(
    {
      taskId: uuid,
      title: name,
      description: long,
      status: {
        type: "string",
        enum: ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"],
      },
      version,
    },
    ["taskId", "version"],
  ),
  build: (a) => ({ body: pick(a, ["title", "description", "status"]) }),
});
add({
  name: "orgmap_goal_create",
  scope: "goals.create",
  method: "POST",
  path: "/goals",
  inputSchema: object(
    {
      title: name,
      description: long,
      ownerType: { type: "string", enum: ["CIRCLE", "ROLE", "MEMBER"] },
      ownerId: uuid,
      periodIds: {
        type: "array",
        items: uuid,
        maxItems: 100,
        uniqueItems: true,
      },
      privacy: { type: "string", enum: ["PUBLIC", "PRIVATE"] },
      idempotencyKey: key,
    },
    ["title", "ownerType", "ownerId", "periodIds", "idempotencyKey"],
  ),
  build: (a) => ({
    body: pick(a, [
      "title",
      "description",
      "ownerType",
      "ownerId",
      "periodIds",
      "privacy",
    ]),
  }),
});
add({
  name: "orgmap_goal_progress_record",
  scope: "goals.progress.record",
  method: "POST",
  path: "/goals/:goalId/progress",
  inputSchema: object(
    {
      goalId: uuid,
      value: {
        type: "string",
        pattern: "^(?:100(?:\\.0{1,6})?|(?:0|[1-9]\\d?)(?:\\.\\d{1,6})?)$",
        description:
          "Decimal string from 0 to 100, at most six decimal places.",
      },
      comment: { type: "string", maxLength: 1000 },
      version,
      idempotencyKey: key,
    },
    ["goalId", "value", "version", "idempotencyKey"],
  ),
  build: (a) => ({ body: pick(a, ["value", "comment"]) }),
});
for (const action of ["start", "close"])
  add({
    name: "orgmap_meeting_" + action,
    scope: "meetings." + action,
    method: "POST",
    path: "/meetings/:meetingId/actions/" + action,
    inputSchema: object({ meetingId: uuid, version, idempotencyKey: key }, [
      "meetingId",
      "version",
      "idempotencyKey",
    ]),
    build: () => ({ body: {} }),
  });
read("orgmap_goal_periods_list", "goals.read", "/goal-periods");
add({
  name: "orgmap_goal_period_create",
  scope: "goals.period.create",
  method: "POST",
  path: "/goal-periods",
  inputSchema: object(
    {
      title: name,
      startsOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      endsOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      idempotencyKey: key,
    },
    ["title", "startsOn", "endsOn", "idempotencyKey"],
  ),
  build: (a) => ({ body: pick(a, ["title", "startsOn", "endsOn"]) }),
});
add({
  name: "orgmap_meeting_schedule",
  scope: "meetings.schedule",
  method: "POST",
  path: "/meeting-series",
  inputSchema: object(
    {
      title: name,
      circleId: uuid,
      localStart: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
      },
      timeZone: { type: "string", minLength: 1, maxLength: 100 },
      durationMinutes: { type: "integer", minimum: 1, maximum: 10080 },
      frequency: { type: "string", enum: ["DAILY", "WEEKLY", "MONTHLY"] },
      count: { type: "integer", minimum: 1, maximum: 100 },
      idempotencyKey: key,
    },
    [
      "title",
      "circleId",
      "localStart",
      "timeZone",
      "durationMinutes",
      "frequency",
      "count",
      "idempotencyKey",
    ],
  ),
  build: (a) => ({
    body: {
      ...pick(a, [
        "title",
        "circleId",
        "localStart",
        "timeZone",
        "durationMinutes",
      ]),
      recurrence: { frequency: a.frequency, count: a.count },
      sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
      policy: {},
    },
  }),
});
const decimal = {
    type: "string",
    pattern: "^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,6})?$",
  },
  weighted = object(
    { id: uuid, weight: decimal, excluded: { type: "boolean" } },
    ["id", "weight", "excluded"],
  );
add({
  name: "orgmap_goal_progress_configure",
  scope: "goals.progress.configure",
  method: "POST",
  path: "/goals/:goalId/progress-config",
  inputSchema: object(
    {
      goalId: uuid,
      version,
      idempotencyKey: key,
      source: {
        type: "string",
        enum: ["MANUAL", "KEY_RESULTS", "CHILD_GOALS", "BOTH"],
      },
      manualProgress: decimal,
      krWeight: decimal,
      childWeight: decimal,
      keyResults: { type: "array", items: weighted, maxItems: 1000 },
      children: { type: "array", items: weighted, maxItems: 1000 },
    },
    [
      "goalId",
      "version",
      "idempotencyKey",
      "source",
      "manualProgress",
      "krWeight",
      "childWeight",
      "keyResults",
      "children",
    ],
  ),
  build: (a) => ({
    body: pick(a, [
      "source",
      "manualProgress",
      "krWeight",
      "childWeight",
      "keyResults",
      "children",
    ]),
  }),
});
export const businessCommands = commands as readonly BusinessCommand[];
export const businessScopes = [...new Set(commands.map((c) => c.scope))];
export function businessCommand(name: string) {
  return commands.find((c) => c.name === name);
}
const ajv = new Ajv({
  strict: true,
  allErrors: false,
  coerceTypes: false,
  removeAdditional: false,
});
ajv.addFormat(
  "uuid",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);
const validators = new Map<string, ValidateFunction>();
for (const command of commands)
  validators.set(command.name, ajv.compile(command.inputSchema));
export function validateBusinessInput(
  command: BusinessCommand,
  input: unknown,
): asserts input is Record<string, any> {
  if (!validators.get(command.name)!(input))
    fail(400, "INVALID_COMMAND_ARGUMENTS");
}
export function commandForHttp(
  method: string,
  path: string,
  organizationId: string,
) {
  const prefix = "/api/v1/organizations/" + organizationId;
  if (!path.startsWith(prefix + "/")) return undefined;
  const relative = path.slice(prefix.length).split("?")[0];
  return commands.find(
    (command) =>
      command.method === method &&
      new RegExp(
        "^" +
          command.path
            .split("/")
            .map((segment) =>
              segment.startsWith(":") ? "[0-9a-fA-F-]{36}" : segment,
            )
            .join("/") +
          "$",
      ).test(relative),
  );
}

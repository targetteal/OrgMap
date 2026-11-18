import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { FeatureContext } from "../../web/src/feature-contract.js";
import {
  workLocales,
  workTranslator,
} from "../../web/src/features/work/messages.js";
const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  { url: "http://work.localhost" },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Event",
  "Node",
  "DOMParser",
  "FormData",
])
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom.window : (dom.window as any)[key],
    configurable: true,
  });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
const { createRoot } = await import("react-dom/client");
const { LocalizationProvider } =
  await import("../../web/src/localization/index.js");
const { feature } = await import("../../web/src/features/work/index.js");
const { TaskPropertiesFields, TaskPropertiesView, taskPropertiesPayload } =
  await import("../../web/src/features/work/task-properties.js");
const { TaskAssigneesView, TaskAssignmentsEditor, taskAssignedToMember } =
  await import("../../web/src/features/work/task-assignments.js");
test("ROLE editor sends typed references, shows vacancy/current people and preserves unavailable roles from legacy clearing", async () => {
  const container = dom.window.document.querySelector("main")!,
    roleId = "00000000-0000-4000-8000-000000000001",
    memberId = "00000000-0000-4000-8000-000000000002";
  const context = {
    members: [
      {
        id: memberId,
        displayName: "Média",
        status: "ACTIVE",
        memberType: "MEMBER",
      },
    ],
    structure: { nodes: [{ kind: "ROLE", entityId: roleId, name: "Lista" }] },
  } as unknown as FeatureContext;
  const value = {
    principals: [{ kind: "ROLE" as const, roleId }],
    resolvedAssignees: [
      { memberId, reasons: [{ kind: "ROLE_CAPACITY" as const, roleId }] },
    ],
    roleCapacities: [
      {
        roleId,
        state: "OCCUPIED" as const,
        eligibleCount: 1,
        occupantCount: 2,
      },
    ],
  };
  for (const locale of workLocales) {
    const text = workTranslator(locale),
      root = createRoot(container);
    let saved: unknown;
    try {
      await act(async () =>
        root.render(
          <LocalizationProvider preferences={{ locale }}>
            <TaskAssigneesView context={context} value={value} />
            <TaskAssignmentsEditor
              context={context}
              value={value}
              roleEnabled
              pending={false}
              onSave={async (principals) => {
                saved = principals;
              }}
            />
          </LocalizationProvider>,
        ),
      );
      assert.equal(container.querySelector("strong")!.textContent, "Lista");
      assert.ok(container.textContent!.includes("Média"));
      assert.equal(taskAssignedToMember(value, memberId), true);
      assert.equal(
        taskAssignedToMember(
          { ...value, resolvedAssignees: [], assigneeIds: [memberId] },
          memberId,
        ),
        false,
      );
      const select = container.querySelector("select")!;
      assert.ok(
        [...select.selectedOptions].some(
          (option) => option.value === "ROLE:" + roleId,
        ),
      );
      await act(async () =>
        container
          .querySelector("form")!
          .dispatchEvent(
            new dom.window.Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      assert.deepEqual(saved, [{ kind: "ROLE", roleId }]);
      await act(async () =>
        root.render(
          <LocalizationProvider preferences={{ locale }}>
            <TaskAssigneesView
              context={context}
              value={{
                ...value,
                resolvedAssignees: [],
                roleCapacities: [
                  {
                    roleId,
                    state: "VACANT",
                    occupantCount: 0,
                    eligibleCount: 0,
                  },
                ],
              }}
            />
            <TaskAssignmentsEditor
              context={context}
              value={value}
              roleEnabled={false}
              pending={false}
              onSave={async () => {}}
            />
          </LocalizationProvider>,
        ),
      );
      assert.ok(container.textContent!.includes(text("Sem ocupantes atuais")));
      assert.equal(container.querySelector("fieldset")!.disabled, true);
      await act(async () =>
        root.render(
          <LocalizationProvider preferences={{ locale }}>
            <TaskAssigneesView context={context} value={value} guest />
          </LocalizationProvider>,
        ),
      );
      assert.equal(
        container.textContent,
        text("Identidades não compartilhadas"),
      );
    } finally {
      await act(async () => root.unmount());
    }
  }
});
test("task property controls preserve zero and literal tags, translate metadata, and disable pending edits", async () => {
  const container = dom.window.document.querySelector("main")!,
    value = {
      priority: "HIGH",
      estimateMinutes: 0,
      tags: ["Alta", "<script>literal</script>"],
    };
  for (const locale of workLocales) {
    const text = workTranslator(locale),
      root = createRoot(container);
    const render = (pending = false) => (
      <LocalizationProvider preferences={{ locale }}>
        <dl>
          <TaskPropertiesView value={value} />
        </dl>
        <form>
          <TaskPropertiesFields value={value} pending={pending} />
        </form>
      </LocalizationProvider>
    );
    try {
      await act(async () => root.render(render()));
      assert.equal(container.querySelector("dd")!.textContent, text("Alta"));
      assert.deepEqual(
        [...container.querySelectorAll(".work-tags li")].map(
          (el) => el.textContent,
        ),
        value.tags,
      );
      assert.equal(container.querySelectorAll("script").length, 0);
      assert.deepEqual(
        taskPropertiesPayload(
          new dom.window.FormData(
            container.querySelector("form")!,
          ) as unknown as FormData,
        ),
        value,
      );
      const estimate = container.querySelector<HTMLInputElement>(
        "input[name=estimateMinutes]",
      )!;
      estimate.value = "525601";
      assert.equal(estimate.checkValidity(), false);
      await act(async () => root.render(render(true)));
      assert.equal(container.querySelector("fieldset")!.disabled, true);
      assert.equal(
        container.querySelectorAll(
          "fieldset input:enabled,fieldset select:enabled,fieldset textarea:enabled",
        ).length,
        0,
      );
    } finally {
      await act(async () => root.unmount());
    }
  }
});
test("Work translates collection controls and enum labels in eight locales while user content stays literal", async () => {
  const project = {
      id: "project-literal",
      title: "Lista",
      description: "Concluída",
      visibility: "PUBLIC",
      views: ["LIST", "BOARD", "TIMELINE", "CALENDAR"],
    },
    task = {
      id: "task-literal",
      title: "Concluída",
      projectId: project.id,
      status: "TODO",
      startsAt: null,
      endsAt: null,
      assigneeIds: [],
    },
    container = dom.window.document.querySelector("main")!;
  const api = async (path: string) => {
    if (path.endsWith("/projects")) return { data: { projects: [project] } };
    if (path.endsWith("/tasks")) return { data: { tasks: [task] } };
    throw new Error("Unexpected request: " + path);
  };
  for (const locale of workLocales) {
    const text = workTranslator(locale),
      root = createRoot(container),
      Component = feature.Component,
      Sidebar = feature.sidebar!,
      context = {
        organizationId: "synthetic",
        path: "/projects/tasks",
        bootstrap: { membership: { id: "guest", memberType: "GUEST" } },
        members: [],
        structure: { nodes: [], occupancies: [] },
        api,
        navigate: () => {},
        notify: () => {},
      } as unknown as FeatureContext;
    try {
      await act(async () =>
        root.render(
          <LocalizationProvider preferences={{ locale }}>
            <Sidebar context={context} />
            <Component context={context} />
          </LocalizationProvider>,
        ),
      );
      assert.equal(
        container.querySelector(".page-heading h2")!.textContent,
        text("Tarefas compartilhadas"),
      );
      assert.equal(
        container
          .querySelector("input[type=search],input[aria-label]")!
          .getAttribute("aria-label"),
        text("Pesquisar tarefas"),
      );
      assert.equal(
        container.querySelector(".work-task-name")!.textContent,
        "Concluída",
      );
      assert.equal(
        container.querySelector("tbody tr td:last-child")!.textContent,
        text("A fazer"),
      );
      assert.ok(
        [...container.querySelectorAll("button")].some(
          (button) => button.textContent === "Lista",
        ),
        "project title is literal even when it matches a product message",
      );
      assert.ok(
        ![...container.querySelectorAll("button")].some(
          (button) => button.textContent === text("Adicionar tarefa"),
        ),
        "Guest has no create control",
      );
      await act(async () =>
        root.render(
          <LocalizationProvider preferences={{ locale }}>
            <Component context={{ ...context, path: "/projects" }} />
          </LocalizationProvider>,
        ),
      );
      assert.equal(
        container.querySelector(".page-heading h2")!.textContent,
        text("Todos os projetos"),
      );
      assert.equal(
        container.querySelector(".work-project-open strong")!.textContent,
        "Lista",
      );
      assert.ok(
        container
          .querySelector(".work-projects")!
          .textContent!.includes("Concluída"),
        "project description is literal",
      );
    } finally {
      await act(async () => root.unmount());
    }
  }
});

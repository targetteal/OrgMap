import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { FeatureContext } from "../../feature-contract";
import { fromPlainText } from "../../../../packages/content/index.js";
import { agendaMessages, agendaTranslator } from "./agenda-messages";
import { SUPPORTED_LOCALES } from "../../../../packages/i18n/index.js";

const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  {
    url: "http://agenda.localhost",
    pretendToBeVisual: true,
  },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLDialogElement",
  "Event",
  "Node",
  "DOMParser",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
])
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom.window : (dom.window as any)[key],
    configurable: true,
  });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
registerHooks({
  load(url, options, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "export {};", shortCircuit: true }
      : next(url, options);
  },
});
const { createRoot } = await import("react-dom/client");
const { LocalizationProvider } = await import("../../localization/index.js");
const { AgendaItemsView } = await import("./agenda-items-view.js");
type AgendaResult = import("./agenda-items-view.js").AgendaResult;
const container = dom.window.document.querySelector("main")!;
const text = agendaTranslator("en-US");
function item(id = "item-1"): AgendaResult {
  return {
    item: {
      id,
      title: "A literal item",
      descriptionRich: fromPlainText("Original description"),
      state: "PARKED",
      ownerId: "member",
      circleId: null,
      expectedDurationMinutes: null,
      version: 1,
      identityCoverage: "NATIVE",
    },
    capabilities: {
      edit: true,
      schedule: true,
      reschedule: false,
      unschedule: false,
      archive: true,
      adopt: false,
    },
    coverage: { identityCoverage: "NATIVE", historyRedacted: false },
  };
}
function context(api: unknown, guest = false): FeatureContext {
  return {
    organizationId: "organization",
    path: "/meetings/agenda-items",
    bootstrap: {
      membership: { id: "member", memberType: guest ? "GUEST" : "MEMBER" },
    },
    members: [
      {
        id: "member",
        displayName: "Active member",
        memberType: "MEMBER",
        status: "ACTIVE",
      },
      {
        id: "guest",
        displayName: "Guest must not be selectable",
        memberType: "GUEST",
        status: "ACTIVE",
      },
      {
        id: "inactive",
        displayName: "Inactive must not be selectable",
        memberType: "MEMBER",
        status: "INACTIVE",
      },
    ],
    structure: {
      circles: [{ id: "circle", nodeId: "circle-node" }],
      nodes: [
        {
          entityId: "circle",
          nodeId: "circle-node",
          name: "Literal circle",
          kind: "CIRCLE",
        },
      ],
    },
    api,
    navigate: () => {},
    notify: () => {},
  } as unknown as FeatureContext;
}
function platformResponse(path: string) {
  if (!path.includes("/resources/")) return null;
  return {
    data: path.endsWith("/capabilities")
      ? { actions: {}, favorite: false, following: false, exportKinds: [] }
      : { items: [], capabilities: { read: false, comment: false } },
  };
}
async function click(label: string, scope: ParentNode = container) {
  const button = [...scope.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  assert.ok(button, `Missing button: ${label}`);
  await act(async () => {
    button.click();
  });
}
async function setValue(selector: string, value: string) {
  const element = container.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(selector)!;
  assert.ok(element, `Missing control: ${selector}`);
  await act(async () => {
    const prototype = Object.getPrototypeOf(element);
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new dom.window.Event(
        element instanceof dom.window.HTMLSelectElement ? "change" : "input",
        { bubbles: true },
      ),
    );
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector("dialog form")!
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
}

test("agenda catalogs cover eight locales with parameter parity; Guest renders no data or mutation surface", async () => {
  const keys = Object.keys(agendaMessages["pt-BR"]);
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(agendaMessages[locale]), keys);
    for (const key of keys as (keyof (typeof agendaMessages)["pt-BR"])[]) {
      assert.ok(agendaMessages[locale][key]);
      assert.deepEqual(
        agendaMessages[locale][key].match(/\{\w+\}/g),
        agendaMessages["pt-BR"][key].match(/\{\w+\}/g),
      );
    }
    const root = createRoot(container);
    let calls = 0;
    try {
      await act(async () =>
        root.render(
          <LocalizationProvider preferences={{ locale }}>
            <AgendaItemsView
              context={context(async () => {
                calls++;
                throw new Error("Guest request");
              }, true)}
            />
          </LocalizationProvider>,
        ),
      );
      assert.equal(calls, 0);
      assert.equal(
        container.querySelector("h1")!.textContent,
        agendaTranslator(locale)("agendaItems"),
      );
      assert.equal(
        container.querySelectorAll("button,input,select,textarea").length,
        0,
      );
    } finally {
      await act(async () => root.unmount());
    }
  }
});

test("real API consumer creates a parked item with null duration, schedules, reschedules with versions, and reloads", async () => {
  const root = createRoot(container);
  let current: AgendaResult | null = null;
  const calls: { path: string; options: any }[] = [];
  const targets = [
    {
      id: "meeting-a",
      title: "First eligible meeting",
      version: 7,
      circleId: "circle",
      state: "SCHEDULED",
    },
    {
      id: "meeting-b",
      title: "Second eligible meeting",
      version: 11,
      circleId: "circle",
      state: "RUNNING",
    },
    {
      id: "closed",
      title: "Closed must not be selectable",
      version: 1,
      circleId: "circle",
      state: "CLOSED",
    },
    {
      id: "other",
      title: "Other circle must not be selectable",
      version: 1,
      circleId: "other-circle",
      state: "SCHEDULED",
    },
  ];
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, options });
    if (platformResponse(path)) return platformResponse(path);
    const url = new URL(path, "http://agenda.localhost");
    if (url.pathname.endsWith("/targets")) return { data: { items: targets } };
    if (
      options.method === "POST" &&
      url.pathname.endsWith("/meeting-agenda-items")
    ) {
      assert.equal(options.body.expectedDurationMinutes, null);
      assert.equal(options.body.presenterMemberId, undefined);
      assert.equal(options.body.targetMeetingId, undefined);
      assert.equal(options.body.meetingId, undefined);
      current = item();
      current.item.title = options.body.title;
      current.item.descriptionRich = options.body.descriptionRich;
      return { data: structuredClone(current) };
    }
    if (
      url.pathname.endsWith("/actions/schedule") ||
      url.pathname.endsWith("/actions/reschedule")
    ) {
      assert.ok(current);
      assert.equal(options.version, current.item.version);
      const target = targets.find(
        (entry) => entry.id === options.body.targetMeetingId,
      )!;
      assert.equal(options.body.expectedTargetVersion, target.version);
      if (url.pathname.endsWith("/reschedule")) {
        assert.equal(
          options.body.expectedSourceVersion,
          current.placement!.meetingVersion,
        );
        assert.equal(options.body.presenterMemberId, undefined);
      } else assert.equal(options.body.presenterMemberId, "member");
      current.item.state = "ASSIGNED";
      current.item.circleId = target.circleId;
      current.item.version++;
      current.placement = {
        id: `placement-${target.id}`,
        meetingId: target.id,
        meetingTitle: target.title,
        meetingVersion: target.version + 1,
        presenterId: "member",
        status: "OPEN",
        version: 1,
      };
      current.capabilities = {
        edit: true,
        schedule: false,
        reschedule: true,
        unschedule: true,
        archive: false,
        adopt: false,
      };
      return { data: structuredClone(current) };
    }
    if (url.pathname.endsWith("/item-1")) {
      assert.ok(current);
      return { data: structuredClone(current) };
    }
    return {
      data: {
        items:
          current &&
          (!url.searchParams.get("state") ||
            url.searchParams.get("state") === current.item.state)
            ? [structuredClone(current)]
            : [],
        page: { hasMore: false, nextCursor: null },
      },
    };
  };
  try {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "en-US" }}>
          <AgendaItemsView context={context(api)} />
        </LocalizationProvider>,
      ),
    );
    await click(text("create"));
    assert.equal(
      container.querySelectorAll("dialog select").length,
      0,
      "create has no meeting/presenter picker",
    );
    await setValue("input[name=title]", "Persisted literal title");
    await submit();
    assert.equal(container.querySelector("dialog"), null);
    assert.equal(
      container.querySelector("section h2")!.textContent,
      "Persisted literal title",
    );
    assert.ok(
      container
        .querySelector("section")!
        .textContent!.includes(text("undefinedDuration")),
    );
    await click(text("schedule"));
    const presenterOptions = [
      ...container.querySelectorAll("select[name=presenterMemberId] option"),
    ].map((option) => option.textContent);
    assert.deepEqual(presenterOptions, [
      text("presenterDefault"),
      "Active member",
    ]);
    await setValue("select[name=targetMeetingId]", "meeting-a");
    await setValue("select[name=presenterMemberId]", "member");
    await submit();
    assert.equal(
      container.querySelector("section h2")!.textContent,
      "Persisted literal title",
    );
    await click(text("reschedule"));
    assert.equal(
      container.querySelector("select[name=presenterMemberId]"),
      null,
    );
    const choices = [
      ...container.querySelectorAll("select[name=targetMeetingId] option"),
    ].map((option) => option.textContent);
    assert.deepEqual(choices, [
      text("chooseTarget"),
      "Second eligible meeting",
    ]);
    await setValue("select[name=targetMeetingId]", "meeting-b");
    await submit();
    await click(text("refresh"));
    assert.ok(
      container
        .querySelector("section")!
        .textContent!.includes("Second eligible meeting"),
    );
    assert.ok(
      calls.filter(
        (call) => call.path.endsWith("/item-1") && !call.options.method,
      ).length >= 3,
      "detail reloaded from API after mutations",
    );
    assert.ok(
      calls.every(
        (call) => !/\/meeting-series|\/work-items|\/tasks/.test(call.path),
      ),
      "agenda flow creates no meetings or tasks",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test("legacy owner is never inferred; adoption requires an explicit active member and reason, then handles loss of read access", async () => {
  const root = createRoot(container),
    current = item();
  current.item.ownerId = null;
  current.item.identityCoverage = "LEGACY_PLACEMENT";
  current.coverage = {
    identityCoverage: "LEGACY_PLACEMENT",
    historyRedacted: true,
  };
  current.capabilities = {
    edit: false,
    schedule: false,
    reschedule: false,
    unschedule: false,
    archive: false,
    adopt: true,
  };
  let adopted = false;
  const api = async (path: string, options: any = {}) => {
    if (platformResponse(path)) return platformResponse(path);
    if (path.endsWith("/actions/adopt")) {
      assert.equal(options.version, 1);
      assert.deepEqual(options.body, {
        ownerMemberId: "other-active",
        reason: "Explicit adoption",
      });
      adopted = true;
      return {
        data: {
          adopted: true,
          itemId: current.item.id,
          ownerMemberId: "other-active",
        },
      };
    }
    if (path.endsWith("/item-1")) return { data: structuredClone(current) };
    return {
      data: {
        items: adopted ? [] : [structuredClone(current)],
        page: { hasMore: false, nextCursor: null },
      },
    };
  };
  const ctx = context(api);
  ctx.members.push({
    id: "other-active",
    displayName: "Chosen owner",
    status: "ACTIVE",
    memberType: "MEMBER",
  });
  try {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "en-US" }}>
          <AgendaItemsView context={ctx} />
        </LocalizationProvider>,
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".meetings-list-row")!.click(),
    );
    assert.ok(
      container
        .querySelector("section")!
        .textContent!.includes(text("unknownOwner")),
    );
    assert.ok(
      container
        .querySelector("section")!
        .textContent!.includes(text("legacyCoverage")),
    );
    assert.ok(
      container
        .querySelector("section")!
        .textContent!.includes(text("historyRedacted")),
    );
    await click(text("adopt"));
    assert.equal(
      container.querySelector<HTMLSelectElement>("select[name=ownerMemberId]")!
        .value,
      "",
    );
    assert.deepEqual(
      [...container.querySelectorAll("select[name=ownerMemberId] option")].map(
        (option) => option.textContent,
      ),
      [text("chooseOwner"), "Active member", "Chosen owner"],
    );
    await setValue("select[name=ownerMemberId]", "other-active");
    await submit();
    assert.equal(adopted, false);
    assert.ok(
      container
        .querySelector("dialog")!
        .textContent!.includes(text("invalidReason")),
    );
    await setValue("textarea[name=reason]", "Explicit adoption");
    await submit();
    assert.equal(adopted, true);
    assert.equal(container.querySelector("dialog"), null);
    assert.equal(container.querySelector("section"), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test("list pagination uses the server cursor and applying filters starts a fresh authorized page", async () => {
  const root = createRoot(container),
    first = item("first"),
    second = item("second");
  second.item.title = "Second result";
  const queries: URLSearchParams[] = [];
  const api = async (path: string) => {
    const query = new URL(path, "http://agenda.localhost").searchParams;
    queries.push(query);
    return {
      data: {
        items: query.get("search")
          ? []
          : query.get("cursor")
            ? [second]
            : [first],
        page: {
          hasMore: !query.get("search") && !query.get("cursor"),
          nextCursor:
            query.get("search") || query.get("cursor")
              ? null
              : "opaque+cursor==",
        },
      },
    };
  };
  try {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "en-US" }}>
          <AgendaItemsView context={context(api)} />
        </LocalizationProvider>,
      ),
    );
    await click(text("loadMore"));
    assert.equal(container.querySelectorAll(".meetings-list-row").length, 2);
    assert.equal(queries.at(-1)!.get("cursor"), "opaque+cursor==");
    await setValue("select[name=state]", "NEEDS_RESCHEDULE");
    await setValue("select[name=circleId]", "circle");
    await setValue("input[name=search]", "  literal search  ");
    await act(async () =>
      container
        .querySelector("form.collection-toolbar")!
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    assert.equal(queries.at(-1)!.get("cursor"), null);
    assert.equal(queries.at(-1)!.get("state"), "NEEDS_RESCHEDULE");
    assert.equal(queries.at(-1)!.get("circleId"), "circle");
    assert.equal(queries.at(-1)!.get("search"), "literal search");
    assert.equal(container.querySelectorAll(".meetings-list-row").length, 0);
  } finally {
    await act(async () => root.unmount());
  }
});

test("409 keeps title, rich draft, zero duration and dialog; explicit refresh updates references without overwriting draft", async () => {
  const root = createRoot(container);
  const current = item();
  current.item.descriptionRich.doc.content[0] = {
    type: "paragraph",
    content: [
      { type: "text", text: "Rich draft preserved", marks: [{ type: "bold" }] },
    ],
  };
  const patches: any[] = [];
  const api = async (path: string, options: any = {}) => {
    if (platformResponse(path)) return platformResponse(path);
    if (options.method === "PATCH") {
      patches.push(options);
      if (patches.length === 1) {
        current.item.version = 8;
        current.item.title = "Concurrent server title";
        throw { code: "VERSION_CONFLICT" };
      }
      assert.equal(options.version, 8);
      current.item.title = options.body.title;
      current.item.descriptionRich = options.body.descriptionRich;
      current.item.expectedDurationMinutes =
        options.body.expectedDurationMinutes;
      return { data: structuredClone(current) };
    }
    if (path.endsWith("/item-1")) return { data: structuredClone(current) };
    return {
      data: {
        items: [structuredClone(current)],
        page: { hasMore: false, nextCursor: null },
      },
    };
  };
  try {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale: "en-US" }}>
          <AgendaItemsView context={context(api)} />
        </LocalizationProvider>,
      ),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".meetings-list-row")!.click();
    });
    await click(text("edit"));
    await setValue("dialog input[name=title]", "My unsaved draft");
    await setValue("dialog input[name=expectedDurationMinutes]", "0");
    await submit();
    assert.ok(container.querySelector("dialog"));
    assert.equal(
      container.querySelector<HTMLInputElement>("dialog input[name=title]")!
        .value,
      "My unsaved draft",
    );
    assert.equal(
      container.querySelector<HTMLInputElement>(
        "dialog input[name=expectedDurationMinutes]",
      )!.value,
      "0",
    );
    assert.ok(
      container
        .querySelector("dialog .tiptap strong")!
        .textContent!.includes("Rich draft preserved"),
    );
    assert.ok(
      container
        .querySelector("dialog")!
        .textContent!.includes(text("conflict")),
    );
    await click(text("refreshDraft"));
    assert.equal(
      container.querySelector<HTMLInputElement>("dialog input[name=title]")!
        .value,
      "My unsaved draft",
    );
    assert.ok(
      container
        .querySelector("dialog details")!
        .textContent!.includes("Concurrent server title"),
    );
    await submit();
    assert.equal(container.querySelector("dialog"), null);
    assert.equal(current.item.expectedDurationMinutes, 0);
    assert.equal(
      patches[1].body.descriptionRich.doc.content[0].content[0].marks[0].type,
      "bold",
    );
    assert.notEqual(
      patches[0].key,
      patches[1].key,
      "new item version uses a new idempotency key",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

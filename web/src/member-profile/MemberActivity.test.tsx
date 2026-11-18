import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { FeatureContext } from "../feature-contract";
import { RequestError } from "../api";
import {
  SUPPORTED_LOCALES,
  type Locale,
} from "../../../packages/i18n/index.js";
import { memberActivityMessages, memberActivityTranslator } from "./messages";
import type {
  MemberActivityItem,
  MemberActivityKind,
  MemberActivityPage,
} from "./MemberActivity";

const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  {
    url: "http://member-activity.localhost",
    pretendToBeVisual: true,
  },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Event",
  "MouseEvent",
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
registerHooks({
  load(url, options, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "export {};", shortCircuit: true }
      : next(url, options);
  },
});
const { createRoot } = await import("react-dom/client");
const { LocalizationProvider } = await import("../localization/index.js");
const { MemberActivity, memberActivityPath } =
  await import("./MemberActivity.js");
const container = dom.window.document.querySelector("main")!;
const t = memberActivityTranslator("en-US");
type Api = FeatureContext["api"];
type Call = { path: string; options: Parameters<Api>[1] };
function context(
  api: unknown,
  overrides: Record<string, unknown> = {},
): FeatureContext {
  return {
    organizationId: "org-a",
    session: { account: { id: "account-a" } },
    bootstrap: {
      membership: { id: "actor-a", memberType: "MEMBER" },
      authorizationRevision: 1,
    },
    path: "/members/member-a",
    api,
    navigate: () => {},
    notify: () => {},
    ...overrides,
  } as unknown as FeatureContext;
}
function item(
  id = "project-a",
  overrides: Partial<MemberActivityItem> = {},
): MemberActivityItem {
  return {
    id,
    title: `Title ${id}`,
    href: `/projects/${id}`,
    status: "ACTIVE",
    reasons: ["PROJECT_PARTICIPANT"],
    ...overrides,
  };
}
function page(
  items: MemberActivityItem[] = [],
  nextCursor: string | null = null,
  partial = false,
): MemberActivityPage {
  return {
    items,
    nextCursor,
    asOf: "2026-10-19T12:30:00.000Z",
    coverage: {
      scope: "CURRENT_VIEWER_AUTHORIZED_RELATIONS",
      completeness: partial ? "PARTIAL" : "COMPLETE",
      limitations: partial ? ["ROLE_CAPACITY_UNAVAILABLE"] : [],
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function render(
  root: ReturnType<typeof createRoot>,
  c: FeatureContext,
  {
    memberId = "member-a",
    kind = "PROJECT",
    locale = "en-US",
  }: { memberId?: string; kind?: MemberActivityKind; locale?: Locale } = {},
) {
  return act(async () =>
    root.render(
      <LocalizationProvider
        preferences={{
          locale,
          timeZone: "Asia/Tokyo",
          dateFormat: "YYYY-MM-DD",
        }}
      >
        <MemberActivity context={c} memberId={memberId} kind={kind} />
      </LocalizationProvider>,
    ),
  );
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  assert.ok(found, `Missing button: ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function text() {
  return container.textContent ?? "";
}

test("all eight provider locales have complete keys and placeholder parity, without refetching", async () => {
  const keys = Object.keys(
    memberActivityMessages["pt-BR"],
  ) as (keyof (typeof memberActivityMessages)["pt-BR"])[];
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(memberActivityMessages[locale]), keys);
    for (const key of keys) {
      assert.ok(memberActivityMessages[locale][key]);
      assert.deepEqual(
        memberActivityMessages[locale][key].match(/\{\w+\}/g),
        memberActivityMessages["pt-BR"][key].match(/\{\w+\}/g),
      );
    }
  }
  const root = createRoot(container);
  let reads = 0;
  const c = context(async () => {
    reads++;
    return { data: page([item()]) };
  });
  try {
    for (const locale of SUPPORTED_LOCALES) {
      await render(root, c, { locale });
      const local = memberActivityTranslator(locale);
      assert.equal(
        container.querySelector("h3")?.textContent,
        local("projects"),
      );
      assert.ok(text().includes(local("projectParticipant")));
      assert.ok(
        text().includes(
          local("asOf", {
            time:
              "2026-10-19 " +
              new Intl.DateTimeFormat(locale, {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Tokyo",
              }).format(new Date("2026-10-19T12:30:00Z")),
          }),
        ),
      );
    }
    assert.equal(reads, 1);
  } finally {
    await act(async () => root.unmount());
  }
});

test("loads second page with limit 50, retains first page, dedupes and uses only GET", async () => {
  const root = createRoot(container),
    calls: Call[] = [];
  const cursor = "opaque +/&=?";
  const c = context(async (path: string, options: Parameters<Api>[1]) => {
    calls.push({ path, options });
    return {
      data:
        calls.length === 1
          ? page([item()], cursor)
          : page([item(), item("project-b")]),
    };
  });
  try {
    await render(root, c);
    assert.ok(text().includes(t("loaded", { count: "1" })));
    assert.ok(text().includes(t("moreAvailable")));
    await click(t("loadMore"));
    assert.equal(
      container.querySelectorAll(".member-activity-list li").length,
      2,
    );
    assert.ok(text().includes(t("loaded", { count: "2" })));
    assert.equal(container.querySelector(".member-activity-pagination"), null);
    assert.equal(
      calls[0].path,
      "/organizations/org-a/work/members/member-a/projects?limit=50",
    );
    assert.equal(
      new URL(calls[1].path, "http://localhost").searchParams.get("cursor"),
      cursor,
    );
    for (const call of calls) {
      assert.equal(call.options?.method ?? "GET", "GET");
      assert.equal(call.options?.body, undefined);
      assert.ok(call.options?.signal);
    }
  } finally {
    await act(async () => root.unmount());
  }
});

test("goals use the Goals reader and the two responsibility labels", async () => {
  const root = createRoot(container),
    calls: string[] = [];
  const c = context(async (path: string) => {
    calls.push(path);
    return {
      data: page([
        item("goal-a", {
          title: "Current responsibility",
          href: "/goals/goal-a",
          status: "CLOSED",
          reasons: ["GOAL_RESPONSIBLE", "RESULT_RESPONSIBLE"],
        }),
      ]),
    };
  });
  try {
    await render(root, c, { kind: "GOAL" });
    assert.equal(
      calls[0],
      "/organizations/org-a/goals/members/member-a/goals?limit=50",
    );
    assert.ok(
      text().includes(t("goalResponsible")) &&
        text().includes(t("resultResponsible")),
    );
    assert.ok(text().includes(t("closed")));
    assert.equal(
      container.querySelector("a")?.getAttribute("href"),
      "/goals/goal-a",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test("empty authorized scope is distinct from denied, 404, unavailable provider and disabled module", async () => {
  const root = createRoot(container);
  let mode = "empty";
  const c = context(async () => {
    if (mode !== "empty") throw new RequestError(mode, "untrusted server text");
    return { data: page() };
  });
  try {
    await render(root, c, { kind: "GOAL" });
    assert.ok(
      text().includes(t("noGoals")) && text().includes(t("emptyGoals")),
    );
    assert.equal(container.querySelector('[role="alert"]'), null);
    for (const [code, key] of [
      ["ACTION_DENIED", "denied"],
      ["RESOURCE_NOT_FOUND", "notFound"],
      ["MEMBER_PROFILE_AUTHORITY_UNAVAILABLE", "unavailable"],
      ["MODULE_DISABLED", "moduleUnavailable"],
    ] as const) {
      mode = code;
      await click(t("reload"));
      assert.equal(container.querySelector(".member-activity-empty"), null);
      assert.ok(
        container
          .querySelector('[role="alert"]')
          ?.textContent?.includes(t(key)),
      );
      assert.ok(!text().includes("untrusted server text"));
    }
  } finally {
    await act(async () => root.unmount());
  }
});

test("semantic read errors change language through the real provider without another request", async () => {
  const root = createRoot(container);
  let reads = 0;
  const c = context(async () => {
    reads++;
    throw new RequestError("RESOURCE_NOT_FOUND", "raw backend text");
  });
  try {
    await render(root, c);
    for (const locale of SUPPORTED_LOCALES) {
      await render(root, c, { locale });
      assert.ok(text().includes(memberActivityTranslator(locale)("notFound")));
      assert.ok(!text().includes("raw backend text"));
    }
    assert.equal(reads, 1);
  } finally {
    await act(async () => root.unmount());
  }
});

test("a failed page retries the same read and retains already loaded items", async () => {
  const root = createRoot(container),
    calls: Call[] = [];
  const c = context(async (path: string, options: Parameters<Api>[1]) => {
    calls.push({ path, options });
    if (calls.length === 1) return { data: page([item()], "next") };
    if (calls.length === 2)
      throw new RequestError("NETWORK_ERROR", "untrusted detail");
    return { data: page([item("project-b")]) };
  });
  try {
    await render(root, c);
    await click(t("loadMore"));
    assert.equal(container.querySelectorAll(".member-activity-row").length, 1);
    assert.ok(container.querySelector('[role="alert"]'));
    await click(t("retry"));
    assert.equal(calls[1].path, calls[2].path);
    assert.equal(container.querySelectorAll(".member-activity-row").length, 2);
    assert.equal(container.querySelector('[role="alert"]'), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test("permission revocation on the next page clears stale results and retry starts from page one", async () => {
  const root = createRoot(container),
    calls: string[] = [];
  const c = context(async (path: string) => {
    calls.push(path);
    if (calls.length === 1) return { data: page([item()], "next") };
    if (calls.length === 2) throw new RequestError("ACTION_DENIED", "deny");
    return { data: page() };
  });
  try {
    await render(root, c);
    await click(t("loadMore"));
    assert.equal(container.querySelector("a"), null);
    assert.ok(text().includes(t("denied")));
    await click(t("retry"));
    assert.equal(calls[0], calls[2]);
  } finally {
    await act(async () => root.unmount());
  }
});

test("busy controls prevent concurrent reads and expose loading state", async () => {
  const root = createRoot(container),
    next = deferred<{ data: MemberActivityPage }>();
  let reads = 0;
  const c = context(async () => {
    reads++;
    return reads === 1 ? { data: page([item()], "next") } : next.promise;
  });
  try {
    await render(root, c);
    const load = button(t("loadMore"));
    await act(async () => {
      load.click();
      load.click();
    });
    assert.equal(reads, 2);
    assert.equal(
      container.querySelector("section")?.getAttribute("aria-busy"),
      "true",
    );
    assert.equal(button(t("loading")).disabled, true);
    assert.equal(button(t("reload")).disabled, true);
    await act(async () => next.resolve({ data: page([item("project-b")]) }));
    assert.equal(
      container.querySelector("section")?.getAttribute("aria-busy"),
      "false",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test("org, target, actor, account, kind and authorization revision reset state and abort old reads", async () => {
  const changes: {
    label: string;
    change: (c: FeatureContext) => FeatureContext;
    target?: string;
    kind?: MemberActivityKind;
  }[] = [
    { label: "org", change: (c) => ({ ...c, organizationId: "org-b" }) },
    { label: "target", change: (c) => c, target: "member-b" },
    {
      label: "actor",
      change: (c) => ({
        ...c,
        bootstrap: {
          ...c.bootstrap,
          membership: { ...c.bootstrap.membership, id: "actor-b" },
        },
      }),
    },
    {
      label: "account",
      change: (c) => ({
        ...c,
        session: {
          ...c.session,
          account: { ...c.session.account, id: "account-b" },
        },
      }),
    },
    { label: "kind", change: (c) => c, kind: "GOAL" },
    {
      label: "authorization revision",
      change: (c) => ({
        ...c,
        bootstrap: { ...c.bootstrap, authorizationRevision: 2 },
      }),
    },
  ];
  for (const change of changes) {
    const root = createRoot(container),
      old = deferred<{ data: MemberActivityPage }>(),
      signals: AbortSignal[] = [];
    let calls = 0;
    const c = context(async (_path: string, options: Parameters<Api>[1]) => {
      signals.push(options!.signal!);
      calls++;
      return calls === 1 ? old.promise : { data: page([item("fresh")]) };
    });
    try {
      await render(root, c);
      await render(root, change.change(c), {
        memberId: change.target,
        kind: change.kind,
      });
      assert.equal(signals[0].aborted, true, change.label);
      assert.ok(text().includes("Title fresh"), change.label);
      await act(async () => old.resolve({ data: page([item("stale")]) }));
      assert.ok(!text().includes("Title stale"), change.label);
      assert.equal(calls, 2, change.label);
    } finally {
      await act(async () => root.unmount());
    }
    assert.equal(
      signals[1].aborted,
      false,
      "completed read no longer needs a live controller",
    );
  }
});

test("safe local navigation ignores external href and escapes injected titles and codes", async () => {
  const root = createRoot(container),
    navigations: string[] = [];
  const title = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const c = context(
    async () => ({
      data: page([
        item("project-a", {
          title,
          href: "javascript:alert(1)",
          reasons: [
            "__proto__",
            "constructor",
            "toString",
            "<script>bad</script>",
            "PROJECT_PARTICIPANT",
          ],
          status: "__proto__",
        }),
      ]),
    }),
    { navigate: (path: string) => navigations.push(path) },
  );
  try {
    await render(root, c);
    const link = container.querySelector("a")!;
    assert.equal(link.getAttribute("href"), "/projects/project-a");
    assert.equal(link.textContent, title);
    assert.equal(container.querySelector("img,script"), null);
    assert.ok(!text().includes("<script>bad</script>"));
    assert.ok(
      text().includes(t("currentLink")) && text().includes(t("unknownStatus")),
    );
    await act(async () => link.click());
    assert.deepEqual(navigations, ["/projects/project-a"]);
    for (const invalid of [
      "//evil.test",
      "../escape",
      ".",
      "a/b",
      "a?b",
      "a#b",
      "%2F",
      "<script>",
    ])
      assert.equal(memberActivityPath("PROJECT", invalid), null, invalid);
  } finally {
    await act(async () => root.unmount());
  }
});

test("partial coverage remains visible across pages and a reload starts the list again", async () => {
  const root = createRoot(container),
    paths: string[] = [];
  const c = context(async (path: string) => {
    paths.push(path);
    if (paths.length === 1) return { data: page([item()], "next", true) };
    if (paths.length === 2) return { data: page([item("project-b")]) };
    return { data: page() };
  });
  try {
    await render(root, c);
    assert.ok(text().includes(t("partialRoles")));
    await click(t("loadMore"));
    assert.ok(text().includes(t("partialRoles")));
    await click(t("reload"));
    assert.equal(paths[0], paths[2]);
    assert.equal(container.querySelectorAll("a").length, 0);
    assert.ok(!text().includes(t("partialRoles")));
    assert.ok(text().includes(t("noProjects")));
  } finally {
    await act(async () => root.unmount());
  }
});

test("invalid payloads and cursor cycles are explicit errors instead of empty success", async () => {
  const root = createRoot(container);
  let reads = 0;
  const c = context(async () => {
    reads++;
    if (reads === 1) return { data: page([item("../unsafe")]) };
    return { data: page([item()], "cycle") };
  });
  try {
    await render(root, c);
    assert.ok(text().includes(t("invalidResponse")));
    assert.equal(container.querySelector(".member-activity-empty"), null);
    await click(t("retry"));
    await click(t("loadMore"));
    assert.ok(text().includes(t("invalidResponse")));
    assert.equal(container.querySelectorAll("a").length, 1);
  } finally {
    await act(async () => root.unmount());
  }
});

test("unmount aborts an in-flight read and its ignored-signal result has no side effects", async () => {
  const root = createRoot(container),
    old = deferred<{ data: MemberActivityPage }>();
  let signal: AbortSignal | undefined;
  const c = context(async (_path: string, options: Parameters<Api>[1]) => {
    signal = options?.signal;
    return old.promise;
  });
  await render(root, c);
  await act(async () => root.unmount());
  assert.equal(signal?.aborted, true);
  await act(async () => old.resolve({ data: page([item("stale")]) }));
  assert.equal(container.children.length, 0);
});

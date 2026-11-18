import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";

// Predetermined HTTP responses exercise the real client transport. They do not prove server admission or SMTP.
const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  {
    url: "http://admission.localhost/organizations/11111111-1111-4111-8111-111111111111/join",
  },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Event",
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
const vite = await createServer({
  root: new URL("../../", import.meta.url).pathname,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: "custom",
});
const { OrgAdmission } = await vite.ssrLoadModule(
  "/src/admission/OrgAdmission.tsx",
);
const { LocalizationProvider } = await vite.ssrLoadModule(
  "/src/localization/index.tsx",
);
const { setCsrf } = await vite.ssrLoadModule("/src/api.ts");
const originalFetch = globalThis.fetch;
const org = "11111111-1111-4111-8111-111111111111",
  otherOrg = "22222222-2222-4222-8222-222222222222";
const firstRequest = "33333333-3333-4333-8333-333333333333",
  secondRequest = "44444444-4444-4444-8444-444444444444";
const member = "55555555-5555-4555-8555-555555555555";
const linkToken = "a".repeat(64),
  mailboxToken = "b".repeat(64),
  alternateToken = "c".repeat(64);
const base = `/organizations/${org}/admission`;
const response = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { requestId: "synthetic" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const failure = (code: string, status = 409, message = code) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const pending = (requestId = firstRequest) =>
  response({ requestId, state: "PENDING_PROOF" });
const joined = (state = "JOINED") =>
  response({
    state,
    membership: { id: member, memberType: "MEMBER", orgRole: "MEMBER" },
  });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Step = { path: string; result: Response | Promise<Response> };
type Call = { path: string; options: RequestInit; body: any };
function fixture(steps: Step[]) {
  const calls: Call[] = [];
  globalThis.fetch = async (input, options = {}) => {
    const path = String(input),
      next = steps.shift();
    calls.push({
      path,
      options,
      body: options.body ? JSON.parse(String(options.body)) : undefined,
    });
    assert.ok(next, "Unexpected request");
    assert.equal(path, "/api/v1" + next.path);
    assert.equal(options.method, "POST");
    return next.result;
  };
  return calls;
}
async function mount(
  props: Record<string, unknown> = {},
  locale = "en-US",
  strict = false,
) {
  const container = dom.window.document.querySelector("main")!,
    root = createRoot(container);
  const callbacks = {
    joined: [] as unknown[],
    requestIds: [] as unknown[],
    signIns: 0,
    cancels: 0,
    consumed: 0,
  };
  let current = {
    orgId: org,
    onJoined: (value: unknown) => callbacks.joined.push(value),
    onSignIn: () => callbacks.signIns++,
    onCancel: () => callbacks.cancels++,
    onRequestIdChange: (value: unknown) => callbacks.requestIds.push(value),
    onLinkTokenConsumed: () => callbacks.consumed++,
    ...props,
  };
  async function render() {
    await act(async () => {
      const content = (
        <LocalizationProvider preferences={{ locale }}>
          <OrgAdmission {...current} />
        </LocalizationProvider>
      );
      root.render(
        strict ? <React.StrictMode>{content}</React.StrictMode> : content,
      );
    });
  }
  await render();
  return {
    container,
    root,
    callbacks,
    rerender: async (next: Record<string, unknown>) => {
      current = { ...current, ...next };
      await render();
    },
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}
function button(container: Element, label: string) {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((value) => value.textContent === label);
  assert.ok(found, "Missing button: " + label);
  return found;
}
const click = async (element: HTMLButtonElement) => {
  await act(async () => element.click());
};
function input(container: Element) {
  const found = container.querySelector<HTMLInputElement>(
    "input[name=mailboxToken]",
  );
  assert.ok(found);
  return found;
}
async function enter(container: Element, value: string) {
  await act(async () => {
    input(container).value = value;
    input(container).dispatchEvent(
      new dom.window.Event("input", { bubbles: true }),
    );
  });
}
async function submit(container: Element) {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
}
function safeSurfaces(container: Element, calls: Call[] = []) {
  for (const secret of [linkToken, mailboxToken, alternateToken]) {
    assert.ok(!container.textContent?.includes(secret));
    assert.ok(!container.innerHTML.includes(secret));
    assert.ok(!dom.window.location.href.includes(secret));
    assert.ok(!JSON.stringify({ ...dom.window.localStorage }).includes(secret));
    assert.ok(
      !JSON.stringify({ ...dom.window.sessionStorage }).includes(secret),
    );
    for (const call of calls) {
      assert.ok(!call.path.includes(secret));
      assert.ok(!JSON.stringify(call.options.headers).includes(secret));
    }
  }
  assert.equal(
    container.querySelector("img,iframe,script[src],a[href]"),
    null,
    "Admission must not send secrets to remote resources",
  );
}
test.after(async () => {
  globalThis.fetch = originalFetch;
  await vite.close();
  dom.window.close();
});

test("public join is explicit, sends a closed body with account CSRF and never joins before mailbox proof", async () => {
  const start = deferred(),
    calls = fixture([{ path: base + "/requests", result: start.promise }]);
  setCsrf("synthetic-csrf");
  const view = await mount({
    organizationName: "A different organization",
    accountEmail: "account@example.test",
  });
  try {
    assert.equal(calls.length, 0);
    assert.match(view.container.textContent!, /A different organization/);
    assert.equal(
      dom.window.document.activeElement,
      view.container.querySelector("h1"),
    );
    await click(button(view.container, "Request email code"));
    assert.equal(view.container.getAttribute("aria-busy"), null);
    assert.equal(
      view.container.querySelector("section")!.getAttribute("aria-busy"),
      "true",
    );
    await click(button(view.container, "Requesting code…"));
    assert.equal(calls.length, 1);
    assert.equal(view.callbacks.joined.length, 0);
    assert.equal(view.container.querySelector("form"), null);
    await act(async () => start.resolve(pending()));
    assert.deepEqual(view.callbacks.requestIds, [firstRequest]);
    assert.equal(view.callbacks.joined.length, 0);
    assert.equal(dom.window.document.activeElement, input(view.container));
    assert.equal(input(view.container).type, "password");
    assert.deepEqual(calls[0].body, {});
    assert.equal(calls[0].options.credentials, "same-origin");
    const headers = calls[0].options.headers as Record<string, string>;
    assert.equal(headers["X-CSRF-Token"], "synthetic-csrf");
    assert.ok(headers["Idempotency-Key"]);
    safeSurfaces(view.container, calls);
  } finally {
    await view.unmount();
  }
});

test("link capability survives prop consumption, stays in the POST body and is removed with successful proof", async () => {
  const complete = deferred(),
    calls = fixture([
      { path: base + "/link-requests", result: pending() },
      {
        path: base + `/requests/${firstRequest}/complete`,
        result: complete.promise,
      },
    ]);
  const storageWrite = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () =>
    assert.fail("Admission must never write storage");
  const view = await mount({ linkToken });
  try {
    assert.equal(view.callbacks.consumed, 1);
    await view.rerender({ linkToken: undefined });
    await click(button(view.container, "Request email code"));
    assert.deepEqual(calls[0].body, { linkToken });
    await enter(view.container, "short");
    await submit(view.container);
    assert.equal(calls.length, 1);
    assert.match(
      view.container.querySelector("[role=alert]")!.textContent!,
      /64-character/,
    );
    await enter(view.container, mailboxToken);
    await submit(view.container);
    assert.equal(input(view.container).readOnly, true);
    assert.equal(view.callbacks.joined.length, 0);
    await submit(view.container);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body, { mailboxToken });
    safeSurfaces(view.container, calls);
    await act(async () => complete.resolve(joined()));
    assert.equal(view.callbacks.joined.length, 1);
    assert.equal(view.container.querySelector("input"), null);
    assert.deepEqual(view.callbacks.requestIds, [firstRequest, null]);
    assert.match(view.container.textContent!, /membership is confirmed/);
    safeSurfaces(view.container, calls);
  } finally {
    await view.unmount();
    dom.window.Storage.prototype.setItem = storageWrite;
  }
});

test("network retries reuse each command key; requesting another code starts a new intention", async () => {
  const calls = fixture([
      { path: base + "/requests", result: failure("NETWORK_ERROR", 503) },
      { path: base + "/requests", result: pending() },
      { path: base + "/requests", result: pending(secondRequest) },
      {
        path: base + `/requests/${secondRequest}/complete`,
        result: failure("INTERNAL_ERROR", 500),
      },
      {
        path: base + `/requests/${secondRequest}/complete`,
        result: joined("ALREADY_MEMBER"),
      },
    ]),
    view = await mount();
  try {
    await click(button(view.container, "Request email code"));
    await click(button(view.container, "Try again"));
    const key = (at: number) =>
      (calls[at].options.headers as Record<string, string>)["Idempotency-Key"];
    assert.equal(key(0), key(1));
    await enter(view.container, alternateToken);
    await click(button(view.container, "Request another code"));
    assert.notEqual(key(1), key(2));
    assert.equal(input(view.container).value, "");
    await enter(view.container, mailboxToken);
    await submit(view.container);
    await click(button(view.container, "Try again"));
    assert.equal(key(3), key(4));
    assert.match(view.container.textContent!, /already a member/);
    assert.equal(view.callbacks.joined.length, 1);
    safeSurfaces(view.container, calls);
  } finally {
    await view.unmount();
  }
});

test("resuming a safe request ID sends no GET, confirms without the link secret and never guesses its source", async () => {
  const calls = fixture([
      { path: base + `/requests/${firstRequest}/complete`, result: joined() },
    ]),
    view = await mount({ initialRequestId: firstRequest });
  try {
    assert.equal(calls.length, 0);
    assert.ok(input(view.container));
    assert.ok(!view.container.textContent!.includes("Request another code"));
    assert.match(view.container.textContent!, /reopen the organization/);
    await enter(view.container, mailboxToken);
    await submit(view.container);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { mailboxToken });
    assert.equal(view.callbacks.joined.length, 1);
  } finally {
    await view.unmount();
  }
});

test("unavailable or expired/revoked proof is reported without inventing a known state or leaking server messages", async () => {
  const calls = fixture([
      { path: base + "/requests", result: pending() },
      {
        path: base + `/requests/${firstRequest}/complete`,
        result: failure("ADMISSION_INVALID", 404, mailboxToken),
      },
    ]),
    view = await mount();
  try {
    await click(button(view.container, "Request email code"));
    await enter(view.container, mailboxToken);
    await submit(view.container);
    const notice = view.container.querySelector<HTMLElement>("[role=alert]")!;
    assert.match(notice.textContent!, /may have expired/);
    assert.match(notice.textContent!, /may have been revoked/);
    assert.equal(dom.window.document.activeElement, notice);
    assert.equal(view.callbacks.joined.length, 0);
    assert.equal(input(view.container).disabled, false);
    assert.ok(button(view.container, "Request another code"));
    safeSurfaces(view.container, calls);
  } finally {
    await view.unmount();
  }
});

test("policy changes require a new intention and never confirm an outdated proof", async () => {
  const calls = fixture([
      { path: base + "/requests", result: pending() },
      {
        path: base + `/requests/${firstRequest}/complete`,
        result: failure("POLICY_CHANGED"),
      },
      { path: base + "/requests", result: pending(secondRequest) },
    ]),
    view = await mount();
  try {
    await click(button(view.container, "Request email code"));
    await enter(view.container, mailboxToken);
    await submit(view.container);
    assert.match(view.container.textContent!, /Admission rules changed/);
    assert.equal(input(view.container).disabled, true);
    assert.ok(!view.container.textContent!.includes("Verify and join"));
    await submit(view.container);
    assert.equal(
      calls.length,
      2,
      "A changed policy must stop proof submission",
    );
    await click(button(view.container, "Request another code"));
    assert.equal(input(view.container).disabled, false);
    assert.equal(input(view.container).value, "");
    assert.equal(calls.length, 3);
  } finally {
    await view.unmount();
  }
});

test("suspended, Guest, completed and denied admission remain blocked without membership selection or automatic promotion", async () => {
  for (const [code, text] of [
    ["MEMBERSHIP_SUSPENDED", /suspended/],
    ["TYPE_CHANGE_REQUIRED", /guest access/],
    ["ADMISSION_ALREADY_COMPLETED", /already complete/],
    ["RESOURCE_NOT_FOUND", /unavailable for this account/],
  ] as [string, RegExp][]) {
    const calls = fixture([
        {
          path: base + "/requests",
          result: failure(code, code === "RESOURCE_NOT_FOUND" ? 404 : 409),
        },
      ]),
      view = await mount();
    try {
      await click(button(view.container, "Request email code"));
      assert.match(view.container.textContent!, text as RegExp);
      assert.equal(view.callbacks.joined.length, 0);
      assert.equal(view.container.querySelector("input,select"), null);
      assert.equal(view.container.querySelectorAll("button").length, 1);
      assert.equal(calls.length, 1);
    } finally {
      await view.unmount();
    }
  }
});

test("service and session errors offer only supported recovery; sign in removes proof from this page", async () => {
  const calls = fixture([
      {
        path: base + "/requests",
        result: failure("POLICY_CONSUMER_UNAVAILABLE", 503),
      },
      { path: base + "/requests", result: failure("UNAUTHENTICATED", 401) },
    ]),
    view = await mount();
  try {
    await click(button(view.container, "Request email code"));
    assert.match(view.container.textContent!, /temporarily unavailable/);
    assert.ok(button(view.container, "Try again"));
    await click(button(view.container, "Try again"));
    assert.ok(button(view.container, "Sign in to my account"));
    assert.equal(view.callbacks.joined.length, 0);
    await click(button(view.container, "Sign in to my account"));
    assert.equal(view.callbacks.signIns, 1);
    assert.equal(calls.length, 2);
    safeSurfaces(view.container, calls);
  } finally {
    await view.unmount();
  }
});

test("cancellation and organization changes abort outstanding work and clear native proof fields", async () => {
  const completing = deferred(),
    calls = fixture([
      {
        path: base + `/requests/${firstRequest}/complete`,
        result: completing.promise,
      },
    ]),
    view = await mount({ initialRequestId: firstRequest, linkToken });
  try {
    const oldInput = input(view.container);
    await enter(view.container, mailboxToken);
    await submit(view.container);
    await click(button(view.container, "Cancel"));
    assert.equal(oldInput.value, "");
    assert.equal(calls[0].options.signal!.aborted, true);
    assert.equal(view.callbacks.cancels, 1);
    await act(async () => completing.resolve(joined()));
    assert.equal(view.callbacks.joined.length, 0);
    assert.equal(view.container.querySelector("input"), null);
    await view.rerender({
      orgId: otherOrg,
      initialRequestId: undefined,
      linkToken: undefined,
    });
    assert.equal(view.container.querySelector("input"), null);
    assert.ok(button(view.container, "Request email code"));
    safeSurfaces(view.container, calls);
  } finally {
    await view.unmount();
  }
  const pendingComplete = deferred();
  fixture([
    {
      path: base + `/requests/${firstRequest}/complete`,
      result: pendingComplete.promise,
    },
  ]);
  const next = await mount({ initialRequestId: firstRequest });
  const nativeInput = input(next.container);
  await enter(next.container, mailboxToken);
  await submit(next.container);
  await next.unmount();
  assert.ok(
    nativeInput.value.length === 0,
    "Native proof must be blank on unmount",
  );
  await act(async () => pendingComplete.resolve(joined()));
  assert.equal(next.callbacks.joined.length, 0);
});

test("a failed shell refresh retains confirmed membership and retries only the shell callback", async () => {
  let opens = 0;
  const calls = fixture([
    { path: base + `/requests/${firstRequest}/complete`, result: joined() },
  ]);
  const view = await mount({
    initialRequestId: firstRequest,
    onJoined: async () => {
      opens++;
      if (opens === 1) throw new Error(mailboxToken);
    },
  });
  try {
    await enter(view.container, mailboxToken);
    await submit(view.container);
    assert.match(view.container.textContent!, /access is confirmed/);
    assert.equal(view.container.querySelector("input"), null);
    safeSurfaces(view.container, calls);
    await click(button(view.container, "Open organization"));
    assert.equal(opens, 2);
    assert.equal(calls.length, 1);
  } finally {
    await view.unmount();
  }
});

test("all eight locales follow the real provider, interpolate account data and keep every action translated", async () => {
  fixture([]);
  const labels: Record<string, [string, string]> = {
    "pt-BR": ["Solicitar código por e-mail", "Cancelar"],
    "en-US": ["Request email code", "Cancel"],
    "es-ES": ["Solicitar código por correo", "Cancelar"],
    "fr-FR": ["Demander un code par e-mail", "Annuler"],
    "de-DE": ["Code per E-Mail anfordern", "Abbrechen"],
    "it-IT": ["Richiedi codice via e-mail", "Annulla"],
    "ja-JP": ["メールでコードを申請", "キャンセル"],
    "nl-NL": ["Code per e-mail aanvragen", "Annuleren"],
  };
  for (const [locale, [start, cancel]] of Object.entries(labels)) {
    const view = await mount(
      {
        organizationName: "Organization <safe>",
        accountEmail: "person@example.test",
      },
      locale,
    );
    try {
      assert.ok(button(view.container, start));
      assert.ok(button(view.container, cancel));
      assert.match(view.container.textContent!, /Organization <safe>/);
      assert.match(view.container.textContent!, /person@example.test/);
      assert.equal(view.container.querySelector("safe"), null);
      assert.equal(dom.window.document.documentElement.lang, locale);
    } finally {
      await view.unmount();
    }
  }
});

test("StrictMode effect replay does not discard a link and malformed identifiers never become API paths", async () => {
  const calls = fixture([{ path: base + "/link-requests", result: pending() }]),
    view = await mount({ linkToken }, "en-US", true);
  try {
    await view.rerender({ linkToken: undefined });
    await click(button(view.container, "Request email code"));
    assert.deepEqual(calls[0].body, { linkToken });
  } finally {
    await view.unmount();
  }
  const noCalls = fixture([]),
    invalid = await mount({
      orgId: "bad/" + linkToken,
      initialRequestId: mailboxToken,
    });
  try {
    assert.equal(invalid.container.querySelector("input"), null);
    await click(button(invalid.container, "Request email code"));
    assert.equal(noCalls.length, 0);
    safeSurfaces(invalid.container);
  } finally {
    await invalid.unmount();
  }
});

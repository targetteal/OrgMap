import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";

// UI contract tests use predetermined HTTP responses; they do not simulate or prove TOTP verification.
const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  { url: "http://mfa.localhost/account/security" },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLDialogElement",
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
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
const { createRoot } = await import("react-dom/client");
const vite = await createServer({
  root: new URL("../", import.meta.url).pathname,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: "custom",
});
const { MfaSettings } = await vite.ssrLoadModule(
  "/src/account/MfaSettings.tsx",
);
const { LocalizationProvider } = await vite.ssrLoadModule(
  "/src/localization/index.tsx",
);
const { setCsrf } = await vite.ssrLoadModule("/src/api.ts");
const originalFetch = globalThis.fetch;
const response = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { requestId: "synthetic" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const failure = (code: string, status = 401) =>
  new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const deferred = () => {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const seed = (secret: string) => ({
  secret,
  issuer: "OrgMap",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
});
const firstSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const secondSecret = "KRUGS4ZANFZSAYJAORSXG5BAONSWG4TF";
type Call = { path: string; options: RequestInit; body: any };
type Step = {
  path: string;
  method?: string;
  result: Response | Promise<Response>;
};
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
    assert.ok(next, "Unexpected HTTP request");
    assert.equal(path, "/api/v1" + next.path);
    assert.equal(options.method, next.method ?? "GET");
    return next.result;
  };
  return calls;
}
async function mount(
  passwordEnabled = true,
  locale = "en-US",
  providerLocale = locale,
) {
  const container = dom.window.document.querySelector("main")!,
    root = createRoot(container);
  await act(async () =>
    root.render(
      <LocalizationProvider preferences={{ locale: providerLocale }}>
        <MfaSettings passwordEnabled={passwordEnabled} locale={locale} />
      </LocalizationProvider>,
    ),
  );
  return {
    container,
    root,
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}
const button = (container: Element, label: string) => {
  const result = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent === label);
  assert.ok(result, "Missing button: " + label);
  return result;
};
const input = (container: Element, name: string) => {
  const element = container.querySelector<HTMLInputElement>(
    `input[name="${name}"]`,
  );
  assert.ok(element, "Missing input: " + name);
  return element;
};
const enter = async (element: HTMLInputElement, value: string) => {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};
const click = async (element: HTMLButtonElement) => {
  await act(async () => element.click());
};
const submit = async (container: Element) => {
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
};
const noSecretOutsideEnrollment = (
  container: Element,
  secrets = [firstSecret, secondSecret],
) => {
  for (const secret of secrets) {
    assert.ok(!container.textContent?.includes(secret));
    assert.ok(!dom.window.location.href.includes(secret));
    assert.ok(!JSON.stringify({ ...dom.window.localStorage }).includes(secret));
    assert.ok(
      !JSON.stringify({ ...dom.window.sessionStorage }).includes(secret),
    );
    for (const element of container.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input,textarea"))
      assert.ok(!element.value.includes(secret));
  }
};

test.after(async () => {
  globalThis.fetch = originalFetch;
  await vite.close();
  dom.window.close();
});

test("status loads, fails explicitly and retries without exposing controls for an unknown state", async () => {
  const initial = deferred(),
    calls = fixture([
      { path: "/account/mfa", result: initial.promise },
      {
        path: "/account/mfa",
        result: response({ enabled: false, factorRevision: 0 }),
      },
    ]);
  const view = await mount();
  try {
    assert.match(
      view.container.querySelector("[role=status]")!.textContent!,
      /Checking/,
    );
    assert.equal(view.container.querySelector("button"), null);
    await act(async () => initial.resolve(failure("NETWORK_ERROR", 503)));
    assert.match(
      view.container.querySelector("[role=alert]")!.textContent!,
      /Unable to connect/,
    );
    await click(button(view.container, "Check status"));
    assert.ok(button(view.container, "Set up authenticator"));
    assert.equal(calls.length, 2);
  } finally {
    await view.unmount();
  }
});

test("enrollment locks pending fields, preserves recoverable inputs and confirms with only the six-digit code", async () => {
  const start = deferred(),
    confirm = deferred();
  const calls = fixture([
    {
      path: "/account/mfa",
      result: response({ enabled: false, factorRevision: 0 }),
    },
    {
      path: "/account/mfa/enrollment/start",
      method: "POST",
      result: start.promise,
    },
    {
      path: "/account/mfa/enrollment/confirm",
      method: "POST",
      result: failure("MFA_VERIFICATION_REQUIRED"),
    },
    {
      path: "/account/mfa/enrollment/confirm",
      method: "POST",
      result: confirm.promise,
    },
    {
      path: "/account/mfa",
      result: response({ enabled: true, factorRevision: 1 }),
    },
  ]);
  setCsrf("synthetic-csrf");
  const storageWrite = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () => {
    assert.fail("MFA must not write to browser storage");
  };
  const view = await mount();
  try {
    const trigger = button(view.container, "Set up authenticator");
    await click(trigger);
    assert.equal(
      dom.window.document.activeElement,
      input(view.container, "currentPassword"),
    );
    await enter(input(view.container, "currentPassword"), "synthetic-password");
    await submit(view.container);
    assert.equal(input(view.container, "currentPassword").readOnly, true);
    assert.ok(
      Array.from(
        view.container.querySelectorAll<HTMLButtonElement>("dialog button"),
      ).every((item) => item.disabled),
    );
    await submit(view.container);
    assert.equal(
      calls.length,
      2,
      "A duplicate pending submit must not issue a request",
    );
    const cancel = new dom.window.Event("cancel", { cancelable: true });
    view.container.querySelector("dialog")!.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.ok(view.container.querySelector("dialog"));
    await act(async () => start.resolve(response(seed(firstSecret))));
    assert.equal(
      view.container.querySelector<HTMLTextAreaElement>("textarea")!.value,
      firstSecret,
    );
    assert.equal(
      view.container.querySelector('input[name="currentPassword"]'),
      null,
    );
    assert.equal(
      dom.window.document.activeElement,
      input(view.container, "code"),
    );
    assert.match(view.container.textContent!, /manual entry/);
    assert.match(view.container.textContent!, /30 seconds/);
    assert.equal(
      view.container.querySelector("img,iframe,a[href],script[src]"),
      null,
      "Setup must not exfiltrate a seed through a remote asset",
    );
    assert.equal(dom.window.localStorage.length, 0);
    assert.equal(dom.window.sessionStorage.length, 0);
    assert.ok(
      !calls.some(
        (call) =>
          call.path.includes(firstSecret) ||
          (JSON.stringify(call.body) ?? "").includes(firstSecret),
      ),
    );
    assert.equal(
      new dom.window.FormData(view.container.querySelector("form")!).has(
        "secret",
      ),
      false,
    );
    await enter(input(view.container, "code"), "012345");
    await submit(view.container);
    assert.equal(input(view.container, "code").value, "012345");
    assert.equal(
      view.container.querySelector<HTMLTextAreaElement>("textarea")!.value,
      firstSecret,
    );
    assert.match(
      view.container.querySelector("[role=alert]")!.textContent!,
      /not accepted/,
    );
    await enter(input(view.container, "code"), "023456");
    await submit(view.container);
    assert.equal(input(view.container, "code").readOnly, true);
    await act(async () =>
      confirm.resolve(response({ enabled: true, factorRevision: 1 })),
    );
    assert.equal(view.container.querySelector("dialog"), null);
    noSecretOutsideEnrollment(view.container);
    assert.ok(button(view.container, "Disable two-step authentication"));
    assert.equal(
      dom.window.document.activeElement,
      view.container.querySelector("[role=status]"),
    );
    assert.deepEqual(calls[1].body, { currentPassword: "synthetic-password" });
    assert.deepEqual(calls[2].body, { code: "012345" });
    assert.deepEqual(calls[3].body, { code: "023456" });
    assert.equal(
      (calls[1].options.headers as Record<string, string>)["X-CSRF-Token"],
      "synthetic-csrf",
    );
    assert.ok(
      (calls[1].options.headers as Record<string, string>)["Idempotency-Key"],
    );
    assert.notEqual(
      (calls[1].options.headers as Record<string, string>)["Idempotency-Key"],
      (calls[2].options.headers as Record<string, string>)["Idempotency-Key"],
    );
    assert.equal(
      calls.at(-1)!.options.method,
      "GET",
      "A successful mutation must reload authoritative status",
    );
  } finally {
    await view.unmount();
    dom.window.Storage.prototype.setItem = storageWrite;
  }
});

test("a replacement key, cancellation and unmount remove the previous setup secret", async () => {
  const calls = fixture([
    {
      path: "/account/mfa",
      result: response({ enabled: false, factorRevision: 0 }),
    },
    {
      path: "/account/mfa/enrollment/start",
      method: "POST",
      result: response(seed(firstSecret)),
    },
    {
      path: "/account/mfa/enrollment/start",
      method: "POST",
      result: failure("REAUTHENTICATION_REQUIRED"),
    },
    {
      path: "/account/mfa/enrollment/start",
      method: "POST",
      result: response(seed(secondSecret)),
    },
    {
      path: "/account/mfa/enrollment/start",
      method: "POST",
      result: response(seed(firstSecret)),
    },
    {
      path: "/account/mfa",
      result: response({ enabled: false, factorRevision: 0 }),
    },
  ]);
  const view = await mount();
  await click(button(view.container, "Set up authenticator"));
  await enter(input(view.container, "currentPassword"), "synthetic-password");
  await submit(view.container);
  assert.equal(
    view.container.querySelector<HTMLTextAreaElement>("textarea")!.value,
    firstSecret,
  );
  await click(button(view.container, "Generate another key"));
  noSecretOutsideEnrollment(view.container);
  assert.match(view.container.textContent!, /invalidates the previous/);
  await enter(
    input(view.container, "currentPassword"),
    "synthetic-wrong-password",
  );
  await submit(view.container);
  assert.equal(
    input(view.container, "currentPassword").value,
    "synthetic-wrong-password",
  );
  noSecretOutsideEnrollment(view.container);
  await enter(input(view.container, "currentPassword"), "synthetic-password");
  await submit(view.container);
  assert.equal(
    view.container.querySelector<HTMLTextAreaElement>("textarea")!.value,
    secondSecret,
  );
  await click(button(view.container, "Cancel"));
  noSecretOutsideEnrollment(view.container);
  await click(button(view.container, "Set up authenticator"));
  await enter(input(view.container, "currentPassword"), "synthetic-password");
  await submit(view.container);
  await view.unmount();
  noSecretOutsideEnrollment(view.container);
  const remount = await mount();
  try {
    noSecretOutsideEnrollment(remount.container);
    assert.equal(calls.length, 6);
  } finally {
    await remount.unmount();
  }
});

test("disable accepts a recent-session omission, requires a code on server demand and preserves password on failure", async () => {
  const disable = deferred(),
    calls = fixture([
      {
        path: "/account/mfa",
        result: response({ enabled: true, factorRevision: 3 }),
      },
      {
        path: "/account/mfa/disable",
        method: "POST",
        result: failure("MFA_VERIFICATION_REQUIRED"),
      },
      { path: "/account/mfa/disable", method: "POST", result: disable.promise },
      {
        path: "/account/mfa",
        result: response({ enabled: false, factorRevision: 4 }),
      },
    ]);
  const view = await mount();
  try {
    await click(button(view.container, "Disable two-step authentication"));
    assert.equal(input(view.container, "code").required, false);
    await enter(input(view.container, "currentPassword"), "synthetic-password");
    await submit(view.container);
    assert.equal(
      input(view.container, "currentPassword").value,
      "synthetic-password",
    );
    assert.equal(input(view.container, "code").required, true);
    assert.equal(
      dom.window.document.activeElement,
      input(view.container, "code"),
    );
    assert.deepEqual(calls[1].body, { currentPassword: "synthetic-password" });
    await enter(input(view.container, "code"), "12345");
    await submit(view.container);
    assert.equal(calls.length, 2);
    assert.match(
      input(view.container, "code").validationMessage,
      /exactly 6 digits/,
    );
    await enter(input(view.container, "code"), "012345");
    await submit(view.container);
    assert.equal(input(view.container, "currentPassword").readOnly, true);
    assert.equal(input(view.container, "code").readOnly, true);
    await act(async () =>
      disable.resolve(response({ enabled: false, factorRevision: 4 })),
    );
    assert.deepEqual(calls[2].body, {
      currentPassword: "synthetic-password",
      code: "012345",
    });
    assert.ok(button(view.container, "Set up authenticator"));
    assert.match(view.container.textContent!, /authentication disabled/);
    noSecretOutsideEnrollment(view.container);
  } finally {
    await view.unmount();
  }
});

test("password-disabled enrollment relies on fresh federated authentication enforced by the server", async () => {
  const calls = fixture([
    {
      path: "/account/mfa",
      result: response({ enabled: false, factorRevision: 0 }),
    },
    {
      path: "/account/mfa/enrollment/start",
      method: "POST",
      result: failure("REAUTHENTICATION_REQUIRED"),
    },
    {
      path: "/account/mfa/enrollment/start",
      method: "POST",
      result: response(seed(firstSecret)),
    },
  ]);
  const view = await mount(false);
  try {
    await click(button(view.container, "Set up authenticator"));
    assert.equal(view.container.querySelector('input[type="password"]'), null);
    assert.match(
      view.container.textContent!,
      /identity provider within the last 5 minutes/,
    );
    await submit(view.container);
    assert.match(
      view.container.querySelector("[role=alert]")!.textContent!,
      /Sign in again through your identity provider/,
    );
    assert.deepEqual(calls[1].body, {});
    await submit(view.container);
    assert.equal(
      view.container.querySelector<HTMLTextAreaElement>("textarea")!.value,
      firstSecret,
    );
    assert.deepEqual(calls[2].body, {});
    await click(button(view.container, "Close"));
    noSecretOutsideEnrollment(view.container);
  } finally {
    await view.unmount();
  }
});

test("server configuration failures are explicit and an unmounted pending request cannot retain a key", async () => {
  const start = deferred(),
    calls = fixture([
      {
        path: "/account/mfa",
        result: response({ enabled: false, factorRevision: 0 }),
      },
      {
        path: "/account/mfa/enrollment/start",
        method: "POST",
        result: failure("MFA_CONFIGURATION_REQUIRED", 503),
      },
      {
        path: "/account/mfa/enrollment/start",
        method: "POST",
        result: start.promise,
      },
      {
        path: "/account/mfa",
        result: response({ enabled: false, factorRevision: 0 }),
      },
    ]);
  const view = await mount();
  await click(button(view.container, "Set up authenticator"));
  await enter(input(view.container, "currentPassword"), "synthetic-password");
  await submit(view.container);
  assert.match(
    view.container.querySelector("[role=alert]")!.textContent!,
    /MFA_CONFIGURATION_REQUIRED/,
  );
  assert.equal(
    input(view.container, "currentPassword").value,
    "synthetic-password",
  );
  await submit(view.container);
  await view.unmount();
  assert.equal(calls[2].options.signal!.aborted, true);
  await act(async () => start.resolve(response(seed(firstSecret))));
  noSecretOutsideEnrollment(view.container);
  const remount = await mount();
  try {
    noSecretOutsideEnrollment(remount.container);
    assert.equal(remount.container.querySelector("dialog"), null);
  } finally {
    await remount.unmount();
  }
});

test("each supported locale owns the MFA copy and unsafe locale names fall back safely", async () => {
  const titles: Record<string, string> = {
    "pt-BR": "Autenticação em duas etapas",
    "en-US": "Two-step authentication",
    "es-ES": "Autenticación en dos pasos",
    "fr-FR": "Authentification en deux étapes",
    "de-DE": "Authentifizierung in zwei Schritten",
    "it-IT": "Autenticazione in due passaggi",
    "ja-JP": "2段階認証",
    "nl-NL": "Authenticatie in twee stappen",
    toString: "Autenticação em duas etapas",
  };
  for (const [locale, title] of Object.entries(titles)) {
    fixture([
      {
        path: "/account/mfa",
        result: response({ enabled: false, factorRevision: 0 }),
      },
    ]);
    const view = await mount(true, locale, "de-DE");
    try {
      assert.equal(view.container.querySelector("h3")!.textContent, title);
      assert.ok(!view.container.textContent!.includes("[object"));
      assert.ok(!view.container.textContent!.includes("mfa."));
    } finally {
      await view.unmount();
    }
  }
  fixture([{ path: "/account/mfa", result: failure("NETWORK_ERROR") }]);
  const view = await mount(true, "en-US", "de-DE");
  try {
    assert.match(
      view.container.querySelector("[role=alert]")!.textContent!,
      /Unable to connect/,
    );
  } finally {
    await view.unmount();
  }
});

test("provider locale changes translate existing errors, validation and success without refetching or replacing pending inputs", async () => {
  const start = deferred(),
    calls = fixture([
      {
        path: "/account/mfa",
        result: new Response(
          JSON.stringify({
            error: { code: "NETWORK_ERROR", message: "SYNTHETIC_RAW_PRIVATE" },
          }),
          { status: 503 },
        ),
      },
      {
        path: "/account/mfa",
        result: response({ enabled: false, factorRevision: 0 }),
      },
      {
        path: "/account/mfa/enrollment/start",
        method: "POST",
        result: start.promise,
      },
      {
        path: "/account/mfa/enrollment/start",
        method: "POST",
        result: response(seed(firstSecret)),
      },
      {
        path: "/account/mfa/enrollment/confirm",
        method: "POST",
        result: response({ enabled: true, factorRevision: 1 }),
      },
      {
        path: "/account/mfa",
        result: response({ enabled: true, factorRevision: 1 }),
      },
    ]);
  const container = dom.window.document.querySelector("main")!,
    root = createRoot(container);
  const render = async (locale: string) => {
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={{ locale }}>
          <MfaSettings passwordEnabled />
        </LocalizationProvider>,
      ),
    );
  };
  try {
    await render("en-US");
    assert.match(
      container.querySelector("[role=alert]")!.textContent!,
      /Unable to connect/,
    );
    await render("ja-JP");
    assert.match(
      container.querySelector("[role=alert]")!.textContent!,
      /サーバーに接続できません/,
    );
    assert.ok(!container.textContent!.includes("SYNTHETIC_RAW_PRIVATE"));
    assert.equal(
      calls.length,
      1,
      "Translating an existing error must not refetch",
    );
    await click(button(container, "状態を確認"));
    await click(button(container, "認証アプリを設定"));
    const password = input(container, "currentPassword"),
      dialog = container.querySelector("dialog");
    await enter(password, "synthetic-password");
    await submit(container);
    const focusBefore = dom.window.document.activeElement;
    await render("de-DE");
    assert.equal(input(container, "currentPassword"), password);
    assert.equal(password.value, "synthetic-password");
    assert.equal(password.readOnly, true);
    assert.equal(container.querySelector("dialog"), dialog);
    assert.equal(dom.window.document.activeElement, focusBefore);
    assert.equal(calls.length, 3);
    await act(async () => start.resolve(failure("REAUTHENTICATION_REQUIRED")));
    assert.match(
      container.querySelector("[role=alert]")!.textContent!,
      /Bestätigen Sie Ihr aktuelles Passwort/,
    );
    await render("en-US");
    assert.match(
      container.querySelector("[role=alert]")!.textContent!,
      /Confirm your current password/,
    );
    assert.equal(input(container, "currentPassword"), password);
    assert.equal(password.value, "synthetic-password");
    assert.equal(calls.length, 3);
    await submit(container);
    const code = input(container, "code");
    await enter(code, "123");
    await submit(container);
    assert.match(code.validationMessage, /exactly 6 digits/);
    await render("ja-JP");
    assert.equal(input(container, "code"), code);
    assert.equal(code.value, "123");
    assert.match(code.validationMessage, /6桁の数字/);
    assert.equal(
      container.querySelector<HTMLTextAreaElement>("textarea")!.value,
      firstSecret,
    );
    assert.equal(calls.length, 4);
    await enter(code, "012345");
    await submit(container);
    const success = container.querySelector("[role=status]")!;
    assert.match(success.textContent!, /2段階認証を有効にしました/);
    assert.equal(dom.window.document.activeElement, success);
    await render("en-US");
    assert.equal(container.querySelector("[role=status]"), success);
    assert.match(success.textContent!, /Two-step authentication enabled/);
    assert.equal(dom.window.document.activeElement, success);
    assert.equal(calls.length, 6);
    noSecretOutsideEnrollment(container);
  } finally {
    await act(async () => root.unmount());
  }
});

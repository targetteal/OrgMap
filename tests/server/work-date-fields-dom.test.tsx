import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { normalizePreferences } from "../../packages/i18n/index.js";
import { workDateTimeFromForm } from "../../web/src/features/work/calendar.js";
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
const { DateFields } =
  await import("../../web/src/features/work/date-fields.js");
test("account-zone date editor exposes DST choice, validates gaps, preserves old precision and locks pending edits", async () => {
  const container = dom.window.document.querySelector("main")!,
    root = createRoot(container),
    prefs = normalizePreferences({
      locale: "en-US",
      timeZone: "America/Los_Angeles",
    }),
    original = "2026-11-01T09:30:42.123456Z",
    task = { id: "synthetic", version: 1, startsAt: original, endsAt: null };
  const render = (pending = false, current: typeof task | undefined = task) => (
    <LocalizationProvider preferences={prefs}>
      <form>
        <DateFields task={current} pending={pending} />
      </form>
    </LocalizationProvider>
  );
  const change = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(render()));
    let input = container.querySelector<HTMLInputElement>(
        "input[name=startsAt]",
      )!,
      select = container.querySelector<HTMLSelectElement>(
        "select[name=startsAtChoice]",
      )!;
    assert.equal(input.value, "2026-11-01T01:30");
    assert.equal(select.options.length, 3);
    assert.equal(select.value, "2026-11-01T09:30:00.000Z");
    assert.equal(select.checkValidity(), true);
    assert.equal(
      workDateTimeFromForm(
        new dom.window.FormData(
          container.querySelector("form")!,
        ) as unknown as FormData,
        "startsAt",
        prefs,
      ),
      original,
    );
    assert.ok(select.options[1].text.includes("GMT-7"));
    assert.ok(select.options[2].text.includes("GMT-8"));
    await act(async () => root.render(render(true)));
    assert.equal(input.readOnly, true);
    assert.equal(select.disabled, true);
    await act(async () => root.render(render(false, undefined))); // A distinct empty scope.
    await act(async () =>
      root.render(
        <LocalizationProvider preferences={prefs}>
          <form>
            <DateFields />
          </form>
        </LocalizationProvider>,
      ),
    );
    input = container.querySelector<HTMLInputElement>("input[name=startsAt]")!;
    await change(input, "2026-03-08T02:30");
    assert.equal(input.validity.customError, true);
    assert.match(input.validationMessage, /does not exist/);
    await change(input, "2026-11-01T01:30");
    select = container.querySelector<HTMLSelectElement>(
      "select[name=startsAtChoice]",
    )!;
    assert.equal(input.validity.customError, false);
    assert.equal(select.value, "");
    assert.equal(select.checkValidity(), false);
    await act(async () => {
      select.value = "2026-11-01T08:30:00.000Z";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(select.checkValidity(), true);
    assert.equal(
      workDateTimeFromForm(
        new dom.window.FormData(
          container.querySelector("form")!,
        ) as unknown as FormData,
        "startsAt",
        prefs,
      ),
      "2026-11-01T08:30:00.000Z",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

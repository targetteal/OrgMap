import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import {
  workLocales,
  workTranslator,
} from "../../web/src/features/work/messages.js";
import type { FeatureContext } from "../../web/src/feature-contract.js";
const dom = new JSDOM(
  "<!doctype html><html><body><main></main></body></html>",
  { url: "http://work.localhost" },
);
for (const key of ["window", "document", "navigator", "HTMLElement", "Event"])
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
const { WorkStatisticsView } =
  await import("../../web/src/features/work/statistics-view.js");
test("statistics renders translated coverage and current scope denominators in all eight locales", async () => {
  const container = dom.window.document.querySelector("main")!;
  const data = {
    totalProjects: 3,
    total: 8,
    completed: 4,
    completedPercent: 50,
    byStatus: { TODO: 2, DONE: 4, IN_PROGRESS: 1, BLOCKED: 1 },
    created: 2,
    changes: 3,
    activeCircleRate: 50,
    activeCircles: 1,
    circlesWithProjects: 2,
    activeUserRate: 50,
    activeParticipants: 2,
    participants: 4,
    coverage: {
      state: "PARTIAL",
      firstObserved: "2026-10-18T00:00:00Z",
      unknownCreationDates: 3,
      unknownActivityActors: 5,
    },
  };
  for (const locale of workLocales) {
    const text = workTranslator(locale),
      root = createRoot(container),
      context = {
        organizationId: "synthetic",
        api: async () => ({ data }),
        navigate: () => {},
      } as unknown as FeatureContext;
    try {
      await act(async () =>
        root.render(
          <LocalizationProvider
            preferences={{ locale, timeZone: "Asia/Tokyo" }}
          >
            <WorkStatisticsView context={context} formatError={String} />
          </LocalizationProvider>,
        ),
      );
      assert.equal(
        container.querySelector("h2")!.textContent,
        text("Configurações"),
      );
      assert.ok(
        container.textContent!.includes(
          text(
            "Cobertura parcial: as primeiras observações começam dentro deste período.",
          ),
        ),
      );
      assert.ok(
        container.textContent!.includes(
          text(
            "{active} de {total} círculos vinculados aos projetos do escopo atual.",
            { active: "1", total: "2" },
          ),
        ),
      );
      assert.ok(
        container.textContent!.includes(
          text(
            "{active} de {total} participantes atuais desses projetos. Não representa todos os membros da organização.",
            { active: "2", total: "4" },
          ),
        ),
      );
      assert.equal(container.querySelectorAll("progress").length, 4);
      assert.equal(container.querySelectorAll("select option").length, 25);
      assert.equal(
        container.querySelector("nav")!.getAttribute("aria-label"),
        text("Configurações dos projetos"),
      );
      assert.ok(!container.textContent!.includes("{active}"));
    } finally {
      await act(async () => root.unmount());
    }
  }
});

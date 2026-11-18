// Deterministic UI race fixture. No server, credentials or domain data.
// Its promises deliberately ignore AbortSignal to exercise the UI's own fence.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import type { Envelope } from "../../../../packages/contracts";
import { ResourcePanel } from "./index";
import "../../styles.css";
const envelope = <T,>(data: T): Envelope<T> => ({
  data,
  meta: {
    requestId: "fixture",
    organizationId: null,
    resourceVersion: null,
    authorizationRevision: null,
    asOf: "2026-10-19T12:00:00Z",
  },
  capabilities: {},
});
const pending = new Map<string, Array<(value: Envelope<unknown>) => void>>();
const api: FeatureContext["api"] = async <T,>(path: string) => {
  const org = path.includes("/organizations/A/") ? "A" : "B";
  if (path.endsWith("/comments"))
    return new Promise<Envelope<T>>((resolve) => {
      const queue = pending.get(org) ?? [];
      queue.push(resolve as (value: Envelope<unknown>) => void);
      pending.set(org, queue);
    });
  if (path.endsWith("/capabilities"))
    return envelope({
      actions: { read: true },
      exportKinds: ["RESOURCES"],
      favorite: false,
      following: false,
    } as T);
  return envelope({ items: [] } as T);
};
function resolveComments(org: string) {
  const queue = pending.get(org) ?? [];
  pending.delete(org);
  for (const resolve of queue)
    resolve(
      envelope({
        items: [
          {
            id: org,
            authorId: org,
            content: "Comentário exclusivo de " + org,
            createdAt: "2026-10-19T12:00:00Z",
          },
        ],
      }),
    );
}
function ReadRacePreview() {
  const [org, setOrg] = useState("A");
  const context = {
    organizationId: org,
    api,
    members: [],
    notify: () => {},
    navigate: () => {},
  } as unknown as FeatureContext;
  return (
    <main style={{ padding: 32 }}>
      <h1>Isolamento de leituras · organização {org}</h1>
      <p>
        Fixture sintética: respostas de comentários controladas e sem
        cancelamento de transporte.
      </p>
      <div className="platform-toolbar">
        <button onClick={() => setOrg("A")}>Abrir organização A</button>
        <button onClick={() => setOrg("B")}>Abrir organização B</button>
        <button onClick={() => resolveComments("A")}>
          Resolver comentários de A
        </button>
        <button onClick={() => resolveComments("B")}>
          Resolver comentários de B
        </button>
      </div>
      <ResourcePanel context={context} type="fixture" resourceId="resource" />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<ReadRacePreview />);

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { request, setCsrf, errorMessage } from "../../api";
import { ValueEditor } from "./ValueEditor";
import type { EditorItem } from "./value-editor-state";
import "../../styles.css";
import "./structure.css";
function Preview() {
  const [item, setItem] = useState<EditorItem | null>(null),
    [org, setOrg] = useState(""),
    [entity, setEntity] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const me = await request<any>("/me");
    setCsrf(me.data.csrfToken);
    const organization = me.data.organizations[0];
    if (!organization) return;
    const p = "/organizations/" + organization.id;
    const [graph, catalog] = await Promise.all([
      request<any>(p + "/structure-advanced/graph"),
      request<any>(p + "/structure-advanced/catalog"),
    ]);
    const role = graph.data.entities.find((e: any) => e.kind === "ROLE");
    if (!role) return;
    const fields = await request<EditorItem[]>(
      p + "/structure-advanced/entities/" + role.id + "/fields",
    );
    const f = fields.data.find(
      (f) =>
        f.field.id ===
        catalog.data.fields.find((f: any) => f.key === "literal_options")?.id,
    );
    if (f) {
      setOrg(organization.id);
      setEntity(role.id);
      setItem(f);
    }
  }
  useEffect(() => {
    void load().catch(() => {});
  }, []);
  async function setup() {
    setBusy(true);
    setError("");
    try {
      const r = await request<any>("/auth/register", {
        method: "POST",
        body: {
          email: crypto.randomUUID() + "@example.test",
          password: "synthetic-multi-qa-password",
          displayName: "MULTI QA sintético",
        },
      });
      setCsrf(r.data.csrfToken);
      const created = await request<any>("/organizations", {
        method: "POST",
        body: { name: "MULTI literal · teste isolado" },
      });
      const p = "/organizations/" + created.data.organization.id;
      const boot = await request<any>(p + "/bootstrap");
      const role = await request<any>(p + "/roles", {
        method: "POST",
        body: {
          mode: "DIRECT",
          name: "Ensaios literais",
          circleId: boot.data.rootCircleId,
        },
      });
      const field = await request<any>(p + "/structure-advanced/fields", {
        method: "POST",
        body: {
          key: "literal_options",
          label: "Áreas de aprendizagem",
          target: "ROLE",
          schema: {
            type: "MULTI",
            required: false,
            options: ["Pesquisa, inovação", "Ação — 日本語", "duas  palavras"],
          },
          governed: false,
        },
      });
      await request(
        p +
          "/structure-advanced/entities/" +
          role.data.role.id +
          "/fields/" +
          field.data.id,
        {
          method: "PUT",
          version: 0,
          body: { value: ["Pesquisa, inovação", "Ação — 日本語"] },
        },
      );
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className="sa-page"
      style={{ maxWidth: 650, margin: "32px auto", padding: 24 }}
    >
      <h1>QA MULTI literal</h1>
      <p>Teste sintético local com PostgreSQL efêmero e API real.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {item ? (
        <>
          <ValueEditor
            organizationId={org}
            entityId={entity}
            item={item}
            disabled={busy}
            onSave={async (value) => {
              try {
                await request(
                  "/organizations/" +
                    org +
                    "/structure-advanced/entities/" +
                    entity +
                    "/fields/" +
                    item.field.id,
                  { method: "PUT", version: item.version, body: { value } },
                );
                await load();
                setNotice("Valor confirmado pela API.");
                return true;
              } catch (e) {
                setError(errorMessage(e));
                return false;
              }
            }}
          />
          <p>
            Valor atual da API: <output>{JSON.stringify(item.value)}</output>
          </p>
          <p>Versão atual: {item.version}</p>
          <button onClick={() => void load()}>Reler API</button>
        </>
      ) : (
        <button disabled={busy} onClick={() => void setup()}>
          {busy ? "Preparando…" : "Preparar cenário real"}
        </button>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

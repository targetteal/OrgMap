/** Development harness, actual API/DB, no mocked final data. */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { feature } from "./index";
import { AccountPage } from "../../account";
import { LocalizationProvider } from "../../localization";
import { request, setCsrf } from "../../api";
import type { FeatureContext } from "../../feature-contract";
import "../../styles.css";
await fetch(
  "/api/v1/preview/session" +
    (new URLSearchParams(location.search).get("role") === "GUEST"
      ? "?role=GUEST"
      : ""),
)
  .then((r) => r.json())
  .then(async ({ organizationId, projectId }) => {
    const session = (await request<any>("/me")).data;
    setCsrf(session.csrfToken);
    const b = await request<any>(`/organizations/${organizationId}/bootstrap`);
    const guest = b.data.membership.memberType === "GUEST";
    const [s, m] = guest
      ? [{ data: { entities: [], occupancies: [] } }, { data: { items: [] } }]
      : await Promise.all([
          request<any>(`/organizations/${organizationId}/structure`),
          request<any>(`/organizations/${organizationId}/members`),
        ]);
    function Preview() {
      const [path, setPath] = useState(
          location.hash.slice(1) ||
            (projectId ? "/projects/" + projectId : "/projects"),
        ),
        [notice, setNotice] = useState("");
      const context: FeatureContext = {
        organizationId,
        session,
        bootstrap: b.data,
        structure: s.data,
        members: m.data.items,
        path,
        navigate: (p) => {
          history.replaceState(
            null,
            "",
            location.pathname + location.search + "#" + p,
          );
          setPath(p);
        },
        api: request,
        refresh: () => {},
        notify: setNotice,
      };
      const Component = feature.Component,
        Sidebar = feature.sidebar!;
      return (
        <div className="app-shell">
          <nav className="module-rail" aria-label="Módulos">
            <button>Estrutura</button>
            <button>Objetivos</button>
            <button className="active">Projetos</button>
            <button>Reuniões</button>
            <button>Membros</button>
          </nav>
          <aside className="sidebar">
            <div className="sidebar-title">
              <h1>Projetos</h1>
            </div>
            <Sidebar context={context} />
          </aside>
          <div className="workspace">
            <header className="topbar">
              <small>QA local · organização sintética</small>
              <button onClick={() => context.navigate("/account/preferences")}>
                Preferências da conta
              </button>
              <button onClick={() => setPath("/projects")}>
                Todos os projetos
              </button>
              <button onClick={() => setPath("/projects/tasks")}>
                {guest ? "Tarefas compartilhadas" : "Minhas tarefas"}
              </button>
            </header>
            <main className="main-content">
              {path.startsWith("/account") ? (
                <AccountPage
                  path={path}
                  navigate={context.navigate}
                  notify={context.notify}
                />
              ) : (
                <Component context={context} />
              )}
            </main>
          </div>
          {notice && (
            <div className="toast" role="status" onClick={() => setNotice("")}>
              {notice}
            </div>
          )}
        </div>
      );
    }
    createRoot(document.getElementById("root")!).render(
      <LocalizationProvider accountId={session.account.id}>
        <Preview />
      </LocalizationProvider>,
    );
  })
  .catch((e) => {
    document.getElementById("root")!.textContent = String(e);
  });

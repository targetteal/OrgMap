import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { feature } from "./index";
import {
  request,
  setCsrf,
  type Session,
  type Bootstrap,
  type Structure,
  type Member,
} from "../../api";
import type { FeatureContext } from "../../feature-contract";
import "../../styles.css";
function Preview() {
  const [ctx, setCtx] = useState<FeatureContext | null>(null),
    [path, setPath] = useState(
      new URLSearchParams(location.search).get("path") ?? "/goals",
    ),
    [organizationId,setOrganizationId]=useState(new URLSearchParams(location.search).get("organizationId")??""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const ctrl = new AbortController();
    setCtx(null);setError("");
    async function init() {
      let session: Session;
      try {
        session = (await request<Session>("/me", { signal: ctrl.signal })).data;
      } catch {
        session = (
          await request<Session>("/auth/register", {
            method: "POST",
            body: {
              displayName: "Pessoa da prévia",
              email: crypto.randomUUID() + "@preview.example.test",
              password: "local-preview-only-12345",
            },
          })
        ).data;
      }
      setCsrf(session.csrfToken);
      if (!session.organizations?.length) {
        await request("/organizations", {
          method: "POST",
          body: { name: "Organização sintética · QA Objetivos" },
        });
        session = (await request<Session>("/me", { signal: ctrl.signal })).data;
        setCsrf(session.csrfToken);
      }
      const org = session.organizations.find(o=>o.id===organizationId)?.id??session.organizations[0].id;
      const [b, s, m] = await Promise.all([
        request<Bootstrap>("/organizations/" + org + "/bootstrap", {
          signal: ctrl.signal,
        }),
        request<Structure>("/organizations/" + org + "/structure", {
          signal: ctrl.signal,
        }),
        request<any>("/organizations/" + org + "/members", {
          signal: ctrl.signal,
        }),
      ]);
      if (!ctrl.signal.aborted)
        setCtx({
          organizationId: org,
          session,
          bootstrap: b.data,
          structure: s.data,
          members: (m.data.items ?? m.data.members ?? m.data) as Member[],
          path,
          navigate: setPath,
          api: request,
          refresh: () => {},
          notify: setNotice,
        });
    }
    void init().catch((e) => setError(String(e)));
    return () => ctrl.abort();
  }, [organizationId]);
  useEffect(() => {
    history.replaceState(null,"","?path="+encodeURIComponent(path)+(ctx?"&organizationId="+ctx.organizationId:""));
  }, [path,ctx?.organizationId]);
  if (error) return <p role="alert">{error}</p>;
  if (!ctx) return <p role="status">Preparando prévia isolada…</p>;
  const Component = feature.Component,
    Sidebar = feature.sidebar;
  return (
    <>
      <div className="app-shell">
        <nav className="module-rail" aria-label="Módulos">
          <button className="active" onClick={() => setPath("/goals")}>
            Objetivos
          </button>
        </nav>
        <aside className="sidebar">
          <div className="sidebar-title">
            <h2>Objetivos</h2>
          </div>
          {Sidebar && <Sidebar context={{ ...ctx, path }} />}
        </aside>
        <div className="workspace">
          <header className="topbar">
            <span className="goals-preview-label">OrgMap · QA Objetivos</span>
            <select aria-label="Organização da prévia" style={{maxWidth:230,minWidth:0,flex:1}} value={ctx.organizationId} onChange={e=>{setPath('/goals');setOrganizationId(e.target.value);}}>{ctx.session.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
            <button aria-label="Criar organização vazia" type="button" onClick={async()=>{try{const r=await request<any>('/organizations',{method:'POST',body:{name:'Organização vazia · QA Objetivos'}});setPath('/goals');setOrganizationId(r.data.organization.id);}catch(e){setError(String(e));}}}>Nova organização</button>
          </header>
          <main>
            <Component key={ctx.organizationId} context={{ ...ctx, path }} />
          </main>
        </div>
      </div>
      {notice && (
        <div role="status" className="toast" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

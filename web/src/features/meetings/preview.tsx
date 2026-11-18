import { LocalizationProvider } from "../../localization";
import { AccountPage } from "../../account";
// Real-API verification harness; no fixtures, mock data, credentials or tenant singleton.
import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { request, setCsrf, errorMessage, type Session } from "../../api";
import { feature } from "./index";
import { feature as platformFeature } from "../platform";
import type { FeatureContext } from "../../feature-contract";
import "../../styles.css";
import "./preview.css";
function Preview() {
  const [session, setSession] = useState<Session | null>(null),
    [ctx, setCtx] = useState<FeatureContext | null>(null),
    [path, setPath] = useState(location.hash.slice(1) || "/app/meeting"),
    [error, setError] = useState(""),
    [login, setLogin] = useState(false);
  const navigate = (p: string) => {
    location.hash = p;
    setPath(p);
  };
  useEffect(() => {
    const c = new AbortController();
    request<Session>("/me", { signal: c.signal })
      .then((r) => {
        setCsrf(r.data.csrfToken);
        setSession(r.data);
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!session?.organizations.length) return;
    const c = new AbortController(),
      oid = session.organizations[0].id;
    void Promise.all([
      request<any>(`/organizations/${oid}/bootstrap`, { signal: c.signal }),
      request<any>(`/organizations/${oid}/structure`, { signal: c.signal }),
      request<any>(`/organizations/${oid}/members`, { signal: c.signal }),
    ])
      .then(([b, s, m]) =>
        setCtx({
          organizationId: oid,
          session,
          bootstrap: b.data,
          structure: s.data,
          members: m.data.items,
          path,
          navigate,
          api: request,
          refresh: () => {},
          notify: () => {},
        }),
      )
      .catch((e) => setError(errorMessage(e)));
    return () => c.abort();
  }, [session]);
  async function enter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      if (!session) {
        const r = await request<any>(login ? "/auth/login" : "/auth/register", {
          method: "POST",
          body: {
            email: f.get("email"),
            password: f.get("password"),
            ...(login ? {} : { displayName: f.get("displayName") }),
          },
        });
        setCsrf(r.data.csrfToken);
        setSession({
          account: r.data.account,
          csrfToken: r.data.csrfToken,
          organizations: (await request<Session>("/me")).data.organizations,
        });
      } else {
        await request("/organizations", {
          method: "POST",
          body: { name: f.get("name") },
        });
        const r = await request<Session>("/me");
        setSession(r.data);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (!ctx)
    return (
      <main className="auth-page">
        <h1>OrgMap · Validação local de reuniões</h1>
        <p>Banco exclusivo e descartável.</p>
        {error && <p role="alert">{error}</p>}
        <form className="edit-form" onSubmit={enter}>
          {!session ? (
            <>
              {!login && (
                <label className="field">
                  Nome
                  <input name="displayName" required />
                </label>
              )}
              <label className="field">
                E-mail
                <input name="email" type="email" required />
              </label>
              <label className="field">
                Senha
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  required
                />
              </label>
            </>
          ) : (
            <label className="field">
              Nome da organização
              <input name="name" required />
            </label>
          )}
          <button className="primary">
            {session
              ? "Criar organização"
              : login
                ? "Entrar"
                : "Criar conta local"}
          </button>
        </form>
        {!session && (
          <button
            onClick={() => {
              setLogin(!login);
              setError("");
            }}
          >
            {login ? "Criar conta local" : "Entrar em conta existente"}
          </button>
        )}
      </main>
    );
  const Component = path.startsWith("/platform/")
      ? platformFeature.Component
      : feature.Component,
    Sidebar = feature.sidebar!;
  const context = { ...ctx, path, navigate };
  return (
    <LocalizationProvider accountId={session?.account.id}>
      <div className="meetings-preview-shell">
        <aside
          style={{
            borderRight: "1px solid #ddd",
            background: "#f7f5f1",
            padding: "16px 0",
          }}
        >
          <h2 style={{ fontSize: 16, padding: "0 20px" }}>Reuniões</h2>
          <Sidebar context={context} />
          <button onClick={() => navigate("/account/preferences")}>
            Preferências da conta · QA
          </button>
        </aside>
        <main style={{ minWidth: 0, overflow: "hidden" }}>
          {path.startsWith("/account/") ? (
            <AccountPage path={path} navigate={navigate} notify={() => {}} />
          ) : (
            <Component context={context} />
          )}
        </main>
      </div>
    </LocalizationProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

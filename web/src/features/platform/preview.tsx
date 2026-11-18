// Isolated real-API visual harness, not part of the feature registry or production bundle.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  request,
  setCsrf,
  errorMessage,
  type Session,
  type Bootstrap,
  type Structure,
  type Member,
} from "../../api";
import { feature, GlobalSearch } from "./index";
import { feature as workFeature } from "../work";
import type { FeatureContext } from "../../feature-contract";
import "../../styles.css";
function Preview() {
  const [ctx, setCtx] = useState<FeatureContext>(),
    [error, setError] = useState(""),
    [path, setPath] = useState(
      location.hash.slice(1) || "/platform/preferences",
    ),
    [message, setMessage] = useState("");
  useEffect(() => {
    const handler = () =>
      setPath(location.hash.slice(1) || "/platform/preferences");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  async function login() {
    try {
      let session: Session;
      try {
        if (new URLSearchParams(location.search).get("role") === "GUEST")
          throw Error("Use explicit Guest preview session");
        session = (await request<Session>("/me")).data;
      } catch {
        const auth = await request<{ csrfToken: string }>("/auth/login", {
          method: "POST",
          body: {
            email:
              new URLSearchParams(location.search).get("role") === "GUEST"
                ? "platform-guest-preview@example.test"
                : "platform-preview@example.test",
            password: "platform-preview-password-123",
          },
        });
        setCsrf(auth.data.csrfToken);
        session = (await request<Session>("/me")).data;
      }
      setCsrf(session.csrfToken);
      const org = session.organizations[0].id;
      const bootstrap = await request<Bootstrap>(
        "/organizations/" + org + "/bootstrap",
      );
      const guest = bootstrap.data.membership.memberType === "GUEST";
      const [structure, members] = guest
        ? [
            { data: { entities: [], occupancies: [] } as unknown as Structure },
            { data: { items: [] as Member[] } },
          ]
        : await Promise.all([
            request<Structure>("/organizations/" + org + "/structure"),
            request<{ items: Member[] }>("/organizations/" + org + "/members"),
          ]);
      setCtx({
        organizationId: org,
        session,
        bootstrap: bootstrap.data,
        structure: structure.data,
        members: members.data.items,
        path,
        navigate: (p) => {
          location.hash = p;
        },
        api: request,
        refresh: () => {},
        notify: setMessage,
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void login();
  }, []);
  if (!ctx)
    return (
      <main style={{ padding: 32 }}>
        <h1>OrgMap · Plataforma local</h1>
        <p>Banco isolado, organização sintética, API real.</p>
        {error && <p role="alert">{error}</p>}
        <button onClick={login}>Entrar na organização de teste</button>
      </main>
    );
  const context = { ...ctx, path },
    activeFeature = path.startsWith("/projects") ? workFeature : feature,
    Sidebar = activeFeature.sidebar!,
    ActiveComponent = activeFeature.Component;
  return (
    <div className="platform-preview-shell">
      <aside>
        <strong>Organização Aurora</strong>
        <Sidebar context={context} />
        {new URLSearchParams(location.search).has("work") && (
          <button onClick={() => context.navigate("/projects")}>
            Projetos · QA integrado
          </button>
        )}
      </aside>
      <main>
        <header>
          <GlobalSearch context={context} />
        </header>
        {message && (
          <p role="status" className="platform-preview-message">
            {message}
          </p>
        )}
        <ActiveComponent context={context} />
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

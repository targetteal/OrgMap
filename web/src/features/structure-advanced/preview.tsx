import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { request, setCsrf, errorMessage, type Session } from "../../api";
import { feature } from "./index";
import "../../styles.css";
import type { FeatureContext } from "../../feature-contract";
function Preview() {
  const [session, setSession] = useState<Session | null>(null),
    [context, setContext] = useState<FeatureContext | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    try {
      const me = await request<Session>("/me");
      setCsrf(me.data.csrfToken);
      setSession(me.data);
      if (me.data.organizations.length) {
        const org = me.data.organizations[0].id;
        const [bootstrap, structure, members] = await Promise.all([
          request<any>(`/organizations/${org}/bootstrap`),
          request<any>(`/organizations/${org}/structure`),
          request<any>(`/organizations/${org}/members`),
        ]);
        setContext({
          organizationId: org,
          session: me.data,
          bootstrap: bootstrap.data,
          structure: structure.data,
          members: members.data.items,
          path: "/structure/advanced",
          api: request,
          navigate: () => {},
          refresh: () => void load(),
          notify: setNotice,
        });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const r = await request<any>("/auth/register", {
        method: "POST",
        body: {
          email: f.get("email"),
          password: f.get("password"),
          displayName: f.get("name"),
        },
      });
      setCsrf(r.data.csrfToken);
      await request("/organizations", {
        method: "POST",
        body: { name: "Aurora · laboratório de estrutura" },
      });
      setError("");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <main style={{ maxWidth: 1440, margin: "0 auto", padding: 24 }}>
      <p className="muted">
        Validação isolada CT-STRUCTURE · dados sintéticos locais
      </p>
      {notice && <p role="status">{notice}</p>}
      {context ? (
        <>
          <button
            onClick={async () => {
              const p = `/organizations/${context.organizationId}`;
              const circle = await request<any>(p + "/circles", {
                method: "POST",
                body: {
                  name: "Pesquisa de futuros possíveis",
                  parentCircleId: context.bootstrap.rootCircleId,
                  mode: "DIRECT",
                },
              });
              await request(p + "/roles", {
                method: "POST",
                body: {
                  name: "Guardiã dos experimentos e das aprendizagens compartilhadas",
                  circleId: circle.data.circle.id,
                  mode: "DIRECT",
                },
              });
              await load();
              setContext(null);
              await load();
            }}
          >
            Construir topologia sintética via API
          </button>
          <feature.Component context={context} />
        </>
      ) : session ? (
        <p>Carregando…</p>
      ) : (
        <form className="edit-form" onSubmit={register}>
          <h1>Conta de validação</h1>
          {error && <p>{error}</p>}
          <label>
            Nome
            <input name="name" required defaultValue="QA estrutura" />
          </label>
          <label>
            E-mail
            <input name="email" type="email" required />
          </label>
          <label>
            Senha
            <input name="password" type="password" required minLength={12} />
          </label>
          <button className="primary">Criar conta e organização vazia</button>
        </form>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

import { useEffect, useState, type FormEvent } from "react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import {interoperabilityMetadata} from './metadata';
import { Button, Field, Notice } from "../../ui";
import { errorMessage, RequestError } from "../../api";
import "./interoperability.css";
import { useLocalization, createMessageTranslator } from "../../localization";
import { featureMessages } from "./messages";
type Credential = {
  id: string;
  label: string;
  kind: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  version: number;
};
type Connection = {
  id: string;
  label: string;
  provider: string;
  state: string;
  version: number;
  configured: boolean;
};
type CalendarEvent = {
  id: string;
  uid: string;
  sequence: number;
  summary: string;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  source: string;
};
const scopeLabels: Record<string, string> = {
  "structure.read": "Consultar estrutura",
  "structure.create": "Criar círculos e papéis",
  "structure.update": "Editar círculos e papéis",
  "structure.move": "Mover círculos e papéis",
  "structure.archive": "Arquivar círculos e papéis",
  "members.read": "Consultar membros",
  "work.read": "Consultar projetos e tarefas",
  "work.project.create": "Criar projetos",
  "work.task.create": "Criar tarefas",
  "work.task.update": "Editar tarefas",
  "goals.read": "Consultar objetivos",
  "goals.create": "Criar objetivos",
  "goals.period.create": "Criar períodos de objetivos",
  "goals.progress.record": "Registrar progresso de objetivos",
  "goals.progress.configure": "Configurar cálculo de progresso",
  "governance.read": "Consultar governança",
  "governance.tension.create": "Criar tensões",
  "governance.tension.close": "Encerrar tensões",
  "meetings.read": "Consultar reuniões",
  "meetings.schedule": "Agendar reuniões",
  "meetings.start": "Iniciar reuniões",
  "meetings.close": "Encerrar reuniões",
};
type State = {
  credentialScopes?: string[];
  credentials: Credential[];
  connections: Connection[];
  capabilities: {
    manage: boolean;
    manageConnections: boolean;
    bearerAuthentication: boolean;
    federatedLogin: boolean;
  };
};
const interopError = (e: unknown) =>
  e instanceof RequestError
    ? ((
        {
          INVALID_EXPIRY: "Escolha uma validade futura, de até um ano.",
          INVALID_SCOPE: "Esta permissão não está disponível para sua conta.",
          LAST_LOGIN_METHOD_PROTECTED:
            "Esta conexão é o último método de entrada de uma conta. Ative outro método antes de revogá-la.",
          EXTERNAL_CONFIGURATION_REQUIRED:
            "O provedor ainda precisa de configuração no servidor.",
          INVALID_INTERVAL: "O término precisa ser posterior ao início.",
        } as Record<string, string>
      )[e.code] ?? errorMessage(e))
    : errorMessage(e);
function Integrations({ context: c }: { context: FeatureContext }) {
  const { locale, formatInstant } = useLocalization();
  const tFeature = createMessageTranslator(locale, featureMessages);
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [keyKind, setKeyKind] = useState("API"),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    setToken("");
  }, [c.organizationId]);
  const base = `/organizations/${c.organizationId}/interoperability`;
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setEvents([]);
    setError("");
    Promise.all([
      c.api<State>(base, { signal: controller.signal }),
      c.api<{ events: CalendarEvent[] }>(base + "/calendar", {
        signal: controller.signal,
      }),
    ])
      .then(([r, calendar]) => {
        setState(r.data);
        setEvents(calendar.data.events);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(interopError(e));
      });
    return () => controller.abort();
  }, [base, c.api, revision]);
  async function createKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setToken("");
    const selectedScopes =
      keyKind === "BUSINESS"
        ? ["interop.read", ...f.getAll("businessScope").map(String)]
        : [
            (
              {
                API: "interop.read",
                CALENDAR: "calendar.read",
                SCIM: "members.provision",
              } as Record<string, string>
            )[keyKind],
          ];
    if (
      selectedScopes.length > 64 ||
      (keyKind === "BUSINESS" && selectedScopes.length === 1)
    ) {
      setError("Selecione entre 1 e 63 ações de negócio.");
      setBusy(false);
      return;
    }
    try {
      const r = await c.api<{ secret?: string }>(base + "/credentials", {
        method: "POST",
        body: {
          label: f.get("label"),
          kind: keyKind === "BUSINESS" ? "API" : keyKind,
          scopes: selectedScopes,
          ...(keyKind === "SCIM"
            ? { connectionId: f.get("connectionId") }
            : {}),
          expiresAt: new Date(
            String(f.get("expiresAt")) + "T23:59:59Z",
          ).toISOString(),
        },
      });
      setRevision((x) => x + 1);
      setToken(r.data.secret ?? "");
      c.notify("Chave criada. Copie o segredo antes de sair.");
    } catch (e) {
      setError(interopError(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(key: Credential) {
    setBusy(true);
    setError("");
    try {
      await c.api(base + `/credentials/${key.id}/revoke`, {
        method: "POST",
        body: {},
        version: key.version,
      });
      setRevision((x) => x + 1);
      c.notify("Chave revogada.");
    } catch (e) {
      setError(interopError(e));
    } finally {
      setBusy(false);
    }
  }
  async function addConnection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await c.api(base + "/connections", {
        method: "POST",
        body: { provider: f.get("provider"), label: f.get("label") },
      });
      setRevision((x) => x + 1);
      c.notify(
        "Configuração registrada. A conexão ainda exige configuração do provedor.",
      );
    } catch (e) {
      setError(interopError(e));
    } finally {
      setBusy(false);
    }
  }
  async function revokeConnection(connection: Connection) {
    setBusy(true);
    setError("");
    try {
      await c.api(base + `/connections/${connection.id}/revoke`, {
        method: "POST",
        body: {},
        version: connection.version,
      });
      setRevision((x) => x + 1);
      c.notify("Conexão revogada.");
    } catch (e) {
      setError(interopError(e));
    } finally {
      setBusy(false);
    }
  }
  async function createEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await c.api(base + "/calendar-events", {
        method: "POST",
        body: {
          uid: crypto.randomUUID() + "@orgmap.local",
          sequence: 0,
          summary: f.get("summary"),
          startsAt: String(f.get("startsAt")) + ":00Z",
          endsAt: String(f.get("endsAt")) + ":00Z",
          source: "LOCAL",
          cancelled: false,
        },
      });
      setRevision((x) => x + 1);
      c.notify("Evento registrado no calendário.");
    } catch (e) {
      setError(interopError(e));
    } finally {
      setBusy(false);
    }
  }
  async function linkIdentity(connection: Connection) {
    setBusy(true);
    setError("");
    try {
      const result = await c.api<{ authorizationUrl: string }>(
        base +
          `/connections/${connection.id}/${connection.provider.toLowerCase()}/link`,
        { method: "POST", body: {} },
      );
      window.location.assign(result.data.authorizationUrl);
    } catch (e) {
      setError(interopError(e));
      setBusy(false);
    }
  }
  async function cancelEvent(event: CalendarEvent) {
    setBusy(true);
    setError("");
    try {
      await c.api(base + "/calendar-events", {
        method: "POST",
        body: {
          uid: event.uid,
          sequence: event.sequence + 1,
          summary: event.summary,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          source: "LOCAL",
          cancelled: true,
        },
      });
      setRevision((x) => x + 1);
      c.notify(
        "Evento cancelado. O calendário mantém a atualização para os assinantes.",
      );
    } catch (e) {
      setError(interopError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="interop-page" aria-label="Integrações">
      <div className="page-heading">
        <h1>Integrações</h1>
        <p className="muted">
          Gerencie o acesso de aplicativos e as conexões desta organização.
        </p>
      </div>
      {error && <Notice>{error}</Notice>}
      {!state && !error && <p role="status">Carregando integrações…</p>}
      {state && (
        <>
          <section aria-labelledby="interop-keys">
            <h2 id="interop-keys">Chaves pessoais</h2>
            <p className="muted">
              As chaves têm prazo de validade e podem ser revogadas a qualquer
              momento.
            </p>
            {token && (
              <div className="interop-secret" role="status">
                <p>Copie agora. Este segredo não será mostrado novamente.</p>
                <code>{token}</code>
                <Button onClick={() => setToken("")}>Ocultar segredo</Button>
              </div>
            )}
            {!state.capabilities.bearerAuthentication && (
              <Notice>
                A autenticação de aplicativos aguarda a integração de segurança
                do servidor. Chaves registradas ainda não autorizam chamadas.
              </Notice>
            )}
            {state.credentials.length === 0 ? (
              <p className="empty-state">Nenhuma chave pessoal criada.</p>
            ) : (
              <ul className="interop-list">
                {state.credentials.map((k) => (
                  <li key={k.id}>
                    <div>
                      <strong>{k.label}</strong>
                      <p className="muted">
                        {k.revokedAt
                          ? tFeature("revoked")
                          : new Date(k.expiresAt).getTime() <= Date.now()
                            ? tFeature("expired")
                            : tFeature("validUntil", { date: formatInstant(k.expiresAt, false) })}{" "}
                        · {k.scopes.join(", ")}
                      </p>
                    </div>
                    {!k.revokedAt && state.capabilities.manage && (
                      <Button disabled={busy} onClick={() => revoke(k)}>
                        Revogar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {state.capabilities.manage && (
              <form className="interop-form" onSubmit={createKey}>
                <Field label="Permissão" name="kind">
                  <select
                    name="kind"
                    value={keyKind}
                    onChange={(e) => setKeyKind(e.target.value)}
                  >
                    <option value="API">Consultar integrações e MCP</option>
                    <option value="CALENDAR">Ler calendário ICS</option>
                    {!!state.credentialScopes?.length && (
                      <option value="BUSINESS">
                        Agente de negócio (escopos)
                      </option>
                    )}
                    {state.capabilities.manageConnections && (
                      <option value="SCIM">Provisionar membros via SCIM</option>
                    )}
                  </select>
                </Field>
                {keyKind === "SCIM" && (
                  <Field label="Conexão de identidade" name="connectionId">
                    <select name="connectionId" required defaultValue="">
                      <option value="" disabled>
                        Selecione uma conexão OIDC ou SAML
                      </option>
                      {state.connections
                        .filter(
                          (connection) =>
                            ["OIDC", "SAML"].includes(connection.provider) &&
                            connection.state !== "REVOKED",
                        )
                        .map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.label}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                {keyKind === "SCIM" && (
                  <p className="muted">
                    O provisionamento fica restrito à conexão selecionada. O
                    acesso só é ativado após as provas de e-mail e identidade.
                  </p>
                )}
                {keyKind === "BUSINESS" && (
                  <fieldset className="interop-scopes">
                    <legend>Escopos do agente</legend>
                    <p className="muted">
                      Selecione as ações necessárias. As permissões atuais da
                      sua conta continuam sendo verificadas em cada chamada.
                    </p>
                    {state.credentialScopes?.map((scope) => (
                      <label key={scope} title={scope}>
                        <input
                          type="checkbox"
                          name="businessScope"
                          value={scope}
                        />
                        {scopeLabels[scope] ?? scope}
                      </label>
                    ))}
                  </fieldset>
                )}
                <Field
                  label="Nome da chave"
                  name="label"
                  required
                  maxLength={200}
                />
                <Field
                  label="Válida até"
                  name="expiresAt"
                  type="date"
                  required
                />
                <button
                  className="primary"
                  disabled={busy || !state.capabilities.bearerAuthentication}
                >
                  Criar chave
                </button>
              </form>
            )}
          </section>
          <section aria-labelledby="interop-connections">
            <h2 id="interop-connections">Conexões</h2>
            <p className="muted">
              Cada provedor exige cadastro e credenciais próprios antes da
              primeira sincronização.
            </p>
            {state.connections.length === 0 ? (
              <p className="empty-state">Nenhuma conexão configurada.</p>
            ) : (
              <ul className="interop-list">
                {state.connections.map((x) => (
                  <li key={x.id}>
                    <div>
                      <strong>{x.label}</strong>
                      <p className="muted">{x.provider}</p>
                    </div>
                    <span className="badge">
                      {x.state === "REVOKED"
                        ? tFeature("revoked")
                        : x.configured
                          ? "Configuração disponível"
                          : "Configuração externa necessária"}
                    </span>
                    {x.configured &&
                      x.state !== "REVOKED" &&
                      ["OIDC", "SAML"].includes(x.provider) && (
                        <Button disabled={busy} onClick={() => linkIdentity(x)}>
                          Vincular minha conta
                        </Button>
                      )}
                    {state.capabilities.manageConnections &&
                      x.state !== "REVOKED" && (
                        <Button
                          disabled={busy}
                          onClick={() => revokeConnection(x)}
                        >
                          Revogar conexão
                        </Button>
                      )}
                  </li>
                ))}
              </ul>
            )}
            {state.capabilities.manageConnections && (
              <form className="interop-form" onSubmit={addConnection}>
                <Field
                  label="Nome da conexão"
                  name="label"
                  required
                  maxLength={200}
                />
                <Field label="Provedor" name="provider">
                  <select name="provider">
                    <option value="GOOGLE">Google Calendar</option>
                    <option value="OUTLOOK">Outlook Calendar</option>
                    <option value="SLACK">Slack</option>
                    <option value="OIDC">OpenID Connect</option>
                    <option value="SAML">SAML</option>
                  </select>
                </Field>
                <button className="primary" disabled={busy}>
                  Registrar configuração
                </button>
              </form>
            )}
          </section>
          <section aria-labelledby="interop-calendar">
            <h2 id="interop-calendar">Calendário</h2>
            <p className="muted">
              Eventos locais e atualizações recebidas pelas conexões
              autorizadas.
            </p>
            <a href={"/api/v1" + base + "/calendar.ics"} download="orgmap.ics">
              Baixar calendário ICS
            </a>
            {events.length === 0 ? (
              <p className="empty-state">Nenhum evento local registrado.</p>
            ) : (
              <ul className="interop-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>{event.summary}</strong>
                      <p className="muted">
                        {formatInstant(event.startsAt)} ·{" "}
                        {event.cancelled ? "Cancelado" : "Confirmado"}
                      </p>
                    </div>
                    {state.capabilities.manageConnections &&
                      !event.cancelled &&
                      event.source === "LOCAL" && (
                        <Button
                          disabled={busy}
                          onClick={() => cancelEvent(event)}
                        >
                          Cancelar evento
                        </Button>
                      )}
                  </li>
                ))}
              </ul>
            )}
            {state.capabilities.manageConnections && (
              <form className="interop-form" onSubmit={createEvent}>
                <Field
                  label="Nome do evento"
                  name="summary"
                  required
                  maxLength={1000}
                />
                <Field
                  label="Início (UTC)"
                  name="startsAt"
                  type="datetime-local"
                  required
                />
                <Field
                  label="Término (UTC)"
                  name="endsAt"
                  type="datetime-local"
                  required
                />
                <button className="primary" disabled={busy}>
                  Registrar evento
                </button>
              </form>
            )}
          </section>
        </>
      )}
    </section>
  );
}
export const feature: FeatureDefinition = {
  ...interoperabilityMetadata,
  Component: Integrations,
};

import { useEffect, useState, type FormEvent } from "react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import "./administration.css";
import { Button, Field, Notice } from "../../ui";
import { RequestError, errorMessage } from "../../api";
import { useLocalization } from "../../localization";
type Consent = {
  id: string;
  subjectMemberId: string;
  delegateMemberId: string;
  actions: string[];
  version: number;
  expiresAt: string;
  revokedAt: string | null;
  effective: boolean;
};
type Book = {
  subjectMemberId: string;
  revision: number;
  consents: Consent[];
  capabilities: { consentOwn: boolean };
};
function message(error: unknown) {
  const codes: Record<string, string> = {
    INDICATOR_CONSENT_CONFIRMATION_REQUIRED:
      "Confirme a autorização sobre seus indicadores antes de salvar.",
    INVALID_CONSENT_EXPIRATION: "Escolha uma validade futura de até 365 dias.",
    INDICATOR_CONSENT_REVOKED:
      "Esta autorização foi revogada. Emita uma nova autorização se desejar delegar novamente.",
  };
  return error instanceof RequestError && codes[error.code]
    ? codes[error.code]
    : errorMessage(error);
}
export function MemberIndicatorConsentSettings({
  context: c,
}: {
  context: FeatureContext;
}) {
  const { formatInstant, formatNumber } = useLocalization();
  const [book, setBook] = useState<Book | null>(null),
    [received, setReceived] = useState<any[]>([]),
    [delegate, setDelegate] = useState(""),
    [expiry, setExpiry] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [hidden, setHidden] = useState(false);
  const path =
    "/organizations/" +
    c.organizationId +
    "/administration/member-indicator-consents";
  const load = async (signal?: AbortSignal) => {
    const [own, incoming] = await Promise.all([
      c.api<Book>(path + "/me", { signal }),
      c.api<{ consents: any[] }>(path + "/received", { signal }),
    ]);
    if (signal?.aborted) return;
    setBook(own.data);
    setReceived(incoming.data.consents);
  };
  useEffect(() => {
    const controller = new AbortController();
    setBook(null);
    setReceived([]);
    setError("");
    setHidden(false);
    setEditing(null);
    setDelegate("");
    setExpiry("");
    setConfirmed(false);
    void load(controller.signal).catch((e) => {
      if (controller.signal.aborted) return;
      if (
        e instanceof RequestError &&
        ["RESOURCE_NOT_FOUND", "ACTION_DENIED"].includes(e.code)
      )
        setHidden(true);
      else setError(message(e));
    });
    return () => controller.abort();
  }, [path]);
  useEffect(
    () =>
      c.registerNavigationGuard?.(() =>
        busy
          ? "Há uma autorização de indicadores sendo salva. Aguarde a conclusão antes de sair."
          : null,
      ),
    [busy, c.registerNavigationGuard],
  );
  if (hidden) return null;
  const memberName = (memberId: string) =>
    memberId === book?.subjectMemberId
      ? "Você"
      : (c.members.find((m) => m.id === memberId)?.displayName ?? "Membro");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!book || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      await c.api(path + (editing ? "/" + editing : ""), {
        method: editing ? "PUT" : "POST",
        body: {
          delegateMemberId: delegate,
          actions: ["DEFINE"],
          ...(expiry ? { expiresAt: expiry + "T23:59:59.000Z" } : {}),
          confirmation: "AUTHORIZE_DEFINE_ON_MY_INDICATORS",
        },
        version: book.revision,
      });
      await load();
      setConfirmed(false);
      setEditing(null);
      setExpiry("");
      c.notify("Autorização dos seus indicadores salva.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (consent: Consent) => {
    if (!book) return;
    setBusy(true);
    setError("");
    try {
      await c.api(path + "/" + consent.id + "/revoke", {
        method: "POST",
        body: {},
        version: book.revision,
      });
      await load();
      c.notify("Autorização revogada.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="admin-settings admin-security"
      aria-labelledby="member-consent-title"
    >
      <h2 id="member-consent-title">Permissões sobre meus indicadores</h2>
      <p>
        Você decide quem pode criar, atribuir e alterar definições de métricas e
        checklists do seu perfil, inclusive você mesmo. Esta autorização não
        permite ler ou registrar os valores de outra pessoa e não pode ser
        repassada.
      </p>
      {error && <Notice>{error}</Notice>}
      {!book ? (
        <p role="status">Carregando suas autorizações…</p>
      ) : (
        <>
          <p>
            Versão do seu livro de autorizações: {formatNumber(book.revision)}
          </p>
          <form onSubmit={submit}>
            <fieldset
              aria-label="Delegar definição dos meus indicadores"
              disabled={busy || !book.capabilities.consentOwn}
            >
              <Field
                label="Quem poderá definir meus indicadores"
                name="indicator-consent-delegate"
              >
                <select
                  required
                  value={delegate}
                  onChange={(e) => {
                    setDelegate(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Selecione um membro</option>
                  <option value={book.subjectMemberId}>Você</option>
                  {c.members
                    .filter(
                      (m) =>
                        m.id !== book.subjectMemberId &&
                        (m as any).memberType !== "GUEST",
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                label="Validade opcional — fim do dia em UTC"
                name="indicator-consent-expiry"
              >
                <input
                  type="date"
                  value={expiry}
                  onChange={(e) => {
                    setExpiry(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </Field>
              <p>
                Sem uma data, a autorização vale por 30 dias. O prazo máximo é
                de 365 dias.
              </p>
              <label className="admin-check">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Autorizo este membro a definir meus indicadores durante a
                validade escolhida.
              </label>
              <button
                className="primary"
                disabled={busy || !delegate || !confirmed}
              >
                {busy
                  ? "Salvando…"
                  : editing
                    ? "Atualizar autorização"
                    : "Conceder autorização"}
              </button>
              {editing && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    setDelegate("");
                    setExpiry("");
                    setConfirmed(false);
                  }}
                >
                  Cancelar edição
                </Button>
              )}
            </fieldset>
          </form>
          <h3>Autorizações concedidas</h3>
          {book.consents.length === 0 ? (
            <p>
              Nenhuma autorização concedida. Ser titular ou Owner não cria uma
              autorização de definição automaticamente.
            </p>
          ) : (
            <ul>
              {book.consents.map((consent) => (
                <li key={consent.id}>
                  <strong>{memberName(consent.delegateMemberId)}</strong>
                  <p>
                    {consent.effective
                      ? "Vigente"
                      : consent.revokedAt
                        ? "Revogada"
                        : "Não vigente"}{" "}
                    · Validade {formatInstant(consent.expiresAt)} · Versão{" "}
                    {formatNumber(consent.version)}
                  </p>
                  <Button
                    disabled={busy || !!consent.revokedAt}
                    onClick={() => {
                      setEditing(consent.id);
                      setDelegate(consent.delegateMemberId);
                      setExpiry(consent.expiresAt.slice(0, 10));
                      setConfirmed(false);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    disabled={busy || !!consent.revokedAt}
                    onClick={() => void revoke(consent)}
                  >
                    Revogar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <h3>Autorizações recebidas</h3>
          {received.length === 0 ? (
            <p>Nenhuma autorização vigente recebida.</p>
          ) : (
            <ul>
              {received.map((consent) => (
                <li key={consent.id}>
                  Definir indicadores de {memberName(consent.subjectMemberId)} ·
                  Validade {formatInstant(consent.expiresAt)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
/** Personal entry point: root registers this definition, independent of Owner admin navigation. */
export const memberIndicatorConsentFeature: FeatureDefinition = {
  id: "member-indicator-consents",
  module: "members",
  label: "Permissões dos meus indicadores",
  matches: (path) => /^\/my-indicator-permissions\/?(?:[?#].*)?$/.test(path),
  Component: MemberIndicatorConsentSettings,
  navigation: [
    {
      path: "/my-indicator-permissions",
      label: "Permissões dos meus indicadores",
      location: "identity",
      visible: (context) =>
        (context.bootstrap.membership as any).memberType !== "GUEST",
    },
  ],
};

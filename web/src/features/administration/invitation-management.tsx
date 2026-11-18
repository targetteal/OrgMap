import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import { Button, Field, Notice } from "../../ui";
import { RequestError, errorMessage } from "../../api";
import { useLocalization } from "../../localization";
import { admissionLinkPath } from "../../admission-route";
import { InvitationTracking } from "./InvitationTracking";
import { InvitationComposer } from "./InvitationComposer";
import "./administration.css";
type Resource = { context: string; kind: string; id: string; title: string };
type Plan = {
  resource: { context: string; kind: string; id: string };
  actions: string[];
}[];
type Invite = {
  id: string;
  email: string;
  memberType: "MEMBER" | "GUEST";
  accessPlan: Plan;
  firstName?: string;
  lastName?: string;
  personalMessage?: string;
  version: number;
  expiresAt: string;
};
type Row = {
  clientRef: string;
  email: string;
  firstName: string;
  lastName: string;
  memberType: "MEMBER" | "GUEST";
};
const owners: Record<string, string> = {
  circle: "structure",
  role: "structure",
  goal: "goals",
  "key-result": "goals",
  project: "work",
  task: "work",
  proposal: "governance",
  tension: "governance",
  agreement: "governance",
  meeting: "meetings",
  report: "meetings",
};
const kindLabels: Record<string, string> = {
  circle: "Círculo",
  role: "Papel",
  goal: "Objetivo",
  "key-result": "Resultado-chave",
  project: "Projeto",
  task: "Tarefa",
  proposal: "Proposta",
  tension: "Tensão",
  agreement: "Acordo",
  meeting: "Reunião",
  report: "Ata",
};
const statuses: Record<string, string> = {
  QUEUED: "Na fila de envio",
  EXISTING_PENDING: "Convite pendente existente",
  ALREADY_MEMBER: "Já participa da organização",
  DUPLICATE_IN_BATCH: "Repetido neste lote",
  INVALID: "Dados inválidos",
  DENIED: "Convite não autorizado",
  CONFLICT: "Pendências precisam de reconciliação",
};
const blank = (): Row => ({
  clientRef: crypto.randomUUID(),
  email: "",
  firstName: "",
  lastName: "",
  memberType: "MEMBER",
});
const ref = (item: Resource) => item.context + ":" + item.kind + ":" + item.id;
function message(error: unknown) {
  const codes: Record<string, string> = {
    ADMISSION_LINK_DISABLED:
      "Habilite o link na política de cadastro antes de emiti-lo.",
    POLICY_CONSUMER_UNAVAILABLE:
      "O serviço necessário ainda não está operacional. Nenhum envio ou acesso foi confirmado.",
    INVITATION_CHANGE_REQUIRED:
      "Já há um convite diferente para este endereço. Edite a pendência existente.",
    INVITATION_RECONCILIATION_REQUIRED:
      "Há pendências conflitantes para este endereço. Elas precisam de reconciliação antes de reenviar.",
    ACTION_DENIED: "Você não tem autorização atual para esta operação.",
    INVALID_ACCESS_PLAN: "Revise os recursos selecionados para o convidado.",
    GUEST_CONTEXT_UNAVAILABLE:
      "O serviço de um recurso selecionado ainda não está disponível para convidados.",
  };
  return error instanceof RequestError && codes[error.code]
    ? codes[error.code]
    : errorMessage(error);
}
export function InvitationManagement({
  context: c,
}: {
  context: FeatureContext;
}) {
  const { formatInstant, compareText } = useLocalization();
  const owner = c.bootstrap.membership.orgRole === "OWNER";
  const base = "/organizations/" + c.organizationId;
  const advancedRequested = new URLSearchParams(c.path?.split("?")[1] ?? "").get("advanced") === "1";
  const [trackingRevision, setTrackingRevision] = useState(0),
    [, setPending] = useState<Invite[]>([]),
    [ready, setReady] = useState(false),
    [allowed, setAllowed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [advanced, setAdvanced] = useState(advancedRequested),
    [batch, setBatch] = useState(false),
    [rows, setRows] = useState<Row[]>([blank()]),
    [personalMessage, setPersonalMessage] = useState(""),
    [editing, setEditing] = useState<Invite | null>(null),
    [results, setResults] = useState<any[]>([]),
    [selected, setSelected] = useState<Resource[]>([]),
    [entryAccess, setEntryAccess] = useState(false),
    [search, setSearch] = useState(""),
    [found, setFound] = useState<Resource[]>([]),
    [links, setLinks] = useState<any>(null),
    [linkPolicy, setLinkPolicy] = useState<any>(null),
    [oneTimeLink, setOneTimeLink] = useState(""),
    [unsupportedPlan, setUnsupportedPlan] = useState(false);
  const inFlight = useRef(false),
    commandKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const load = async (signal?: AbortSignal) => {
    const result = await c.api<{ items: Invite[] }>(base + "/invitations", {
      signal,
    });
    if (signal?.aborted) return;
    setPending(result.data.items);
    setTrackingRevision(value=>value+1);
    setAllowed(true);
    if (owner) {
      const [metadata, policy] = await Promise.all([
        c.api<any>(base + "/invitation-links", { signal }),
        c.api<any>(base + "/administration/admission-policy", { signal }),
      ]);
      if (!signal?.aborted) {
        setLinks(metadata.data);
        setLinkPolicy(policy.data);
      }
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setAllowed(false);
    setError("");
    setPending([]);
    setRows([blank()]);
    setEditing(null);
    setAdvanced(advancedRequested);
    setResults([]);
    setSelected([]);
    setEntryAccess(false);
    setPersonalMessage("");
    setOneTimeLink("");
    setLinks(null);
    setLinkPolicy(null);
    commandKey.current = null;
    void load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    return () => controller.abort();
  }, [base, owner, advancedRequested]);
  useEffect(
    () =>
      c.registerNavigationGuard?.(() =>
        busy
          ? "Há uma operação de convite em andamento. Aguarde a conclusão antes de sair."
          : null,
      ),
    [busy, c.registerNavigationGuard],
  );
  const command = async <T,>(path: string, body: unknown, version?: number) => {
    const fingerprint = JSON.stringify([path, body, version]);
    if (commandKey.current?.fingerprint !== fingerprint)
      commandKey.current = { fingerprint, key: crypto.randomUUID() };
    const result = await c.api<T>(path, {
      method: "POST",
      body,
      version,
      key: commandKey.current.key,
    });
    commandKey.current = null;
    return result;
  };
  const run = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const plan: Plan = [
    ...selected.map((item) => ({
      resource: { context: item.context, kind: item.kind, id: item.id },
      actions: ["read"],
    })),
    ...(entryAccess
      ? [
          {
            resource: {
              context: "administration",
              kind: "entry",
              id: c.organizationId,
            },
            actions: ["read", "acknowledge"],
          },
        ]
      : []),
  ];
  const body = (row: Row) => ({
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    memberType: owner ? row.memberType : "MEMBER",
    ...(owner && row.memberType === "GUEST" ? { accessPlan: plan } : {}),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (Array.from(personalMessage).length > 2000)
        throw new Error("A mensagem pode ter até 2.000 caracteres.");
      if (unsupportedPlan)
        throw new Error(
          "Este convite contém permissões adicionais que este editor não altera.",
        );
      if (editing) {
        const { email: _email, ...input } = body(rows[0]);
        await command(
          base + "/invitations/" + editing.id + "/actions/change-access",
          { ...input, personalMessage },
          editing.version,
        );
        setResults([{ label: editing.email, status: "QUEUED" }]);
        setEditing(null);
        setAdvanced(false);
      } else if (batch) {
        const snapshot = rows.map((row) => ({
          ...body(row),
          clientRef: row.clientRef,
        }));
        const result = await command<any>(base + "/invitations/batch", {
          items: snapshot,
          personalMessage,
        });
        setResults(
          result.data.results.map((result: any) => ({
            ...result,
            label:
              rows.find((row) => row.clientRef === result.clientRef)?.email ??
              "Endereço do lote",
          })),
        );
      } else {
        await command(base + "/invitations", {
          ...body(rows[0]),
          personalMessage,
        });
        setResults([{ label: rows[0].email, status: "QUEUED" }]);
      }
      await load();
      c.notify("Solicitação de convite processada.");
    });
  };
  const structural: Resource[] = c.structure.nodes.map((node) => ({
    context: "structure",
    kind: node.kind.toLowerCase(),
    id: node.entityId,
    title: node.name,
  }));
  const options = Array.from(
    new Map(
      [...structural, ...found, ...selected].map((item) => [ref(item), item]),
    ).values(),
  ).sort((a, b) => compareText(a.title, b.title));
  const edit = (invite: Invite) => {
    setAdvanced(true);
    setEditing(invite);
    setBatch(false);
    setRows([
      {
        clientRef: crypto.randomUUID(),
        email: invite.email,
        firstName: invite.firstName ?? "",
        lastName: invite.lastName ?? "",
        memberType: invite.memberType,
      },
    ]);
    setPersonalMessage(invite.personalMessage ?? "");
    setEntryAccess(
      invite.accessPlan.some(
        (item) =>
          item.resource.context === "administration" &&
          item.resource.kind === "entry",
      ),
    );
    const extras = invite.accessPlan.filter(
      (item) =>
        !(
          item.resource.context === "administration" &&
          item.resource.kind === "entry"
        ),
    );
    setUnsupportedPlan(
      invite.accessPlan.some((item) =>
        item.resource.context === "administration" &&
        item.resource.kind === "entry"
          ? item.resource.id !== c.organizationId ||
            item.actions.length !== 2 ||
            !item.actions.includes("read") ||
            !item.actions.includes("acknowledge")
          : owners[item.resource.kind] !== item.resource.context ||
            item.actions.length !== 1 ||
            item.actions[0] !== "read",
      ),
    );
    setSelected(
      extras.map((item) => ({
        ...item.resource,
        title:
          options.find(
            (option) =>
              ref(option) ===
              item.resource.context +
                ":" +
                item.resource.kind +
                ":" +
                item.resource.id,
          )?.title ?? "Recurso já selecionado",
      })),
    );
    setResults([]);
    setError("");
  };
  const hasGuest = owner && rows.some((row) => row.memberType === "GUEST");
  return (
    <section
      className="admin-settings admin-security"
      aria-labelledby="invitation-management-title"
    >
      <h2 id="invitation-management-title">Convites para a organização</h2>
      <p>
        Envie convites e acompanhe quem ainda precisa entrar na organização.
      </p>
      {error && <Notice>{error}</Notice>}
      {!ready ? (
        <p role="status">Carregando convites…</p>
      ) : !allowed ? (
        <p>
          Os convites não estão disponíveis para sua associação ou para a
          política atual.
        </p>
      ) : (
        <>
          {!advanced && !editing ? (
            <InvitationComposer
              context={c}
              onComplete={() => { void load().catch((e) => setError(message(e))); }}
              onAdvanced={owner ? () => setAdvanced(true) : undefined}
            />
          ) : (
          <>
          {!editing && <Button disabled={busy} onClick={() => setAdvanced(false)}>Voltar ao convite simples</Button>}
          <div role="group" aria-label="Formato dos convites">
            <Button
              disabled={busy || !!editing}
              onClick={() => {
                setBatch(false);
                setRows([rows[0] ?? blank()]);
              }}
            >
              Um convite
            </Button>
            <Button disabled={busy || !!editing} onClick={() => setBatch(true)}>
              Em lote
            </Button>
          </div>
          <form onSubmit={submit}>
            <fieldset
              aria-label={
                editing ? "Editar convite pendente" : "Destinatários do convite"
              }
              disabled={busy}
            >
              {rows.map((row, index) => (
                <div className="admin-section" key={row.clientRef}>
                  <h3>Destinatário {index + 1}</h3>
                  <Field label="E-mail" name={"invite-email-" + row.clientRef}>
                    <input
                      type="email"
                      required
                      disabled={!!editing}
                      value={row.email}
                      onChange={(e) =>
                        setRows(
                          rows.map((item) =>
                            item.clientRef === row.clientRef
                              ? { ...item, email: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field
                    label="Nome opcional"
                    name={"invite-first-" + row.clientRef}
                  >
                    <input
                      value={row.firstName}
                      onChange={(e) =>
                        setRows(
                          rows.map((item) =>
                            item.clientRef === row.clientRef
                              ? { ...item, firstName: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field
                    label="Sobrenome opcional"
                    name={"invite-last-" + row.clientRef}
                  >
                    <input
                      value={row.lastName}
                      onChange={(e) =>
                        setRows(
                          rows.map((item) =>
                            item.clientRef === row.clientRef
                              ? { ...item, lastName: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  {owner && (
                    <Field
                      label="Tipo de participação"
                      name={"invite-type-" + row.clientRef}
                    >
                      <select
                        value={row.memberType}
                        onChange={(e) => {
                          setRows(
                            rows.map((item) =>
                              item.clientRef === row.clientRef
                                ? {
                                    ...item,
                                    memberType: e.target
                                      .value as Row["memberType"],
                                  }
                                : item,
                            ),
                          );
                          if (e.target.value === "MEMBER")
                            setUnsupportedPlan(false);
                        }}
                      >
                        <option value="MEMBER">Membro</option>
                        <option value="GUEST">Convidado</option>
                      </select>
                    </Field>
                  )}
                  {batch && rows.length > 1 && (
                    <Button
                      onClick={() =>
                        setRows(
                          rows.filter(
                            (item) => item.clientRef !== row.clientRef,
                          ),
                        )
                      }
                    >
                      Remover destinatário
                    </Button>
                  )}
                </div>
              ))}
              {batch && (
                <Button
                  disabled={rows.length >= 100}
                  onClick={() => setRows([...rows, blank()])}
                >
                  Adicionar destinatário
                </Button>
              )}
              {hasGuest && (
                <div
                  role="group"
                  aria-label="Recursos para convidados deste envio"
                >
                  <h3>Recursos para convidados deste envio</h3>
                  <p>
                    O mesmo plano de leitura será aplicado aos convidados deste
                    envio. A autoridade de compartilhar cada recurso será
                    verificada ao salvar.
                  </p>
                  {unsupportedPlan && (
                    <Notice>
                      Este convite contém permissões adicionais existentes. Este
                      editor não as altera; cancele a edição ou escolha
                      participação como membro explicitamente.
                    </Notice>
                  )}
                  <Field
                    label="Pesquisar recurso pelo nome"
                    name="invite-resource-search"
                  >
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={!search.trim()}
                    onClick={() =>
                      void run(async () => {
                        const result = await c.api<any>(
                          base +
                            "/platform/search?q=" +
                            encodeURIComponent(search),
                        );
                        setFound(
                          result.data.items
                            .filter((item: any) => owners[item.type])
                            .map((item: any) => ({
                              context: owners[item.type],
                              kind: item.type,
                              id: item.id,
                              title: item.title,
                            })),
                        );
                      })
                    }
                  >
                    Pesquisar recursos
                  </Button>
                  <div className="admin-invite-resources">
                    {options.map((item) => (
                      <label className="admin-check" key={ref(item)}>
                        <input
                          type="checkbox"
                          checked={selected.some(
                            (value) => ref(value) === ref(item),
                          )}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, item]
                                : selected.filter(
                                    (value) => ref(value) !== ref(item),
                                  ),
                            )
                          }
                        />
                        {kindLabels[item.kind] ?? "Recurso"}: {item.title}
                      </label>
                    ))}
                  </div>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={entryAccess}
                      onChange={(e) => setEntryAccess(e.target.checked)}
                    />
                    Permitir acesso às boas-vindas desta organização
                  </label>
                  <p>
                    Sem recursos selecionados, o convidado poderá aceitar o
                    convite e verá uma entrada sem recursos compartilhados. As
                    boas-vindas não abrem configurações administrativas ou
                    diretório.
                  </p>
                </div>
              )}
              <Field label="Mensagem pessoal opcional" name="invite-message">
                <textarea
                  value={personalMessage}
                  onChange={(e) => setPersonalMessage(e.target.value)}
                />
              </Field>
              <p>
                {Array.from(personalMessage).length} de 2.000 caracteres. Nomes
                do convite não alteram o nome global da conta.
              </p>
              <button className="primary" disabled={busy || unsupportedPlan}>
                {busy
                  ? "Processando…"
                  : editing
                    ? "Salvar alterações e reenviar"
                    : "Solicitar envio dos convites"}
              </button>
              {editing && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setAdvanced(false);
                    setRows([blank()]);
                    setSelected([]);
                    setEntryAccess(false);
                    setUnsupportedPlan(false);
                    setPersonalMessage("");
                  }}
                >
                  Cancelar edição
                </Button>
              )}
            </fieldset>
          </form>
          </>
          )}
          {results.length > 0 && (
            <div role="status">
              <h3>Resultado da solicitação</h3>
              <ul>
                {results.map((result, index) => (
                  <li key={result.clientRef ?? index}>
                    {result.label}:{" "}
                    {statuses[result.status] ?? "Não foi possível processar"}
                  </li>
                ))}
              </ul>
              <p>
                Estar na fila não confirma entrega do e-mail nem aceite da
                associação.
              </p>
            </div>
          )}
          <InvitationTracking context={c} revision={trackingRevision} onEdit={edit}/>
        </>
      )}
      {owner && links && (
        <section aria-label="Link de inscrição">
          <h3>Link de inscrição</h3>
          <p>
            O link exige conta autenticada, prova de e-mail e a política atual.
            Ele não cria associação ao ser aberto.
          </p>
          <p>
            {links.link
              ? links.link.revokedAt
                ? "Link revogado"
                : "Link emitido; validade " +
                  formatInstant(links.link.expiresAt)
              : "Nenhum link emitido."}
          </p>
          <Button
            disabled={
              busy ||
              !linkPolicy?.supported ||
              !linkPolicy.policy.invitationLinkEnabled ||
              linkPolicy.policy.registrationMode === "DISABLED"
            }
            onClick={() =>
              void run(async () => {
                setOneTimeLink("");
                const result = await command<any>(
                  base + "/invitation-links",
                  {},
                  links.version,
                );
                setLinks(result.data);
                if (result.data.linkToken)
                  setOneTimeLink(result.data.linkToken);
              })
            }
          >
            {links.link && !links.link.revokedAt
              ? "Gerar novo link e invalidar o anterior"
              : "Gerar link de inscrição"}
          </Button>
          {links.link && !links.link.revokedAt && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setOneTimeLink("");
                  await command(
                    base + "/invitation-links/" + links.link.id + "/revoke",
                    {},
                    links.version,
                  );
                  await load();
                })
              }
            >
              Revogar link
            </Button>
          )}
          {!linkPolicy?.supported ||
          !linkPolicy.policy.invitationLinkEnabled ||
          linkPolicy.policy.registrationMode === "DISABLED" ? (
            <p>
              Habilite o link em uma política de cadastro operacional para
              emitir.
            </p>
          ) : null}
          {oneTimeLink ? (
            <>
              <Field
                label="Link gerado — disponível somente nesta sessão"
                name="one-time-invitation-link"
              >
                <input
                  type="password"
                  readOnly
                  autoComplete="off"
                  value={
                    new URL(
                      admissionLinkPath(c.organizationId, oneTimeLink),
                      location.origin,
                    ).href
                  }
                />
              </Field>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!navigator.clipboard)
                      throw new Error(
                        "A cópia não está disponível neste navegador.",
                      );
                    await navigator.clipboard.writeText(
                      new URL(
                        admissionLinkPath(c.organizationId, oneTimeLink),
                        location.origin,
                      ).href,
                    );
                    c.notify("Link copiado.");
                  })
                }
              >
                Copiar link gerado
              </Button>
            </>
          ) : links.link && !links.link.revokedAt ? (
            <p>
              O segredo não pode ser recuperado após recarregar. Gere outro link
              se precisar substituí-lo.
            </p>
          ) : null}
        </section>
      )}
    </section>
  );
}
export const invitationManagementFeature: FeatureDefinition = {
  id: "organization-invitations",
  module: "members",
  label: "Convites",
  matches: (path) => /^\/organization-invitations\/?(?:[?#].*)?$/.test(path),
  Component: InvitationManagement,
  navigation: [
    {
      path: "/organization-invitations",
      label: "Convites",
      location: "identity",
      visible: (context) => context.bootstrap.membership.memberType !== "GUEST",
    },
  ],
};

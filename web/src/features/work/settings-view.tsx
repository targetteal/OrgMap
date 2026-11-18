import { FieldDefinitionsView } from "./custom-field-inputs";
import { WorkExportView } from "./export-view";
import { WorkImportView } from "./import-view";
import { WorkTemplatesView } from "./templates-view";
import { useEffect, useState, type FormEvent } from "react";
import type { FeatureContext } from "../../feature-contract";
export type WorkPolicy = {
  showAllUnassigned: boolean;
  autoCreateForNewCircles: boolean;
  autoCreateEnabledAt: string | null;
  allowMultipleProjectsPerCircle: boolean;
  defaultPrivacy: "PUBLIC" | "PRIVATE";
  lockProjectConfiguration: boolean;
  defaultAssignmentMode: "SINGLE" | "MULTIPLE";
  defaultAssignmentPermission: "EDITORS" | "MANAGERS";
  version: number;
};
export function WorkSettingsView({
  context: c,
  formatError,
}: {
  context: FeatureContext;
  formatError: (error: unknown) => string;
}) {
  const [saved, setSaved] = useState<WorkPolicy | null>(null),
    [draft, setDraft] = useState<WorkPolicy | null>(null),
    [manage, setManage] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const base = `/organizations/${c.organizationId}/work`,
    tab =
      new URLSearchParams(c.path.split("?")[1] ?? "").get("tab") ?? "general";
  useEffect(() => {
    const a = new AbortController();
    setSaved(null);
    setDraft(null);
    setError("");
    c.api<{ settings: WorkPolicy; capabilities: { manage: boolean } }>(
      base + "/settings",
      { signal: a.signal },
    )
      .then((r) => {
        if (!a.signal.aborted) {
          setSaved(r.data.settings);
          setDraft(r.data.settings);
          setManage(r.data.capabilities.manage);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(formatError(e));
      });
    return () => a.abort();
  }, [base, c.api, revision]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !saved) return;
    setBusy(true);
    setError("");
    try {
      const { version, autoCreateEnabledAt, ...values } = draft;
      const r = await c.api<{ settings: WorkPolicy }>(base + "/settings", {
        method: "POST",
        body: values,
        version: saved.version,
      });
      setSaved(r.data.settings);
      setDraft(r.data.settings);
      c.notify("Configurações de projetos salvas.");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (
    key:
      | "showAllUnassigned"
      | "autoCreateForNewCircles"
      | "allowMultipleProjectsPerCircle"
      | "lockProjectConfiguration",
    label: string,
  ) => (
    <label className="work-setting-switch">
      <input
        type="checkbox"
        role="switch"
        checked={draft?.[key] ?? false}
        disabled={!manage || busy}
        onChange={(e) =>
          setDraft((d) => (d ? { ...d, [key]: e.target.checked } : d))
        }
      />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="work-root mare-work work-global-settings">
      <header className="page-heading">
        <h2>Configurações</h2>
      </header>
      <nav
        className="work-settings-tabs"
        aria-label="Configurações dos projetos"
      >
        {[
          ["general", "Geral"],
          ["templates", "Modelos"],
          ["fields", "Campos"],
          ["stats", "Estatísticas"],
          ["import", "Importar"],
          ["export", "Exportar"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "work-setting-tab-active" : ""}
            onClick={() =>
              key === "stats"
                ? c.navigate("/projects/stats")
                : c.navigate("/projects/settings?tab=" + key)
            }
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="notice" role="alert">
          {error}
          <button onClick={() => setRevision((v) => v + 1)}>
            Recarregar configurações
          </button>
        </div>
      )}
      {!draft ? (
        <div className="loading-screen" role="status">
          {error
            ? "Não foi possível carregar as configurações."
            : "Carregando configurações…"}
        </div>
      ) : tab === "general" ? (
        <form className="work-global-form" onSubmit={save}>
          <p className="work-settings-save-hint">
            As alterações são aplicadas ao salvar.
          </p>
          <section>
            <h3>Mostrar todos os projetos</h3>
            <p>
              Mostre projetos públicos também a membros que ainda não participam
              deles. Projetos privados continuam restritos às pessoas
              autorizadas.
            </p>
            {toggle(
              "showAllUnassigned",
              "Mostrar projetos não atribuídos para todos os membros",
            )}
          </section>
          <section>
            <h3>Criação de projetos</h3>
            <p>
              Defina como novos projetos são organizados em torno dos círculos.
            </p>
            {toggle(
              "autoCreateForNewCircles",
              "Habilitar criação automática de projetos para novos círculos",
            )}
            {toggle(
              "allowMultipleProjectsPerCircle",
              "Habilitar criação de múltiplos projetos por círculo",
            )}
          </section>
          <section>
            <h3>Privacidade padrão dos novos projetos</h3>
            <p>
              Nível pré-selecionado no formulário. A pessoa que cria o projeto
              pode alterá-lo.
            </p>
            <label className="field">
              Privacidade pré-selecionada
              <select
                aria-label="Privacidade pré-selecionada"
                value={draft.defaultPrivacy}
                disabled={!manage || busy}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultPrivacy: e.target
                      .value as WorkPolicy["defaultPrivacy"],
                  })
                }
              >
                <option value="PUBLIC">Público na organização</option>
                <option value="PRIVATE">Privado</option>
              </select>
            </label>
          </section>
          <section>
            <h3>Bloquear edição do projeto</h3>
            <p>
              Impede alterações no layout e nas configurações de todos os
              projetos, inclusive por administradores. Os projetos existentes
              mantêm sua configuração atual.
            </p>
            {toggle("lockProjectConfiguration", "Bloquear edição")}
            <p>
              O bloqueio das tarefas de um projeto continua sendo uma
              configuração separada.
            </p>
          </section>
          <section>
            <h3>Atribuições em novos projetos</h3>
            <label className="field">
              Quantidade de responsáveis
              <select
                aria-label="Quantidade de responsáveis padrão"
                value={draft.defaultAssignmentMode}
                disabled={!manage || busy}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultAssignmentMode: e.target
                      .value as WorkPolicy["defaultAssignmentMode"],
                  })
                }
              >
                <option value="MULTIPLE">Vários responsáveis</option>
                <option value="SINGLE">Um responsável por tarefa</option>
              </select>
            </label>
            <label className="field">
              Quem pode atribuir
              <select
                aria-label="Permissão de atribuição padrão"
                value={draft.defaultAssignmentPermission}
                disabled={!manage || busy}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultAssignmentPermission: e.target
                      .value as WorkPolicy["defaultAssignmentPermission"],
                  })
                }
              >
                <option value="EDITORS">Editores e gestores</option>
                <option value="MANAGERS">Somente gestores</option>
              </select>
            </label>
          </section>
          {!manage && (
            <p className="muted">
              Somente proprietários da organização podem alterar estas regras.
            </p>
          )}
          <div className="form-actions">
            <button className="primary" disabled={!manage || busy}>
              {busy ? "Salvando…" : "Salvar configurações"}
            </button>
          </div>
        </form>
      ) : tab === "fields" ? <FieldDefinitionsView key={c.organizationId+":"+c.session.account.id} context={c}/> : tab === "templates" ? (
        <WorkTemplatesView context={c} formatError={formatError} />
      ) : tab === "import" ? (
        <WorkImportView context={c} formatError={formatError} />
      ) : (
        <WorkExportView context={c} formatError={formatError} />
      )}
    </div>
  );
}

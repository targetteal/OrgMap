export { MemberIndicatorDefinition } from "./MemberIndicatorDefinition";
export { MemberIndicators } from "./MemberIndicators";
import { RichTextEditor, RichTextView, type RichDocument } from "../../editor";
import { emptyRichDocument, fromPlainText } from "../../../../packages/content/index";
import {
  RoleFunctionEditor,
  StructureEntitySections,
} from "./RoleFunctionEditor";
import { useLocalization } from "../../localization";
import type { EditorItem } from "./value-editor-state";
import { ValueEditor } from "./ValueEditor";
import { useEffect, useState, useCallback, type FormEvent } from "react";
import type { FeatureDefinition, FeatureContext } from "../../feature-contract";
import { Button, Dialog, Field, Notice } from "../../ui";
import { errorMessage, RequestError } from "../../api";
import "./structure.css";
import {SettingsFrame} from "../administration/SettingsFrame";
type Item = Record<string, any>;
type Catalog = {
  templates: Item[];
  fields: Item[];
  roleSettings: Item[];
  indicators: Item[];
  views: Item[];
  snapshots: Item[];
  capabilities: { configure: boolean };
};
const flagLabels: Record<string, string> = {
  core: "Membro essencial",
  electable: "Eletivo",
  assigner: "Atribui ocupações",
  representative: "Representa no círculo pai",
  admin: "Administra este círculo",
};
function GoalsModuleSetting({ context: c }: { context: FeatureContext }) {
  const [settings, setSettings] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/organizations/${c.organizationId}/administration/settings`;
  useEffect(() => {
    const controller = new AbortController();
    c.api<Item>(path, { signal: controller.signal }).then(r => setSettings(r.data)).catch(e => {
      if (!controller.signal.aborted) setError(errorMessage(e));
    });
    return () => controller.abort();
  }, [path, c.api]);
  async function change(enabled: boolean) {
    if (!settings) return;
    setBusy(true); setError("");
    try {
      const current = await c.api<Item>(path);
      const saved = await c.api<Item>(path, { method: "PUT", version: current.data.version,
        body: { settings: { ...current.data.settings, modules: { ...current.data.settings.modules, goals: enabled } } } });
      setSettings({ ...saved.data, capabilities: current.data.capabilities });
      c.refresh();
      c.notify(enabled ? "Objetivos habilitados." : "Objetivos desabilitados.");
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="sa-goals-setting">
    <h2>Módulos da estrutura</h2>
    <label><input type="checkbox" checked={settings?.settings.modules.goals === true}
      disabled={!settings?.capabilities?.manage || busy} onChange={e => void change(e.target.checked)} /> Habilitar Objetivos</label>
    <p className="muted">A desativação oculta o módulo e preserva os objetivos existentes.</p>
    {error && <Notice>{error}</Notice>}
  </section>;
}
function StructureAdvanced({ context: c }: { context: FeatureContext }) {
  const [templatePurpose, setTemplatePurpose] =
    useState<RichDocument>(emptyRichDocument);
  const [templateEditing, setTemplateEditing] = useState<Item | null>(null);
  const [templateStale, setTemplateStale] = useState(false);
  const [templateLatest, setTemplateLatest] = useState<Item | null>(null);
  const { formatInstant, formatNumber } = useLocalization();
  const base = `/organizations/${c.organizationId}/structure-advanced`;
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [graph, setGraph] = useState<Item | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [revision, setRevision] = useState(0),
    [tab, setTab] = useState("models"),
    [selected, setSelected] = useState(""),
    [details, setDetails] = useState<EditorItem[] | null>(null),
    [detailsEntity, setDetailsEntity] = useState(""),
    [history, setHistory] = useState<Item[] | null>(null),
    [dialog, setDialog] = useState(""),
    [records, setRecords] = useState<Item | null>(null),
    [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [indicatorId, setIndicatorId] = useState("");
  const load = useCallback(
    async (signal: AbortSignal) => {
      setError("");
      try {
        const [cat, g] = await Promise.all([
          c.api<Catalog>(base + "/catalog", { signal }),
          c.api<Item>(base + "/graph", { signal }),
        ]);
        if (!signal.aborted) {
          setCatalog(cat.data);
          setGraph(g.data);
        }
      } catch (e) {
        if (!signal.aborted) setError(errorMessage(e));
      }
    },
    [base, c.api],
  );
  useEffect(() => {
    setCatalog(null);
    setGraph(null);
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);
  useEffect(() => {
    if (catalog && graph && (c.hash === "#role-templates" || c.path.endsWith("#role-templates"))) {
      setTab("models");
      requestAnimationFrame(() => document.getElementById("role-templates")?.scrollIntoView?.({block:"start"}));
    }
  }, [catalog, graph, c.hash, c.path]);
  useEffect(() => {
    if (dialog !== "template") return;
    return c.registerNavigationGuard?.(() => pending ? "Aguarde o salvamento do modelo de papel." : "Salve ou feche o editor de modelo de papel antes de sair.");
  }, [dialog, pending, c.registerNavigationGuard]);
  useEffect(() => {
    setDetails(null);
    setHistory(null);
    if (!selected) return;
    const ctrl = new AbortController();
    Promise.all([
      c.api<EditorItem[]>(base + "/entities/" + selected + "/fields", {
        signal: ctrl.signal,
      }),
      c.api<Item>(base + "/entities/" + selected + "/history", {
        signal: ctrl.signal,
      }),
    ])
      .then(([v, h]) => {
        if (!ctrl.signal.aborted) {
          setDetails(v.data);
          setDetailsEntity(selected);
          setHistory(h.data.items);
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [selected, revision, base, c.api]);
  useEffect(() => {
    setRecords(null);
    if (!indicatorId || !period) return;
    const ctrl = new AbortController();
    c.api<Item>(
      base +
        "/indicators/" +
        indicatorId +
        "/records?period=" +
        encodeURIComponent(period),
      { signal: ctrl.signal },
    )
      .then((r) => {
        if (!ctrl.signal.aborted) setRecords(r.data);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [base, c.api, indicatorId, period, revision]);
  async function mutate(
    path: string,
    body: unknown,
    method = "POST",
    version?: number,
  ) {
    setPending(true);
    setError("");
    try {
      await c.api(base + path, { method, body, version });
      setDialog("");
      setRevision((x) => x + 1);
      c.notify("Alteração salva.");
      return true;
    } catch (e) {
      setError(errorMessage(e));
      if (dialog === "template" && e instanceof RequestError && e.code === "VERSION_CONFLICT") { setTemplateStale(true); setTemplateLatest(null); }
      return false;
    } finally {
      setPending(false);
    }
  }
  async function loadLatestTemplate() {
    if (!templateEditing) return;
    setPending(true); setError("");
    try {
      const response = await c.api<Catalog>(base + "/catalog");
      const latest = response.data.templates.find(item => item.id === templateEditing.id);
      if (!response.data.capabilities.configure || !latest) {setError("O modelo não está disponível para edição neste acesso."); return;}
      setTemplateLatest(latest);
    } catch (e) {setError(errorMessage(e));} finally {setPending(false);}
  }
  const entities: Item[] = graph?.entities ?? [],
    chosen = entities.find((e) => e.id === selected),
    canConfigure = catalog?.capabilities.configure === true;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form),
      get = (key: string) => String(f.get(key) ?? "");
    const roleId = get("roleId"),
      entityId = get("entityId");
    if (dialog === "template" && !templateStale)
      await mutate(templateEditing ? "/templates/" + encodeURIComponent(templateEditing.id) : "/templates", {
        name: get("name"),
        purposeRich: templatePurpose,
        flags: Object.fromEntries(
          Object.keys(flagLabels).map((k) => [k, f.has(k)]),
        ),
      }, templateEditing ? "PATCH" : "POST", templateEditing?.version);
    if (dialog === "role") {
      const settings = catalog?.roleSettings.find((r) => r.roleId === roleId);
      await mutate(
        "/roles/" + roleId + "/settings",
        get("templateId")
          ? { templateId: get("templateId") }
          : {
              flags: Object.fromEntries(
                Object.keys(flagLabels).map((k) => [k, f.has(k)]),
              ),
            },
        "PUT",
        settings?.version ?? 0,
      );
    }
    if (dialog === "alias")
      await mutate("/aliases", {
        sourceRoleId: roleId,
        circleId: get("circleId"),
        label: get("name"),
      });
    if (dialog === "mandate")
      await mutate("/mandates", {
        roleId,
        memberId: get("memberId"),
        kind: get("kind"),
        scope: get("scope"),
        startsAt: new Date(get("startsAt")).toISOString(),
        endsAt: get("endsAt") ? new Date(get("endsAt")).toISOString() : null,
      });
    if (dialog === "policy") {
      const vals = ["name", "purpose", "responsibilities", "artifacts", "CREATE", "MOVE", "ARCHIVE"].filter(
        (k) => f.has(k),
      );
      await mutate(
        "/circles/" + get("circleId") + "/policy",
        { governedFields: vals },
        "PUT",
        Number(get("policyVersion")),
      );
    }
    if (dialog === "field") {
      const type = get("type");
      await mutate("/fields", {
        key: get("key"),
        label: get("name"),
        target: get("target"),
        schema: {
          type,
          required: f.has("required"),
          ...(type === "COMPUTED"
            ? {
                formula: {
                  op: get("formulaOp"),
                  fieldIds: f.getAll("fieldIds").map(String),
                },
              }
            : {}),
          ...(["SELECT", "MULTI"].includes(type)
            ? {
                options: get("options")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
        },
        governed: f.has("governed"),
      });
    }
    if (dialog === "indicator")
      await mutate("/indicators", {
        entityId,
        name: get("name"),
        kind: get("kind"),
        valueType: get("kind") === "CHECKLIST" ? "BOOLEAN" : get("valueType"),
        unit: get("unit"),
        requiredUnits: get("requiredUnits")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    if (dialog === "snapshot")
      await mutate("/snapshots", { name: get("name") });
    if (dialog === "record" && records) {
      const type = records.indicator.valueType;
      const value =
        type === "NUMBER"
          ? Number(get("value"))
          : type === "BOOLEAN"
            ? get("value") === "true"
            : get("value");
      const unit = get("unitKey"),
        current = records.latest.find((r: Item) => r.unitKey === unit);
      await mutate(
        "/indicators/" + indicatorId + "/records",
        { period, unitKey: unit, value },
        "POST",
        current?.version ?? 0,
      );
    }
  }
  function select(
    name: string,
    items: Item[],
    label: string,
    defaultValue?: string,
  ) {
    return (
      <Field label={label} name={name}>
        <select name={name} required defaultValue={defaultValue ?? ""}>
          <option value="" disabled>
            Selecionar
          </option>
          {items.map((x) => (
            <option value={x.id} key={x.id}>
              {x.name ?? x.displayName ?? x.id}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <SettingsFrame context={c}><div className="sa-page">
      <div className="page-heading">
        <h1>Estrutura avançada</h1>
        <Button onClick={() => c.navigate("/structure")}>
          Abrir estrutura
        </Button>
        <Button disabled={pending} onClick={() => setRevision((x) => x + 1)}>
          Atualizar
        </Button>
      </div>
      {c.bootstrap.governanceModel && <GoalsModuleSetting context={c} />}
      <nav className="sa-tabs" aria-label="Áreas da estrutura">
        {[
          ["models", "Modelos e ocupações"],
          ["fields", "Campos"],
          ["indicators", "Métricas e checklists"],
          ["history", "Histórico"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <Notice>
          {error} Os dados digitados foram preservados. Revise a versão e tente
          novamente.
        </Notice>
      )}
      {!catalog || !graph ? (
        <p role="status">Carregando estrutura…</p>
      ) : (
        <>
          {tab === "models" && (
            <>
              <section>
                <h2>Função do papel</h2>
                <label>
                  Papel
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Selecionar</option>
                    {entities
                      .filter((e) => e.kind === "ROLE")
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </label>
                {selected &&
                  entities.find((e) => e.id === selected)?.kind === "ROLE" && (
                    <RoleFunctionEditor context={c} roleId={selected} />
                  )}
              </section>
              <section id="role-templates" className="sa-role-templates">
              <h2>Modelos reutilizáveis de papéis</h2>
              <p className="muted">Modelos da organização com nome, propósito e funções. Ao configurar um papel, somente as funções são copiadas; o propósito do papel existente não é alterado. Estes modelos são independentes das funções essenciais O2 e não são criados automaticamente nos círculos.</p>
              <div className="collection-toolbar">
                {canConfigure && (
                  <>
                    <Button
                      onClick={() => {
                        setError(""); setTemplateStale(false); setTemplateLatest(null);
                        setTemplateEditing(null);
                        setTemplatePurpose(emptyRichDocument());
                        setDialog("template");
                      }}
                    >
                      Novo modelo de papel
                    </Button>
                    <Button onClick={() => setDialog("role")}>
                      Configurar papel
                    </Button>
                    <Button onClick={() => setDialog("alias")}>
                      Compartilhar papel
                    </Button>
                  </>
                )}
                <Button onClick={() => setDialog("mandate")}>
                  Atribuir ocupação
                </Button>
              </div>
              {catalog.templates.length ? (
                catalog.templates.map((t) => (
                  <div className="entity-row" key={t.id}>
                    <strong>{t.name}</strong>
                    <RichTextView value={t.purposeRich ?? t.purpose ?? ""} />
                    <span>
                      {Object.entries(flagLabels)
                        .filter(([k]) => t.flags[k])
                        .map(([, l]) => l)
                        .join(" · ") || "Sem funções especiais"}
                    </span>
                    {canConfigure && <Button ariaLabel={"Editar modelo de papel " + t.name} onClick={() => {setError("");setTemplateStale(false);setTemplateLatest(null);setTemplateEditing(structuredClone(t));setTemplatePurpose(t.purposeRich ?? fromPlainText(t.purpose ?? ""));setDialog("template");}}>Editar</Button>}
                  </div>
                ))
              ) : (
                <p className="empty-state">Nenhum modelo reutilizável de papel. Os papéis existentes continuam disponíveis.</p>
              )}
              <p className="muted">Alterações no modelo não modificam papéis ou ocupações existentes. Responsabilidades e artefatos são definidos nos papéis da estrutura.</p>
              </section>
              <Mandates
                context={c}
                base={base}
                roles={entities.filter((e) => e.kind === "ROLE")}
                revision={revision}
                mutate={mutate}
              />
            </>
          )}
          {tab === "fields" && (
            <>
              <section>
                <h2>Campos de uma entidade</h2>
                <label>
                  Círculo ou papel
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Selecionar</option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selected &&
                  (details === null || detailsEntity !== selected ? (
                    <p role="status">Carregando campos…</p>
                  ) : details.length ? (
                    details.map((v) => (
                      <ValueEditor
                        organizationId={c.organizationId}
                        entityId={selected}
                        key={v.field.id}
                        item={v}
                        disabled={!canConfigure || pending}
                        onSave={(value) =>
                          mutate(
                            "/entities/" + selected + "/fields/" + v.field.id,
                            { value },
                            "PUT",
                            v.version,
                          )
                        }
                      />
                    ))
                  ) : (
                    <p className="muted">
                      Nenhum campo configurado para esta entidade.
                    </p>
                  ))}
              </section>

              {canConfigure && (
                <div className="collection-toolbar">
                  <Button onClick={() => setDialog("field")}>Novo campo</Button>
                  <Button onClick={() => setDialog("policy")}>
                    Governança do círculo
                  </Button>
                </div>
              )}
              {catalog.fields.length ? (
                catalog.fields.map((f) => (
                  <div className="entity-row" key={f.id}>
                    <div>
                      <strong>{f.label}</strong>
                      <small>
                        {f.key} · {f.target} · versão {f.version}
                      </small>
                    </div>
                    <span>
                      {f.schema.type}
                      {f.governed ? " · Governado" : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p className="empty-state">Nenhum campo personalizado.</p>
              )}
              {canConfigure && (
                <FieldManager
                  context={c}
                  base={base}
                  fields={catalog.fields}
                  onSaved={() => setRevision((x) => x + 1)}
                />
              )}
              <p className="muted">
                Campos governados são alterados por proposta. A chave permanece
                estável ao renomear o rótulo.
              </p>
            </>
          )}
          {tab === "indicators" && (
            <>
              <div className="collection-toolbar">
                <Button onClick={() => setDialog("indicator")}>
                  Novo indicador
                </Button>
                <label>
                  Indicador
                  <select
                    value={indicatorId}
                    onChange={(e) => setIndicatorId(e.target.value)}
                  >
                    <option value="">Selecionar</option>
                    {catalog.indicators.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ·{" "}
                        {entities.find((e) => e.id === i.entityId)?.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Período
                  <input
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    placeholder="2026-10"
                  />
                </label>
              </div>
              {records ? (
                <>
                  <div className="page-heading">
                    <h2>{records.indicator.name}</h2>
                    <Button onClick={() => setDialog("record")}>
                      Registrar valor
                    </Button>
                  </div>
                  {records.indicator.kind === "CHECKLIST" && (
                    <p>
                      {records.completion.status === "UNKNOWN"
                        ? "Sem unidades exigíveis neste período"
                        : `${formatNumber(records.completion.numerator)} de ${formatNumber(records.completion.denominator)} concluídos · ${formatNumber(records.completion.rate / 100, { style: "percent", maximumFractionDigits: 2 })}`}
                    </p>
                  )}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Unidade</th>
                          <th>Valor atual</th>
                          <th>Versão</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.latest.map((r: Item) => (
                          <tr key={r.id}>
                            <td>{r.unitKey}</td>
                            <td>{String(r.value)}</td>
                            <td>{r.version}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!records.latest.length && (
                    <p className="empty-state">
                      UNKNOWN — nenhum valor registrado para este período.
                    </p>
                  )}
                  <details>
                    <summary>
                      Histórico de registros ({records.records.length})
                    </summary>
                    {records.records.map((r: Item) => (
                      <p key={r.id}>
                        {r.unitKey} · {String(r.value)} · v{r.version} ·{" "}
                        {formatInstant(r.at)}
                      </p>
                    ))}
                  </details>
                </>
              ) : (
                <p className="empty-state">
                  Selecione um indicador para consultar um período.
                </p>
              )}
            </>
          )}
          {tab === "history" && (
            <>
              <div className="collection-toolbar">
                {canConfigure && (
                  <Button onClick={() => setDialog("snapshot")}>
                    Capturar estrutura
                  </Button>
                )}
                <label>
                  Entidade
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Selecionar</option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <h2>Capturas de estrutura</h2>
              {catalog.snapshots.map((s) => (
                <Snapshot key={s.id} item={s} context={c} base={base} />
              ))}
              {!catalog.snapshots.length && (
                <p className="muted">Nenhuma captura registrada.</p>
              )}
              <h2>Alterações da entidade</h2>
              <p className="muted">
                Histórico dos comandos avançados. Alterações anteriores da
                fundação permanecem na auditoria da organização.
              </p>
              {history?.map((h) => (
                <div key={h.id} className="entity-row">
                  <span>{h.action}</span>
                  <time>{formatInstant(h.at)}</time>
                </div>
              ))}
            </>
          )}
        </>
      )}
      {dialog && (
        <Dialog
          title={
            (
              {
                template: templateEditing ? "Editar modelo de papel" : "Novo modelo de papel",
                role: "Configurar papel",
                alias: "Compartilhar papel",
                mandate: "Atribuir ocupação",
                field: "Novo campo",
                indicator: "Novo indicador",
                snapshot: "Capturar estrutura",
                policy: "Governança do círculo",
                view: "Salvar vista",
                record: "Registrar valor",
              } as Record<string, string>
            )[dialog]
          }
          onClose={() => !pending && setDialog("")}
        >
          <form className="edit-form" onSubmit={submit}>
            {error && (
              <Notice>{error} Revise os dados e tente novamente.</Notice>
            )}
            {dialog === "template" && templateStale && <div className="sa-template-conflict" role="status"><p>O modelo foi alterado em outra sessão. Seu rascunho foi preservado. Consulte a versão atual antes de escolher se deseja atualizar a partir dela.</p>{!templateLatest ? <Button disabled={pending} onClick={() => void loadLatestTemplate()}>Consultar versão atual</Button> : <><h3>Versão atual: {templateLatest.name}</h3><RichTextView value={templateLatest.purposeRich ?? templateLatest.purpose ?? ""}/><p>{Object.entries(flagLabels).filter(([key]) => templateLatest.flags?.[key]).map(([,label]) => label).join(" · ") || "Sem funções especiais"}</p><Button disabled={pending} onClick={() => {setTemplateEditing(current => current ? {...current,version:templateLatest.version} : current);setTemplateStale(false);setTemplateLatest(null);setError("");}}>Usar esta versão e manter meu rascunho</Button></>}</div>}
            {[
              "template",
              "alias",
              "field",
              "indicator",
              "snapshot",
              "view",
            ].includes(dialog) && (
              <Field
                label={dialog === "field" ? "Rótulo" : "Nome"}
                name="name"
                value={dialog === "template" ? (templateEditing?.name ?? "") : ""}
                required
                maxLength={200}
              />
            )}
            {["role", "alias", "mandate"].includes(dialog) &&
              select(
                "roleId",
                entities.filter((e) => e.kind === "ROLE"),
                "Papel",
                chosen?.kind === "ROLE" ? chosen.id : undefined,
              )}
            {dialog === "template" && (
              <RichTextEditor
                key={c.organizationId + ":template:" + (templateEditing?.id ?? "new")}
                label="Propósito do modelo de papel"
                readOnly={pending}
                value={templatePurpose}
                onChange={setTemplatePurpose}
                pending={pending}
              />
            )}
            {dialog === "role" && (
              <Field label="Modelo (opcional)" name="templateId">
                <select name="templateId">
                  <option value="">Configurar funções abaixo</option>
                  {catalog?.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {["template", "role"].includes(dialog) && (
              <fieldset>
                <legend>Funções do papel</legend>
                {Object.entries(flagLabels).map(([k, l]) => (
                  <label className="sa-check" key={k}>
                    <input type="checkbox" name={k} defaultChecked={dialog === "template" ? !!templateEditing?.flags?.[k] : false} />
                    {l}
                  </label>
                ))}
              </fieldset>
            )}
            {dialog === "policy" && (
              <>
                {select(
                  "circleId",
                  entities.filter((e) => e.kind === "CIRCLE"),
                  "Círculo",
                )}
                <Field
                  label="Versão atual da política (0 para primeira configuração)"
                  name="policyVersion"
                  value="0"
                  type="number"
                  required
                />
                <fieldset>
                  <legend>Exigir proposta para</legend>
                  {[
                    ["name", "Nome"],
                    ["purpose", "Propósito"],
                    ["responsibilities", "Responsabilidades"],
                    ["artifacts", "Artefatos"],
                    ["CREATE", "Criar filhos"],
                    ["MOVE", "Mover"],
                    ["ARCHIVE", "Arquivar"],
                  ].map(([k, l]) => (
                    <label className="sa-check" key={k}>
                      <input type="checkbox" name={k} />
                      {l}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            {dialog === "alias" &&
              select(
                "circleId",
                entities.filter((e) => e.kind === "CIRCLE"),
                "Círculo de destino",
              )}
            {dialog === "mandate" && (
              <>
                {select("memberId", c.members, "Pessoa")}
                <Field label="Tipo" name="kind">
                  <select name="kind">
                    <option value="DIRECT">Direta</option>
                    <option value="INTERIM">Interina</option>
                  </select>
                </Field>
                <Field
                  label="Início"
                  name="startsAt"
                  type="datetime-local"
                  value={new Date(
                    Date.now() - new Date().getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                  required
                />
                <Field
                  label="Fim (obrigatório para interina)"
                  name="endsAt"
                  type="datetime-local"
                />
                <Field label="Escopo" name="scope" />
                <p className="muted">
                  Papéis eletivos exigem eleição aprovada ou ocupação interina
                  com fim.
                </p>
              </>
            )}
            {dialog === "field" && (
              <>
                <Field label="Chave estável" name="key" required />
                <Field label="Aplicar a" name="target">
                  <select name="target">
                    <option value="ROLE">Papéis</option>
                    <option value="CIRCLE">Círculos</option>
                    <option value="BOTH">Ambos</option>
                  </select>
                </Field>
                <Field label="Tipo" name="type">
                  <select name="type">
                    {[
                      "TEXT",
                      "NUMBER",
                      "BOOLEAN",
                      "DATE",
                      "SELECT",
                      "MULTI",
                      "COMPUTED",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Opções separadas por vírgulas (seleção)"
                  name="options"
                />
                <Field label="Operação calculada" name="formulaOp">
                  <select name="formulaOp">
                    <option value="SUM">Soma</option>
                    <option value="COUNT">Quantidade</option>
                  </select>
                </Field>
                <Field
                  label="Campos de origem (para tipo calculado)"
                  name="fieldIds"
                >
                  <select name="fieldIds" multiple>
                    {catalog?.fields
                      .filter((f) => f.schema.type !== "COMPUTED")
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                  </select>
                </Field>
                <label className="sa-check">
                  <input type="checkbox" name="required" />
                  Obrigatório
                </label>
                <label className="sa-check">
                  <input type="checkbox" name="governed" />
                  Alterações por governança
                </label>
              </>
            )}
            {dialog === "indicator" && (
              <>
                {select(
                  "entityId",
                  entities,
                  "Círculo ou papel",
                  selected || undefined,
                )}
                <Field label="Categoria" name="kind">
                  <select name="kind">
                    <option value="METRIC">Métrica</option>
                    <option value="CHECKLIST">Checklist</option>
                  </select>
                </Field>
                <Field label="Tipo do valor" name="valueType">
                  <select name="valueType">
                    <option value="NUMBER">Número</option>
                    <option value="BOOLEAN">Sim / não</option>
                    <option value="TEXT">Texto</option>
                  </select>
                </Field>
                <Field label="Unidade de medida" name="unit" />
                <Field
                  label="Unidades exigíveis, separadas por vírgulas"
                  name="requiredUnits"
                />
              </>
            )}
            {dialog === "record" && records && (
              <>
                <Field label="Unidade" name="unitKey">
                  {records.indicator.requiredUnits.length ? (
                    <select name="unitKey">
                      {records.indicator.requiredUnits.map((u: string) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  ) : (
                    <input name="unitKey" required />
                  )}
                </Field>
                <Field label="Valor" name="value">
                  {records.indicator.valueType === "BOOLEAN" ? (
                    <select name="value">
                      <option value="true">Sim</option>
                      <option value="false">Não</option>
                    </select>
                  ) : (
                    <input
                      name="value"
                      required
                      type={
                        records.indicator.valueType === "NUMBER"
                          ? "number"
                          : "text"
                      }
                      step="any"
                    />
                  )}
                </Field>
              </>
            )}
            <div className="form-actions">
              <Button disabled={pending} onClick={() => setDialog("")}>
                Cancelar
              </Button>
              <button className="primary" disabled={pending || (dialog === "template" && templateStale)}>
                {pending ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div></SettingsFrame>
  );
}
function FieldManager({
  context: c,
  base,
  fields,
  onSaved,
}: {
  context: FeatureContext;
  base: string;
  fields: Item[];
  onSaved: () => void;
}) {
  const [fieldId, setFieldId] = useState(""),
    [entries, setEntries] = useState<Item[] | null>(null),
    [type, setType] = useState("TEXT"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [mode, setMode] = useState<"rename" | "migrate">("rename");
  const field = fields.find((f) => f.id === fieldId);
  useEffect(() => {
    setEntries(null);
    setError("");
    if (!field) return;
    setType(field.schema.type);
    const ctrl = new AbortController();
    c.api<Item>(base + "/graph", { signal: ctrl.signal })
      .then(async (g) => {
        const values = await Promise.all(
          g.data.entities.map(async (e: Item) => {
            const v = await c.api<Item[]>(
              base + "/entities/" + e.id + "/fields",
              { signal: ctrl.signal },
            );
            const match = v.data.find((x) => x.field.id === fieldId);
            return match && match.version > 0
              ? {
                  entityId: e.id,
                  name: e.name,
                  baseVersion: match.version,
                  value: match.value,
                }
              : null;
          }),
        );
        if (!ctrl.signal.aborted) setEntries(values.filter(Boolean) as Item[]);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [fieldId, field, base, c.api]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!field) return;
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError("");
    try {
      const schema =
        mode === "rename"
          ? field.schema
          : {
              type,
              required: field.schema.required,
              ...(["SELECT", "MULTI"].includes(type)
                ? {
                    options: String(f.get("options"))
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }
                : {}),
            };
      const definition = {
        key: field.key,
        label: String(f.get("label")),
        target: field.target,
        schema,
        governed: field.governed,
      };
      if (mode === "rename")
        await c.api(base + "/fields/" + field.id, {
          method: "PATCH",
          version: field.version,
          body: definition,
        });
      else {
        const values = (entries ?? []).map((row, i) => {
          const raw = String(f.get("value_" + i));
          return {
            entityId: row.entityId,
            baseVersion: row.baseVersion,
            value:
              raw === ""
                ? null
                : type === "NUMBER"
                  ? Number(raw)
                  : type === "BOOLEAN"
                    ? raw === "true"
                    : type === "MULTI"
                      ? raw.split(",").map((s) => s.trim())
                      : raw,
          };
        });
        await c.api(base + "/fields/" + field.id + "/migrate", {
          method: "POST",
          version: field.version,
          body: { definition, values },
        });
      }
      c.notify("Definição de campo salva.");
      setFieldId("");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section>
      <h2>Editar definição</h2>
      <label>
        Campo
        <select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
          <option value="">Selecionar</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {field && (
        <form className="edit-form" onSubmit={save} key={field.id}>
          {error && <Notice>{error}</Notice>}
          <Field label="Rótulo" name="label" value={field.label} required />
          <p className="muted">
            Chave preservada: {field.key} · versão {field.version}
          </p>
          <label>
            Operação
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "rename" | "migrate")}
            >
              <option value="rename">Renomear rótulo</option>
              <option
                value="migrate"
                disabled={field.schema.type === "COMPUTED" || field.governed}
              >
                Migrar tipo e valores
              </option>
            </select>
          </label>
          {mode === "migrate" && (
            <>
              <label>
                Novo tipo
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {["TEXT", "NUMBER", "BOOLEAN", "DATE", "SELECT", "MULTI"].map(
                    (t) => (
                      <option key={t}>{t}</option>
                    ),
                  )}
                </select>
              </label>
              <Field
                label="Opções (seleção), separadas por vírgulas"
                name="options"
                value={field.schema.options?.join(", ") ?? ""}
              />
              <p>
                Revise todos os valores. A migração aplica definição e valores
                na mesma transação e preserva o histórico.
              </p>
              {entries === null ? (
                <p role="status">Carregando valores atuais…</p>
              ) : (
                entries.map((row, i) => (
                  <Field
                    key={row.entityId}
                    label={row.name + " · v" + row.baseVersion}
                    name={"value_" + i}
                    value={
                      row.value === null
                        ? ""
                        : Array.isArray(row.value)
                          ? row.value.join(", ")
                          : String(row.value)
                    }
                    type={
                      type === "NUMBER"
                        ? "number"
                        : type === "DATE"
                          ? "date"
                          : "text"
                    }
                  />
                ))
              )}
            </>
          )}
          <button
            className="primary"
            disabled={pending || (mode === "migrate" && entries === null)}
          >
            {pending ? "Salvando…" : "Salvar definição"}
          </button>
        </form>
      )}
    </section>
  );
}
function Mandates({
  context: c,
  base,
  roles,
  revision,
  mutate,
}: {
  context: FeatureContext;
  base: string;
  roles: Item[];
  revision: number;
  mutate: (p: string, b: unknown, m?: string, v?: number) => Promise<boolean>;
}) {
  const { formatInstant } = useLocalization();
  const [role, setRole] = useState(""),
    [rows, setRows] = useState<Item[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    setRows([]);
    if (!role) return;
    const ctrl = new AbortController();
    c.api<Item>(base + "/roles/" + role + "/mandates", { signal: ctrl.signal })
      .then((r) => {
        if (!ctrl.signal.aborted) setRows(r.data.items);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [role, revision, base, c.api]);
  return (
    <section>
      <h2>Ocupações e mandatos</h2>
      <label>
        Papel
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Selecionar</option>
          {roles.map((r) => (
            <option value={r.id} key={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {error && <Notice>{error}</Notice>}
      {rows.map((r) => (
        <div className="entity-row" key={r.id}>
          <span>
            {c.members.find((m) => m.id === r.memberId)?.displayName ??
              r.memberId}{" "}
            · {r.kind}
            <small>
              {r.endsAt ? formatInstant(r.endsAt) : "Sem fim definido"}
            </small>
          </span>
          {r.endedAt ? (
            <span>Encerrada</span>
          ) : r.endsAt && Date.parse(r.endsAt) <= Date.now() ? (
            <span>Expirada</span>
          ) : (
            <Button
              onClick={() =>
                void mutate("/mandates/" + r.id + "/end", {}, "POST", r.version)
              }
            >
              Encerrar
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
function Snapshot({
  item: s,
  context: c,
  base,
}: {
  item: Item;
  context: FeatureContext;
  base: string;
}) {
  const { formatInstant } = useLocalization();
  const [open, setOpen] = useState(false),
    [graph, setGraph] = useState<Item | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    c.api<Item>(base + "/snapshots/" + s.id, { signal: ctrl.signal })
      .then((r) => {
        if (!ctrl.signal.aborted) setGraph(r.data.graph);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [open, base, c.api, s.id]);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {s.name} · {formatInstant(s.at)}
      </summary>
      {error && <Notice>{error}</Notice>}
      {graph ? (
        <>
          <p className="muted">
            Captura pontual, revisão {s.structureRevision}. Não representa
            períodos anteriores.
          </p>
          {graph.entities.map((e: Item) => (
            <p key={e.id}>
              {e.name} · {e.kind}
            </p>
          ))}
        </>
      ) : (
        <p>Carregando captura…</p>
      )}
    </details>
  );
}
export const feature: FeatureDefinition = {
  id: "structure-advanced",
  module: "structure",
  label: "Estrutura avançada",
  matches: (path) => path.split(/[?#]/, 1)[0] === "/structure/advanced",
  Component: StructureAdvanced,
  EntitySections: StructureEntitySections,

};

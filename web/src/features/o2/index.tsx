import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Settings2 } from "lucide-react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import { errorMessage, RequestError } from "../../api";
import { Button, Field, Notice } from "../../ui";
import { useLocalization } from "../../localization";
import {
  functionLabels,
  roleFunctions,
  type CircleConfiguration,
  type ModelOverrides,
  type ModelRules,
  type ModelView,
  type RoleFunction,
  type RoleView,
} from "./types";
import "./o2.css";
import {SettingsFrame} from "../administration/SettingsFrame";
import {initials} from "../../model";

const settingsPath = "/settings/governance-model";
const basePath = (c: FeatureContext) =>
  `/organizations/${c.organizationId}/governance-model`;
const messages: Record<string, string> = {
  VERSION_CONFLICT:
    "Esta configuração mudou. Recarregue os dados e revise antes de salvar novamente.",
  ACTION_DENIED:
    "Você não tem autoridade para esta ação neste círculo. Atualize os dados para conferir seus acessos.",
  ELECTION_REQUIRED:
    "Este papel é preenchido por eleição. Use o processo de governança do círculo.",
  ROLE_NOT_ELECTABLE: "Este papel não está configurado para eleição.",
  ROLE_INCOMPATIBILITY: "Esta pessoa já tem uma energização incompatível no mesmo período. Revise as funções e suas datas de vigência.",
  ELECTION_MEMBER_REQUIRED: "A pessoa escolhida precisa integrar o círculo para energizar esta função eleita.",
  OCCUPANCY_END_CANNOT_EXTEND: "Encerrar uma energização não pode prolongar sua vigência. Revise a data informada.",
  O2_ELECTION_REQUIRED:
    "Este papel é preenchido por eleição. Use o processo de governança do círculo.",
  O2_NOT_CIRCLE_MEMBER:
    "A autoenergização está disponível somente para quem já integra este círculo.",
  EXIT_AGREEMENT_ACTIVE:
    "Há um acordo de permanência vigente. Confira o acordo antes de encerrar a energização.",
  STRUCTURED_EXIT_AGREEMENT_REQUIRED:
    "Informe também a data de saída acordada para registrar este acordo.",
  ESSENTIAL_ROLE_PROTECTED:
    "Este papel segue a definição essencial escolhida. Para adaptá-la, o owner pode revisar as regras do modelo.",
  ESSENTIAL_DEFINITION_REQUIRES_MODEL_ADAPTATION:
    "A alteração desta definição exige uma adaptação explícita do modelo pelo owner.",
  ROLE_FUNCTION_ALREADY_BOUND:
    "Outro papel deste círculo já exerce essa função. Revise os vínculos antes de salvar.",
  IMPORT_REQUIRES_PREPARATION:
    "A importação de governança só está disponível durante a preparação. Volte à preparação antes de importar.",
  INVALID_GOVERNANCE_ARCHIVE:
    "O arquivo não segue a estrutura de exportação esperada (.zip com os CSVs de governança). Revise o arquivo e tente novamente.",
  MODEL_NOT_INSTALLED:
    "O modelo de governança ainda não foi preparado nesta organização.",
};
function message(error: unknown) {
  return error instanceof RequestError
    ? (messages[error.code] ?? errorMessage(error))
    : errorMessage(error);
}
function useModel(c: FeatureContext) {
  const [model, setModel] = useState<ModelView | null>(null);
  const [loadedOrganization, setLoadedOrganization] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const ctrl = new AbortController();
    setModel(null);
    setError("");
    c.api<ModelView>(basePath(c), { signal: ctrl.signal })
      .then((result) => {
        if (!ctrl.signal.aborted) {
          setModel(result.data);
          setLoadedOrganization(c.organizationId);
        }
      })
      .catch((error) => {
        if (!ctrl.signal.aborted) setError(message(error));
      });
    return () => ctrl.abort();
  }, [c.api, c.organizationId, c.bootstrap.authorizationRevision, revision]);
  return {
    model: loadedOrganization === c.organizationId ? model : null,
    error,
    setError,
    reload,
  };
}
function ModelSettings({ context: c }: { context: FeatureContext }) {
  const { model, error, setError, reload } = useModel(c);
  const { formatInstant } = useLocalization();
  const [busy, setBusy] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importReport, setImportReport] = useState("");
  const [draft, setDraft] = useState<ModelRules | null>(null);
  const [stale, setStale] = useState(false);
  const [chosenCircle, setChosenCircle] = useState("");
  const [circleDirty, setCircleDirty] = useState(false);
  const [definitionFunction,setDefinitionFunction]=useState<RoleFunction>("GUIDE");
  const settingsHash=(c.hash||c.path.split('#')[1]||'').replace(/^#/,'');
  const activeSettingsSection=settingsHash==='essential'?'essential':settingsHash==='circle-options'?'circle-options':'governance';
  const draftReady=Boolean(draft);
  useEffect(() => {
    if (!model || !draftReady) return;
    const hash=(c.hash || c.path.split("#")[1] || "").replace(/^#/, "");
    if (hash === "essential" || hash === "circle-options") document.getElementById("settings-"+hash)?.scrollIntoView?.({block:"start"});
  }, [model, draftReady, c.hash, c.path]);
  const titleId = useId();
  useEffect(() => {
    if (model?.rules) setDraft(structuredClone(model.rules));
    setStale(false);
  }, [model]);
  const dirty =
    !!model?.rules &&
    !!draft &&
    JSON.stringify(draft) !== JSON.stringify(model.rules);
  useEffect(
    () =>
      c.registerNavigationGuard?.(() =>
        dirty || busy
          ? "Há mudanças do modelo ainda não salvas. Revise antes de sair."
          : null,
      ),
    [c.registerNavigationGuard, dirty, busy],
  );
  async function mutate(
    path: string,
    body: unknown,
    method = "POST",
    version?: number,
  ) {
    setBusy(true);
    setError("");
    try {
      await c.api(basePath(c) + path, { method, body, version });
      c.notify(
        path === "/start"
          ? "Operação iniciada com as regras escolhidas."
          : path === "/pause"
            ? "Operação pausada. A estrutura volta a aceitar edição direta pelo owner."
            : path === "/install"
              ? "Base O2 preparada. Configure as energizações antes de operar."
              : "Regras do modelo salvas.",
      );
      reload();
      c.refresh();
    } catch (error) {
      setError(message(error));
      if (error instanceof RequestError && error.code === "VERSION_CONFLICT")
        setStale(true);
    } finally {
      setBusy(false);
    }
  }
  async function importGovernance() {
    if (!importFile || !model?.installed) return;
    setBusy(true);
    setError("");
    setImportReport("");
    try {
      const result = await c.api<{
        import: {
          circles: number;
          roles: number;
          assignments: number;
          policies: number;
          documents: number;
          skipped: { file: string; reference: string; reason: string }[];
          unmatchedMembers: string[];
        };
      }>(basePath(c) + "/import", {
        method: "POST",
        body: importFile,
        version: model.revision,
      });
      const report = result.data.import,
        counts = [
          `${report.circles} círculos`,
          `${report.roles} papéis`,
          `${report.assignments} energizações`,
          `${report.policies} políticas`,
          `${report.documents} documentos`,
        ].join(", "),
        notes = [
          report.unmatchedMembers.length
            ? `${report.unmatchedMembers.length} pessoas sem membro correspondente (e-mails: ${report.unmatchedMembers.slice(0, 5).join(", ")}${report.unmatchedMembers.length > 5 ? "…" : ""})`
            : "",
          report.skipped.length
            ? `${report.skipped.length} linhas ignoradas`
            : "",
        ]
          .filter(Boolean)
          .join("; ");
      setImportReport(
        `Importação concluída: ${counts}.${notes ? " " + notes + "." : ""}`,
      );
      c.notify("Governança importada para a preparação.");
      setImportFile(null);
      reload();
      c.refresh();
    } catch (error) {
      setError(message(error));
      if (error instanceof RequestError && error.code === "VERSION_CONFLICT")
        setStale(true);
    } finally {
      setBusy(false);
    }
  }
  const update = <K extends keyof ModelRules>(key: K, value: ModelRules[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const toggleFunction = (
    key: "essentialFunctions" | "electedFunctions",
    code: RoleFunction,
  ) => {
    if (!draft) return;
    if (
      key === "essentialFunctions" &&
      draft.essentialFunctions.includes(code)
    ) {
      setDraft({
        ...draft,
        essentialFunctions: draft.essentialFunctions.filter(
          (value) => value !== code,
        ),
        electedFunctions: draft.electedFunctions.filter(
          (value) => value !== code,
        ),
      });
    } else
      update(
        key,
        draft[key].includes(code)
          ? draft[key].filter((value) => value !== code)
          : [...draft[key], code],
      );
  };
  const customized =
    !!model?.overrides && Object.keys(model.overrides).length > 0;
  return (
    <SettingsFrame context={c}><section className="o2-settings" data-settings-section={activeSettingsSection} id={activeSettingsSection==='essential'?'settings-essential':undefined} aria-labelledby={titleId}>
      <header className="o2-heading">
        <Button
          onClick={() => c.navigate("/structure")}
          ariaLabel="Voltar à estrutura"
        >
          <ArrowLeft size={17} />
        </Button>
        <h2 id={titleId}>{activeSettingsSection==='essential'?'Papéis Essenciais':activeSettingsSection==='circle-options'?'Opções do círculo':'Estrutura e governança'}</h2>
      </header>
      <div className="o2-settings-body">
        {error && <Notice>{error}</Notice>}
        {!model ? (
          <div className="o2-loading">
            <p role="status">
              {error
                ? "Não foi possível carregar o modelo."
                : "Carregando modelo de governança…"}
            </p>
            <Button disabled={busy} onClick={reload}>
              Recarregar dados
            </Button>
          </div>
        ) : (
          <>
            <div className="o2-introduction" hidden={model.installed&&activeSettingsSection!=='governance'}>
              <h2>
                {model.installed
                  ? customized
                    ? "Modelo próprio a partir de O2"
                    : "Organização Orgânica"
                  : "Começar com Organização Orgânica"}
              </h2>
              <p>
                O2 oferece uma base de papéis, energizações e regras para
                começar. A organização pode adaptar esse modelo ao longo do
                tempo.
              </p>
              <a
                href={
                  model.package.reference?.url ||
                  "https://o2.targetteal.com/meta-acordos"
                }
              >
                Consultar os Meta-Acordos O2 <ArrowRight size={14} />
              </a>
            </div>
            {!model.installed ? (
              <section className="o2-install">
                <h3>Preparar a base O2</h3>
                <p>
                  O círculo geral existente será mantido. Guia, representante,
                  facilitador e escriba serão criados como papéis iniciais, sem
                  atribuir pessoas automaticamente.
                </p>
                <p>
                  Durante a preparação, o owner monta ou importa a estrutura e
                  define as energizações diretamente. A operação começa somente
                  quando ele a inicia.
                </p>
                {model.canManage ? (
                  <Button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void mutate("/install", { packageId: "targetteal.o2" })
                    }
                  >
                    {busy
                      ? "Preparando…"
                      : "Escolher O2 e preparar organização"}
                  </Button>
                ) : (
                  <p>
                    O owner da organização pode escolher e preparar o modelo.
                  </p>
                )}
              </section>
            ) : (
              <>
                <div hidden={activeSettingsSection!=='governance'}><div className="o2-state-line">
                  <span
                    className={`o2-phase ${model.phase === "OPERATING" ? "is-operating" : ""}`}
                  >
                    {model.phase === "OPERATING" ? (
                      <Check size={14} />
                    ) : (
                      <Settings2 size={14} />
                    )}{" "}
                    {model.phase === "OPERATING"
                      ? "Em operação"
                      : "Em preparação"}
                  </span>
                  <span>
                    Pacote {model.package.version} · revisão {model.revision}
                  </span>
                </div>
                {model.phase === "PREPARATION" ? (
                  <section className="o2-preparation">
                    <h3>Prepare a organização no seu ritmo</h3>
                    <ol>
                      <li>
                        <strong>Monte ou importe a estrutura</strong>
                        <span>
                          Defina círculos, papéis, propósitos, responsabilidades
                          e artefatos.
                        </span>
                      </li>
                      <li>
                        <strong>Defina quem energiza cada papel</strong>
                        <span>
                          Abra um papel na estrutura para atribuir as pessoas.
                          Na preparação, essas atribuições não simulam eleições.
                        </span>
                      </li>
                      <li>
                        <strong>Revise as regras e inicie a operação</strong>
                        <span>
                          As regras escolhidas passam a orientar as novas ações.
                          Você pode adaptá-las depois.
                        </span>
                      </li>
                    </ol>
                    {model.canManage && (
                      <div className="o2-import">
                        <h3>Importar governança existente</h3>
                        <p className="o2-hint">
                          Envie o arquivo .zip de uma exportação de governança
                          (círculos, papéis, energizações, políticas e
                          documentos). Os dados entram diretamente na estrutura
                          em preparação.
                        </p>
                        <div className="o2-actions">
                          <input
                            type="file"
                            accept=".zip,application/zip,application/x-zip-compressed"
                            disabled={busy}
                            aria-label="Arquivo de exportação da governança"
                            onChange={(event) =>
                              setImportFile(event.target.files?.[0] ?? null)
                            }
                          />
                          <Button
                            disabled={busy || !importFile}
                            onClick={() => void importGovernance()}
                          >
                            {busy ? "Importando…" : "Importar arquivo"}
                          </Button>
                        </div>
                        {importReport && (
                          <p className="o2-hint" role="status">
                            {importReport}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="o2-actions">
                      <Button onClick={() => c.navigate("/structure")}>
                        Montar estrutura e energizações <ArrowRight size={15} />
                      </Button>
                      {model.canManage && (
                        <Button
                          className="primary"
                          disabled={busy || dirty || stale}
                          onClick={() =>
                            void mutate("/start", {}, "POST", model.revision)
                          }
                        >
                          {busy ? "Iniciando…" : "Iniciar operação"}
                        </Button>
                      )}
                    </div>
                    {dirty && (
                      <p className="o2-hint">
                        Salve as regras abaixo antes de iniciar a operação.
                      </p>
                    )}
                  </section>
                ) : (
                  <section className="o2-operation">
                    <p className="o2-operation-note">
                      {model.startedAt
                        ? `Operação iniciada em ${formatInstant(model.startedAt)}. `
                        : ""}
                      Novas ações seguem as regras escolhidas para a organização.
                    </p>
                    {model.canManage && (
                      <>
                        <div className="o2-actions">
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void mutate("/pause", {}, "POST", model.revision)
                            }
                          >
                            {busy ? "Voltando…" : "Voltar à preparação"}
                          </Button>
                        </div>
                        <p className="o2-hint">
                          Na preparação, o owner volta a editar círculos e
                          papéis diretamente, sem propostas de governança.
                        </p>
                      </>
                    )}
                  </section>
                )}
                </div>{draft && (
                  <section className="o2-rules" hidden={activeSettingsSection==='circle-options'}>
                    <div hidden={activeSettingsSection==='essential'}><h3>Regras do modelo</h3>
                    <p>
                      Alterar estas regras modifica o modelo escolhido. Os
                      registros anteriores preservam seu contexto.
                    </p>
                    {model.canManage && <Button onClick={()=>c.navigate('/administration/settings')}>Configurar vocabulário da organização</Button>}
                    </div>{!model.canManage && (
                      <p>
                        Somente o owner pode alterar o modelo. Guias configuram
                        a autoenergização nos seus próprios círculos.
                      </p>
                    )}
                    <form
                      onSubmit={(event: FormEvent) => {
                        event.preventDefault();
                        void mutate(
                          "",
                          { overrides: {...draft,...(draft.essentialDefinitions ? {essentialDefinitions:Object.fromEntries(roleFunctions.map(code=>[code,{...draft.essentialDefinitions[code],responsibilities:draft.essentialDefinitions[code].responsibilities.map(value=>value.trim()).filter(Boolean),artifacts:draft.essentialDefinitions[code].artifacts.map(value=>value.trim()).filter(Boolean)}]))} : {})} satisfies ModelOverrides },
                          "PUT",
                          model.revision,
                        );
                      }}
                    >
                          {draft.essentialDefinitions && activeSettingsSection==='essential' && <div className="o2-essential-definitions">
                            <h3>Definições para novos círculos</h3>
                            <p>Propósito, responsabilidades e artefatos serão usados somente nos novos círculos. Artefatos são âmbitos de controle exclusivo, não anexos.</p>
                            <Field label="Papel essencial" name="o2-definition-function"><select disabled={busy||stale} value={definitionFunction} onChange={event=>setDefinitionFunction(event.target.value as RoleFunction)}>{roleFunctions.map(code=><option key={code} value={code}>{functionLabels[code]}</option>)}</select></Field>
                            {(["GUIDE","REPRESENTATIVE"].includes(definitionFunction)) && <p className="o2-hint">Sem adaptação do propósito de referência, esta função acompanha o propósito do novo círculo. Um texto próprio passa a valer para os novos círculos.</p>}
                            <p className="o2-hint">Responsabilidades e artefatos: um item por linha.</p>
                            {([['purpose','Propósito'],['responsibilities','Responsabilidades'],['artifacts','Artefatos']] as const).map(([key,label])=><Field key={definitionFunction+key} label={label} name={'o2-essential-'+key}><textarea disabled={busy||!model.canManage||stale} rows={3} maxLength={11000} value={key==='purpose'?draft.essentialDefinitions[definitionFunction].purpose:draft.essentialDefinitions[definitionFunction][key].join('\n')} onChange={event=>update('essentialDefinitions',{...draft.essentialDefinitions,[definitionFunction]:{...draft.essentialDefinitions[definitionFunction],[key]:key==='purpose'?event.target.value:event.target.value.split(/\r?\n/)}})}/></Field>)}
                            {model.canManage && model.essentialDefinitionDefaults && <Button disabled={busy||stale} onClick={()=>update('essentialDefinitions',{...draft.essentialDefinitions,[definitionFunction]:structuredClone(model.essentialDefinitionDefaults![definitionFunction])})}>Restaurar definição O2 desta função</Button>}
                          </div>}
                      <fieldset disabled={busy || !model.canManage || stale}>
                        <div className="o2-rule-fields" hidden={activeSettingsSection!=='governance'}>
                          <Field
                            label="Pertencimento aos círculos"
                            name="o2-membership"
                          >
                            <select
                              value={draft.membership}
                              onChange={(event) =>
                                update(
                                  "membership",
                                  event.target
                                    .value as ModelRules["membership"],
                                )
                              }
                            >
                              <option value="OCCUPANCY">
                                Derivado das energizações
                              </option>
                              <option value="LEGACY">
                                Associações e autoridades configuradas na
                                estrutura
                              </option>
                            </select>
                          </Field>
                          <Field
                            label="Atribuição de papéis comuns"
                            name="o2-assignment"
                          >
                            <select
                              value={draft.assignment}
                              onChange={(event) =>
                                update(
                                  "assignment",
                                  event.target
                                    .value as ModelRules["assignment"],
                                )
                              }
                            >
                              <option value="GUIDE">
                                Guia do círculo e autoenergização elegível
                              </option>
                              <option value="LEGACY">
                                Autoridades configuradas na estrutura
                              </option>
                            </select>
                          </Field>
                          <Field
                            label="Escolha dos guias de subcírculos"
                            name="o2-guide-selection"
                          >
                            <select
                              value={draft.guideSelection}
                              onChange={(event) =>
                                update(
                                  "guideSelection",
                                  event.target
                                    .value as ModelRules["guideSelection"],
                                )
                              }
                            >
                              <option value="PARENT_GUIDE">
                                Guia do círculo imediatamente externo
                              </option>
                              <option value="LEGACY">
                                Autoridades configuradas na estrutura
                              </option>
                            </select>
                          </Field>
                          <Field
                            label="Alterações da estrutura"
                            name="o2-structure-changes"
                          >
                            <select
                              value={draft.structureChanges}
                              onChange={(event) =>
                                update(
                                  "structureChanges",
                                  event.target
                                    .value as ModelRules["structureChanges"],
                                )
                              }
                            >
                              <option value="GOVERNANCE">
                                Por propostas de governança
                              </option>
                              <option value="LEGACY">
                                Autoridades configuradas na estrutura
                              </option>
                            </select>
                          </Field>
                        </div>
                        <details className="o2-essential-options" hidden={activeSettingsSection!=='essential'}><summary>Opções dos papéis essenciais</summary><fieldset className="o2-function-choices">
                          <legend>Funções essenciais O2 nos novos círculos</legend>
                          <p>
                            Escolha as funções previstas ao criar novos círculos. Os papéis já existentes permanecem na estrutura e não recebem estas alterações.
                          </p>
                          {roleFunctions.map((code) => (
                            <label key={code}>
                              <input
                                type="checkbox"
                                checked={draft.essentialFunctions.includes(
                                  code,
                                )}
                                onChange={() =>
                                  toggleFunction("essentialFunctions", code)
                                }
                              />
                              {functionLabels[code]}
                            </label>
                          ))}

                        </fieldset>
                        <fieldset className="o2-function-choices">
                          <legend>Funções preenchidas por eleição</legend>
                          <p>Incluir guia é uma adaptação do modelo O2.</p>
                          {roleFunctions.map((code) => (
                            <label key={code}>
                              <input
                                type="checkbox"
                                disabled={
                                  !draft.essentialFunctions.includes(code)
                                }
                                checked={draft.electedFunctions.includes(code)}
                                onChange={() =>
                                  toggleFunction("electedFunctions", code)
                                }
                              />
                              {functionLabels[code]}
                            </label>
                          ))}
                        </fieldset>
                        <label className="o2-check">
                          <input
                            type="checkbox"
                            checked={draft.protectEssentials}
                            onChange={(event) =>
                              update("protectEssentials", event.target.checked)
                            }
                          />
                          Proteger as definições essenciais do modelo
                        </label>
                        <label className="o2-check">
                          <input
                            type="checkbox"
                            checked={draft.enforceEligibility}
                            onChange={(event) =>
                              update("enforceEligibility", event.target.checked)
                            }
                          />
                          Aplicar elegibilidade e incompatibilidades dos
                          essenciais eleitos
                        </label>
                        </details>
                      </fieldset>
                      {model.canManage && (
                        <div className="o2-actions">
                          <button
                            className="primary"
                            disabled={busy || !dirty || stale}
                          >
                            {busy ? "Salvando…" : activeSettingsSection==='essential'?"Salvar Papéis Essenciais":"Salvar regras do modelo"}
                          </button>
                          {activeSettingsSection!=='essential'&&<Button
                            disabled={busy || !customized || stale}
                            onClick={() =>
                              void mutate(
                                "",
                                { overrides: {} },
                                "PUT",
                                model.revision,
                              )
                            }
                          >
                            Restaurar regras O2
                          </Button>}
                          {stale && (
                            <Button disabled={busy} onClick={reload}>
                              Recarregar configuração
                            </Button>
                          )}
                        </div>
                      )}
                    </form>
                  </section>
                )}
                {activeSettingsSection==='essential' && model.canManage && <EssentialRoleBindings context={c} model={model} onSaved={reload}/>}
                <section id="settings-circle-options" className="o2-circle-settings" hidden={activeSettingsSection!=='circle-options'}>
                  <h3>Opções do círculo</h3><p>Escolha um círculo para consultar seus integrantes e configurar a autoenergização conforme suas permissões.</p>
                  <label className="field">Círculo<select value={chosenCircle} disabled={circleDirty} onChange={event=>setChosenCircle(event.target.value)}><option value="">Selecione um círculo</option>{(model.circles??[]).map(circle=>{const node=c.structure.nodes.find(n=>n.entityId===circle.circleId);return node?<option key={circle.circleId} value={circle.circleId}>{node.name}</option>:null})}</select></label>
                  {chosenCircle && (()=>{const circle=model.circles?.find(item=>item.circleId===chosenCircle);return circle?<CircleOptions key={circle.circleId} context={c} configuration={circle} membership={model.rules?.membership} onSaved={reload} onDirtyChange={setCircleDirty}/>:<p>Configuração indisponível para este círculo.</p>})()}
                  {circleDirty && <p className="o2-hint">Salve ou descarte a opção antes de trocar de círculo.</p>}
                  {!model.circles?.length && <p className="o2-hint">Nenhuma configuração de círculo disponível neste acesso.</p>}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </section></SettingsFrame>
  );
}

/** Which role of each circle carries an essential function. Organization configuration, not role detail. */
function EssentialRoleBindings({ context: c, model, onSaved }: { context: FeatureContext; model: ModelView; onSaved: () => void }) {
  const circles = c.structure.nodes.filter((node) => node.kind === "CIRCLE");
  const [circleNodeId, setCircleNodeId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RoleFunction | "">>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const roles = c.structure.nodes.filter((node) => node.kind === "ROLE" && node.parentNodeId === circleNodeId);
  const bound = (roleId: string) => model.bindings?.find((value) => value.roleId === roleId);
  useEffect(() => { setDrafts({}); setError(""); }, [circleNodeId, model]);
  async function save(roleId: string) {
    setBusy(roleId);
    setError("");
    try {
      await c.api(basePath(c) + "/roles/" + roleId + "/function", {
        method: "PUT", body: { functionCode: drafts[roleId] || null }, version: bound(roleId)?.version ?? 0,
      });
      c.notify("Função essencial atualizada.");
      onSaved();
      c.refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="o2-essential-bindings" aria-labelledby="o2-essential-bindings-title">
      <h3 id="o2-essential-bindings-title">Papéis essenciais por círculo</h3>
      <p>Novos círculos já recebem seus papéis essenciais. Use isto para indicar qual papel existente cumpre cada função num círculo. Cada função vale para um papel por círculo.</p>
      <label className="field">Círculo<select value={circleNodeId} onChange={(event) => setCircleNodeId(event.target.value)}>
        <option value="">Selecione um círculo</option>
        {circles.map((node) => <option key={node.nodeId} value={node.nodeId}>{node.name}</option>)}
      </select></label>
      {error && <Notice>{error}</Notice>}
      {circleNodeId && (roles.length ? (
        <ul className="o2-essential-binding-list">
          {roles.map((node) => {
            const current = bound(node.entityId)?.functionCode ?? "";
            const draft = drafts[node.entityId] ?? current;
            return (
              <li key={node.nodeId}>
                <span>{node.name}</span>
                <select aria-label={"Função essencial de " + node.name} disabled={!!busy} value={draft}
                  onChange={(event) => setDrafts((value) => ({ ...value, [node.entityId]: event.target.value as RoleFunction | "" }))}>
                  <option value="">Nenhuma</option>
                  {roleFunctions.map((code) => <option key={code} value={code}>{functionLabels[code]}</option>)}
                </select>
                <Button disabled={!!busy || draft === current} onClick={() => void save(node.entityId)}>
                  {busy === node.entityId ? "Salvando…" : "Salvar"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : <p className="o2-hint">Este círculo ainda não tem papéis.</p>)}
    </section>
  );
}

function CircleOptions({
  context: c,
  configuration,
  membership,
  showMembers = true,
  onSaved,
  onDirtyChange,
}: {
  context: FeatureContext;
  configuration: CircleConfiguration;
  membership?: ModelRules["membership"];
  showMembers?: boolean;
  onSaved: () => void;
  onDirtyChange?: (dirty:boolean) => void;
}) {
  const [enabled, setEnabled] = useState(configuration.selfAssignment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => setEnabled(configuration.selfAssignment),
    [configuration.selfAssignment, configuration.version],
  );
  useEffect(() => c.registerNavigationGuard?.(() => busy || enabled !== configuration.selfAssignment ? "Há alterações da opção do círculo ainda não salvas." : null), [c.registerNavigationGuard, busy, enabled, configuration.selfAssignment]);
  useEffect(() => { onDirtyChange?.(busy || enabled !== configuration.selfAssignment); return () => onDirtyChange?.(false); }, [onDirtyChange, busy, enabled, configuration.selfAssignment]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await c.api(basePath(c) + "/circles/" + configuration.circleId, {
        method: "PUT",
        version: configuration.version,
        body: { selfAssignment: enabled },
      });
      c.notify("Autoenergização do círculo atualizada.");
      onSaved();
      c.refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  const memberIds = configuration.memberIds ?? [];
  const memberNames = new Map(
    c.members.map((member) => [member.id, member.displayName]),
  );
  return (
    <>
      {showMembers && <section id="entity-members" className="o2-entity-section mare-circle-members">
        <h3>Integrantes</h3>
        {memberIds.length ? (
          <ul className="o2-circle-members">
            {memberIds.map((memberId) => (
              <li key={memberId}>
                <Button className="mare-entity-person" onClick={() => c.navigate('/members/' + encodeURIComponent(memberId))}>
                  <span className="avatar" aria-hidden="true">{initials(memberNames.get(memberId) ?? "Pessoa da organização")}</span>
                  <span><strong data-entity-member={memberId}>{memberNames.get(memberId) ?? "Pessoa da organização"}</strong><small>{memberId === c.bootstrap.membership.id ? "Você" : "Integrante do círculo"}</small></span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nenhuma pessoa integra este círculo no momento.</p>
        )}
      </section>}
      <details className="mare-entity-disclosure mare-circle-options">
        <summary>Opções do círculo</summary>
        <p className="o2-hint">{membership === "OCCUPANCY" ? "O pertencimento acompanha as energizações vigentes, incluindo guia e representante dos subcírculos." : "O pertencimento segue as associações e regras escolhidas pela organização."}</p>
        <section className="o2-entity-section">
        <h3>Autoenergização</h3>
        <p>
          Quando habilitada, quem já integra este círculo pode energizar papéis
          comuns. Eleições e escolha de guias continuam seguindo suas próprias
          regras.
        </p>
        {error && <Notice>{error}</Notice>}
        <form onSubmit={save}>
          <label className="o2-check">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!configuration.canConfigure || busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Permitir autoenergização neste círculo
          </label>
          {configuration.canConfigure ? (
            <div className="o2-actions"><button className="primary" disabled={busy || enabled === configuration.selfAssignment}>
              {busy ? "Salvando…" : "Salvar opção do círculo"}
            </button><Button disabled={busy || enabled === configuration.selfAssignment} onClick={() => setEnabled(configuration.selfAssignment)}>Descartar</Button></div>
          ) : (
            <p className="o2-hint">
              O guia deste círculo ou o owner pode mudar esta opção.
            </p>
          )}
        </form>
        </section>
      </details>
    </>
  );
}

function RoleOccupancies({
  context: c,
  model,
  onSaved,
}: {
  context: FeatureContext;
  model: ModelView;
  onSaved: () => void;
}) {
  const roleId = c.selectedEntity!.entityId;
  const [role, setRole] = useState<RoleView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [memberId, setMemberId] = useState(c.bootstrap.membership.id);
  const { formatInstant } = useLocalization();
  const path = basePath(c) + "/roles/" + roleId;
  useEffect(() => {
    setRole(null);
    setError("");
    const ctrl = new AbortController();
    c.api<RoleView>(path, { signal: ctrl.signal })
      .then((result) => {
        if (!ctrl.signal.aborted) {
          setRole(result.data);
          setMemberId(c.bootstrap.membership.id);
        }
      })
      .catch((error) => {
        if (!ctrl.signal.aborted) setError(message(error));
      });
    return () => ctrl.abort();
  }, [
    c.api,
    path,
    c.bootstrap.membership.id,
    c.bootstrap.authorizationRevision,
    revision,
  ]);
  async function change(
    target: string,
    body: unknown,
    version?: number,
    method = "POST",
  ) {
    setBusy(true);
    setError("");
    try {
      await c.api(basePath(c) + target, { method, body, version });
      c.notify("Energizações e funções atualizadas.");
      setRevision((value) => value + 1);
      onSaved();
      c.refresh();
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    const body: Record<string, unknown> = {
      memberId: role?.canAssignOthers ? memberId : c.bootstrap.membership.id,
    };
    for (const key of ["scope", "exitAgreement"] as const) {
      const value = String(data.get(key) ?? "").trim();
      if (value) body[key] = value;
    }
    for (const key of ["endsAt", "exitNotBefore"] as const) {
      const value = String(data.get(key) ?? "");
      if (value) body[key] = new Date(value).toISOString();
    }
    if (await change("/roles/" + roleId + "/occupancies", body)) form.reset();
  }
  const names = new Map(
    [...c.members, ...(role?.members ?? [])].map((member) => [
      member.id,
      member.displayName,
    ]),
  );
  const people =
    role?.members ??
    c.members.filter(
      (member) => member.status !== "INACTIVE" && member.memberType !== "GUEST",
    );
  return (
    <section id="entity-members" className="o2-entity-section mare-role-energizers">
      <h3>Quem energiza</h3>
      {error && <Notice>{error}</Notice>}
      {!role ? (
        <>
          <p role="status">
            {error
              ? "Não foi possível carregar as energizações."
              : "Carregando energizações…"}
          </p>
          <Button onClick={() => setRevision((value) => value + 1)}>
            Recarregar energizações
          </Button>
        </>
      ) : (
        <>
          {role.occupancies.length ? (
            <ul className="o2-occupancy-list">
              {role.occupancies.map((occupancy) => {
                const end = occupancy.endedAt ?? occupancy.endsAt;
                const ended = !!end && new Date(end).getTime() <= Date.now();
                const origin =
                  occupancy.origin === "OWNER_PREPARATION"
                    ? "Configuração inicial pelo owner"
                    : occupancy.origin === "ELECTION"
                      ? "Eleição"
                      : occupancy.origin === "OPERATING_ASSIGNMENT"
                        ? "Energização em operação"
                        : "";
                return (
                  <li key={occupancy.source + occupancy.id}>
                    <div>
                      <Button className="mare-entity-person" onClick={() => c.navigate('/members/' + encodeURIComponent(occupancy.memberId))}>
                        <span className="avatar" aria-hidden="true">{initials(names.get(occupancy.memberId) ?? "Pessoa da organização")}</span>
                        <strong data-entity-member={occupancy.memberId}>{names.get(occupancy.memberId) ?? "Pessoa da organização"}{occupancy.memberId === c.bootstrap.membership.id ? " (você)" : ""}</strong>
                      </Button>
                      <span>
                        {ended
                          ? "Encerrada · "
                          : new Date(occupancy.startsAt).getTime() > Date.now()
                            ? "Prevista · "
                            : "Desde "}
                        {formatInstant(occupancy.startsAt)}
                        {end ? ` · até ${formatInstant(end)}` : ""}
                      </span>
                      {origin && <span>{origin}</span>}
                      {occupancy.exitAgreement && (
                        <p>Acordo de saída: {occupancy.exitAgreement}</p>
                      )}
                      {occupancy.exitNotBefore && (
                        <p>
                          Saída prevista a partir de{" "}
                          {formatInstant(occupancy.exitNotBefore)}.
                        </p>
                      )}
                    </div>
                    {occupancy.canEnd && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void change(
                            "/occupancies/" +
                              occupancy.source +
                              "/" +
                              occupancy.id +
                              "/end",
                            {},
                            occupancy.version,
                          )
                        }
                      >
                        {occupancy.memberId === c.bootstrap.membership.id
                          ? "Deixar este papel"
                          : "Encerrar energização"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>Nenhuma pessoa energizando este papel.</p>
          )}
          {role.canAssign && (
            <details className="mare-entity-disclosure mare-role-assignment"><summary>{role.canAssignOthers ? "Energizar uma pessoa" : "Energizar este papel"}</summary>
            <form className="o2-assignment" onSubmit={assign}>
              {role.canAssignOthers ? (
                <Field label="Pessoa" name="o2-occupant">
                  <select
                    required
                    disabled={busy}
                    value={memberId}
                    onChange={(event) => setMemberId(event.target.value)}
                  >
                    <option value="">Selecione uma pessoa</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p>A energização será vinculada a você.</p>
              )}
              <Field
                label="Foco da energização (opcional)"
                name="scope"
                maxLength={1000}
              />
              <div className="o2-dates">
                <Field
                  label="Término previsto (opcional)"
                  name="endsAt"
                  type="datetime-local"
                />
                <Field
                  label="Acordo: saída a partir de (opcional)"
                  name="exitNotBefore"
                  type="datetime-local"
                />
              </div>
              <Field
                label="Acordo de saída (opcional)"
                name="exitAgreement"
                maxLength={2000}
              />
              <button
                className="primary"
                disabled={busy || (role.canAssignOthers && !memberId)}
              >
                {busy
                  ? "Salvando…"
                  : role.canAssignOthers
                    ? "Confirmar energização"
                    : "Energizar este papel"}
              </button>
            </form>
            </details>
          )}
          {role.functionCode && (
            <p className="o2-function-label mare-role-function">
              Papel essencial · {functionLabels[role.functionCode]}
              {model.rules?.electedFunctions.includes(role.functionCode)
                ? " · energizado por eleição"
                : ""}
              {model.canManage && (
                <>
                  {" · "}
                  <a
                    href="/settings/governance-model#essential"
                    onClick={(event) => {
                      event.preventDefault();
                      c.navigate("/settings/governance-model#essential");
                    }}
                  >
                    Papéis Essenciais
                  </a>
                </>
              )}
            </p>
          )}
          {!role.canAssign && (
            <p className="o2-hint">
              A atribuição deste papel segue as regras e autoridades da
              organização.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function EntitySections({ context: c }: { context: FeatureContext }) {
  const { model, error, reload } = useModel(c);
  if (!c.selectedEntity || c.bootstrap.membership.memberType === "GUEST")
    return null;
  if (error)
    return (
      <section className="o2-entity-section">
        <h2>Modelo de governança</h2>
        <Notice>{error}</Notice>
        <Button onClick={reload}>Recarregar configuração</Button>
      </section>
    );
  if (!model?.installed) return null;
  if (c.selectedEntity.kind === "ROLE")
    return (
      <RoleOccupancies
        key={c.organizationId + c.selectedEntity.entityId}
        context={c}
        model={model}
        onSaved={reload}
      />
    );
  const circle = model.circles?.find(
    (value) => value.circleId === c.selectedEntity!.entityId,
  );
  return circle ? (
    <CircleOptions
      key={circle.circleId}
      context={c}
      configuration={circle}
      membership={model.rules?.membership}
      showMembers={model.rules?.membership !== "LEGACY"}
      onSaved={reload}
    />
  ) : null;
}

export const feature: FeatureDefinition = {
  id: "governance-model",
  module: "settings",
  label: "Modelo de governança",
  matches: (path) => path.split(/[?#]/, 1)[0] === settingsPath,
  Component: ModelSettings,
  EntitySections,
  settingsPath,
  navigation: [
    {
      path: settingsPath,
      label: "Modelo de governança",
      location: "identity",
      visible: (c) => c.bootstrap.membership.memberType !== "GUEST",
    },
  ],
};

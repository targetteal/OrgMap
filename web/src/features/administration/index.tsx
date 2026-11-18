import {previewOrganizationTheme} from "../../WorkspaceBrand";
import {administrationMetadata} from './metadata';
import {OrganizationColorTheme} from "./OrganizationColorTheme";
import {SettingsFrame} from "./SettingsFrame";
import { CredentialPolicySettings } from "./security-settings";
import { AdmissionPolicySettings } from "./admission-settings";
import { UploadPolicySettings } from "./upload-settings";
import { BrandingSettings } from "./branding-settings";
import { CloseOrganization } from "../../organization-deletion/CloseOrganization";
import { createBrandingTransport } from "./branding-transport";
import { MemberIndicatorConsentSettings } from "./member-indicator-consents";
import { InvitationManagement } from "./invitation-management";
import { useLocalization, createMessageTranslator } from "../../localization";
import { administrationMessages, settingsMessages, type SettingsMessageKey } from "./messages";
import { localeOptions, timeZoneGroups } from "./regional-options";
import { RichTextEditor, RichTextView } from "../../editor";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import { Button, Field, Notice } from "../../ui";
import { errorMessage, RequestError } from "../../api";
import {
  Building2,
  Users,
  Eye,
  Heart,
  Sparkles,
  FileText,
  Plus,
  ArrowLeft,
  ArrowRight,
  Search,
  ScrollText,
  TextCursorInput,
  ClipboardList,
  UsersRound,
  IdCard,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import "./administration.css";
import {
  resolveAdministrationRoute,
} from "./routes";
const policyLabels: Record<string, string> = {
  "governance.method": "Método de governança",
  "structure.collectiveManagement": "Gestão coletiva dos círculos",
  "organization.allowGuests": "Participação de convidados",
  "member.profileVisibility": "Visibilidade dos perfis",
  "security.minimumPasswordLength": "Comprimento mínimo de senha",
};
const methodLabels: Record<string, string> = {
  MANUAL_FACILITATED: "Facilitação manual",
  CONSENT_ROUND: "Rodada de consentimento",
  CONSENT_WINDOW: "Janela de consentimento",
};
const historyLabels: Record<string, string> = {
  key: "Política ou campo",
  value: "Valor",
  allowOverride: "Permitir ajustes locais",
  parentId: "Origem",
  name: "Nome",
  title: "Título",
  slug: "Endereço",
  sections: "Seções",
  heading: "Título da seção",
  text: "Texto",
  link: "Link",
  memberId: "Pessoa",
  managerId: "Pessoa gestora",
  memberIds: "Pessoas",
  fields: "Campos",
  values: "Valores do perfil",
  visibility: "Visibilidade",
  label: "Rótulo",
  type: "Tipo",
  required: "Obrigatório",
  locked: "Bloqueado",
  options: "Opções",
  description: "Descrição",
};
function readableValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "Não definido";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  const text = String(v);
  return (
    policyLabels[text] ??
    methodLabels[text] ??
    (
      {
        organization: "Organização",
        private: "Privado",
        text: "Texto",
        number: "Número",
        boolean: "Sim ou não",
        date: "Data",
        select: "Escolha única",
        multi: "Múltipla escolha",
      } as Record<string, string>
    )[text] ??
    text
  );
}
function HistoryValue({
  data,
  reference,
}: {
  data: unknown;
  reference: (id: string) => string;
}) {
  if (
    data &&
    typeof data === "object" &&
    "format" in data &&
    data.format === "orgmap-richtext"
  )
    return <RichTextView value={data as any} />;
  if (Array.isArray(data))
    return (
      <ul>
        {data.map((v, i) => (
          <li key={i}>
            <HistoryValue data={v} reference={reference} />
          </li>
        ))}
      </ul>
    );
  if (data && typeof data === "object")
    return (
      <dl>
        {Object.entries(data).map(([key, val]) => (
          <div key={key}>
            <dt>{historyLabels[key] ?? reference(key)}</dt>
            <dd>
              <HistoryValue data={val} reference={reference} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <span>
      {typeof data === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(data)
        ? reference(data)
        : readableValue(data)}
    </span>
  );
}
const domainMessages: Record<string, string> = {
  INVALID_RICH_DOCUMENT:
    "O conteúdo contém formatação inválida ou excede o limite permitido.",
  POLICY_UNSUPPORTED:
    "Esta política não está operacional. O registro foi preservado para consulta.",
  CIRCLE_POLICY_RECONCILIATION_REQUIRED:
    "Revise os ajustes locais dos círculos antes de desativar essa permissão.",
  PRIVATE_FIELD_RESTRICTED:
    "Este campo privado só pode ser alterado pela própria pessoa.",
  SCHEMA_PLAN_REQUIRED:
    "Verifique o plano de alteração do campo antes de salvar.",
  SCHEMA_PLAN_STALE:
    "Os perfis ou o campo mudaram após a análise. Gere um novo plano e revise antes de aplicar.",
  FIELD_TYPE_MISMATCH:
    "Há valores incompatíveis com este tipo de campo. Revise o plano e preserve os valores antes de alterar o tipo.",
  FIELD_LOCKED: "Este campo está bloqueado para edição.",
  REQUIRED_FIELD: "Preencha os campos obrigatórios.",
  HIERARCHY_CYCLE:
    "Essa relação criaria um ciclo na hierarquia. Escolha outro grupo ou pessoa gestora.",
  OVERRIDE_DENIED: "A política de origem não permite essa alteração derivada.",
  POLICY_EXISTS: "Já existe uma política para essa chave e origem.",
  PROFILE_EXISTS:
    "Esta pessoa já possui um perfil. Abra o perfil existente para editar.",
  PROFILE_DISPLAY_LIMIT:
    "Escolha até dois campos para o diretório e três para o cartão de perfil.",
  INVALID_DISPLAY_FIELD:
    "Somente campos organizacionais existentes podem ser exibidos.",
  PRIVATE_FIELD_RECLASSIFICATION_DENIED:
    "Um campo privado com valores não pode se tornar público. Crie outro campo e permita que cada pessoa escolha o que compartilhar.",
  INVALID_POLICY_VALUE: "O valor não é válido para a política selecionada.",
  PREVIEW_REVISION_CONFLICT:
    "A versão revisada mudou. Gere uma nova prévia antes de publicar.",
  OVERSIGHT_ACKNOWLEDGEMENT_REQUIRED:
    "Revise o aviso de supervisão antes de salvar a alteração.",
};
function adminError(error: unknown) {
  return error instanceof RequestError && domainMessages[error.code]
    ? domainMessages[error.code]
    : errorMessage(error);
}
type Row = {
  id: string;
  version: number;
  value: any;
  capabilities?: { update: boolean; history: boolean };
  supported?: boolean;
  publication?: {
    active: boolean;
    token: string;
    revision: number;
    slug: string;
  };
};
const labels: Record<string, string> = {
  settings: "Organização",
  policies: "Políticas",
  fields: "Campos de perfil",
  templates: "Modelos de perfil",
  groups: "Grupos",
  profiles: "Perfis e hierarquia",
  pages: "Páginas públicas",
  grants: "Permissões administrativas",
};
const blank: Record<string, any> = {
  policies: {
    key: "governance.method",
    value: "MANUAL_FACILITATED",
    parentId: null,
    allowOverride: false,
  },
  fields: {
    key: "",
    label: "",
    type: "text",
    required: false,
    locked: false,
    options: [],
    visibility: "organization",
  },
  templates: { name: "", fields: [] },
  groups: { name: "", parentId: null, memberIds: [] },
  profiles: {
    memberId: "",
    managerId: null,
    visibility: "organization",
    values: {},
  },
  pages: { title: "", slug: "", sections: [] },
};
const presets = [
  {
    name: "Vitrine da organização",
    description:
      "Apresente o propósito e a forma de trabalhar da sua organização.",
    Icon: Building2,
  },
  {
    name: "Página de recrutamento",
    description: "Convide pessoas a conhecer oportunidades e seu propósito.",
    Icon: Users,
  },
  {
    name: "Painel de transparência",
    description:
      "Compartilhe informações que sua organização escolheu tornar públicas.",
    Icon: Eye,
  },
  {
    name: "Landing minimalista",
    description: "Seu propósito e uma chamada de ação clara.",
    Icon: Sparkles,
  },
  {
    name: "Cultura e governança",
    description: "Destaque seus valores e modelo de governança.",
    Icon: Heart,
  },
  { name: "Começar do zero", description: "", Icon: FileText },
];
const emptyCopy: Record<string, { Icon: LucideIcon; title: SettingsMessageKey; body: SettingsMessageKey; action: SettingsMessageKey }> = {
  policies: { Icon: ScrollText, title: "emptyPoliciesTitle", body: "emptyPoliciesBody", action: "addPolicy" },
  fields: { Icon: TextCursorInput, title: "emptyFieldsTitle", body: "emptyFieldsBody", action: "addField" },
  templates: { Icon: ClipboardList, title: "emptyTemplatesTitle", body: "emptyTemplatesBody", action: "addTemplate" },
  groups: { Icon: UsersRound, title: "emptyGroupsTitle", body: "emptyGroupsBody", action: "addGroup" },
  profiles: { Icon: IdCard, title: "emptyProfilesTitle", body: "emptyProfilesBody", action: "addProfile" },
  pages: { Icon: FileText, title: "emptyPagesTitle", body: "emptyPagesBody", action: "addPage" },
  grants: { Icon: KeyRound, title: "emptyGrantsTitle", body: "emptyGrantsBody", action: "addGrant" },
};
const permissionKeys: Record<string, SettingsMessageKey> = {
  settings: "permSettings",
  policy: "permPolicy",
  field: "permField",
  template: "permTemplate",
  group: "permGroup",
  profile: "permProfile",
  page: "permPage",
};
function Navigation({ context: c }: { context: FeatureContext }) {
  const { locale } = useLocalization();
  const translate = createMessageTranslator(locale, administrationMessages);
  return (
    <nav className="admin-navigation" aria-label={translate("administration")}>
      {Object.entries(labels).map(([key, label]) => (
        <button
          key={key}
          className={resolveAdministrationRoute(c.path) === key ? "active" : ""}
          onClick={() => c.navigate("/administration/" + key)}
        >
          {translate(key as keyof (typeof administrationMessages)["pt-BR"])}
        </button>
      ))}
    </nav>
  );
}
function Administration({ context: c }: { context: FeatureContext }) {
  const { locale, formatInstant, formatNumber } = useLocalization();
  const translate = createMessageTranslator(locale, administrationMessages);
  const ts = createMessageTranslator(locale, settingsMessages);
  const [contentConflict, setContentConflict] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState("");
  const tab = resolveAdministrationRoute(c.path) ?? "settings";
  const base = "/organizations/" + c.organizationId + "/administration";
  const appearanceMode=tab === "settings" && (c.hash || c.path.split("#")[1] || "").replace(/^#/, "") === "appearance";
  const brandingTransport = useMemo(() => createBrandingTransport(c.organizationId, c.api), [c.organizationId, c.api]);
  const savedSettings = useRef<any>(null);
  const [rows, setRows] = useState<Row[]>([]),
    [settings, setSettings] = useState<any>(null),
    [cap, setCap] = useState<any>({}),
    [draft, setDraft] = useState<any>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stamp, setStamp] = useState(0),
    [fields, setFields] = useState<Row[]>([]),
    [preview, setPreview] = useState<any>(null),
    [publicUrl, setPublicUrl] = useState(""),
    [plan, setPlan] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setRows([]);
    setDraft(null);
    setSelected(null);
    setSettings(null);
    savedSettings.current = null;
    setContentConflict(false);
    setError("");
    setLoading(true);
    setPreview(null);
    setPublicUrl("");
    setPlan(null);
    setHistory([]);
    Promise.all([
      c.api<any>(base + "/" + tab, { signal: controller.signal }),
      c.api<any>(base + "/fields", { signal: controller.signal }),
    ])
      .then(([res, fs]) => {
        if (controller.signal.aborted) return;
        setFields(fs.data.items);
        if (tab === "settings") {
          savedSettings.current = structuredClone(res.data.settings);
          setSettings(res.data);
          setCap(res.data.capabilities);
        } else {
          setRows(res.data.items);
          setCap(
            res.data.capabilities ?? {
              manage: c.bootstrap.membership.orgRole === "OWNER",
              create: c.bootstrap.membership.orgRole === "OWNER",
            },
          );
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(adminError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [c.organizationId, tab, stamp]);
  const settingsDirty = tab === "settings" && settings && savedSettings.current && JSON.stringify(settings.settings) !== JSON.stringify(savedSettings.current);
  const currentLocale = settings?.settings?.locale ?? "";
  const currentTimeZone = settings?.settings?.timezone ?? "";
  const localeChoices = useMemo(() => localeOptions(locale, currentLocale), [locale, currentLocale]);
  const timeZoneChoices = useMemo(() => timeZoneGroups(locale, currentTimeZone, ts("tzOther")), [locale, currentTimeZone]);
  const savedColorTheme=savedSettings.current?.branding?.colorTheme??"mare";
  const previewColorTheme=tab==="settings"&&cap.manageTheme===true&&settings?.settings.branding.colorTheme!==savedColorTheme?settings?.settings.branding.colorTheme??null:null;
  const cancelThemePreview=()=>setSettings((current:any)=>current?{...current,settings:{...current.settings,branding:{...current.settings.branding,colorTheme:savedSettings.current?.branding?.colorTheme??"mare"}}}:current);
  useEffect(()=>{
    previewOrganizationTheme(c.organizationId,c.session.account.id,previewColorTheme);
    return()=>previewOrganizationTheme(c.organizationId,c.session.account.id,null);
  },[c.organizationId,c.session.account.id,previewColorTheme]);
  useEffect(()=>{
    if(!previewColorTheme)return;
    const escape=(event:KeyboardEvent)=>{if(event.key!=="Escape"||event.defaultPrevented||document.querySelector('dialog[open]'))return;event.preventDefault();cancelThemePreview();};
    window.addEventListener('keydown',escape);
    return()=>window.removeEventListener('keydown',escape);
  },[previewColorTheme]);
  useEffect(() => {
    if (!settingsDirty && !busy) return;
    const unregister = c.registerNavigationGuard?.(() => busy ? "Aguarde a confirmação da alteração antes de sair." : "Há alterações das configurações ainda não salvas.");
    const beforeUnload = (event:BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { unregister?.(); window.removeEventListener("beforeunload", beforeUnload); };
  }, [settingsDirty, busy, c.registerNavigationGuard]);
  const edit = (row?: Row) => {
    setContentConflict(false);
    setSelected(row ?? null);
    setDraft(
      structuredClone(
        row?.value ??
          blank[tab] ?? {
            memberId: "",
            action: "settings.manage",
            resourceId: null,
          },
      ),
    );
    setPreview(null);
    setPublicUrl(
      row?.publication?.active
        ? "/public/pages/" + row.publication.token + "/" + row.publication.slug
        : "",
    );
    setPlan(null);
    setHistory([]);
    setError("");
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof RequestError && e.code === "VERSION_CONFLICT")
        setContentConflict(true);
      setError(adminError(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (tab === "settings") {
        const res = await c.api<any>(base + "/settings", {
          method: "PUT",
          body: { settings: settings.settings, oversightAcknowledged: true },
          version: settings.version,
        });
        savedSettings.current = structuredClone(res.data.settings);
        setSettings(res.data);
        window.dispatchEvent(new Event('orgmap:branding-changed'));
        c.notify("Configurações salvas.");
        c.refresh();
        return;
      }
      const response = await c.api<Row>(
        base + "/" + tab + (selected ? "/" + selected.id : ""),
        {
          method: selected ? "PUT" : "POST",
          body:
            tab === "grants"
              ? draft
              : {
                  value: draft,
                  ...(tab === "fields" && plan?.planId
                    ? { planId: plan.planId }
                    : {}),
                },
          version: selected?.version,
        },
      );
      c.notify("Alterações salvas.");
      if (tab === "pages") {
        setSelected({ ...response.data, capabilities: selected?.capabilities });
        setDraft(response.data.value);
        setRows((old) => [
          ...old.filter((r) => r.id !== response.data.id),
          response.data,
        ]);
        setPreview(null);
      } else setStamp((x) => x + 1);
    });
  };
  const value = (key: string, v: any) => {
    setPlan(null);
    setDraft((d: any) => ({ ...d, [key]: v }));
  };
  const input = (label: string, key: string, type = "text") => (
    <Field label={label} name={key}>
      <input
        type={type}
        required
        value={draft[key] ?? ""}
        onChange={(e) =>
          value(
            key,
            type === "number" ? Number(e.target.value) : e.target.value,
          )
        }
      />
    </Field>
  );
  const check = (label: string, key: string) => (
    <label className="admin-check">
      <input
        type="checkbox"
        checked={draft[key] === true}
        onChange={(e) => value(key, e.target.checked)}
      />
      {label}
    </label>
  );
  const memberSelect = (label: string, key: string, optional = false) => (
    <Field label={label} name={key}>
      <select
        disabled={Boolean(selected && key === "memberId")}
        required={!optional}
        value={draft[key] ?? ""}
        onChange={(e) => value(key, e.target.value || null)}
      >
        <option value="">
          {optional ? "Nenhuma pessoa" : "Selecione uma pessoa"}
        </option>
        {c.members
          .filter((m) => m.status === "ACTIVE")
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
      </select>
    </Field>
  );
  const operationalPolicy =
    draft?.key === "governance.method"
      ? cap.governancePolicy === true
      : draft?.key === "structure.collectiveManagement" &&
        cap.collectivePolicy === true;
  const mayEdit =
    (selected ? (selected.capabilities?.update ?? cap.manage) : cap.create) &&
    !(tab === "policies" && !operationalPolicy);
  useEffect(() => {
    if (!loading && settings && appearanceMode) document.getElementById("settings-appearance")?.scrollIntoView?.({block:"start"});
  }, [loading, Boolean(settings), appearanceMode]);
  const visibleRows = rows.filter((row) =>
    JSON.stringify(row.value ?? row)
      .toLocaleLowerCase(locale)
      .includes(search.toLocaleLowerCase(locale)),
  );
  return (
    <SettingsFrame context={c}><section className="admin-surface" aria-busy={loading || busy}>
      {!(tab === "pages" && draft) && (
        <header className="admin-heading">
          <h2>{tab === "settings" && appearanceMode ? "Aparência" : translate(tab)}</h2>
          {tab === "pages" && !draft && !loading && rows.length > 0 && (
        <div className="admin-search">
          {searchOpen && (
            <input
              aria-label="Pesquisar páginas"
              placeholder="Pesquisar páginas"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <Button
            title="Pesquisar páginas"
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Search size={16} />
          </Button>
        </div>
          )}
          {tab !== "settings" && !draft && !loading && cap.create && rows.length > 0 && (
            <Button className="primary" onClick={() => edit()}>
              <Plus size={16} />
              {tab === "pages" ? ts("newPage") : emptyCopy[tab] ? ts(emptyCopy[tab].action) : "Adicionar"}
            </Button>
          )}
        </header>
      )}
      {error && <Notice>{error}</Notice>}
      {loading ? (
        <div className="mare-loading admin-loading" role="status" aria-label={translate("loading")}>
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : tab === "settings" && settings ? (
        <>
          {!cap.manage && !appearanceMode && <p className="admin-readonly-note">Você está consultando as configurações. A edição está disponível para quem administra esta organização.</p>}
          <form className="admin-settings" onSubmit={save} onInvalidCapture={event=>{let parent=(event.target as HTMLElement).parentElement;while(parent && parent!==event.currentTarget){if(parent.tagName === "DETAILS")(parent as HTMLDetailsElement).open=true;parent=parent.parentElement;}}}>
            <fieldset className="admin-settings-group" hidden={appearanceMode} disabled={appearanceMode}>
            <section className="admin-form-section" aria-labelledby="admin-org-data-title">
            <header><h3 id="admin-org-data-title">Dados da organização</h3><p>{ts("orgDataHint")}</p></header>
            <div className="admin-form-grid">
            <div className="wide">
            <Field label="Nome da organização" name="name">
              <input
                required
                value={settings.settings.name}
                disabled={!cap.manage}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: { ...settings.settings, name: e.target.value },
                  })
                }
              />
            </Field>
            </div>
            <Field label="Idioma" name="locale">
              <select
                required
                value={settings.settings.locale}
                disabled={!cap.manage}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: { ...settings.settings, locale: e.target.value },
                  })
                }
              >
                {localeChoices.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fuso horário" name="timezone">
              <select
                required
                value={settings.settings.timezone}
                disabled={!cap.manage}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: { ...settings.settings, timezone: e.target.value },
                  })
                }
              >
                {timeZoneChoices.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            </div>
            </section>
            <section className="admin-form-section" aria-labelledby="admin-vocabulary-title">
            <header><h3 id="admin-vocabulary-title">Vocabulário da organização</h3><p>{ts("vocabularyHint")}</p></header>
            <div className="admin-form-grid three">
            {Object.entries(settings.settings.vocabulary).map(([key, val]) => (
              <Field
                key={key}
                label={
                  { circle: "Círculo", role: "Papel", member: "Membro" }[key] ??
                  key
                }
                name={key}
              >
                <input
                  required
                  disabled={!cap.manage}
                  value={val as string}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      settings: {
                        ...settings.settings,
                        vocabulary: {
                          ...settings.settings.vocabulary,
                          [key]: e.target.value,
                        },
                      },
                    })
                  }
                />
              </Field>
            ))}
            </div>
            </section>
            </fieldset>
            <fieldset id="settings-appearance" className="admin-settings-group" hidden={!appearanceMode} disabled={!appearanceMode}>
            <p className="muted">Cores compartilhadas pela organização, com a mesma tipografia e os mesmos componentes.</p>
            <OrganizationColorTheme preview={!!previewColorTheme} onCancelPreview={cancelThemePreview} value={settings.settings.branding.colorTheme ?? "mare"} disabled={cap.manageTheme !== true} onChange={colorTheme=>setSettings({...settings,settings:{...settings.settings,branding:{...settings.settings.branding,colorTheme}}})}/>
            <details className="admin-brand-identity mare-disclosure"><summary>Identidade e logotipo</summary>
            <Field label="Cor da identidade" name="color">
              <input
                type="color"
                disabled={!cap.manage}
                value={settings.settings.branding.color}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: {
                      ...settings.settings,
                      branding: {
                        ...settings.settings.branding,
                        color: e.target.value,
                      },
                    },
                  })
                }
              />
            </Field>
            <Field label="Endereço HTTPS do logotipo" name="logoUrl">
              <input
                type="url"
                disabled={!cap.manage}
                value={settings.settings.branding.logoUrl ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: {
                      ...settings.settings,
                      branding: {
                        ...settings.settings.branding,
                        logoUrl: e.target.value || null,
                      },
                    },
                  })
                }
              />
            </Field>
            <label className="admin-check">
              <input
                type="checkbox"
                disabled={!cap.manage}
                checked={
                  settings.settings.branding.showOrganizationName !== false
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: {
                      ...settings.settings,
                      branding: {
                        ...settings.settings.branding,
                        showOrganizationName: e.target.checked,
                      },
                    },
                  })
                }
              />
              Exibir o nome da organização ao lado do logotipo
            </label>
            </details>
            </fieldset>
            <fieldset className="admin-settings-group" hidden={appearanceMode} disabled={appearanceMode}>
            <details className="admin-settings-progressive mare-disclosure"><summary>Boas-vindas e página inicial</summary>
            <h3>Boas-vindas</h3>
            <label className="admin-check">
              <input
                type="checkbox"
                disabled={!cap.manage}
                checked={settings.settings.onboarding.enabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: {
                      ...settings.settings,
                      onboarding: {
                        ...settings.settings.onboarding,
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
              />
              Mostrar mensagem de boas-vindas
            </label>
            {["title", "body"].map((key, i) => (
              <Field
                key={key}
                label={i === 0 ? "Título de boas-vindas" : ""}
                name={"welcome-" + key}
              >
                {key === "body" ? (
                  <RichTextEditor
                    key={c.bootstrap.organization.id + "-onboarding"}
                    label="Mensagem de boas-vindas"
                    value={settings.settings.onboarding.body}
                    readOnly={!cap.manage}
                    pending={busy}
                    conflict={contentConflict}
                    onChange={(body) =>
                      setSettings({
                        ...settings,
                        settings: {
                          ...settings.settings,
                          onboarding: { ...settings.settings.onboarding, body },
                        },
                      })
                    }
                  />
                ) : (
                  <textarea
                    disabled={!cap.manage}
                    required={key === "title"}
                    value={settings.settings.onboarding[key]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        settings: {
                          ...settings.settings,
                          onboarding: {
                            ...settings.settings.onboarding,
                            [key]: e.target.value,
                          },
                        },
                      })
                    }
                  />
                )}
              </Field>
            ))}
            <Field label="Página padrão após o login" name="entry-destination">
              <select
                disabled={!cap.manage}
                value={settings.settings.onboarding.destination ?? "HOME"}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: {
                      ...settings.settings,
                      onboarding: {
                        ...settings.settings.onboarding,
                        destination: e.target.value,
                      },
                    },
                  })
                }
              >
                {Object.entries({
                  HOME: "Página inicial",
                  STRUCTURE: "Estrutura",
                  GOALS: "Objetivos",
                  WORK: "Projetos",
                  MEETINGS: "Reuniões",
                }).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Exibir mensagem para" name="entry-audience">
              <select
                disabled={!cap.manage}
                value={settings.settings.onboarding.audience ?? "MEMBER"}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    settings: {
                      ...settings.settings,
                      onboarding: {
                        ...settings.settings.onboarding,
                        audience: e.target.value,
                      },
                    },
                  })
                }
              >
                <option value="MEMBER">Somente membros</option>
                <option value="GUEST">Somente convidados</option>
                <option value="ALL">Membros e convidados</option>
              </select>
            </Field>
            {["videoUrl", "attachmentUrl"].map((key) => (
              <Field
                key={key}
                label={
                  key === "videoUrl"
                    ? "Vídeo de apresentação (MP4 por HTTPS)"
                    : "Anexo (link HTTPS)"
                }
                name={key}
              >
                <input
                  type="url"
                  disabled={!cap.manage}
                  value={settings.settings.onboarding[key] ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      settings: {
                        ...settings.settings,
                        onboarding: {
                          ...settings.settings.onboarding,
                          [key]: e.target.value || null,
                        },
                      },
                    })
                  }
                />
              </Field>
            ))}
            <p>
              Sem mensagem personalizada, a entrada usa as boas-vindas padrão.
              Convidados entram nos recursos compartilhados. Links externos são
              abertos somente por ação da pessoa.
            </p>
            </details>
            <details className="admin-settings-progressive mare-disclosure"><summary>Informações legais e contatos</summary>
            <h3>Informações legais</h3>
            {[
              "name",
              "address",
              "termsUrl",
              "privacyUrl",
              "contactName",
              "contactEmail",
              "contactPhone",
            ].map((key, i) => (
              <Field
                key={key}
                label={
                  [
                    "Nome legal",
                    "Endereço",
                    "Termos de uso (HTTPS)",
                    "Política de privacidade (HTTPS)",
                    "Responsável pela proteção de dados",
                    "E-mail de contato",
                    "Telefone de contato",
                  ][i]
                }
                name={"legal-" + key}
              >
                <input
                  disabled={!cap.manage}
                  type={
                    key.endsWith("Url")
                      ? "url"
                      : key === "contactEmail"
                        ? "email"
                        : key === "contactPhone"
                          ? "tel"
                          : "text"
                  }
                  value={settings.settings.legal[key] ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      settings: {
                        ...settings.settings,
                        legal: {
                          ...settings.settings.legal,
                          [key]:
                            e.target.value || (key.endsWith("Url") ? null : ""),
                        },
                      },
                    })
                  }
                />
              </Field>
            ))}
            </details>
            <details className="admin-settings-progressive mare-disclosure"><summary>Exibição de perfis</summary>
            <p className="muted">
              Escolha até dois campos para o diretório e três para o cartão de
              perfil. Campos privados não podem ser exibidos.
            </p>
            {["directoryFields", "hoverFields"].map((key, i) => (
              <Field
                key={key}
                label={
                  i === 0 ? "Campos do diretório" : "Campos do cartão de perfil"
                }
                name={key}
              >
                <select
                  multiple
                  disabled={!cap.manage}
                  value={settings.settings.display[key]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      settings: {
                        ...settings.settings,
                        display: {
                          ...settings.settings.display,
                          [key]: Array.from(
                            e.target.selectedOptions,
                            (o) => o.value,
                          ),
                        },
                      },
                    })
                  }
                >
                  {fields
                    .filter((f) => f.value.visibility === "organization")
                    .map((f) => (
                      <option key={f.id} value={f.value.key}>
                        {f.value.label}
                      </option>
                    ))}
                </select>
              </Field>
            ))}
            </details>
            <details className="admin-settings-progressive mare-disclosure"><summary>Módulos e notificações</summary>
            <h3>Módulos</h3>
            {Object.entries(settings.settings.modules).map(([key, val]) => (
              <label className="admin-check" key={key}>
                <input
                  type="checkbox"
                  disabled={!cap.manage}
                  checked={val as boolean}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      settings: {
                        ...settings.settings,
                        modules: {
                          ...settings.settings.modules,
                          [key]: e.target.checked,
                        },
                      },
                    })
                  }
                />
                {{
                  goals: "Objetivos",
                  work: "Projetos e tarefas",
                  meetings: "Reuniões",
                  governance: "Governança",
                }[key] ?? key}
              </label>
            ))}
            <h3>Notificações</h3>
            <label className="admin-check">
              <input type="checkbox" disabled={!cap.manage}
                checked={settings.settings.notifications?.emailEnabled !== false}
                onChange={(e) => setSettings({ ...settings, settings: { ...settings.settings,
                  notifications: { ...settings.settings.notifications, emailEnabled: e.target.checked } } })} />
              Enviar notificações por e-mail
            </label>
            <p className="muted">Esta opção não interrompe convites, recuperação de acesso ou confirmação de e-mail.</p>
            </details>
            <details className="admin-settings-progressive mare-disclosure"><summary>Supervisão de conteúdo privado</summary>
            <p className="muted">
              A supervisão permite leitura explícita de conteúdo privado. Ela
              não permite edição e não substitui restrições do recurso. A
              alteração fica registrada no histórico de auditoria.
            </p>
            {Object.entries(settings.settings.oversight).map(([key, val]) => (
              <label className="admin-check" key={key}>
                <input
                  type="checkbox"
                  disabled={!cap.manage}
                  checked={val as boolean}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      settings: {
                        ...settings.settings,
                        oversight: {
                          ...settings.settings.oversight,
                          [key]: e.target.checked,
                        },
                      },
                    })
                  }
                />
                {key === "readMeeting"
                  ? "Permitir supervisão de reuniões"
                  : "Permitir exportação operacional privada"}
              </label>
            ))}
            </details>
            </fieldset>
            {cap.manage && <div className={"admin-settings-actions" + (settingsDirty ? " dirty" : "")}><span role="status">{settingsDirty ? ts("unsaved") : ts("noChanges")}</span><Button disabled={busy || !settingsDirty} onClick={() => {setSettings({...settings,settings:structuredClone(savedSettings.current)});setContentConflict(false);setError("");}}>Descartar</Button><button className="primary" disabled={busy || contentConflict || !settingsDirty}>{busy ? translate("saving") : translate("save")}</button></div>}
          </form>
          <div hidden={!appearanceMode} className="admin-appearance-assets">{cap.manage && <BrandingSettings key={'branding-' + c.organizationId} organizationId={c.organizationId} transport={brandingTransport} locale={locale} />}</div>
          <div hidden={appearanceMode} className="admin-progressive-settings">
          <details className="admin-settings-progressive mare-disclosure"><summary>Acesso, segurança e arquivos</summary>
          <CredentialPolicySettings key={c.organizationId} context={c} />
          <AdmissionPolicySettings
            key={"admission-" + c.organizationId}
            context={c}
          />
          <UploadPolicySettings
            key={"upload-" + c.organizationId}
            context={c}
          />
          </details>
          <details className="admin-settings-progressive mare-disclosure"><summary>Indicadores e privacidade</summary>
          <MemberIndicatorConsentSettings
            key={"indicator-consents-" + c.organizationId}
            context={c}
          />
          </details>
          {cap.manage && <details className="admin-settings-progressive mare-disclosure" open={new URLSearchParams(c.path.split('?')[1]??'').get('section')==='invitations' || undefined}><summary>Convites</summary>
            <InvitationManagement
              key={"invitations-" + c.organizationId}
              context={c}
            />
          </details>}
          <details className="admin-settings-progressive mare-disclosure"><summary>Encerrar organização</summary>
          <CloseOrganization key={"closure-"+c.organizationId} context={c} />
          </details>
          </div>
        </>
      ) : draft ? (
        <form
          className={
            "admin-editor " + (tab === "pages" ? "admin-page-editor" : "")
          }
          onSubmit={save}
        >
          <Button
            className="admin-back"
            onClick={() => {
              setDraft(null);
              setSelected(null);
            }}
          >
            <ArrowLeft size={16} />
            Voltar
          </Button>
          {selected && !mayEdit && (
            <Notice>Somente leitura para sua conta.</Notice>
          )}
          {tab === "pages" ? (
            <>
              <div className="admin-page-title">
                <input
                  autoFocus
                  aria-label="Título da página"
                  required
                  placeholder="Digite um título"
                  value={draft.title}
                  onChange={(e) => value("title", e.target.value)}
                />
                <span>/</span>
                <input
                  aria-label="Endereço da página"
                  required
                  placeholder="url-da-página"
                  value={draft.slug}
                  onChange={(e) => value("slug", e.target.value)}
                />
                {!selected && (
                  <button
                    className="admin-create-page"
                    disabled={busy || !draft.title.trim() || !draft.slug.trim()}
                  >
                    Criar uma página
                  </button>
                )}
              </div>
              {!selected && draft.sections.length === 0 ? (
                <div className="admin-models">
                  <h2>Começar com um modelo</h2>
                  <p>
                    Escolha um layout para começar ou inicie com uma página em
                    branco.
                  </p>
                  <div className="admin-model-grid">
                    {presets.map(({ name, description, Icon }) => (
                      <Button
                        key={name}
                        onClick={() =>
                          value("sections", [
                            {
                              heading:
                                name === "Começar do zero"
                                  ? "Novo título"
                                  : "Nosso propósito",
                              text: "",
                              link: null,
                            },
                          ])
                        }
                      >
                        <Icon size={21} />
                        <span>
                          <strong>{name}</strong>
                          <small>{description}</small>
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {draft.sections.map((s: any, i: number) => (
                    <fieldset key={i} className="admin-section">
                      <legend>Seção {i + 1}</legend>
                      {["heading", "text", "link"].map((key, j) => (
                        <Field
                          key={key}
                          label={["Título", "", "Link HTTPS (opcional)"][j]}
                          name={key + i}
                        >
                          {key === "text" ? (
                            <RichTextEditor
                              key={(selected?.id ?? "new") + "-section-" + i}
                              label="Conteúdo da seção"
                              required
                              readOnly={!mayEdit}
                              pending={busy}
                              conflict={contentConflict}
                              value={s[key]}
                              onChange={(doc) =>
                                value(
                                  "sections",
                                  draft.sections.map((v: any, n: number) =>
                                    n === i ? { ...v, [key]: doc } : v,
                                  ),
                                )
                              }
                            />
                          ) : (
                            <input
                              required={key === "heading"}
                              type={key === "link" ? "url" : "text"}
                              value={s[key] ?? ""}
                              onChange={(e) =>
                                value(
                                  "sections",
                                  draft.sections.map((v: any, n: number) =>
                                    n === i
                                      ? { ...v, [key]: e.target.value || null }
                                      : v,
                                  ),
                                )
                              }
                            />
                          )}
                        </Field>
                      ))}
                      <Button
                        onClick={() =>
                          value(
                            "sections",
                            draft.sections.filter(
                              (_: any, n: number) => n !== i,
                            ),
                          )
                        }
                      >
                        Remover seção
                      </Button>
                    </fieldset>
                  ))}
                  <Button
                    onClick={() =>
                      value("sections", [
                        ...draft.sections,
                        { heading: "", text: "", link: null },
                      ])
                    }
                  >
                    Adicionar seção
                  </Button>
                </>
              )}
            </>
          ) : tab === "fields" ? (
            <>
              {input("Nome do campo", "label")}
              {input("Chave estável", "key")}
              <Field label="Tipo" name="type">
                <select
                  value={draft.type}
                  onChange={(e) => value("type", e.target.value)}
                >
                  {Object.entries({
                    text: "Texto",
                    number: "Número",
                    boolean: "Sim / não",
                    date: "Data",
                    select: "Seleção única",
                    multi: "Seleção múltipla",
                  }).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              {["select", "multi"].includes(draft.type) && (
                <Field label="Opções (uma por linha)" name="options">
                  <textarea
                    value={draft.options.join("\n")}
                    onChange={(e) =>
                      value("options", e.target.value.split("\n"))
                    }
                  />
                </Field>
              )}
              {check("Obrigatório", "required")}
              {check("Valor bloqueado para edição", "locked")}
            </>
          ) : tab === "groups" ? (
            <>
              {input("Nome do grupo", "name")}
              <Field label="Grupo superior" name="parentId">
                <select
                  value={draft.parentId ?? ""}
                  onChange={(e) => value("parentId", e.target.value || null)}
                >
                  <option value="">Sem grupo superior</option>
                  {rows
                    .filter((r) => r.id !== selected?.id)
                    .map((r) => (
                      <option value={r.id} key={r.id}>
                        {r.value.name}
                      </option>
                    ))}
                </select>
              </Field>
              <fieldset>
                <legend>Pessoas do grupo</legend>
                {c.members.map((m) => (
                  <label className="admin-check" key={m.id}>
                    <input
                      type="checkbox"
                      checked={draft.memberIds.includes(m.id)}
                      onChange={(e) =>
                        value(
                          "memberIds",
                          e.target.checked
                            ? [...draft.memberIds, m.id]
                            : draft.memberIds.filter(
                                (id: string) => id !== m.id,
                              ),
                        )
                      }
                    />
                    {m.displayName}
                  </label>
                ))}
              </fieldset>
            </>
          ) : tab === "profiles" ? (
            <>
              {memberSelect("Pessoa", "memberId")}
              {memberSelect("Pessoa gestora", "managerId", true)}
              {fields
                .filter(
                  (f) =>
                    f.value.visibility !== "private" ||
                    draft.memberId === c.bootstrap.membership.id,
                )
                .map((f) => (
                  <Field key={f.id} label={f.value.label} name={f.value.key}>
                    {f.value.type === "boolean" ? (
                      <input
                        type="checkbox"
                        disabled={f.value.locked}
                        checked={draft.values[f.value.key] === true}
                        onChange={(e) =>
                          value("values", {
                            ...draft.values,
                            [f.value.key]: e.target.checked,
                          })
                        }
                      />
                    ) : ["select", "multi"].includes(f.value.type) ? (
                      <select
                        multiple={f.value.type === "multi"}
                        disabled={f.value.locked}
                        value={
                          draft.values[f.value.key] ??
                          (f.value.type === "multi" ? [] : "")
                        }
                        onChange={(e) =>
                          value("values", {
                            ...draft.values,
                            [f.value.key]:
                              f.value.type === "multi"
                                ? Array.from(
                                    e.target.selectedOptions,
                                    (x) => x.value,
                                  )
                                : e.target.value,
                          })
                        }
                      >
                        {f.value.type === "select" && (
                          <option value="">Selecione</option>
                        )}
                        {f.value.options.map((o: string) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        disabled={f.value.locked}
                        required={f.value.required}
                        type={
                          f.value.type === "number"
                            ? "number"
                            : f.value.type === "date"
                              ? "date"
                              : "text"
                        }
                        value={draft.values[f.value.key] ?? ""}
                        onChange={(e) =>
                          value("values", {
                            ...draft.values,
                            [f.value.key]:
                              f.value.type === "number" && e.target.value !== ""
                                ? Number(e.target.value)
                                : e.target.value,
                          })
                        }
                      />
                    )}
                  </Field>
                ))}
            </>
          ) : tab === "templates" ? (
            <>
              {input("Nome do modelo", "name")}
              {fields.map((f) => (
                <label className="admin-check" key={f.id}>
                  <input
                    type="checkbox"
                    checked={draft.fields.includes(f.id)}
                    onChange={(e) =>
                      value(
                        "fields",
                        e.target.checked
                          ? [...draft.fields, f.id]
                          : draft.fields.filter((id: string) => id !== f.id),
                      )
                    }
                  />
                  {f.value.label}
                </label>
              ))}
            </>
          ) : tab === "policies" ? (
            <>
              <Field label="Política" name="key">
                <select
                  disabled={!!selected}
                  value={draft.key}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      key: e.target.value,
                      value:
                        e.target.value === "governance.method"
                          ? "MANUAL_FACILITATED"
                          : false,
                    })
                  }
                >
                  {Object.entries(policyLabels)
                    .filter(
                      ([key]) =>
                        (key === "governance.method" && cap.governancePolicy) ||
                        (key === "structure.collectiveManagement" &&
                          cap.collectivePolicy) ||
                        key === draft.key,
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </Field>
              {!operationalPolicy ? (
                <Notice>
                  Política não operacional. O registro e suas revisões foram
                  preservados para consulta.
                </Notice>
              ) : (
                <>
                  {draft.key === "governance.method" ? (
                    <Field label="Método" name="value">
                      <select
                        value={draft.value}
                        onChange={(e) => value("value", e.target.value)}
                      >
                        {Object.entries(methodLabels).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    check("Habilitar gestão coletiva", "value")
                  )}
                  {check(
                    "Permitir ajustes locais nos círculos",
                    "allowOverride",
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {memberSelect("Pessoa", "memberId")}
              <Field label="Permissão" name="action">
                <select
                  value={draft.action}
                  onChange={(e) => value("action", e.target.value)}
                >
                  {[
                    "settings",
                    "policy",
                    "field",
                    "template",
                    "group",
                    "profile",
                    "page",
                  ].map((k) => (
                    <option key={k} value={k + ".manage"}>
                      {ts(permissionKeys[k])}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {["fields", "profiles"].includes(tab) && (
            <Field label="Visibilidade" name="visibility">
              <select
                value={draft.visibility}
                onChange={(e) => value("visibility", e.target.value)}
              >
                <option value="organization">Organização</option>
                <option value="private">
                  Privado — somente a própria pessoa
                </option>
              </select>
            </Field>
          )}
          <div className="form-actions">
            {(selected || tab !== "pages") && (
              <button
                className="primary"
                disabled={busy || contentConflict || !mayEdit}
              >
                {busy
                  ? translate("saving")
                  : tab === "pages" && !selected
                    ? "Criar uma página"
                    : translate("save")}
              </button>
            )}
            {selected && tab === "fields" && (
              <Button
                disabled={busy || contentConflict || !mayEdit}
                onClick={() =>
                  void run(async () =>
                    setPlan(
                      (
                        await c.api<any>(
                          base + "/fields/" + selected.id + "/plan",
                          {
                            method: "POST",
                            body: { value: draft },
                            version: selected.version,
                          },
                        )
                      ).data,
                    ),
                  )
                }
              >
                Verificar alteração de schema
              </Button>
            )}
            {selected && tab === "pages" && (
              <>
                <Button
                  disabled={busy || contentConflict || !mayEdit}
                  onClick={() =>
                    void run(async () => {
                      const res = await c.api<any>(
                        base + "/pages/" + selected.id + "/preview",
                        { method: "POST", body: {}, version: selected.version },
                      );
                      setPreview(res.data);
                    })
                  }
                >
                  Pré-visualizar versão salva
                </Button>
                <Button
                  disabled={busy || contentConflict || !mayEdit || !preview}
                  onClick={() =>
                    void run(async () => {
                      const res = await c.api<any>(
                        base + "/pages/" + selected.id + "/publish",
                        {
                          method: "POST",
                          body: { approvedRevision: preview.revision },
                          version: selected.version,
                        },
                      );
                      setPublicUrl(res.data.url);
                      setSelected({
                        ...res.data.page,
                        capabilities: selected.capabilities,
                      });
                      setPreview(null);
                      c.notify("Página publicada localmente.");
                    })
                  }
                >
                  Publicar versão revisada
                </Button>
                <Button
                  disabled={busy || contentConflict || !mayEdit}
                  onClick={() =>
                    void run(async () => {
                      const res = await c.api<any>(
                        base + "/pages/" + selected.id + "/unpublish",
                        { method: "POST", body: {}, version: selected.version },
                      );
                      setPublicUrl("");
                      setSelected({
                        ...res.data.page,
                        capabilities: selected.capabilities,
                      });
                      setPreview(null);
                      c.notify("Publicação revogada.");
                    })
                  }
                >
                  Revogar publicação
                </Button>
              </>
            )}
          </div>
          {plan && (
            <Notice>
              {plan.canApply
                ? "Alteração compatível. Os valores existentes serão preservados."
                : `Alteração bloqueada: ${plan.incompatible.length} perfis incompatíveis. Corrija os valores antes de alterar o tipo.`}
            </Notice>
          )}
          {publicUrl && (
            <p role="status">
              Página publicada:{" "}
              <a href={publicUrl} target="_blank" rel="noreferrer">
                Abrir página pública
              </a>
            </p>
          )}
          {preview && (
            <article className="admin-preview">
              <p className="muted">Prévia da versão {preview.revision}</p>
              <h1>{preview.snapshot.title}</h1>
              {preview.snapshot.sections.map((s: any, i: number) => (
                <section key={i}>
                  <h2>{s.heading}</h2>
                  <RichTextView value={s.text} />
                  {s.link && (
                    <a href={s.link} rel="noreferrer" target="_blank">
                      Saiba mais
                    </a>
                  )}
                </section>
              ))}
            </article>
          )}
          {selected && (selected.capabilities?.history ?? cap.manage) && (
            <>
              <Button
                onClick={() =>
                  void run(async () =>
                    setHistory(
                      (
                        await c.api<any>(
                          base + "/" + tab + "/" + selected.id + "/history",
                        )
                      ).data.items,
                    ),
                  )
                }
              >
                Ver histórico
              </Button>
              {history.map((h) => (
                <details key={h.version}>
                  <summary>
                    {translate("version", { version: formatNumber(h.version) })}{" "}
                    · {formatInstant(h.created_at)}
                  </summary>
                  <HistoryValue
                    data={h.value}
                    reference={(id) =>
                      c.members.find((m) => m.id === id)?.displayName ??
                      fields.find((f) => f.id === id || f.value.key === id)
                        ?.value.label ??
                      rows.find((r) => r.id === id)?.value.name ??
                      "Referência indisponível"
                    }
                  />
                </details>
              ))}
            </>
          )}
        </form>
      ) : visibleRows.length === 0 ? (
        search || !emptyCopy[tab] ? (
          <div className="admin-empty" role="status">
            <span className="admin-empty-icon"><Search size={22} /></span>
            <h2>{search ? translate("noResults") : translate("noRecords")}</h2>
          </div>
        ) : (
          <div className="admin-empty">
            {(() => {
              const Icon = emptyCopy[tab].Icon;
              return <span className="admin-empty-icon" aria-hidden="true"><Icon size={24} strokeWidth={1.75} /></span>;
            })()}
            <h2>{ts(emptyCopy[tab].title)}</h2>
            <p>{ts(emptyCopy[tab].body)}</p>
            {tab === "templates" && fields.length === 0 && (
              <p className="admin-empty-note">{ts("templatesNeedFields")}</p>
            )}
            {tab === "templates" && fields.length === 0 ? (
              <Button className="primary" onClick={() => c.navigate("/administration/fields")}>
                {ts("permField")}
                <ArrowRight size={16} />
              </Button>
            ) : cap.create && (
              <Button className="primary" onClick={() => edit()}>
                <Plus size={16} />
                {ts(emptyCopy[tab].action)}
              </Button>
            )}
          </div>
        )
      ) : (
        <div className="admin-list">
          {visibleRows.map((row) => (
            <div className="admin-row" key={row.id}>
              <div>
                <strong>
                  {tab === "grants" ? c.members.find((m) => m.id === (row as any).member_id)?.displayName ?? ts("unknownPerson") : row.value?.title ??
                    row.value?.name ??
                    row.value?.label ??
                    policyLabels[row.value?.key] ??
                    row.value?.key ??
                    c.members.find((m) => m.id === row.value?.memberId)
                      ?.displayName ??
                    (row as any).action}
                </strong>
                <small>
                  {tab === "grants"
                    ? (permissionKeys[String((row as any).action).split(".")[0]] ? ts(permissionKeys[String((row as any).action).split(".")[0]]) : String((row as any).action)) + ((row as any).active ? "" : " · " + ts("grantRevoked"))
                    : tab === "pages"
                    ? row.publication?.active
                      ? "Publicado · snapshot v" + row.publication.revision
                      : "Rascunho · versão " + row.version
                    : row.value?.visibility === "private"
                      ? "Privado"
                      : row.value?.managerId
                        ? "Gestão: " +
                          (c.members.find((m) => m.id === row.value.managerId)
                            ?.displayName ?? "Pessoa indisponível")
                        : translate("version", {
                            version: formatNumber(row.version),
                          })}
                </small>
              </div>
              {tab === "grants" ? (
                <Button
                  disabled={busy || !(row as any).active}
                  onClick={() =>
                    void run(async () => {
                      await c.api(base + "/grants/" + row.id + "/revoke", {
                        method: "POST",
                        body: {},
                        version: row.version,
                      });
                      setStamp((x) => x + 1);
                    })
                  }
                >
                  {(row as any).active ? "Revogar" : "Revogado"}
                </Button>
              ) : (
                <Button onClick={() => edit(row)}>Abrir</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section></SettingsFrame>
  );
}
export const feature: FeatureDefinition = {
  ...administrationMetadata,
  Component: Administration,
  sidebar: Navigation,
};

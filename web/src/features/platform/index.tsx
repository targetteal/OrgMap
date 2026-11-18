import { CommentsThread } from "./CommentsThread";
export { CommentsThread } from "./CommentsThread";
export type { CommentsThreadProps } from "./CommentsThread";
import { useEffect, useId, useState, useRef } from "react";
import {
  Search,
  Star,
  Download,
  Paperclip,
  Bell,
  RefreshCw,
} from "lucide-react";
import type { FeatureDefinition, FeatureContext } from "../../feature-contract";
import { Button, Field, Notice, Dialog } from "../../ui";
import { errorMessage as sharedErrorMessage } from "../../api";
import "./platform.css";
import { useLocalization } from "../../localization";
import { platformTranslator, resourceLabel, notificationEventLabel } from "./messages";
import { governanceVocabulary } from "../../governance-vocabulary";
import { resourceDestination, resourcePanelDestination } from "./resource-destination";
import { notificationLocale, notificationTime, notificationWorkspacePath, safeNotificationDestination, type NotificationItem } from "./notification-presentation";
function errorMessage(error: unknown) {
  const code = (error as { code?: string })?.code ?? "";
  return (
    (
      {
        INVALID_TRANSFER_SCHEMA:
          "O arquivo não segue o formato OrgMap esperado. Revise o arquivo e tente novamente.",
        INVALID_XLSX:
          "Esta planilha não segue o formato de transferência OrgMap.",
        INVALID_CSV: "Este CSV não segue o formato de transferência OrgMap.",
        IMPORT_PLAN_CHANGED:
          "Os dados mudaram desde a revisão. Revise a importação novamente.",
        INVALID_FILENAME:
          "Use um nome de arquivo sem caminhos ou caracteres de controle.",
        UNSUPPORTED_MIME: "Este tipo de arquivo não é aceito.",
        MIME_MISMATCH:
          "O conteúdo do arquivo não corresponde ao tipo informado.",
        FILE_TOO_LARGE: "O arquivo excede o limite de 5 MB.",
        UNSAFE_CONTENT: "O arquivo contém conteúdo que não pode ser anexado.",
        ADAPTER_REQUIRED:
          "Este tipo de recurso ainda não oferece essa operação.",
        INVALID_EXPORT:
          "Escolha um tipo de exportação e um formato disponíveis.",
        INVALID_RICH_DOCUMENT:
          "O comentário contém uma formatação ou um link que não é permitido.",
      } as Record<string, string>
    )[code] ?? sharedErrorMessage(error)
  );
}
type Props = { context: FeatureContext };
function searchLabels(context: FeatureContext, locale: string) {
  const t = platformTranslator(locale), vocabulary = governanceVocabulary(context.bootstrap);
  if (vocabulary.role === "Papel" && vocabulary.circle === "Círculo" && vocabulary.member === "Membro")
    return { header: t("globalSearch"), placeholder: t("searchPlaceholder") };
  const terms = {
    role: vocabulary.role === "Papel" ? t("role") : vocabulary.role,
    circle: vocabulary.circle === "Círculo" ? t("circle") : vocabulary.circle,
    member: vocabulary.member === "Membro" ? t("member") : vocabulary.member,
  };
  return { header: t("globalSearchCustom", terms), placeholder: t("searchPlaceholderCustom", terms) };
}
function useRead<T>(
  context: FeatureContext,
  path: string | null,
  revision = 0,
  retainOnRefresh = false,
) {
  const scopeKey = JSON.stringify([
    context.organizationId,
    context.session?.account?.id,
    context.bootstrap.membership.id,
    context.bootstrap.membership.memberType,
    context.bootstrap.authorizationRevision,
    path,
  ]);
  const requestKey = JSON.stringify([scopeKey, revision]);
  const [state, setState] = useState<{ key: string; scope: string; data?: T; error: string; pending: boolean }>({
    key: requestKey,
    scope: scopeKey,
    error: "",
    pending: path !== null,
  });
  useEffect(() => {
    if (path === null) {
      setState({ key: requestKey, scope: scopeKey, error: "", pending:false });
      return;
    }
    const c = new AbortController();
    setState(previous => ({ key: requestKey, scope: scopeKey, data: retainOnRefresh && previous.scope === scopeKey ? previous.data : undefined, error: "", pending:true }));
    context
      .api<T>(path, { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted)
          setState({ key: requestKey, scope: scopeKey, data: r.data, error: "", pending:false });
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setState(previous => ({ key: requestKey, scope: scopeKey, data: retainOnRefresh && previous.scope === scopeKey ? previous.data : undefined, error: errorMessage(e), pending:false }));
      });
    return () => c.abort();
  }, [requestKey]);
  return state.key === requestKey
    ? { data: state.data, error: state.error, loading: state.pending }
    : { data: retainOnRefresh && state.scope === scopeKey ? state.data : undefined, error: "", loading: path !== null };
}
const base = (c: FeatureContext) =>
  "/organizations/" + c.organizationId + "/platform";
async function download(c: FeatureContext, path: string) {
  const { data } = await c.api<{
    name: string;
    mime: string;
    downloadMime?: string;
    base64: string;
  }>(path);
  const blob = new Blob(
      [Uint8Array.from(atob(data.base64), (x) => x.charCodeAt(0))],
      { type: data.downloadMime ?? data.mime },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = data.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function SearchOverlay({
  context,
  onClose,
  query,
  setQuery,
}: {
  context: FeatureContext;
  onClose: () => void;
  query: string;
  setQuery: (query: string) => void;
}) {
  const { locale, formatNumber } = useLocalization();
  const t = platformTranslator(locale);
  const labels = searchLabels(context, locale);
  const list = useRead<{
    items: { id: string; type: string; title: string }[];
  }>(context, base(context) + "/search?q=" + encodeURIComponent(query));
  return (
    <Dialog title={t("search")} onClose={onClose}>
      <div className="platform-search-overlay">
        <Field label={t("searchOrganization")} name="search">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.placeholder}
          />
        </Field>
        {list.error && <Notice>{list.error}</Notice>}
        {list.error ? null : !list.data ? (
          <p role="status">{t("searching")}</p>
        ) : list.data.items.length === 0 ? (
          <p className="empty-state">{t("noResults")}</p>
        ) : (
          [...new Set(list.data.items.map((x) => x.type))].map((type) => (
            <section key={type}>
              <h3>{resourceLabel(type, t)}</h3>
              {list
                .data!.items.filter((x) => x.type === type)
                .map((x) => (
                  <Button
                    key={x.id}
                    className="platform-search-item"
                    disabled={!resourceDestination(x.type, x.id, undefined, context.bootstrap)}
                    onClick={() => {
                      const destination = resourceDestination(x.type, x.id, undefined, context.bootstrap);
                      if (!destination) return;
                      onClose();
                      context.navigate(destination);
                    }}
                  >
                    {x.title}
                  </Button>
                ))}
            </section>
          ))
        )}
        <footer>
          {t(list.data?.items.length === 1 ? "result" : "results", {
            count: formatNumber(list.data?.items.length ?? 0),
          })}
        </footer>
      </div>
    </Dialog>
  );
}
export function GlobalSearch({ context }: Props) {
  const { locale } = useLocalization();
  const labels = searchLabels(context, locale);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { setQuery(""); }, [context.organizationId, context.bootstrap.membership.id]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);
  return (
    <>
      <button
        type="button"
        className="platform-global-search"
        aria-label={labels.header}
        onClick={() => setOpen(true)}
      >
        <Search size={16} />
        <span>{labels.header}</span>
        <kbd>⌘ K</kbd>
      </button>
      {open && (
        <SearchOverlay context={context} onClose={() => setOpen(false)} query={query} setQuery={setQuery} />
      )}
    </>
  );
}
function Navigation({ context }: Props) {
  const { locale } = useLocalization();
  const t = platformTranslator(locale);
  return (
    <nav className="platform-navigation" aria-label={t("resources")}>
      {[
        ["/platform/search", t("navigationSearch")],
        ["/platform/favorites", t("favorites")],
        ["/platform/notifications", t("notifications")],
        ["/platform/preferences", t("preferences")],
        ["/platform/jobs", t("transfers")],
      ]
        .filter(
          ([path]) =>
            context.bootstrap.membership.memberType !== "GUEST" ||
            !["/platform/preferences", "/platform/jobs"].includes(path),
        )
        .map(([path, label]) => (
          <Button
            key={path}
            className={context.path.split("?")[0] === path ? "selected" : ""}
            onClick={() => context.navigate(path)}
          >
            {label}
          </Button>
        ))}
    </nav>
  );
}
function searchPath(query: string, type: string) {
  const params = new URLSearchParams({ q: query });
  if (type) params.set("type", type);
  return "/platform/search?" + params.toString();
}
function rememberResult(context: FeatureContext, focus: string) {
  history.replaceState({
    ...history.state,
    platformResult: { organizationId: context.organizationId, memberId: context.bootstrap.membership.id, focus },
  }, "");
}
function resultToFocus(context: FeatureContext): string | null {
  const fromUrl = new URLSearchParams(context.path.split("?")[1] ?? "").get("focus");
  const previous = typeof history === "undefined" ? null : history.state?.platformResult;
  if (fromUrl) return fromUrl;
  return previous?.organizationId === context.organizationId &&
    previous?.memberId === context.bootstrap.membership.id &&
    typeof previous.focus === "string" ? previous.focus : null;
}
function SearchPage({ context }: Props) {
  const { locale } = useLocalization();
  const t = platformTranslator(locale);
  const guest = context.bootstrap.membership.memberType === "GUEST";
  const params = new URLSearchParams(context.path.split("?")[1]),
    [query, setQuery] = useState(params.get("q") ?? ""),
    [type, setType] = useState(params.get("type") ?? ""),
    [rev, setRev] = useState(0),
    [error, setError] = useState("");
  const urlQuery = params.get("q") ?? "";
  const urlType = guest ? "" : params.get("type") ?? "";
  useEffect(() => { setQuery(urlQuery); }, [urlQuery]);
  useEffect(() => { setType(urlType); }, [urlType]);
  const caps = useRead<{ resourceTypes: string[] }>(
    context,
    guest ? null : base(context) + "/capabilities",
  );
  const results = useRead<{
    items: { type: string; id: string; title: string; description?: string }[];
  }>(
    context,
    base(context) +
      "/search?q=" +
      encodeURIComponent(params.get("q") ?? "") +
      "&type=" +
      encodeURIComponent(urlType),
    rev,
  );
  const focus = resultToFocus(context);
  useEffect(() => {
    if (!focus || !results.data?.items.some(item => focus === `resource-entry-${item.type}-${item.id}`)) return;
    document.getElementById(focus)?.focus();
  }, [focus, results.data]);
  const views = useRead<{
    items: {
      id: string;
      name: string;
      resourceType: string;
      config: { query: string };
      version: number;
    }[];
  }>(context, guest ? null : base(context) + "/views", rev);
  return (
    <>
      <h1>{t("navigationSearch")}</h1>
      <form
        className="platform-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          context.navigate(searchPath(query, guest ? "" : type));
          setRev((n) => n + 1);
        }}
      >
        <Field label={t("search")} name="query">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("resourceName")}
          />
        </Field>
        {!guest && (
          <Field label={t("type")} name="type">
            <select value={type} onChange={(e) => {
              const nextType = e.target.value;
              setType(nextType);
              context.navigate(searchPath(urlQuery, nextType));
            }}>
              <option value="">{t("allTypes")}</option>
              {caps.data?.resourceTypes.map((resourceType) => (
                <option key={resourceType} value={resourceType}>
                  {resourceLabel(resourceType, t)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <button className="primary" type="submit">
          {t("search")}
        </button>
      </form>
      {caps.data?.resourceTypes.length === 0 && (
        <p className="empty-state">{t("searchUnavailable")}</p>
      )}
      {(error || results.error) && <Notice>{error || results.error}</Notice>}
      {!results.data && !results.error ? (
        <p role="status">{t("searching")}</p>
      ) : results.data?.items.length === 0 ? (
        <p className="empty-state">{t("tryAnother")}</p>
      ) : (
        <div className="platform-list">
          {results.data?.items.map((item) => (
            <div className="platform-result-row" key={item.type + item.id}>
              <button
                className="platform-result"
                id={`resource-entry-${item.type}-${item.id}`}
                disabled={!resourceDestination(item.type, item.id, context.path, context.bootstrap)}
                onClick={() => {
                  const destination = resourceDestination(item.type, item.id, context.path, context.bootstrap);
                  if (destination) {
                    rememberResult(context, `resource-entry-${item.type}-${item.id}`);
                    context.navigate(destination);
                  }
                }}
              >
                <span className="platform-result-type">{resourceLabel(item.type, t)}</span>
                <strong>{item.title}</strong>
                {item.description && <span>{item.description}</span>}
              </button>
              {resourcePanelDestination(item.type, item.id) && resourceDestination(item.type, item.id, undefined, context.bootstrap) !== resourcePanelDestination(item.type, item.id) &&
                <button type="button" className="platform-linked-resources" onClick={() => context.navigate(resourcePanelDestination(item.type, item.id)!)}>{t("linkedResources")}</button>}
            </div>
          ))}
        </div>
      )}
      {!guest && (
        <section className="platform-section">
          <h2>{t("savedSearches")}</h2>
          <form
            className="platform-toolbar"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                name = String(new FormData(form).get("name") ?? "");
              try {
                await context.api(base(context) + "/views", {
                  method: "POST",
                  body: {
                    name,
                    resourceType: type,
                    config: { query, layout: "list", sort: "title" },
                  },
                });
                setRev((n) => n + 1);
                form.reset();
                context.notify(t("searchSaved"));
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            <Field
              name="name"
              label={t("searchName")}
              required
              maxLength={100}
            />
            <button type="submit" disabled={!type}>
              {t("saveSearch")}
            </button>
          </form>
          {!type && <p className="muted">{t("chooseType")}</p>}
          {views.data?.items.map((v) => (
            <div className="platform-row" key={v.id}>
              <Button
                onClick={() => {
                  setType(v.resourceType);
                  setQuery(v.config.query);
                  context.navigate(searchPath(v.config.query, v.resourceType));
                }}
              >
                {v.name}
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await context.api(base(context) + "/views/" + v.id, {
                      method: "DELETE",
                      version: v.version,
                    });
                    setRev((n) => n + 1);
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                {t("remove")}
              </Button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
export function ResourcePanel({
  context,
  type,
  resourceId,
}: {
  context: FeatureContext;
  type: string;
  resourceId: string;
}) {
  const { locale } = useLocalization();
  const t = platformTranslator(locale);
  const path = base(context) + "/resources/" + type + "/" + resourceId,
    [rev, setRev] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [format, setFormat] = useState("JSON"),
    [exportKind, setExportKind] = useState(""),
    [privateIntentPath, setPrivateIntentPath] = useState("");
  const caps = useRead<{
      actions: Record<string, boolean>;
      favorite: boolean;
      following: boolean;
      exportKinds: string[];
      upload?: {
        operational: boolean;
        hardMaxBytes: number;
        policy: {
          mode: "ANY" | "ALLOWLIST" | "DISABLED";
          allowedKinds: string[];
        } | null;
      };
      locale?:string;
    }>(context, path + "/capabilities", rev),
    files = useRead<{
      items: { id: string; name: string; size: number; mime: string }[];
    }>(context, path + "/files", rev);
  const includePrivate =
    privateIntentPath === path && caps.data?.actions["export-private"] === true;
  const followT=platformTranslator(notificationLocale(caps.data?.locale,locale));
  async function action(suffix: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await context.api(path + suffix, { method: "POST", body });
      setRev((n) => n + 1);
      context.notify(suffix==="/follow"?followT("notificationFollowSaved"):"Alteração salva.");
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (caps.error) return <section className="platform-resource">
    <h3>{t("linkedResources")}</h3>
    <p role="status">{t("resourceActionsUnavailable")}</p>
    <button type="button" onClick={() => setRev(value => value + 1)}>{t("retryLoading")}</button>
  </section>;
  return (
    <div className="platform-resource">
      {error && <Notice>{error}</Notice>}
      <div className="platform-toolbar">
        <button
          type="button"
          aria-pressed={caps.data?.favorite ?? false}
          disabled={!caps.data?.actions.read || busy}
          onClick={() =>
            void action("/favorite", { enabled: !caps.data?.favorite })
          }
        >
          <Star size={15} />
          {caps.data?.favorite ? "Remover favorito" : "Favoritar"}
        </button>
        <button
          type="button"
          aria-pressed={caps.data?.following ?? false}
          disabled={!caps.data?.actions.follow || busy}
          onClick={() =>
            void action("/follow", { enabled: !caps.data?.following })
          }
        >
          <Bell size={15} />
          {followT(caps.data?.following ? "notificationUnfollow" : "notificationFollow")}
        </button>
        <details className="structure-export-disclosure">
          <summary>Exportar</summary>
          <div className="structure-export-options">
        <label className="field">
          Conteúdo
          <select
            value={exportKind || caps.data?.exportKinds?.[0] || "RESOURCES"}
            onChange={(e) => setExportKind(e.target.value)}
          >
            {caps.data?.exportKinds?.map((kind) => (
              <option key={kind} value={kind}>{kind === "task-definitions-v2" ? "Tarefas com responsáveis" : kind}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Formato
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option>JSON</option>
            <option>CSV</option>
            <option>XLSX</option>
          </select>
        </label>
        {caps.data?.actions["export-private"] && (
          <label className="platform-private-intent">
            <input
              type="checkbox"
              checked={includePrivate}
              disabled={busy}
              onChange={(event) =>
                setPrivateIntentPath(event.target.checked ? path : "")
              }
            />
            Incluir dados privados neste recurso
          </label>
        )}
        <Button
          disabled={
            !(includePrivate
              ? caps.data?.actions["export-private"]
              : caps.data?.actions.export) || busy
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await context.api(base(context) + "/exports", {
                method: "POST",
                body: {
                  resourceType: type,
                  resourceIds: [resourceId],
                  kind:
                    exportKind || caps.data?.exportKinds?.[0] || "RESOURCES",
                  format,
                  includePrivate,
                },
              });
              setPrivateIntentPath("");
              context.notify("Exportação na fila.");
              context.navigate("/platform/jobs");
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={15} /> Exportar
        </Button>
          </div>
        </details>
      </div>
      <CommentsThread context={context} type={type} resourceId={resourceId} />
      <section className="platform-section">
        <h2>
          <Paperclip size={18} /> Anexos
        </h2>
        {files.error && <p role="status">{t("resourceFilesUnavailable")}{" "}<button type="button" onClick={() => setRev(value => value + 1)}>{t("retryLoading")}</button></p>}
        {files.data?.items.map((f) => (
          <div className="platform-row" key={f.id}>
            <span>
              {f.name}{" "}
              <small className="muted">{Math.ceil(f.size / 1024)} KB</small>
            </span>
            <Button
              title={"Baixar " + f.name}
              onClick={() =>
                download(
                  context,
                  base(context) + "/files/" + f.id + "/download",
                ).catch((e) => setError(errorMessage(e)))
              }
            >
              <Download size={16} />
            </Button>
          </div>
        ))}
        {files.data?.items.length === 0 && (
          <p className="muted">Nenhum anexo.</p>
        )}
        {caps.data?.upload && (
          <p className="muted" role="status">
            {!caps.data.upload.operational
              ? t("uploadUnavailable")
              : caps.data.upload.policy?.mode === "DISABLED"
                ? t("uploadDisabled")
                : caps.data.upload.policy?.mode === "ALLOWLIST"
                  ? t("uploadAllowed", {
                      types: caps.data.upload.policy.allowedKinds
                        .map((kind) =>
                          kind === "UTF8_TEXT" ? t("uploadTextKind") : kind,
                        )
                        .join(", "),
                    })
                  : t("uploadAny")}
          </p>
        )}
        <p className="muted">{t("uploadDownloadOnly")}</p>
        <Field name="upload" label="Adicionar arquivo (até 5 MB)">
          <input
            type="file"
            disabled={!caps.data?.actions.attach || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                setError("O arquivo excede 5 MB.");
                return;
              }
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = "";
              for (const byte of bytes) binary += String.fromCharCode(byte);
              await action("/uploads", {
                name: file.name,
                mime: file.type,
                base64: btoa(binary),
              });
              e.target.value = "";
            }}
          />
        </Field>
      </section>
    </div>
  );
}
function ResourcePage({ context }: Props) {
  const { locale } = useLocalization();
  const t = platformTranslator(locale);
  const [, , , type, id] = context.path.split("/");
  return (
    <>
      <h1>{resourceLabel(type, t)}</h1>
      <ResourcePanel
        key={context.organizationId + type + id}
        context={context}
        type={type}
        resourceId={id}
      />
    </>
  );
}
export function EntitySections({ context }: Props) {
  const selected = context.selectedEntity;
  if (!selected) return null;
  return (
    <ResourcePanel
      key={context.organizationId + selected.entityId}
      context={context}
      type={selected.kind.toLowerCase()}
      resourceId={selected.entityId}
    />
  );
}
function Preferences({ context }: Props) {
  const {locale:accountLocale}=useLocalization();
  const tabsId = useId();
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocus = useRef<{event:string;channel:string;button:HTMLButtonElement}|null>(null);
  useEffect(() => {
    const isOriginal = (target: EventTarget | null) => {
      const pending = pendingFocus.current;
      return !!pending && target instanceof window.Node && (pending.button === target || pending.button.contains(target));
    };
    const focusChanged = (event: FocusEvent) => {
      if (event.target !== document.body && event.target !== document.documentElement && !isOriginal(event.target)) pendingFocus.current = null;
    };
    const pointerChanged = (event: PointerEvent) => { if (!isOriginal(event.target)) pendingFocus.current = null; };
    const keyboardChanged = (event: KeyboardEvent) => { if (event.key === 'Tab') pendingFocus.current = null; };
    const windowBlurred = () => { pendingFocus.current = null; };
    document.addEventListener('focusin',focusChanged,true);
    document.addEventListener('pointerdown',pointerChanged,true);
    document.addEventListener('keydown',keyboardChanged,true);
    window.addEventListener('blur',windowBlurred);
    return () => {
      document.removeEventListener('focusin',focusChanged,true);
      document.removeEventListener('pointerdown',pointerChanged,true);
      document.removeEventListener('keydown',keyboardChanged,true);
      window.removeEventListener('blur',windowBlurred);
    };
  }, []);
  useEffect(() => { pendingFocus.current = null; }, [context.organizationId, context.session?.account?.id, context.bootstrap.membership.id]);
  const [rev, setRev] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("structure");
  const mutationBusy=useRef(false),scope=JSON.stringify([context.organizationId,context.session?.account?.id,context.bootstrap.membership.id]),scopeRef=useRef(scope);
  scopeRef.current=scope;
  useEffect(()=>{mutationBusy.current=false;setBusy(false);setError("");},[scope]);
  type EventRow = {
    event: string;
    module: string;
    label: string;
    description: string;
    effective: Record<string, { enabled: boolean; origin: string }>;
  };
  const prefs = useRead<{
    locale?: string;
    version: number;
    events: EventRow[];
    items: { event: string; channel: string; enabled: boolean }[];
    policies: {
      event: string;
      channel: string;
      locked: boolean;
      defaultEnabled: boolean;
      masterEnabled: boolean;
      moduleEnabled: boolean;
    }[];
    follows?: {resourceType:string;resourceId:string;resourceTitle:string;enabled:boolean;destination:string}[];
  }>(context, base(context) + "/preferences", rev, true);
  const locale=notificationLocale(prefs.data?.locale,accountLocale),t=platformTranslator(locale);
  const tabs = [
    ["structure", t("notificationStructure")],
    ["circles", t("notificationCircles")],
    ["goals", t("notificationGoals")],
    ["projects", t("notificationProjects")],
    ["meetings", t("notificationMeetings")],
    ["members", t("notificationMembers")],
  ];
  const targetEvent=new URLSearchParams(context.path?.split("?")[1]??"").get("event"),focusedEvent=useRef<string|null>(null),selectedEvent=useRef<string|null>(null);
  useEffect(()=>{
    if(!targetEvent){selectedEvent.current=null;focusedEvent.current=null;return;}
    if(selectedEvent.current===scope+targetEvent)return;
    const row=prefs.data?.events.find(item=>item.event===targetEvent);
    if(row){selectedEvent.current=scope+targetEvent;setTab(row.module);}
  },[scope,targetEvent,prefs.data?.events]);
  useEffect(()=>{
    if(!targetEvent||!prefs.data?.events.some(row=>row.event===targetEvent&&row.module===tab)||focusedEvent.current===scope+targetEvent)return;
    const row=[...document.querySelectorAll<HTMLElement>('.platform-preferences [data-notification-event]')].find(item=>item.dataset.notificationEvent===targetEvent);
    if(row){focusedEvent.current=scope+targetEvent;row.focus({preventScroll:true});row.scrollIntoView?.({block:"nearest"});}
  },[scope,targetEvent,tab,prefs.data?.events]);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || busy || prefs.loading) return;
    pendingFocus.current = null;
    if (!document.hasFocus() || (document.activeElement !== document.body && document.activeElement !== document.documentElement)) return;
    const button = [...document.querySelectorAll<HTMLButtonElement>('.platform-preferences [data-preference-event]')]
      .find(item => item.dataset.preferenceEvent === pending.event && item.dataset.preferenceChannel === pending.channel);
    if (button && !button.disabled) button.focus({preventScroll:true});
  }, [busy,prefs.loading,prefs.data,prefs.error]);
  async function save(event: string, channel: string, enabled: boolean, button:HTMLButtonElement) {
    if(mutationBusy.current)return;
    mutationBusy.current=true;
    pendingFocus.current = document.activeElement === button ? {event,channel,button} : null;
    setBusy(true);
    setError("");
    try {
      await context.api(base(context) + "/preferences", {
        method: "POST",
        version: prefs.data?.version,
        body: { event, channel, enabled },
      });
      if(scopeRef.current!==scope)return;
      setRev((n) => n + 1);
      context.notify(t("notificationSaved"));
    } catch {
      if(scopeRef.current===scope)setError(t("notificationFailed"));
    } finally {
      if(scopeRef.current===scope){mutationBusy.current=false;setBusy(false);}
    }
  }
  async function follow(item:{resourceType:string;resourceId:string;enabled:boolean}) {
    if(mutationBusy.current||prefs.loading)return;
    mutationBusy.current=true;setBusy(true);setError("");
    try {
      await context.api(base(context)+"/resources/"+encodeURIComponent(item.resourceType)+"/"+encodeURIComponent(item.resourceId)+"/follow",{method:"POST",body:{enabled:!item.enabled}});
      if(scopeRef.current!==scope)return;
      setRev(value=>value+1);context.notify(t("notificationFollowSaved"));
    } catch {if(scopeRef.current===scope)setError(t("notificationFailed"));}
    finally {if(scopeRef.current===scope){mutationBusy.current=false;setBusy(false);}}
  }
  const toggle = (
    event: string,
    ch: string,
    enabled: boolean,
    name: string,
    disabled = false,
  ) => (
    <button
      type="button"
      className="platform-switch"
      role="switch"
      aria-checked={enabled}
      data-preference-event={event}
      data-preference-channel={ch}
      aria-label={`${t(ch === "EMAIL" ? "notificationEmail" : "notificationApp")}: ${name}`}
      aria-disabled={busy || prefs.loading || !!prefs.error || disabled}
      disabled={disabled}
      onClick={(e) => { if (!busy && !prefs.loading && !prefs.error && !disabled) void save(event, ch, !enabled, e.currentTarget); }}
    >
      <span />
    </button>
  );
  return (
    <div className="platform-preferences" lang={locale}>
      <div className="platform-tabs">
        <h1>{t("notifications")}</h1>
        <div role="tablist" aria-label={t("notificationModules")}>
          {tabs.map(([id, label], index) => (
            <button
              type="button"
              key={id}
              ref={element => { tabButtons.current[index] = element; }}
              id={`${tabsId}-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${tabsId}-panel`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={event => {
                const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
                  event.key in offsets ? (index + offsets[event.key] + tabs.length) % tabs.length : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(tabs[next][0]);
                tabButtons.current[next]?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {prefs.error && <Notice>{t("notificationFailed")} <Button onClick={() => setRev(n => n + 1)}>{t("retryLoading")}</Button></Notice>}
      {!prefs.data ? (
        !prefs.error&&<p role="status">{t("notificationLoading")}</p>
      ) : (
        <section
          className="platform-preferences-surface"
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-${tab}`}
        >
          <h2>{tabs.find((t) => t[0] === tab)?.[1]}</h2>
          <p className="muted">
            {t("notificationModuleHelp")}
          </p>
          <h3>{t("notificationGlobals")}</h3>
          {prefs.data.events.some((event) => event.effective.EMAIL?.origin === "ORGANIZATION_EMAIL_DISABLED") && (
            <p className="muted">{t("notificationOrganizationOff")}</p>
          )}
          {["EMAIL", "IN_APP"].map((ch) => (
            <div className="platform-master" key={ch}>
              <span>
                {ch === "EMAIL"
                  ? t("notificationEnableEmail")
                  : t("notificationEnableApp")}
              </span>
              {toggle(
                tab + ".Master",
                ch,
                prefs.data!.items.find(
                  (x) => x.event === tab + ".Master" && x.channel === ch,
                )?.enabled ?? true,
                `${t("notificationGlobals")} · ${tabs.find(item => item[0] === tab)?.[1]}`,
              )}
            </div>
          ))}
          <div className="platform-notification-table">
            <div className="platform-notification-row platform-notification-head">
              <span>{t("notificationEvent")}</span>
              <span>{t("notificationEmail")}</span>
              <span>{t("notificationApp")}</span>
            </div>
            {prefs.data.events
              .filter((x) => x.module === tab)
              .map((row) => (
                <div className={"platform-notification-row"+(row.event===targetEvent?" is-highlighted":"")} key={row.event} data-notification-event={row.event} tabIndex={row.event===targetEvent?-1:undefined}>
                  <div>
                    <strong>{prefs.data?.locale?row.label:notificationEventLabel(row.event,row.label,locale)}</strong>
                    <p>{prefs.data?.locale?row.description:row.event==='ProposalSubmitted'?t('ProposalSubmittedDescription'):row.event==='ProposalDecided'?t('ProposalDecidedDescription'):row.event==='ConsentWindowOpened'?t('ConsentWindowOpenedDescription'):row.event==='InvitationAccepted'?t('InvitationAcceptedDescription'):row.event==='InvitationDeliveryFailed'?t('InvitationDeliveryFailedDescription'):row.description}</p>
                  </div>
                  {["EMAIL", "IN_APP"].map((ch) => (
                    <div key={ch}>
                      {toggle(
                        row.event,
                        ch,
                        row.effective[ch].enabled,
                        prefs.data?.locale?row.label:notificationEventLabel(row.event,row.label,locale),
                        [
                          "LOCK",
                          "MASTER_DISABLED",
                          "MODULE_DISABLED",
                          "USER_MASTER_DISABLED",
                          "ORGANIZATION_EMAIL_DISABLED",
                        ].includes(row.effective[ch].origin),
                      )}
                      {row.effective[ch].origin === "LOCK" && (
                        <small>{t("notificationOrganizationRule")}</small>
                      )}
                      {row.effective[ch].origin === "ORGANIZATION_EMAIL_DISABLED" && (
                        <small>{t("notificationEmailOff")}</small>
                      )}
                      {["MASTER_DISABLED","MODULE_DISABLED","USER_MASTER_DISABLED"].includes(row.effective[ch].origin)&&<small>{t("notificationModuleOff")}</small>}
                    </div>
                  ))}
                </div>
              ))}
          </div>
          <div className="platform-preference-reset">
            <Button
              disabled={busy||prefs.loading||!!prefs.error}
              onClick={async () => {
                if(mutationBusy.current)return;
                mutationBusy.current=true;setBusy(true);setError("");
                try {
                  await context.api(base(context) + "/preferences/reset", {
                    method: "POST",
                    body: {},
                    version: prefs.data?.version,
                  });
                  if(scopeRef.current!==scope)return;
                  setRev((n) => n + 1);
                  context.notify(t("notificationRestored"));
                } catch {if(scopeRef.current===scope)setError(t("notificationFailed"));}
                finally {if(scopeRef.current===scope){mutationBusy.current=false;setBusy(false);}}
              }}
            >
              {t("notificationRestore")}
            </Button>
          </div>
        </section>
      )}
      {prefs.data?.follows&&<section className="platform-follow-preferences" aria-labelledby={tabsId+"-follows"}>
        <h2 id={tabsId+"-follows"}>{t("notificationFollowing")}</h2>
        <p className="muted">{t("notificationFollowingHelp")}</p>
        {!prefs.data.follows.length?<p>{t("notificationFollowingEmpty")}</p>:<ul>{prefs.data.follows.map(item=><li key={item.resourceType+":"+item.resourceId}>
          <button type="button" className="platform-follow-resource" disabled={!safeNotificationDestination(item.destination)} onClick={()=>{const path=safeNotificationDestination(item.destination);if(path)context.navigate(path);}}><strong>{item.resourceTitle}</strong><span>{resourceLabel(item.resourceType,t)}</span></button>
          <button type="button" aria-pressed={item.enabled} disabled={busy||prefs.loading||!!prefs.error} aria-label={`${t(item.enabled?"notificationUnfollow":"notificationFollow")}: ${item.resourceTitle}`} onClick={()=>void follow(item)}>{t(item.enabled?"notificationUnfollow":"notificationFollow")}</button>
        </li>)}</ul>}
      </section>}
    </div>
  );
}
function Jobs({ context }: Props) {
  const [rev, setRev] = useState(0),
    [error, setError] = useState(""),
    [transfer, setTransfer] = useState<Record<string, unknown>>(),
    [fileName, setFileName] = useState(""),
    [target, setTarget] = useState(""),
    [targetQuery, setTargetQuery] = useState(""),
    [targets, setTargets] = useState<{
      supported: boolean;
      resourceType: string;
      items: { id: string; title: string; type: string; canImport: boolean }[];
    }>(),
    [findingTargets, setFindingTargets] = useState(false),
    [preview, setPreview] = useState<{
      planHash: string;
      recordCount: number;
      warnings: string[];
    }>();
  const jobs = useRead<{
    items: {
      id: string;
      kind: string;
      includePrivate?: boolean;
      state: string;
      version: number;
      result?: { artifactId?: string };
      errorCode?: string;
    }[];
  }>(context, base(context) + "/jobs", rev);
  const fileSelection = useRef(0);
  const targetSearch = useRef(0);
  const reviewRequest = useRef(0);
  async function findTargets(
    input: Record<string, unknown>,
    query: string,
    generation = fileSelection.current,
  ) {
    const request = ++targetSearch.current;
    ++reviewRequest.current;
    setPreview(undefined);
    setFindingTargets(true);
    setError("");
    try {
      const response = await context.api<NonNullable<typeof targets>>(
        base(context) + "/imports/targets",
        { method: "POST", body: { ...input, query } },
      );
      if (
        generation !== fileSelection.current ||
        request !== targetSearch.current
      )
        return;
      setTargets(response.data);
      if (!response.data.items.some((item) => item.id === target)) {
        setTarget("");
        setPreview(undefined);
      }
    } catch (e) {
      if (
        generation === fileSelection.current &&
        request === targetSearch.current
      )
        setError(errorMessage(e));
    } finally {
      if (
        generation === fileSelection.current &&
        request === targetSearch.current
      )
        setFindingTargets(false);
    }
  }
  async function selectImportFile(file?: File) {
    const generation = ++fileSelection.current;
    ++reviewRequest.current;
    setPreview(undefined);
    setTransfer(undefined);
    setTarget("");
    setTargets(undefined);
    setTargetQuery("");
    setFindingTargets(false);
    setFileName("");
    setError("");
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("O arquivo excede 5 MB.");
      let input: Record<string, unknown>;
      if (file.name.toLowerCase().endsWith(".json"))
        input = { document: JSON.parse(await file.text()) };
      else {
        let binary = "";
        for (const n of new Uint8Array(await file.arrayBuffer()))
          binary += String.fromCharCode(n);
        input = {
          format: file.name.toLowerCase().endsWith(".xlsx") ? "XLSX" : "CSV",
          base64: btoa(binary),
        };
      }
      if (generation !== fileSelection.current) return;
      setTransfer(input);
      setFileName(file.name);
      await findTargets(input, "", generation);
    } catch (error) {
      if (generation === fileSelection.current) setError(errorMessage(error));
    }
  }
  return (
    <>
      <div className="platform-row">
        <h1>Importação e exportação</h1>
        <Button onClick={() => setRev((n) => n + 1)}>
          <RefreshCw size={16} /> Atualizar
        </Button>
      </div>
      {(error || jobs.error) && <Notice>{error || jobs.error}</Notice>}
      <p className="muted">
        As exportações ficam disponíveis por 24 horas e seguem suas permissões
        atuais.
      </p>
      <section className="platform-section">
        <h2>Importar arquivo OrgMap</h2>
        <Field name="import-file" label="Arquivo OrgMap (JSON, CSV ou XLSX)">
          <input
            type="file"
            accept=".json,.csv,.xlsx"
            onChange={(e) => void selectImportFile(e.target.files?.[0])}
          />
        </Field>
        {transfer && (
          <>
            <Field name="target-query" label="Buscar destino da importação">
              <input
                value={targetQuery}
                onChange={(e) => setTargetQuery(e.target.value)}
                placeholder="Nome do projeto ou recurso"
              />
            </Field>
            <Button
              disabled={findingTargets}
              onClick={() => void findTargets(transfer, targetQuery)}
            >
              Buscar destinos
            </Button>
            {findingTargets ? (
              <p role="status">Buscando destinos autorizados…</p>
            ) : targets?.supported === false ? (
              <Notice>
                Este tipo de arquivo ainda não oferece importação para um
                destino selecionável.
              </Notice>
            ) : (
              targets && (
                <Field name="target" label="Destino da importação">
                  <select
                    value={target}
                    onChange={(e) => {
                      ++reviewRequest.current;
                      setTarget(e.target.value);
                      setPreview(undefined);
                    }}
                  >
                    <option value="">Selecione um destino autorizado</option>
                    {targets.items.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.title} ·{" "}
                        {(
                          {
                            project: "Projeto",
                            task: "Tarefa",
                            circle: "Círculo",
                            role: "Papel",
                            goal: "Objetivo",
                            meeting: "Reunião",
                            report: "Ata",
                          } as Record<string, string>
                        )[item.type] ?? "Recurso"}
                      </option>
                    ))}
                  </select>
                  {targets.items.length === 0 && (
                    <p>
                      Nenhum destino autorizado encontrado. Revise a busca ou
                      suas permissões.
                    </p>
                  )}
                </Field>
              )
            )}
          </>
        )}
        <Button
          disabled={!transfer || !target || findingTargets}
          onClick={async () => {
            const generation = fileSelection.current;
            const request = ++reviewRequest.current;
            try {
              const response = await context.api<{
                planHash: string;
                recordCount: number;
                warnings: string[];
              }>(base(context) + "/imports/preview", {
                method: "POST",
                body: { ...transfer, resourceId: target },
              });
              if (
                generation === fileSelection.current &&
                request === reviewRequest.current
              )
                setPreview(response.data);
            } catch (e) {
              if (
                generation === fileSelection.current &&
                request === reviewRequest.current
              )
                setError(errorMessage(e));
            }
          }}
        >
          Revisar importação
        </Button>
        {preview && (
          <div className="platform-import-preview">
            <p>
              {preview.recordCount}{" "}
              {preview.recordCount === 1 ? "registro" : "registros"} de{" "}
              {fileName} {preview.recordCount === 1 ? "pronto" : "prontos"} para
              revisão.
            </p>
            {preview.warnings.map((w) => (
              <Notice key={w}>
                {w ===
                "Imports create new project definitions. The importing member becomes manager; no access grant, section or task is copied."
                  ? "A importação cria novos projetos. Você será responsável por gerenciá-los; permissões de acesso, seções e tarefas não serão copiadas."
                  : w}
              </Notice>
            ))}
            <Button
              className="primary"
              onClick={async () => {
                try {
                  await context.api(base(context) + "/imports", {
                    method: "POST",
                    body: {
                      ...transfer,
                      resourceId: target,
                      planHash: preview.planHash,
                    },
                  });
                  setPreview(undefined);
                  setRev((n) => n + 1);
                  context.notify("Importação na fila.");
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Confirmar importação
            </Button>
          </div>
        )}
      </section>
      <section className="platform-section">
        <h2>Histórico</h2>
        {!jobs.data ? (
          <p role="status">Carregando operações…</p>
        ) : jobs.data.items.length === 0 ? (
          <p className="empty-state">
            Nenhuma importação ou exportação solicitada.
          </p>
        ) : (
          jobs.data.items.map((j) => (
            <div className="platform-job" key={j.id}>
              <div>
                <strong>
                  {j.kind === "EXPORT" ? "Exportação" : "Importação"}
                </strong>
                {j.includePrivate && <p>Inclui dados privados</p>}
                <p>
                  {
                    (
                      {
                        PENDING: "Na fila",
                        RUNNING: "Em andamento",
                        COMPLETED: "Concluída",
                        FAILED: "Falhou",
                        CANCELLED: "Cancelada",
                      } as Record<string, string>
                    )[j.state]
                  }
                </p>
                {j.errorCode && <small>{j.errorCode}</small>}
              </div>
              <div>
                {j.result?.artifactId && (
                  <Button
                    onClick={() =>
                      download(
                        context,
                        base(context) +
                          "/artifacts/" +
                          j.result!.artifactId +
                          "/download",
                      ).catch((e) => setError(errorMessage(e)))
                    }
                  >
                    <Download size={16} /> Baixar
                  </Button>
                )}
                {["PENDING", "RUNNING", "FAILED"].includes(j.state) && (
                  <Button
                    onClick={async () => {
                      try {
                        await context.api(
                          base(context) +
                            "/jobs/" +
                            j.id +
                            "/" +
                            (j.state === "FAILED" ? "retry" : "cancel"),
                          { method: "POST", body: {}, version: j.version },
                        );
                        setRev((n) => n + 1);
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  >
                    {j.state === "FAILED" ? "Tentar novamente" : "Cancelar"}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}
export function Collections({
  context,
  favorites = false,
}: Props & { favorites?: boolean }) {
  const {locale:accountLocale}=useLocalization();
  const [rev, setRev] = useState(0),
    [error, setError] = useState(""),[pending,setPending]=useState<string|null>(null);
  const scope=JSON.stringify([context.organizationId,context.session?.account?.id,context.bootstrap.membership.id,context.bootstrap.authorizationRevision]),scopeRef=useRef(scope),marking=useRef<string|null>(null);
  scopeRef.current=scope;
  useEffect(()=>{setError("");setPending(null);marking.current=null;},[scope]);
  const list = useRead<{
    locale?:string;
    items: NotificationItem[];
  }>(
    context,
    base(context) + (favorites ? "/favorites" : "/notifications"),
    rev,
    !favorites,
  );
  const locale=notificationLocale(favorites?undefined:list.data?.locale??list.data?.items[0]?.presentation?.locale,accountLocale),t=platformTranslator(locale);
  useEffect(()=>{
    if(favorites)return;
    const refresh=()=>{if(document.visibilityState!=="hidden")setRev(value=>value+1);};
    const timer=window.setInterval(refresh,30000);window.addEventListener("focus",refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[scope,favorites]);
  async function markRead(item:NotificationItem) {
    if(item.readAt||marking.current)return;
    marking.current=item.id;setPending(item.id);setError("");
    try {
      await context.api(base(context)+"/notifications/"+encodeURIComponent(item.id)+"/read",{method:"POST",body:{}});
      if(scopeRef.current===scope)setRev(value=>value+1);
    } catch {if(scopeRef.current===scope)setError(t("notificationFailed"));}
    finally {if(scopeRef.current===scope){marking.current=null;setPending(null);}}
  }
  const focus = favorites ? resultToFocus(context) : null;
  useEffect(() => {
    if (!focus || !list.data?.items.some(item => focus === `resource-entry-${item.resourceType}-${item.resourceId}`)) return;
    document.getElementById(focus)?.focus();
  }, [focus, list.data]);
  return (
    <section lang={locale}>
      <h1>{t(favorites?"favorites":"notifications")}</h1>
      {!favorites&&<div className="platform-notification-toolbar"><Button disabled={list.loading} onClick={()=>setRev(value=>value+1)}>{t("notificationRefresh")}</Button><Button onClick={()=>context.navigate(notificationWorkspacePath("/platform/preferences",context.organizationId))}>{t("preferences")}</Button></div>}
      {(error || list.error) && <Notice>{error || (favorites?list.error:t("notificationFailed"))}</Notice>}
      {!list.data ? (
        !list.error&&<p role="status">{favorites?"Carregando…":t("notificationListLoading")}</p>
      ) : list.data.items.length === 0 ? (
        <p className="empty-state">
          {favorites
            ? "Você ainda não salvou favoritos."
            : t("notificationEmpty")}
        </p>
      ) : (
        list.data.items.map((item) => {
          const presentation=item.presentation;
          const destination=(!favorites&&safeNotificationDestination(presentation?.destination))||resourceDestination(item.resourceType,item.resourceId,favorites?context.path:undefined,context.bootstrap);
          const preferencesDestination=safeNotificationDestination(presentation?.preferencesDestination);
          const time=notificationTime(presentation?.occurredAt??item.availableAt,notificationLocale(presentation?.locale,locale));
          return <div className={favorites?"platform-row":"platform-notification-entry"+(item.readAt?"":" is-unread")} key={item.id}>
          <div className={favorites?undefined:"platform-notification-content"}>
            <button type="button"
              className={favorites?undefined:"platform-notification-open"}
              id={`resource-entry-${item.resourceType}-${item.resourceId}`}
              disabled={!destination}
              aria-label={presentation?`${t("notificationOpen")}: ${presentation.resourceTitle}`:undefined}
              onClick={() => {
                if (destination) {
                  if (favorites) rememberResult(context, `resource-entry-${item.resourceType}-${item.resourceId}`);
                  else void markRead(item);
                  context.navigate(favorites?destination:notificationWorkspacePath(destination,context.organizationId));
                }
              }}
            >
              {favorites
                ? item.resourceTitle ? `${item.resourceTitle} · ${resourceLabel(item.resourceType, t)}` : t("otherResources")
                : presentation?<><span>{presentation.heading}</span><strong>{presentation.resourceTitle}</strong></>:<>{notificationEventLabel(item.event ?? '', resourceLabel(item.resourceType,t),locale)}{item.resourceTitle ? ` · ${item.resourceTitle}` : ''}</>}
            </button>
            {!favorites&&presentation?.summary&&<p>{presentation.summary}</p>}
            {!favorites&&presentation?.actorName&&<p className="muted">{t("notificationBy",{name:presentation.actorName})}</p>}
            {!favorites&&presentation?.details?.length?<dl>{presentation.details.map((detail,index)=><div key={index}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>:null}
            {!favorites&&time&&<time dateTime={time.value} title={time.relative}>{time.absolute}</time>}
          </div>
            {favorites && resourcePanelDestination(item.resourceType, item.resourceId) && resourceDestination(item.resourceType, item.resourceId, undefined, context.bootstrap) !== resourcePanelDestination(item.resourceType, item.resourceId) &&
              <button type="button" className="platform-linked-resources" onClick={() => context.navigate(resourcePanelDestination(item.resourceType, item.resourceId)!)}>{t("linkedResources")}</button>}
            {!favorites&&<div className="platform-notification-actions">{!item.readAt && (
              <Button
                disabled={pending===item.id}
                onClick={()=>void markRead(item)}
              >
                {t("notificationMarkRead")}
              </Button>
            )}{preferencesDestination&&<Button onClick={()=>context.navigate(preferencesDestination)}>{t("notificationManage")}</Button>}</div>}
          </div>
        })
      )}
    </section>
  );
}
function Platform({ context }: Props) {
  let page = context.path.split("?")[0];
  return (
    <div className="platform-page" key={context.organizationId}>
      {page.startsWith("/platform/resource/") ? (
        <ResourcePage context={context} />
      ) : page === "/platform/preferences" ? (
        <Preferences context={context} />
      ) : page === "/platform/jobs" ? (
        <Jobs context={context} />
      ) : page === "/platform/favorites" ? (
        <Collections context={context} favorites />
      ) : page === "/platform/notifications" ? (
        <Collections context={context} />
      ) : (
        <SearchPage context={context} />
      )}
    </div>
  );
}
export const feature: FeatureDefinition = {
  id: "platform",
  module: "platform",
  label: "Recursos",
  matches: (path) => path === "/platform" || path.startsWith("/platform/"),
  Component: Platform,
  sidebar: Navigation,
  GlobalSearch,
  EntitySections,
  navigation: [
    { path: "/platform/favorites", label: "Favoritos", location: "identity" },
    {
      path: "/platform/notifications",
      label: "Notificações",
      location: "identity",
    },
    {
      path: "/platform/preferences",
      label: "Preferências de notificações",
      location: "identity",
    },
    {
      path: "/platform/jobs",
      label: "Importação e exportação",
      location: "sidebar",
    },
  ],
};

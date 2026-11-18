import {
  BarChart3, CalendarDays, ChevronLeft, ChevronsUpDown, Circle, CircleCheck, CircleDot,
  Filter, Flag, GanttChart, GitBranch, Globe, Heart, List, Lock, OctagonX, Plus,
  Search, Settings, Target, TriangleAlert, Users, X,
} from "lucide-react";
import { useEffect, useRef, useState, useId, Children, cloneElement, isValidElement, type ReactElement, type ReactNode, } from "react";
import { initials } from "../../model";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import {goalsMetadata} from './metadata';
import { errorMessage, RequestError } from "../../api";
import "./goals.css";
import { RichText, RichEditor } from "./rich-text";
import { useLocalization } from "../../localization";
import { goalTranslator } from "./messages";
import { TraceOrigin, TraceReturnLink } from "../../traceability";
function useGoalText() { const { locale } = useLocalization(); return goalTranslator(locale); }
type Goal = Record<string, any>;
function ProgressExplanation({goal}: {goal:Goal}) {
    const t=useGoalText();
    const {formatNumber}=useLocalization();
    const rows=(items:Goal[]) => <ul>{items.map(item=><li key={item.id}>{item.title}{" · "}{item.progress.display === null ? t("Progresso desconhecido") : formatNumber(item.progress.display)+"%"}{" · "}{t("Peso: {weight}",{weight:formatNumber(Number(item.weight))})}{item.excluded || item.archived || item.lifecycle === "ARCHIVED" || Number(item.weight)===0 ? " · "+t("Não contribui") : ""}</li>)}</ul>;
    return <details className="goals-calculation mare-disclosure quiet">
      <summary>{t("Como o progresso é calculado")}</summary>
      {goal.source === "MANUAL" ? <p>{t("Valor manual: {value}%.",{value:formatNumber(Number(goal.manualProgress))})}</p> : <>
        <p>{t("Cada fonte usa a soma de progresso × peso dividida pela soma dos pesos que contribuem.")}</p>
        {goal.source === "BOTH" && <p>{t("Ambos: (resultados-chave × {krWeight} + objetivos filhos × {childWeight}) ÷ 100.",{krWeight:formatNumber(Number(goal.krWeight)),childWeight:formatNumber(Number(goal.childWeight))})}</p>}
        {["KEY_RESULTS","BOTH"].includes(goal.source) && <><h4>{t("Resultados-chave")}</h4>{rows(goal.keyResults)}</>}
        {["CHILD_GOALS","BOTH"].includes(goal.source) && <><h4>{t("Objetivos filhos")}</h4>{rows(goal.children)}</>}
        <p>{t("Excluídos, arquivados e pesos zero não contribuem. Sem peso positivo ou com contribuição desconhecida, o progresso é desconhecido.")}</p>
        {goal.progress.reason === "INCOMPLETE_AUTHORIZED_COVERAGE" && <p>{t("Há contribuições sem acesso. O progresso agregado não é divulgado.")}</p>}
      </>}
    </details>;
}
const HEALTH_ICONS: Record<string, typeof CircleCheck> = { ON_TRACK: CircleCheck, AT_RISK: TriangleAlert, BLOCKED: OctagonX };
function HealthBadge({ health, label }: { health?: string | null; label?: string }) {
    if (!health || !label) return null;
    const Icon = HEALTH_ICONS[health] ?? CircleCheck;
    return <span className={"goals-health goals-health-" + health.toLowerCase().replace("_", "-")}><Icon size={14} aria-hidden="true"/>{label}</span>;
}
function ProgressBar({ value }: { value: number | null | undefined }) {
    const known = typeof value === "number" && Number.isFinite(value);
    return <span className={"goals-bar" + (known ? "" : " unknown")} aria-hidden="true"><i style={{ width: known ? Math.max(0, Math.min(100, value as number)) + "%" : 0 }}/></span>;
}
type Period = {
    id: string;
    title: string;
    startsOn: string;
    endsOn: string;
    version: number;
    archived: boolean;
};
const BASE_HEALTH = [
    ["ON_TRACK", "No caminho certo"],
    ["AT_RISK", "Em risco"],
    ["BLOCKED", "Bloqueado"],
];
const BASE_LIFE = [
    ["DRAFT", "Rascunho"],
    ["ACTIVE", "Ativo"],
    ["CLOSED", "Fechado"],
    ["ARCHIVED", "Arquivado"],
];
const BASE_SOURCES = [
    ["MANUAL", "Manual"],
    ["KEY_RESULTS", "Resultados-chave"],
    ["CHILD_GOALS", "Objetivos filhos"],
    ["BOTH", "Ambos"],
];
const ACTIVITY: Record<string, string> = {
    "goal.created": "Objetivo criado",
    "goal.created.from-tension": "Objetivo criado a partir de tensão",
    "goal.updated": "Objetivo atualizado",
    "goal.assignments.updated": "Atribuições atualizadas",
    "goal.key-result.created": "Resultado-chave criado",
    "goal.key-result.updated": "Resultado-chave atualizado",
    "goal.key-result.progressed": "Progresso do resultado-chave atualizado",
    "goal.lifecycle.changed": "Estado do objetivo alterado",
    "goal.links.updated": "Vínculos atualizados",
    "goal.progress.configured": "Configuração de progresso atualizada",
    "goal.progress.updated": "Progresso atualizado",
    "goal.period.created": "Período criado",
    "goal.period.updated": "Período atualizado",
};
function Field({ label, children, literal = false }: {
    label: string;
    children: ReactNode;
    literal?: boolean;
}) {
    const t = useGoalText();
    const id = useId();
    const required = /^(.*) (obrigatóri[oa]s?)$/.exec(label);
    return (<div className={"field " + (label.startsWith("Proprietário") ? "goals-owner-field" : "")}>
      <label htmlFor={id} className="goals-field-label">
        {required ? (<>
            {literal ? required[1] : t(required[1])} <small>{t(required[2])}</small>
          </>) : (literal ? label : t(label))}
      </label>
      {Children.map(children, (child, index) => index === 0 && isValidElement(child)
            ? cloneElement(child as ReactElement<{
                id?: string;
            }>, { id })
            : child)}
    </div>);
}
function PeriodPicker({ id, periods, value, onChange, }: {
    id?: string;
    periods: Period[];
    value: string[];
    onChange: (ids: string[]) => void;
}) {
    const t = useGoalText();
    const [open, setOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open)
            return;
        const close = (e: PointerEvent) => {
            if (!pickerRef.current?.contains(e.target as Node))
                setOpen(false);
        };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [open]);
    return (<div ref={pickerRef} className="goals-period-picker">
      <button id={id} type="button" aria-expanded={open} aria-controls={id ? id + "-options" : undefined} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
            }
        }}>
        <CalendarDays size={16}/><span>        {value.length
            ? periods
                .filter((p) => value.includes(p.id))
                .map((p) => p.title)
                .join(", ")
            : t("Selecionar per\u00EDodo")}</span><ChevronsUpDown size={16}/>
      </button>
      {open && (<fieldset id={id ? id + "-options" : undefined} className="goals-period-options" onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    document.getElementById(id ?? "")?.focus();
                }
            }}>
          <legend>{t("Per\u00EDodos dispon\u00EDveis")}</legend>
          {!periods.length && <p>{t("Nenhum per\u00EDodo definido.")}</p>}
          {periods.map((p) => (<label key={p.id}>
              <input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked
                    ? [...value, p.id]
                    : value.filter((v) => v !== p.id))}/>
              {p.title}
            </label>))}
        </fieldset>)}
    </div>);
}
function Select({ value, onChange, options, empty, id, }: {
    value: string;
    onChange: (v: string) => void;
    options: string[][];
    empty?: string;
    id?: string;
}) {
    return (<div className="goals-select-wrap"><select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map(([id, label]) => (<option value={id} key={id}>
          {label}
        </option>))}
    </select><ChevronsUpDown size={16}/></div>);
}
function Modal({ title, close, children, context, busy, requestExit, state }: {
    title: string;
    close: () => void;
    children: ReactNode;
    context: FeatureContext;
    busy: boolean;
    requestExit: React.MutableRefObject<(next?:()=>void)=>void>;
    state: React.MutableRefObject<{dirty:boolean;busy:boolean}>;
}) {
    const t = useGoalText();
    const titleId = useId();
    const ref = useRef<HTMLDialogElement>(null);
    state.current.busy=busy;
    const [pendingExit, setPendingExit] = useState<(()=>void)|null>(null);
    const reason=()=>state.current.busy?t("Aguarde o salvamento antes de sair."):state.current.dirty?t("Há alterações não salvas neste formulário."):null;
    requestExit.current = (next = close) => {
        if (busy) return;
        if (state.current.dirty) setPendingExit(() => next);
        else next();
    };
    useEffect(()=>context.registerNavigationGuard?.(reason),[context.registerNavigationGuard]);
    useEffect(()=>{
        const prevent=(event:BeforeUnloadEvent)=>{if(reason()){event.preventDefault();event.returnValue="";}};
        window.addEventListener("beforeunload",prevent);
        return()=>window.removeEventListener("beforeunload",prevent);
    },[]);
    const changed=()=>{state.current.dirty=true;};
    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = ref.current;
        dialog?.showModal();
        dialog
            ?.querySelector<HTMLInputElement>("input:not([type=checkbox]),textarea")
            ?.focus();
        return () => {
            dialog?.close();
            requestAnimationFrame(() => {
                if (opener?.isConnected)
                    opener.focus();
            });
        };
    }, []);
    return (<dialog ref={ref} aria-labelledby={titleId} className="goals-dialog" onCancel={(e) => {
            e.preventDefault();
            if(pendingExit)setPendingExit(null);else requestExit.current();
        }} onInputCapture={changed} onChangeCapture={changed}>
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" disabled={busy} onClick={()=>requestExit.current()} aria-label={t("Fechar")}>
          <X size={16}/>
        </button>
      </div>
      <div className="goals-modal-body" hidden={!!pendingExit}>{children}</div>
      {pendingExit&&<div className="goals-discard-confirmation">
        <p>{t("Descartar as alterações deste formulário?")}</p>
        <button type="button" autoFocus onClick={()=>setPendingExit(null)}>{t("Continuar editando")}</button>
        <button type="button" onClick={()=>{state.current.dirty=false;pendingExit();}}>{t("Descartar alterações")}</button>
      </div>}
    </dialog>);
}
function Sidebar({ context: c }: {
    context: FeatureContext;
}) {
    const t = useGoalText();
    const guest = c.bootstrap.membership.memberType === "GUEST";
    return (<div className="goals-sidebar">
      <button className="nav-item" onClick={() => c.navigate("/goals")}>
        <Target size={16}/>{t("Todos os objetivos")}</button>
      {!guest && <button className="nav-item" onClick={() => c.navigate("/goals?mine=true")}>{t("Meus objetivos")}</button>}
      {!guest && <button className="nav-item" onClick={() => c.navigate("/goals/statistics")}>
        <BarChart3 size={16}/>{t("Estat\u00EDsticas")}</button>}
      {!guest && <button className="nav-item" onClick={() => c.navigate("/goals/settings")}>
        <Settings size={16}/>{t("Configura\u00E7\u00F5es de objetivos")}</button>}
    </div>);
}
function Timeline({ items, periods, navigate, }: {
    items: Goal[];
    periods: Period[];
    navigate: (path: string) => void;
}) {
    const t = useGoalText();
    const { formatDate } = useLocalization();
    const used = periods.filter((p) => items.some((g) => g.periodIds.includes(p.id)));
    const starts = used.map((p) => Date.parse(p.startsOn + "T00:00:00Z")), ends = used.map((p) => Date.parse(p.endsOn + "T00:00:00Z") + 86400000);
    if (!starts.length)
        return <p>{t("N\u00E3o h\u00E1 per\u00EDodos dispon\u00EDveis para exibir a linha do tempo.")}</p>;
    const start = Math.min(...starts), end = Math.max(...ends), span = Math.max(86400000, end - start);
    return (<div className="goals-timeline" role="region" aria-label={t("Linha do tempo dos objetivos")} tabIndex={0}>
      <div className="goals-timeline-axis">
        <span>{t("Objetivo")}</span>
        <div>
          <time>{formatDate(new Date(start).toISOString().slice(0, 10))}</time>
          <time>{formatDate(new Date(end - 86400000).toISOString().slice(0, 10))}</time>
        </div>
      </div>
      {items.map((g) => {
            const ps = used.filter((p) => g.periodIds.includes(p.id));
            return (<div className="goals-timeline-item" key={g.id}>
            <button onClick={() => navigate("/goals/" + g.id)}>
              {g.title}
              <small>
                {g.progress.display === null
                    ? t("Progresso desconhecido") : Math.round(g.progress.display) + "%"}
              </small>
              <ProgressBar value={g.progress.display}/>
            </button>
            <div className="goals-timeline-track" style={{ height: Math.max(52, ps.length * 42) }}>
              {ps.map((p, n) => (<button className="goals-timeline-bar" key={p.id} onClick={() => navigate("/goals/" + g.id)} title={`${p.title}: ${formatDate(p.startsOn)} — ${formatDate(p.endsOn)}`} style={{
                        left: ((Date.parse(p.startsOn + "T00:00:00Z") - start) / span) *
                            100 +
                            "%",
                        width: ((Date.parse(p.endsOn + "T00:00:00Z") +
                            86400000 -
                            Date.parse(p.startsOn + "T00:00:00Z")) /
                            span) *
                            100 +
                            "%",
                        top: 8 + n * 42,
                    }}>
                  {p.title}
                </button>))}
            </div>
          </div>);
        })}
    </div>);
}
function Goals({ context: c }: {
    context: FeatureContext;
}) {
    const t = useGoalText();
    const HEALTH = BASE_HEALTH.map(([key, label]) => [key, t(label)]), LIFE = BASE_LIFE.map(([key, label]) => [key, t(label)]), SOURCES = BASE_SOURCES.map(([key, label]) => [key, t(label)]);
    const { formatDate, formatInstant, formatNumber } = useLocalization();
    const guest = c.bootstrap.membership.memberType === "GUEST";
    const [sharedKeyResults, setSharedKeyResults] = useState<Goal[]>([]), [selectedKeyResult, setSelectedKeyResult] = useState<Goal | null>(null);
    const [goals, setGoals] = useState<Goal[]>([]), [periods, setPeriods] = useState<Period[]>([]), [selected, setSelected] = useState<Goal | null>(null), [history, setHistory] = useState<Goal[]>([]), [stats, setStats] = useState<Goal | null>(null), [caps, setCaps] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true), [error, setError] = useState(""), [tick, setTick] = useState(0), [busy, setBusy] = useState(false), [view, setView] = useState("hierarchy"), [filters, setFilters] = useState(false), [search, setSearch] = useState(""), [period, setPeriod] = useState(""), [health, setHealth] = useState(""), [lifecycle, setLifecycle] = useState("");
    const [category, setCategory] = useState(""), [ownerId, setOwnerId] = useState("");
    const [modal, setModal] = useState(""), [draft, setDraft] = useState<Goal>({});
    const modalExit=useRef<(next?:()=>void)=>void>(()=>{});
    const modalState=useRef({dirty:false,busy:false});
    useEffect(()=>{modalState.current.dirty=false;},[modal]);
    const [versionConflict, setVersionConflict] = useState(false);
    useEffect(() => { setVersionConflict(false); }, [modal]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [statisticsWindow, setStatisticsWindow] = useState("CURRENT_MONTH");
    const [linkOptions, setLinkOptions] = useState<Goal[]>([]);
    useEffect(() => {
        if (modal !== "links")
            return;
        const ctrl = new AbortController();
        setLinkOptions([]);
        Promise.all([
            c.api<any>("/organizations/" + c.organizationId + "/work/tasks", {
                signal: ctrl.signal,
            }),
            c.api<any>("/organizations/" + c.organizationId + "/work/projects", {
                signal: ctrl.signal,
            }),
        ])
            .then(([tasks, projects]) => {
            if (!ctrl.signal.aborted)
                setLinkOptions([
                    ...(tasks.data.tasks ?? []).map((t: Goal) => ({
                        id: t.id,
                        title: t.title,
                        kind: "TASK",
                    })),
                    ...(projects.data.projects ?? []).map((p: Goal) => ({
                        id: p.id,
                        title: p.title,
                        kind: "PROJECT",
                    })),
                ]);
        })
            .catch((e) => {
            if (!ctrl.signal.aborted)
                setError(errorMessage(e));
        });
        return () => ctrl.abort();
    }, [modal, c.organizationId]);
    const base = "/organizations/" + c.organizationId, settings = c.path.startsWith("/goals/settings"), statistics = c.path.startsWith("/goals/statistics");
    const selectedKeyResultId = /^\/goals\/key-results\/([0-9a-f-]{36})/.exec(c.path)?.[1];
    const restricted = guest && (settings || statistics);
    const selectedId = /^\/goals\/([0-9a-f-]{36})/.exec(c.path)?.[1];
    const loadedSurface = useRef("");
    const [refreshing, setRefreshing] = useState(false);
    const [directUnavailable, setDirectUnavailable] = useState(false);
    const surface = `${c.organizationId}:${c.path}:${tick}`;
    useEffect(() => {
        const ctrl = new AbortController();
        const changedSurface = loadedSurface.current !== surface;
        loadedSurface.current = surface;
        setLoading(changedSurface);
        setRefreshing(true);
        setError("");
        setDirectUnavailable(false);
        if (changedSurface) {
            setSelected(null);
            setSelectedKeyResult(null);
            setSharedKeyResults([]);
            setGoals([]);
            setPeriods([]);
            setHistory([]);
            setStats(null);
        }
        const query = new URLSearchParams();
        if (search)
            query.set("search", search);
        if (period)
            query.set("periodId", period);
        if (health)
            query.set("health", health);
        if (lifecycle)
            query.set("lifecycle", lifecycle);
        if (category) query.set("category", category);
        if (ownerId && !guest) query.set("ownerId", ownerId);
        async function allGoals() {
            let cursor: string | null = null;
            let result: any = null;
            const items: Goal[] = [];
            do {
                const params = new URLSearchParams(query);
                params.set("limit", "100");
                if (cursor)
                    params.set("cursor", cursor);
                const response = await c.api<any>(base + "/goals?" + params, {
                    signal: ctrl.signal,
                });
                result = response;
                items.push(...response.data.items);
                cursor = response.data.page.nextCursor;
            } while (cursor && !ctrl.signal.aborted);
            return { ...result, data: { ...result.data, items } };
        }
        async function loadSurface() {
            // Classify only the direct resource read; a list, history or period
            // failure must remain a recoverable error, not an unavailable link.
            let direct: { data: Goal } | null = null;
            if (selectedId || selectedKeyResultId) {
                try {
                    direct = await c.api<Goal>(base + (selectedId ? "/goals/" + selectedId : "/goals/key-results/" + selectedKeyResultId), { signal: ctrl.signal });
                } catch (e) {
                    if (!ctrl.signal.aborted && e instanceof RequestError && ["RESOURCE_NOT_FOUND", "ACTION_DENIED"].includes(e.code)) {
                        setSelected(null);
                        setSelectedKeyResult(null);
                        setDirectUnavailable(true);
                        return;
                    }
                    throw e;
                }
            }
            if (ctrl.signal.aborted) return;
            const [list, p, s, h] = await Promise.all([
            allGoals(),
            c.api<any>(base + "/goal-periods", { signal: ctrl.signal }),
            statistics && !restricted
                ? c.api<Goal>(base + "/goals/statistics?window=" + statisticsWindow + (period ? "&periodId=" + period : ""), { signal: ctrl.signal })
                : Promise.resolve(null),
            selectedId && !guest
                ? c.api<any>(base + "/goals/" + selectedId + "/history", {
                    signal: ctrl.signal,
                })
                : Promise.resolve(null),
            ]);
            if (ctrl.signal.aborted)
                return;
            setGoals(list.data.items);
            setSharedKeyResults(list.data.sharedKeyResults ?? []);
            setSelectedKeyResult(selectedKeyResultId ? direct?.data ?? null : null);
            setCaps(list.data.capabilities);
            setPeriods(p.data.items);
            setSelected(selectedId ? direct?.data ?? null : null);
            setStats(s?.data ?? null);
            setHistory(h?.data.items ?? []);
        }
        void loadSurface()
            .catch((e) => {
            if (!ctrl.signal.aborted)
                setError(errorMessage(e));
        })
            .finally(() => {
            if (!ctrl.signal.aborted) {
                setLoading(false);
                setRefreshing(false);
            }
        });
        return () => ctrl.abort();
    }, [c.organizationId, c.path, search, period, health, lifecycle, tick, statisticsWindow, guest, category, ownerId]);
    async function save(path: string, body: unknown, version?: number, method = "POST") {
        if (versionConflict) return null;
        setBusy(true);
        setError("");
        try {
            const r = await c.api<Goal>(base + path, { method, body, version });
            modalState.current={dirty:false,busy:false};
            setModal("");
            setTick((t) => t + 1);
            c.notify(t("Altera\u00E7\u00E3o salva."));
            return r.data;
        }
        catch (e) {
            if (modal && e instanceof RequestError && e.code === "VERSION_CONFLICT") {
                setVersionConflict(true);
                setError("");
            } else setError(errorMessage(e));
            return null;
        }
        finally {
            setBusy(false);
        }
    }
    const labelOwner = (g: Goal) => !g.ownerId ? t("Identidade não compartilhada") : g.ownerType === "MEMBER"
        ? (c.members.find((m) => m.id === g.ownerId)?.displayName ?? t("Membro"))
        : (c.structure.nodes.find((n) => n.entityId === g.ownerId)?.name ?? t("Entidade"));
    function edit(g?: Goal) {
        setDraft(g
            ? {
                title: g.title,
                description: g.description,
                ...(g.descriptionRich ? { descriptionRich: g.descriptionRich } : {}),
                ownerType: g.ownerType,
                ownerId: g.ownerId,
                ownerViaRoleId: g.ownerViaRoleId,
                periodIds: g.periodIds,
                parentId: g.parentId,
                privacy: g.privacy,
                category: g.category,
                health: g.health,
            }
            : {
                title: "",
                description: "",
                ownerType: "MEMBER",
                ownerId: "",
                periodIds: [],
                parentId: null,
                privacy: "PUBLIC",
                category: "TEAM",
                health: "ON_TRACK",
            });
        setModal(g ? "edit" : "new");
    }
    const update = (key: string, value: any) => setDraft((d) => ({ ...d, [key]: value }));
    const activeOccupancies = (mid: string) => c.structure.occupancies.filter((o) => o.memberId === mid &&
        Date.parse(o.startsAt) <= Date.now() &&
        (!o.endsAt || Date.parse(o.endsAt) > Date.now()));
    const ownerOptions = [
        ...c.members
            .filter((m) => m.status === "ACTIVE")
            .map((m) => ["MEMBER:" + m.id, m.displayName]),
        ...c.structure.nodes.map((n) => [
            n.kind + ":" + n.entityId,
            n.name + " · " + (n.kind === "ROLE" ? t("Papel") : t("C\u00EDrculo")),
        ]),
    ];
    const filterOwners = [
        ...c.members.map(m => [m.id, m.displayName]),
        ...c.structure.nodes.map(n => [n.entityId, n.name + " · " + (n.kind === "ROLE" ? t("Papel") : t("Círculo"))]),
    ];
    const filtered = !!(search || period || health || lifecycle || category || (!guest && ownerId));
    const clearFilters = () => { setSearch(""); setPeriod(""); setHealth(""); setLifecycle(""); setCategory(""); setOwnerId(""); };
    const optionsGoals = goals
        .filter((g) => g.id !== selected?.id)
        .map((g) => [g.id, g.title]);
    const ownMember = c.bootstrap.membership.id;
    const visible = c.path.includes("mine=true")
        ? goals.filter((g) => g.ownerId === ownMember ||
            g.assignments.some((a: Goal) => a.memberId === ownMember))
        : goals;
    function openConfig() {
        if (!selected)
            return;
        setDraft({
            source: selected.source,
            manualProgress: selected.manualProgress,
            krWeight: selected.krWeight,
            childWeight: selected.childWeight,
            keyResults: selected.keyResults.map((k: Goal) => ({
                id: k.id,
                title: k.title,
                weight: k.weight,
                excluded: k.excluded,
            })),
            children: selected.children.map((k: Goal) => ({
                id: k.id,
                title: k.title,
                weight: k.weight,
                excluded: k.excluded,
            })),
        });
        setModal("config");
    }
    function openAssignments() {
        setDraft({
            assignments: selected?.assignments.map((a: Goal) => ({
                memberId: a.memberId,
                functionalRole: a.functionalRole,
                viaRoleId: a.viaRoleId,
                keyResultId: a.keyResultId,
            })) ?? [],
        });
        setModal("assign");
    }
    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (modal === "new" || modal === "edit") {
            const payload = { ...draft };
            if (modal === "edit" && !selected?.capabilities.configure)
                for (const k of [
                    "ownerType",
                    "ownerId",
                    "ownerViaRoleId",
                    "privacy",
                    "parentId",
                ])
                    delete payload[k];
            void save(modal === "new" ? "/goals" : "/goals/" + selected?.id, payload, modal === "edit" ? selected?.version : undefined, modal === "edit" ? "PATCH" : "POST").then((g) => {
                if (g)
                    c.navigate("/goals/" + g.id);
            });
        }
        else if (modal === "progress-goal")
            void save("/goals/" + selected?.id + "/progress", { value: draft.value, health: draft.health, comment: draft.comment }, selected?.version);
        else if (modal === "links")
            void save("/goals/" + selected?.id + "/key-results/" + draft.id + "/links", { links: draft.links }, draft.version);
        else if (modal === "period")
            void save("/goal-periods", draft);
        else if (modal === "period-edit")
            void save("/goal-periods/" + draft.id, {
                title: draft.title,
                startsOn: draft.startsOn,
                endsOn: draft.endsOn,
                archived: draft.archived,
            }, draft.version, "PATCH");
        else if (modal === "kr")
            void save("/goals/" + selected?.id + "/key-results", draft, selected?.version);
        else if (modal === "kr-edit")
            void save("/goals/" + selected?.id + "/key-results/" + draft.id, {
                title: draft.title,
                description: draft.description,
                ...(draft.descriptionRich ? { descriptionRich: draft.descriptionRich } : {}),
                targetValue: draft.targetValue,
                unit: draft.unit,
                health: draft.health,
                excluded: draft.excluded,
                archived: draft.archived,
            }, draft.version, "PATCH");
        else if (modal === "progress")
            void save("/goals/" + selected?.id + "/key-results/" + draft.id + "/progress", {
                value: ["MILESTONE", "BINARY"].includes(draft.resultType)
                    ? draft.value === "true"
                    : draft.value,
                health: draft.health,
                confidenceLevel: draft.confidenceLevel ?? null,
                comment: draft.comment,
            }, draft.version);
        else if (modal === "assign")
            void save("/goals/" + selected?.id + "/assignments", draft, selected?.version);
        else if (modal === "config")
            void save("/goals/" + selected?.id + "/progress-config", {
                ...draft,
                keyResults: draft.keyResults.map(({ title, ...r }: Goal) => r),
                children: draft.children.map(({ title, ...r }: Goal) => r),
            }, selected?.version);
    };
    const percent = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? formatNumber(Math.round(value)) + "%" : "—";
    function ownerAvatar(g: Goal): ReactNode {
        if (!g.ownerId) return null;
        if (g.ownerType === "MEMBER") {
            const name = c.members.find((m) => m.id === g.ownerId)?.displayName;
            return <span className="goals-avatar" aria-hidden="true">{name ? initials(name) : <Users size={12}/>}</span>;
        }
        const node = c.structure?.nodes.find((n) => n.entityId === g.ownerId);
        return <span className="goals-avatar entity" aria-hidden="true">{node?.kind === "CIRCLE" ? <CircleDot size={13}/> : <Circle size={13}/>}</span>;
    }
    function row(g: Goal, depth = 0): ReactNode {
        const keyResults = (g.keyResults ?? []).filter((k: Goal) => !k.archived);
        return (<div key={g.id} className="goals-tree-branch">
        <button className={"goals-row" + (depth ? " nested" : "")} style={{ "--goals-depth": Math.min(depth, 10) } as React.CSSProperties} onClick={() => c.navigate("/goals/" + g.id)}>
          <i className="goals-row-icon" aria-hidden="true"><Target size={18}/></i>
          <span className="goals-row-main">
            <strong>{g.title}</strong>
            <span className="goals-owner">{ownerAvatar(g)}<span>{labelOwner(g)}</span></span>
            {keyResults.length > 0 && <span className="goals-row-krs">
              {keyResults.slice(0, 3).map((k: Goal) => <span className="goals-row-kr" key={k.id}><ProgressBar value={k.progress?.display}/><span>{k.title}</span><b>{percent(k.progress?.display)}</b></span>)}
              {keyResults.length > 3 && <span className="goals-row-kr-more">+{formatNumber(keyResults.length - 3)}</span>}
            </span>}
          </span>
          <span className="goals-progress">
            <span className="goals-progress-value">
              {g.progress.display === null
                ? <span className="mare-empty-value">{t("Sem progresso conhecido")}</span> : <b>{Math.round(g.progress.display) + "%"}</b>}
              <HealthBadge health={g.health} label={HEALTH.find((h) => h[0] === g.health)?.[1]}/>
            </span>
            <ProgressBar value={g.progress.display}/>
          </span>
        </button>
        {view === "hierarchy" &&
                visible
                    .filter((ch) => ch.parentId === g.id)
                    .map((ch) => row(ch, depth + 1))}
      </div>);
    }
    // Effects run after render; hide the previous organization or route immediately.
    if (loadedSurface.current !== surface) return <section className="goals-root" aria-busy="true"><div className="loading-screen" role="status">{t("Carregando objetivos…")}</div></section>;
    return (<section className="goals-root" aria-busy={refreshing}>
      {refreshing && !loading && <p role="status" className="goals-refresh-status">{t("Atualizando resultados\u2026")}</p>}
      {!selectedId&&!selectedKeyResultId&&!selected&&!selectedKeyResult&&<div className="page-heading">
        <h2>
          {settings
            ? t("Per\u00EDodos") : statistics
            ? t("Estat\u00EDsticas") : t("Todos os objetivos")}
        </h2>
        {!settings && !statistics && caps.create && (<button className="primary" onClick={() => edit()}>
            <Plus size={16}/>{t("Adicionar objetivo")}</button>)}
        {settings && caps.periodManage && (<button className="primary" onClick={() => {
                setDraft({ title: "", startsOn: "", frequency: 1, calendarUnit: "MONTH" });
                setModal("period");
            }}>
            <Plus size={16}/>{t("Adicionar per\u00EDodo")}</button>)}
      </div>}
      {error && (<div className="notice" role="alert">
          {error}
          <button onClick={() => setTick((t) => t + 1)}>{t("Tentar novamente")}</button>
        </div>)}
      {loading ? (<div className="mare-loading" role="status" aria-label={t("Carregando objetivos\u2026")}><i/><i/><i/><i/><i/></div>) : directUnavailable ? <div className="empty-state"><h2>{t("Este objetivo ou resultado-chave não está disponível.")}</h2><button onClick={() => c.navigate("/goals")}>{t("Todos os objetivos")}</button></div> : (selectedId || selectedKeyResultId) && error && !selected && !selectedKeyResult ? null : restricted ? <div className="notice" role="status"><p>{t("Esta área não está disponível para seu acesso.")}</p><button onClick={() => c.navigate("/goals")}>{t("Todos os objetivos")}</button></div> : selectedKeyResult ? <div className="goals-detail">
          <button className="goals-back" onClick={() => c.navigate("/goals")}><ChevronLeft size={16} aria-hidden="true"/>{t("Todos os objetivos")}</button>
          <h1>{selectedKeyResult.title}</h1>
          <RichText value={selectedKeyResult.descriptionRich ?? selectedKeyResult.description}/>
          <p>{selectedKeyResult.currentValue} / {selectedKeyResult.targetValue} {selectedKeyResult.unit} · {formatNumber(selectedKeyResult.progress.display)}%</p>
          <progress max="100" value={selectedKeyResult.progress.display} aria-label={t("Resultados-chave")}/>
        </div> : settings ? (<div className="goals-settings">
          <p>{t("Os per\u00EDodos s\u00E3o definidos para toda a organiza\u00E7\u00E3o pelos administradores.")}</p>
          {!periods.length && <p>{t("Nenhum per\u00EDodo definido.")}</p>}
          {periods.map((p) => (<div className="entity-row goals-period-row" key={p.id}>
              <strong>{p.title}</strong>
              <span className="goals-period-dates">
                <time dateTime={p.startsOn}>{formatDate(p.startsOn)}</time> — <time dateTime={p.endsOn}>{formatDate(p.endsOn)}</time>
              </span>
              {p.archived && <span>{t("Arquivado")}</span>}
              {caps.periodManage && (<button onClick={() => {
                        setDraft(p);
                        setModal("period-edit");
                    }}>{t("Editar")}</button>)}
            </div>))}
        </div>) : statistics ? (<div className="goals-settings goals-statistics">
          <div className="goals-stat-heading"><div><h3>{t("Estat\u00EDsticas de objetivos")}</h3>
          <p>{t("Acompanhe os objetivos e resultados-chave acess\u00EDveis no per\u00EDodo selecionado.")}</p></div>
          <div className="goals-stat-controls"><Field label="Janela"><Select value={statisticsWindow} onChange={setStatisticsWindow} options={[["CURRENT_MONTH", t("M\u00EAs atual")], ["ALL", t("Todo o calend\u00E1rio")]]}/></Field><Field label="Período">
            <Select value={period} onChange={setPeriod} options={periods.map((p) => [p.id, p.title])} empty={t("Todos os per\u00EDodos")}/>
          </Field>
          </div>
          </div>
          {stats && (<>
              <dl className="goals-stat-summary">
                <div><dt>{t("Total de objetivos")}<Flag size={14} aria-hidden="true"/></dt><dd>{stats.denominator}</dd></div>
                <div><dt>{t("Total de resultados-chave")}<CircleCheck size={14} aria-hidden="true"/></dt><dd>{stats.keyResultCount}</dd></div>
                <div><dt>{t("Taxa de conclus\u00E3o")}<CircleCheck size={14} aria-hidden="true"/></dt><dd>{stats.completion.percent === null ? "—" : Math.round(stats.completion.percent) + "%"}</dd></div>
                <div><dt>{t("Respons\u00E1veis ativos")}<Users size={14} aria-hidden="true"/></dt><dd>{stats.activeOwners.percent === null ? "—" : Math.round(stats.activeOwners.percent) + "%"}</dd></div>
              </dl>
              <p>{t("Progresso m\u00E9dio:")}{" "}
                {stats.averageProgress === null
                    ? t("Desconhecido") : Math.round(stats.averageProgress) + "%"}{" "}
                ({t("{count} com progresso conhecido", { count: formatNumber(stats.knownProgressDenominator) })})
              </p>
              <div className="goals-stat-panels"><section><h3><Flag size={16} aria-hidden="true"/>{t("Objetivos por estado")}</h3><p>{t("Distribui\u00E7\u00E3o por estado; os n\u00FAmeros indicam quantidades de objetivos.")}</p><div className="goals-stat-chart" aria-label={t("Objetivos por estado")}>
                {LIFE.map(([k, v]) => (<div key={k}>
                    <span>{v}</span>
                    <meter aria-label={t("Estado {state}: {count} de {total} objetivos", { state: v, count: formatNumber(stats.lifecycle[k]), total: formatNumber(stats.denominator) })} min="0" max={stats.denominator || 1} value={stats.lifecycle[k]}/>
                    <strong>{stats.lifecycle[k]}</strong>
                  </div>))}
              </div></section><section><h3><Heart size={16} aria-hidden="true"/>{t("Sa\u00FAde dos objetivos")}</h3><p>{t("Distribui\u00E7\u00E3o por sa\u00FAde; os n\u00FAmeros indicam quantidades de objetivos.")}</p><div className="goals-stat-chart" aria-label={t("Objetivos por sa\u00FAde")}>
                {[...HEALTH, ["UNKNOWN", t("N\u00E3o informada")]].map(([k, v]) => <div key={k}><span>{v}</span><meter aria-label={t("Saúde {health}: {count} de {total} objetivos", { health: v, count: formatNumber(stats.health[k] ?? 0), total: formatNumber(stats.denominator) })} min="0" max={stats.denominator || 1} value={stats.health[k] ?? 0}/><strong>{stats.health[k] ?? 0}</strong></div>)}
              </div></section></div>
              <details><summary>{t("Como os indicadores são calculados")}</summary><p>{t("Conclusão: {closed} objetivos fechados entre {current} não arquivados. Responsáveis ativos: {activeOwners} proprietários distintos com objetivos ativos entre {owners} proprietários de objetivos não arquivados. Pessoa, papel e círculo são tipos distintos de proprietário; a atribuição via papel também distingue o proprietário. Resultados-chave arquivados não entram no total. Sem denominador, a taxa não é calculada.", { closed: formatNumber(stats.completion.numerator), current: formatNumber(stats.completion.denominator), activeOwners: formatNumber(stats.activeOwners.numerator), owners: formatNumber(stats.activeOwners.denominator) })}</p><p>{t("Definição: {version}. Os indicadores consideram somente os objetivos que você pode acessar; não representam totais ocultos da organização.", { version: stats.metricDefinitionVersion })}</p></details>
              <p>{t("Dados da organização em {zone}. Atualizado em {time}. Cada objetivo conta uma vez, mesmo em vários períodos.", { zone: stats.zone, time: formatInstant(stats.asOf) })}
                {stats.window.kind === "CURRENT_MONTH" && <> {t("Janela civil: {start} a {end}. Inclui objetivos com pelo menos um período que cruza esse intervalo; não é um histórico de mudanças ocorridas no mês.", { start: formatDate(stats.window.startsOn), end: formatDate(stats.window.endsOn) })}</>}
              </p>
            </>)}
        </div>) : selected ? (<div className="goals-detail">
          <button className="goals-back" onClick={() => c.navigate("/goals")}><ChevronLeft size={16} aria-hidden="true"/>{t("Todos os objetivos")}</button>
          <TraceReturnLink context={c} returnTo={new URLSearchParams(c.path.split("?")[1] ?? "").get("returnTo")} disabled={busy} />
          <TraceOrigin context={c} endpoint={`/organizations/${c.organizationId}/goals/${selected.id}/origin`} returnTo={`/goals/${selected.id}`} disabled={busy} />
          <div className="goals-detail-title">
            <i className="goals-row-icon" aria-hidden="true"><Target size={22}/></i>
            <h1>{selected.title}</h1>
          </div>
          <div className="goals-description"><RichText value={selected.descriptionRich ?? (selected.description || t("Sem descri\u00E7\u00E3o"))}/></div>
          <div className="goals-meta">
            <span className="goals-owner">{ownerAvatar(selected)}<span>{t("Proprietário: {owner}", { owner: labelOwner(selected) })}</span></span>
            <span className="goals-chip">{LIFE.find((l) => l[0] === selected.lifecycle)?.[1]}</span>
            <HealthBadge health={selected.health} label={HEALTH.find((l) => l[0] === selected.health)?.[1]}/>
            <span className="goals-chip">
              {selected.privacy === "PRIVATE" ? <Lock size={14} aria-hidden="true"/> : <Globe size={14} aria-hidden="true"/>}
              {selected.privacy === "PRIVATE"
                ? t("Privado") : t("P\u00FAblico na organiza\u00E7\u00E3o")}
            </span>
          </div>
          <div className="goals-actions">
            {selected.capabilities.update && (<button onClick={() => edit(selected)}>{t("Editar objetivo")}</button>)}
            {selected.capabilities.configure && (<button onClick={openConfig}>{t("Configurar progresso")}</button>)}
            {selected.capabilities.assign && (<button onClick={openAssignments}>{t("Atribui\u00E7\u00F5es")}</button>)}
            {selected.capabilities.transition && <details className="goals-state-actions mare-disclosure"><summary>{t("Estado")}</summary><div>
                {LIFE.filter(([s]) => s !== selected.lifecycle).map(([s, v]) => (<button disabled={busy} key={s} onClick={() => void save("/goals/" + selected.id + "/lifecycle", { lifecycle: s }, selected.version)}>
                  {s === "ACTIVE"
                        ? t("Reabrir") : s === "DRAFT"
                        ? t("Mover para rascunho") : s === "CLOSED" ? t("Fechar") : t("Arquivar")}
                </button>))}</div></details>}
          </div>
          <section className="goals-section goals-overall">
          <div className="goals-section-head">
          <h3>{t("Progresso geral")}</h3>
          {selected.capabilities.update && selected.source === "MANUAL" && (<button onClick={() => {
                    setDraft({
                        value: selected.manualProgress,
                        health: selected.health,
                        comment: "",
                    });
                    setModal("progress-goal");
                }}>{t("Atualizar progresso geral")}</button>)}
          </div>
          <p className="goals-overall-value">
            {selected.progress.display === null
                ? <span className="mare-empty-value">{t("Progresso desconhecido: nenhuma contribui\u00E7\u00E3o conhecida suficiente.")}</span> : <b>{Math.round(selected.progress.display) + "%"}</b>}{" "}
            <span>· {SOURCES.find((s) => s[0] === selected.source)?.[1]}</span>
          </p>
          <progress value={selected.progress.display ?? undefined} max="100" aria-label={t("Progresso geral")}/>
          <ProgressExplanation goal={selected}/>
          </section>
          <section className="goals-section">
          <div className="goals-section-head">
          <h3>{t("Resultados-chave")}</h3>
          {selected.capabilities.update && (<button onClick={() => {
                    setDraft({
                        title: "",
                        description: "",
                        resultType: "QUANTITATIVE",
                        initialValue: "0",
                        targetValue: "100",
                        unit: "",
                        health: "ON_TRACK",
                        excluded: false,
                    });
                    setModal("kr");
                }}>
              <Plus size={16}/>{t("Adicionar resultado-chave")}</button>)}
          </div>
          {!selected.keyResults.length && (<p className="muted goals-empty-line">{guest ? t("Nenhum resultado-chave compartilhado com você.") : t("Nenhum resultado-chave ainda.")}</p>)}
          {selected.keyResults.length > 0 && <div className="goals-kr-list">
          {selected.keyResults.map((k: Goal) => (<div className={"goals-kr" + (k.archived ? " archived" : "")} key={k.id}>
              <div className="goals-kr-body">
                <div className="goals-kr-title"><strong>{k.title}</strong><HealthBadge health={k.health} label={HEALTH.find((l) => l[0] === k.health)?.[1]}/></div>
                {(k.descriptionRich || k.description) && <RichText value={k.descriptionRich ?? k.description}/>}
                <div className="goals-kr-progress"><ProgressBar value={k.progress?.display}/><b>{percent(k.progress?.display)}</b></div>
                <p>
                  {k.currentValue} / {k.targetValue} {k.unit}{" "}
                  {k.archived ? "· " + t("Arquivado") : ""}
                  {" · " + t("Confiança") + ": " + t(k.confidenceLevel === "HIGH" ? "Alta" : k.confidenceLevel === "MEDIUM" ? "Média" : k.confidenceLevel === "LOW" ? "Baixa" : "Não informada")}
                </p>
                <details className="goals-calculation mare-disclosure quiet"><summary>{t("Cálculo do resultado-chave")}</summary>
                  <p>{t("({current} − {initial}) ÷ ({target} − {initial}) × 100",{current:k.currentValue,initial:k.initialValue,target:k.targetValue})}</p>
                  <p>{t("A exibição fica entre 0% e 100%. Saúde e confiança não alteram o cálculo.")}</p>
                </details>
              </div>
              {k.links?.length > 0 && <div className="goals-links">
                {k.links?.map((link: Goal) => (<button key={link.kind + link.id} onClick={() => c.navigate(link.kind === "TASK"
                        ? "/projects/tasks/" + link.id
                        : "/projects/" + link.id)}>
                    {link.titleSource === "FALLBACK" ? t(link.kind === "TASK" ? "Tarefa vinculada" : "Projeto vinculado") : <>{t(link.kind === "TASK" ? "Tarefa" : "Projeto")} · {link.title}</>}
                  </button>))}
              </div>}
              {selected.capabilities.update && <div className="goals-kr-actions">
              {selected.capabilities.update && (<button disabled={!selected.capabilities.link} title={!selected.capabilities.link
                        ? t("A integra\u00E7\u00E3o com Trabalho precisa ser registrada no servidor.") : undefined} onClick={() => {
                        setDraft({
                            id: k.id,
                            version: k.version,
                            links: (k.links ?? []).map((l: Goal) => ({
                                kind: l.kind,
                                id: l.id,
                            })),
                        });
                        setModal("links");
                    }}>{t("V\u00EDnculos")}</button>)}
              {selected.capabilities.update && (<>
                  <button onClick={() => {
                        setDraft(k);
                        setModal("kr-edit");
                    }}>{t("Editar")}</button>
                  {!k.archived && (<button onClick={() => {
                            setDraft({
                                ...k,
                                value: ["MILESTONE", "BINARY"].includes(k.resultType)
                                    ? String(k.currentValue === (k.resultType === "BINARY" ? "1" : "100"))
                                    : k.currentValue,
                                comment: "",
                            });
                            setModal("progress");
                        }}>{t("Atualizar progresso")}</button>)}
                </>)}
              </div>}
            </div>))}
          </div>}
          </section>
          <section className="goals-section">
          <h3>{t("Objetivos filhos")}</h3>
          {selected.children.length ? <div className="goals-list goals-children">{selected.children.map((g: Goal) => row(g))}</div> : <p className="muted goals-empty-line">{t("Nenhum objetivo filho.")}</p>}
          </section>
          {selected.capabilities.history !== false && <section className="goals-section">
          <h3>{t("Atividade")}</h3>
          {!history.length && <p className="muted goals-empty-line">{t("Nenhuma atividade registrada.")}</p>}
          {history.length > 0 && <div className="goals-activity">
          {history.map((h) => (<div className="audit-row" key={h.id}>
              <span>
                {t(ACTIVITY[h.action] ?? "Objetivo alterado")}
                {h.comment && <p>{h.comment}</p>}
                {h.progressUpdate && <p>{h.progressUpdate.previousValue} → {h.progressUpdate.value}{" · " + t("Confiança") + ": " + t(h.progressUpdate.confidenceLevel === "HIGH" ? "Alta" : h.progressUpdate.confidenceLevel === "MEDIUM" ? "Média" : h.progressUpdate.confidenceLevel === "LOW" ? "Baixa" : "Não informada")}</p>}
              </span>
              <time dateTime={h.at}>{formatInstant(h.at)}</time>
            </div>))}
          </div>}
          </section>}
        </div>) : (<>
          <div className="collection-toolbar goals-toolbar">
            <div className="goals-views" role="group" aria-label={t("Exibição")}>
              {[
                ["list", t("Lista"), List],
                ["timeline", t("Linha do tempo"), GanttChart],
                ["hierarchy", t("Hierarquia"), GitBranch],
            ].map(([key, label, Icon]: any) => (<button key={key} aria-label={label} title={label} aria-pressed={view === key} className={view === key ? "active" : ""} onClick={() => setView(key)}>
                  <Icon size={16}/>
                  <span className="goals-view-label">{label}</span>
                </button>))}
            </div>
            <span className="goals-count">
              {t(visible.length === 1 ? "goalCountOne" : "goalCountOther", { count: formatNumber(visible.length) })}
            </span>
            <div className="toolbar-spacer"/>
            <button className="goals-filter-toggle" aria-label={t("Filtrar")} aria-expanded={filters} onClick={() => setFilters((v) => !v)}>
              <Filter size={16}/>
              <span className="goals-filter-label">{t("Filtrar")}</span>
            </button>
            <button className="goals-search-toggle" aria-label={t("Pesquisar objetivos")} aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
              <Search size={16}/>
            </button>
            {searchOpen && (<label className="goals-search">
                <Search size={16}/>
                <input aria-label={t("Pesquisar objetivos")} autoFocus placeholder={t("Pesquisar objetivos\u2026")} value={search} onChange={(e) => setSearch(e.target.value)}/>
              </label>)}
          </div>
          {filters && (<div className="goals-filters" onKeyDown={(e) => {
                    if (e.key === "Escape")
                        setFilters(false);
                }}>
              <div className="goals-filter-head">
                <strong>{t("Filtrar")}</strong>
                <button aria-label={t("Fechar filtros")} onClick={() => setFilters(false)}>
                  <X size={16}/>
                </button>
              </div>
              <Field label="Estado">
                <Select value={lifecycle} onChange={setLifecycle} options={LIFE} empty={t("Todos")}/>
              </Field>
              <Field label="Saúde">
                <Select value={health} onChange={setHealth} options={HEALTH} empty={t("Todas")}/>
              </Field>
              <Field label="Período">
                <Select value={period} onChange={setPeriod} options={periods.map((p) => [p.id, p.title])} empty={t("Todos")}/>
              </Field>
              <Field label="Categoria">
                <Select value={category} onChange={setCategory} options={[["TEAM",t("Equipe")],["COMPANY",t("Organização")],["INDIVIDUAL",t("Individual")]]} empty={t("Todas")}/>
              </Field>
              {!guest && <Field label="Proprietário">
                <Select value={ownerId} onChange={setOwnerId} options={filterOwners} empty={t("Todos")}/>
              </Field>}
              <button onClick={clearFilters}>{t("Limpar filtros")}</button>
            </div>)}
          {guest && sharedKeyResults.length > 0 && <div className="goals-list"><h3>{t("Resultados-chave compartilhados")}</h3>{sharedKeyResults.map(k => <button className="goals-row" key={k.id} onClick={() => c.navigate("/goals/key-results/" + k.id)}><Target size={17}/><span><strong>{k.title}</strong><small>{k.currentValue} / {k.targetValue} {k.unit}</small></span></button>)}</div>}
          {!visible.length && guest && sharedKeyResults.length ? <p>{t("Nenhum objetivo compartilhado com você.")}</p> : !visible.length ? (<div className="goals-empty">
              <span className="goals-empty-icon" aria-hidden="true">
                <Target size={28} strokeWidth={1.65} />
              </span>
              <div className="goals-empty-copy">
                <h3>
                  {goals.length || filtered
                    ? t("Nenhum objetivo neste filtro") : t("Nenhum objetivo ainda")}
                </h3>
                <p>
                  {filtered
                    ? t("Nenhum objetivo corresponde \u00E0 sele\u00E7\u00E3o. Ajuste ou limpe os filtros para ver outros objetivos.") : guest ? t("Os objetivos compartilhados com você aparecem aqui.") : t("Defina objetivos para acompanhar o que \u00E9 mais importante para sua organiza\u00E7\u00E3o.")}
                </p>
              </div>
              {filtered ? <button onClick={clearFilters}>{t("Limpar filtros")}</button> : caps.create && (<button onClick={() => edit()}>
                  <Plus size={16}/>{t("Adicionar objetivo")}</button>)}
            </div>) : view === "timeline" ? (<Timeline items={visible} periods={periods} navigate={c.navigate}/>) : (<div className="goals-list">
              {(view === "hierarchy"
                    ? visible.filter((g) => !g.parentId || !visible.some((p) => p.id === g.parentId))
                    : visible).map((g) => row(g))}
            </div>)}
        </>)}
      {modal && (<Modal title={{
                new: t("Adicionar objetivo"),
                edit: t("Editar objetivo"),
                period: t("Adicionar per\u00EDodo"),
                "period-edit": t("Editar per\u00EDodo"),
                kr: t("Adicionar resultado-chave"),
                "kr-edit": t("Editar resultado-chave"),
                progress: t("Atualizar progresso"),
                "progress-goal": t("Atualizar progresso geral"),
                links: t("V\u00EDnculos"),
                config: t("Configurar progresso"),
                assign: t("Atribui\u00E7\u00F5es"),
            }[modal] ?? ""} key={modal} context={c} busy={busy} requestExit={modalExit} state={modalState} close={() => !busy && setModal("")}>
          <form className="edit-form" onSubmit={submit}><div className="goals-form-fields">
            {versionConflict && <div className="notice" role="alert">
                <p>{t("Este registro mudou. Seu rascunho continua no formulário e não foi salvo. Atualize os dados sem fechar; copie o que deseja manter, feche e reabra o formulário para revisar a versão atual.")}</p>
                <button type="button" disabled={refreshing} onClick={() => setTick(v => v + 1)}>{t("Atualizar dados sem fechar")}</button>
              </div>}
            {error && (<div className="notice" role="alert">
                {error}
              </div>)}
            {(modal === "new" || modal === "edit") && (<>
                <Field label="Título obrigatório">
                  <input autoFocus required placeholder={t("Adicionar t\u00EDtulo")} maxLength={200} value={draft.title} onChange={(e) => update("title", e.target.value)}/>
                </Field>
                <Field label="Objetivo pai">
                  <Select value={draft.parentId ?? ""} onChange={(v) => update("parentId", v || null)} options={optionsGoals} empty={t("Sem objetivo pai")}/>
                </Field>
                  <RichEditor placeholder={t("Clique para adicionar uma descri\u00E7\u00E3o\u2026")} value={draft.descriptionRich ?? draft.description ?? ""} onChange={(value) => update("descriptionRich", value)} pending={busy} error={error || undefined}/>
                <Field label="Proprietário obrigatório">
                  <select required value={draft.ownerId ? draft.ownerType + ":" + draft.ownerId : ""} onChange={(e) => {
                    const [ownerType, ownerId] = e.target.value.split(":");
                    update("ownerType", ownerType);
                    update("ownerId", ownerId);
                    update("ownerViaRoleId", null);
                }}>
                    <option value="">{t("Selecionar propriet\u00E1rio")}</option>
                    {ownerOptions.map(([id, name]) => (<option key={id} value={id}>
                        {name}
                      </option>))}
                  </select>
                </Field>
                {draft.ownerType === "MEMBER" &&
                    activeOccupancies(draft.ownerId).length > 0 && (<Field label="Por meio do papel">
                      <Select value={draft.ownerViaRoleId ?? ""} onChange={(v) => update("ownerViaRoleId", v || null)} options={activeOccupancies(draft.ownerId).map((o) => [
                        o.roleId!,
                        c.structure.nodes.find((n) => n.entityId === o.roleId)
                            ?.name ?? t("Papel"),
                    ])} empty={t("Atribui\u00E7\u00E3o pessoal")}/>
                    </Field>)}
                <div className="goals-form-grid">
                  <div className="goals-form-pair">
                    <Field label="Períodos obrigatórios">
                      <PeriodPicker periods={periods.filter((p) => !p.archived)} value={draft.periodIds} onChange={(v) => update("periodIds", v)}/>
                      <small className="goals-period-help">{t("Os per\u00EDodos s\u00E3o definidos para toda a organiza\u00E7\u00E3o pelos administradores.")}{" "}
                        {caps.periodManage&&<button type="button" onClick={() => modalExit.current(() => {
                    setModal("");
                    c.navigate("/goals/settings");
                })}>{t("Gerenciar per\u00EDodos")}</button>}
                      </small>
                    </Field>
                    <Field label="Categoria">
                      <Select value={draft.category} onChange={(v) => update("category", v)} options={[
                    ["TEAM", t("Equipe")],
                    ["COMPANY", t("Organiza\u00E7\u00E3o")],
                    ["INDIVIDUAL", t("Individual")],
                ]}/>
                    </Field>
                  </div>
                  <div className="goals-form-pair">
                    <Field label="Visibilidade">
                      <Select value={draft.privacy} onChange={(v) => update("privacy", v)} options={[
                    ["PUBLIC", t("P\u00FAblico na organiza\u00E7\u00E3o")],
                    ["PRIVATE", t("Privado")],
                ]}/>
                    </Field>
                    <Field label="Saúde">
                      <Select value={draft.health} onChange={(v) => update("health", v)} options={HEALTH}/>
                    </Field>
                  </div>
                </div>
              </>)}
            {(modal === "period" || modal === "period-edit") && (<>
                <Field label="Título">
                  <input required value={draft.title} onChange={(e) => update("title", e.target.value)}/>
                </Field>
                <Field label="Início">
                  <input required type="date" value={draft.startsOn} onChange={(e) => update("startsOn", e.target.value)}/>
                </Field>
                {modal === "period" ? <><Field label="Frequência obrigatória"><input type="number" required min="1" max="120" step="1" value={draft.frequency} onChange={e => update("frequency", Number(e.target.value))}/></Field><Field label="Período obrigatório"><Select value="MONTH" onChange={() => { }} options={[["MONTH", t("M\u00EAs")]]}/></Field><p>{t("O fim \u00E9 calculado como in\u00EDcio mais a frequ\u00EAncia em meses, menos um dia. Se o m\u00EAs de destino n\u00E3o tiver o dia inicial, usamos seu \u00FAltimo dia antes de subtrair um dia. A edi\u00E7\u00E3o posterior usa as datas do intervalo.")}</p></> : <Field label="Fim">
                  <input required type="date" min={draft.startsOn} value={draft.endsOn} onChange={(e) => update("endsOn", e.target.value)}/>
                </Field>}
                {modal === "period-edit" && (<label>
                    <input type="checkbox" checked={draft.archived} onChange={(e) => update("archived", e.target.checked)}/>{t("Arquivado")}</label>)}
              </>)}
            {(modal === "kr" || modal === "kr-edit") && (<>
                <Field label="Título">
                  <input required maxLength={200} value={draft.title} onChange={(e) => update("title", e.target.value)}/>
                </Field>
                  <RichEditor value={draft.descriptionRich ?? draft.description ?? ""} onChange={(value) => update("descriptionRich", value)} pending={busy} error={error || undefined}/>
                {modal === "kr" && (<Field label="Tipo">
                    <Select value={draft.resultType} onChange={(v) => update("resultType", v)} options={[
                        ["QUANTITATIVE", t("Quantitativo")],
                        ["PERCENTAGE", t("Percentual")],
                        ["MILESTONE", t("Marco")],
                        ["BINARY", t("Bin\u00E1rio")],
                        ["CUSTOM", t("Escala personalizada")],
                    ]}/>
                  </Field>)}
                {draft.resultType === "CUSTOM" && <p>{t("A escala personalizada usa valor inicial, meta e unidade definidos por voc\u00EA. O progresso \u00E9 linear entre in\u00EDcio e meta; tamb\u00E9m aceita metas decrescentes.")}</p>}
                {!["MILESTONE", "BINARY"].includes(draft.resultType) && (<>
                    {modal === "kr" && (<Field label="Valor inicial">
                        <input required inputMode="decimal" value={draft.initialValue} onChange={(e) => update("initialValue", e.target.value)}/>
                      </Field>)}
                    <Field label="Meta">
                      <input required inputMode="decimal" value={draft.targetValue} onChange={(e) => update("targetValue", e.target.value)}/>
                    </Field>
                    <Field label="Unidade">
                      <input maxLength={50} value={draft.unit} onChange={(e) => update("unit", e.target.value)}/>
                    </Field>
                  </>)}
                <Field label="Saúde">
                  <Select value={draft.health} onChange={(v) => update("health", v)} options={HEALTH}/>
                </Field>
                <label>
                  <input type="checkbox" checked={draft.excluded} onChange={(e) => update("excluded", e.target.checked)}/>{t("Excluir do c\u00E1lculo")}</label>
                {modal === "kr-edit" && (<label>
                    <input type="checkbox" checked={draft.archived} onChange={(e) => update("archived", e.target.checked)}/>{t("Arquivado")}</label>)}
              </>)}
            {(modal === "progress" || modal === "progress-goal") && (<>
                <p>{draft.title}</p>
                <Field label="Valor atual">
                  {["MILESTONE", "BINARY"].includes(draft.resultType) ? (<Select value={draft.value} onChange={(v) => update("value", v)} options={[
                        ["false", t("N\u00E3o conclu\u00EDdo")],
                        ["true", t("Conclu\u00EDdo")],
                    ]}/>) : (<input required inputMode="decimal" value={draft.value} onChange={(e) => update("value", e.target.value)}/>)}
                </Field>
                <Field label="Saúde">
                  <Select value={draft.health} onChange={(v) => update("health", v)} options={HEALTH}/>
                </Field>
                {modal === "progress" && <Field label="Confiança">
                  <Select value={draft.confidenceLevel ?? ""} onChange={(v) => update("confidenceLevel", v || null)} options={[["LOW", t("Baixa")], ["MEDIUM", t("Média")], ["HIGH", t("Alta")]]} empty={t("Não informada")}/>
                </Field>}
                <Field label="Comentário">
                  <textarea maxLength={1000} value={draft.comment} onChange={(e) => update("comment", e.target.value)}/>
                </Field>
              </>)}
            {modal === "links" && (<>
                <p>{t("Vincular um recurso n\u00E3o concede acesso a ele. A lista respeita suas permiss\u00F5es atuais.")}</p>
                {!linkOptions.length && (<p>{t("Nenhum recurso acess\u00EDvel dispon\u00EDvel.")}</p>)}
                {linkOptions.map((l) => (<label key={l.kind + l.id}>
                    <input type="checkbox" checked={draft.links.some((v: Goal) => v.id === l.id && v.kind === l.kind)} onChange={(e) => update("links", e.target.checked
                        ? [...draft.links, { kind: l.kind, id: l.id }]
                        : draft.links.filter((v: Goal) => v.id !== l.id || v.kind !== l.kind))}/>
                    {l.title} · {l.kind === "TASK" ? t("Tarefa") : t("Projeto")}
                  </label>))}
              </>)}
            {modal === "config" && (<>
                <Field label="Fonte de progresso">
                  <Select value={draft.source} onChange={(v) => update("source", v)} options={SOURCES}/>
                </Field>
                {[
                    ["manualProgress", t("Progresso manual")],
                    ["krWeight", t("Peso dos resultados-chave")],
                    ["childWeight", t("Peso dos objetivos filhos")],
                ].map(([k, label]) => (<Field key={k} label={label}>
                    <input required inputMode="decimal" value={draft[k]} onChange={(e) => update(k, e.target.value)}/>
                  </Field>))}
                {["keyResults", "children"].map((group) => (<fieldset key={group}>
                    <legend>
                      {group === "keyResults"
                        ? t("Resultados-chave") : t("Objetivos filhos")}
                    </legend>
                    {draft[group].map((i: Goal, index: number) => (<div className="goals-weight-row" key={i.id}>
                        <Field label={i.title} literal>
                          <input required inputMode="decimal" value={i.weight} onChange={(e) => update(group, draft[group].map((r: Goal, n: number) => n === index
                            ? { ...r, weight: e.target.value }
                            : r))}/>
                        </Field>
                        <label>
                          <input type="checkbox" checked={i.excluded} onChange={(e) => update(group, draft[group].map((r: Goal, n: number) => n === index
                            ? { ...r, excluded: e.target.checked }
                            : r))}/>{t("Excluir")}</label>
                      </div>))}
                  </fieldset>))}
                <p>{t("Ambos exige soma dos pesos das fontes igual a 100. Configura\u00E7\u00E3o e pesos s\u00E3o salvos juntos.")}</p>
              </>)}
            {modal === "assign" && (<>
                <p>{t("Atribui\u00E7\u00F5es funcionais de objetivos e resultados-chave s\u00E3o independentes da ocupa\u00E7\u00E3o de pap\u00E9is.")}</p>
                {draft.assignments.map((a: Goal, index: number) => (<fieldset key={index}>
                    <legend>{t("Atribuição {number}", { number: formatNumber(index + 1) })}</legend>
                    <Field label="Membro">
                      <Select value={a.memberId} onChange={(v) => update("assignments", draft.assignments.map((r: Goal, n: number) => n === index
                        ? { ...r, memberId: v, viaRoleId: null }
                        : r))} options={c.members
                        .filter((m) => m.status === "ACTIVE")
                        .map((m) => [m.id, m.displayName])} empty={t("Selecionar membro")}/>
                    </Field>
                    <Field label="Função">
                      <Select value={a.functionalRole} onChange={(v) => update("assignments", draft.assignments.map((r: Goal, n: number) => n === index ? { ...r, functionalRole: v } : r))} options={[
                        ["LEAD", t("Respons\u00E1vel")],
                        ["CONTRIBUTOR", t("Contribuidor")],
                        ["FOLLOWER", t("Observador")],
                    ]}/>
                    </Field>
                    <Field label="Por meio do papel">
                      <Select value={a.viaRoleId ?? ""} onChange={(v) => update("assignments", draft.assignments.map((r: Goal, n: number) => n === index ? { ...r, viaRoleId: v || null } : r))} options={activeOccupancies(a.memberId).map((o) => [
                        o.roleId!,
                        c.structure.nodes.find((n) => n.entityId === o.roleId)
                            ?.name ?? t("Papel"),
                    ])} empty={t("Atribui\u00E7\u00E3o pessoal")}/>
                    </Field>
                    <Field label="Resultado-chave">
                      <Select value={a.keyResultId ?? ""} onChange={(v) => update("assignments", draft.assignments.map((r: Goal, n: number) => n === index
                        ? { ...r, keyResultId: v || null }
                        : r))} options={selected?.keyResults.map((k: Goal) => [
                        k.id,
                        k.title,
                    ]) ?? []} empty={t("Objetivo inteiro")}/>
                    </Field>
                    <button type="button" onClick={() => update("assignments", draft.assignments.filter((_: unknown, n: number) => n !== index))}>{t("Remover atribui\u00E7\u00E3o")}</button>
                  </fieldset>))}
                <button type="button" onClick={() => update("assignments", [
                    ...draft.assignments,
                    {
                        memberId: "",
                        functionalRole: "CONTRIBUTOR",
                        keyResultId: null,
                        viaRoleId: null,
                    },
                ])}>{t("Adicionar atribui\u00E7\u00E3o")}</button>
              </>)}
            </div><div className="form-actions">
              <button type="button" disabled={busy} onClick={() => modalExit.current()}>{t("Cancelar")}</button>
              <button className="primary" disabled={busy || versionConflict ||
                ((modal === "new" || modal === "edit") &&
                    (!draft.title?.trim() ||
                        !draft.ownerId ||
                        !draft.periodIds?.length))}>
                {busy ? t("Salvando\u2026") : modal === "new" ? t("Criar") : t("Salvar")}
              </button>
            </div>
          </form>
        </Modal>)}
    </section>);
}
export const feature: FeatureDefinition = {
    ...goalsMetadata,
    Component: Goals,
    sidebar: Sidebar,
};

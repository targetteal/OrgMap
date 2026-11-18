import { ProjectContextLine, ProjectRelationFields } from "./project-relations";
import { PlanningIntentFields, PlanningIntentView, planningIntentPayload, type PlanningIntent } from "./planning-intent";
import { roleChoiceLabel } from "../../role-choice-label";
import { TaskViewControls, type TaskViewConfig } from "./task-view-controls";
import { ProjectChecklists, ExternalWorkLinks, WorkActivity, ProjectCopyActions, type ProjectChecklist, type ExternalWorkLink } from "./project-extras";
import { DraftForm, clearFormDraft } from "./draft-form";
import { CustomFieldInputs, CustomFieldValues, customFieldsPayload, type CustomFieldValue } from "./custom-field-inputs";
import { clearDraft, readDraft, writeDraft } from "./drafts";
import { projectProgress } from "./project-progress";
import { CatalogPopover } from "./catalog-popover";
import { ProjectActionMenu } from "./project-action-menu";
import { groupProjects, projectGroupingHint, projectOrderIds, moveProjectOrder, defaultProjectProperties, type ProjectProperty, type ProjectGrouping, type ProjectSort, type SavedProjectView } from "./project-catalog";
import { Archive, ArrowLeft, Copy, FilePlus2, Pencil, Globe2, ArrowUp, ArrowDown, GripVertical, ArrowUpRight, Bookmark, CalendarDays, ChevronDown, ChevronRight, Columns3, Filter, Flag, Folder, Layers, LayoutGrid, List, LockKeyhole, Maximize2, Minimize2, Plus, Search, Settings2, SlidersHorizontal, Users, X } from "lucide-react";
import {
  TaskAssigneesView,
  TaskAssignmentsEditor,
  taskAssignedToMember,
  type TaskAssignmentView,
} from "./task-assignments";
import {
  TaskPropertiesFields,
  TaskPropertiesView,
  TaskPropertiesMissing,
  taskPropertiesPayload,
  type TaskPropertiesValue,
} from "./task-properties";
import { DateFields } from "./date-fields";
import { workTranslator } from "./messages";
import {
  shiftWorkDay,
  workTaskOnDay,
  workTaskHour,
  workDateTimeFromForm,
} from "./calendar";
import { useLocalization } from "../../localization";
import { ResourcePanel } from "../platform";
import { TraceOrigin, TraceReturnLink } from "../../traceability";
import { DescriptionEditor, descriptionPayload } from "./description-editor";
import { RichTextView, type RichDocument } from "../../editor";
import { WorkStatisticsView } from "./statistics-view";
import { ProjectTemplateSelect } from "./templates-view";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type DragEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import { workMetadata } from "./metadata";
import { errorMessage, RequestError } from "../../api";
import "./work.css";
import { WorkSettingsView, type WorkPolicy } from "./settings-view";
type Task = TaskPropertiesValue &
  TaskAssignmentView & {
    id: string;
    creatorId: string;
    title: string;
    description: string;
    descriptionRich?: RichDocument | null;
    projectId: string | null;
    sectionId: string | null;
    sectionName?: string | null;
    parentId: string | null;
    subtaskGroupId?: string | null;
    status: string;
    customStatusId?: string | null;
    customFields?: Record<string,CustomFieldValue>;
    archivedByAncestor?: boolean;
    externalLinks?:ExternalWorkLink[];
    taskChecklists?:ProjectChecklist[];
    circleId?:string|null;
    effectiveCircleId?:string|null;
    archived?:boolean;
    planningIntent?:PlanningIntent;
    position?:number;
    version: number;
    startsAt: string | null;
    endsAt: string | null;
    duplicateOf: string | null;
    assigneeIds?: string[];
    dateProvenance: string;
  };
type Project = {
  leadMemberId?:string|null;
  priority?:string;
  sectionName?:string|null;
  planningIntent?:PlanningIntent;
  projectChecklists?:ProjectChecklist[];
  externalLinks?:ExternalWorkLink[];
  circleId?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  tags: string[];
  customFields?: Record<string,CustomFieldValue>;
  taskStates?: {id: string; name: string; semantic: string}[];
  projectStateId?: string | null;
  contextLinks?: {kind: "CIRCLE" | "ROLE" | "PARTICIPANT" | "FOLLOWER"; targetId: string}[];
  creatorId: string;
  id: string;
  title: string;
  description: string;
  descriptionRich?: RichDocument | null;
  visibility: string;
  version: number;
  views: string[];
  frozen: boolean;
  accessRole: string | null;
  defaultDoneSectionId: string | null;
  assignmentMode: string;
  assignmentPermission: string;
};
type Section = { id: string; name: string; semantic: string; position: number };
type Detail = TaskAssignmentView & {
  task: Task;
  capabilities: { edit: boolean; assign: boolean; roleAssignment?: boolean };
  assignments: { memberId: string }[];
  checklist: { id: string; title: string; done: boolean }[];
  comments: {
    id: string;
    content: string;
    authorId: string;
    createdAt: string;
  }[];
  dependencies: {
    predecessorId: string;
    successorId: string;
    type: string;
    lagMinutes: number;
  }[];
  links: { id: string; targetTaskId: string }[];
  subtasks: Task[];
  groups: { id: string; name: string; position: number }[];
};
type ProjectDetail = {
  project: Project;
  sections: Section[];
  access: { memberId: string; role: string }[];
  capabilities: {
    edit: boolean;
    manage: boolean;
    assign: boolean;
    configurationLocked: boolean;
  };
};
type Plan = {
  planHash: string;
  changes: {
    id: string;
    version: number;
    startsAt: string | null;
    endsAt: string | null;
  }[];
  unknown: string[];
};
const states: Record<string, string> = {
  TODO: "A fazer",
  IN_PROGRESS: "Em andamento",
  BLOCKED: "Bloqueada",
  DONE: "Concluída",
};
const views: Record<string, string> = {
  LIST: "Lista",
  BOARD: "Quadro",
  TIMELINE: "Linha do tempo",
  CALENDAR: "Calendário",
};
const form = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return new FormData(e.currentTarget);
};
function useWorkText() {
  const { locale } = useLocalization();
  return workTranslator(locale);
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const text = useWorkText();
  return (
    <label className="field">
      {text(label)}
      {children}
    </label>
  );
}
function Icon({ kind }: { kind: string }) {
  const LucideIcon = kind === "LIST" ? List : kind === "BOARD" ? Columns3 : kind === "GALLERY" ? LayoutGrid : kind === "TIMELINE" ? SlidersHorizontal : CalendarDays;
  return <LucideIcon size={18} strokeWidth={1.65} aria-hidden="true"/>;

}
const workDrawerSplitBreakpoint = 1024;
const workDrawerSelector = ".mare-task-drawer, .mare-project-drawer";
const blockingDialogSelector = `dialog[open]:not(${workDrawerSelector}), dialog[open][aria-modal="true"], [role="dialog"]`;

function WorkDrawer({
  label,
  className,
  focusKey,
  opener,
  onClose,
  children,
}: {
  label: string;
  className: string;
  focusKey?: string;
  opener: HTMLElement | null;
  onClose: () => void;
  children: ReactNode | ((narrow: boolean) => ReactNode);
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= workDrawerSplitBreakpoint);

  useEffect(() => {
    const update = () => setNarrow(window.innerWidth <= workDrawerSplitBreakpoint);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (narrow) dialog.showModal();
    else dialog.show();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [narrow]);
  useLayoutEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("[data-work-drawer-close]")?.focus({ preventScroll: true });
  }, [focusKey, narrow]);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    return () => queueMicrotask(() => {
      if (!dialog?.isConnected && opener?.isConnected) opener.focus({ preventScroll: true });
    });
  }, [opener]);
  useEffect(() => {
    if (narrow) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(blockingDialogSelector)) return;
      const drawers = Array.from(document.querySelectorAll(`dialog[open]:is(${workDrawerSelector})`));
      if (drawers.at(-1) !== dialogRef.current) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [narrow, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={className}
      aria-label={label}
      aria-modal={narrow || undefined}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      {typeof children === "function" ? children(narrow) : children}
    </dialog>
  );
}

export function Modal({
  title,
  children,
  close,
  error,
  className = "",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  error?: string;
  className?: string;
}) {
  const text = useWorkText();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={ref} className={"work-dialog " + className} onCancel={close} aria-labelledby={titleId}>
      <header className="dialog-head">
        <h2 id={titleId}>{text(title)}</h2>
        <button type="button" onClick={close}>
          {text("Fechar")}
        </button>
      </header>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}
const workError = (e: unknown, locale = "pt-BR") => {
  if (e instanceof Error && e.message === "WORK_INVALID_LOCAL_TIME")
    return workTranslator(locale)(
      "Este horário não existe nesse fuso. Escolha outro horário.",
    );
  if (e instanceof Error && e.message === "WORK_AMBIGUOUS_LOCAL_TIME")
    return workTranslator(locale)(
      "Este horário ocorre duas vezes. Escolha o instante.",
    );
  if (e instanceof RequestError) {
    const propertyErrors: Record<string, string> = {
      INVALID_TASK_PRIORITY: "Escolha uma prioridade válida.",
      INVALID_TASK_ESTIMATE:
        "Informe uma estimativa inteira entre 0 e 525600 minutos.",
      INVALID_TASK_TAGS:
        "Uma etiqueta por linha. Até 20 etiquetas, com 50 caracteres cada.",
      DUPLICATE_TASK_TAG: "As etiquetas não podem se repetir.",
    };
    if (propertyErrors[e.code])
      return workTranslator(locale)(propertyErrors[e.code]);
    const messages: Record<string, string> = {
      IMPORT_PREVIEW_STALE:
        "A prévia mudou. Confira a importação novamente antes de aplicar.",
      INVALID_IMPORT_SCHEMA:
        "O arquivo não corresponde ao formato JSON de projetos do OrgMap.",
      INVALID_TEMPLATE:
        "Confira as vistas e seções do modelo. A seção de conclusão precisa existir e ser concluída.",
      DEFAULT_TEMPLATE_REQUIRED:
        "Mantenha um modelo padrão. Escolha outro como padrão antes de excluir este.",

      DEPENDENCY_CYCLE:
        "Esta dependência criaria um ciclo. Revise as tarefas predecessoras.",
      DONE_SECTION_REQUIRED:
        "Há mais de uma seção de conclusão. Escolha a seção de destino.",
      SCHEDULE_PLAN_STALE:
        "As tarefas ou dependências mudaram. Gere uma nova prévia antes de aplicar.",
      PROJECT_FROZEN:
        "Este projeto está congelado. Um gestor pode liberar as alterações.",
      ASSIGNEE_REQUIRES_ACCESS:
        "Conceda acesso ao projeto privado antes de atribuir esta pessoa.",
      DUPLICATE_CYCLE:
        "A tarefa principal não pode apontar de volta para esta tarefa.",
      PROJECT_CONFIGURATION_LOCKED:
        "A organização bloqueou alterações de layout e configuração dos projetos. Um proprietário pode liberar a regra nas configurações globais.",
      CIRCLE_PROJECT_LIMIT:
        "Este círculo já atingiu o limite de projetos definido pela organização.",
      MULTIPLE_CIRCLE_PROJECTS_EXIST:
        "Há círculos com vários projetos ativos. Revise-os antes de limitar a um projeto por círculo.",
      MULTIPLE_ASSIGNEES_EXIST:
        "Há tarefas com vários responsáveis. Ajuste as atribuições antes de limitar a um responsável.",
      ASSIGNMENT_LIMIT:
        "Este projeto permite apenas um responsável por tarefa.",
      ASSIGNMENT_DENIED:
        "A política deste projeto permite atribuições somente a gestores.",
      PRECONDITION_REQUIRED: "Atualize o registro antes de salvar.",
    };
    if (messages[e.code]) return messages[e.code];
  }
  return errorMessage(e);
};
function WorkSidebar({ context: c }: { context: FeatureContext }) {
  const text = useWorkText();
  const guest = c.bootstrap.membership.memberType === "GUEST";
  const [ps, setPs] = useState<Project[]>([]);
  useEffect(() => {
    const a = new AbortController();
    setPs([]);
    c.api<{ projects: Project[] }>(
      `/organizations/${c.organizationId}/work/projects`,
      { signal: a.signal },
    )
      .then((r) => setPs(r.data.projects))
      .catch(() => {});
    return () => a.abort();
  }, [c.organizationId, c.path, c.api]);
  return (
    <>
      {!guest && (
        <button
          className="nav-item"
          onClick={() => c.navigate("/projects?new=project")}
        >
          {text("Novo projeto")}
        </button>
      )}
      <button className="nav-item" onClick={() => c.navigate("/projects")}>
        {text("Todos os projetos")}
      </button>
      <button
        className="nav-item"
        onClick={() => c.navigate("/projects/tasks")}
      >
        {text(guest ? "Tarefas compartilhadas" : "Minhas tarefas")}
      </button>
      <div className="sidebar-section">
        {text(guest ? "Projetos compartilhados" : "Meus projetos")}
      </div>
      <div className="circle-links">
        {ps.map((p) => (
          <button
            key={p.id}
            className={"nav-item " + (c.path.includes(p.id) ? "selected" : "")}
            onClick={() => c.navigate("/projects/" + p.id)}
          >
            <Icon kind="BOARD" />
            <span>{p.title}</span>
          </button>
        ))}
      </div>
      {!guest && (
        <button
          className="nav-item settings-link"
          onClick={() => c.navigate("/projects/settings")}
        >
          {text("Configurações do projeto")}
        </button>
      )}
    </>
  );
}
function Work({ context: c, onMutation, embeddedProject = false }: { context: FeatureContext; onMutation?: () => void; embeddedProject?:boolean }) {
  const {
    locale,
    prefs,
    compareText,
    formatNumber,
    formatInstant,
    dateAtInstant,
  } = useLocalization();
  const text = workTranslator(locale);
  const formatWorkError = (error: unknown) => workError(error, locale);
  const guest = c.bootstrap.membership.memberType === "GUEST";
  const path = c.path.split("?")[0],
    pid = path.match(/^\/projects\/([0-9a-f-]{36})$/)?.[1],
    tid = path.match(/^\/projects\/tasks\/([0-9a-f-]{36})$/)?.[1];
  const browse = path === "/projects",
    statsPage = path === "/projects/stats",
    settingsPage = path === "/projects/settings";
  const [projects, setProjects] = useState<Project[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [pd, setPd] = useState<ProjectDetail | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [policy, setPolicy] = useState<WorkPolicy | null>(null);
  const loadedWorkScope=useRef<string|null>(null);
  const [resourceLoad, setResourceLoad] = useState<{scope:string; status:"loading"|"available"|"unavailable"|"error"} | null>(null);
  const projectTriggerRef = useRef<HTMLElement | null>(null);
  const taskTriggerRef = useRef<HTMLElement | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskArchived,setSelectedTaskArchived]=useState(false);
  const [taskFocus, setTaskFocus] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [bulkProjectState, setBulkProjectState] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("TODO");
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [draggedCatalogId, setDraggedCatalogId] = useState<string | null>(null);
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const [activeProjectViewId, setActiveProjectViewId] = useState<string | null>(null);
  const catalogViewsInitialized = useRef<string | null>(null);
  const personalOrderFocus = useRef<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [archiveScope, setArchiveScope] = useState(false);
  const [taskArchiveMode,setTaskArchiveMode]=useState<"ACTIVE"|"ARCHIVED"|"ALL">("ACTIVE");
  const [taskPersonFilter,setTaskPersonFilter]=useState("");
  const [taskRoleFilter,setTaskRoleFilter]=useState("");
  const [taskCircleFilter,setTaskCircleFilter]=useState("");
  const [taskTagFilter,setTaskTagFilter]=useState("");
  const [taskVisibleProperties,setTaskVisibleProperties]=useState<("state"|"participants"|"due")[]>(["state","participants","due"]);
  const [taskOrder,setTaskOrder]=useState<string[]>([]);
  const [draggedTaskOrder,setDraggedTaskOrder]=useState<string|null>(null);
  const taskOrderRef=useRef<((ids:string[])=>Promise<boolean>)|null>(null);
  const taskOrderFocus=useRef<string|null>(null);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [projectRelevance, setProjectRelevance] = useState<"ALL" | "MINE" | "CIRCLES">("ALL");
  const [projectView, setProjectView] = useState<"LIST" | "BOARD" | "GALLERY">("LIST");
  const [catalogPresentationOpen, setCatalogPresentationOpen] = useState(false);
  const catalogPresentationId = useId();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFocus, setProjectFocus] = useState(false);
  const [projectPreviewTab,setProjectPreviewTab]=useState<"content"|"tasks"|"conversation"|"activity">("content");
  const [projectDialog,setProjectDialog]=useState<"edit"|"duplicate"|"template"|null>(null);
  const projectPreviewId=useId();
  const [projectPageTab,setProjectPageTab]=useState<"content"|"tasks"|"conversation"|"activity">("tasks");
  const [previewTaskQuery,setPreviewTaskQuery]=useState("");
  const projectSearchRef=useRef<HTMLInputElement>(null);
  const [projectPersonFilter, setProjectPersonFilter] = useState("");
  const [projectCircleFilter, setProjectCircleFilter] = useState("");
  const [projectStateFilter, setProjectStateFilter] = useState("");
  const [projectRoleFilter, setProjectRoleFilter] = useState("");
  const [projectTagFilter, setProjectTagFilter] = useState("");
  const [projectGrouping, setProjectGrouping] = useState<ProjectGrouping>("NONE");
  const [projectSort, setProjectSort] = useState<ProjectSort>("TITLE");
  const [visibleProjectProperties, setVisibleProjectProperties] = useState<ProjectProperty[]>([...defaultProjectProperties]);
  const [savedProjectViews, setSavedProjectViews] = useState<SavedProjectView[]>([]);
  const [savedProjectViewsVersion, setSavedProjectViewsVersion] = useState(0);
  const [newProjectViewName, setNewProjectViewName] = useState("");
  const [projectStates, setProjectStates] = useState<{id:string;name:string;semantic:string}[]>([]);
  const [projectStatesVersion, setProjectStatesVersion] = useState(0);
  const [newProjectState, setNewProjectState] = useState("");
  const [newProjectStateSemantic, setNewProjectStateSemantic] = useState("TODO");
  const [view, setView] = useState("LIST"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("POSITION"),
    [grouping, setGrouping] = useState("SECTION"),
    [layoutVersion, setLayoutVersion] = useState(0),
    [statusFilter, setStatusFilter] = useState(""),
    [mine, setMine] = useState(!guest && !browse && !pid),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [modal, setModal] = useState(""),
    [parent, setParent] = useState<string | null>(null),
    [plan, setPlan] = useState<Plan | null>(null),
    [filters, setFilters] = useState(false),
    [settings, setSettings] = useState(false),
    [day, setDay] = useState(dateAtInstant(new Date())!);
  const archivedTask = new URLSearchParams(c.path.split("?")[1] ?? "").get("archived") === "1";
  const resourceScope = `${c.organizationId}:${c.session.account.id}:${pid ?? ""}:${tid ?? ""}:${archivedTask}`;
  const draftPrefix = `orgmap:work:${c.organizationId}:${c.session.account.id}`;
  const projectDraft = draftPrefix + ":new-project";
  const taskDraft = draftPrefix + ":new-task:" + (pid ?? selectedProjectId ?? "personal");
  const base = `/organizations/${c.organizationId}/work`,
    refresh = () => setRevision((v) => v + 1);
  const applyProjectView = (saved:SavedProjectView) => {
    setProjectView(saved.view); setProjectRelevance(saved.relevance); setQuery(saved.query);
    setProjectSort(saved.sort); setProjectStateFilter(saved.stateFilter ?? ""); setProjectTagFilter(saved.tagFilter ?? "");
    setProjectGrouping(saved.grouping ?? "NONE"); setProjectPersonFilter(saved.personFilter ?? "");
    setProjectCircleFilter(saved.circleFilter ?? ""); setProjectRoleFilter(saved.roleFilter ?? "");
    setProjectOrder(saved.orderIds ?? []); setActiveProjectViewId(saved.id);setArchiveScope(saved.archived ?? false); setVisibleProjectProperties(saved.visibleProperties ?? [...defaultProjectProperties]);
  };
  useEffect(() => {
    setMine(!guest && !browse && !pid);
  }, [base, pid, browse, guest]);
  useEffect(() => {
    setProjectRoleFilter(""); setProjectPersonFilter(""); setProjectCircleFilter("");
    setProjectStateFilter(""); setProjectTagFilter(""); setProjectGrouping("NONE");
    setProjectRelevance("ALL"); setProjectSort("TITLE"); setQuery(""); setProjectOrder([]); setActiveProjectViewId(null); setDraggedCatalogId(null); setVisibleProjectProperties([...defaultProjectProperties]);setModal("");setProjectDialog(null);
  }, [c.organizationId,c.session.account.id]);
  useEffect(() => {
    if(busy || !personalOrderFocus.current) return;
    Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-order-project-id]")).find((button)=>button.dataset.orderProjectId===personalOrderFocus.current && !button.disabled)?.focus({preventScroll:true});
    personalOrderFocus.current=null;
  }, [busy,projectOrder]);
  useEffect(()=>{if(busy||!taskOrderFocus.current)return;Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-order-task-id]")).find((button)=>button.dataset.orderTaskId===taskOrderFocus.current&&!button.disabled)?.focus({preventScroll:true});taskOrderFocus.current=null;},[busy,taskOrder]);
  useEffect(() => {
    const a = new AbortController();
    setPolicy(null);
    if (guest) return;
    c.api<{ settings: WorkPolicy }>(base + "/settings", { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) setPolicy(r.data.settings);
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(formatWorkError(e));
      });
    return () => a.abort();
  }, [base, c.api, revision, c.path, guest]);
  useEffect(() => {
    if (settingsPage || statsPage) return;
    const a = new AbortController();
    const scope=`${base}:${c.session.account.id}:${browse}:${pid ?? ""}:${tid ?? ""}:${new URLSearchParams(c.path.split("?")[1] ?? "").get("archived") ?? ""}`;
    const refreshingSameScope=loadedWorkScope.current===scope;
    if(!refreshingSameScope) {
      setLoading(true);
      setPd(null);
      setDetail(null);
      setTasks([]);
    }
    setError("");

    setPlan(null);
    // Check the requested resource independently: an unrelated list/layout failure
    // must never be mistaken for an authoritative denial of this project or task.
    const target = pid
      ? c.api<ProjectDetail>(base + "/projects/" + pid, { signal: a.signal })
      : tid
        ? c.api<Detail>(base + "/tasks/" + tid + (archivedTask ? "/archived" : ""), { signal: a.signal })
        : null;
    if (target) setResourceLoad((current) => refreshingSameScope && current?.scope === resourceScope && current.status === "available" ? current : {scope:resourceScope, status:"loading"});
    const supporting = Promise.allSettled([
      c.api<{ projects: Project[] }>(base + "/projects", { signal: a.signal }),
      c.api<{ tasks: Task[] }>(base + "/tasks" + (pid ? "?projectId=" + pid : ""), { signal: a.signal }),
      ...(!guest && !browse && !statsPage && !tid
        ? [c.api<any>(base + "/layout" + (pid ? "?projectId=" + pid : ""), { signal: a.signal })]
        : []),
    ]);
    const run = async () => {
      let targetData: ProjectDetail | Detail | null = null;
      try {
        if (target) targetData = (await target).data;
      } catch (e) {
        if (!a.signal.aborted) {
          setPd(null); setDetail(null); setTasks([]);
          const unavailable = e instanceof RequestError && ["RESOURCE_NOT_FOUND", "ACTION_DENIED"].includes(e.code);
          setResourceLoad({scope:resourceScope, status:unavailable ? "unavailable" : "error"});
          setLoading(false);
        }
        return;
      }
      const results = await supporting;
      if (a.signal.aborted) return;
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") {
        if (target) {
          setPd(null); setDetail(null); setTasks([]);
          setResourceLoad({scope:resourceScope, status:"error"});
        } else setError(formatWorkError(failed.reason));
        setLoading(false);
        return;
      }
      const result = results.map((item) => (item as PromiseFulfilledResult<any>).value);
      loadedWorkScope.current=scope;
      setProjects(result[0].data.projects);
      setTasks(result[1].data.tasks);
      if (pid && targetData) {
        const projectDetail = targetData as ProjectDetail;
        setPd(projectDetail);
        if (guest) {
          const allowed = projectDetail.project.views;
          setView((current) => allowed.includes(current === "GALLERY" ? "LIST" : current) ? current : allowed[0]);
        }
      }
      if (tid && targetData) {
        const taskDetail = targetData as Detail;
        setDetail({...taskDetail, subtasks:taskDetail.subtasks ?? []});
      }
      if (!guest && !browse && !statsPage && !tid) {
        const l = result.at(-1)!.data.layout;
        if(!refreshingSameScope) { setView(l.view); setSort(l.sort); setGrouping(l.grouping); }
        setLayoutVersion(l.version);
      }
      if (target) setResourceLoad({scope:resourceScope, status:"available"});
      setLoading(false);
    };
    void run();
    return () => a.abort();
  }, [base, c.api, c.session.account.id, pid, tid, revision, browse, statsPage, settingsPage, guest, archivedTask, resourceScope]);
  useEffect(() => {
    if (!browse || guest) return;
    const controller = new AbortController();
    c.api<{views: typeof savedProjectViews; version:number}>(base + "/project-views", {signal:controller.signal}).then((result) => {setSavedProjectViews(result.data.views);setSavedProjectViewsVersion(result.data.version);if(catalogViewsInitialized.current !== base){catalogViewsInitialized.current=base;const first=result.data.views[0];if(first?.sort === "MANUAL")applyProjectView(first);}}).catch((e) => {if (!controller.signal.aborted) setError(formatWorkError(e));});
    return () => controller.abort();
  }, [base, browse, guest, revision, c.api]);
  useEffect(() => {
    if ((!browse && !pid) || guest) return;
    const controller = new AbortController();
    c.api<{states:{id:string;name:string;semantic:string}[];version:number}>(base + "/project-states", {signal:controller.signal}).then((result) => { setProjectStates(result.data.states); setProjectStatesVersion(result.data.version); }).catch((e) => { if (!controller.signal.aborted) setError(formatWorkError(e)); });
    return () => controller.abort();
  }, [base, browse, pid, guest, revision, c.api]);
  useEffect(() => {
    setArchiveScope(false);setTaskArchiveMode("ACTIVE");setTaskPersonFilter("");setTaskRoleFilter("");setTaskCircleFilter("");setTaskTagFilter("");setTaskOrder([]);
    setSelectedTasks([]);
    setSelectedProjects([]);
    setSelectedTaskId(null);
    setSelectedProjectId(null);
  }, [c.organizationId,c.session.account.id, pid, browse]);
  useEffect(() => {
    if ((!archiveScope && (browse || taskArchiveMode === "ACTIVE")) || guest) return;
    const controller = new AbortController();
    const path = browse ? "/projects/archived" : "/tasks/archived" + (pid ? "?projectId=" + pid : "");
    c.api<{ projects?: Project[]; tasks?: Task[] }>(base + path, { signal: controller.signal }).then((response) => {
      if (browse) setArchivedProjects(response.data.projects ?? []);
      else setArchivedTasks(response.data.tasks ?? []);
    }).catch((e) => { if (!controller.signal.aborted) setError(formatWorkError(e)); });
    return () => controller.abort();
  }, [archiveScope, taskArchiveMode, base, browse, pid, guest, revision, c.api]);
  useEffect(() => {
    if (c.path.includes("new=project")) setModal("project");
    if(pid && new URLSearchParams(c.path.split("?")[1] ?? "").get("settings") === "1")setSettings(true);
    const circleParam=browse?new URLSearchParams(c.path.split("?")[1] ?? "").get("circleId"):null;
    if(circleParam){setProjectCircleFilter(circleParam);setProjectRelevance("ALL");}
  }, [c.path]);
  useEffect(() => {
    if (pd && !pd.project.views.includes(view === "GALLERY" ? "LIST" : view)) setView(pd.project.views[0]);
  }, [pd, view]);
  const mutate = async (
    path: string,
    body: unknown,
    version?: number,
    method = "POST",
  ) => {
    setBusy(true);
    setError("");
    try {
      const response = await c.api<any>(base + path, { method, body, version });
      c.notify(text("Alteração salva."));
      refresh();
      onMutation?.();
      return response.data;
    } catch (e) {
      setError(formatWorkError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (
    e: FormEvent<HTMLFormElement>,
    action: (f: FormData) => Promise<unknown>,
  ) => {
    const f = form(e);
    try {
      await action(f);
    } catch (e) {
      setError(formatWorkError(e));
    }
  };
  const createTask = async (f: FormData) => {
    const response = await mutate("/tasks", {
      title: f.get("title"),
      ...descriptionPayload(f),
      ...taskPropertiesPayload(f),
      customFields:customFieldsPayload(f),
      planningIntent:planningIntentPayload(f),
      projectId: pid ?? f.get("projectId") ?? null,
      parentId: parent,
      sectionId: f.get("sectionId") || null,
      startsAt: workDateTimeFromForm(f, "startsAt", prefs),
      endsAt: workDateTimeFromForm(f, "endsAt", prefs),
    });
    if (response) {
      clearDraft(taskDraft + ":title"); clearDraft(taskDraft + ":description"); clearFormDraft(taskDraft);
      setModal("");
      setParent(null);
    }
  };
  const memberName = (id: string) =>
    c.members.find((m) => m.id === id)?.displayName ?? "Membro";
  const taskName = (id: string) =>
    tasks.find((t) => t.id === id)?.title ?? "Tarefa vinculada";
  const taskCircleId=(task:Task)=>task.effectiveCircleId ?? task.circleId ?? projects.find((project)=>project.id===task.projectId)?.circleId ?? "";
  const taskRecords = taskArchiveMode === "ARCHIVED" && pid ? archivedTasks : taskArchiveMode === "ALL" && pid ? [...tasks,...archivedTasks] : tasks;
  const currentTaskOrder=projectOrderIds(tasks,taskOrder,compareText),taskOrderRank=new Map(currentTaskOrder.map((id,index)=>[id,index]));
  const filtered = taskRecords
    .filter(
      (t) =>
        (!mine ||
          taskAssignedToMember(t, c.bootstrap.membership.id) ||
          !t.projectId) &&
        (!taskPersonFilter || taskAssignedToMember(t,taskPersonFilter)) &&
        (!taskRoleFilter || t.principals?.some((principal)=>principal.kind === "ROLE" && principal.roleId === taskRoleFilter) || projects.find((project)=>project.id===t.projectId)?.contextLinks?.some((link)=>link.kind === "ROLE" && link.targetId === taskRoleFilter)) &&
        (!taskCircleFilter || taskCircleId(t)===taskCircleFilter || projects.find((project)=>project.id===t.projectId)?.contextLinks?.some((link)=>link.kind === "CIRCLE" && link.targetId===taskCircleFilter)) &&
        (!taskTagFilter || t.tags?.some((tag)=>tag.toLocaleLowerCase(locale).includes(taskTagFilter.toLocaleLowerCase(locale)))) &&
        (!statusFilter || (statusFilter.startsWith("custom:") ? t.customStatusId === statusFilter.slice(7) : t.status === statusFilter)) &&
        [t.title,t.description,...(t.tags ?? [])].join(" ").normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase(locale).includes(query.normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase(locale)),
    )
    .sort((a, b) =>
      sort === "POSITION" && taskOrder.length ? (taskOrderRank.get(a.id) ?? Infinity)-(taskOrderRank.get(b.id) ?? Infinity) : sort === "PRIORITY" ? (["URGENT","HIGH","MEDIUM","LOW","NONE"].indexOf(a.priority ?? "NONE")-["URGENT","HIGH","MEDIUM","LOW","NONE"].indexOf(b.priority ?? "NONE") || compareText(a.title,b.title)) : sort === "TITLE"
        ? compareText(a.title, b.title) || a.id.localeCompare(b.id)
        : sort === "DUE"
          ? (a.endsAt ? +new Date(a.endsAt) : Infinity) -
              (b.endsAt ? +new Date(b.endsAt) : Infinity) ||
            compareText(a.title, b.title)
          : 0,
    );
  const canEdit = !guest && (pd?.capabilities.edit ?? !pid),
    sections = pd?.sections ?? [],
    projectTitle = (id: string | null) =>
      projects.find((p) => p.id === id)?.title ??
      text(guest ? "Contexto não compartilhado" : "Pessoal");
  const customStates = pd?.project.taskStates ?? [];
  const taskStateName = (t: Task) => projects.find((p) => p.id === t.projectId)?.taskStates?.find((state) => state.id === t.customStatusId)?.name ?? text(states[t.status] ?? t.status);
  const groupingOptions =
    grouping === "NONE" ? [{id:"all",name:""}] : grouping === "CIRCLE" ? [...new Set(taskRecords.map(taskCircleId))].map((id)=>({id,name:c.structure.nodes.find((node)=>node.entityId===id)?.name ?? "Sem círculo"})) : grouping === "STATUS"
      ? [...Object.entries(states).map(([id, name]) => ({ id, name: text(name) })), ...customStates.map((state) => ({id: "custom:" + state.id, name: state.name}))]
      : grouping === "PROJECT"
        ? [
            ...projects.map((p) => ({ id: p.id, name: p.title })),
            { id: "", name: "Pessoal" },
          ]
        : [
            ...(pd
              ? sections.map((s) => ({ id: s.id, name: s.name }))
              : [
                  ...new Map(
                    tasks
                      .filter((t) => t.sectionId)
                      .map((t) => [
                        t.sectionId!,
                        { id: t.sectionId!, name: t.sectionName ?? "Seção" },
                      ]),
                  ).values(),
                ]),
            { id: "", name: "Caixa de entrada" },
          ];
  const taskGroups = groupingOptions.map((g) => ({
    ...g,
    tasks: filtered.filter(
      (t) =>
        (grouping === "NONE" ? "all" : grouping === "CIRCLE" ? taskCircleId(t) : grouping === "STATUS"
          ? (t.customStatusId && customStates.some((state) => state.id === t.customStatusId) ? "custom:" + t.customStatusId : t.status)
          : grouping === "PROJECT"
            ? (t.projectId ?? "")
            : (t.sectionId ?? "")) === g.id,
    ),
  }));
  const open = (t: Task, opener?: HTMLElement) => {
    if (tid) {
      c.navigate("/projects/tasks/" + t.id + (t.archived || t.archivedByAncestor ? "?archived=1" : ""));
      return;
    }
    taskTriggerRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelectedTaskId(t.id);
    setSelectedTaskArchived(!!(t.archived || t.archivedByAncestor));
    setTaskFocus(false);
  };
  const closeTaskDrawer = () => {
    setSelectedTaskId(null);
    refresh();
  };
  const dateLabel = (v: string | null) =>
    v ? formatInstant(v, false) : text("Sem data");
  const applyTaskView=(patch:Partial<TaskViewConfig>)=>{
    if(patch.view!==undefined)setView(patch.view);if(patch.query!==undefined)setQuery(patch.query ?? "");if(patch.sort!==undefined)setSort(patch.sort);if(patch.grouping!==undefined)setGrouping(patch.grouping);
    if(patch.personFilter!==undefined){setTaskPersonFilter(patch.personFilter);setMine(false);}if(patch.roleFilter!==undefined)setTaskRoleFilter(patch.roleFilter);if(patch.circleFilter!==undefined)setTaskCircleFilter(patch.circleFilter);if(patch.tagFilter!==undefined)setTaskTagFilter(patch.tagFilter ?? "");if(patch.statusFilter!==undefined)setStatusFilter(patch.statusFilter ?? "");
    if(patch.visibleProperties)setTaskVisibleProperties(patch.visibleProperties);if(patch.orderIds)setTaskOrder(patch.orderIds);if(patch.archiveMode){setTaskArchiveMode(patch.archiveMode);setArchiveScope(false);}else if(patch.archived!==undefined){setTaskArchiveMode(patch.archived?"ARCHIVED":"ACTIVE");setArchiveScope(false);}
  };
  const taskViewConfig:TaskViewConfig={view,query,sort,grouping,personFilter:mine?c.bootstrap.membership.id:taskPersonFilter,roleFilter:taskRoleFilter,circleFilter:taskCircleFilter,statusFilter,tagFilter:taskTagFilter,visibleProperties:taskVisibleProperties,archived:taskArchiveMode === "ARCHIVED",archiveMode:taskArchiveMode,orderIds:taskOrder};
  const moveTaskPersonalOrder=async(source:string,target:string,placement:"before"|"after")=>{if(!taskOrderRef.current || busy)return;const next=moveProjectOrder(currentTaskOrder,source,target,placement);setBusy(true);if(await taskOrderRef.current(next)){taskOrderFocus.current=source;setTaskOrder(next);}setBusy(false);};
  const taskOrderControls=(task:Task)=>{if(!pid||guest||sort!=="POSITION"||task.archived||task.archivedByAncestor)return null;const peers=(taskGroups.find((group)=>group.tasks.some((item)=>item.id===task.id))?.tasks ?? filtered).filter((item)=>!item.archived&&!item.archivedByAncestor),at=peers.findIndex((item)=>item.id===task.id);return <div className="mare-personal-order-controls" aria-label={`Ordem pessoal da tarefa ${task.title}`}><button data-order-task-id={task.id} className="mare-icon-button" disabled={busy||at<=0} aria-label={`Mover tarefa ${task.title} para cima`} onClick={()=>void moveTaskPersonalOrder(task.id,peers[at-1].id,"before")}><ArrowUp size={15}/></button><button data-order-task-id={task.id} className="mare-icon-button" disabled={busy||at>=peers.length-1} aria-label={`Mover tarefa ${task.title} para baixo`} onClick={()=>void moveTaskPersonalOrder(task.id,peers[at+1].id,"after")}><ArrowDown size={15}/></button><button className="mare-icon-button mare-order-grip" draggable={!busy} disabled={busy} aria-label={`Arrastar ordem da tarefa ${task.title}`} onDragStart={(event)=>{event.stopPropagation();setDraggedTaskOrder(task.id);event.dataTransfer.setData("application/x-orgmap-task-order",task.id);}} onDragEnd={()=>setDraggedTaskOrder(null)}><GripVertical size={16}/></button></div>;};
  const taskAssigneeLabel=(task:Task)=>{
    if(guest)return "Identidades não compartilhadas";
    const ids=task.resolvedAssignees?.map((person)=>person.memberId) ?? task.assigneeIds ?? task.principals?.flatMap((principal)=>principal.kind === "MEMBER"?[principal.memberId]:[]) ?? [];
    if(ids.length)return ids.map(memberName).join(", ");
    const roles=task.principals?.flatMap((principal)=>{if(principal.kind !== "ROLE")return [];const role=c.structure.nodes.find((node)=>node.kind === "ROLE" && node.entityId===principal.roleId);return [role ? roleChoiceLabel(role,c.structure.nodes,text("Círculo não compartilhado")) : text("Papel indisponível")];}) ?? [];
    return roles.length ? roles.map((role)=>`Papel: ${role}`).join(", ") : "Sem responsável";
  };
  const selectableTask=(task:Task)=>!guest&&!task.archived&&!task.archivedByAncestor&&(task.projectId?projects.some((project)=>project.id===task.projectId&&["MANAGER","EDITOR"].includes(project.accessRole ?? "")&&!project.frozen):task.creatorId===c.bootstrap.membership.id);
  const card = (t: Task) => (
    <div className="mare-task-card" key={t.id} onDragOver={(event)=>{if(draggedTaskOrder){event.preventDefault();event.stopPropagation();}}} onDrop={(event)=>{if(draggedTaskOrder){event.preventDefault();event.stopPropagation();void moveTaskPersonalOrder(draggedTaskOrder,t.id,"before");setDraggedTaskOrder(null);}}} draggable={canEdit && !t.archived && !t.archivedByAncestor && (grouping === "STATUS" || (grouping === "SECTION" && !!pid))} onDragStart={(e) => { setDraggedTaskId(t.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); }} onDragEnd={() => setDraggedTaskId(null)}>
      {selectableTask(t)&&<label className="mare-task-card-selection"><input type="checkbox" aria-label={`Selecionar ${t.title}`} checked={selectedTasks.includes(t.id)} disabled={selectedTasks.length>=100&&!selectedTasks.includes(t.id)} onChange={(event)=>setSelectedTasks((current)=>event.target.checked?[...current,t.id]:current.filter((id)=>id!==t.id))}/><span>{selectedTasks.includes(t.id)?"Selecionada":"Selecionar"}</span></label>}
      <button className="work-card" onClick={(event) => open(t, event.currentTarget)}>
        <span className={"work-dot work-" + t.status.toLowerCase()} />
        <span>{t.title}</span>
        {taskVisibleProperties.includes("state") && <small>{text("Estado")}: {taskStateName(t)}</small>}
        {taskVisibleProperties.includes("participants") && <small title={taskAssigneeLabel(t)}>{taskAssigneeLabel(t)}</small>}
        {!pid && <span className="badge">{projectTitle(t.projectId)}</span>}
        {taskVisibleProperties.includes("due") && t.endsAt && <small className="work-card-due"><CalendarDays size={13} aria-hidden="true"/>{dateLabel(t.endsAt)}</small>}
      </button>
      {canEdit && !t.archived && !t.archivedByAncestor && grouping !== "SECTION" && <details className="mare-move-menu">
        <summary aria-label={`Mover ${t.title}`}>Mover<ChevronDown size={14} aria-hidden="true"/></summary>
        <div>{Object.entries(states).filter(([status]) => status !== t.status || t.customStatusId).map(([status, label]) => <button key={status} disabled={busy} onClick={() => void mutate("/tasks/" + t.id, { status }, t.version, "PATCH")}>{text(label)}</button>)}{(projects.find((p) => p.id === t.projectId)?.taskStates ?? []).filter((state) => state.id !== t.customStatusId).map((state) => <button key={state.id} disabled={busy} onClick={() => void mutate("/tasks/" + t.id, {customStatusId: state.id}, t.version, "PATCH")}>{state.name}</button>)}</div>
      </details>}
      {canEdit && !t.archived && !t.archivedByAncestor && grouping === "SECTION" && pid && <details className="mare-move-menu">
        <summary aria-label={`Mover ${t.title}`}>Mover<ChevronDown size={14} aria-hidden="true"/></summary>
        <div>{[{ id: "", name: "Caixa de entrada" }, ...sections].filter((section) => section.id !== (t.sectionId ?? "")).map((section) => <button key={section.id} disabled={busy} onClick={() => void mutate("/tasks/" + t.id, { sectionId: section.id || null }, t.version, "PATCH")}>{section.name}</button>)}</div>
      </details>}
      {taskOrderControls(t)}
    </div>
  );
  const closeProjectPreview = () => {
    setSelectedProjectId(null); setProjectFocus(false); setProjectDialog(null);
  };
  const openProjectPreview = (id: string, opener: HTMLElement) => {
    projectTriggerRef.current = opener;
    setSelectedProjectId(id); setProjectFocus(false);setProjectPreviewTab("content");setProjectDialog(null);setPreviewTaskQuery("");
  };
  useEffect(()=>{
    if(!browse)return;
    const shortcut=(event:KeyboardEvent)=>{const target=document.activeElement as HTMLElement|null;if(event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !target?.closest("input,textarea,select,[contenteditable=true]") && !document.querySelector(blockingDialogSelector)){event.preventDefault();projectSearchRef.current?.focus();}};
    document.addEventListener("keydown",shortcut);return()=>document.removeEventListener("keydown",shortcut);
  },[browse]);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const activeProject=selectedProject ?? pd?.project;
  const canManageActiveProject=!!activeProject&&(activeProject.accessRole==='MANAGER'||(activeProject.id===pd?.project.id&&pd?.capabilities.manage));
  const projectStatusControl=(project:Project,editable:boolean)=><label className="mare-project-status-field"><span>Estado</span>{editable?<select aria-label="Estado do projeto" disabled={busy} value={project.projectStateId??""} onChange={event=>void mutate(`/projects/${project.id}`,{projectStateId:event.target.value||null},project.version,"PATCH")}><option value="">Sem estado</option>{projectStates.map(state=><option key={state.id} value={state.id}>{state.name}</option>)}</select>:<strong>{projectStates.find(state=>state.id===project.projectStateId)?.name??(guest?'Estado não compartilhado':'Sem estado')}</strong>}</label>;
  const projectTasks = (id: string) => tasks.filter((task) => task.projectId === id);
  const progressFor = (id: string) => projectProgress(tasks, id);
  const myCircleIds = new Set(c.structure.memberships.filter((relation) => relation.memberId === c.bootstrap.membership.id && (!relation.endsAt || Date.parse(relation.endsAt) > Date.now()) && Date.parse(relation.startsAt) <= Date.now()).map((relation) => relation.circleId).filter(Boolean));
  const currentProjectOrder = projectOrderIds(projects,projectOrder,compareText);
  const projectOrderRank = new Map(currentProjectOrder.map((id,index)=>[id,index]));
  const catalogProjectRecords=archiveScope?archivedProjects:projects;
  const visibleProjects = catalogProjectRecords.filter((p) => {
    if (![p.title,p.description,...(p.tags ?? [])].join(" ").normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase(locale).includes(query.normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase(locale))) return false;
    if (projectStateFilter && (p.projectStateId ?? "none") !== projectStateFilter) return false;
    if (projectPersonFilter && p.creatorId !== projectPersonFilter && p.leadMemberId !== projectPersonFilter && !(p.contextLinks ?? []).some((link) => ["PARTICIPANT","FOLLOWER"].includes(link.kind) && link.targetId === projectPersonFilter) && !projectTasks(p.id).some((task) => taskAssignedToMember(task,projectPersonFilter))) return false;
    if (projectRoleFilter && !(p.contextLinks ?? []).some((link) => link.kind === "ROLE" && link.targetId === projectRoleFilter)) return false;
    if (projectCircleFilter && p.circleId !== projectCircleFilter && !(p.contextLinks ?? []).some((link) => link.kind === "CIRCLE" && link.targetId === projectCircleFilter)) return false;
    if (projectTagFilter && !(p.tags ?? []).some((tag) => tag.toLocaleLowerCase(locale).includes(projectTagFilter.toLocaleLowerCase(locale)))) return false;
    if (projectRelevance === "MINE") return p.creatorId === c.bootstrap.membership.id || p.leadMemberId === c.bootstrap.membership.id || (p.contextLinks ?? []).some((link) => ["PARTICIPANT", "FOLLOWER"].includes(link.kind) && link.targetId === c.bootstrap.membership.id) || projectTasks(p.id).some((task) => taskAssignedToMember(task, c.bootstrap.membership.id));
    if (projectRelevance === "CIRCLES") return (!!p.circleId && myCircleIds.has(p.circleId)) || (p.contextLinks ?? []).some((link) => link.kind === "CIRCLE" && myCircleIds.has(link.targetId));
    return true;
  }).sort((a,b) => projectSort === "MANUAL" ? (projectOrderRank.get(a.id) ?? Infinity) - (projectOrderRank.get(b.id) ?? Infinity) : projectSort === "PRIORITY" ? (["URGENT","HIGH","MEDIUM","LOW","NONE"].indexOf(a.priority ?? "NONE")-["URGENT","HIGH","MEDIUM","LOW","NONE"].indexOf(b.priority ?? "NONE") || compareText(a.title,b.title)) : projectSort === "TITLE" ? compareText(a.title,b.title) : projectSort === "DUE" ? ((a.endsAt ? Date.parse(a.endsAt) : Infinity) - (b.endsAt ? Date.parse(b.endsAt) : Infinity) || compareText(a.title,b.title)) : ((progressFor(b.id).total ? progressFor(b.id).done / progressFor(b.id).total : 0) - (progressFor(a.id).total ? progressFor(a.id).done / progressFor(a.id).total : 0) || compareText(a.title,b.title)));
  const projectEntityName = (id:string) => {
    const node=c.structure.nodes.find((item)=>item.entityId===id);
    return node ? node.kind === "ROLE" ? roleChoiceLabel(node,c.structure.nodes,text("Círculo não compartilhado")) : node.name : undefined;
  };
  const persistProjectOrder = async (source:string,target:string,placement:"before"|"after") => {
    if(guest || busy || projectSort !== "MANUAL") return;
    const orderIds=moveProjectOrder(currentProjectOrder,source,target,placement);
    if(orderIds === currentProjectOrder || orderIds.every((id,index)=>id===currentProjectOrder[index])) return;
    const active=savedProjectViews.find((saved)=>saved.id===activeProjectViewId);
    if(!active && savedProjectViews.length>=20) {setError("Você já tem 20 vistas salvas. Remova uma vista antes de guardar uma nova ordem pessoal.");return;}
    const personal:SavedProjectView={id:active?.id ?? crypto.randomUUID(),name:active?.name ?? "Ordem pessoal",view:projectView,relevance:projectRelevance,query,sort:"MANUAL",stateFilter:projectStateFilter,tagFilter:projectTagFilter,personFilter:projectPersonFilter,circleFilter:projectCircleFilter,roleFilter:projectRoleFilter,grouping:projectGrouping,orderIds,visibleProperties:visibleProjectProperties,archived:archiveScope};
    setBusy(true); setError("");
    try {
      const result=await c.api<{views:SavedProjectView[];version:number}>(base+"/project-views",{method:"POST",body:{views:[personal,...savedProjectViews.filter((saved)=>saved.id!==personal.id)]},version:savedProjectViewsVersion});
      setSavedProjectViews(result.data.views); setSavedProjectViewsVersion(result.data.version);
      setProjectOrder(orderIds); setActiveProjectViewId(personal.id);
      personalOrderFocus.current=source;
      c.notify("Ordem pessoal salva.");
    } catch(error) {setError(formatWorkError(error));}
    finally {setBusy(false);}
  };
  const manualOrderControls = (project:Project,peers:Project[]) => {
    if(guest || projectSort !== "MANUAL") return null;
    const index=peers.findIndex((item)=>item.id===project.id);
    return <div className="mare-personal-order-controls" role="group" aria-label={`Ordem pessoal de ${project.title}`}>
      <button type="button" data-order-project-id={project.id} className="mare-icon-button" disabled={busy || index<=0} aria-label={`Mover projeto ${project.title} para cima`} onClick={()=>void persistProjectOrder(project.id,peers[index-1].id,"before")}><ArrowUp size={16}/></button>
      <button type="button" data-order-project-id={project.id} className="mare-icon-button" disabled={busy || index<0 || index>=peers.length-1} aria-label={`Mover projeto ${project.title} para baixo`} onClick={()=>void persistProjectOrder(project.id,peers[index+1].id,"after")}><ArrowDown size={16}/></button>
      <button type="button" className="mare-icon-button mare-order-grip" disabled={busy} draggable={!busy} aria-label={`Arrastar ordem pessoal de ${project.title}`} title="Arrastar para reordenar · use as setas para teclado e toque" onDragStart={(event)=>{event.stopPropagation();setDraggedCatalogId(project.id);event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("application/x-orgmap-project-order",project.id);}} onDragEnd={()=>setDraggedCatalogId(null)}><GripVertical size={17}/></button>
    </div>;
  };
  const acceptProjectOrderDrop = (event:DragEvent<HTMLElement>,target:string) => {
    if(!draggedCatalogId || guest || projectSort !== "MANUAL") return;
    event.preventDefault();event.stopPropagation();
    const source=draggedCatalogId;setDraggedCatalogId(null);
    void persistProjectOrder(source,target,"before");
  };
  const hasProjectProperty = (property:ProjectProperty) => visibleProjectProperties.includes(property);
  const projectPropertyWidths = {state:120,participants:120,due:115,progress:170};
  const orderedProperties = defaultProjectProperties.filter(hasProjectProperty);
  const collectionColumns = `minmax(220px,1fr) ${orderedProperties.map((property)=>`${projectPropertyWidths[property]}px`).join(" ")} 110px`;
  const collectionWidth = 40+220+110+orderedProperties.reduce((sum,property)=>sum+projectPropertyWidths[property],0)+16*(orderedProperties.length+1)+16+(projectSort === "MANUAL" && !guest ? 120 : 0);
  const participantNames = (project:Project) => (project.contextLinks ?? []).filter((link)=>link.kind === "PARTICIPANT").map((link)=>memberName(link.targetId));
  const projectPeopleFields = (project: Project) => ([['PARTICIPANT','Participantes'],['FOLLOWER','Acompanhamento sem notificações']] as const).map(([kind,label]) => {
    const links = (project.contextLinks ?? []).filter(link => link.kind === kind);
    return links.length ? <div key={kind}><dt>{label}</dt><dd>{links.map(link=>memberName(link.targetId)).join(', ')}</dd></div> : null;
  });
  const projectParticipants = (project:Project) => {
    const names=participantNames(project);
    return <span className="mare-project-participants">{guest ? <span className="mare-no-participants">Identidades não compartilhadas</span> : names.length ? <span className="mare-participant-avatars" role="img" aria-label={`Participantes: ${names.join(", ")}`} title={names.join(", ")}>{names.slice(0,3).map((name,index)=><span className="mare-participant-avatar" key={index} aria-hidden="true">{name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]).join("")}</span>)}{names.length>3 && <span className="mare-participant-avatar" aria-hidden="true">+{names.length-3}</span>}</span> : <span className="mare-no-participants mare-empty-value"><span aria-hidden="true">—</span><span className="work-sr-only">Sem participantes</span></span>}</span>;
  };
  const projectFilterCount = [projectPersonFilter, projectCircleFilter, projectRoleFilter, projectStateFilter, projectTagFilter].filter(Boolean).length;
  const clearProjectFilters = () => { setProjectPersonFilter(""); setProjectCircleFilter(""); setProjectRoleFilter(""); setProjectStateFilter(""); setProjectTagFilter(""); setQuery(""); };
  const selectableProjects = visibleProjects.filter((project) => project.accessRole === "MANAGER" && !policy?.lockProjectConfiguration);
  const allProjectsSelected = selectableProjects.length > 0 && selectableProjects.every((project) => selectedProjects.includes(project.id));
  const showNew = () => {
    setParent(null);
    setModal("task");
  };
  if (guest && (settingsPage || statsPage))
    return (
      <div className="notice" role="status">
        Esta área exige participação como membro da organização.
      </div>
    );
  if (statsPage)
    return <WorkStatisticsView context={c} formatError={formatWorkError} />;
  if (settingsPage)
    return <WorkSettingsView context={c} formatError={formatWorkError} />;
  if (pid || tid) {
    const status = resourceLoad?.scope === resourceScope ? resourceLoad.status : "loading";
    if (status !== "available") return (
      <div className="work-root mare-work">
        {status === "loading" ? <div className="mare-loading" role="status" aria-busy="true"><i/><i/><i/><i/><i/><span className="work-sr-only">{text("Carregando trabalho…")}</span></div> :
          <section className="work-resource-state" aria-labelledby="work-resource-state-title">
            <h2 id="work-resource-state-title">{text(status === "unavailable" ? "Conteúdo indisponível" : "Não foi possível carregar")}</h2>
            <p>{text(status === "unavailable" ? "Este conteúdo não existe ou não está disponível para sua conta nesta organização." : "Não foi possível carregar este conteúdo agora. Tente novamente.")}</p>
            <div className="work-resource-actions">
              <button type="button" onClick={() => c.navigate(guest ? "/projects/tasks" : "/projects")}>{text(guest ? "Ir para tarefas compartilhadas" : "Ir para projetos")}</button>
              {status === "error" && <button type="button" onClick={refresh}>{text("Tentar novamente")}</button>}
            </div>
          </section>}
      </div>
    );
  }
  if (detail) {
    const t = detail.task,
      edit = detail.capabilities.edit;
    return (
      <div className="work-root mare-work">
        <header className="page-heading work-task-page-heading">
          <nav className="mare-project-breadcrumb" aria-label="Caminho da tarefa">
            <button
              type="button"
              className="work-task-back"
              aria-label={text("Voltar") + ": " + (t.projectId ? projectTitle(t.projectId) : text(guest ? "Tarefas compartilhadas" : "Minhas tarefas"))}
              onClick={() =>
                c.navigate(
                  t.projectId ? "/projects/" + t.projectId : "/projects/tasks",
                )
              }
            >
              <ArrowLeft size={15} aria-hidden="true" />
              <span>{t.projectId ? projectTitle(t.projectId) : text(guest ? "Tarefas compartilhadas" : "Minhas tarefas")}</span>
            </button>
            <ChevronRight size={14} aria-hidden="true" />
            <span aria-current="page">{t.title}</span>
          </nav>
          <h2 className="work-sr-only">{text("Tarefa")}</h2>
        </header>
        <TraceReturnLink context={c} returnTo={new URLSearchParams(c.path.split("?")[1] ?? "").get("returnTo")} disabled={busy} />
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
        <article className="work-task-detail">
          <div className="work-detail-heading">
            <span className={"work-dot work-" + t.status.toLowerCase()} />
            <h1>{t.title}</h1>
            {edit && (
              <button disabled={busy} onClick={() => setModal("edit")}>
                {text("Editar")}
              </button>
            )}
          </div>
          <p className="muted">
            {!guest && t.projectId && projects.some(project=>project.id===t.projectId)
              ? <button className="work-project-context" onClick={()=>c.navigate(`/projects/${t.projectId}`)}>{projectTitle(t.projectId)}</button>
              : projectTitle(t.projectId)} · {taskStateName(t)}
          </p>
          {!t.archived && !t.archivedByAncestor && <TraceOrigin context={c} endpoint={`${base}/tasks/${t.id}/origin`} returnTo={`/projects/tasks/${t.id}`} disabled={busy} />}
          {guest && (
            <p className="work-sharing-note">
              {text(
                "Esta leitura inclui apenas os itens compartilhados com você.",
              )}
            </p>
          )}
          {(t.archived||t.archivedByAncestor) && <div className="notice" role="status"><p>Leitura de conteúdo arquivado. Conversa, atribuições e relações completas ficam disponíveis após restaurar.</p>{t.archivedByAncestor && t.parentId ? <button onClick={()=>c.navigate(`/projects/tasks/${t.parentId}?archived=1`)}>Ver tarefa superior arquivada</button> : !guest && (t.projectId ? projects.some((project)=>project.id===t.projectId&&["MANAGER","EDITOR"].includes(project.accessRole ?? "")&&!project.frozen) : t.creatorId===c.bootstrap.membership.id) && <button disabled={busy} onClick={async()=>{if(await mutate(`/tasks/${t.id}/restore`,{},t.version))c.navigate("/projects/tasks/"+t.id);}}>Restaurar tarefa</button>}</div>}
          <dl className="work-properties work-task-facts">
            <div className="work-task-fact-state">
              <dt>{text("Estado")}</dt>
              <dd><span className={"work-dot work-" + t.status.toLowerCase()} aria-hidden="true" />{taskStateName(t)}</dd>
            </div>
            <div className="work-task-fact-assignees">
              <dt>Responsáveis</dt>
              <dd>
                <TaskAssigneesView context={c} value={detail} guest={guest} />
              </dd>
            </div>
            <div>
              <dt>{text("Início")}</dt>
              <dd>{t.startsAt ? dateLabel(t.startsAt) : <span className="mare-empty-value">—</span>}</dd>
            </div>
            <div>
              <dt>{text("Vencimento")}</dt>
              <dd>{t.endsAt ? dateLabel(t.endsAt) : <span className="mare-empty-value">—</span>}</dd>
            </div>
            <TaskPropertiesView value={t} present />
            <CustomFieldValues context={c} value={t.customFields} rows/>
            {t.duplicateOf && (
              <div>
                <dt>Duplicata de</dt>
                <dd>
                  <button
                    onClick={() =>
                      c.navigate("/projects/tasks/" + t.duplicateOf)
                    }
                  >
                    {taskName(t.duplicateOf)}
                  </button>
                </dd>
              </div>
            )}
          </dl>
          <TaskPropertiesMissing value={t} />
          {t.dateProvenance === "SYNTHETIC_TEST" && (
            <p className="muted">Datas sintéticas de teste.</p>
          )}
          <div className={"work-description" + (t.descriptionRich || t.description ? "" : " is-empty")}>
            {t.descriptionRich || t.description ? (
              <RichTextView value={t.descriptionRich ?? t.description} />
            ) : (
              <p className="mare-empty-value">{text("Nenhuma descrição.")}</p>
            )}
          </div>
          {detail.capabilities.assign && (
            <details className="work-assignment-editor mare-disclosure quiet">
              <summary>{text("Editar responsáveis")}</summary>
            <TaskAssignmentsEditor
              key={"assignments:" + t.id + ":" + t.version}
              context={c}
              value={detail}
              roleEnabled={!!detail.capabilities.roleAssignment}
              pending={busy}
              onSave={(principals) =>
                mutate(
                  "/tasks/" + t.id + "/assignments",
                  { principals },
                  t.version,
                )
              }
            />
            </details>
          )}
          <PlanningIntentView value={t.planningIntent}/>{!guest&&<ExternalWorkLinks draftKey={draftPrefix+":external-links:task:"+t.id} type="task" id={t.id} version={t.version} links={t.externalLinks} editable={edit} command={mutate} pending={busy}/>}
          {!guest && !t.archived && !t.archivedByAncestor && <details className="mare-project-resources mare-disclosure"><summary>Histórico desta tarefa</summary><WorkActivity context={c} type="task" id={t.id}/></details>}
          <details className="mare-task-legacy-checklist mare-disclosure quiet"><summary>Checklist simples{detail.checklist.length?' · '+detail.checklist.length:''}</summary><section>
            <h3 className="mare-sr-only">Checklist</h3>
            {detail.checklist.map((item) => (
              <label key={item.id} className="work-check">
                <input
                  type="checkbox"
                  disabled={!edit || busy}
                  checked={item.done}
                  onChange={() =>
                    mutate(
                      "/tasks/" + t.id + "/checklist",
                      { itemId: item.id, done: !item.done },
                      t.version,
                    )
                  }
                />
                {item.title}
              </label>
            ))}
            {edit && (
              <form
                className="work-inline"
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await mutate(
                      "/tasks/" + t.id + "/checklist",
                      { title: f.get("title") },
                      t.version,
                    );
                  })
                }
              >
                <input
                  name="title"
                  required
                  maxLength={200}
                  aria-label="Novo item do checklist"
                  placeholder="Adicionar item"
                />
                <button disabled={busy}>Adicionar</button>
              </form>
            )}
          </section></details>
          {!guest&&<ProjectChecklists type="task" context={c} project={t} editable={edit} command={mutate} pending={busy}/>}
          {!t.archived && !t.archivedByAncestor && <section>
            <div className="section-heading">
              <h3>
                {guest ? "Subtarefas compartilhadas" : "Subtarefas"} ·{" "}
                {detail.subtasks.filter((s) => s.status === "DONE").length}/
                {detail.subtasks.length}
              </h3>
              {edit && (
                <button
                  onClick={() => {
                    setParent(t.id);
                    setModal("task");
                  }}
                >
                  Adicionar subtarefa
                </button>
              )}
            </div>
            {[
              ...(detail.groups ?? []),
              { id: "", name: "Sem grupo", position: 0 },
            ].map((g) => {
              const children = detail.subtasks.filter(
                (s) => (s.subtaskGroupId ?? "") === g.id,
              );
              return (
                <div className="work-subtask-group" key={g.id}>
                  {(g.id || detail.groups?.length > 0) && (
                    <h4>
                      {g.name}{" "}
                      <small>
                        {children.filter((s) => s.status === "DONE").length}/
                        {children.length} concluídas
                      </small>
                    </h4>
                  )}
                  {children.map((s) => (
                    <button
                      key={s.id}
                      className="entity-row"
                      onClick={() => open(s)}
                    >
                      {s.title}
                      <small>{text(states[s.status])}</small>
                    </button>
                  ))}
                  {edit && g.id && (
                    <details className="mare-disclosure quiet">
                      <summary>Editar grupo</summary>
                      <form
                        className="work-inline work-wrap"
                        onSubmit={(e) =>
                          submit(e, async (f) => {
                            await mutate(
                              "/tasks/" + t.id + "/groups/" + g.id,
                              {
                                name: f.get("name"),
                                position: Number(f.get("position")),
                              },
                              t.version,
                              "PATCH",
                            );
                          })
                        }
                      >
                        <Field label="Nome do grupo">
                          <input
                            name="name"
                            required
                            maxLength={200}
                            defaultValue={g.name}
                          />
                        </Field>
                        <Field label="Posição do grupo">
                          <input
                            name="position"
                            type="number"
                            defaultValue={g.position}
                          />
                        </Field>
                        <button disabled={busy}>Salvar grupo</button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            mutate(
                              "/tasks/" + t.id + "/groups/" + g.id,
                              undefined,
                              t.version,
                              "DELETE",
                            )
                          }
                        >
                          Remover grupo vazio
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              );
            })}
            {edit && (
              <form
                className="work-inline"
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await mutate(
                      "/tasks/" + t.id + "/groups",
                      {
                        name: f.get("name"),
                        position: detail.groups?.length ?? 0,
                      },
                      t.version,
                    );
                  })
                }
              >
                <Field label="Novo grupo de subtarefas">
                  <input name="name" required maxLength={200} />
                </Field>
                <button disabled={busy}>Criar grupo</button>
              </form>
            )}
          </section>}
          {!t.archived && !t.archivedByAncestor && <section className="work-comments-thread">
            <ResourcePanel context={c} type="task" resourceId={t.id} />
          </section>}
          {!t.archived && !t.archivedByAncestor && <details className="work-advanced">
            <summary>{text("Dependências e vínculos")}</summary>
          <section>
            <h3>{guest ? "Dependências compartilhadas" : "Dependências"}</h3>
            {detail.dependencies.map((d) => (
              <div
                className="work-dependency"
                key={d.predecessorId + d.successorId}
              >
                <button
                  onClick={() =>
                    c.navigate(
                      "/projects/tasks/" +
                        (d.predecessorId === t.id
                          ? d.successorId
                          : d.predecessorId),
                    )
                  }
                >
                  {d.predecessorId === t.id ? "Sucessora: " : "Predecessora: "}
                  {taskName(
                    d.predecessorId === t.id ? d.successorId : d.predecessorId,
                  )}
                </button>
                <small>
                  {d.type} · {d.lagMinutes} min
                </small>
                {edit && d.successorId === t.id && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        "/tasks/" + t.id + "/dependencies/" + d.predecessorId,
                        undefined,
                        t.version,
                        "DELETE",
                      )
                    }
                  >
                    Remover
                  </button>
                )}
              </div>
            ))}
            {edit && (
              <form
                className="work-inline work-wrap"
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await mutate(
                      "/tasks/" + t.id + "/dependencies",
                      {
                        predecessorId: f.get("predecessorId"),
                        type: f.get("type"),
                        lagMinutes: Number(f.get("lagMinutes")),
                      },
                      t.version,
                    );
                  })
                }
              >
                <Field label="Predecessora">
                  <select name="predecessorId" required>
                    <option value="">Selecionar tarefa</option>
                    {tasks
                      .filter(
                        (x) => x.id !== t.id && x.projectId === t.projectId,
                      )
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Tipo">
                  <select name="type">
                    <option value="FS">Fim → início (FS)</option>
                    <option value="FF">Fim → fim (FF)</option>
                    <option value="SS">Início → início (SS)</option>
                    <option value="SF">Início → fim (SF)</option>
                  </select>
                </Field>
                <Field label="Intervalo em minutos">
                  <input
                    name="lagMinutes"
                    type="number"
                    defaultValue="0"
                    min="-5256000"
                    max="5256000"
                  />
                </Field>
                <button disabled={busy}>Vincular dependência</button>
              </form>
            )}
          </section>
          <section>
            <h3>{guest ? "Vínculos compartilhados" : "Vínculos"}</h3>
            {detail.links.map((l) => (
              <button
                key={l.id}
                className="entity-row"
                onClick={() => c.navigate("/projects/tasks/" + l.targetTaskId)}
              >
                {taskName(l.targetTaskId)}
              </button>
            ))}
            {edit && (
              <form
                className="work-inline"
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await mutate(
                      "/tasks/" + t.id + "/links",
                      { targetTaskId: f.get("targetTaskId") },
                      t.version,
                    );
                  })
                }
              >
                <Field label="Vincular tarefa">
                  <select name="targetTaskId" required>
                    <option value="">Selecionar tarefa</option>
                    {tasks
                      .filter((x) => x.id !== t.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                  </select>
                </Field>
                <button disabled={busy}>Vincular</button>
              </form>
            )}
          </section>
          </details>}
          {edit && (
            <section className="work-inline work-wrap">
              <button onClick={() => setModal("duplicate")}>
                Duplicar tarefa
              </button>
              <button onClick={() => setModal("mark")}>
                Marcar como duplicata
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    await mutate(
                      "/tasks/" + t.id,
                      { archived: true },
                      t.version,
                      "PATCH",
                    )
                  )
                    c.navigate(
                      t.projectId
                        ? "/projects/" + t.projectId
                        : "/projects/tasks",
                    );
                }}
              >
                Arquivar
              </button>
            </section>
          )}
        </article>
        {modal === "edit" && (
          <Modal
            error={error}
            title={text("Editar tarefa")}
            close={() => setModal("")}
          >
            <DraftForm draftKey={draftPrefix + ":edit-task:" + t.id}
              className="edit-form"
              onSubmit={(e) =>
                submit(e, async (f) => {
                  if (
                    await mutate(
                      "/tasks/" + t.id,
                      {
                        title: f.get("title"),
                        ...descriptionPayload(f),
                        ...taskPropertiesPayload(f),
                        customFields: customFieldsPayload(f),
                        planningIntent:planningIntentPayload(f),
                        ...(String(f.get("status")).startsWith("custom:") ? {customStatusId: String(f.get("status")).slice(7)} : {status: f.get("status")}),
                        sectionId: f.get("sectionId") || null,
                        groupId: f.get("groupId") || null,
                        startsAt: workDateTimeFromForm(f, "startsAt", prefs),
                        endsAt: workDateTimeFromForm(f, "endsAt", prefs),
                      },
                      t.version,
                      "PATCH",
                    )
                  ) {
                    clearDraft(draftPrefix + ":edit-task:" + t.id + ":title");
                    clearDraft(draftPrefix + ":edit-task:" + t.id + ":description"); clearFormDraft(draftPrefix + ":edit-task:" + t.id);
                    setModal("");
                  }
                })
              }
            >
              <Field label="Título">
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={readDraft(draftPrefix + ":edit-task:" + t.id + ":title") ?? t.title}
                  onChange={(e) => writeDraft(draftPrefix + ":edit-task:" + t.id + ":title", e.target.value)}
                />
              </Field>
              <DescriptionEditor
                key={t.id + ":" + t.version}
                value={t.descriptionRich ?? t.description}
                pending={busy}
                draftKey={draftPrefix + ":edit-task:" + t.id + ":description"}
              />
              <TaskPropertiesFields
                key={"properties:" + t.id + ":" + t.version}
                value={t}
                pending={busy}
              />
              <CustomFieldInputs context={c} value={t.customFields} /><PlanningIntentFields value={t.planningIntent}/>
              <Field label="Estado">
                <select name="status" defaultValue={t.customStatusId ? "custom:" + t.customStatusId : t.status}>
                  {Object.entries(states).map(([key, label]) => (
                    <option key={key} value={key}>
                      {text(label)}
                    </option>
                  ))}
                  {(projects.find((p) => p.id === t.projectId)?.taskStates ?? []).map((state) => <option key={state.id} value={"custom:" + state.id}>{state.name}</option>)}
                </select>
              </Field>
              {/* Sections loaded with selected task project below. */}
              <TaskSections
                context={c}
                projectId={t.projectId}
                selected={t.sectionId}
              />
              {t.parentId && (
                <TaskGroupField
                  context={c}
                  parentId={t.parentId}
                  selected={t.subtaskGroupId ?? null}
                />
              )}
              <DateFields task={t} pending={busy} draftKey={draftPrefix + ":edit-task:" + t.id} />
              <div className="form-actions">
                <button disabled={busy} className="primary">
                  {text("Salvar tarefa")}
                </button>
              </div>
            </DraftForm>
          </Modal>
        )}
        {modal === "task" && (
          <Modal
            error={error}
            title="Nova subtarefa"
            close={() => setModal("")}
          >
            <DraftForm draftKey={draftPrefix + ":new-subtask:" + t.id}
              className="edit-form"
              onSubmit={(e) =>
                submit(e, async (f) => {
                  const result = await mutate("/tasks", {
                    title: f.get("title"),
                    ...descriptionPayload(f),
                    ...taskPropertiesPayload(f),
                    customFields:customFieldsPayload(f),planningIntent:planningIntentPayload(f),
                    projectId: t.projectId,
                    parentId: t.id,
                    groupId: f.get("groupId") || null,
                    startsAt: workDateTimeFromForm(f, "startsAt", prefs),
                    endsAt: workDateTimeFromForm(f, "endsAt", prefs),
                  });
                  if (result) {
                    clearDraft(draftPrefix + ":new-subtask:" + t.id + ":title");
                    clearDraft(draftPrefix + ":new-subtask:" + t.id + ":description"); clearFormDraft(draftPrefix + ":new-subtask:" + t.id);
                    setModal("");
                  }
                })
              }
            >
              <NewTaskFields context={c} pending={busy} draftKey={draftPrefix + ":new-subtask:" + t.id} />
              <Field label="Grupo de subtarefas">
                <select name="groupId">
                  <option value="">Sem grupo</option>
                  {(detail.groups ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
              <DateFields pending={busy} draftKey={draftPrefix + ":new-subtask:" + t.id} />
              <button className="primary" disabled={busy}>
                Criar subtarefa
              </button>
            </DraftForm>
          </Modal>
        )}
        {(modal === "duplicate" || modal === "mark") && (
          <Modal
            error={error}
            title={
              modal === "duplicate" ? "Duplicar tarefa" : "Marcar duplicata"
            }
            close={() => setModal("")}
          >
            <form
              className="edit-form"
              onSubmit={(e) =>
                submit(e, async (f) => {
                  const result = await mutate(
                    "/tasks/" +
                      t.id +
                      (modal === "duplicate"
                        ? "/duplicate"
                        : "/mark-duplicate"),
                    modal === "duplicate"
                      ? { title: f.get("title"), includeSubtasks: f.get("includeSubtasks") === "on" }
                      : { primaryId: f.get("primaryId") || null },
                    t.version,
                  );
                  if (result) {
                    setModal("");
                    if (modal === "duplicate") open(result.task);
                  }
                })
              }
            >
              {modal === "duplicate" ? (
                <Field label="Título da cópia">
                  <input
                    name="title"
                    maxLength={200}
                    required
                    defaultValue={t.title + " (cópia)"}
                  />
                </Field>
              ) : (
                <Field label="Tarefa principal">
                  <select name="primaryId">
                    <option value="">Remover marcação</option>
                    {tasks
                      .filter((x) => x.id !== t.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              {modal === "duplicate" && <label className="work-check"><input type="checkbox" name="includeSubtasks" defaultChecked /> Incluir subtarefas e vínculos entre elas</label>}
              <button className="primary" disabled={busy}>
                Confirmar
              </button>
            </form>
          </Modal>
        )}
      </div>
    );
  }
  const projectPage = !!pid && !embeddedProject;
  const manageProject = pd?.capabilities.manage && !policy?.lockProjectConfiguration;
  const taskCountLabel = text(
    guest
      ? new Intl.PluralRules(locale).select(filtered.length) === "one"
        ? "{count} tarefa compartilhada"
        : "{count} tarefas compartilhadas"
      : new Intl.PluralRules(locale).select(filtered.length) === "one"
        ? "{count} tarefa"
        : "{count} tarefas",
    { count: formatNumber(filtered.length) },
  );
  const taskArchiveToggle = !guest && (
    <button
      type="button"
      className="mare-archive-toggle"
      onClick={() => pid ? setTaskArchiveMode(taskArchiveMode === "ACTIVE" ? "ARCHIVED" : "ACTIVE") : setArchiveScope(!archiveScope)}
    >
      {(pid ? taskArchiveMode !== "ACTIVE" : archiveScope) ? "Ver tarefas ativas" : "Ver tarefas arquivadas"}
    </button>
  );

  return (
    <div className={"work-root mare-work " + (projectPage ? "mare-project-detail-page" : "")}>
      {projectPage ? (
        <header className="mare-project-page-header">
          <nav className="mare-project-breadcrumb" aria-label="Caminho do projeto">
            <button type="button" onClick={() => c.navigate("/projects")}>Projetos</button>
            <ChevronRight size={14} aria-hidden="true" />
            <span aria-current="page">{pd?.project.title ?? "Projeto"}</span>
          </nav>
          <div className="mare-project-page-heading">
            <div className="mare-project-page-identity">
              <h2>{pd?.project.title ?? "Projeto"}</h2>
              {pd && <div className="mare-project-page-properties">
                <ProjectContextLine context={c} project={pd.project} />
                <span className="badge">{text(pd.project.visibility === "PRIVATE" ? "Privado" : "Público na organização")}</span>
              </div>}
            </div>
            {pd && <div className="mare-project-page-actions">
              {projectStatusControl(pd.project, !!manageProject)}
              {manageProject && <div className="mare-project-page-management">
                <button type="button" onClick={() => setProjectDialog("edit")}><Pencil size={16} />Editar projeto</button>
                <ProjectActionMenu items={[
                  { label: "Duplicar projeto", icon: <Copy size={16} />, action: () => setProjectDialog("duplicate") },
                  ...(c.bootstrap.membership.orgRole === "OWNER" ? [{ label: "Salvar como modelo", icon: <FilePlus2 size={16} />, action: () => setProjectDialog("template") }] : []),
                  { label: "Configurações e acesso", icon: <Settings2 size={16} />, action: () => setSettings(true) },
                ]} />
              </div>}
            </div>}
          </div>
          {pd && <>
            <div className="mare-project-page-origin">
              <TraceOrigin context={c} endpoint={`${base}/projects/${pid}/origin`} returnTo={`/projects/${pid}`} disabled={busy} />
              <TraceReturnLink context={c} returnTo={new URLSearchParams(c.path.split("?")[1] ?? "").get("returnTo")} disabled={busy} />
            </div>
            <nav className="mare-project-page-tabs" aria-label="Seções do projeto">
              {([["content", "Visão geral"], ["tasks", "Tarefas"], ["conversation", "Conversa"], ["activity", "Histórico"]] as const)
                .filter(([id]) => !guest || id !== "activity")
                .map(([id, label]) => (
                  <button type="button" key={id} aria-pressed={!settings && projectPageTab === id} onClick={() => { setSettings(false); setProjectPageTab(id); }}>{label}</button>
                ))}
              {settings && <button type="button" aria-pressed>Configurações e acesso</button>}
            </nav>
          </>}
        </header>
      ) : !embeddedProject && <header className="page-heading">
        {browse && (!guest ? <nav className="mare-project-relevance" aria-label="Relevância dos projetos">{([["MINE", "Meus projetos", Users], ["CIRCLES", "Meus círculos", Folder], ["ALL", "Todos", Layers]] as const).map(([key, label, RelevanceIcon]) => <button key={key} aria-pressed={projectRelevance === key} onClick={() => setProjectRelevance(key)}><RelevanceIcon size={18}/>{label}</button>)}</nav> : <span className="mare-project-organization">{c.bootstrap.organization.name}</span>)}
        <h2>
          {statsPage
            ? text("Estatísticas")
            : browse
              ? text("Projetos")
              : (pd?.project.title ??
                text(guest ? "Tarefas compartilhadas" : "Minhas tarefas"))}
        </h2>
        <span className="toolbar-spacer" />
        {browse && !guest && <button className="primary mare-new-project" onClick={() => setModal("project")}><Plus size={18}/>{text("Novo projeto")}</button>}
      </header>}
      {error && (
        <div className="notice" role="alert">
          {error}
          <button onClick={refresh}>Atualizar dados</button>
        </div>
      )}
      {loading ? (
        <div className="mare-loading" role="status" aria-busy="true">
          <i /><i /><i /><i /><i />
          <span className="work-sr-only">{text("Carregando trabalho…")}</span>
        </div>
      ) : browse ? (
        <>
          <div className="mare-project-controls">
            <div className="mare-catalog-toolbar">
              <label className="mare-catalog-search"><Search size={19}/><input ref={projectSearchRef} aria-label={text("Pesquisar projetos")} placeholder="Encontrar um projeto…" value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button className="mare-icon-button" aria-label="Limpar pesquisa" onClick={() => setQuery("")}><X size={16}/></button>}</label>
              {!guest && (
                <CatalogPopover label="Filtros" title="Refinar projetos" icon={<Filter size={17}/>} count={projectFilterCount}>
                  <Field label="Pessoa"><select value={projectPersonFilter} onChange={(e)=>setProjectPersonFilter(e.target.value)}><option value="">Todas as pessoas</option>{c.members.filter((m)=>m.status === "ACTIVE").map((m)=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></Field>
                  <Field label="Círculo"><select value={projectCircleFilter} onChange={(e)=>setProjectCircleFilter(e.target.value)}><option value="">Todos os círculos</option>{c.structure.nodes.filter((n)=>n.kind === "CIRCLE").map((n)=><option key={n.entityId} value={n.entityId}>{n.name}</option>)}</select></Field>
                  <Field label="Papel"><select value={projectRoleFilter} onChange={(e)=>setProjectRoleFilter(e.target.value)}><option value="">Todos os papéis</option>{projectRoleFilter && !c.structure.nodes.some((node)=>node.kind === "ROLE" && node.entityId === projectRoleFilter) && <option value={projectRoleFilter}>Papel indisponível</option>}{c.structure.nodes.filter((node)=>node.kind === "ROLE").map((node)=><option key={node.entityId} value={node.entityId}>{projectEntityName(node.entityId)}</option>)}</select></Field>
                  <Field label="Estado"><select value={projectStateFilter} onChange={(e) => setProjectStateFilter(e.target.value)}><option value="">Todos os estados</option><option value="none">Sem estado</option>{projectStates.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}</select></Field>
                  <Field label="Tag"><input value={projectTagFilter} placeholder="Encontrar uma tag" onChange={(e) => setProjectTagFilter(e.target.value)}/></Field>
                  <button className="mare-text-button" onClick={clearProjectFilters}>Limpar filtros e pesquisa</button>
                </CatalogPopover>
              )}
            </div>
            <div className="mare-catalog-viewbar">
              <button
                type="button"
                className="mare-catalog-presentation-toggle"
                aria-expanded={catalogPresentationOpen}
                aria-controls={catalogPresentationId}
                onClick={() => setCatalogPresentationOpen((open) => !open)}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                <span>Apresentação · {{ LIST: "Lista", BOARD: "Kanban", GALLERY: "Galeria" }[projectView]}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              <div id={catalogPresentationId} className="mare-catalog-presentation">
                <div className="mare-project-view-controls" role="group" aria-label="Visualização de projetos">
                  <button aria-pressed={projectView === "LIST"} onClick={() => setProjectView("LIST")}><List size={17}/>Lista</button>
                  {!guest && <button aria-pressed={projectView === "BOARD"} onClick={() => setProjectView("BOARD")}><Columns3 size={17}/>Kanban</button>}
                  <button aria-pressed={projectView === "GALLERY"} onClick={() => setProjectView("GALLERY")}><LayoutGrid size={17}/>Galeria</button>
                </div>
                {!guest && <CatalogPopover label="Visualização" title="Organizar a vista" icon={<SlidersHorizontal size={17}/>}>
                  <Field label="Agrupar"><select value={projectGrouping} onChange={(e) => setProjectGrouping(e.target.value as ProjectGrouping)}><option value="NONE">Sem agrupamento</option><option value="STATE">Estado</option><option value="CIRCLE">Círculo</option><option value="PERSON">Participante</option><option value="ROLE">Papel</option><option value="TAG">Tag</option><option value="SECTION">Seção do projeto</option></select><small className="mare-grouping-help">{projectView === "BOARD" ? "Kanban organiza os projetos por estado. O agrupamento escolhido vale para lista e galeria." : projectGroupingHint[projectGrouping]}</small></Field>
                  <Field label="Ordenar"><select value={projectSort} onChange={(e) => setProjectSort(e.target.value as ProjectSort)}><option value="MANUAL">Manual · ordem pessoal</option><option value="TITLE">Nome A–Z</option><option value="DUE">Prazo mais próximo</option><option value="PROGRESS">Maior progresso</option><option value="PRIORITY">Prioridade</option></select></Field>
                  <fieldset className="mare-property-options"><legend>Propriedades visíveis</legend>{([["state","Estado"],["participants","Participantes"],["due","Prazo"],["progress","Progresso"]] as const).map(([property,label])=><label className="work-check" key={property}><input type="checkbox" checked={hasProjectProperty(property)} onChange={(event)=>setVisibleProjectProperties((current)=>event.target.checked ? [...current,property] : current.filter((item)=>item!==property))}/>{label}</label>)}<small>Nome, seleção e acesso permanecem visíveis. No Kanban, o estado continua no cabeçalho da coluna.</small><button type="button" className="mare-text-button" onClick={()=>setVisibleProjectProperties([...defaultProjectProperties])}>Restaurar propriedades</button></fieldset>
                  <label className="work-check"><input type="checkbox" checked={archiveScope} onChange={(e) => setArchiveScope(e.target.checked)}/><Archive size={16}/>Mostrar arquivados</label>
                  {c.bootstrap.membership.orgRole === "OWNER" && <button className="mare-text-button" onClick={() => setModal("project-states")}><Settings2 size={17}/>Configurar estados</button>}
                  <button className="mare-text-button" onClick={() => c.navigate("/projects/settings")}><Settings2 size={17}/>Configurações de trabalho</button>
                </CatalogPopover>}
              {!guest && <CatalogPopover label="Vistas salvas" title="Voltar a um recorte" icon={<Bookmark size={17}/>}>{savedProjectViews.map((saved) => <div className="work-access" key={saved.id}><button onClick={() => applyProjectView(saved)}>{saved.name}</button><button disabled={busy} aria-label={`Remover vista ${saved.name}`} onClick={() => void mutate("/project-views",{views:savedProjectViews.filter((item)=>item.id!==saved.id)},savedProjectViewsVersion)}>Remover</button></div>)}<form className="work-inline" onSubmit={async(e) => {e.preventDefault();const result=await mutate("/project-views",{views:[{id:crypto.randomUUID(),name:newProjectViewName,view:projectView,relevance:projectRelevance,query,sort:projectSort,stateFilter:projectStateFilter,tagFilter:projectTagFilter,personFilter:projectPersonFilter,circleFilter:projectCircleFilter,roleFilter:projectRoleFilter,grouping:projectGrouping,orderIds:projectSort === "MANUAL" ? currentProjectOrder : [],visibleProperties:visibleProjectProperties,archived:archiveScope},...savedProjectViews]},savedProjectViewsVersion);if(result){setNewProjectViewName("");setActiveProjectViewId(result.views[0]?.id ?? null);}}}><Field label="Nome da vista"><input required maxLength={100} value={newProjectViewName} onChange={(e)=>setNewProjectViewName(e.target.value)} /></Field><button disabled={busy}>Salvar vista atual</button></form></CatalogPopover>}
              </div>
              <span className="mare-catalog-count" role="status">{text(archiveScope ? (visibleProjects.length === 1 ? "{count} projeto arquivado" : "{count} projetos arquivados") : (visibleProjects.length === 1 ? "{count} projeto" : "{count} projetos"), {count: formatNumber(visibleProjects.length)})}</span>
            </div>
            {(projectFilterCount > 0 || query) && <div className="mare-active-filters"><Filter size={14}/><span>{projectFilterCount > 0 ? `${projectFilterCount} filtro(s) aplicado(s)` : "Pesquisa ativa"}{query ? ` · “${query}”` : ""}</span><button onClick={clearProjectFilters}>Limpar recorte<X size={14}/></button></div>}
          </div>
          {modal === "project-states" && !guest && c.bootstrap.membership.orgRole === "OWNER" && <Modal title="Estados de projetos" close={() => setModal("")} error={error}><div className="mare-project-state-settings"><p>Os estados organizam os projetos; as permissões continuam independentes.</p>{projectStates.map((state) => <div className="work-access" key={state.id}><span>{state.name}</span><button disabled={busy} onClick={() => void mutate("/project-states", {states:projectStates.filter((item) => item.id !== state.id)}, projectStatesVersion)}>Remover</button></div>)}<form className="work-inline work-wrap" onSubmit={async (e) => {e.preventDefault(); const result = await mutate("/project-states", {states:[...projectStates,{id:crypto.randomUUID(),name:newProjectState,semantic:newProjectStateSemantic}]}, projectStatesVersion); if (result) setNewProjectState("");}}><Field label="Nome do estado"><input required maxLength={100} value={newProjectState} onChange={(e) => setNewProjectState(e.target.value)} /></Field><Field label="Função"><select value={newProjectStateSemantic} onChange={(e) => setNewProjectStateSemantic(e.target.value)}>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><button disabled={busy}>Adicionar estado</button></form></div></Modal>}
          {archiveScope ? <section className="mare-archive-list"><header><h3><Archive size={19}/>Projetos arquivados</h3><button className="mare-text-button" onClick={() => setArchiveScope(false)}>Voltar aos ativos</button></header><p className="muted">Arquivo com acesso direto. Busca e filtros usam os dados do projeto; responsáveis de tarefas, progresso e ordem manual de ativos não são projetados aqui. Restaure para abrir o trabalho completo.</p>{visibleProjects.length ? visibleProjects.map((project) => <div key={project.id}><span>{project.title}</span>{project.accessRole === "MANAGER" && <button disabled={busy} onClick={() => void mutate(`/projects/${project.id}/restore`, {}, project.version)}>Restaurar</button>}</div>) : <p>{archivedProjects.length ? "Nenhum projeto arquivado neste recorte. Ajuste os filtros ou a busca." : "Nenhum projeto arquivado com acesso direto."}</p>}</section> : <>
          {projectSort === "MANUAL" && !guest && <p className="mare-personal-order-note" role="status"><GripVertical size={16}/><span>Ordem pessoal{savedProjectViews.find((view)=>view.id===activeProjectViewId)?.name ? ` · ${savedProjectViews.find((view)=>view.id===activeProjectViewId)!.name}` : ""}. Cada movimento é salvo na sua vista. Use as setas ou arraste a alça; o Kanban mantém o arraste do cartão para mudar de estado.</span></p>}
          {selectedProjects.length > 0 && <div className="mare-bulk-actions"><strong>{selectedProjects.length} selecionados</strong><label>Estado <select value={bulkProjectState} onChange={(e)=>setBulkProjectState(e.target.value)}><option value="">Sem estado</option>{projectStates.map((state)=><option key={state.id} value={state.id}>{state.name}</option>)}</select></label><button disabled={busy} onClick={async()=>{const items=projects.filter((p)=>selectedProjects.includes(p.id)).map((p)=>({id:p.id,version:p.version}));if(await mutate("/projects/bulk",{items,projectStateId:bulkProjectState||null}))setSelectedProjects([]);}}>Alterar estado</button><button disabled={busy} onClick={async()=>{const items=projects.filter((p)=>selectedProjects.includes(p.id)).map((p)=>({id:p.id,version:p.version}));if(await mutate("/projects/bulk",{items,archive:true})){setSelectedProjects([]);setSelectedProjectId(null);}}}>Arquivar selecionados</button><button onClick={()=>setSelectedProjects([])}>Limpar seleção</button></div>}
          <div className={"mare-project-workspace " + (selectedProject ? "has-preview " : "") + (projectFocus ? "is-focused" : "")}>
            {projectView === "BOARD" ? <div className="mare-project-board-frame">{!projectStates.length&&<div className="mare-board-setup"><div><h3>Organize o quadro por estado</h3><p>Ainda não há estados de projeto nesta organização.</p></div>{!guest&&c.bootstrap.membership.orgRole==='OWNER'&&<button type="button" className="primary" disabled={busy} onClick={()=>void mutate('/project-states',{states:[{id:crypto.randomUUID(),name:'A fazer',semantic:'TODO'},{id:crypto.randomUUID(),name:'Em andamento',semantic:'IN_PROGRESS'},{id:crypto.randomUUID(),name:'Concluído',semantic:'DONE'}]},projectStatesVersion)}>Usar estados sugeridos</button>}</div>}{!guest&&c.bootstrap.membership.orgRole==='OWNER'&&<button type="button" className="mare-board-configure" onClick={()=>setModal('project-states')}><Plus size={16}/>Configurar colunas</button>}<div className="mare-project-board">{[{id:"",name:"Sem estado"}, ...projectStates].map((state) => {
              const items = visibleProjects.filter((p) => (p.projectStateId ?? "") === state.id);
              return <section className="mare-project-board-column" data-project-state-id={state.id} key={state.id} onDragOver={(e) => { if (draggedProjectId || e.dataTransfer.types.includes("application/x-orgmap-project")) {e.preventDefault();e.dataTransfer.dropEffect="move";} }} onDrop={(e) => {if(draggedCatalogId)return;e.preventDefault();const source=draggedProjectId||e.dataTransfer.getData("application/x-orgmap-project")||e.dataTransfer.getData("text/plain"),project=projects.find(item=>item.id===source);setDraggedProjectId(null);if(project?.accessRole==="MANAGER"&&!project.frozen&&!policy?.lockProjectConfiguration&&!busy&&(project.projectStateId??"")!==state.id)void mutate(`/projects/${project.id}`,{projectStateId:state.id||null},project.version,"PATCH");}}>
                <h3><span>{state.name}</span><small>{items.length}</small></h3>
                {items.map((p) => { const progress=progressFor(p.id); return <article key={p.id} className={selectedProjectId === p.id ? "is-selected" : ""} onDragOver={(event)=>{if(draggedCatalogId){event.preventDefault();event.stopPropagation();}}} onDrop={(event)=>acceptProjectOrderDrop(event,p.id)} draggable={p.accessRole === "MANAGER" && !policy?.lockProjectConfiguration} onDragStart={(e) => {setDraggedProjectId(p.id);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",p.id);e.dataTransfer.setData("application/x-orgmap-project",p.id);}} onDragEnd={() => setDraggedProjectId(null)}>
                  <div className="mare-board-card-tools">{p.accessRole === "MANAGER" && !policy?.lockProjectConfiguration && <label className="mare-board-selection"><input type="checkbox" aria-label={`Selecionar projeto ${p.title}`} checked={selectedProjects.includes(p.id)} disabled={selectedProjects.length>=100 && !selectedProjects.includes(p.id)} onChange={(e)=>setSelectedProjects((current)=>e.target.checked?[...current,p.id]:current.filter((id)=>id!==p.id))}/></label>}<span className="mare-card-context"><Folder size={15}/>{p.circleId ? c.structure.nodes.find((node)=>node.entityId === p.circleId)?.name ?? "Círculo indisponível" : "Sem círculo"}</span></div>
                  <button className="mare-project-board-open" onClick={(event) => openProjectPreview(p.id, event.currentTarget)}>{p.title}</button>
                  {p.description && <p className="mare-card-description">{p.description}</p>}
                  <div className="mare-card-tags">{(p.tags ?? []).slice(0,3).map((tag)=><span key={tag}>{tag}</span>)}</div>
                  {hasProjectProperty("participants") && projectParticipants(p)}
                  {hasProjectProperty("progress") && <div className="mare-project-progress"><span>{progress.total ? `${progress.done}/${progress.total} tarefas visíveis` : 'Sem tarefas visíveis'}</span>{progress.total > 0 && <span className="mare-progress-track"><span style={{width:`${progress.done / progress.total * 100}%`}}/></span>}</div>}
                  <div className="mare-board-card-footer"><span className="mare-project-access">{p.visibility === "PRIVATE" ? <><LockKeyhole size={14}/>Privado</> : <><Users size={14}/>Organização</>}</span>{hasProjectProperty("due") && p.endsAt && <span className="mare-project-due"><CalendarDays size={14}/>{dateLabel(p.endsAt)}</span>}
                  {p.accessRole === "MANAGER" && !policy?.lockProjectConfiguration && <details className="mare-move-menu"><summary aria-label={`Mover projeto ${p.title}`}>Mover<ChevronDown size={14}/></summary><div>{[{id:"",name:"Sem estado"}, ...projectStates].filter((target) => target.id !== state.id).map((target) => <button disabled={busy} key={target.id} onClick={(event) => {event.currentTarget.closest("details")?.removeAttribute("open");void mutate(`/projects/${p.id}`,{projectStateId:target.id || null},p.version,"PATCH");}}>{target.name}</button>)}</div></details>}
                  </div>
                  {manualOrderControls(p,items)}
                </article>;})}
                {!items.length && <p className="mare-board-empty">Nenhum projeto neste estado</p>}
              </section>;
            })}</div></div> : <div className={"mare-project-collection " + (projectView === "GALLERY" ? "is-gallery" : "")} style={{"--catalog-columns":collectionColumns,"--catalog-min-width":`${collectionWidth}px`} as CSSProperties}>
              {projectGrouping !== "NONE" && <p className="mare-grouping-note">{projectGroupingHint[projectGrouping]}</p>}
              {projectView === "LIST" && <div className={"mare-project-columns " + (projectSort === "MANUAL" && !guest ? "has-personal-order" : "")}><span>{!guest && selectableProjects.length > 0 && <input type="checkbox" aria-label="Selecionar todos os projetos editáveis neste recorte" checked={allProjectsSelected} onChange={(e) => setSelectedProjects(e.target.checked ? selectableProjects.slice(0,100).map((p)=>p.id) : [])}/>}</span><span>Projeto</span>{hasProjectProperty("state") && <span>Estado</span>}{hasProjectProperty("participants") && <span>Participantes</span>}{hasProjectProperty("due") && <span>Prazo</span>}{hasProjectProperty("progress") && <span>Progresso</span>}<span>Acesso</span>{projectSort === "MANUAL" && !guest && <span>Ordem pessoal</span>}</div>}
              {groupProjects(visibleProjects,projectGrouping,{entity:projectEntityName,member:(id)=>c.members.find((member)=>member.id===id)?.displayName,state:(id)=>projectStates.find((state)=>state.id===id)?.name}).map((group) => <Fragment key={group.id}>{group.name && <h3 className="mare-project-group">{group.name} <small>{group.projects.length}</small></h3>}{group.projects.map((p) => {
                const progress = progressFor(p.id), projectState=projectStates.find((state) => state.id === p.projectStateId), circleName=p.circleId ? c.structure.nodes.find((node)=>node.entityId === p.circleId)?.name : null;
                return <div className={"mare-project-row-wrap " + (selectedProjectId === p.id ? "is-selected " : "") + (projectSort === "MANUAL" && !guest ? "has-personal-order" : "")} key={p.id} onDragOver={(event)=>{if(draggedCatalogId)event.preventDefault();}} onDrop={(event)=>acceptProjectOrderDrop(event,p.id)}>
                  <label className="mare-project-selection">{p.accessRole === "MANAGER" && !policy?.lockProjectConfiguration && <input type="checkbox" aria-label={`Selecionar projeto ${p.title}`} checked={selectedProjects.includes(p.id)} disabled={selectedProjects.length>=100 && !selectedProjects.includes(p.id)} onChange={(e)=>setSelectedProjects((current)=>e.target.checked?[...current,p.id]:current.filter((item)=>item!==p.id))} />}</label>
                  <button className="mare-project-row" onClick={(event) => openProjectPreview(p.id, event.currentTarget)} aria-pressed={selectedProjectId === p.id}>
                    <span className="mare-project-name"><Folder size={19}/><span><strong>{p.title}</strong>{["HIGH","URGENT"].includes(p.priority ?? "")&&<small className="mare-project-priority"><Flag size={12}/>{p.priority === "URGENT"?"Urgente":"Prioridade alta"}</small>}<small>{circleName ?? (guest?"Contexto não compartilhado":p.circleId ? "Círculo indisponível" : "Sem círculo")}</small>{projectView === "GALLERY" && <span className="mare-card-description">{p.description || "Sem descrição"}</span>}</span></span>
                    {hasProjectProperty("state") && <span className="mare-project-status" data-semantic={projectState?.semantic ?? "NONE"}>{projectState ? <><span/>{projectState.name}</> : <span className="mare-empty-value"><span aria-hidden="true">—</span><span className="work-sr-only">{guest?"Estado não compartilhado":"Sem estado"}</span></span>}</span>}
                    {hasProjectProperty("participants") && projectParticipants(p)}
                    {hasProjectProperty("due") && <span className="mare-project-due">{p.endsAt ? <><CalendarDays size={14}/>{dateLabel(p.endsAt)}</> : <span className="mare-empty-value"><span aria-hidden="true">—</span><span className="work-sr-only">{guest?"Prazo não compartilhado":"Sem prazo"}</span></span>}</span>}
                    {hasProjectProperty("progress") && <span className={"mare-project-progress" + (progress.total ? " has-progress" : "")} title={progress.total ? `${progress.done}/${progress.total} tarefas visíveis` : undefined}>{progress.total > 0 ? <><span className="mare-progress-track" aria-hidden="true"><span style={{ width: `${progress.done / progress.total * 100}%` }} /></span><span className="mare-progress-figure"><span aria-hidden="true">{progress.done}/{progress.total}</span><span className="work-sr-only">{`${progress.done}/${progress.total} tarefas visíveis`}</span></span></> : <span className="mare-empty-value"><span aria-hidden="true">—</span><span className="work-sr-only">Sem tarefas visíveis</span></span>}</span>}
                    <span className="mare-project-access">{p.visibility === "PRIVATE" ? <LockKeyhole size={14}/> : <Users size={14}/>}<span>{p.visibility === "PRIVATE" ? "Privado" : "Organização"}{p.frozen ? " · Congelado" : ""}</span></span>

                  </button>
                  {manualOrderControls(p,group.projects)}
                </div>;
              })}</Fragment>)}
              {projects.length > 0 && !visibleProjects.length && <div className="mare-project-empty"><Search size={26}/><h3>Nenhum projeto neste recorte</h3><p>Ajuste a busca ou os filtros para encontrar outros projetos.</p><button onClick={() => {clearProjectFilters();setProjectRelevance("ALL");}}>Ver todos os projetos</button></div>}
            </div>}
            {selectedProject && <WorkDrawer
              key={`${c.organizationId}:${c.session.account.id}:${selectedProject.id}`}
              label={`Prévia de ${selectedProject.title}`}
              className="mare-project-drawer"
              opener={projectTriggerRef.current}
              onClose={closeProjectPreview}
            >
              <header className="mare-preview-header">
                <div className="mare-preview-topline">
                  <div className="mare-preview-access"><span className="mare-access-badge">{selectedProject.visibility === "PRIVATE" ? <LockKeyhole size={13}/> : <Globe2 size={13}/>} {selectedProject.visibility === "PRIVATE" ? "Privado" : "Organização"}</span>{selectedProject.frozen && <span className="mare-access-badge">Congelado</span>}</div>
                  <div className="mare-preview-actions">
                    {selectedProject.accessRole === "MANAGER" && !policy?.lockProjectConfiguration && <>
                      <button type="button" className="mare-icon-button" aria-label="Editar projeto" title="Editar projeto" onClick={()=>setProjectDialog("edit")}><Pencil size={17}/></button>
                      <ProjectActionMenu items={[
                        {label:"Duplicar projeto",icon:<Copy size={16}/>,action:()=>setProjectDialog("duplicate"),disabled:busy},
                        ...(c.bootstrap.membership.orgRole === "OWNER" ? [{label:"Salvar como modelo",icon:<FilePlus2 size={16}/>,action:()=>setProjectDialog("template"),disabled:busy}] : []),
                        {label:"Configurações e acesso",icon:<Settings2 size={16}/>,action:()=>c.navigate(`/projects/${selectedProject.id}?settings=1`)},
                        {label:"Arquivar projeto",icon:<Archive size={16}/>,destructive:true,disabled:busy,action:()=>{void (async()=>{if(await mutate(`/projects/${selectedProject.id}`,{archived:true},selectedProject.version,"PATCH"))closeProjectPreview();})();}}
                      ]}/>
                    </>}
                    <button type="button" className="mare-icon-button mare-preview-expand" onClick={() => setProjectFocus(!projectFocus)} aria-label={projectFocus ? "Reduzir prévia" : "Expandir prévia"} title={projectFocus ? "Reduzir prévia" : "Expandir prévia"} aria-pressed={projectFocus}>{projectFocus ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}</button>
                    <button type="button" data-close-project data-work-drawer-close className="mare-icon-button" onClick={closeProjectPreview} aria-label="Fechar prévia" title="Fechar prévia"><X size={19}/></button>
                  </div>
                </div>
                <h2>{selectedProject.title}</h2>
                <div className="mare-project-header-properties"><ProjectContextLine project={selectedProject} context={c}/>{projectStatusControl(selectedProject,selectedProject.accessRole==='MANAGER'&&!policy?.lockProjectConfiguration)}</div>
                <nav className="mare-preview-tabs" role="tablist" aria-label="Seções do projeto">{([["content","Visão geral"],["tasks","Tarefas"],["conversation","Conversa"],["activity","Histórico"]] as const).filter(([tab])=>!guest||tab!=="activity").map(([tab,label],index,tabs)=><button key={tab} type="button" role="tab" id={`${projectPreviewId}-${tab}`} aria-selected={projectPreviewTab === tab} aria-controls={`${projectPreviewId}-panel`} tabIndex={projectPreviewTab === tab ? 0 : -1} onClick={()=>setProjectPreviewTab(tab)} onKeyDown={(event)=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const next=event.key === "Home" ? 0 : event.key === "End" ? tabs.length-1 : (index+(event.key === "ArrowRight" ? 1 : -1)+tabs.length)%tabs.length;setProjectPreviewTab(tabs[next][0]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();}}>{label}{tab === "tasks" && progressFor(selectedProject.id).total > 0 && <small>{progressFor(selectedProject.id).total}</small>}</button>)}</nav>
              </header>
              <div className="mare-preview-body" role="tabpanel" id={`${projectPreviewId}-panel`} aria-labelledby={`${projectPreviewId}-${projectPreviewTab}`} tabIndex={0}>
                <div hidden={projectPreviewTab !== "content"}>
                  <section className="mare-preview-description"><h3>Descrição</h3><RichTextView value={selectedProject.descriptionRich ?? (selectedProject.description || "Sem descrição")} /></section>
              {!guest && <section className="mare-preview-context"><h3>Pessoas e contexto</h3><dl><ProjectRelationFields context={c} project={selectedProject}/><div><dt>Responsável</dt><dd>{selectedProject.leadMemberId ? memberName(selectedProject.leadMemberId) : "Não definido"}</dd></div><div><dt>Criado por</dt><dd>{memberName(selectedProject.creatorId)}</dd></div>{projectPeopleFields(selectedProject)}</dl></section>}
                  {(selectedProject.startsAt || selectedProject.endsAt || (selectedProject.tags ?? []).length > 0) && <section className="mare-preview-details"><h3>Detalhes</h3>{selectedProject.startsAt && <p>Início: {dateLabel(selectedProject.startsAt)}</p>}{selectedProject.endsAt && <p>Vencimento: {dateLabel(selectedProject.endsAt)}</p>}<div className="mare-preview-tags">{(selectedProject.tags ?? []).map((tag)=><span key={tag}>{tag}</span>)}</div></section>}
                  <CustomFieldValues context={c} value={selectedProject.customFields}/><PlanningIntentView value={selectedProject.planningIntent}/>

                </div>
                <div hidden={projectPreviewTab !== "tasks"}>
                  <section data-project-section="tasks" className="mare-preview-task-list">
                    <header className="mare-section-heading"><h3>Tarefas <small>{progressFor(selectedProject.id).done}/{progressFor(selectedProject.id).total} concluídas</small></h3>{!guest && ["MANAGER","EDITOR"].includes(selectedProject.accessRole ?? "") && !selectedProject.frozen && <button type="button" className="mare-icon-button" aria-label="Adicionar tarefa ao projeto" title="Adicionar tarefa" onClick={()=>{setParent(null);setModal("task");}}><Plus size={18}/></button>}</header>
                    {projectTasks(selectedProject.id).length > 0 && <label className="mare-preview-task-search"><Search size={16}/><input aria-label="Buscar tarefas do projeto" placeholder="Encontrar uma tarefa…" value={previewTaskQuery} onChange={(event)=>setPreviewTaskQuery(event.target.value)}/></label>}
                    <div className="mare-preview-tasks">{projectTasks(selectedProject.id).filter((task)=>task.title.toLocaleLowerCase(locale).includes(previewTaskQuery.toLocaleLowerCase(locale))).map((task)=><button type="button" key={task.id} className={task.parentId ? "is-subtask" : ""} onClick={(event)=>open(task,event.currentTarget)}><span className={"work-dot work-"+task.status.toLowerCase()}/><span><strong>{task.title}</strong>{task.parentId && <small>Subtarefa de {taskName(task.parentId)}</small>}</span><small>{text(states[task.status])}</small><ArrowUpRight size={15}/></button>)}</div>
                    {!projectTasks(selectedProject.id).length && <p className="muted">Nenhuma tarefa ainda. Adicione a próxima ação deste projeto.</p>}
                    {projectTasks(selectedProject.id).length > 0 && !projectTasks(selectedProject.id).some((task)=>task.title.toLocaleLowerCase(locale).includes(previewTaskQuery.toLocaleLowerCase(locale))) && <p className="muted">Nenhuma tarefa encontrada.</p>}
                  </section>
              {!guest&&<div data-project-section="checklists"><ProjectChecklists context={c} project={selectedProject} editable={!guest && ["MANAGER","EDITOR"].includes(selectedProject.accessRole ?? "") && !selectedProject.frozen} command={mutate} pending={busy}/></div>}
                </div>
                {projectPreviewTab === "conversation" && <div className="mare-preview-conversation"><ResourcePanel context={c} type="project" resourceId={selectedProject.id}/>
              {!guest&&<ExternalWorkLinks draftKey={draftPrefix+":external-links:project:"+selectedProject.id} type="project" id={selectedProject.id} version={selectedProject.version} links={selectedProject.externalLinks} editable={!guest && ["MANAGER","EDITOR"].includes(selectedProject.accessRole ?? "") && !selectedProject.frozen} command={mutate} pending={busy}/>}</div>}
                {projectPreviewTab === "activity" && <WorkActivity context={c} type="project" id={selectedProject.id}/>}
              </div>
              <footer className="mare-preview-footer"><button type="button" onClick={() => c.navigate("/projects/" + selectedProject.id)}>Abrir projeto completo<ArrowUpRight size={16}/></button></footer>

            </WorkDrawer>}
          </div>
          {!projects.length && (
            <div className="empty-state">
              <h3>
                {guest
                  ? "Nenhum projeto compartilhado"
                  : "Nenhum projeto ainda"}
              </h3>
              <p>{guest
                ? "Os projetos compartilhados com você aparecerão aqui."
                : "Organize um novo trabalho com pessoas e tarefas da sua organização."}</p>
              {!guest && (
                <button className="primary" onClick={() => setModal("project")}>
                  Criar projeto
                </button>
              )}
            </div>
          )}
          </>}
        </>
      ) : (
        <>
          {pid&&pd&&!embeddedProject&&!settings&&projectPageTab==='content'&&<div className="mare-project-page-overview"><section><h3>Descrição</h3><RichTextView value={pd.project.descriptionRich??pd.project.description}/></section><section className="mare-preview-context"><h3>Pessoas e contexto</h3><dl><ProjectRelationFields context={c} project={pd.project}/><div><dt>Responsável</dt><dd>{pd.project.leadMemberId?memberName(pd.project.leadMemberId):'Não definido'}</dd></div><div><dt>Criado por</dt><dd>{memberName(pd.project.creatorId)}</dd></div>{!guest&&projectPeopleFields(pd.project)}</dl></section><CustomFieldValues context={c} value={pd.project.customFields}/><PlanningIntentView value={pd.project.planningIntent}/></div>}
          {pid&&pd&&!embeddedProject&&!settings&&projectPageTab==='conversation'&&<div className="mare-project-page-resources"><ResourcePanel context={c} type="project" resourceId={pid}/>{!guest&&<ExternalWorkLinks draftKey={draftPrefix+':external-links:project:'+pid} type="project" id={pid} version={pd.project.version} links={pd.project.externalLinks} editable={pd.capabilities.edit&&!pd.project.frozen} command={mutate} pending={busy}/>}</div>}
          {pid&&pd&&!guest&&!embeddedProject&&!settings&&projectPageTab==='activity'&&<div className="mare-project-page-resources"><WorkActivity context={c} type="project" id={pid}/></div>}
          {pd?.capabilities.configurationLocked && (
            <div className="notice">
              A organização bloqueou alterações de layout e configuração deste
              projeto.
            </div>
          )}
          {settings && pd?.capabilities.manage && (
            <ProjectSettings
              context={c}
              detail={pd}
              busy={busy}
              mutate={mutate}
            />
          )}
          <div className="mare-project-task-content" hidden={projectPage && (settings || projectPageTab !== "tasks")}>
          {projectPage && <header className="mare-project-task-heading">
            <div>
              <h3>{text("Tarefas")}</h3>
              <span>{taskCountLabel}</span>
            </div>
            {canEdit && <button type="button" className="primary" onClick={showNew}><Plus size={16} />{text("Adicionar tarefa")}</button>}
          </header>}
          <div className="collection-toolbar work-toolbar">
            <div className="work-views" role="group" aria-label={text("Visualização")}>
              {Object.entries({...views,GALLERY:"Galeria"})
                .filter(([key]) => !pd || pd.project.views.includes(key === "GALLERY"?"LIST":key))
                .map(([key, label]) => (
                  <button
                    key={key}
                    title={text(label)}
                    aria-label={text(label)}
                    aria-pressed={view === key}
                    className={view === key ? "view-pill" : ""}
                    onClick={() => setView(key)}
                  >
                    <Icon kind={key} />
                    {text(label)}
                  </button>
                ))}
            </div>
            {!projectPage && <><strong>{taskCountLabel}</strong><span className="toolbar-spacer" /></>}
            <input
              className="work-search"
              aria-label={text("Pesquisar tarefas")}
              placeholder={text("Pesquisar tarefas")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(!pid || guest) && <>
            <button
              className="work-filter-toggle"
              aria-expanded={filters}
              onClick={() => setFilters(!filters)}
            >
              {text("Filtrar")}
            </button>
            <div
              className={"work-filters " + (filters ? "work-filters-open" : "")}
            >
              {!guest && (
                <label className="work-mine">
                  <input
                    type="checkbox"
                    checked={mine}
                    onChange={(e) => setMine(e.target.checked)}
                  />
                  {text("Minhas")}
                </label>
              )}
              <select
                aria-label={text("Filtrar estado")}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">{text("Todos os estados")}</option>
                {Object.entries(states).map(([key, label]) => (
                  <option key={key} value={key}>
                    {text(label)}
                  </option>
                ))}
                {customStates.map((state) => <option key={state.id} value={"custom:" + state.id}>{state.name}</option>)}
              </select>
              <details className="work-layout-menu">
                <summary>{text("Ordenar")}</summary>
                <div className="work-layout-options">
                  <select
                    aria-label="Ordenar tarefas"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="POSITION">Ordem manual</option>
                    <option value="TITLE">{text("Título")}</option>
                    <option value="DUE">{text("Vencimento")}</option>
                  </select>
                </div>
              </details>
              <details className="work-layout-menu">
                <summary>{text("Agrupar")}</summary>
                <div className="work-layout-options">
                  <select
                    aria-label="Agrupar tarefas"
                    value={grouping}
                    onChange={(e) => setGrouping(e.target.value)}
                  >
                    <option value="SECTION">{text("Agrupar por seção")}</option>
                    <option value="STATUS">{text("Agrupar por estado")}</option>
                    <option value="PROJECT">{text("Projeto")}</option>
                  </select>
                  {!guest && (
                    <button
                      disabled={busy || pd?.capabilities.configurationLocked}
                      onClick={async () => {
                        const result = await mutate(
                          "/layout",
                          { projectId: pid ?? null, view, sort, grouping },
                          layoutVersion,
                        );
                        if (result) setLayoutVersion(result.layout.version);
                      }}
                    >
                      Salvar visualização
                    </button>
                  )}
                </div>
              </details>
              {canEdit && !projectPage && (
                <button className="primary" onClick={showNew}>{text("Adicionar tarefa")}</button>
              )}
            </div>
            </>}
            {pid && !guest && <TaskViewControls context={c} projectId={pid} current={taskViewConfig} onChange={applyTaskView} states={[...Object.entries(states).map(([id,name])=>({id,name:text(name)})),...customStates.map((state)=>({id:"custom:"+state.id,name:state.name}))]} onNew={!projectPage && canEdit ? showNew : undefined} onError={setError} manualOrderRef={taskOrderRef}/>}
            {projectPage && taskArchiveToggle}
          </div>
          {!projectPage && taskArchiveToggle}
          {archiveScope && !pid ? <section className="mare-archive-list"><h3>Tarefas arquivadas</h3>{archivedTasks.length ? archivedTasks.map((task) => <div key={task.id}><span>{task.title}{task.archivedByAncestor && <small> · tarefa superior arquivada</small>}</span>{!task.archivedByAncestor && (task.projectId ? projects.some((p) => p.id === task.projectId && ["MANAGER", "EDITOR"].includes(p.accessRole ?? "") && !p.frozen) : task.creatorId === c.bootstrap.membership.id) && <button disabled={busy} onClick={() => void mutate(`/tasks/${task.id}/restore`, {}, task.version)}>Restaurar</button>}</div>) : <p>Nenhuma tarefa arquivada encontrada.</p>}</section> : <>
              {selectedTasks.length > 0 && <div className="mare-bulk-actions"><strong>{selectedTasks.length} selecionadas</strong><label>Estado <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button disabled={busy} onClick={async () => {const items=tasks.filter((task)=>selectedTasks.includes(task.id)).map((task)=>({id:task.id,version:task.version})); if (await mutate("/tasks/bulk",{items,status:bulkStatus})) setSelectedTasks([]);}}>Alterar estado</button><button disabled={busy} onClick={async () => {const items=tasks.filter((task)=>selectedTasks.includes(task.id)).map((task)=>({id:task.id,version:task.version})); if (await mutate("/tasks/bulk",{items,archive:true})) setSelectedTasks([]);}}>Arquivar selecionadas</button><button onClick={() => setSelectedTasks([])}>Limpar seleção</button></div>}
          {view === "LIST" && (!projectPage || filtered.length > 0) && (
            <>

              <div className="table-scroll work-table-frame">
                <table className={"work-table" + (pid ? " is-project-scoped" : "")}>
                  <thead>
                    <tr>
                      <th aria-label="Seleção"/><th>{text("Tarefa")}</th>
                      {!pid && <th>{text("Projeto")}</th>}
                      {taskVisibleProperties.includes("participants") && <th>{text("Responsável")}</th>}
                      {taskVisibleProperties.includes("due") && <th>{text("Vencimento")}</th>}
                      {taskVisibleProperties.includes("state") && <th>{text("Estado")}</th>}{pid&&sort==="POSITION"&&!guest&&<th className="work-task-order"><span className="work-sr-only">Ordem pessoal</span></th>}
                    </tr>
                  </thead>
                  {taskGroups.map((group) => (
                    <tbody key={group.id} className="work-table-group">
                      {(taskGroups.length > 1 || group.name) && <tr className="work-group-row">
                        <th scope="rowgroup" colSpan={2 + (pid ? 0 : 1) + taskVisibleProperties.filter((property)=>["participants","due","state"].includes(property)).length + (pid&&sort==="POSITION"&&!guest ? 1 : 0)}>
                          <span className="work-group-title">
                            {group.name}{" "}
                            <span className="badge">{group.tasks.length}</span>
                          </span>
                        </th>
                      </tr>}
                        {group.tasks.map((t) => (
                        <tr key={t.id} onDragOver={(event)=>{if(draggedTaskOrder)event.preventDefault();}} onDrop={(event)=>{if(draggedTaskOrder){event.preventDefault();void moveTaskPersonalOrder(draggedTaskOrder,t.id,"before");setDraggedTaskOrder(null);}}}>
                          <td>
                            {!t.archived && !t.archivedByAncestor && !guest && (t.projectId ? projects.some((p) => p.id === t.projectId && ["MANAGER", "EDITOR"].includes(p.accessRole ?? "") && !p.frozen) : t.creatorId === c.bootstrap.membership.id) && <input type="checkbox" aria-label={`Selecionar ${t.title}`} checked={selectedTasks.includes(t.id)} disabled={selectedTasks.length >= 100 && !selectedTasks.includes(t.id)} onChange={(e) => setSelectedTasks((current) => e.target.checked ? [...current,t.id] : current.filter((id)=>id!==t.id))} />}
                          </td><td className="work-task-title-cell"><button
                              className="work-task-name"
                              onClick={(event) => open(t, event.currentTarget)}
                            >
                              <span
                                className={
                                  "work-dot work-" + t.status.toLowerCase()
                                }
                              />
                              <span>{t.title}</span>
                            </button>
                          </td>
                          {!pid && <td className="work-task-project">{projectTitle(t.projectId)}</td>}
                          {taskVisibleProperties.includes("participants") && <td className="work-task-assignee">
                            <TaskAssigneesView
                              context={c}
                              value={t}
                              guest={guest}
                              compact
                            />
                          </td>}
                          {taskVisibleProperties.includes("due") && <td className="work-task-due">{t.endsAt ? dateLabel(t.endsAt) : <span className="mare-empty-value"><span aria-hidden="true">—</span><span className="work-sr-only">{text("Sem vencimento")}</span></span>}</td>}
                          {taskVisibleProperties.includes("state") && <td className="work-task-state">{taskStateName(t)}{(t.archived||t.archivedByAncestor)&&" · Arquivada"}</td>}{pid&&sort==="POSITION"&&!guest&&<td className="work-task-order">{taskOrderControls(t)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
              {canEdit && !projectPage && (
                <button className="work-add" onClick={showNew}>
                  <Plus size={16}/>{text("Adicionar tarefa")}
                </button>
              )}
            </>
          )}
          {!filtered.length && (projectPage ? (
            <div className="mare-project-task-empty">
              <h4>{taskRecords.length ? "Nenhuma tarefa neste recorte" : taskArchiveMode === "ARCHIVED" ? "Nenhuma tarefa arquivada" : "Nenhuma tarefa neste projeto"}</h4>
              {taskRecords.length > 0 && <p>Ajuste a busca ou os filtros para encontrar tarefas.</p>}
              {taskRecords.length === 0 && taskArchiveMode !== "ARCHIVED" && canEdit && <p>Adicione a próxima ação do projeto.</p>}
            </div>
          ) : <div className="empty-state"><h3>Nenhuma tarefa neste recorte</h3><p>Ajuste os filtros ou adicione a próxima ação do projeto.</p></div>)}
          {view === "GALLERY" && <div className="mare-task-gallery">{taskGroups.filter((group)=>group.tasks.length).map((group)=><section key={group.id}>{group.name&&<h3>{group.name}</h3>}<div>{group.tasks.map(card)}</div></section>)}</div>}
          {view === "BOARD" && (
            <>
            {(grouping === "SECTION" || grouping === "STATUS") && <p className="mare-personal-order-note">{text(grouping === "SECTION" ? "Agrupado por seção" : "Agrupado por estado")}</p>}
            <div className="work-board">
              {taskGroups.map((s) => (
                <section className="work-column" key={s.id} onDragOver={(e) => { if (draggedTaskId && (grouping === "STATUS" || (grouping === "SECTION" && pid))) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }} onDrop={(e) => { e.preventDefault(); const task = tasks.find((item) => item.id === draggedTaskId); setDraggedTaskId(null); if (!task || busy) return; if (grouping === "STATUS" && s.id.startsWith("custom:") && task.customStatusId !== s.id.slice(7)) void mutate(`/tasks/${task.id}`, {customStatusId: s.id.slice(7)}, task.version, "PATCH"); else if (grouping === "STATUS" && !s.id.startsWith("custom:") && (task.status !== s.id || task.customStatusId)) void mutate(`/tasks/${task.id}`, {status: s.id}, task.version, "PATCH"); else if (grouping === "SECTION" && pid && (task.sectionId ?? "") !== s.id) void mutate(`/tasks/${task.id}`, {sectionId: s.id || null}, task.version, "PATCH"); }}>
                  <h3>
                    {s.name}
                    <span>{s.tasks.length}</span>
                  </h3>
                  {s.tasks.map(card)}
                  {!s.tasks.length && (
                    <p className="work-column-empty">Nenhuma tarefa</p>
                  )}
                  {canEdit && (
                    <button className="work-add" onClick={showNew}>
                      <Plus size={16}/>{text("Adicionar tarefa")}
                    </button>
                  )}
                </section>
              ))}
            </div>
            </>
          )}
          {view === "TIMELINE" && <Timeline tasks={filtered} open={open} />}{" "}
          {view === "CALENDAR" && (
            <Calendar tasks={filtered} open={open} day={day} setDay={setDay} />
          )}
          </>}
          {pid && canEdit && !archiveScope && (
            <div className="work-scheduling">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const a = new AbortController();
                    const r = await c.api<Plan>(
                      base + "/projects/" + pid + "/schedule",
                      { signal: a.signal },
                    );
                    setPlan(r.data);
                  } catch (e) {
                    setError(formatWorkError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Prévia do agendamento
              </button>
              <small>
                As dependências só alteram datas após aplicar a prévia.
              </small>
              {plan && (
                <div>
                  <h3>Prévia calculada</h3>
                  <p>
                    {plan.unknown.length
                      ? `${plan.unknown.length} restrições sem datas ou duração suficientes. Nenhuma data será inventada.`
                      : "Todas as restrições têm datas suficientes."}
                  </p>
                  <ul>
                    {plan.changes.map((x) => (
                      <li key={x.id}>
                        {taskName(x.id)}:{" "}
                        {x.startsAt ? formatInstant(x.startsAt) : "Sem início"}{" "}
                        → {x.endsAt ? formatInstant(x.endsAt) : "Sem fim"}
                      </li>
                    ))}
                  </ul>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await mutate(
                          "/projects/" + pid + "/schedule/apply",
                          { planHash: plan.planHash },
                          pd?.project.version,
                        )
                      )
                        setPlan(null);
                    }}
                  >
                    Aplicar agendamento
                  </button>
                </div>
              )}
            </div>
          )}
          {pid&&pd&&!guest&&!embeddedProject&&<div className="mare-project-page-checklists"><ProjectChecklists context={c} project={pd.project} editable={pd.capabilities.edit&&!pd.project.frozen} command={mutate} pending={busy}/></div>}
          </div>
        </>
      )}
      {selectedTaskId && (
        <WorkDrawer
          label="Detalhes da tarefa"
          className={"mare-task-drawer" + (taskFocus ? " is-focused" : "")}
          focusKey={selectedTaskId}
          opener={taskTriggerRef.current}
          onClose={closeTaskDrawer}
        >
          {(narrow) => <>
            <div className="mare-drawer-actions">
              <span>Detalhes</span>
              <div>
                {!narrow && <button type="button" onClick={() => setTaskFocus((focused) => !focused)} aria-pressed={taskFocus}>{taskFocus ? "Reduzir" : "Expandir"}</button>}
                <button type="button" data-work-drawer-close onClick={closeTaskDrawer} aria-label="Fechar tarefa">Fechar</button>
              </div>
            </div>
            <Work
              key={`${c.organizationId}:${c.session.account.id}:${selectedTaskId}:${selectedTaskArchived}`}
              onMutation={refresh}
              context={{
                ...c,
                path: "/projects/tasks/" + selectedTaskId + (selectedTaskArchived ? "?archived=1" : ""),
                navigate: (next) => {
                  const taskId = next.match(/^\/projects\/tasks\/([0-9a-f-]{36})/)?.[1];
                  if (taskId) {
                    setSelectedTaskId(taskId);
                    setSelectedTaskArchived(next.includes("archived=1"));
                  } else if (next === "/projects" || next === "/projects/tasks" || next === "/projects/" + pid) {
                    closeTaskDrawer();
                  } else {
                    c.navigate(next);
                  }
                },
              }}
            />
          </>}
        </WorkDrawer>
      )}
              {projectDialog === "edit" && canManageActiveProject && activeProject && !policy?.lockProjectConfiguration && <Modal title="Editar projeto" className="mare-project-edit-dialog" error={error} close={()=>setProjectDialog(null)}>
<DraftForm draftKey={draftPrefix + ":edit-project:" + activeProject.id} className="edit-form mare-project-edit-form" key={activeProject.id} onSubmit={(e) => submit(e, async (f) => { const key=draftPrefix + ":edit-project:" + activeProject.id; const result=await mutate(`/projects/${activeProject.id}`, {title:f.get("title"),priority:f.get("priority") ?? "NONE",sectionName:f.get("projectSectionName") ?? "",leadMemberId:f.get("leadMemberId")||null,...descriptionPayload(f),startsAt:workDateTimeFromForm(f,"startsAt",prefs),endsAt:workDateTimeFromForm(f,"endsAt",prefs),tags:String(f.get("projectTags") ?? "").split(",").map((tag)=>tag.trim()).filter(Boolean),customFields:customFieldsPayload(f),planningIntent:planningIntentPayload(f)},activeProject.version,"PATCH"); if(result){clearDraft(key+":title");clearDraft(key+":description");clearFormDraft(key);setProjectDialog(null);} })}><div className="mare-project-edit-main"><Field label="Nome"><input name="title" required maxLength={200} defaultValue={readDraft(draftPrefix + ":edit-project:" + activeProject.id + ":title") ?? activeProject.title} onChange={(e) => writeDraft(draftPrefix + ":edit-project:" + activeProject.id + ":title",e.target.value)} /></Field><DescriptionEditor key={activeProject.id+":"+activeProject.version} value={activeProject.descriptionRich ?? activeProject.description} pending={busy} draftKey={draftPrefix + ":edit-project:" + activeProject.id + ":description"} /></div><fieldset className="mare-project-edit-properties"><legend>Organização do trabalho</legend><ProjectLeadField context={c} selected={activeProject.leadMemberId}/><ProjectPlanningFields project={activeProject}/><DateFields task={activeProject} pending={busy} draftKey={draftPrefix + ":edit-project:" + activeProject.id} /><Field label="Tags (separadas por vírgula)"><input name="projectTags" defaultValue={(activeProject.tags ?? []).join(", ")} /></Field></fieldset><details className="mare-project-edit-advanced"><summary>Planejamento e propriedades adicionais</summary><CustomFieldInputs context={c} value={activeProject.customFields} /><PlanningIntentFields value={activeProject.planningIntent}/></details><footer className="form-actions mare-project-edit-footer"><button type="button" disabled={busy} onClick={()=>setProjectDialog(null)}>Cancelar</button><button className="primary" disabled={busy}>Salvar alterações</button></footer></DraftForm>
              </Modal>}
              {(projectDialog === "duplicate" || projectDialog === "template") && canManageActiveProject && activeProject && !policy?.lockProjectConfiguration && <Modal title={projectDialog === "duplicate" ? "Duplicar projeto" : "Salvar como modelo"} className="mare-project-copy-dialog" error={error} close={()=>setProjectDialog(null)}><ProjectCopyActions draftKey={draftPrefix+":copy-project:"+activeProject.id} project={activeProject} command={mutate} pending={busy} onDuplicate={(id)=>c.navigate("/projects/"+id)} templateAllowed={c.bootstrap.membership.orgRole === "OWNER"} action={projectDialog} onClose={()=>setProjectDialog(null)}/></Modal>}
      {modal === "project" && (
        <Modal
          error={error}
          title="Criar projeto"
          close={() => {
            setModal("");
            if (c.path.includes("?new=")) c.navigate("/projects");
          }}
        >
          <DraftForm draftKey={projectDraft}
            className="edit-form"
            onSubmit={(e) =>
              submit(e, async (f) => {
                if (!policy) {
                  setError(
                    "Aguarde o carregamento da configuração de projetos antes de criar.",
                  );
                  return;
                }
                const d = await mutate("/projects", {
                  title: f.get("title"),
                  leadMemberId:f.get("leadMemberId")||null,
                  priority:f.get("priority") ?? "NONE",sectionName:f.get("projectSectionName") ?? "",
                  ...descriptionPayload(f,true),
                  visibility: f.get("visibility"),
                  circleId: f.get("circleId") || null,
                  startsAt: workDateTimeFromForm(f, "startsAt", prefs),
                  endsAt: workDateTimeFromForm(f, "endsAt", prefs),
                  ...(String(f.get("projectTags") ?? "").trim() ? {tags:String(f.get("projectTags")).split(",").map((tag)=>tag.trim()).filter(Boolean)} : {}),
                  customFields: customFieldsPayload(f),
                planningIntent:planningIntentPayload(f),
                  ...(f.get("templateId")
                    ? { templateId: f.get("templateId") }
                    : {}),
                });
                if (d) {
                  clearDraft(projectDraft + ":title"); clearDraft(projectDraft + ":description"); clearFormDraft(projectDraft);
                  setModal("");
                  c.navigate("/projects/" + d.project.id);
                }
              })
            }
          >
            <Field label="Nome">
              <input name="title" required maxLength={200} autoFocus defaultValue={readDraft(projectDraft + ":title") ?? ""} onChange={(e) => writeDraft(projectDraft + ":title", e.target.value)} />
            </Field>
            <DescriptionEditor pending={busy} draftKey={projectDraft + ":description"} />
            <ProjectLeadField context={c}/><ProjectPlanningFields/><CircleField context={c} />
            <Field label="Acesso">
              <select
                name="visibility"
                key={policy?.version ?? "loading"}
                defaultValue={policy?.defaultPrivacy ?? "PUBLIC"}
                disabled={!policy}
              >
                <option value="PUBLIC">{text("Público na organização")}</option>
                <option value="PRIVATE">
                  Privado — somente pessoas convidadas
                </option>
              </select>
            </Field>
            <p>
              Projetos públicos ficam visíveis aos membros ativos da
              organização. A edição exige acesso de editor ou gestor.
            </p>
            <details className="mare-project-options"><summary>Datas, tags e outras propriedades</summary>
              <DateFields pending={busy} draftKey={projectDraft} />
              <Field label="Tags (separadas por vírgula)"><input name="projectTags" /></Field>
              <CustomFieldInputs context={c} /><PlanningIntentFields/>
              <ProjectTemplateSelect context={c} />
            </details>
            <button className="primary" disabled={busy || !policy}>
              Criar projeto
            </button>
          </DraftForm>
        </Modal>
      )}
      {modal === "task" && (
        <Modal error={error} title="Nova tarefa" close={() => setModal("")}>
          <DraftForm draftKey={taskDraft} className="edit-form" onSubmit={(e) => submit(e, createTask)}>
            <NewTaskFields context={c} pending={busy} draftKey={taskDraft} />
            {!pid && (
              <Field label="Projeto">
                <select name="projectId" defaultValue={selectedProjectId ?? ""}>
                  <option value="">Tarefa pessoal privada</option>
                  {projects
                    .filter(
                      (p) =>
                        ["MANAGER", "EDITOR"].includes(p.accessRole ?? "") &&
                        !p.frozen,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {pid && (
              <Field label="Seção">
                <select name="sectionId">
                  <option value="">Caixa de entrada</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <DateFields pending={busy} draftKey={taskDraft} />
            <button className="primary" disabled={busy}>
              {text("Criar tarefa")}
            </button>
          </DraftForm>
        </Modal>
      )}
    </div>
  );
}
function NewTaskFields({ context:c, pending = false, draftKey }: {context:FeatureContext; pending?: boolean; draftKey?: string }) {
  return (
    <>
      <Field label="Título">
        <input name="title" required maxLength={200} autoFocus defaultValue={draftKey ? readDraft(draftKey + ":title") ?? "" : ""} onChange={(e) => { if (draftKey) writeDraft(draftKey + ":title", e.target.value); }} />
      </Field>
      <DescriptionEditor pending={pending} draftKey={draftKey ? draftKey + ":description" : undefined} />
      <TaskPropertiesFields pending={pending} /><CustomFieldInputs context={c}/><PlanningIntentFields/>
    </>
  );
}
function TaskSections({
  context: c,
  projectId,
  selected,
}: {
  context: FeatureContext;
  projectId: string | null;
  selected: string | null;
}) {
  const [sections, setSections] = useState<Section[]>([]);
  useEffect(() => {
    if (!projectId) return;
    const a = new AbortController();
    c.api<ProjectDetail>(
      `/organizations/${c.organizationId}/work/projects/${projectId}`,
      { signal: a.signal },
    )
      .then((r) => setSections(r.data.sections))
      .catch(() => {});
    return () => a.abort();
  }, [c, projectId]);
  return projectId ? (
    <Field label="Seção">
      <select
        key={sections.length}
        name="sectionId"
        defaultValue={selected ?? ""}
      >
        <option value="">Caixa de entrada</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Field>
  ) : null;
}
function TaskGroupField({
  context: c,
  parentId,
  selected,
}: {
  context: FeatureContext;
  parentId: string;
  selected: string | null;
}) {
  const [groups, setGroups] = useState<Detail["groups"]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const a = new AbortController();
    setLoaded(false);
    setError("");
    c.api<Detail>(`/organizations/${c.organizationId}/work/tasks/${parentId}`, {
      signal: a.signal,
    })
      .then((r) => {
        if (!a.signal.aborted) {
          setGroups(r.data.groups ?? []);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(workError(e));
      });
    return () => a.abort();
  }, [c.api, c.organizationId, parentId]);
  return loaded ? (
    <Field label="Grupo de subtarefas">
      <select name="groupId" defaultValue={selected ?? ""}>
        <option value="">Sem grupo</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </Field>
  ) : (
    <>
      <input type="hidden" name="groupId" value={selected ?? ""} />
      <p className="muted">{error || "Carregando grupos de subtarefas…"}</p>
    </>
  );
}
function Timeline({ tasks, open }: { tasks: Task[]; open: (t: Task, opener?: HTMLElement) => void }) {
  const { formatInstant } = useLocalization();
  const dated = tasks.filter((t) => t.startsAt && t.endsAt);
  if (!dated.length)
    return (
      <div className="work-timeline-empty">
        <h3>Nenhuma tarefa com datas</h3>
        <p>
          Adicione datas de início e vencimento às suas tarefas para vê-las na
          linha do tempo.
        </p>
      </div>
    );
  const min = Math.min(...dated.map((t) => +new Date(t.startsAt!))),
    max = Math.max(...dated.map((t) => +new Date(t.endsAt!))),
    range = Math.max(max - min, 86400000);
  return (
    <div className="work-timeline">
      <div className="work-timeline-range">
        <span>{formatInstant(new Date(min), false)}</span>
        <span>{formatInstant(new Date(max), false)}</span>
      </div>
      {dated.map((t) => (
        <div className="work-timeline-row" key={t.id}>
          <button onClick={(event) => open(t, event.currentTarget)}>{t.title}</button>
          <div className="work-timeline-track">
            <button
              aria-label={t.title + " · " + formatInstant(t.startsAt)}
              onClick={(event) => open(t, event.currentTarget)}
              style={{
                left: (100 * (+new Date(t.startsAt!) - min)) / range + "%",
                width:
                  Math.max(
                    1,
                    (100 * (+new Date(t.endsAt!) - +new Date(t.startsAt!))) /
                      range,
                  ) + "%",
              }}
            >
              {t.title}
            </button>
          </div>
        </div>
      ))}
      <small>
        {tasks.length - dated.length} tarefas sem intervalo completo
      </small>
    </div>
  );
}
function Calendar({
  tasks,
  open,
  day,
  setDay,
}: {
  tasks: Task[];
  open: (t: Task, opener?: HTMLElement) => void;
  day: string;
  setDay: (v: string) => void;
}) {
  const { locale, formatDate, dateAtInstant, prefs } = useLocalization();
  const text = workTranslator(locale);
  const shift = (delta: number) => setDay(shiftWorkDay(day, delta));
  const visible = tasks.filter((task) => workTaskOnDay(task, day, prefs));
  return (
    <div className="work-calendar">
      <div className="work-calendar-toolbar">
        <button onClick={() => setDay(dateAtInstant(new Date())!)}>
          {text("Hoje")}
        </button>
        <button aria-label={text("Dia anterior")} onClick={() => shift(-1)}>
          {text("Anterior")}
        </button>
        <button aria-label={text("Dia seguinte")} onClick={() => shift(1)}>
          {text("Próximo")}
        </button>
        <input
          type="date"
          aria-label={text("Data do calendário")}
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
        />
        <h2>
          {formatDate(day, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </h2>
      </div>
      <div className="work-calendar-grid">
        <div className="work-calendar-day">
          {formatDate(day, {
            weekday: "short",
            day: "numeric",
          })}
        </div>
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} className="work-hour">
            <time>{String(hour).padStart(2, "0")}:00</time>
            <div>
              {visible
                .filter((task) => workTaskHour(task, day, prefs) === hour)
                .map((t) => (
                  <button key={t.id} onClick={(event) => open(t, event.currentTarget)}>
                    {t.title} · {text(states[t.status])}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <details open>
        <summary>
          {tasks.filter((t) => !t.startsAt && !t.endsAt).length} tarefas sem
          datas
        </summary>
        {tasks
          .filter((t) => !t.startsAt && !t.endsAt)
          .map((t) => (
            <button key={t.id} className="work-undated" onClick={(event) => open(t, event.currentTarget)}>
              <span className={"work-dot work-" + t.status.toLowerCase()} />
              {t.title}
            </button>
          ))}
      </details>
    </div>
  );
}
function ProjectSettings({
  context: c,
  detail: d,
  busy,
  mutate,
}: {
  context: FeatureContext;
  detail: ProjectDetail;
  busy: boolean;
  mutate: (path: string, b: unknown, v?: number, m?: string) => Promise<any>;
}) {
  const text = useWorkText();
  const { prefs } = useLocalization();
  const p = d.project;
  const draftKey = `orgmap:work:${c.organizationId}:${c.session.account.id}:edit-project:${p.id}`;
  const submit = (e: FormEvent<HTMLFormElement>, fn: (f: FormData) => void) =>
    fn(form(e));
  return (
    <section className="work-settings">
      <h3>{text("Configurações do projeto")}</h3>
      <DraftForm draftKey={draftKey}
        className="edit-form"
        onSubmit={(e) =>
          submit(e, (f) => {
            void mutate(
              "/projects/" + p.id,
              {
                title: f.get("title"),
                leadMemberId:f.get("leadMemberId")||null,
                priority:f.get("priority") ?? "NONE",sectionName:f.get("projectSectionName") ?? "",
                ...descriptionPayload(f),
                visibility: f.get("visibility"),
                circleId: f.get("circleId") || null,
                startsAt: workDateTimeFromForm(f, "startsAt", prefs),
                endsAt: workDateTimeFromForm(f, "endsAt", prefs),
                tags: String(f.get("projectTags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
                customFields: customFieldsPayload(f),
                planningIntent:planningIntentPayload(f),
                frozen: f.get("frozen") === "on",
                views: f.getAll("views"),
                defaultDoneSectionId: f.get("defaultDoneSectionId") || null,
                assignmentMode: f.get("assignmentMode"),
                assignmentPermission: f.get("assignmentPermission"),
              },
              p.version,
              "PATCH",
            ).then((result) => { if (result) { clearDraft(draftKey + ":title"); clearDraft(draftKey + ":description"); clearFormDraft(draftKey); } });
          })
        }
      >
        <Field label="Nome">
          <input name="title" defaultValue={readDraft(draftKey + ":title") ?? p.title} onChange={(e) => writeDraft(draftKey + ":title", e.target.value)} required maxLength={200} />
        </Field>
        <DescriptionEditor
          key={p.id + ":" + p.version}
          value={p.descriptionRich ?? p.description}
          pending={busy}
          draftKey={draftKey + ":description"}
        />
        <ProjectLeadField context={c} selected={p.leadMemberId}/><ProjectPlanningFields project={p}/><CircleField context={c} selected={p.circleId} />
        <DateFields task={p} pending={busy} draftKey={draftKey} />
        <Field label="Tags (separadas por vírgula)"><input name="projectTags" defaultValue={(p.tags ?? []).join(", ")} /></Field>
        <CustomFieldInputs context={c} value={p.customFields} /><PlanningIntentFields value={p.planningIntent}/>
        <Field label="Visibilidade">
          <select name="visibility" defaultValue={p.visibility}>
            <option value="PUBLIC">{text("Público na organização")}</option>
            <option value="PRIVATE">{text("Privado")}</option>
          </select>
        </Field>
        <label className="work-check">
          <input type="checkbox" name="frozen" defaultChecked={p.frozen} />
          Congelar alterações nas tarefas
        </label>
        <Field label="Quantidade de responsáveis">
          <select name="assignmentMode" defaultValue={p.assignmentMode}>
            <option value="MULTIPLE">Vários responsáveis</option>
            <option value="SINGLE">Um responsável por tarefa</option>
          </select>
        </Field>
        <Field label="Quem pode atribuir">
          <select
            name="assignmentPermission"
            defaultValue={p.assignmentPermission}
          >
            <option value="EDITORS">Editores e gestores</option>
            <option value="MANAGERS">Somente gestores</option>
          </select>
        </Field>
        <fieldset>
          <legend>Vistas disponíveis (ao menos uma)</legend>
          {Object.entries(views).map(([key, label]) => (
            <label className="work-check" key={key}>
              <input
                type="checkbox"
                name="views"
                value={key}
                defaultChecked={p.views.includes(key)}
              />
              {text(label)}
            </label>
          ))}
        </fieldset>
        <Field label="Seção padrão de conclusão">
          <select
            name="defaultDoneSectionId"
            defaultValue={p.defaultDoneSectionId ?? ""}
          >
            <option value="">Exigir escolha quando houver várias</option>
            {d.sections
              .filter((s) => s.semantic === "DONE")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <button className="primary" disabled={busy}>
          Salvar configurações
        </button>
      </DraftForm>
      <ProjectContextEditor context={c} project={p} busy={busy} mutate={mutate} />
      <ProjectStatesEditor project={p} busy={busy} mutate={mutate} />
      <h3>Seções</h3>
      {d.sections.map((s) => (
        <details key={s.id}>
          <summary>
            {s.name} ·{" "}
            {s.semantic === "DONE" ? "Conclui tarefas" : "Seção comum"}
          </summary>
          <form
            className="work-inline work-wrap"
            onSubmit={(e) =>
              submit(e, (f) => {
                void mutate(
                  "/projects/" + p.id + "/sections/" + s.id,
                  {
                    name: f.get("name"),
                    semantic: f.get("semantic"),
                    position: Number(f.get("position")),
                  },
                  p.version,
                  "PATCH",
                );
              })
            }
          >
            <Field label="Nome da seção">
              <input
                name="name"
                defaultValue={s.name}
                required
                maxLength={200}
              />
            </Field>
            <Field label="Função da seção">
              <select name="semantic" defaultValue={s.semantic}>
                <option value="NONE">Comum</option>
                <option value="DONE">{text("Concluída")}</option>
              </select>
            </Field>
            <Field label="Posição">
              <input name="position" type="number" defaultValue={s.position} />
            </Field>
            <button disabled={busy}>Salvar seção</button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                mutate(
                  "/projects/" + p.id + "/sections/" + s.id,
                  undefined,
                  p.version,
                  "DELETE",
                )
              }
            >
              Remover seção vazia
            </button>
          </form>
          <p>
            Alterar a função aplica o estado correspondente às tarefas da seção.
          </p>
        </details>
      ))}
      <form
        className="work-inline work-wrap"
        onSubmit={(e) =>
          submit(e, (f) => {
            void mutate(
              "/projects/" + p.id + "/sections",
              {
                name: f.get("name"),
                semantic: f.get("semantic"),
                position: d.sections.length,
              },
              p.version,
            );
          })
        }
      >
        <Field label="Nome da seção">
          <input name="name" required maxLength={200} />
        </Field>
        <Field label="Função">
          <select name="semantic">
            <option value="NONE">Comum</option>
            <option value="DONE">{text("Concluída")}</option>
          </select>
        </Field>
        <button disabled={busy}>Adicionar seção</button>
      </form>
      <button disabled={busy} onClick={async () => { if (await mutate(`/projects/${p.id}`, {archived: true}, p.version, "PATCH")) c.navigate("/projects"); }}>Arquivar projeto</button>
      <h3>Acesso explícito</h3>
      {d.access.map((a) => (
        <div className="work-access" key={a.memberId}>
          <span>
            {c.members.find((m) => m.id === a.memberId)?.displayName ??
              "Membro"}{" "}
            · {a.role}
          </span>
          {a.memberId !== c.bootstrap.membership.id && (
            <button
              disabled={busy}
              onClick={() =>
                mutate(
                  "/projects/" + p.id + "/access",
                  { memberId: a.memberId, role: null },
                  p.version,
                )
              }
            >
              Revogar
            </button>
          )}
        </div>
      ))}
      <form
        className="work-inline work-wrap"
        onSubmit={(e) =>
          submit(e, (f) => {
            void mutate(
              "/projects/" + p.id + "/access",
              { memberId: f.get("memberId"), role: f.get("role") },
              p.version,
            );
          })
        }
      >
        <Field label="Pessoa">
          <select name="memberId" required>
            <option value="">Selecionar pessoa</option>
            {c.members
              .filter((m) => m.status === "ACTIVE")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Acesso">
          <select name="role">
            <option value="READER">Leitor</option>
            <option value="EDITOR">Editor</option>
            <option value="MANAGER">Gestor</option>
          </select>
        </Field>
        <button disabled={busy}>Conceder acesso</button>
      </form>
    </section>
  );
}
export const feature: FeatureDefinition = {
  ...workMetadata,
  Component: Work,
  sidebar: WorkSidebar,
};
export const features = [feature];

function ProjectStatesEditor({project, busy, mutate}: {project: Project; busy: boolean; mutate: (path: string, body: unknown, version?: number, method?: string) => Promise<any>}) {
  const [name, setName] = useState("");
  const [semantic, setSemantic] = useState("TODO");
  const definitions = project.taskStates ?? [];
  return <section className="mare-context-editor"><h3>Estados adicionais das tarefas</h3><p>Cada estado tem uma função que mantém compatibilidade com a conclusão e os relatórios.</p>
    {definitions.map((state) => <div className="work-access" key={state.id}><span>{state.name} · {states[state.semantic]}</span><button disabled={busy} onClick={() => void mutate(`/projects/${project.id}/states`, {states: definitions.filter((item) => item.id !== state.id)}, project.version)}>Remover</button></div>)}
    <form className="work-inline work-wrap" onSubmit={async (e) => {e.preventDefault(); const result = await mutate(`/projects/${project.id}/states`, {states: [...definitions, {id: crypto.randomUUID(), name, semantic}]}, project.version); if (result) setName("");}}><Field label="Nome do estado"><input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Função"><select value={semantic} onChange={(e) => setSemantic(e.target.value)}>{Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><button disabled={busy}>Adicionar estado</button></form>
  </section>;
}
type ProjectContextLink = { kind: "CIRCLE" | "ROLE" | "PARTICIPANT" | "FOLLOWER"; targetId: string };
function ProjectContextEditor({ context: c, project, busy, mutate }: { context: FeatureContext; project: Project; busy: boolean; mutate: (path: string, body: unknown, version?: number, method?: string) => Promise<any> }) {
  const [links, setLinks] = useState<ProjectContextLink[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const draftKey = `orgmap:work:${c.organizationId}:${c.session.account.id}:project-context:${project.id}`;
  useEffect(() => {
    const controller = new AbortController();
    c.api<{links: ProjectContextLink[]}>(`/organizations/${c.organizationId}/work/projects/${project.id}/context`, {signal: controller.signal}).then((r) => {const saved=readDraft(draftKey);try {const parsed=saved ? JSON.parse(saved) : null;setLinks(Array.isArray(parsed) && parsed.every((item) => item && ["CIRCLE","ROLE","PARTICIPANT","FOLLOWER"].includes(item.kind) && typeof item.targetId === "string") ? parsed : r.data.links);} catch {setLinks(r.data.links);}}).catch((e) => { if (!controller.signal.aborted) setLoadError(errorMessage(e)); });
    return () => controller.abort();
  }, [c.api, c.organizationId, project.id, project.version]);
  const groups = [
    {kind: "CIRCLE" as const, label: "Círculos vinculados", choices: c.structure.nodes.filter((x) => x.kind === "CIRCLE").map((x) => ({id: x.entityId, name: x.name}))},
    {kind: "ROLE" as const, label: "Papéis vinculados", choices: c.structure.nodes.filter((x) => x.kind === "ROLE").map((x) => ({id: x.entityId, name: roleChoiceLabel(x,c.structure.nodes)}))},
    {kind: "PARTICIPANT" as const, label: "Participantes", choices: c.members.filter((x) => x.status === "ACTIVE").map((x) => ({id: x.id, name: x.displayName}))},
    {kind: "FOLLOWER" as const, label: "Pessoas acompanhando (vínculo sem notificações)", choices: c.members.filter((x) => x.status === "ACTIVE").map((x) => ({id: x.id, name: x.displayName}))},
  ];
  return <section className="mare-context-editor"><h3>Vínculos do projeto</h3><p>Estes vínculos descrevem o trabalho; acesso e notificações são configurados separadamente.</p>{loadError && <p role="alert">{loadError}</p>}{links && <form onSubmit={(e) => { e.preventDefault(); void mutate(`/projects/${project.id}/context`, {links}, project.version).then((result)=>{if(result)clearDraft(draftKey);}); }}>
    {groups.map((group) => <details key={group.kind}><summary>{group.label} · {links.filter((link) => link.kind === group.kind).length}</summary>{group.choices.map((choice) => <label className="work-check" key={choice.id}><input type="checkbox" checked={links.some((link) => link.kind === group.kind && link.targetId === choice.id)} onChange={(e) => { const checked=e.target.checked; setLinks((current) => {const next=checked ? [...(current ?? []), {kind: group.kind, targetId: choice.id}] : (current ?? []).filter((link) => link.kind !== group.kind || link.targetId !== choice.id);if (!writeDraft(draftKey,JSON.stringify(next))) setLoadError("Não foi possível guardar este rascunho neste dispositivo. Mantenha o formulário aberto até salvar.");return next;}); }} />{choice.name}</label>)}</details>)}
    <button disabled={busy}>Salvar vínculos</button>
  </form>}</section>;
}
function ProjectPlanningFields({project}:{project?:Project}) {
  return <div className="work-date-fields"><Field label="Prioridade do projeto"><select name="priority" defaultValue={project?.priority ?? "NONE"}>{[["NONE","Sem prioridade"],["LOW","Baixa"],["MEDIUM","Média"],["HIGH","Alta"],["URGENT","Urgente"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field><Field label="Seção do projeto"><input name="projectSectionName" maxLength={200} defaultValue={project?.sectionName ?? ""}/><small>Independente do estado e das seções de tarefas.</small></Field></div>;
}
function ProjectLeadField({context:c,selected}:{context:FeatureContext;selected?:string|null}) {
  return <Field label="Responsável pelo resultado"><select name="leadMemberId" defaultValue={selected === undefined ? c.bootstrap.membership.id : selected ?? ""}><option value="">Não definido</option>{c.members.filter((member)=>member.status === "ACTIVE").map((member)=><option key={member.id} value={member.id}>{member.displayName}</option>)}</select><small>Um vínculo de acompanhamento. Não altera autoria nem concede acesso.</small></Field>;
}
function CircleField({
  context: c,
  selected,
}: {
  context: FeatureContext;
  selected?: string | null;
}) {
  return (
    <Field label="Círculo contextual">
      <select name="circleId" defaultValue={selected ?? ""}>
        <option value="">Sem círculo</option>
        {c.structure.nodes
          .filter((n) => n.kind === "CIRCLE")
          .map((n) => (
            <option key={n.entityId} value={n.entityId}>
              {n.name}
            </option>
          ))}
      </select>
    </Field>
  );
}

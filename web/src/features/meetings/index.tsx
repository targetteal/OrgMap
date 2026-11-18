import { MeetingsHeaderActions } from "./header-actions";
import { MeetingScheduleFields } from "./meeting-schedule-fields";
import { MeetingStepsEditor } from "./meeting-steps-editor";
import { O2MeetingPanel } from "./o2-panel";
import { MeetingPreview } from "./meeting-preview";
import { MeetingRoom } from "./meeting-room";
import { roomText } from "./room-copy";
import { meetingCopy } from "./surface-copy";
import { meetingWeek, meetingWeekBounds, shiftMeetingWeek } from "./regional";
import { useMeetingsLocalization } from "./use-localization";
import { useEffect, useState, useRef, type FormEvent, type ReactNode } from "react";
import { Temporal } from "@js-temporal/polyfill";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  FileText,
  List,
  Play,
  Users,
  Search,
  X,
} from "lucide-react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import { meetingsMetadata } from "./metadata";
import { Button, Dialog, Field, Notice } from "../../ui";
import { RichTextView } from "../../editor";
import { CollaborativeNotes } from "./collaboration";
import { RICH_TEXT_PROTOCOL } from "@orgmap/content/collaboration";
import { LinkedItems } from "./linked-items";
import { AgendaItemsView } from "./agenda-items-view";
import { MeetingStatisticsView } from "./statistics-view";
import { MeetingExportsView } from "./exports-view";
import { MeetingOutcomeForm } from './outcome-form';
import { ProposalOutcomeDiff } from "./proposal-diff";
import { MeetingProposalEditor, type MeetingProposalType } from '../governance';
import { ReportPublicationStatus } from './report-publication-status';
import { facilitatorTranslator, secretaryClaimTranslator } from './secretary-claim-messages';
import { TraceOrigin, TraceReturnLink, traceRoute } from "../../traceability";
import "./meetings.css";
import "./catalogue.css";
import {
  resolveMeetingRoute,
  meetingHref,
} from "./routes";
type Section = { id: string; title: string; kind: string };
type Meeting = {
  id: string;
  title: string;
  state: string;
  startAt: string;
  localStart: string;
  timeZone: string;
  durationMinutes: number;
  version: number;
  circleId: string;
  isParticipant?:boolean;
  sections: Section[];
  currentStep: string;
  method: string;
  notetakerId: string;
  facilitatorId: string;
  policy: { notesOnlyNoter: boolean; windowDays: number };
};
export type Detail = {
  accessMode?: "PARTICIPANT" | "SUPERVISED_READ" | "GUEST_READ";
  meeting: Meeting;
  participants: any[];
  agenda: any[];
  actions: any[];
  documents: {
    sectionId: string;
    epoch: number;
    sequence: number;
    snapshot: string;
    protocol: string;
    schemaVersion: number;
    document?: any;
    text?: string;
  }[];
  report: any;
  capabilities: Record<string, boolean>;
};
const initialSections: Section[] = [
  { id: "checkin", title: "Check-in", kind: "CHECKIN" },
  { id: "review", title: "Revisar", kind: "CUSTOM" },
  { id: "agenda", title: "Pauta", kind: "AGENDA" },
  { id: "checkout", title: "Check-out", kind: "CHECKOUT" },
];
const labels: Record<string, string> = {
  SCHEDULED: "Agendada",
  RUNNING: "Em andamento",
  CLOSED: "Encerrada",
  CANCELLED: "Cancelada",
  OPEN: "Pendente",
  COMPLETED: "Concluído",
  TRANSFERRED: "Transferido",
  WITHDRAWN: "Retirado",
  PUBLISHED: "Publicada",
  DRAFT: "Rascunho",
};
function Sidebar({ context }: { context: FeatureContext }) {
  const { t } = useMeetingsLocalization();
  return (
    <nav className="meetings-sidebar" aria-label={t("Reuniões")}>
      <button onClick={() => context.navigate("/meetings")}>
        <CalendarDays size={16} />
        {t("Reuniões")}
      </button>
      <button onClick={() => context.navigate("/meetings/reports")}>
        <FileText size={16} />
        {t("Atas")}
      </button>
      {context.bootstrap.membership.memberType !== "GUEST" && (
        <>
          <button onClick={() => context.navigate("/meetings/agenda-items")}>
            <List size={16} />
            {t("Itens da agenda")}
          </button>
          <button onClick={() => context.navigate("/meetings/statistics")}>
            {t("Estatísticas")}
          </button>
          <button onClick={() => context.navigate("/meetings/exports")}>
            {t("Exportações")}
          </button>
          <button onClick={() => context.navigate("/meetings/templates")}>
            {t("Modelos de reunião")}
          </button>
        </>
      )}
    </nav>
  );
}
export function MeetingActionStatus({action}:{action:{targetKind?:string | null;targetId?:string | null;state:string}}) {
  const {t}=useMeetingsLocalization();
  return <>{action.targetKind && action.targetId ? t("Registrada no módulo") : action.state === "DONE" ? t("Concluída") : t("Pendente")}</>;
}
function emptyMeetingCopy(locale:string,key:'mine'|'mineReports'|'period'|'organization'|'shared'|'clear'|'all') {
  const copy:Record<string,Record<typeof key,string>>={
    'pt-BR':{mine:'Nenhuma reunião sua neste período',mineReports:'Nenhuma ata sua neste período',period:'Nenhuma reunião neste período',organization:'Nenhuma reunião disponível nesta organização',shared:'Nenhuma reunião compartilhada',clear:'Limpar filtros',all:'Ver todas'},
    'en-US':{mine:'No meetings for you in this period',mineReports:'No reports for you in this period',period:'No meetings in this period',organization:'No meetings available in this organization',shared:'No shared meetings',clear:'Clear filters',all:'View all'},
    'es-ES':{mine:'No tienes reuniones en este período',mineReports:'No tienes actas en este período',period:'No hay reuniones en este período',organization:'No hay reuniones disponibles en esta organización',shared:'No hay reuniones compartidas',clear:'Borrar filtros',all:'Ver todas'},
    'fr-FR':{mine:'Aucune de vos réunions sur cette période',mineReports:'Aucun de vos comptes rendus sur cette période',period:'Aucune réunion sur cette période',organization:'Aucune réunion disponible dans cette organisation',shared:'Aucune réunion partagée',clear:'Effacer les filtres',all:'Tout voir'},
    'de-DE':{mine:'Keine eigenen Besprechungen in diesem Zeitraum',mineReports:'Keine eigenen Protokolle in diesem Zeitraum',period:'Keine Besprechungen in diesem Zeitraum',organization:'Keine verfügbaren Besprechungen in dieser Organisation',shared:'Keine geteilten Besprechungen',clear:'Filter löschen',all:'Alle anzeigen'},
    'it-IT':{mine:'Nessuna tua riunione in questo periodo',mineReports:'Nessun tuo verbale in questo periodo',period:'Nessuna riunione in questo periodo',organization:'Nessuna riunione disponibile in questa organizzazione',shared:'Nessuna riunione condivisa',clear:'Cancella filtri',all:'Mostra tutte'},
    'ja-JP':{mine:'この期間に自分の会議はありません',mineReports:'この期間に自分の議事録はありません',period:'この期間に会議はありません',organization:'この組織に利用可能な会議はありません',shared:'共有された会議はありません',clear:'絞り込みを解除',all:'すべて表示'},
    'nl-NL':{mine:'Geen eigen bijeenkomsten in deze periode',mineReports:'Geen eigen verslagen in deze periode',period:'Geen bijeenkomsten in deze periode',organization:'Geen beschikbare bijeenkomsten in deze organisatie',shared:'Geen gedeelde bijeenkomsten',clear:'Filters wissen',all:'Alles bekijken'},
  };
  return (copy[locale] ?? copy['pt-BR'])[key];
}
function MeetingSurface({ context }: { context: FeatureContext }) {
  const [proposalAgenda, setProposalAgenda] = useState<{meetingId:string;agendaId:string|null;type?:MeetingProposalType} | null>(null);
  const {
    t,
    formatDate,
    formatInstant,
    formatNumber,
    dateAtInstant,
    prefs,
    locale,
    formatError,
  } = useMeetingsLocalization();
  const secretaryText = secretaryClaimTranslator(locale);
  const facilitatorText = facilitatorTranslator(locale);
  const base = `/organizations/${context.organizationId}`,
    route = resolveMeetingRoute(context.path)!,
    path = route.path,
    id = route.id,
    circleFilter = new URLSearchParams(route.query).get("circleId") ?? "";
  const [items, setItems] = useState<Meeting[]>([]),
    [templates, setTemplates] = useState<any[]>([]),
    [agendaItems, setAgendaItems] = useState<any[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [pending, setPending] = useState(0),
    [tab, setTab] = useState(""),
    [versions, setVersions] = useState<any[]>([]),
    [view, setView] = useState("list"),
    [week, setWeek] = useState(() => dateAtInstant(new Date())!);
  const [nextCursor, setNextCursor] = useState<string | null>(null),
    moreController = useRef<AbortController | null>(null);
  const [search,setSearch]=useState('');
  const [scope,setScope]=useState<'mine'|'all'>('mine');
  const [previewId,setPreviewId]=useState<string|null>(null);
  const [previewExpanded,setPreviewExpanded]=useState(false);
  const [compactCatalogue,setCompactCatalogue]=useState(()=>window.innerWidth<=767);
  useEffect(()=>{
    const query=window.matchMedia?.('(max-width:767px)');
    if(!query)return;
    const update=()=>setCompactCatalogue(query.matches);
    update();
    query.addEventListener('change',update);
    return()=>query.removeEventListener('change',update);
  },[]);
  const pendingNotes = useRef(0);
  const onNotesPending = (count: number) => { pendingNotes.current = count; setPending(count); };
  useEffect(()=>{setPreviewId(null);setPreviewExpanded(false);setSearch('');setScope('mine');},[context.organizationId,context.session.account.id,context.bootstrap.membership.id,context.bootstrap.authorizationRevision,path]);
  useEffect(() => {
    setWeek(dateAtInstant(new Date())!);
  }, [prefs.timeZone]);
  function listPath() {
    if (path.endsWith("/agenda-items"))
      return base + "/meeting-agenda?limit=100";
    const q = new URLSearchParams({ limit: "100" });
    if (circleFilter) q.set("circleId", circleFilter);
    if (path.endsWith("/reports")) q.set("state", "CLOSED");
    else if (view === "calendar") {
      const bounds = meetingWeekBounds(week, prefs.timeZone);
      q.set("from", bounds.from);
      q.set("until", bounds.until);
    }
    return base + "/meetings?" + q;
  }
  async function loadMore() {
    if (!nextCursor) return;
    moreController.current?.abort();
    const c = new AbortController();
    moreController.current = c;
    setBusy(true);
    try {
      const r = await context.api<{
        items: any[];
        page: { nextCursor: string | null };
      }>(listPath() + "&cursor=" + encodeURIComponent(nextCursor), {
        signal: c.signal,
      });
      if (c.signal.aborted) return;
      if (path.endsWith("/agenda-items"))
        setAgendaItems((a) => [...a, ...r.data.items]);
      else setItems((a) => [...a, ...r.data.items]);
      setNextCursor(r.data.page.nextCursor);
    } catch (e) {
      if (!c.signal.aborted) setError(formatError(e));
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  const reload = () => setRevision((n) => n + 1);
  // Keep the shared meeting stage current without remounting collaborative notes.
  // An open form or an unacknowledged note always keeps its local state.
  useEffect(() => {
    if (!id || detail?.meeting.state !== 'RUNNING' || dialog || pending > 0 || new URLSearchParams(route.query).has('classic')) return;
    const controller = new AbortController();
    let refreshing = false;
    const timer = setInterval(async () => {
      if (refreshing || controller.signal.aborted) return;
      refreshing = true;
      try {
        const result = await context.api<Detail>(base + `/meetings/${id}`, {signal:controller.signal});
        if (!controller.signal.aborted && pendingNotes.current === 0) setDetail(previous => previous?.meeting.version === result.data.meeting.version ? previous : result.data);
      } catch { /* Commands and the notes transport expose actionable failures. */ }
      finally { refreshing = false; }
    }, 4000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [id, context.organizationId, context.bootstrap.membership.id, context.bootstrap.authorizationRevision, detail?.meeting.state, dialog, pending, route.query]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setDetail(null);
    setPending(0);
    setVersions([]);
    setNextCursor(null);
    setItems([]);
    setBusy(false);
    const load = async () => {
      try {
        if (id) {
          const r = await context.api<Detail>(base + `/meetings/${id}`, {
            signal: c.signal,
          });
          setDetail(r.data);
          setTab(
            r.data.meeting.sections.some((s) => s.id === route.sectionId)
              ? route.sectionId!
              : route.sectionId === "agenda" && r.data.meeting.sections.some((s) => s.kind === "AGENDA")
                ? r.data.meeting.sections.find((s) => s.kind === "AGENDA")!.id
              : (r.data.meeting.currentStep ?? r.data.meeting.sections[0].id),
          );
          if (r.data.report) {
            const v = await context.api<{ items: any[] }>(
              base + `/meetings/${id}/report/versions`,
              { signal: c.signal },
            );
            setVersions(v.data.items);
          }
        } else if (path.endsWith("/agenda-items")) {
          const r = await context.api<{
            items: any[];
            page: { nextCursor: string | null };
          }>(listPath(), { signal: c.signal });
          setAgendaItems(r.data.items);
          setNextCursor(r.data.page.nextCursor);
        } else if (path.endsWith("/templates")) {
          const r = await context.api<{ items: any[] }>(
            base + "/meeting-templates",
            { signal: c.signal },
          );
          setTemplates(r.data.items);
        } else {
          const [r, t] = await Promise.all([
            context.api<{
              items: Meeting[];
              page: { nextCursor: string | null };
            }>(listPath(), {
              signal: c.signal,
            }),
            context.bootstrap.membership.memberType === "GUEST"
              ? Promise.resolve({ data: { items: [] } })
              : context.api<{ items: any[] }>(base + "/meeting-templates", {
                  signal: c.signal,
                }),
          ]);
          if (c.signal.aborted) return;
          setItems(r.data.items);
          setNextCursor(r.data.page.nextCursor);
          setTemplates(t.data.items);
        }
      } catch (e) {
        if (!c.signal.aborted) setError(formatError(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => {
      c.abort();
      moreController.current?.abort();
    };
  }, [context.organizationId,context.session.account.id,context.bootstrap.membership.id,context.bootstrap.authorizationRevision,context.bootstrap.membership.memberType,path,revision,view,week,prefs.timeZone,circleFilter]);
  useEffect(() => {
    if (detail)
      setTab(
        route.sectionId &&
          detail.meeting.sections.some((s) => s.id === route.sectionId)
          ? route.sectionId
          : (detail.meeting.currentStep ?? detail.meeting.sections[0].id),
      );
  }, [route.sectionId, detail?.meeting.id]);
  useEffect(() => {
    if (!id || !detail?.report) return;
    const c = new AbortController();
    void context
      .api<{ items: any[] }>(base + `/meetings/${id}/report/versions`, {
        signal: c.signal,
      })
      .then((r) => setVersions(r.data.items))
      .catch((e) => {
        if (!c.signal.aborted) setError(formatError(e));
      });
    return () => c.abort();
  }, [id, detail?.report?.version, context.organizationId]);
  async function execute(
    suffix: string,
    body: any = {},
    resourceVersion = detail?.meeting.version,
  ) {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const r = await context.api<Detail>(base + `/meetings/${id}` + suffix, {
        method: "POST",
        body,
        version: resourceVersion,
      });
      if (r.data.meeting) setDetail(r.data);
      setDialog("");
      context.notify(t("Alteração confirmada."));
      if (!r.data.meeting || suffix.includes("/report/")) reload();
      return true;
    } catch (e) {
      setError(formatError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      v = (k: string) => String(f.get(k) ?? "");
    if (dialog === "migrate")
      return execute("/collaboration/actions/migrate", {
        protocol: RICH_TEXT_PROTOCOL,
        documents: detail!.documents.map((d) => ({
          sectionId: d.sectionId,
          epoch: d.epoch,
          sequence: d.sequence,
        })),
        reason: v("reason"),
      });
    if (dialog === "agenda")
      return execute("/agenda", {
        title: v("title"),
        description: v("description"),
        durationMinutes: Number(v("durationMinutes")),
        presenterId: v("memberId"),
      });
    if (dialog === "action")
      return execute("/actions/work-item", {
        title: v("title"),
        assigneeId: v("memberId"),
      });
    if (dialog === "notetaker")
      return execute("/actions/notetaker", {
        memberId: v("memberId"),
        notesOnlyNoter: f.has("notesOnlyNoter"),
      });
    if (dialog === 'facilitator') return execute('/actions/facilitator',{memberId:v('memberId')});
    if (dialog === "reschedule")
      return execute("/actions/reschedule", {
        scope: v("scope"),
        localStart: v("localStart"),
        timeZone: v("timeZone"),
        title: v("title"),
        durationMinutes: Number(v("durationMinutes")),
      });
    if (dialog === "restore")
      return execute(
        "/report/actions/restore",
        { restoreVersion: Number(v("restoreVersion")), reason: v("reason") },
        detail?.report.version,
      );
    if (dialog === "cancel")
      return execute("/actions/cancel", {
        scope: v("scope"),
        reason: v("reason"),
      });
    if (dialog === "delete") {
      const scope = v("scope");
      void (async () => {
        if (await execute("/actions/delete", { scope }))
          context.navigate("/meetings");
      })();
      return;
    }
    if (dialog === "report-access")
      return execute(
        "/report/actions/access",
        {
          memberId: v("memberId"),
          canRead: f.has("canRead"),
          canEdit: f.has("canEdit"),
        },
        detail?.report.version,
      );
    if (dialog === "reopen")
      return execute(
        "/report/actions/reopen",
        { reason: v("reason") },
        detail?.report.version,
      );
    if (dialog === "participant" && v("access") === "REMOVE") {
      if (v("scope") !== "THIS") {
        setError(
          t(
            "A retirada de participação se aplica a esta reunião. Selecione Somente esta reunião.",
          ),
        );
        return;
      }
      return execute("/actions/participants/remove", {
        memberId: v("memberId"),
      });
    }
    if (dialog === "participant")
      return execute("/actions/participants", {
        scope: v("scope"),
        participants: [
          {
            memberId: v("memberId"),
            access: v("access"),
            participationRole: v("participationRole"),
            canManage: f.has("canManage"),
            canPublish: f.has("canPublish"),
            canRestore: f.has("canRestore"),
          },
        ],
      });
    setBusy(true);
    setError("");
    try {
      if (dialog === "template" || dialog.startsWith("template-edit:")) {
        const parts = JSON.parse(v("sectionsJson"));
        const existing = templates.find((t) => t.id === dialog.split(":")[1]);
        await context.api(
          base +
            "/meeting-templates" +
            (existing ? `/${existing.id}/actions/revise` : ""),
          {
            method: "POST",
            version: existing?.version,
            body: { name: v("title"), method: v("method"), sections: parts },
          },
        );
      } else if (dialog === "instant") {
        const body = {
          title: v("title"),
          circleId: v("circleId"),
          localStart: Temporal.Now.zonedDateTimeISO(prefs.timeZone)
            .toPlainDateTime()
            .toString({ smallestUnit: "minute" }),
          timeZone: prefs.timeZone,
          durationMinutes: Number(v("durationMinutes")),
          recurrence: { frequency: "ONCE", interval: 1, count: 1 },
          startNow: true,
          notesProtocol: RICH_TEXT_PROTOCOL,
          ...(f.has("useRoster")
            ? {
                roster: {
                  includeSubcircles: f.has("includeSubcircles"),
                  roleIds: [],
                },
              }
            : {}),
          sections: initialSections.map((s) => ({ ...s, title: t(s.title) })),
          method: context.bootstrap.governanceModel ? "HOLACRACY" : "CUSTOM",
        };
        const r = await context.api<{ occurrenceIds: string[] }>(
          base + "/meeting-series",
          { method: "POST", body },
        );
        context.navigate("/meetings/" + r.data.occurrenceIds[0]);
      } else {
        const recurrence = {
          frequency: v("frequency"),
          interval: Number(v("interval")),
          count: Number(v("count")),
          ...(v("until") ? { until: v("until") } : {}),
          ...(f.getAll("byDay").length
            ? { byDay: f.getAll("byDay").map(Number) }
            : {}),
          ...(v("bySetPos") ? { bySetPos: Number(v("bySetPos")) } : {}),
        };
        const memberIds = f.getAll("participants").map(String);
        const body = {
          title: v("title"),
          circleId: v("circleId"),
          localStart: v("localStart"),
          timeZone: v("timeZone"),
          durationMinutes: Number(v("durationMinutes")),
          recurrence,
          notesProtocol: RICH_TEXT_PROTOCOL,
          ...(f.has("useRoster")
            ? {
                roster: {
                  includeSubcircles: f.has("includeSubcircles"),
                  roleIds: f.getAll("roleIds").map(String),
                },
              }
            : {}),
          participants: memberIds.map((memberId) => ({
            memberId,
            access: "EDIT",
            ...(memberId === context.bootstrap.membership.id
              ? { canManage: true, canPublish: true, canRestore: true }
              : {}),
          })),
          policy: {
            notesOnlyNoter: f.has("notesOnlyNoter"),
            windowDays: Number(v("windowDays")),
          },
          ...(v("templateId")
            ? { templateId: v("templateId") }
            : {
                sections: initialSections.map((s) => ({
                  ...s,
                  title: t(s.title),
                })),
                method: v("method"),
              }),
        };
        const r = await context.api<{ occurrenceIds: string[] }>(
          base + "/meeting-series",
          { method: "POST", body },
        );
        context.navigate("/meetings/" + r.data.occurrenceIds[0]);
      }
      setDialog("");
      reload();
      context.notify(t("Registro criado."));
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }
  const memberOptions = context.members
    .filter((m) => m.status === "ACTIVE")
    .map((m) => (
      <option key={m.id} value={m.id}>
        {m.displayName}
      </option>
    ));
  const person = (mid: string) =>
    context.members.find((m) => m.id === mid)?.displayName ?? t("Participante");
  const reports = path.endsWith("/reports"),
    agendaPage = path.endsWith("/agenda-items"),
    templatePage = path.endsWith("/templates");
  const cataloguePage = !id && !agendaPage && !templatePage;
  const canSchedule = !id &&
    context.bootstrap.membership.memberType !== "GUEST" &&
    (context.bootstrap.membership.orgRole === "OWNER" || !!context.bootstrap.governanceModel);
  const scheduleButton = canSchedule && (
    <>
      <Button className="primary" onClick={() => setDialog(templatePage ? "template" : "create")}>
        <Plus size={16} />
        {templatePage ? t("Criar modelo") : locale === "pt-BR" ? "Agendar reunião" : t("Adicionar reunião")}
      </Button>
      {!templatePage && (
        <Button disabled={busy} onClick={() => setDialog("instant")}>
          <Play size={16} />
          {t("Iniciar agora")}
        </Button>
      )}
    </>
  );
  const history = new URLSearchParams(route.query).get("history") === "1";
  const weekDays = () => meetingWeek(week);
  const periodItems = items.filter(meeting => reports ? meeting.state === "CLOSED" : history || !["CLOSED", "CANCELLED"].includes(meeting.state));
  const searchTerm=search.trim().toLocaleLowerCase(locale);
  const visibleItems=periodItems.filter(meeting=>{
    const circle=context.structure.nodes.find(node=>node.entityId===meeting.circleId)?.name??'';
    return (context.bootstrap.membership.memberType==='GUEST'||scope==='all'||meeting.isParticipant===true) && (!searchTerm || (meeting.title+' '+circle).toLocaleLowerCase(locale).includes(searchTerm));
  });
  const filteredMeetings = !!searchTerm || !!circleFilter;
  const otherMeetings = context.bootstrap.membership.memberType !== 'GUEST' && scope === 'mine' && periodItems.length > 0;
  const clearMeetingFilters = () => {
    setSearch('');
    if (circleFilter) { const params = new URLSearchParams(route.query); params.delete('circleId'); context.navigate(path + (params.size ? '?' + params : '')); }
  };
  const docs = detail?.documents.find((d) => d.sectionId === tab);
  const room = !!id && !new URLSearchParams(route.query).has('classic');
  return (
    <div className={'meetings-page mare-meetings'+(previewId?' mare-meetings-has-preview':'')+(room?' mare-meeting-room-page':'')}>
      {!room && !cataloguePage && <header className="page-heading">
        <div>
          <h1>
            {detail?.meeting.title ??
              (reports
                ? t("Atas")
                : agendaPage
                  ? t("Itens da agenda")
                  : templatePage
                    ? t("Modelos de reunião")
                    : t("Reuniões"))}
          </h1>
          {detail && (
            <p className="muted">
              {formatInstant(detail.meeting.startAt)} · {prefs.timeZone} ·{" "}
              {formatNumber(detail.meeting.durationMinutes)} {t("min")}
              {detail.meeting.timeZone !== prefs.timeZone && (
                <><br /><small>{t("Fuso do evento: {zone}", { zone: detail.meeting.timeZone })}</small></>
              )}
            </p>
          )}
        </div>
        {scheduleButton}
        {id && (
          <Button
            onClick={() => context.navigate("/meetings")}
            disabled={pending > 0}
          >
            {t("Voltar às reuniões")}
          </Button>
        )}
      </header>}
      <TraceReturnLink context={context} returnTo={new URLSearchParams(route.query).get("returnTo")} disabled={pending > 0} />
      {error && <Notice>{error}</Notice>}
      {detail?.accessMode === "GUEST_READ" && (
        <Notice>
          {t(
            "Reunião compartilhada para leitura. Você pode consultar somente este recurso.",
          )}
        </Notice>
      )}
      {detail?.accessMode === "SUPERVISED_READ" && (
        <Notice>
          {t(
            "Leitura por supervisão administrativa. Este acesso não concede edição da reunião ou da ata.",
          )}
        </Notice>
      )}
      {loading ? (
        <div className="meetings-loading" role="status">
          {t("Carregando reuniões…")}
        </div>
      ) : detail && room ? (
        <MeetingRoom context={context} detail={detail} versions={versions} busy={busy || pending > 0} onDialog={setDialog} onCommand={async (...args) => { await execute(...args); }} onPending={onNotesPending} />
      ) : detail ? (
        <>
          <div className="meetings-session-toolbar">
            <span className="badge">{t(labels[detail.meeting.state])}</span>
            {detail.report && (
              <ReportPublicationStatus report={detail.report} versions={versions} />
            )}
            <span className="meetings-spacer" />
            {detail.capabilities.manage && (
              <>
                {detail.meeting.state === "SCHEDULED" && (
                  <>
                    <Button
                      className="primary"
                      disabled={busy || pending > 0}
                      onClick={() => void execute("/actions/start")}
                    >
                      {t("Iniciar reunião")}
                    </Button>
                    <Button onClick={() => setDialog("reschedule")}>
                      {t("Reagendar")}
                    </Button>
                    <Button onClick={() => setDialog("cancel")}>
                      {t("Cancelar reunião")}
                    </Button>
                    <Button onClick={() => setDialog("delete")}>
                      {t("Excluir reunião")}
                    </Button>
                  </>
                )}
                {detail.meeting.state === "RUNNING" && (
                  <Button
                    disabled={busy || pending > 0}
                    onClick={() => setDialog("close")}
                  >
                    {t("Encerrar reunião")}
                  </Button>
                )}
                <Button
                  onClick={() => setDialog("participant")}
                  disabled={pending > 0}
                >
                  <Users size={16} />
                  {t("Participantes")}
                </Button>
                <Button
                  onClick={() => setDialog("notetaker")}
                  disabled={pending > 0}
                >
                  {t("Secretaria")}
                </Button>
                {detail.meeting.method === 'HOLACRACY' && ['SCHEDULED','RUNNING'].includes(detail.meeting.state) && <Button onClick={() => setDialog('facilitator')} disabled={pending > 0}>{facilitatorText('assign')}</Button>}
              </>
            )}
            {detail.capabilities.secretaryOperation && !detail.capabilities.manage && detail.meeting.state === 'SCHEDULED' && (
              <>
                <Button className="primary" disabled={busy || pending > 0} onClick={() => void execute('/actions/start')}>{t('Iniciar reunião')}</Button>
                <Button disabled={busy || pending > 0} onClick={() => setDialog('reschedule')}>{t('Reagendar')}</Button>
                <Button disabled={busy || pending > 0} onClick={() => setDialog('cancel')}>{t('Cancelar reunião')}</Button>
              </>
            )}
            {detail.accessMode === 'PARTICIPANT' && context.bootstrap.membership.memberType === 'MEMBER' && detail.meeting.method === 'HOLACRACY' && ['SCHEDULED','RUNNING'].includes(detail.meeting.state) &&
              detail.meeting.notetakerId !== context.bootstrap.membership.id &&
              detail.participants.some(p => p.memberId === context.bootstrap.membership.id && p.access !== 'DENY') &&
              !detail.participants.some(p => p.memberId === detail.meeting.notetakerId && p.attendance === 'PRESENT') && (
                <Button disabled={busy || pending > 0} onClick={() => setDialog('claim-secretary')}>
                  {secretaryText('claim')}
                </Button>
              )}
            {detail.report && detail.capabilities.manage && (
              <Button
                disabled={pending > 0}
                onClick={() => setDialog("report-access")}
              >
                {t("Permissões da ata")}
              </Button>
            )}
            {detail.report && detail.capabilities.publish && (
              <Button
                disabled={busy || pending > 0}
                onClick={() =>
                  void execute(
                    "/report/actions/publish",
                    {},
                    detail.report.version,
                  )
                }
              >
                {t("Publicar ata")}
              </Button>
            )}
            {detail.report && detail.capabilities.restore && (
              <>
                <Button
                  disabled={pending > 0}
                  onClick={() => setDialog("restore")}
                >
                  {t("Restaurar versão")}
                </Button>
                <Button
                  disabled={pending > 0}
                  onClick={() => setDialog("reopen")}
                >
                  {t("Reabrir edição")}
                </Button>
              </>
            )}
          </div>
          <div className="meetings-session">
            <nav className="meetings-steps" aria-label={t("Etapas da reunião")}>
              {detail.meeting.sections.map((s) => (
                <button
                  key={s.id}
                  disabled={pending > 0}
                  className={tab === s.id ? "meetings-selected" : ""}
                  onClick={() => {
                    setTab(s.id);
                    context.navigate(meetingHref(id, s.id));
                  }}
                >
                  {s.title}
                  {detail.meeting.currentStep === s.id &&
                    detail.meeting.state === "RUNNING" && (
                      <span className="muted"> {t("Em execução")}</span>
                    )}
                </button>
              ))}
              <hr />
              <strong>{t("Participantes")}</strong>
              {detail.participants
                .filter((p) => p.access !== "DENY")
                .map((p) => (
                  <div key={p.memberId} className="meetings-person">
                    <span>
                      {person(p.memberId)}
                      {p.memberId === detail.meeting.notetakerId
                        ? " · " + t("Secretaria")
                        : ""}
                      {detail.meeting.method === 'HOLACRACY' && p.memberId === detail.meeting.facilitatorId ? ' · ' + facilitatorText('name') : ''}
                    </span>
                    <small>
                      {p.participationRole === "OPTIONAL"
                        ? t("Opcional")
                        : t("Obrigatório")}{" "}
                      · {p.access === "EDIT" ? t("Edição") : t("Leitura")} ·{" "}
                      {p.attendance === "PRESENT"
                        ? t("Presente")
                        : p.attendance === "ABSENT"
                          ? t("Ausente")
                          : t("Convidado")}
                    </small>
                    {detail.capabilities.edit &&
                      p.memberId === context.bootstrap.membership.id && (
                        <Button
                          onClick={() =>
                            void execute("/actions/attendance", {
                              memberId: p.memberId,
                              attendance: "PRESENT",
                            })
                          }
                        >
                          {t("Confirmar presença")}
                        </Button>
                      )}
                  </div>
                ))}
            </nav>
            <section className="meetings-stage">
              <div className="meetings-stage-heading">
                <h2>
                  {detail.meeting.sections.find((s) => s.id === tab)?.title}
                </h2>
                {detail.capabilities.facilitatorOperation &&
                  detail.meeting.state === "RUNNING" &&
                  tab !== detail.meeting.currentStep && (
                    <Button
                      disabled={pending > 0}
                      onClick={() =>
                        void execute("/actions/step", { sectionId: tab })
                      }
                    >
                      {t("Executar esta etapa")}
                    </Button>
                  )}
              </div>
              {detail.meeting.state === "SCHEDULED" && (
                <Notice>
                  {t(
                    "As notas estarão disponíveis após iniciar a reunião. Navegar pelas etapas não inicia a sessão.",
                  )}
                </Notice>
              )}
              {detail.meeting.sections.find((s) => s.id === tab)?.kind ===
                "AGENDA" && (
                <div className="meetings-agenda">
                  <div className="meetings-stage-heading">
                    <h3>{t("Itens da agenda")}</h3>
                    {detail.capabilities.edit &&
                      ["SCHEDULED", "RUNNING"].includes(
                        detail.meeting.state,
                      ) && (
                        <Button className="primary" onClick={() => setDialog("agenda")}>
                          {t("Adicionar item")}
                        </Button>
                      )}
                  </div>
                  {!detail.agenda.length ? (
                    <p className="muted">{t("Nenhum item na agenda.")}</p>
                  ) : (
                    detail.agenda.map((a) => (
                      <div className="meetings-agenda-row" key={a.id}>
                        <div>
                          <strong>{a.title}</strong>
                          <TraceOrigin
                            context={context}
                            endpoint={`${base}/meetings/${id}/agenda/${a.id}/origin`}
                            returnTo={meetingHref(id, "agenda")}
                            disabled={pending > 0}
                          />
                          <small>
                            {person(a.presenterId)} ·{" "}
                            {formatNumber(a.durationMinutes)} {t("min ·")}{" "}
                            {t(labels[a.status])}
                            {a.skipped ? t(" · Pulado nesta sessão") : ""}
                          </small>
                        </div>
                        {a.status === "OPEN" && detail.capabilities.edit && (
                          <div className="meetings-inline-actions">
                            {detail.meeting.state === "RUNNING" && (
                              <>
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void execute(
                                      `/agenda/${a.id}/actions/skip`,
                                      {},
                                      a.version,
                                    )
                                  }
                                >
                                  {t("Pular")}
                                </Button>
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void execute(
                                      `/agenda/${a.id}/actions/complete`,
                                      {},
                                      a.version,
                                    )
                                  }
                                >
                                  {t("Concluir")}
                                </Button>
                              </>
                            )}
                            <Button
                              onClick={() => setDialog("transfer:" + a.id)}
                            >
                              {t("Transferir")}
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
              {detail.meeting.sections.find((s) => s.id === tab)?.kind ===
                "PROJECTS" && (
                <LinkedItems
                  context={context}
                  meetingId={id!}
                  canAdd={
                    detail.capabilities.edit &&
                    ["SCHEDULED", "RUNNING"].includes(detail.meeting.state)
                  }
                  onAdd={(item, subcircles) =>
                    void execute("/agenda", {
                      title: item.title,
                      sourceId: item.id,
                      includeSubcircles: subcircles,
                      presenterId: context.bootstrap.membership.id,
                      durationMinutes: 5,
                    })
                  }
                />
              )}
              {detail.documents.some(
                (d) => d.protocol !== RICH_TEXT_PROTOCOL,
              ) &&
                detail.capabilities.manage &&
                detail.capabilities.notes && (
                  <Button
                    disabled={busy || pending > 0}
                    onClick={() => setDialog("migrate")}
                  >
                    {t("Ativar editor rico")}
                  </Button>
                )}
              {docs && detail.accessMode === "GUEST_READ" ? (
                <div>
                  <strong>{t("Notas compartilhadas · Somente leitura")}</strong>
                  {docs.document ? (
                    <RichTextView
                      value={docs.document}
                      emptyText={t("Sem conteúdo.")}
                    />
                  ) : (
                    <p style={{ whiteSpace: "pre-wrap" }}>{docs.text}</p>
                  )}
                </div>
              ) : (
                docs && (
                  <CollaborativeNotes
                    key={`${id}/${tab}/${docs.epoch}`}
                    context={context}
                    meetingId={id!}
                    sectionId={tab}
                    epoch={docs.epoch}
                    protocol={docs.protocol}
                    schemaVersion={docs.schemaVersion}
                    editable={detail.capabilities.notes}
                    onPending={onNotesPending}
                  />
                )
              )}
              <div className="meetings-stage-heading">
                <h3>{t("Ações registradas")}</h3>
                {detail.capabilities.edit &&
                  detail.meeting.state === "RUNNING" && (
                    <Button className="primary" disabled={pending>0} onClick={() => setDialog("outcome")}>
                      {t("Criar saída")}
                    </Button>
                  )}
              </div>
              {detail.actions.map((a) => (
                <div key={a.id} className="meetings-agenda-row">
                  <div>
                    <strong>{a.title}</strong>
                    {a.targetKind === "PROPOSAL" && a.targetProposal ? (
                      <ProposalOutcomeDiff context={context} detail={a.targetProposal} proposalId={a.targetId} onDone={reload} />
                    ) : null}
                    <small>
                      {person(a.assigneeId)} ·{" "}
                      <MeetingActionStatus action={a} />
                    </small>
                  </div>
                  {a.targetKind && a.targetId && <button type="button" onClick={()=>{const route=traceRoute({kind:a.targetKind,id:a.targetId,title:a.title},meetingHref(id!,"agenda"));if(route)context.navigate(route);}}>{t("Abrir saída")}</button>}
                  {!a.targetKind && a.state === "OPEN" &&
                    detail.capabilities.edit &&
                    (detail.capabilities.manage ||
                      a.assigneeId === context.bootstrap.membership.id) && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void execute(
                            `/work-items/${a.id}/actions/complete`,
                            {},
                            a.version,
                          )
                        }
                      >
                        {t("Concluir ação")}
                      </Button>
                    )}
                </div>
              ))}
              {!detail.actions.length && (
                <p className="muted">{t("Nenhuma ação registrada.")}</p>
              )}
              {detail.report && (
                <details className="meetings-history">
                  <summary>
                    {t("Histórico da ata ·")}
                    {formatNumber(versions.length)} {t("versões")}
                  </summary>
                  <p className="muted">
                    {detail.report.firstPublishedAt
                      ? t("Primeira publicação: {date}", {
                          date: formatInstant(detail.report.firstPublishedAt),
                        })
                      : t("Ainda não publicada.")}{" "}
                    {detail.report.windowDays === 0
                      ? t("· Janela:") + " " + t("ilimitada")
                      : t("Janela: {days} dias", {
                          days: formatNumber(detail.report.windowDays),
                        })}
                  </p>
                  {versions.map((v) => (
                    <p key={v.version}>
                      {t("v")}
                      {v.version} · {formatInstant(v.createdAt)} · {v.reason}
                    </p>
                  ))}
                </details>
              )}
            </section>
          </div>
        </>
      ) : templatePage ? (
        <div className="meetings-list">
          {templates.length ? (
            templates.map((template) => (
              <article className="entity-row" key={template.id}>
                <div>
                  <strong>{template.name}</strong>
                  <small>
                    {template.sections.map((s: Section) => s.title).join(" → ")}
                  </small>
                </div>
                <span className="badge">{template.method}</span>
                {context.bootstrap.membership.orgRole === "OWNER" && (
                  <Button onClick={() => setDialog("template-edit:" + template.id)}>
                    {t("Editar")}
                  </Button>
                )}
              </article>
            ))
          ) : (
            <div className="empty-state">
              <h2>{t("Nenhum modelo de reunião")}</h2>
              <p>{t("Crie etapas para reutilizar em novas reuniões.")}</p>
            </div>
          )}
        </div>
      ) : agendaPage ? (
        <div className="meetings-list">
          {agendaItems.length ? (
            agendaItems.map((a) => (
              <button
                key={a.id}
                className="entity-row meetings-list-row"
                onClick={() => context.navigate("/meetings/" + a.meetingId)}
              >
                <List size={18} />
                <div>
                  <strong>{a.title}</strong>
                  <small>
                    {a.meetingTitle} · {t(labels[a.status])}
                    {a.skipped ? t(" · Pulado nesta sessão") : ""}
                  </small>
                </div>
              </button>
            ))
          ) : (
            <div className="empty-state">
              <h2>{t("A agenda está vazia")}</h2>
              <p>{t("Os itens das suas reuniões aparecerão aqui.")}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mare-meetings-controls">
            <div className="collection-toolbar mare-meetings-catalogue-toolbar">
              {context.bootstrap.membership.memberType !== "GUEST" && (
                <div className="mare-meetings-scope" role="group" aria-label={t("Reuniões")}>
                  <Button pressed={scope === "mine"} onClick={() => setScope("mine")}>
                    {meetingCopy(locale, "mine")}
                  </Button>
                  <Button pressed={scope === "all"} onClick={() => setScope("all")}>
                    {meetingCopy(locale, "all")}
                  </Button>
                </div>
              )}
              <div className="mare-meetings-search">
                <Search size={17} aria-hidden="true" />
                <input
                  aria-label={meetingCopy(locale, "search")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={meetingCopy(locale, "search")}
                />
                {search && (
                  <Button onClick={() => setSearch("")} ariaLabel={meetingCopy(locale, "clearSearch")}>
                    <X size={15} aria-hidden="true" />
                  </Button>
                )}
              </div>
              {scheduleButton}
            </div>
            <details
              className="mare-meetings-presentation"
              open={!compactCatalogue || undefined}
              onKeyDown={(event) => {
                if (compactCatalogue && event.key === "Escape") {
                  event.preventDefault();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary>
                {meetingCopy(locale, "presentation")}
                {circleFilter && <span className="mare-meetings-filter-count">1</span>}
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className="mare-meetings-viewtools">
                <Field label={t("Círculo")} name="circleFilter">
                  <select
                    id="circleFilter"
                    name="circleFilter"
                    value={circleFilter}
                    onChange={(event) => {
                      const query = new URLSearchParams(route.query);
                      if (event.target.value) query.set("circleId", event.target.value);
                      else query.delete("circleId");
                      context.navigate(path + (query.size ? "?" + query : ""));
                    }}
                  >
                    <option value="">{t("Todos os círculos")}</option>
                    {circleFilter && !context.structure.circles.some((circle) => circle.id === circleFilter) && (
                      <option value={circleFilter}>{t("Círculo")}</option>
                    )}
                    {context.structure.circles.map((circle) => (
                      <option key={circle.id} value={circle.id}>
                        {context.structure.nodes.find((node) => node.entityId === circle.id)?.name ?? t("Círculo")}
                      </option>
                    ))}
                  </select>
                </Field>
                {!reports && (
                  <>
                    <div className="mare-meetings-viewtoggle" role="group" aria-label={meetingCopy(locale, "presentation")}>
                      <Button pressed={view === "list"} onClick={() => setView("list")}>
                        <List size={16} aria-hidden="true" />
                        {t("Lista")}
                      </Button>
                      <Button pressed={view === "calendar"} onClick={() => setView("calendar")}>
                        <CalendarDays size={16} aria-hidden="true" />
                        {t("Calendário")}
                      </Button>
                    </div>
                    <select
                      className="mare-meetings-period"
                      aria-label={meetingCopy(locale, "period")}
                      value={history ? "all" : "upcoming"}
                      onChange={(event) => {
                        const params = new URLSearchParams(route.query);
                        if (event.target.value === "all") params.set("history", "1");
                        else params.delete("history");
                        context.navigate(path + (params.size ? "?" + params : ""));
                      }}
                    >
                      <option value="upcoming">{meetingCopy(locale, "upcoming")}</option>
                      <option value="all">{meetingCopy(locale, "history")}</option>
                    </select>
                  </>
                )}
                <small className="mare-meetings-timezone">{prefs.timeZone}</small>
              </div>
            </details>
          </div>
            {view === "calendar" && !reports && (
              <div className="mare-meetings-calendar-controls">
                <Button onClick={() => setWeek(dateAtInstant(new Date())!)}>
                  {t("Hoje")}
                </Button>
                <Button
                  title={t("Semana anterior")}
                  onClick={() => setWeek((d) => shiftMeetingWeek(d, -1))}
                >
                  <ChevronLeft size={18} />
                </Button>
                <strong>
                  {formatDate(weekDays()[0], { day: "numeric", month: "short" })} – {formatDate(weekDays()[6], { day: "numeric", month: "short", year: "numeric" })}
                </strong>
                <Button
                  title={t("Próxima semana")}
                  onClick={() => setWeek((d) => shiftMeetingWeek(d, 1))}
                >
                  <ChevronRight size={18} />
                </Button>
              </div>
            )}
          <p className="mare-meetings-result-count" role="status">{t(reports ? (visibleItems.length === 1 ? "{count} ata" : "{count} atas") : (visibleItems.length === 1 ? "{count} reunião" : "{count} reuniões"), {count: formatNumber(visibleItems.length)})}</p>
          {!visibleItems.length ? (
            <div className="empty-state">
              <CalendarDays size={32} />
              <h2>
                {filteredMeetings ? meetingCopy(locale,'noResults') : otherMeetings ? emptyMeetingCopy(locale,reports?'mineReports':'mine') : reports
                  ? t("Nenhuma ata disponível") : nextCursor ? meetingCopy(locale,'noResults') : history ? emptyMeetingCopy(locale,context.bootstrap.membership.memberType === 'GUEST'?'shared':'organization') : emptyMeetingCopy(locale,'period')}
              </h2>
              {filteredMeetings ? <Button onClick={clearMeetingFilters}>{emptyMeetingCopy(locale,'clear')}</Button> : otherMeetings ? <Button onClick={()=>setScope('all')}>{emptyMeetingCopy(locale,'all')}</Button> : view === "calendar" && !reports ? (
                <Button onClick={() => setView("list")}>{t("Lista")}</Button>
              ) : null}
            </div>
          ) : view === "calendar" && !reports && !agendaPage ? (
            <div
              className="meetings-calendar"
              role="region"
              aria-label={t("Calendário semanal")}
            >
              {weekDays().map((day) => (
                <section key={day} className={"meetings-day"+(day===dateAtInstant(new Date())?" is-today":"")}>
                  <header>
                    <span>{formatDate(day, { weekday: "short" })}</span>
                    <strong>{formatNumber(Number(day.slice(8)))}</strong>
                  </header>
                  <div className="meetings-day-body">
                    {visibleItems
                      .filter((m) => dateAtInstant(m.startAt) === day)
                      .map((m) => (
                        <button
                          key={m.id}
                          className="meetings-event"
                          onClick={() => {setPreviewId(m.id);setPreviewExpanded(false);}}
                        >
                          <time>
                            {formatInstant(m.startAt, true, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          <strong>{m.title}</strong>
                          <small>{t(labels[m.state])}</small>
                        </button>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="meetings-list">
              {[...new Set(visibleItems.map(m=>dateAtInstant(m.startAt)))].map(day=><section className="mare-meetings-date-group" key={day??'unknown'}><h2>{day?formatDate(day,{weekday:'long',day:'numeric',month:'long'}):'—'}</h2>{visibleItems.filter(m=>dateAtInstant(m.startAt)===day).map((m) => (
                  <button
                    className="entity-row meetings-list-row"
                    key={m.id}
                    aria-expanded={previewId===m.id}
                    onClick={() => {setPreviewId(m.id);setPreviewExpanded(false);}}
                  >
                    <span className="mare-meetings-row-time"><strong>{formatInstant(m.startAt,true,{hour:'2-digit',minute:'2-digit'})}</strong><small>{formatNumber(m.durationMinutes)} {t('min')}</small></span>
                    <div>
                      <strong>{m.title}</strong>
                      <small>
                        {context.structure.nodes.find(node=>node.entityId===m.circleId)?.name ?? t('Círculo')}
                        {m.timeZone !== prefs.timeZone && <><br />{t("Fuso do evento: {zone}", { zone: m.timeZone })}</>}
                      </small>
                    </div>
                    <span className={"mare-meeting-status "+m.state.toLowerCase()}>{t(labels[m.state])}</span>
                    <ChevronRight size={18}/>
                  </button>
                ))}</section>)}
            </div>
          )}
        </>
      )}
      {!id && !reports && !agendaPage && !templatePage && <button type="button" className="mare-meeting-past-link" onClick={() => context.navigate("/meetings/reports")}>{locale === "pt-BR" ? "Ver atas dos encontros anteriores" : t("Atas")}<ChevronRight size={15}/></button>}
      {!id && nextCursor && (
        <div className="meetings-pagination">
          <p className="muted">{t("Há mais registros neste período.")}</p>
          <Button disabled={busy} onClick={() => void loadMore()}>
            {busy ? t("Carregando…") : t("Carregar mais")}
          </Button>
        </div>
      )}
      {previewId && !id && <MeetingPreview key={`${context.organizationId}:${context.session.account.id}:${context.bootstrap.membership.id}:${context.bootstrap.authorizationRevision}:${previewId}`} context={context} id={previewId} expanded={previewExpanded} onExpand={()=>setPreviewExpanded(value=>!value)} onClose={()=>{setPreviewId(null);setPreviewExpanded(false);}}/>}
      {dialog && (
        <Dialog
          title={
            {
              create: locale === "pt-BR" ? "Agendar reunião" : t("Adicionar reunião"),
              instant: t("Iniciar agora"),
              template: t("Criar modelo"),
              agenda: t("Adicionar item da agenda"),
              action: t("Registrar ação"),
              outcome: t("Criar saída"),
              notetaker: t("Secretaria da reunião"),
              facilitator: facilitatorText('assign'),
              'claim-secretary': secretaryText('claim'),
              participant: t("Acesso do participante"),
              reschedule: t("Reagendar reunião"),
              restore: t("Restaurar versão da ata"),
              reopen: t("Reabrir edição da ata"),
              migrate: t("Ativar editor rico"),
              close: t("Encerrar reunião"),
              cancel: t("Cancelar reunião"),
              delete: t("Excluir reunião"),
            }[dialog.split(':')[0]] ?? t("Transferir item")
          }
          onClose={() => !busy && setDialog("")}
        >
          {dialog === 'claim-secretary' ? (
            <div className="edit-form">
              <p>{secretaryText('explain')}</p>
              <div className="form-actions">
                <Button onClick={() => setDialog('')}>{t('Cancelar')}</Button>
                <Button className="primary" disabled={busy} onClick={() => void execute('/actions/claim-secretary', {confirmed:true})}>{secretaryText('confirm')}</Button>
              </div>
            </div>
          ) : dialog === "close" ? (
            <div className="edit-form">
              <p>
                {t(
                  "A ata preservará as notas confirmadas, participantes, agenda e ações. Itens pulados continuarão pendentes.",
                )}
              </p>
              <p>
                {pending
                  ? t("Aguarde a confirmação das notas antes de encerrar.")
                  : t("Todas as notas enviadas foram confirmadas.")}
              </p>
              <div className="form-actions">
                <Button onClick={() => setDialog("")}>{t("Cancelar")}</Button>
                <Button
                  className="primary"
                  disabled={busy || pending > 0}
                  onClick={() => void execute("/actions/close")}
                >
                  {t("Confirmar encerramento")}
                </Button>
              </div>
            </div>
          ) : dialog.startsWith('outcome') && detail && id ? (
            <MeetingOutcomeForm context={context} meetingId={id} circleId={detail.meeting.circleId} meetingVersion={detail.meeting.version} timeZone={detail.meeting.timeZone} agenda={dialog.includes(':')?detail.agenda.filter(a=>a.id===dialog.split(':')[1]):detail.agenda} agendaContext={dialog.includes(':')?{id:dialog.split(':')[1],announceAdapt:false}:undefined} onBusy={setBusy} onReload={()=>{setDialog('');reload();}} onCreated={()=>{setDialog('');reload();}} onProposal={(agendaId,type)=>{setDialog('');setProposalAgenda({meetingId:id,agendaId,type});}} />
          ) : dialog.startsWith("transfer:") ? (
            <form
              className="edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                const a = detail!.agenda.find(
                  (a) => a.id === dialog.split(":")[1],
                );
                const f = new FormData(e.currentTarget);
                void execute(
                  `/agenda/${a.id}/actions/transfer`,
                  { targetMeetingId: f.get("targetMeetingId") },
                  a.version,
                );
              }}
            >
              <Field
                label={t("ID da reunião de destino (agendada)")}
                name="targetMeetingId"
                required
              />
              <p className="muted">
                {t(
                  "Você precisa poder editar a reunião de destino. A origem ficará registrada.",
                )}
              </p>
              <div className="form-actions">
                <Button onClick={() => setDialog("")}>{t("Cancelar")}</Button>
                <button className="primary" disabled={busy}>
                  {t("Transferir")}
                </button>
              </div>
            </form>
          ) : (
            <form className="edit-form" onSubmit={submit}>
              {dialog === "create" && <MeetingScheduleFields context={context} templates={templates} circleId={circleFilter} />}
              {dialog === "instant" && (
                <>
                  <p className="muted">
                    {t("A reunião começa agora com as etapas padrão.")}
                  </p>
                  <Field label={t("Círculo")} name="circleId">
                    <select name="circleId" required defaultValue={circleFilter || ""}>
                      <option value="" disabled>
                        {t("Selecione um círculo")}
                      </option>
                      {context.structure.circles.map((circle) => (
                        <option key={circle.id} value={circle.id}>
                          {context.structure.nodes.find((node) => node.entityId === circle.id)?.name ?? t("Círculo")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t("Título")}
                    name="title"
                    value={t("Reunião instantânea")}
                    required
                    maxLength={200}
                  />
                  <Field
                    label={t("Duração (minutos)")}
                    name="durationMinutes"
                    type="number"
                    value="60"
                    required
                  />
                  <label>
                    <input type="checkbox" name="useRoster" defaultChecked />{" "}
                    {t("Incluir participantes do círculo")}
                  </label>
                  <label>
                    <input type="checkbox" name="includeSubcircles" />{" "}
                    {t("Incluir participantes dos subcírculos")}
                  </label>
                </>
              )}
              {([
                "template",
                "agenda",
                "action",
                "reschedule",
              ].includes(dialog) ||
                dialog.startsWith("template-edit:")) && (
                <Field
                  label={
                    dialog === "template" ? t("Nome do modelo") : t("Título")
                  }
                  name="title"
                  value={
                    dialog === "reschedule"
                      ? detail?.meeting.title
                      : (templates.find((t) => t.id === dialog.split(":")[1])
                          ?.name ?? "")
                  }
                  required
                  maxLength={200}
                />
              )}
              {dialog === "reschedule" && (
                <>
                  <div className="meetings-form-grid">
                    <Field
                      label={t("Data e hora local")}
                      name="localStart"
                      type="datetime-local"
                      value={
                        dialog === "reschedule"
                          ? detail?.meeting.localStart.slice(0, 16)
                          : ""
                      }
                      required
                    />
                    <Field
                      label={t("Fuso horário IANA")}
                      name="timeZone"
                      value={detail?.meeting.timeZone ?? prefs.timeZone}
                      required
                    />
                  </div>
                  <Field
                    label={t("Duração (minutos)")}
                    name="durationMinutes"
                    type="number"
                    value={String(detail?.meeting.durationMinutes ?? 60)}
                    required
                  />
                  {(
                    <Field label={t("Aplicar alteração")} name="scope">
                      <select name="scope">
                        <option value="THIS">{t("Somente esta")}</option>
                        {detail?.capabilities.manage && <option value="FUTURE">{t("Esta e futuras")}</option>}
                        {detail?.capabilities.manage && <option value="ALL">
                          {t("Todas as futuras não realizadas")}
                        </option>}
                      </select>
                    </Field>

                  )}
                </>
              )}
              {(["template"].includes(dialog) ||
                dialog.startsWith("template-edit:")) && (
                <Field label={t("Método")} name="method">
                  <select name="method">
                    <option value="CUSTOM">{t("Personalizado")}</option>
                    <option value="HOLACRACY">{context.bootstrap.governanceModel ? "O2" : t("Holacracia")}</option>
                  </select>
                </Field>
              )}
              {(dialog === "template" || dialog.startsWith("template-edit:")) && <MeetingStepsEditor key={dialog} sections={templates.find(template => template.id === dialog.split(":")[1])?.sections ?? initialSections} />}
              {[
                "agenda",
                "action",
                "notetaker",
                "participant",
                "report-access",
              ].includes(dialog) && (
                <Field
                  label={
                    dialog === "action" ? t("Responsável") : t("Participante")
                  }
                  name="memberId"
                >
                  <select
                    name="memberId"
                    defaultValue={context.bootstrap.membership.id}
                  >
                    {memberOptions}
                  </select>
                </Field>
              )}
              {dialog === "agenda" && <>
                <Field label={roomText(locale, 'optionalContext')} name="description">
                  <textarea name="description" rows={3} maxLength={20000}/>
                </Field>
                <Field
                  label={t("Duração (minutos)")}
                  name="durationMinutes"
                  type="number"
                  value="5"
                  required
                />
              </>}
              {dialog === "notetaker" && (
                <label>
                  <input
                    type="checkbox"
                    name="notesOnlyNoter"
                    defaultChecked={detail?.meeting.policy.notesOnlyNoter}
                  />{" "}
                  {t("Somente a secretaria pode editar notas")}
                </label>
              )}
              {dialog === 'facilitator' && <Field label={facilitatorText('name')} name="memberId"><select name="memberId" defaultValue={detail?.meeting.facilitatorId}>{detail?.participants.filter(p=>p.access==='EDIT').map(p=><option key={p.memberId} value={p.memberId}>{person(p.memberId)}</option>)}</select></Field>}
              {dialog === "participant" && (
                <>
                  <Field label={t("Aplicar aos participantes")} name="scope">
                    <select name="scope">
                      <option value="THIS">{t("Somente esta reunião")}</option>
                      <option value="FUTURE">
                        {t("Esta e futuras não realizadas")}
                      </option>
                      <option value="ALL">
                        {t("Todas as futuras não realizadas")}
                      </option>
                    </select>
                  </Field>
                  <Field label={t("Participação")} name="participationRole">
                    <select name="participationRole">
                      <option value="REQUIRED">{t("Obrigatória")}</option>
                      <option value="OPTIONAL">{t("Opcional")}</option>
                    </select>
                  </Field>
                  <Field label={t("Acesso explícito")} name="access">
                    <select name="access">
                      <option value="READ">{t("Leitura")}</option>
                      <option value="EDIT">{t("Edição")}</option>
                      <option value="DENY">{t("Negar acesso")}</option>
                      <option value="REMOVE">
                        {t("Retirar participação (sem negação explícita)")}
                      </option>
                    </select>
                  </Field>
                  {[
                    ["canManage", t("Gerenciar reunião")],
                    ["canPublish", t("Publicar ata")],
                    ["canRestore", t("Restaurar / reabrir ata")],
                  ].map(([name, label]) => (
                    <label key={name}>
                      <input type="checkbox" name={name} />
                      {label}
                    </label>
                  ))}
                </>
              )}
              {dialog === "restore" && (
                <Field label={t("Versão a restaurar")} name="restoreVersion">
                  <select name="restoreVersion">
                    {versions.map((v) => (
                      <option value={v.version} key={v.version}>
                        {t("v")}
                        {v.version} · {v.reason}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {dialog === "cancel" && (
                <Field label={t("Aplicar cancelamento")} name="scope">
                  <select name="scope">
                    <option value="THIS">{t("Somente esta")}</option>
                    {detail?.capabilities.manage && <option value="FUTURE">{t("Esta e futuras")}</option>}
                    {detail?.capabilities.manage && <option value="ALL">
                      {t("Todas as futuras não realizadas")}
                    </option>}
                  </select>
                </Field>
              )}
              {dialog === "delete" && (
                <>
                  <Field label={t("Aplicar exclusão")} name="scope">
                    <select name="scope">
                      <option value="THIS">{t("Somente esta")}</option>
                      <option value="FUTURE">{t("Esta e futuras")}</option>
                      <option value="ALL">
                        {t("Todas as futuras não realizadas")}
                      </option>
                    </select>
                  </Field>
                  <Notice>
                    {t(
                      "A exclusão é permanente: as reuniões agendadas selecionadas e seus preparativos são removidos sem registro no histórico.",
                    )}
                  </Notice>
                </>
              )}
              {dialog === "report-access" && (
                <>
                  <label>
                    <input type="checkbox" name="canRead" defaultChecked />{" "}
                    {t("Pode ler a ata")}
                  </label>
                  <label>
                    <input type="checkbox" name="canEdit" defaultChecked />{" "}
                    {t("Pode editar a ata")}
                  </label>
                  <p className="muted">
                    {t(
                      "A negação explícita prevalece sobre permissões da reunião, inclusive da administração. A leitura deve estar permitida para conceder edição.",
                    )}
                  </p>
                </>
              )}
              {["restore", "reopen", "cancel", "migrate"].includes(dialog) && (
                <>
                  <Field
                    label={t("Motivo")}
                    name="reason"
                    required
                    maxLength={1000}
                  />
                  {dialog === "reopen" && (
                    <Notice>
                      {t(
                        "A reabertura abre uma janela de edição ilimitada e mantém a data da primeira publicação.",
                      )}
                    </Notice>
                  )}
                  <p className="muted">
                    {dialog === "cancel"
                      ? t(
                          "As ocorrências canceladas permanecerão no histórico.",
                        )
                      : t(
                          "Uma nova versão e época de coedição serão criadas.",
                        )}{" "}
                    {t(
                      "Rascunhos offline da época anterior precisarão de recuperação explícita.",
                    )}
                  </p>
                </>
              )}
              {error && <Notice>{error}</Notice>}
              <div className="form-actions">
                <Button disabled={busy} onClick={() => setDialog("")}>
                  {t("Cancelar")}
                </Button>
                <button className="primary" disabled={busy}>
                  {busy ? t("Salvando…") : dialog === "instant" ? t("Iniciar agora") : dialog === "create" && locale === "pt-BR" ? "Agendar reunião" : dialog === "delete" ? t("Excluir") : t("Salvar")}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
      {proposalAgenda && proposalAgenda.meetingId===id && <MeetingProposalEditor c={context} placement={{
        ...proposalAgenda,
        onClose:()=>setProposalAgenda(null),
        onCreated:()=>{setProposalAgenda(null);reload();},
      }}/>}
    </div>
  );
}
function GuestReports({ context }: { context: FeatureContext }) {
  const { t, formatError } = useMeetingsLocalization();
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState("");
  const requestedReport = new URLSearchParams(context.path?.split('?')[1] ?? '').get('reportId');
  const visibleItems = requestedReport ? items.filter(item => item.report.id === requestedReport) : items;
  useEffect(() => {
    const c = new AbortController();
    void context
      .api<{ items: any[] }>(
        `/organizations/${context.organizationId}/meeting-reports`,
        { signal: c.signal },
      )
      .then((r) => setItems(r.data.items))
      .catch((e) => {
        if (!c.signal.aborted) setError(formatError(e));
      });
    return () => c.abort();
  }, [context.organizationId]);
  return (
    <div className="meetings-page">
      <header className="page-heading">
        <h1>{t("Atas compartilhadas")}</h1>
      </header>
      <Notice>
        {t(
          "Acesso somente às atas explicitamente compartilhadas. Somente leitura.",
        )}
      </Notice>
      {error && <Notice>{error}</Notice>}
      <div className="meetings-list">
        {visibleItems.length === 0 && !error && (
          <p>{t("Nenhuma ata compartilhada disponível.")}</p>
        )}
        {visibleItems.map((item) => (
          <article key={item.report.id}>
            <h2>{item.snapshot.meeting.title}</h2>
            {item.snapshot.documents.map((d: any) => (
              <section key={d.sectionId}>
                <h3>
                  {item.snapshot.meeting.sections.find(
                    (s: any) => s.id === d.sectionId,
                  )?.title ?? d.sectionId}
                </h3>
                {d.document ? (
                  <RichTextView
                    value={d.document}
                    emptyText={t("Sem conteúdo.")}
                  />
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{d.text}</p>
                )}
              </section>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}
function Meetings({ context }: { context: FeatureContext }) {
  const route = resolveMeetingRoute(context.path);
  if (route?.id && context.bootstrap.governanceModel && !new URLSearchParams(route.query).has('classic')) return <O2MeetingPanel key={`${context.organizationId}:${context.bootstrap.membership.id}:${context.bootstrap.authorizationRevision}:${route.id}`} context={context} meetingId={route.id}/>;
  let surface:ReactNode;
  if (route?.path === "/meetings/agenda-items") surface=<AgendaItemsView context={context} />;
  else if (route?.path === "/meetings/statistics") surface=<MeetingStatisticsView context={context} />;
  else if (route?.path === "/meetings/exports") surface=<MeetingExportsView context={context} />;
  else surface=context.bootstrap.membership.memberType === "GUEST" &&
    resolveMeetingRoute(context.path)?.path.endsWith("/reports") ? (
    <GuestReports context={context} />
  ) : (
    <MeetingSurface context={context} />
  );
  if(route?.id)return surface;
  return <div className="mare-meetings-module"><MeetingModuleNav context={context} path={route?.path??'/meetings'}/>{surface}</div>;
}
function MeetingModuleNav({context,path}:{context:FeatureContext;path:string}){
 const {t,locale}=useMeetingsLocalization(),guest=context.bootstrap.membership.memberType==='GUEST';
 const routes=[['/meetings','Reuniões'],['/meetings/reports','Atas'],...(!guest?[['/meetings/agenda-items','Itens da agenda'],['/meetings/templates','Modelos de reunião'],['/meetings/statistics','Estatísticas'],['/meetings/exports','Exportações']]:[])];
 return <nav className="mare-meetings-module-nav" aria-label={t('Reuniões')}>{routes.map(([target,label])=><button key={target} type="button" aria-current={path===target?'page':undefined} onClick={()=>context.navigate(target)}>{label === "Reuniões" ? meetingCopy(locale,"upcoming") : locale === "pt-BR" ? ({"Itens da agenda":"Pauta","Modelos de reunião":"Modelos"}[label] ?? label) : t(label)}</button>)}</nav>;
}
export const feature: FeatureDefinition = {
  ...meetingsMetadata,
  Component: Meetings,
  sidebar: Sidebar,
  HeaderActions: MeetingsHeaderActions,
};

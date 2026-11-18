import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, Clock, FileText, Maximize2, Minimize2, Users, X } from "lucide-react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Notice } from "../../ui";
import { MinutesSnapshot } from "./minutes-snapshot";
import { ReportPublicationStatus } from "./report-publication-status";
import { meetingCopy } from "./surface-copy";
import { useMeetingsLocalization } from "./use-localization";

const previewSplitBreakpoint = 1024;
const states: Record<string, string> = { SCHEDULED: "Agendada", RUNNING: "Em andamento", CLOSED: "Encerrada", CANCELLED: "Cancelada", OPEN: "Pendente", COMPLETED: "Concluído", TRANSFERRED: "Transferido", WITHDRAWN: "Retirado" };
export function MeetingPreview({ context, id, expanded, onExpand, onClose }: { context: FeatureContext; id: string; expanded: boolean; onExpand: () => void; onClose: () => void }) {
  const { t, locale, formatInstant, formatNumber, formatError } = useMeetingsLocalization();
  const [detail, setDetail] = useState<any>(null), [versions, setVersions] = useState<any[]>([]), [error, setError] = useState("");
  const [tab, setTab] = useState("agenda"), [narrow, setNarrow] = useState(() => window.innerWidth <= previewSplitBreakpoint);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef(document.activeElement as HTMLElement | null);
  const modal = narrow || expanded;
  useLayoutEffect(() => {
    if (!modal || !panel.current) return;
    const changed: HTMLElement[] = [];
    // Leave the preview's ancestors active and suspend every branch outside it.
    for (let branch: HTMLElement | null = panel.current; branch && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of branch.parentElement?.children ?? []) {
        if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.hasAttribute('inert')) continue;
        sibling.setAttribute('inert', '');
        changed.push(sibling);
      }
    }
    if (!panel.current.contains(document.activeElement)) {
      panel.current.focus({ preventScroll: true });
    }
    return () => changed.forEach(sibling => sibling.removeAttribute('inert'));
  }, [modal]);
  useEffect(() => { const resize = () => setNarrow(window.innerWidth <= previewSplitBreakpoint); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  useEffect(() => {
    const abort = new AbortController();
    panel.current?.focus(); setError(""); setDetail(null); setVersions([]);
    void context.api<any>(`/organizations/${context.organizationId}/meetings/${id}`, { signal: abort.signal }).then(async result => {
      if (abort.signal.aborted) return;
      setDetail(result.data); setTab(result.data.meeting.state === "CLOSED" && result.data.report ? "report" : "agenda");
      if (result.data.report) {
        const response = await context.api<{ items: any[] }>(`/organizations/${context.organizationId}/meetings/${id}/report/versions`, { signal: abort.signal });
        if (!abort.signal.aborted) setVersions(response.data.items);
      }
    }).catch(failure => { if (!abort.signal.aborted) setError(formatError(failure)); });
    return () => { abort.abort(); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); };
  }, [context.organizationId, context.bootstrap.membership.id, context.bootstrap.authorizationRevision, id]);
  const meeting = detail?.meeting, people = (detail?.participants ?? []).filter((person: any) => person.access !== "DENY");
  const snapshot = versions.find(version => version.version === detail?.report?.version)?.snapshot;
  const personName = (memberId: string) => context.members.find(member => member.id === memberId)?.displayName ?? t("Participante");
  return <aside ref={panel} tabIndex={-1} role={modal ? "dialog" : "complementary"} aria-modal={modal || undefined} aria-label={meeting?.title ?? t("Reuniões")} className={"mare-meeting-preview" + (expanded ? " is-expanded" : "")} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "Tab" && modal) {
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><div className="mare-meeting-preview-tools"><span>{context.structure.nodes.find(node => node.entityId === meeting?.circleId)?.name ?? t("Círculo")}</span>{!narrow && <button type="button" onClick={onExpand} aria-label={meetingCopy(locale,expanded ? "reduce" : "expand")}>{expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}<button type="button" onClick={onClose} aria-label={meetingCopy(locale,"close")}><X size={19} /></button></div>
      {meeting && <><h2>{meeting.title}</h2><span className={"mare-meeting-status " + meeting.state.toLowerCase()}>{t(states[meeting.state] ?? meeting.state)}</span><div className="mare-meeting-preview-facts"><p><CalendarDays size={17} />{formatInstant(meeting.startAt)}</p><p><Clock size={17} />{formatNumber(meeting.durationMinutes)} {t("min")}<span>· {meeting.timeZone}</span></p></div>
        <Button className="primary" onClick={() => context.navigate("/meetings/" + id)}>{locale === "pt-BR" ? (meeting.state === "SCHEDULED" ? "Preparar encontro" : meeting.state === "RUNNING" ? "Continuar reunião" : "Ver ata") : meetingCopy(locale,"open")}</Button>
        <nav className="mare-meeting-preview-tabs" aria-label={t("Reuniões")}>{[["agenda", locale === "pt-BR" ? "Pauta" : t("Agenda")], ["people", t("Participantes")], ...(detail.report ? [["report", t("Ata")]] : [])].map(([value, label]) => <button key={value} type="button" aria-current={tab === value ? "page" : undefined} onClick={() => setTab(value)}>{label}{value === "agenda" && <small>{detail.agenda.length}</small>}{value === "people" && <small>{people.length}</small>}</button>)}</nav></>}
    </header>
    <div className="mare-meeting-preview-body">{error && <Notice>{error}</Notice>}{!detail ? !error && <p role="status">{t("Carregando reuniões…")}</p> : tab === "agenda" ? <>
      <div className="mare-meeting-preview-section-heading"><h3>{t("Agenda")}</h3><span>{t(states[meeting.state] ?? meeting.state)}</span></div>
      {detail.agenda.length ? detail.agenda.map((item: any, index: number) => <article key={item.id}><span className="mare-meeting-agenda-index">{formatNumber(index + 1)}</span><div><strong>{item.title}</strong><small>{personName(item.presenterId)}</small></div><small>{t(states[item.status] ?? item.status)}</small></article>) : <div className="mare-meeting-preview-empty"><FileText size={26} /><p>{t("Nenhum item na agenda.")}</p></div>}
      <section className="mare-meeting-preview-flow"><h3>{t("Etapas da reunião")}</h3><div>{meeting.sections.map((section: any) => <span key={section.id}>{section.title}</span>)}</div></section>
    </> : tab === "people" ? <>{people.map((person: any) => <article key={person.memberId}><span className="mare-meeting-avatar">{personName(person.memberId).split(" ").slice(0, 2).map(name => name[0]).join("")}</span><div><strong>{personName(person.memberId)}</strong><small>{person.access === "EDIT" ? t("Edição") : t("Leitura")}{person.memberId === meeting.notetakerId ? " · " + t("Secretaria") : ""}</small></div><small>{t(person.attendance === "PRESENT" ? "Presente" : person.attendance === "ABSENT" ? "Ausente" : "Convidado")}</small></article>)}{!people.length && <p className="muted">{t("Nenhuma presença confirmada")}</p>}</> : <><ReportPublicationStatus report={detail.report} versions={versions} />{snapshot ? <MinutesSnapshot snapshot={snapshot} context={context} /> : !error && <p role="status">{t("Carregando…")}</p>}</>}</div>
  </aside>;
}

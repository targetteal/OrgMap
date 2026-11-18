import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  MoreHorizontal,
  Plus,
  FileText,
  Users,
  ChevronDown,
  CalendarDays,
  Clock,
  Play,
  CheckCircle2,
  Check,
  Folder,
  ListTodo,
  Target,
  ChevronRight,
} from "lucide-react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Dialog, Field, Notice } from "../../ui";
import { RichTextView } from "../../editor";
import { MeetingOutcomeForm } from "./outcome-form";
import { MeetingProposalEditor, MeetingProposalRevision, type MeetingProposalType } from "../governance";
import { traceRoute, TraceReturnLink } from "../../traceability";
import { MeetingReviewItem } from "./review-item";
import { StructureIcon } from "../../StructureIcon";
import { MeetingStepsEditor } from "./meeting-steps-editor";
import { MinutesSnapshot } from "./minutes-snapshot";
import { ProposalOutcomeDiff } from "./proposal-diff";
import { useMeetingsLocalization } from "./use-localization";
import { ReportPublicationStatus } from "./report-publication-status";
import { meetingDecisionState } from "./decision-state";
import "./o2-panel.css";
const labels: Record<string, string> = {
  PRESENT: "Apresentar proposta",
  REACT: "Reações",
  ADJUST: "Ajustar se necessário",
  OBJECT: "Objeções",
  INTEGRATE: "Testar e integrar",
  APPROVED: "Proposta aprovada",
};
const outcomeKinds = {
  PROJECT: { label: 'Projeto', Icon: Folder },
  TASK: { label: 'Tarefa', Icon: ListTodo },
  GOAL: { label: 'Objetivo', Icon: Target },
};
export function IntegrativeDiagram({ stage, history = false }: { stage: string; history?: boolean }) {
  if (!labels[stage]) return null;
  return (
    <div
      className="o2-diagram"
      role="img"
      tabIndex={0}
      aria-label={
        (history ? "Histórico do processo de decisão integrativa. Última etapa: " : "Processo de decisão integrativa. Etapa atual: ") + labels[stage]
      }
    >
      <svg viewBox="0 0 1060 245" aria-hidden="true">
        <defs>
          <marker
            id="o2-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {[150, 330, 525, 735].map((x, i) => (
          <path
            key={x}
            d={`M${x} 62 H${[190, 370, 580, 880][i]}`}
            markerEnd="url(#o2-arrow)"
          />
        ))}
        <path d="M635 105 V172" markerEnd="url(#o2-arrow)" />
        <path d="M700 172 Q714 140 706 105" markerEnd="url(#o2-arrow)" />
        <text x="802" y="23" textAnchor="middle">
          Sem objeções
        </text>
        <text x="802" y="42" textAnchor="middle">
          pendentes
        </text>
        <text x="620" y="147" textAnchor="end">
          Com objeções
        </text>
        <path d="M960 105 V140" strokeDasharray="6 5" />
        <text x="960" y="160" textAnchor="middle">
          Efetivação na estrutura
        </text>
        <text x="960" y="179" textAnchor="middle">
          pelo escriba
        </text>
        {(
          [
            ["PRESENT", 0, 150, 25, 74],
            ["REACT", 190, 140, 25, 74],
            ["ADJUST", 370, 155, 25, 74],
            ["OBJECT", 580, 155, 25, 74],
            ["APPROVED", 880, 175, 25, 74],
            ["INTEGRATE", 570, 175, 178, 58],
          ] as const
        ).map(([s, x, w, y, h]) => (
          <g key={s} className={s === stage ? "current" : ""}>
            <rect x={x + 2} y={y} width={w - 4} height={h} rx="8" />
            <text x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle">
              {["PRESENT", "ADJUST", "APPROVED"].includes(s) ? (
                <>
                  <tspan x={x + w / 2} dy="-8">
                    {s === "PRESENT"
                      ? "Apresentar"
                      : s === "ADJUST"
                        ? "Ajustar se"
                        : "Proposta"}
                  </tspan>
                  <tspan x={x + w / 2} dy="22">
                    {s === "PRESENT"
                      ? "proposta"
                      : s === "ADJUST"
                        ? "necessário"
                        : "aprovada"}
                  </tspan>
                </>
              ) : (
                labels[s]
              )}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
export function O2MeetingPanel({
  context,
  meetingId,
}: {
  context: FeatureContext;
  meetingId: string;
}) {
  const { formatInstant, formatNumber } = useMeetingsLocalization();
  const base = `/organizations/${context.organizationId}`,
    url = base + "/meetings/" + meetingId;
  const [detail, setDetail] = useState<any>(),
    [panel, setPanel] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState(""),
    [mode, setMode] = useState("SYNC"),
    [notes, setNotes] = useState<string | null>(null),
    [drafts, setDrafts] = useState<any[]>([]),
    [preparedId, setPreparedId] = useState<string | null>(null);
  const [governanceDialog, setGovernanceDialog] = useState<
    {kind:'create'; agendaId:string; type?:MeetingProposalType} | {kind:'edit'; proposalId:string} | null
  >(null);
  const self = context.bootstrap.membership.id;
  const [confirmation,setConfirmation]=useState<{id:string;revision:number;version:number;meetingVersion:number}>();
  const [publishedRestrictions,setPublishedRestrictions]=useState<{key:string;items:{id:string;title:string}[]}|null>(null);
  async function openDrafts() {
    setError("");
    try {
      const r = await context.api<any>(base + "/proposals?limit=100");
      setDrafts(
        r.data.items.filter(
          (p: any) =>
            p.circleId === detail.meeting.circleId &&
            p.authorId === self &&
            p.state === "DRAFT",
        ),
      );
      setDialog("attach");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function load(signal?: AbortSignal) {
    const [d, p] = await Promise.all([context.api<any>(url, { signal }), context.api<any>(url + "/panel", { signal })]);
    if (signal?.aborted) return;
    setDetail(d.data);
    setPanel(p.data);
  }
  function refreshGovernance() {
    void load().catch(e => setError(e.message));
  }
  useEffect(() => {
    const abort = new AbortController();
    setDetail(undefined); setPanel(undefined); setNotes(null); setPreparedId(null); setDialog(""); setError("");
    const refresh = () => {
      if (!abort.signal.aborted) void load(abort.signal).catch((e) => { if (!abort.signal.aborted) setError(e.message); });
    };
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [meetingId, context.organizationId, context.bootstrap.membership.id, context.bootstrap.authorizationRevision]);
  const selected = detail?.agenda.find(
      (a: any) => a.id === (detail?.meeting.state === "SCHEDULED" ? preparedId ?? panel?.panel.focusId ?? detail?.agenda[0]?.id : panel?.panel.focusId),
    ),
    proposal = panel?.proposals.find((p: any) => p.agendaId === selected?.id);
  const decisionPayload = proposal?.proposal?.payload;
  const documentReferences: {documentId:string;documentVersion:number}[] = meetingDecisionState(proposal?.proposal, '') === 'applied'
    ? (decisionPayload?.documents ?? (decisionPayload?.documentId ? [decisionPayload] : [])).filter((part:any) =>
      part.documentAction !== 'ARCHIVE' && typeof part.documentId === 'string' && Number.isSafeInteger(part.documentVersion)) : [];
  const documentKey = JSON.stringify([context.organizationId, context.session.account.id, self, context.bootstrap.authorizationRevision, documentReferences, proposal?.proposal?.revision]);
  useEffect(() => {
    const abort = new AbortController();
    setPublishedRestrictions(null);
    void Promise.all(documentReferences.map(async part => {
      try {
        const {data} = await context.api<any>(base + '/documents/' + encodeURIComponent(part.documentId), {signal:abort.signal});
        const document = data.document;
        return document?.id === part.documentId && !document.archived && Number.isSafeInteger(document.publishedVersion) && document.publishedVersion >= part.documentVersion
          ? {id:document.id,title:document.title} : null;
      } catch { return null; } // An unavailable document never yields a link.
    })).then(items => {
      if (!abort.signal.aborted) setPublishedRestrictions({key:documentKey,items:items.filter((item):item is {id:string;title:string} => item !== null)});
    });
    return () => abort.abort();
  }, [documentKey, base, context.api]);
  async function command(action: string, body: any = {}) {
    setBusy(true);
    setError("");
    try {
      await context.api(url + "/panel/actions/" + action, {
        method: "POST",
        version: detail.meeting.version,
        body,
      });
      await load();
      setDialog("");
      return true;
    } catch (e: any) {
      setError(
        e.code === "VERSION_CONFLICT"
          ? "A reunião mudou. Recarregue o estado e tente novamente."
          : e.message,
      );
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!detail || !panel)
    return <p role="status">{error || "Carregando reunião…"}</p>;
  const m = detail.meeting,
    p = proposal?.proposal,
    proc = panel.processes.find((f: any) => f.proposalId === p?.id),
    stage = p && proc && proc.revision === p.revision ? proc.stage : "",
    invalidProcess =
      !!p && !!proc && proc.revision === p.revision && !labels[proc.stage],
    treatment = panel.treatments.find((t: any) => t.agendaId === selected?.id),
    present = (
      panel.minutes?.participants ??
      panel.attendees ??
      detail.participants
    ).filter((p: any) => p.access !== "DENY" && p.attendance === "PRESENT"),
    running = m.state === "RUNNING",
    canContribute = running && panel.member && panel.present,
    scribe = self === m.notetakerId && canContribute;
  const canDeclarePresence = detail.accessMode !== "SUPERVISED_READ" && context.bootstrap.membership.memberType !== "GUEST" && detail.participants.some((participant: any) => participant.memberId === self && participant.access !== "DENY");
  const person = (id: string) =>
    context.members.find((p) => p.id === id)?.displayName ?? "Participante";
  const currentSection = m.sections.find((section: any) => section.id === m.currentStep);
  const nextSection = m.sections[m.sections.findIndex((section: any) => section.id === m.currentStep) + 1];
  const closed = m.state === "CLOSED";
  const decisionState = meetingDecisionState(p, stage);
  const applied = decisionState === 'applied';
  const applicationConflict = decisionState === 'conflict';
  const approved = decisionState === 'awaiting-scribe' || decisionState === 'awaiting-application';
  const visibleRestrictions = applied && publishedRestrictions?.key === documentKey ? publishedRestrictions.items : [];
  const outcomes = (detail.actions ?? []).flatMap((action: {id:string;agendaId?:string;targetId?:string;targetKind:keyof typeof outcomeKinds;title:string}) => {
    if (action.agendaId !== selected?.id || !action.targetId || !Object.hasOwn(outcomeKinds, action.targetKind)) return [];
    const route = traceRoute({ kind:action.targetKind, id:action.targetId, title:action.title }, `/meetings/${meetingId}?step=agenda`);
    return route ? [{ ...action, route, ...outcomeKinds[action.targetKind] }] : [];
  }) as {id:string;route:string;title:string;label:string;Icon:typeof Folder}[];
  const canCompleteTension = selected?.status === 'OPEN' && panel.canConduct && running && (!p || p.verdict !== 'ADOPT' || applied);
  const canRegisterOutcome = canContribute && selected?.status === 'OPEN' && (!p || p.state === 'WITHDRAWN' || detail.capabilities.edit);
  const canBringDraft = panel.member && (canContribute || m.state === 'SCHEDULED') && selected && (!p || p.state === 'WITHDRAWN');
  const confirmingProposal = dialog==='approve' || dialog==='consent';
  const confirmationCurrent = !!confirmation && confirmation.id===p?.id && confirmation.revision===p.revision &&
    confirmation.version===p.version && confirmation.meetingVersion===m.version && p.state==='DRAFT' && p.applyState==='PENDING' &&
    (dialog==='consent' ? scribe && stage==='APPROVED' : panel.canConduct && stage==='OBJECT');
  function confirmProposal(action:'approve'|'consent') {
    setConfirmation({id:p.id,revision:p.revision,version:p.version,meetingVersion:m.version});
    setDialog(action);
  }
  const circleName = context.structure?.nodes.find(node => node.entityId === m.circleId)?.name ?? "Círculo";
  const stepNav = !closed && m.state !== "CANCELLED" && <nav className="o2-steps" aria-label="Passos da reunião">
    {m.sections.map((section: any, index: number) => <button key={section.id} disabled={!panel.canConduct || busy || !running} aria-current={m.currentStep === section.id ? "step" : undefined} className={m.currentStep === section.id ? "current" : ""} onClick={() => void command("step", { sectionId: section.id })}><span className="o2-step-number">{index + 1}</span>{section.title}</button>)}
  </nav>;
  const process = (action: string, extra: any = {}) =>
    command("process", {
      action,
      proposalId: p.id,
      revision: p.revision,
      ...extra,
    });
  async function startMeeting() {
    setBusy(true); setError("");
    try {
      await context.api(url + "/actions/start", { method: "POST", version: m.version, body: {} });
      await load();
    } catch (failure: any) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function consent() {
    if (!confirmation || !confirmationCurrent) return;
    setBusy(true);
    setError("");
    try {
      await context.api(
        base + "/proposals/" + confirmation.id + "/actions/meeting-consent",
        {
          method: "POST",
          version: confirmation.version,
          body: {
            meetingVersion: confirmation.meetingVersion,
            revision: confirmation.revision,
            confirmed: true,
            reason:
              "Consentimento registrado na reunião; nenhuma objeção válida pendente.",
          },
        },
      );
      await load();
      setDialog("");
    } catch (e: any) {
      setError(e.message);
      try { await load(); } catch { /* Preserve the original failure. */ }
    } finally {
      setBusy(false);
    }
  }
  async function publishReport() {
    if (!closed || detail.report?.state !== 'DRAFT' || !detail.capabilities.publish || busy) return;
    setBusy(true); setError("");
    try {
      await context.api(url + '/report/actions/publish', {method:'POST',version:detail.report.version,body:{}});
      await load();
    } catch (failure:any) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return (
    <div className={"o2-panel o2-room" + (closed || m.state === "CANCELLED" ? " o2-room-record" : "")}>
      <header className="o2-room-header">
        <button type="button" className="o2-back" onClick={() => context.navigate("/meetings")}><ArrowLeft size={15} />Reuniões</button>
        <TraceReturnLink context={context} returnTo={new URLSearchParams(context.path.split("?")[1] ?? "").get("returnTo")} disabled={busy}/>
        <div className="o2-room-heading"><div><span className="o2-circle-name"><StructureIcon size={16} />{circleName}</span><h1>{m.title}</h1></div>
          <div className="o2-room-actions"><span className="o2-status">{running ? "Em andamento" : closed ? "Encerrada" : m.state === "CANCELLED" ? "Cancelada" : "Agendada"}</span>
          {closed && detail.report && <ReportPublicationStatus report={detail.report} versions={[]} showVersions={false}/>}
          {closed && detail.report?.state === 'DRAFT' && detail.capabilities.publish && <Button className="primary" disabled={busy} onClick={() => void publishReport()}>Publicar ata</Button>}
          <Button ariaLabel="Pessoas e funções do encontro" title="Pessoas e funções do encontro" onClick={() => setDialog("people")}><Users size={18} /></Button>
          {running && detail.capabilities.secretaryOperation && <Button onClick={() => setDialog("close")}>Encerrar<ArrowRight size={16} /></Button>}
          {m.state !== "CANCELLED" && (
            <details className="o2-controls">
              <summary aria-label="Mais opções do encontro" title="Mais opções do encontro"><MoreHorizontal size={19} /></summary>
              <div className="o2-tools">
                {(panel.member || detail.capabilities.manage) && m.state !== "CLOSED" && (
                  <Button onClick={() => setDialog("invite")}>
                    Convidar membro
                  </Button>
                )}
                {panel.canConduct && running && (
                  <Button onClick={() => setDialog("sections")}>
                    Ajustar roteiro
                  </Button>
                )}
                {panel.canConfigure && !closed && (
                  <Button onClick={() => setDialog("template")}>
                    Configurar próximos encontros
                  </Button>
                )}
                {m.state === "SCHEDULED" && detail.capabilities.secretaryOperation && (
                  <Button onClick={() => setDialog("cancel")}>Cancelar reunião</Button>
                )}
                {m.state === "SCHEDULED" && detail.capabilities.manage && (
                  <Button onClick={() => setDialog("delete")}>Excluir reunião</Button>
                )}
                <Button onClick={() => context.navigate("/meetings/" + meetingId + "?classic=1")}>Configurações e histórico</Button>
              </div>
            </details>
          )}

          </div>
        </div>
        {stepNav}
      </header>
      {!closed && m.state !== "CANCELLED" && <aside className="o2-queue">
        <div className="o2-queue-heading"><h2>Pauta <small>{detail.agenda.length}</small></h2>{canContribute && <Button ariaLabel="Adicionar assunto à reunião" title="Adicionar assunto à reunião" onClick={() => {setMode("SYNC");setDialog("tension");}}><Plus size={18}/></Button>}</div>
        <div className="o2-queue-items">{detail.agenda.map((a: any, index: number) => <button className={"o2-tension " + (selected?.id === a.id ? "selected" : "")} key={a.id} aria-current={selected?.id === a.id ? "true" : undefined} disabled={busy || (m.state !== "SCHEDULED" && (!panel.canConduct || !running))} onClick={() => m.state === "SCHEDULED" ? setPreparedId(a.id) : void command("focus", { agendaId: a.id })}>
          <span className="o2-agenda-number">{index + 1}</span><span>{a.title}<small>{person(a.presenterId)} · {panel.treatments.find((t: any) => t.agendaId === a.id)?.mode === "ADAPT" ? "Adaptar" : "Sincronizar"}{a.status === "COMPLETED" ? " · Concluída" : ""}</small></span>
        </button>)}</div>
        {!detail.agenda.length && <p className="muted">Nenhum assunto na pauta.</p>}
        <div className="o2-room-presence"><button type="button" onClick={() => setDialog("people")}><span>Presentes ({present.length})</span><div className="o2-presence-avatars">{present.slice(0, 5).map((participant: any) => <span className="o2-avatar" key={participant.memberId} title={person(participant.memberId)}>{person(participant.memberId).split(" ").slice(0, 2).map((part: string) => part[0]).join("")}</span>)}</div></button>
          {running && canDeclarePresence && <Button disabled={busy} onClick={() => void command("presence", {attendance: panel.present ? "ABSENT" : "PRESENT"})}>{panel.present ? <CheckCircle2 size={15} /> : <Plus size={15} />}{panel.present ? "Minha presença confirmada" : "Estou presente"}</Button>}
        </div>
      </aside>}
      <section className="o2-main">
        {error && <Notice>{error}</Notice>}
        {invalidProcess && (
          <Notice>
            Estado do processo indisponível. Recarregue a reunião antes de
            continuar.
          </Notice>
        )}
        {m.state === "SCHEDULED" && <section className="o2-ready">
          <span className="o2-ready-icon"><Users size={28} /></span>
          <h2>Vamos preparar o encontro?</h2>
          <p>A pauta está disponível para o círculo. Ao iniciar, os passos de condução ficam ativos.</p>
          <div className="o2-ready-facts"><span><CalendarDays size={17} />{m.startAt ? formatInstant(m.startAt) : ""}</span><span><Clock size={17} />{formatNumber(m.durationMinutes ?? 60)} minutos</span></div>
          {(detail.capabilities.secretaryOperation || detail.capabilities.manage) && <Button className="primary" disabled={busy} onClick={() => void startMeeting()}><Play size={16} />{busy ? "Iniciando reunião…" : "Iniciar reunião"}</Button>}
          {detail.capabilities.secretaryOperation && <Button disabled={busy} onClick={() => setDialog("cancel")}>Cancelar reunião</Button>}
          {detail.capabilities.manage && <Button disabled={busy} onClick={() => setDialog("delete")}>Excluir reunião</Button>}

        </section>}
        {m.state !== "CLOSED" &&
          (m.sections.find((s: any) => s.id === m.currentStep)?.kind !==
            "AGENDA" && running ? (
            <section className="o2-focus">
              <h2>
                {m.sections.find((s: any) => s.id === m.currentStep)?.title}
              </h2>
              <p>{m.sections.find((s: any) => s.id === m.currentStep)?.kind === "CHECKIN" ? "Como você chega hoje? Uma rodada breve para chegar, escutar e estar presente." : m.sections.find((s: any) => s.id === m.currentStep)?.kind === "CHECKOUT" ? "Como você sai deste encontro? Compartilhe o que ficou e o que pode melhorar." : "Compartilhe atualizações e identifique tensões. O roteiro pode ser ajustado conforme a necessidade do círculo."}</p>
              {["CHECKIN", "CHECKOUT"].includes(currentSection?.kind) && <div className="o2-round-people">{present.map((participant: any) => <div key={participant.memberId}><span className="o2-avatar">{person(participant.memberId).split(" ").slice(0, 2).map((part: string) => part[0]).join("")}</span><span>{person(participant.memberId)}</span></div>)}<small>A rodada acontece em conversa. Não é preciso registrar uma resposta de cada pessoa.</small></div>}
              {panel.canConduct && (nextSection || detail.capabilities.secretaryOperation) && <Button className="primary o2-next-step" disabled={busy} onClick={() => nextSection ? void command("step", {sectionId: nextSection.id}) : setDialog("close")}>{nextSection ? `Ir para ${nextSection.title}` : "Concluir encontro"}<ArrowRight size={16}/></Button>}
              {(currentSection?.kind === "PROJECTS" || currentSection?.id === "review") && (
                <>
                  <h3>Recursos para Revisar</h3>
                  {panel.review.map((r: any) => (
                    <MeetingReviewItem
                      key={r.id}
                      context={context}
                      item={r}
                      meetingId={meetingId}
                    />
                  ))}
                  {m.circleId && (
                    <Button
                      onClick={() =>
                        context.navigate(
                          "/projects?circleId=" +
                            encodeURIComponent(m.circleId) +
                            "&returnTo=" +
                            encodeURIComponent("/meetings/" + meetingId),
                        )
                      }
                    >
                      Ver projetos do círculo<ArrowRight size={16} />
                    </Button>
                  )}
                </>
              )}
            </section>
          ) : (
            <>
              <section className="o2-focus" aria-labelledby="o2-tension-title">
                <header className="o2-tension-heading">
                  <div>
                    <h2 id="o2-tension-title">{selected?.title ?? "Escolha uma tensão da fila"}</h2>
                    {selected && <span className="o2-badge">{treatment?.mode === "ADAPT" ? "Adaptar" : "Sincronizar"}</span>}
                  </div>
                  {canCompleteTension && <Button className="o2-complete-tension" disabled={busy} onClick={() => void command('complete', {agendaId:selected.id})}>
                    <Check size={16} aria-hidden="true" /><span>Concluir tensão</span>
                  </Button>}
                </header>
                {treatment?.description && <p>{treatment.description}</p>}
                {selected && <section className="o2-outcomes" aria-labelledby="o2-outcomes-title">
                  <div className="o2-outcomes-heading">
                    <h3 id="o2-outcomes-title">Encaminhamentos</h3>
                    {canRegisterOutcome && <Button className={p ? '' : 'primary'} disabled={busy} onClick={() => setDialog('outcome')}>
                      <Plus size={16} aria-hidden="true" /><span>Registrar encaminhamento</span>
                    </Button>}
                  </div>
                  {outcomes.length ? <ul>{outcomes.map(({ id,route,title,label,Icon }) => <li key={id}>
                    <a href={route} onClick={event => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      context.navigate(route);
                    }}>
                      <span className="o2-outcome-icon"><Icon size={18} aria-hidden="true" /></span>
                      <span className="o2-outcome-text"><small>{label}</small><strong>{title}</strong></span>
                      <ChevronRight className="o2-outcome-arrow" size={16} aria-hidden="true" />
                    </a>
                  </li>)}</ul> : <p className="o2-outcomes-empty">Ainda não há encaminhamentos para esta tensão.</p>}
                </section>}
                {(p || canBringDraft) && <section className="o2-governance" aria-labelledby="o2-governance-title">
                  <div className="o2-governance-heading">
                    <h3 id="o2-governance-title">Proposta de governança</h3>
                    {canBringDraft && <Button onClick={() => void openDrafts()}>Trazer rascunho preparado</Button>}
                    {p && context.bootstrap.membership.memberType !== 'GUEST' && (p.authorId===self || (scribe && p.state==='DRAFT')) && p.applyState!=='APPLIED' && p.state!=='WITHDRAWN' &&
                      <Button onClick={() => setGovernanceDialog({kind:'edit',proposalId:p.id})}>Editar proposta</Button>}
                  </div>
                  {p && <><div className="o2-governance-proposal"><h4>{p.title}</h4>{p.kind === 'DOCUMENT' && <span className="o2-badge">Restrição</span>}</div><ProposalReading context={context} data={proposal} onDone={refreshGovernance} /></>}
                {p && (applied || applicationConflict || approved || !stage || p.state !== "DRAFT") && (
                  <div className="o2-governance-footer">
                    <p className="o2-application">
                      {applied
                        ? visibleRestrictions.length ? visibleRestrictions.length === 1 ? "Efetivada · restrição publicada" : "Efetivada · restrições publicadas" : "Alteração efetivada"
                        : applicationConflict
                          ? "Não foi possível efetivar · revise a proposta"
                          : approved
                            ? decisionState === 'awaiting-scribe' ? "Aprovada · aguardando efetivação pelo escriba" : "Aprovada · efetivação pendente"
                            : p.state === 'WITHDRAWN' ? 'Proposta descartada'
                              : p.verdict === 'REJECT' ? 'Proposta rejeitada'
                                : p.state === 'DRAFT' ? 'Proposta em preparação' : 'Proposta em tratamento'}
                    </p>
                    {running && p.state === 'DRAFT' && p.applyState === 'PENDING' && !labels[stage] && !invalidProcess && panel.canConduct &&
                      <Button className="primary" disabled={busy} onClick={() => void process('start')}>Apresentar proposta</Button>}
                  </div>
                )}
                {visibleRestrictions.map(restriction => <Button key={restriction.id} onClick={() => context.navigate('/structure/working-agreements/' + encodeURIComponent(restriction.id))}>Ver restrição publicada{visibleRestrictions.length > 1 ? ': ' + restriction.title : ''} <ArrowRight size={15}/></Button>)}
                {applicationConflict && panel.canConduct && context.bootstrap.membership.memberType !== 'GUEST' &&
                  <Button onClick={() => { const destination=traceRoute({kind:'PROPOSAL',id:p.id,title:p.title},'/meetings/'+meetingId+'?step=agenda'); if(destination)context.navigate(destination); }}>Abrir proposta para revisão <ArrowRight size={15}/></Button>}
                </section>}
              </section>
              {running &&
                p &&
                !!labels[stage] && (
                  <section className="o2-process">
                    {applied || applicationConflict ? <details><summary>Histórico do processo de decisão</summary><IntegrativeDiagram stage={stage} history /></details> : <><h3>Processo de decisão integrativa</h3>
                    <p className="o2-diagram-caption" aria-hidden="true">Etapa atual <strong>{labels[stage]}</strong></p>
                    <IntegrativeDiagram stage={stage} /></>}
                    {!applied && !applicationConflict && <div className="o2-next">
                      <div>
                        <h3>{approved ? 'Aprovada · aguardando efetivação' : labels[stage]}</h3>
                        <p>
                          <Users size={21} /> {decisionState === 'awaiting-scribe' ? 'Efetivação pelo escriba' : approved ? 'Efetivação pendente' : 'Etapa compartilhada'}
                        </p>
                        {!approved && panel.canConduct && p.state === 'DRAFT' && <small>Escriba e facilitador podem avançar</small>}
                      </div>
                      {panel.canConduct && p.state === "DRAFT" && p.applyState === "PENDING" && (
                        <div className="o2-process-actions">
                          {!stage ? (
                            <Button
                              className="primary"
                              disabled={busy}
                              onClick={() => void process("start")}
                            >
                              Apresentar proposta
                            </Button>
                          ) : stage === "APPROVED" ? (
                            scribe && (
                              <Button
                                className="primary"
                                onClick={() => confirmProposal('consent')}
                              >
                                Registrar consentimento e efetivar
                              </Button>
                            )
                          ) : (
                            <>
                              <Button
                                className="primary"
                                disabled={busy}
                                onClick={() =>
                                  stage === "OBJECT"
                                    ? confirmProposal('approve')
                                    : void process("advance")
                                }
                              >
                                Avançar etapa <ArrowRight size={18} />
                              </Button>
                              {stage === "OBJECT" && (
                                <>
                                  <Button
                                    onClick={() => setDialog("objection")}
                                  >
                                    Registrar objeção
                                  </Button>
                                  <Button
                                    onClick={() => void process("integrate")}
                                  >
                                    Testar e integrar
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>}
                    {proc?.objections.map((o: any) => (
                      <div className="o2-objection" key={o.id}>
                        <p>
                          {o.reason} · {o.resolved ? "Tratada" : "Pendente"}
                        </p>
                        {stage === "INTEGRATE" &&
                          panel.canConduct &&
                          !o.resolved && (
                            <Button
                              onClick={() => setDialog("resolve:" + o.id)}
                            >
                              Registrar integração / teste
                            </Button>
                          )}
                      </div>
                    ))}
                  </section>
                )}
            </>
          ))}
        {running && <details className="o2-notes">
          <summary>
            <FileText size={20} />
            Notas do escriba
            <ChevronDown size={18} />
          </summary>
          {detail.capabilities.secretaryOperation && panel.present ? (
            <>
              <textarea
                aria-label="Notas do escriba"
                value={notes ?? panel.panel.notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button
                disabled={busy || notes === null}
                onClick={() => {
                  void command("notes", { notes }).then((saved) => {
                    if (saved) setNotes(null);
                  });
                }}
              >
                Salvar notas
              </Button>
            </>
          ) : (
            <p>
              {(panel.minutes?.o2?.panels[0]?.notes ?? panel.panel.notes) ||
                "Nenhuma nota registrada."}
            </p>
          )}
        </details>}
        {m.state === "CLOSED" && (
          <section>
            <h2>Ata</h2>
            <MinutesSnapshot snapshot={panel.minutes} context={context} />
            {detail.report && <p className="muted">A leitura respeita as permissões da reunião e da ata.</p>}
            <Button
              onClick={() =>
                context.navigate("/meetings/" + meetingId + "?classic=1")
              }
            >
              Consultar histórico e versões da ata
            </Button>
          </section>
        )}
      </section>
      {dialog && (
        <Dialog
          title={
            dialog === "people"
              ? "Pessoas e funções"
              : dialog === "sections" ? "Roteiro deste encontro"
              : dialog === "template" ? "Próximos encontros"
              : dialog === "attach" ? "Trazer rascunho preparado"
              : dialog === "tension"
              ? "Adicionar tensão"
              : dialog === "outcome"
                ? "Registrar encaminhamento"
                : dialog === "invite"
                  ? "Convidar membro"
                  : dialog === "assume"
                    ? "Assumir condução"
                    : dialog === "close"
                      ? "Encerrar reunião"
                      : dialog === "cancel"
                        ? "Cancelar reunião"
                        : dialog === "delete"
                          ? "Excluir reunião"
                      : dialog === "consent"
                        ? "Efetivar proposta"
                        : dialog === "objection"
                          ? "Registrar objeção"
                          : dialog.startsWith("resolve:")
                            ? "Teste e integração"
                            : "Aprovação da proposta"
          }
          onClose={() => setDialog("")}
        >
          {dialog === "people" ? <div className="o2-people-dialog">
            <div className="o2-people-list">{detail.participants.filter((participant: any) => participant.access !== "DENY").map((participant: any) => <div key={participant.memberId}>
              <span className="o2-avatar">{person(participant.memberId).split(" ").slice(0, 2).map((name: string) => name[0]).join("")}</span>
              <span><strong>{person(participant.memberId)}</strong><small>{participant.attendance === "PRESENT" ? "Presença confirmada" : participant.attendance === "ABSENT" ? "Ausente" : "Presença não confirmada"}</small></span>
              {participant.attendance === "PRESENT" && <CheckCircle2 size={18} />}
            </div>)}</div>
            <div className="o2-occurrence-roles">{[["Facilitação", m.facilitatorId], ["Escrita", m.notetakerId]].map(([label, memberId]) => <div key={label}><strong>{label}</strong><span>{memberId ? person(memberId) : "Ainda não assumida"}</span></div>)}</div>
            <p className="muted">São funções desta ocorrência. Assumir exige confirmação com as pessoas presentes e preserva energizações e mandatos do círculo.</p>
            <footer>{(panel.member || detail.capabilities.manage) && !closed && <Button onClick={() => setDialog("invite")}>Convidar membro</Button>}{running && canDeclarePresence && <Button disabled={busy} onClick={() => void command("presence", { attendance: panel.present ? "ABSENT" : "PRESENT" })}>{panel.present ? "Sair da presença" : "Estou presente"}</Button>}{canContribute && <Button onClick={() => setDialog("assume")}>Assumir função temporária</Button>}<Button onClick={() => setDialog("")}>Voltar ao encontro</Button></footer>
          </div> : dialog === "outcome" ? (
            <MeetingOutcomeForm
              agendaContext={selected ? { id: selected.id, announceAdapt: treatment?.mode === "ADAPT" } : undefined}
              allowedKinds={[
                ...(detail.capabilities.edit ? ["TASK", "PROJECT", "GOAL"] as const : []),
                ...(!p ? ["PROPOSAL"] as const : []),
              ]}
              context={context}
              meetingId={meetingId}
              meetingVersion={m.version}
              circleId={m.circleId}
              timeZone={m.timeZone}
              agenda={selected ? [selected] : []}
              onBusy={setBusy}
              onReload={() => {
                setDialog("");
                void load();
              }}
              onCreated={() => {
                setDialog("");
                void load();
              }}
              onProposal={(agendaId, type) => {
                if (!agendaId) return;
                setDialog("");
                setGovernanceDialog({kind:'create',agendaId,type});
              }}
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  v = (k: string) => String(f.get(k) ?? "");
                if (dialog === "tension")
                  void command("tension", {
                    title: v("title"),
                    description: v("description"),
                    mode,
                  });
                if (dialog === "attach")
                  void command("attach", {
                    proposalId: v("proposalId"),
                    agendaId: selected.id,
                  });
                if (["sections", "template"].includes(dialog))
                  void command(dialog, {sections: JSON.parse(v("sectionsJson"))});
                if (dialog === "invite")
                  void command("invite", { memberId: v("memberId") });
                if (dialog === "assume")
                  void command("assume", { role: v("role"), confirmed: true });
                if (dialog === "approve" && confirmationCurrent)
                  void process("advance", { confirmed: true });
                if (dialog === "objection")
                  void process("objection", { reason: v("reason") });
                if (dialog.startsWith("resolve:"))
                  void process("resolve", {
                    objectionId: dialog.slice(8),
                    reason: v("reason"),
                    valid: v("valid") === "true",
                  });
                if (dialog === "consent") void consent();
                if (dialog === "cancel" || dialog === "delete")
                  void (async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await context.api(url + "/actions/" + dialog, {
                        method: "POST",
                        version: m.version,
                        body: { scope: v("scope"), reason: v("reason") },
                      });
                      setDialog("");
                      if (dialog === "delete") context.navigate("/meetings");
                      else await load();
                    } catch (e: any) {
                      setError(e.message);
                      await load();
                    } finally {
                      setBusy(false);
                    }
                  })();
                if (dialog === "close")
                  void (async () => {
                    setBusy(true);
                    try {
                      let closingVersion = m.version;
                      if (notes !== null) {
                        await context.api(url + "/panel/actions/notes", {
                          method: "POST",
                          version: closingVersion,
                          body: { notes },
                        });
                        setNotes(null);
                        closingVersion = (await context.api<any>(url)).data
                          .meeting.version;
                      }
                      await context.api(url + "/actions/close", {
                        method: "POST",
                        version: closingVersion,
                        body: {},
                      });
                      await load();
                      setDialog("");
                    } catch (e: any) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  })();
              }}
            >
              {dialog === "tension" && (
                <>
                  <Field label="Título *" name="title" required />
                  <Field label="Descrição (opcional)" name="description">
                    <textarea
                      name="description"
                      placeholder="Acrescente contexto, se quiser"
                    />
                  </Field>
                  <fieldset className="o2-modes">
                    <legend>Como você gostaria de tratar esta tensão?</legend>
                    {[
                      [
                        "SYNC",
                        "Sincronizar",
                        "Coordenar o trabalho e os próximos passos.",
                      ],
                      [
                        "ADAPT",
                        "Adaptar",
                        "Tratar uma proposta de governança: papéis, círculos ou restrições.",
                      ],
                    ].map(([value, title, copy]) => (
                      <label
                        className={mode === value ? "selected" : ""}
                        key={value}
                      >
                        <input
                          type="radio"
                          checked={mode === value}
                          onChange={() => setMode(value)}
                          name="mode"
                          value={value}
                        />
                        <span>
                          <strong>{title}</strong>
                          <small>{copy}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="muted">
                    Você pode registrar só o título e preparar a proposta
                    depois.
                  </p>
                </>
              )}
              {dialog === "attach" && (
                <Field label="Rascunho do círculo" name="proposalId">
                  <select name="proposalId" required>
                    {drafts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  {!drafts.length && (
                    <p>
                      Nenhum rascunho seu deste círculo na primeira página de
                      propostas.
                    </p>
                  )}
                </Field>
              )}
              {["sections", "template"].includes(dialog) && <MeetingStepsEditor sections={m.sections} />}
              {dialog === "invite" && (
                <Field label="Membro da organização" name="memberId">
                  <select name="memberId" required>
                    {context.members
                      .filter(
                        (m) =>
                          m.status === "ACTIVE" && m.memberType !== "GUEST",
                      )
                      .map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.displayName}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              {dialog === "assume" && (
                <>
                  <Field label="Função nesta ocorrência" name="role">
                    <select name="role">
                      <option value="SCRIBE">Escriba</option>
                      <option value="FACILITATOR">Facilitador</option>
                    </select>
                  </Field>
                  <p>A substituição vale somente para este encontro.</p>
                  <label className="o2-confirmation-check">
                    <input type="checkbox" required />
                    Os integrantes presentes não têm objeção à minha assunção.
                  </label>
                </>
              )}
              {(dialog === "approve" || dialog === "consent") && (
                <>
                  <p>Revisão {confirmation?.revision}</p>
                  {!confirmationCurrent && <p role="alert">A proposta ou a reunião mudou. Feche e revise o estado atual.</p>}
                  <p>
                    {dialog === "consent"
                      ? "O escriba registrará o consentimento e tentará efetivar a mudança. Conflitos permanecem como pendência."
                      : "A rodada foi concluída sem objeções válidas pendentes. A efetivação será uma ação separada do escriba."}
                  </p>
                  <label className="o2-confirmation-check">
                    <input type="checkbox" required />
                    Confirmo que não há objeções válidas pendentes à revisão
                    apresentada.
                  </label>
                </>
              )}
              {(dialog === "objection" || dialog.startsWith("resolve:")) && (
                <>
                  <p>
                    Reações expressam opiniões. Uma objeção precisa indicar
                    prejuízo ao propósito de um papel/círculo ou quebra dos
                    meta-acordos. Após alteração, ofereça nova rodada de
                    objeções.
                  </p>
                  <Field
                    label="Fundamento / resultado do teste"
                    name="reason"
                    required
                  />
                  {dialog.startsWith("resolve:") && (
                    <Field label="Resultado" name="valid">
                      <select name="valid">
                        <option value="true">Objeção integrada</option>
                        <option value="false">
                          Objeção testada e considerada inválida
                        </option>
                      </select>
                    </Field>
                  )}
                </>
              )}
              {dialog === "close" && (
                <p>
                  A ata preservará presenças confirmadas, notas e
                  encaminhamentos. Decisões pendentes não serão apresentadas
                  como mudanças efetivadas.
                </p>
              )}
              {dialog === "cancel" && (
                <>
                  <p>
                    A reunião marcada como cancelada sai da pauta e libera os
                    itens para um novo encontro. O histórico é preservado.
                  </p>
                  <Field label="Aplicar cancelamento" name="scope">
                    <select name="scope">
                      <option value="THIS">Somente esta</option>
                      {detail.capabilities.manage && (
                        <option value="FUTURE">Esta e futuras</option>
                      )}
                      {detail.capabilities.manage && (
                        <option value="ALL">
                          Todas as futuras não realizadas
                        </option>
                      )}
                    </select>
                  </Field>
                  <Field label="Motivo (opcional)" name="reason" />
                </>
              )}
              {dialog === "delete" && (
                <>
                  <p>
                    A exclusão é permanente: as reuniões agendadas
                    selecionadas e seus preparativos são removidos sem
                    registro no histórico.
                  </p>
                  <Field label="Aplicar exclusão" name="scope">
                    <select name="scope">
                      <option value="THIS">Somente esta</option>
                      <option value="FUTURE">Esta e futuras</option>
                      <option value="ALL">
                        Todas as futuras não realizadas
                      </option>
                    </select>
                  </Field>
                  <label className="o2-confirmation-check">
                    <input type="checkbox" required />
                    Entendo que a exclusão é permanente e não pode ser desfeita.
                  </label>
                </>
              )}
              <footer>
                <Button onClick={() => setDialog("")}>Cancelar</Button>
                <button className="primary" disabled={busy || (confirmingProposal && !confirmationCurrent)}>
                  {dialog === "tension" ? "Adicionar tensão" : dialog === "cancel" ? "Cancelar reunião" : dialog === "delete" ? "Excluir" : "Confirmar"}
                </button>
              </footer>
            </form>
          )}
        </Dialog>
      )}
      {governanceDialog?.kind==='create' && <MeetingProposalEditor c={context} placement={{
        meetingId, agendaId:governanceDialog.agendaId, type:governanceDialog.type,
        onClose:()=>setGovernanceDialog(null),
        onCreated:()=>{setGovernanceDialog(null);refreshGovernance();},
      }}/>}
      {governanceDialog?.kind==='edit' && <MeetingProposalRevision context={context} proposalId={governanceDialog.proposalId}
        onClose={()=>setGovernanceDialog(null)} onSaved={refreshGovernance}/>}
    </div>
  );
}
function ProposalReading({ context, data, onDone }: { context: FeatureContext; data: any; onDone?: () => void }) {
  const p = data.proposal,
    payload = p.payload ?? {};
  if (data.detail) {
    return (
      <div className="o2-proposal-reading">
        <ProposalOutcomeDiff context={context} detail={data.detail} proposalId={p?.id} onDone={onDone} />
      </div>
    );
  }
  return (
    <div className="o2-proposal-reading">
      {(payload.patches ?? payload.changes ?? []).map((c: any, i: number) => (
        <section key={c.id ?? i}>
          <h3>{c.name ?? c.title ?? c.kind}</h3>
          {c.purposeRich ? (
            <RichTextView value={c.purposeRich} />
          ) : (
            c.purpose && <p>{c.purpose}</p>
          )}
          {["responsibilities", "artifacts"].map((k) =>
            c[k]?.length ? (
              <ul key={k}>
                {c[k].map((r: any, j: number) => (
                  <li key={r.id ?? j}>
                    {r.richText ? (
                      <RichTextView value={r.richText} />
                    ) : (
                      (r.text ?? r)
                    )}
                  </li>
                ))}
              </ul>
            ) : null,
          )}
        </section>
      ))}
      {(data.documents ?? (data.document ? [data.document] : [])).map((document:any,index:number) => <section key={document.documentId ?? index}>
        {document.title && <h3>{document.documentAction === 'ARCHIVE' ? 'Remover restrição · ' : ''}{document.title}</h3>}
        {document.richContent ? <RichTextView value={document.richContent}/> : document.content && <p>{document.content}</p>}
      </section>)}
    </div>
  );
}

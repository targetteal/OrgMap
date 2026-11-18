import { useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, CheckSquare, ChevronDown, Clock, FileText, MessageSquare, MoreHorizontal, Play, Plus, Users } from 'lucide-react';
import type { FeatureContext } from '../../feature-contract';
import { Button, Dialog } from '../../ui';
import { RichTextView } from '../../editor';
import { StructureIcon } from '../../StructureIcon';
import { traceRoute, TraceOrigin } from '../../traceability';
import type { Detail } from './index';
import { RICH_TEXT_PROTOCOL } from '@orgmap/content/collaboration';
import { CollaborativeNotes } from './collaboration';
import { LinkedItems } from './linked-items';
import { MinutesSnapshot } from './minutes-snapshot';
import { ReportPublicationStatus } from './report-publication-status';
import { useMeetingsLocalization } from './use-localization';
import { toPlainText } from '../../../../packages/content';
import { roomText, type RoomCopyKey } from './room-copy';
import './meeting-room.css';

/** The same Maré room composition for meetings without an O2 process.
 * All mutations still use the meeting's authorized, versioned commands. */
export function MeetingRoom({ context, detail, versions, busy, onDialog, onCommand, onPending }: {
  context: FeatureContext;
  detail: Detail;
  versions: any[];
  busy: boolean;
  onDialog: (name: string) => void;
  onCommand: (path: string, body?: any, version?: number) => Promise<void>;
  onPending: (count: number) => void;
}) {
  const { t, locale, formatInstant, formatNumber } = useMeetingsLocalization();
  const r = (key: RoomCopyKey, params?: Record<string, string | number>) => roomText(locale, key, params);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const m = detail.meeting, caps = detail.capabilities;
  const running = m.state === 'RUNNING', scheduled = m.state === 'SCHEDULED';
  const closed = m.state === 'CLOSED' || m.state === 'CANCELLED';
  const section = m.sections.find(s => s.id === m.currentStep) ?? m.sections[0];
  const agendaSection = m.sections.find(s => s.kind === 'AGENDA');
  const next = m.sections[m.sections.findIndex(s => s.id === section?.id) + 1];
  const selected = detail.agenda.find(a => a.id === focusId) ?? detail.agenda.find(a => a.status === 'OPEN' && !a.skipped) ?? detail.agenda[0];
  const hasContext = selected?.descriptionRich && toPlainText(selected.descriptionRich).trim();
  const participants = detail.participants.filter(p => p.access !== 'DENY');
  const present = participants.filter(p => p.attendance === 'PRESENT');
  const self = participants.find(p => p.memberId === context.bootstrap.membership.id);
  const person = (id: string) => context.members.find(p => p.id === id)?.displayName ?? t('Participante');
  const initials = (id: string) => person(id).split(' ').slice(0, 2).map(n => n[0]).join('');
  const circle = context.structure.nodes.find(n => n.entityId === m.circleId)?.name ?? t('Círculo');
  const documents = detail.documents.filter(d => closed || d.sectionId === section?.id);
  const actions = detail.actions.filter(a => section?.kind !== 'AGENDA' || (selected ? a.agendaId === selected.id : !a.agendaId));
  const snapshot = versions.find(v => v.version === detail.report?.version)?.snapshot;
  const goToStep = (sectionId: string) => { if (running && caps.facilitatorOperation && !busy) void onCommand('/actions/step', { sectionId }); };
  const selectSubject = (id: string) => {
    setFocusId(id);
    if (running && agendaSection && section?.id !== agendaSection.id && caps.facilitatorOperation) goToStep(agendaSection.id);
  };
  const status = running ? t('Em andamento') : scheduled ? t('Agendada') : m.state === 'CLOSED' ? t('Encerrada') : t('Cancelada');
  const openTarget = (target: any) => {
    const route = traceRoute(target, '/meetings/' + m.id);
    if (route) context.navigate(route);
  };
  return <section className={'o2-panel o2-room mare-standard-room' + (closed ? ' o2-room-record' : '')} aria-label={m.title}>
    <header className="o2-room-header">
      <button className="o2-back" disabled={busy} onClick={() => context.navigate('/meetings')}><ArrowLeft size={15}/>{t('Reuniões')}</button>
      <div className="o2-room-heading"><div><span className="o2-circle-name"><StructureIcon size={16}/>{circle}</span><h1>{m.title}</h1></div>
        <div className="o2-room-actions"><span className="o2-status">{status}</span>
          {m.state === 'CLOSED' && detail.report && <ReportPublicationStatus report={detail.report} versions={versions} showVersions={false}/>}
          {m.state === 'CLOSED' && detail.report?.state === 'DRAFT' && caps.publish && <Button className="primary" disabled={busy} onClick={() => void onCommand('/report/actions/publish', {}, detail.report.version)}>{t('Publicar ata')}</Button>}
          <Button ariaLabel={r('peopleAndRoles')} title={r('peopleAndRoles')} onClick={() => setPeopleOpen(true)}><Users size={18}/></Button>
          {running && caps.secretaryOperation && <Button disabled={busy} onClick={() => onDialog('close')}>{r('end')}<ArrowRight size={16}/></Button>}
          <details className="o2-controls"><summary aria-label={r('moreMeetingOptions')} title={r('moreMeetingOptions')}><MoreHorizontal size={19}/></summary><div className="o2-tools">
            {scheduled && caps.secretaryOperation && <Button disabled={busy} onClick={() => onDialog('reschedule')}>{t('Reagendar')}</Button>}
            {scheduled && caps.secretaryOperation && <Button disabled={busy} onClick={() => onDialog('cancel')}>{t('Cancelar reunião')}</Button>}
            {scheduled && caps.manage && <Button disabled={busy} onClick={() => onDialog('delete')}>{t('Excluir reunião')}</Button>}
            {caps.manage && <Button disabled={busy} onClick={() => onDialog('participant')}>{r('manageParticipants')}</Button>}
            {caps.manage && <Button disabled={busy} onClick={() => onDialog('notetaker')}>{r('setSecretary')}</Button>}
            {caps.manage && m.method === 'HOLACRACY' && !closed && <Button disabled={busy} onClick={() => onDialog('facilitator')}>{r('setFacilitator')}</Button>}
            {caps.manage && caps.notes && detail.documents.some(d => d.protocol !== RICH_TEXT_PROTOCOL) && <Button disabled={busy} onClick={() => onDialog('migrate')}>{t('Ativar editor rico')}</Button>}
            {detail.report && caps.publish && !(m.state === 'CLOSED' && detail.report.state === 'DRAFT') && <Button disabled={busy} onClick={() => void onCommand('/report/actions/publish', {}, detail.report.version)}>{t('Publicar ata')}</Button>}
            {detail.report && caps.manage && <Button disabled={busy} onClick={() => onDialog('report-access')}>{t('Permissões da ata')}</Button>}
            {detail.report && caps.restore && <><Button disabled={busy} onClick={() => onDialog('restore')}>{t('Restaurar versão')}</Button><Button disabled={busy} onClick={() => onDialog('reopen')}>{t('Reabrir edição')}</Button></>}
          </div></details>
        </div>
      </div>
      {!closed && <nav className="o2-steps" aria-label={t('Etapas da reunião')}>{m.sections.map((s, i) => <button key={s.id} disabled={!running || !caps.facilitatorOperation || busy} aria-current={s.id === section?.id ? 'step' : undefined} className={s.id === section?.id ? 'current' : ''} onClick={() => goToStep(s.id)}><span className="o2-step-number">{i + 1}</span>{s.title}</button>)}</nav>}
    </header>
    {!closed && <aside className="o2-queue" aria-label={r('meetingAgenda')}>
      <div className="o2-queue-heading"><h2>{r('agenda')} <small>{formatNumber(detail.agenda.length)}</small></h2>{caps.edit && <Button disabled={busy} ariaLabel={r('addAgendaItemLabel')} title={r('addAgendaItemLabel')} onClick={() => onDialog('agenda')}><Plus size={18}/></Button>}</div>
      <div className="o2-queue-items">{detail.agenda.map((a, i) => <button key={a.id} className={'o2-tension ' + (selected?.id === a.id ? 'selected' : '')} aria-current={selected?.id === a.id ? 'true' : undefined} disabled={busy} onClick={() => selectSubject(a.id)}><span className="o2-agenda-number">{a.status === 'COMPLETED' ? <Check size={14}/> : i + 1}</span><span>{a.title}<small>{person(a.presenterId)}{a.status === 'COMPLETED' ? ' · ' + t('Concluído') : a.skipped ? ' · ' + r('skipped') : ''}</small></span></button>)}</div>
      {!detail.agenda.length && <p className="muted">{t('Nenhum item na agenda.')}</p>}
      <div className="o2-room-presence"><button onClick={() => setPeopleOpen(true)}><span>{t('Participantes')} · {present.length}/{participants.length}</span><div className="o2-presence-avatars">{participants.slice(0, 5).map(p => <span key={p.memberId} className="o2-avatar" title={person(p.memberId)}>{initials(p.memberId)}</span>)}</div></button>
        {caps.edit && self && running && <Button disabled={busy || self.attendance === 'PRESENT'} onClick={() => void onCommand('/actions/attendance', {memberId: self.memberId, attendance: 'PRESENT'})}><CheckCircle2 size={15}/>{self.attendance === 'PRESENT' ? r('attendanceConfirmed') : t('Confirmar presença')}</Button>}
      </div>
    </aside>}
    <div className="o2-main">
      {detail.accessMode !== 'PARTICIPANT' && <p className="mare-room-readonly">{r('readOnly')}</p>}
      {closed ? <><h2>{t('Ata')}</h2>{detail.report && <><ReportPublicationStatus report={detail.report} versions={versions}/><p className="muted">{r('minutesAccess')}</p></>}{snapshot ? <MinutesSnapshot snapshot={snapshot} context={context}/> : detail.report ? <p role="status">{t("Carregando…")}</p> : <div>{documents.map(d => <section key={d.sectionId}><h3>{m.sections.find(s => s.id === d.sectionId)?.title}</h3>{d.document ? <RichTextView value={d.document}/> : <p>{d.text}</p>}</section>)}{!documents.length && <p className="muted">{t('Sem conteúdo.')}</p>}</div>}</> : scheduled ? <section className="o2-ready"><h2>{r('prepareMeeting')}</h2><p>{r('agendaReady')}</p><div className="o2-ready-facts"><span><CalendarDays size={17}/>{formatInstant(m.startAt)}</span><span><Clock size={17}/>{formatNumber(m.durationMinutes)} {t('min')}</span></div>{caps.secretaryOperation && <Button className="primary" disabled={busy} onClick={() => void onCommand('/actions/start')}><Play size={16}/>{t('Iniciar reunião')}</Button>}{selected && <div className="mare-room-prepared-subject"><h3>{selected.title}</h3><p className="muted">{person(selected.presenterId)}</p>{hasContext && <section className="mare-room-subject-context"><h4>{r('context')}</h4><RichTextView value={selected.descriptionRich}/></section>}</div>}</section> : <section className="o2-focus">
        {section?.kind === 'AGENDA' ? selected ? <>
          <div className="mare-room-subject-meta"><span><MessageSquare size={15}/>{person(selected.presenterId)}</span><span>{t(selected.status === 'COMPLETED' ? 'Concluído' : selected.skipped ? 'Pulado nesta sessão' : 'Pendente')}</span></div>
          <h2 className="mare-room-subject-title">{selected.title}</h2>
          <TraceOrigin context={context} endpoint={`/organizations/${context.organizationId}/meetings/${m.id}/agenda/${selected.id}/origin`} returnTo={'/meetings/' + m.id} disabled={busy}/>
          {hasContext && <section className="mare-room-subject-context"><h3>{r('context')}</h3><RichTextView value={selected.descriptionRich}/></section>}
          <p>{r('question')}</p>
          <section className="mare-room-outcomes"><div className="mare-room-section-heading"><h3>{r('outcomes')}</h3>{caps.edit && <Button disabled={busy} onClick={() => onDialog('outcome:'+selected.id)}><Plus size={16}/>{r('record')}</Button>}</div>
            {actions.length ? actions.map(a => <div className="mare-room-outcome" key={a.id}><CheckSquare size={17}/><div><strong>{a.title}</strong><small>{a.assigneeId ? person(a.assigneeId) : t('Registrada no módulo')}</small></div>{a.targetKind && a.targetId ? <Button onClick={() => openTarget({kind:a.targetKind,id:a.targetId,title:a.title})}>{r('view')}<ArrowRight size={15}/></Button> : a.state === 'OPEN' && caps.edit && (caps.manage || a.assigneeId === context.bootstrap.membership.id) && <Button disabled={busy} onClick={() => void onCommand(`/work-items/${a.id}/actions/complete`, {}, a.version)}>{t('Concluir ação')}</Button>}</div>) : <p className="muted">{r('noOutcome')}</p>}
          </section>
          {caps.edit && selected.status === 'OPEN' && <div className="mare-room-subject-actions"><details className="o2-controls"><summary>{r('moreOptions')}<MoreHorizontal size={16}/></summary><div className="o2-tools"><Button disabled={busy} onClick={() => void onCommand(`/agenda/${selected.id}/actions/skip`, {}, selected.version)}>{t('Pular')}</Button><Button disabled={busy} onClick={() => onDialog('transfer:' + selected.id)}>{t('Transferir')}</Button></div></details><Button className="primary" disabled={busy} onClick={() => void onCommand(`/agenda/${selected.id}/actions/complete`, {}, selected.version)}>{r('completeTopic')}<Check size={16}/></Button></div>}
        </> : <div className="mare-room-empty"><MessageSquare size={28}/><h2>{r('agendaOpen')}</h2><p>{r('addFirstTopic')}</p>{caps.edit && <Button className="primary" onClick={() => onDialog('agenda')}><Plus size={16}/>{r('addTopic')}</Button>}</div> : <>
          <h2>{section?.kind === 'CHECKIN' ? r('checkinTitle') : section?.kind === 'CHECKOUT' ? r('checkoutTitle') : section?.title}</h2>
          <p>{section?.kind === 'CHECKIN' ? r('checkinHelp') : section?.kind === 'CHECKOUT' ? r('checkoutHelp') : r('updateHelp')}</p>
          {['CHECKIN','CHECKOUT'].includes(section?.kind) && <div className="o2-round-people">{present.map(p => <div key={p.memberId}><span className="o2-avatar">{initials(p.memberId)}</span>{person(p.memberId)}</div>)}<small>{r('conversationHelp')}</small></div>}
          {section?.kind === 'PROJECTS' && <LinkedItems context={context} meetingId={m.id} canAdd={caps.edit} onAdd={(item, subcircles) => void onCommand('/agenda',{title:item.title,sourceId:item.id,includeSubcircles:subcircles,presenterId:context.bootstrap.membership.id,durationMinutes:5})}/>}
          {next && caps.facilitatorOperation && <Button className="primary o2-next-step" disabled={busy} onClick={() => goToStep(next.id)}>{r('goToStep', {section:next.title})}<ArrowRight size={16}/></Button>}
          {!next && caps.secretaryOperation && <Button className="primary o2-next-step" disabled={busy} onClick={() => onDialog('close')}>{r('completeMeeting')}<Check size={16}/></Button>}
        </>}
      </section>}
      {!closed && !scheduled && detail.actions.some(a => !a.agendaId) && <section className="mare-room-outcomes"><h3>{r('meetingOutcomes')}</h3>{detail.actions.filter(a => !a.agendaId).map(a => <div className="mare-room-outcome" key={a.id}><CheckSquare size={17}/><div><strong>{a.title}</strong><small>{a.assigneeId ? person(a.assigneeId) : t('Registrada no módulo')}</small></div>{a.targetKind && a.targetId ? <Button onClick={() => openTarget({kind:a.targetKind,id:a.targetId,title:a.title})}>{r('view')}<ArrowRight size={15}/></Button> : a.state === 'OPEN' && caps.edit && (caps.manage || a.assigneeId === context.bootstrap.membership.id) && <Button disabled={busy} onClick={() => void onCommand(`/work-items/${a.id}/actions/complete`, {}, a.version)}>{t('Concluir ação')}</Button>}</div>)}</section>}
      {!closed && !scheduled && documents.map(d => <details className="o2-notes" key={d.sectionId}><summary><FileText size={17}/>{r('meetingNotes')}<ChevronDown size={16}/></summary><CollaborativeNotes key={`${m.id}/${d.sectionId}/${d.epoch}`} context={context} meetingId={m.id} sectionId={d.sectionId} epoch={d.epoch} protocol={d.protocol} schemaVersion={d.schemaVersion} editable={caps.notes} onPending={onPending} discreet/></details>)}
    </div>
    {peopleOpen && <Dialog title={r('peopleRoles')} onClose={() => setPeopleOpen(false)}><div className="o2-people-dialog"><div className="o2-people-list">{participants.map(p => <div key={p.memberId}><span className="o2-avatar">{initials(p.memberId)}</span><span><strong>{person(p.memberId)}</strong><small>{t(p.attendance === 'PRESENT' ? 'Presente' : p.attendance === 'ABSENT' ? 'Ausente' : 'Convidado')}</small></span>{p.attendance === 'PRESENT' && <CheckCircle2 size={17}/>}</div>)}</div><div className="o2-occurrence-roles"><div><strong>{t('Secretaria')}</strong><span>{m.notetakerId ? person(m.notetakerId) : r('unset')}</span></div>{m.facilitatorId && <div><strong>{r('facilitator')}</strong><span>{person(m.facilitatorId)}</span></div>}</div><footer>{caps.manage && <><Button onClick={() => {setPeopleOpen(false);onDialog('participant');}}>{r('manageParticipants')}</Button><Button onClick={() => {setPeopleOpen(false);onDialog('notetaker');}}>{r('setSecretary')}</Button></>}<Button onClick={() => setPeopleOpen(false)}>{r('backToMeeting')}</Button></footer></div></Dialog>}
  </section>;
}

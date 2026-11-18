import { toPlainText } from "../../../../packages/content";
import { CheckSquare, FileText, Users } from "lucide-react";
import type { FeatureContext } from "../../feature-contract";
import { RichTextView } from "../../editor";
import { useMeetingsLocalization } from "./use-localization";

/** Reads the frozen report projection, never the current meeting's mutable agenda. */
export function MinutesSnapshot({ snapshot, context }: { snapshot: any; context: FeatureContext }) {
  const { t } = useMeetingsLocalization();
  if (!snapshot) return <p className="muted">{t("Sem conteúdo.")}</p>;
  const person = (id: string) => context.members.find(member => member.id === id)?.displayName ?? t("Participante");
  const present = (snapshot.participants ?? []).filter((participant: any) => participant.access !== "DENY" && participant.attendance === "PRESENT");
  const notes = snapshot.o2?.panels?.map((panel: any) => panel.notes).filter(Boolean) ?? [];
  return <div className="mare-meeting-minutes">
    <section><h3><Users size={17} />{t("Participantes")}</h3>
      {present.length ? <div className="mare-meeting-minutes-people">{present.map((participant: any) => <span key={participant.memberId}>{person(participant.memberId)}<small>{t("Presente")}</small></span>)}</div> : <p className="muted">{t("Nenhuma presença confirmada")}</p>}
    </section>
    {notes.map((note: string, index: number) => <section key={index}><h3><FileText size={17} />{t("Notas do escriba")}</h3><p className="mare-meeting-preserve">{note}</p></section>)}
    {(snapshot.documents ?? []).filter((document: any) => {
      if (document.text?.trim()) return true;
      if (!document.document) return false;
      try { return !!toPlainText(document.document).trim(); } catch { return true; }
    }).map((document: any) => <section key={document.sectionId}>
      <h3>{snapshot.meeting?.sections?.find((section: any) => section.id === document.sectionId)?.title ?? document.sectionId}</h3>
      {document.document ? <RichTextView value={document.document} emptyText={t("Sem conteúdo.")} /> : <p className="mare-meeting-preserve">{document.text || t("Sem conteúdo.")}</p>}
    </section>)}
    <section><h3>{t("Agenda")}</h3>{(snapshot.agenda ?? []).length ? snapshot.agenda.map((item: any) => <article className="mare-meeting-minutes-item" key={item.id}>
      <strong>{item.title}</strong><small>{t(item.status === "COMPLETED" ? "Concluído" : item.status === "TRANSFERRED" ? "Transferido" : item.status === "WITHDRAWN" ? "Retirado" : "Pendente")}</small>
      {(snapshot.actions ?? []).filter((action: any) => action.agendaId === item.id).map((action: any) => <div className="mare-meeting-minutes-action" key={action.id}><CheckSquare size={16} /><span>{action.title}<small>{action.assigneeId ? person(action.assigneeId) : t("Registrada no módulo")}</small></span></div>)}
    </article>) : <p className="muted">{t("Nenhum item na agenda.")}</p>}</section>
    {(snapshot.actions ?? []).filter((action: any) => !action.agendaId).map((action: any) => <div className="mare-meeting-minutes-action" key={action.id}><CheckSquare size={16} /><span>{action.title}<small>{action.assigneeId ? person(action.assigneeId) : t("Registrada no módulo")}</small></span></div>)}
    {(snapshot.o2?.decisions ?? []).map((decision: any) => <section key={decision.id}><h3>{decision.title}</h3><p>{t(decision.applyState === "APPLIED" ? "Alteração efetivada na estrutura" : decision.verdict === "ADOPT" ? "Decisão aprovada · efetivação pendente" : "Proposta sem aprovação registrada")}</p>
      {(decision.changes ?? []).map((change: any, index: number) => <p key={index}>{change.name ?? change.entityId ?? change.kind}</p>)}
      {(decision.restrictions ?? (decision.restriction ? [decision.restriction] : [])).map((restriction:any,index:number) => <div key={restriction.documentId ?? index}>
        {restriction.title && <h4>{restriction.title}</h4>}
        {restriction.richContent ? <RichTextView value={restriction.richContent} /> : restriction.content && <p className="mare-meeting-preserve">{restriction.content}</p>}
      </div>)}
    </section>)}
  </div>;
}

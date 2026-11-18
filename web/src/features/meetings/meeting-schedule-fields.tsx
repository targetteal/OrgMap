import { useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { Field } from "../../ui";
import { useMeetingsLocalization } from "./use-localization";
export function MeetingScheduleFields({ context, templates, circleId }: { context: FeatureContext; templates: any[]; circleId: string }) {
  const { t, prefs } = useMeetingsLocalization();
  const [frequency, setFrequency] = useState("ONCE");
  const [templateId, setTemplateId] = useState("");
  const [interval, setInterval] = useState("1");
  const repeating = frequency !== "ONCE";
  return <div className="meeting-schedule-fields">
    <p className="meeting-schedule-intro">{t("Escolha o círculo e reserve um momento para o próximo encontro.")}</p>
    <Field label={t("Círculo")} name="circleId"><select name="circleId" required defaultValue={circleId || ""}><option value="" disabled>{t("Selecione um círculo")}</option>{context.structure.circles.map(circle => <option key={circle.id} value={circle.id}>{context.structure.nodes.find(node => node.entityId === circle.id)?.name ?? t("Círculo")}</option>)}</select></Field>
    <Field label={t("Título")} name="title" required maxLength={200} />
    <div className="meetings-form-grid"><Field label={t("Data e hora")} name="localStart" type="datetime-local" required/><Field label={t("Duração (minutos)")} name="durationMinutes" type="number" value="60" required /></div>
    <Field label={t("Repetir")} name="frequency"><select name="frequency" value={frequency} onChange={event => setFrequency(event.target.value)}>{[["ONCE","Não repetir"],["DAILY","Diariamente"],["WEEKLY","Semanalmente"],["MONTHLY","Mensalmente"],["YEARLY","Anualmente"]].map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></Field>
    {repeating ? <div className="meetings-form-grid"><Field label={t("A cada")} name="interval"><input name="interval" type="number" min="1" max="99" value={interval} onChange={event => setInterval(event.target.value)} required /></Field><Field label={t("Número de ocorrências")} name="count" type="number" value="12" required /></div> : <><input type="hidden" name="interval" value="1"/><input type="hidden" name="count" value="1"/></>}
    <div className="meeting-schedule-flow"><span>{t("Etapas da reunião")}</span><p>{(templates.find(template => template.id === templateId)?.sections ?? [{title:"Check-in"},{title:t("Revisar")},{title:t("Pauta")},{title:"Check-out"}]).map((section: any) => section.title).join(" › ")}</p></div>
    <details className="meeting-schedule-options"><summary>{t("Opções do encontro")}</summary>
      <Field label={t("Fuso horário")} name="timeZone" value={prefs.timeZone} required/>
      <Field label={t("Modelo de reunião")} name="templateId"><select name="templateId" value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">{t("Check-in, Revisar, Pauta e Check-out")}</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
      <label className="meeting-schedule-check"><input type="checkbox" name="useRoster" defaultChecked />{t("Incluir participantes do círculo")}</label>
      <label className="meeting-schedule-check"><input type="checkbox" name="includeSubcircles" />{t("Incluir participantes dos subcírculos")}</label>
      <Field label={t("Participantes adicionais")} name="participants"><select name="participants" multiple defaultValue={[context.bootstrap.membership.id]}>{context.members.filter(member => member.status === "ACTIVE").map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></Field>
      <Field label={t("Papéis adicionais")} name="roleIds"><select name="roleIds" multiple>{context.structure.roles.map(role => <option key={role.id} value={role.id}>{context.structure.nodes.find(node => node.entityId === role.id)?.name ?? t("Papel")}</option>)}</select></Field>
      <Field label={t("Janela para editar a ata (dias; 0 = ilimitada)")} name="windowDays" type="number" value="7" required/>
      <label className="meeting-schedule-check"><input type="checkbox" name="notesOnlyNoter" />{t("Somente a secretaria pode editar notas")}</label>
      {context.bootstrap.governanceModel ? <input type="hidden" name="method" value="HOLACRACY"/> : <Field label={t("Método")} name="method"><select name="method"><option value="CUSTOM">{t("Personalizado")}</option></select></Field>}
      {repeating && <details><summary>{t("Opções de recorrência")}</summary><Field label={t("Dias da semana (opcional)")} name="byDay"><select name="byDay" multiple>{["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"].map((day,index) => <option key={day} value={index+1}>{t(day)}</option>)}</select></Field><Field label={t("Posição no mês")} name="bySetPos"><select name="bySetPos"><option value="">{t("Sem posição fixa")}</option>{[["1","Primeira"],["2","Segunda"],["3","Terceira"],["4","Quarta"],["-1","Última"]].map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></Field><Field label={t("Até (data e hora local, opcional)")} name="until" type="datetime-local"/></details>}
    </details>
  </div>;
}

export type PlanningIntent={recurrence:"WEEKLY"|"MONTHLY"|null;reminderLocal:string|null};
export const planningIntentPayload=(form:FormData):PlanningIntent=>({recurrence:(form.get("intentRecurrence") || null) as PlanningIntent["recurrence"],reminderLocal:String(form.get("intentReminderLocal") ?? "") || null});
export function PlanningIntentFields({value}:{value?:PlanningIntent}) {
  return <details className="mare-planning-intent"><summary>Recorrência e lembrete · intenção</summary><p className="muted">Registra uma referência de planejamento. Não cria tarefas futuras, não agenda envios e não dispara notificações. O horário local não representa um instante com fuso.</p><div className="work-date-fields"><label className="field">Intenção de recorrência<select name="intentRecurrence" defaultValue={value?.recurrence ?? ""}><option value="">Não repetir</option><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensal</option></select></label><label className="field">Referência de lembrete local<input name="intentReminderLocal" type="datetime-local" defaultValue={value?.reminderLocal ?? ""}/></label></div></details>;
}
export function PlanningIntentView({value}:{value?:PlanningIntent}) {
  if(!value?.recurrence && !value?.reminderLocal)return null;
  return <div className="mare-planning-intent-view"><strong>Referências de planejamento</strong>{value?.recurrence&&<p>Intenção de recorrência: {value.recurrence === "WEEKLY"?"semanal":"mensal"}</p>}{value?.reminderLocal&&<p>Referência local de lembrete: {value.reminderLocal.replace("T"," · ")}</p>}<small>Não cria tarefas futuras nem dispara notificações.</small></div>;
}

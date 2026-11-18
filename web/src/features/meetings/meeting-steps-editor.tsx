import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useMeetingsLocalization } from "./use-localization";
export type MeetingStep = { id: string; title: string; kind: string };
export function MeetingStepsEditor({ sections }: { sections: MeetingStep[] }) {
  const { t } = useMeetingsLocalization();
  const [rows, setRows] = useState(() => sections.map(row => ({ ...row })));
  const kinds = [["CHECKIN", "Check-in"], ["CUSTOM", "Revisar"], ["PROJECTS", "Projetos"], ["AGENDA", "Pauta"], ["CHECKOUT", "Check-out"]];
  const move = (index: number, delta: number) => setRows(old => { const next = [...old]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; });
  return <div className="meeting-steps-editor">
    <input type="hidden" name="sectionsJson" value={JSON.stringify(rows)} />
    <p>{t("Etapas da reunião")}</p>
    {rows.map((row, index) => <div className="meeting-step-row" key={row.id}>
      <span>{index + 1}</span>
      <label><span className="mare-meetings-sr">{t("Título")} {index + 1}</span><input required maxLength={100} value={row.title} onChange={event => setRows(old => old.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} /></label>
      <select aria-label={`${t("Tipo")} ${index + 1}`} value={row.kind} onChange={event => setRows(old => old.map((item, i) => i === index ? { ...item, kind: event.target.value } : item))}>{!kinds.some(([kind]) => kind === row.kind) && <option value={row.kind}>{row.kind}</option>}{kinds.map(([kind, label]) => <option key={kind} value={kind}>{t(label)}</option>)}</select>
      <div><button type="button" aria-label={`${t("Mover para cima")}: ${row.title}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button type="button" aria-label={`${t("Mover para baixo")}: ${row.title}`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button type="button" aria-label={`${t("Remover")}: ${row.title}`} disabled={rows.length === 1} onClick={() => setRows(old => old.filter((_, i) => i !== index))}><X size={15} /></button></div>
    </div>)}
    <button type="button" className="meeting-add-step" onClick={() => setRows(old => [...old, { id: crypto.randomUUID(), kind: "CUSTOM", title: t("Nova etapa") }])}><Plus size={16} />{t("Adicionar etapa")}</button>
  </div>;
}

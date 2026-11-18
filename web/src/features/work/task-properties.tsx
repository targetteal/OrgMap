import { useLocalization } from "../../localization";
import { workTranslator } from "./messages";
export type TaskPropertiesValue = {
  priority?: string;
  estimateMinutes?: number | null;
  tags?: string[];
};
const priorities: Record<string, string> = {
  NONE: "Sem prioridade",
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  URGENT: "Urgente",
};
export function taskPropertiesPayload(form: FormData) {
  const estimate = String(form.get("estimateMinutes") ?? "").trim();
  return {
    priority: String(form.get("priority") ?? "NONE"),
    estimateMinutes: estimate === "" ? null : Number(estimate),
    tags: String(form.get("tags") ?? "")
      .split(/\r?\n/)
      .filter((tag) => tag.trim()),
  };
}
export function TaskPropertiesFields({
  value,
  pending = false,
}: {
  value?: TaskPropertiesValue;
  pending?: boolean;
}) {
  const { locale } = useLocalization(),
    text = workTranslator(locale);
  return (
    <fieldset disabled={pending} className="work-task-properties-fields">
      <legend>{text("Propriedades")}</legend>
      <label className="field">
        {text("Prioridade")}
        <select name="priority" defaultValue={value?.priority ?? "NONE"}>
          {Object.entries(priorities).map(([key, label]) => (
            <option key={key} value={key}>
              {text(label)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {text("Estimativa (minutos)")}
        <input
          name="estimateMinutes"
          type="number"
          min={0}
          max={525600}
          step={1}
          defaultValue={value?.estimateMinutes ?? ""}
        />
      </label>
      <label className="field">
        {text("Etiquetas")}
        <textarea
          name="tags"
          rows={3}
          maxLength={2040}
          defaultValue={(value?.tags ?? []).join("\n")}
        />
        <small>
          {text(
            "Uma etiqueta por linha. Até 20 etiquetas, com 50 caracteres cada.",
          )}
        </small>
      </label>
    </fieldset>
  );
}
export function TaskPropertiesView({ value, present = false }: { value: TaskPropertiesValue; present?: boolean }) {
  const { locale, formatNumber } = useLocalization(),
    text = workTranslator(locale),
    estimate = value.estimateMinutes,
    hasPriority = !!value.priority && value.priority !== "NONE";
  return (
    <>
      {(!present || hasPriority) && <div>
        <dt>{text("Prioridade")}</dt>
        <dd data-priority={value.priority ?? "NONE"}>
          {text(priorities[value.priority ?? "NONE"] ?? "Sem prioridade")}
        </dd>
      </div>}
      {(!present || estimate != null) && <div>
        <dt>{text("Estimativa")}</dt>
        <dd>
          {estimate == null
            ? text("Sem estimativa")
            : text(
                new Intl.PluralRules(locale).select(estimate) === "one"
                  ? "{minutes} minuto"
                  : "{minutes} minutos",
                { minutes: formatNumber(estimate) },
              )}
        </dd>
      </div>}
      {(!present || !!value.tags?.length) && <div>
        <dt>{text("Etiquetas")}</dt>
        <dd>
          {value.tags?.length ? (
            <ul className="work-tags">
              {value.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          ) : (
            text("Sem etiquetas")
          )}
        </dd>
      </div>}
    </>
  );
}
/** Absent optional properties stay visible as one quiet line instead of occupying the first fold. */
export function TaskPropertiesMissing({ value }: { value: TaskPropertiesValue }) {
  const { locale } = useLocalization(),
    text = workTranslator(locale),
    missing = [
      (!value.priority || value.priority === "NONE") && text("Sem prioridade"),
      value.estimateMinutes == null && text("Sem estimativa"),
      !value.tags?.length && text("Sem etiquetas"),
    ].filter(Boolean);
  return missing.length ? <p className="work-properties-missing mare-empty-value">{missing.join(" · ")}</p> : null;
}

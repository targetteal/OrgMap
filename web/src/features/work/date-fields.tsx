import { readDraft, writeDraft } from "./drafts";
import { useEffect, useId, useRef, useState } from "react";
import { useLocalization } from "../../localization";
import { workDateTimeCandidates, workDateTimeValue } from "./calendar";
import { workTranslator } from "./messages";
function DateField({
  name,
  label,
  original,
  pending,
  draftKey,
}: {
  name: "startsAt" | "endsAt";
  label: string;
  original?: string | null;
  pending: boolean;
  draftKey?: string;
}) {
  const { locale, prefs, formatInstant } = useLocalization(),
    text = workTranslator(locale),
    inputId = useId(),
    [value, setValue] = useState(() => draftKey ? readDraft(draftKey + ":" + name) ?? workDateTimeValue(original, prefs) : workDateTimeValue(original, prefs)),
    [choice, setChoice] = useState(
      (draftKey && readDraft(draftKey + ":" + name + "Choice")) || (original
        ? new Date(
            Math.floor(+new Date(original) / 60000) * 60000,
          ).toISOString()
        : ""),
    ),
    input = useRef<HTMLInputElement>(null),
    candidates = value ? workDateTimeCandidates(value, prefs) : [],
    invalid = !!value && !candidates.length;
  const error = invalid
    ? text("Este horário não existe nesse fuso. Escolha outro horário.")
    : "";
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  return (
    <div className="field">
      <label htmlFor={inputId}>{text(label)}</label>
      <input
        id={inputId}
        ref={input}
        name={name}
        type="datetime-local"
        value={value}
        readOnly={pending}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setChoice("");
          if (draftKey) { writeDraft(draftKey + ":" + name, e.target.value); writeDraft(draftKey + ":" + name + "Choice", ""); }
        }}
      />
      <input type="hidden" name={name + "Original"} value={original ?? ""} />
      {invalid && <small role="alert">{error}</small>}
      {candidates.length > 1 && (
        <>
          <label htmlFor={inputId + "-choice"}>
            {text("Este horário ocorre duas vezes. Escolha o instante.")}
          </label>
          <select
            id={inputId + "-choice"}
            name={name + "Choice"}
            required
            disabled={pending}
            value={candidates.includes(choice) ? choice : ""}
            onChange={(e) => {setChoice(e.target.value); if (draftKey) writeDraft(draftKey + ":" + name + "Choice",e.target.value);}}
            aria-label={text("Escolher instante para {field}", {
              field: text(label),
            })}
          >
            <option value="">{text("Selecionar horário")}</option>
            {candidates.map((instant) => (
              <option key={instant} value={instant}>
                {formatInstant(instant, true, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "shortOffset",
                })}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
export function DateFields({
  task,
  pending = false,
  draftKey,
}: {
  draftKey?: string;
  task?: {
    id: string;
    version: number;
    startsAt: string | null;
    endsAt: string | null;
  };
  pending?: boolean;
}) {
  const { locale, prefs } = useLocalization(),
    text = workTranslator(locale),
    scope = `${task?.id ?? "new"}:${task?.version ?? 0}:${prefs.timeZone}`;
  return (
    <>
      <p className="muted">
        {text("Fuso horário: {zone}", { zone: prefs.timeZone })}
      </p>
      <div className="work-date-fields">
        <DateField
          key={scope + ":start"}
          name="startsAt"
          label="Início"
          original={task?.startsAt}
          pending={pending}
          draftKey={draftKey}
        />
        <DateField
          key={scope + ":end"}
          name="endsAt"
          label="Vencimento"
          original={task?.endsAt}
          pending={pending}
          draftKey={draftKey}
        />
      </div>
    </>
  );
}

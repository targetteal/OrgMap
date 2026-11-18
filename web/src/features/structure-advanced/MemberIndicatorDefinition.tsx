import React, { useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { useLocalization } from "../../localization";
import { Notice } from "../../ui";
import "./structure.css";
type Props = {
  context: FeatureContext;
  memberId: string;
  kind: "METRIC" | "CHECKLIST";
  disabled?: boolean;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
};
/** DEFINE-only consumer: no list/value/history GET and no claim of READ or RECORD. */
export function MemberIndicatorDefinition(props: Props) {
  return (
    <Definition
      key={
        props.context.organizationId + ":" + props.memberId + ":" + props.kind
      }
      {...props}
    />
  );
}
function Definition({
  context: c,
  memberId,
  kind,
  disabled,
  onSaved,
  onPendingChange,
}: Props) {
  const { formatError } = useLocalization();
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="edit-form sa-member-definition"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending || disabled) return;
        const fields = new FormData(event.currentTarget);
        setPending(true);
        onPendingChange?.(true);
        setError("");
        setSaved(false);
        try {
          await c.api(
            `/organizations/${c.organizationId}/structure-advanced/indicators`,
            {
              method: "POST",
              body: {
                subject: { kind: "MEMBER", memberId },
                name: String(fields.get("name")),
                kind,
                valueType:
                  kind === "CHECKLIST" ? "BOOLEAN" : String(fields.get("type")),
                unit: String(fields.get("unit") ?? ""),
                requiredUnits: String(fields.get("units") ?? "")
                  .split("\n")
                  .filter((value) => value.length > 0),
              },
            },
          );
          setSaved(true);
          c.notify("Indicador atribuído ao membro.");
          onSaved?.();
        } catch (error) {
          setError(formatError(error));
        } finally {
          setPending(false);
          onPendingChange?.(false);
        }
      }}
    >
      {error && <Notice>{error}</Notice>}
      {saved && <p role="status">Definição salva.</p>}
      <fieldset disabled={pending || disabled}>
        <legend>{kind === "METRIC" ? "Nova métrica" : "Novo checklist"}</legend>
        <label>
          Nome
          <input name="name" required maxLength={200} />
        </label>
        {kind === "METRIC" && (
          <label>
            Tipo
            <select name="type">
              <option value="NUMBER">Número</option>
              <option value="TEXT">Texto</option>
              <option value="BOOLEAN">Sim/não</option>
            </select>
          </label>
        )}
        <label>
          Unidade
          <input name="unit" maxLength={100} />
        </label>
        <label>
          Unidades do período (uma por linha)
          <textarea name="units" />
        </label>
        <button type="submit">
          {pending ? "Salvando…" : "Salvar definição"}
        </button>
      </fieldset>
    </form>
  );
}

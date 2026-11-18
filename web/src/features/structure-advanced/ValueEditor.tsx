import { useLocalization, createMessageTranslator } from "../../localization";
import { valueEditorMessages } from "./messages";
import React, { useId, useState } from "react";
import { Notice } from "../../ui";
import {
  editorIdentity,
  initialMulti,
  multiPayload,
  toggleOption,
  type EditorItem,
} from "./value-editor-state";
export function ValueEditor(props: {
  organizationId: string;
  entityId: string;
  item: EditorItem;
  disabled: boolean;
  onSave: (value: unknown) => Promise<boolean>;
}) {
  return (
    <Editor
      key={editorIdentity(props.organizationId, props.entityId, props.item)}
      {...props}
    />
  );
}
function Editor({
  item: v,
  disabled,
  onSave,
}: {
  item: EditorItem;
  disabled: boolean;
  onSave: (value: unknown) => Promise<boolean>;
}) {
  const { locale, formatNumber } = useLocalization();
  const t = createMessageTranslator(locale, valueEditorMessages);
  const schema = v.field.schema;
  const [value, setValue] = useState(
    v.value === null
      ? ""
      : typeof v.value === "object"
        ? JSON.stringify(v.value)
        : String(v.value),
  );
  const [selected, setSelected] = useState(() => initialMulti(v.value));
  const [unknown, setUnknown] = useState(v.value === null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const statusId = useId();
  const blocked =
    disabled || saving || v.field.governed || schema.type === "COMPUTED";
  return (
    <form
      className="sa-value"
      onSubmit={async (e) => {
        e.preventDefault();
        if (blocked) return;
        setError("");
        let payload: unknown;
        try {
          payload =
            schema.type === "MULTI"
              ? multiPayload(selected, unknown, schema.required)
              : value === ""
                ? null
                : schema.type === "NUMBER"
                  ? Number(value)
                  : schema.type === "BOOLEAN"
                    ? value === "true"
                    : value;
        } catch (err) {
          setError(t("selectOne"));
          return;
        }
        setSaving(true);
        try {
          await onSave(payload);
        } finally {
          setSaving(false);
        }
      }}
    >
      {schema.type === "MULTI" ? (
        <fieldset disabled={blocked} aria-describedby={statusId}>
          <legend>
            {v.field.label}
            {schema.required ? ` ${t("required")}` : ""}
          </legend>
          {(schema.options ?? []).map((option) => (
            <label className="sa-check" key={option}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(e) => {
                  setSelected((old) =>
                    toggleOption(old, option, e.target.checked),
                  );
                  setUnknown(false);
                  setError("");
                }}
              />
              <span style={{ whiteSpace: "pre-wrap" }}>{option}</span>
            </label>
          ))}
          {!schema.options?.length && <p>{t("noOptions")}</p>}
          {!blocked && (
            <div className="form-actions">
              <button
                type="button"
                onClick={() => {
                  setSelected([]);
                  setUnknown(false);
                  setError("");
                }}
              >
                {t("clear")}
              </button>
              {!schema.required && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected([]);
                    setUnknown(true);
                    setError("");
                  }}
                >
                  {t("remove")}
                </button>
              )}
            </div>
          )}
        </fieldset>
      ) : (
        <label>
          {v.field.label}
          {schema.type === "BOOLEAN" || schema.type === "SELECT" ? (
            <select
              disabled={blocked}
              required={schema.required}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">{t("noValue")}</option>
              {schema.type === "BOOLEAN" ? (
                <>
                  <option value="true">{t("yes")}</option>
                  <option value="false">{t("no")}</option>
                </>
              ) : (
                (schema.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))
              )}
            </select>
          ) : (
            <input
              disabled={blocked}
              required={schema.required}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type={
                schema.type === "NUMBER"
                  ? "number"
                  : schema.type === "DATE"
                    ? "date"
                    : "text"
              }
              step="any"
            />
          )}
        </label>
      )}
      <small id={statusId}>
        {v.field.governed
          ? t("governed")
          : schema.type === "COMPUTED"
            ? t("computed")
            : schema.type === "MULTI" && unknown
              ? t("unknown")
              : v.status === "UNKNOWN" && schema.type !== "MULTI"
                ? t("unknown")
                : t("version", {
                    version: formatNumber(v.version, { useGrouping: false }),
                  })}
      </small>
      {error && <Notice>{error}</Notice>}
      {!v.field.governed && schema.type !== "COMPUTED" && (
        <button disabled={blocked}>{saving ? t("saving") : t("save")}</button>
      )}
    </form>
  );
}

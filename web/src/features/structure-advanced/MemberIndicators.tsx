import { MemberIndicatorDefinition } from "./MemberIndicatorDefinition";
import React, { useEffect, useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { RequestError } from "../../api";
import { useLocalization } from "../../localization";
import { Notice } from "../../ui";
import "./structure.css";

type Indicator = {
  version: number;
  id: string;
  name: string;
  kind: "METRIC" | "CHECKLIST";
  valueType: "NUMBER" | "TEXT" | "BOOLEAN";
  unit: string;
  requiredUnits: string[];
};
type Period = {
  status: "KNOWN" | "UNKNOWN";
  latest: { unitKey: string; value: unknown; version: number }[];
  capabilities: { record: boolean };
  completion: {
    status: "KNOWN" | "UNKNOWN";
    numerator?: number;
    denominator?: number;
    rate?: number;
  };
};
/** Shell profile owns the tabs. This component never widens other profile contexts. */
export function MemberIndicators(props: {
  context: FeatureContext;
  memberId: string;
  kind: "METRIC" | "CHECKLIST";
}) {
  return (
    <SubjectIndicators
      key={
        props.context.organizationId + ":" + props.memberId + ":" + props.kind
      }
      {...props}
    />
  );
}
function SubjectIndicators({
  context: c,
  memberId,
  kind,
}: {
  context: FeatureContext;
  memberId: string;
  kind: "METRIC" | "CHECKLIST";
}) {
  const { formatError, formatNumber } = useLocalization();
  const base = `/organizations/${c.organizationId}/structure-advanced`;
  const [items, setItems] = useState<Indicator[] | null>(null),
    [capabilities, setCapabilities] = useState({
      define: false,
      record: false,
    }),
    [selected, setSelected] = useState(""),
    [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [records, setRecords] = useState<Period | null>(null),
    [recordsKey, setRecordsKey] = useState(""),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [pending, setPending] = useState(false),
    [newDefinition, setNewDefinition] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    setItems(null);
    setError("");
    c.api<{
      items: Indicator[];
      capabilities: { define: boolean; record: boolean };
    }>(`${base}/subjects/member/${memberId}/indicators`, {
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!ctrl.signal.aborted) {
          setItems(r.data.items.filter((i) => i.kind === kind));
          setCapabilities(r.data.capabilities);
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted)
          setError(
            e instanceof RequestError &&
              e.code === "SUBJECT_AUTHORITY_UNAVAILABLE"
              ? "Indicadores pessoais indisponíveis nesta organização."
              : formatError(e),
          );
      });
    return () => ctrl.abort();
  }, [base, memberId, kind, revision, c.api]);
  useEffect(() => {
    setRecords(null);
    if (!selected || !period) return;
    const ctrl = new AbortController();
    c.api<Period>(
      `${base}/indicators/${selected}/records?period=${encodeURIComponent(period)}`,
      { signal: ctrl.signal },
    )
      .then((r) => {
        if (!ctrl.signal.aborted) {
          setRecords(r.data);
          setRecordsKey(selected + ":" + period);
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(formatError(e));
      });
    return () => ctrl.abort();
  }, [base, selected, period, revision, c.api]);
  const selectedItem = items?.find((i) => i.id === selected);
  return (
    <section
      className="sa-member-indicators"
      aria-label={
        kind === "METRIC" ? "Métricas pessoais" : "Checklists pessoais"
      }
    >
      {error && <Notice>{error}</Notice>}
      {items === null ? (
        <p role="status">
          {error
            ? "Conteúdo indisponível para esta conta."
            : "Carregando indicadores…"}
        </p>
      ) : (
        <>
          {!items.length && (
            <p>
              {kind === "METRIC"
                ? "Nenhuma métrica atribuída a este membro."
                : "Nenhum checklist atribuído a este membro."}
            </p>
          )}
          {capabilities.define && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setNewDefinition((x) => !x)}
            >
              {newDefinition ? "Cancelar definição" : "Atribuir indicador"}
            </button>
          )}
          {newDefinition && (
            <MemberIndicatorDefinition
              context={c}
              memberId={memberId}
              kind={kind}
              disabled={pending}
              onPendingChange={setPending}
              onSaved={() => {
                setNewDefinition(false);
                setRevision((value) => value + 1);
              }}
            />
          )}
          {!!items.length && (
            <>
              <label>
                Indicador
                <select
                  disabled={pending}
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setError("");
                  }}
                >
                  <option value="">Selecionar</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Período
                <input
                  value={period}
                  disabled={pending}
                  onChange={(e) => setPeriod(e.target.value)}
                  maxLength={100}
                />
              </label>
            </>
          )}
          {selectedItem && capabilities.define && (
            <form
              className="edit-form"
              key={selectedItem.id + ":" + selectedItem.version}
              onSubmit={async (e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get("name"));
                setPending(true);
                setError("");
                try {
                  await c.api(`${base}/indicators/${selectedItem.id}`, {
                    method: "PATCH",
                    version: selectedItem.version,
                    body: { name },
                  });
                  setRevision((x) => x + 1);
                } catch (error) {
                  setError(formatError(error));
                } finally {
                  setPending(false);
                }
              }}
            >
              <fieldset disabled={pending}>
                <legend>Definição do indicador</legend>
                <label>
                  Nome
                  <input
                    name="name"
                    required
                    maxLength={200}
                    defaultValue={selectedItem.name}
                  />
                </label>
                <button type="submit">Renomear</button>
                <button
                  type="button"
                  onClick={async () => {
                    setPending(true);
                    setError("");
                    try {
                      await c.api(`${base}/indicators/${selectedItem.id}`, {
                        method: "DELETE",
                        version: selectedItem.version,
                        body: {},
                      });
                      setSelected("");
                      setRevision((x) => x + 1);
                    } catch (error) {
                      setError(formatError(error));
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  Arquivar indicador
                </button>
              </fieldset>
            </form>
          )}
          {selectedItem &&
            records &&
            recordsKey === selected + ":" + period && (
              <>
                <p>
                  Estado:{" "}
                  {records.status === "UNKNOWN" ? "Sem registro" : "Registrado"}
                </p>
                {records.completion.status === "KNOWN" && (
                  <p>
                    {formatNumber(records.completion.numerator!)} de{" "}
                    {formatNumber(records.completion.denominator!)} ·{" "}
                    {formatNumber(records.completion.rate!)}%
                  </p>
                )}
                {records.latest.map((v) => (
                  <p key={v.unitKey}>
                    {v.unitKey}:{" "}
                    {typeof v.value === "number"
                      ? formatNumber(v.value)
                      : typeof v.value === "boolean"
                        ? v.value
                          ? "Sim"
                          : "Não"
                        : String(v.value)}
                  </p>
                ))}
                {records.capabilities.record && (
                  <MemberIndicatorRecord
                    key={selected + ":" + period}
                    indicator={selectedItem}
                    records={records}
                    onSave={async (unitKey, value) => {
                      const previous = records.latest.find(
                        (v) => v.unitKey === unitKey,
                      );
                      setPending(true);
                      setError("");
                      try {
                        await c.api(`${base}/indicators/${selected}/records`, {
                          method: "POST",
                          version: previous?.version ?? 0,
                          body: { period, unitKey, value },
                        });
                        setRevision((x) => x + 1);
                        return true;
                      } catch (e) {
                        setError(formatError(e));
                        return false;
                      } finally {
                        setPending(false);
                      }
                    }}
                    pending={pending}
                  />
                )}
              </>
            )}
        </>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => setRevision((x) => x + 1)}
      >
        Atualizar indicadores
      </button>
    </section>
  );
}
function MemberIndicatorRecord({
  indicator: i,
  records,
  onSave,
  pending,
}: {
  indicator: Indicator;
  records: Period;
  onSave: (unitKey: string, value: unknown) => Promise<boolean>;
  pending: boolean;
}) {
  const [unit, setUnit] = useState(i.requiredUnits[0] ?? ""),
    [value, setValue] = useState(""),
    [checked, setChecked] = useState(false);
  useEffect(() => {
    const current = records.latest.find((v) => v.unitKey === unit)?.value;
    setChecked(current === true);
    setValue(current === undefined ? "" : String(current));
  }, [unit, records]);
  return (
    <form
      className="edit-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const typed =
          i.valueType === "BOOLEAN"
            ? checked
            : i.valueType === "NUMBER"
              ? Number(value)
              : value;
        if (await onSave(unit, typed)) setValue("");
      }}
    >
      <fieldset disabled={pending}>
        <legend>Registrar valor</legend>
        <label>
          Unidade do registro
          {i.requiredUnits.length ? (
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {i.requiredUnits.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          ) : (
            <input
              required
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          )}
        </label>
        {i.valueType === "BOOLEAN" ? (
          <label className="sa-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            Concluído
          </label>
        ) : (
          <label>
            Valor
            <input
              type={i.valueType === "NUMBER" ? "number" : "text"}
              step={i.valueType === "NUMBER" ? "any" : undefined}
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <small>
          Versão {records.latest.find((v) => v.unitKey === unit)?.version ?? 0}
        </small>
        <button type="submit">{pending ? "Salvando…" : "Registrar"}</button>
      </fieldset>
    </form>
  );
}

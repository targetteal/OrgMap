import { useEffect, useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Notice } from "../../ui";
import { traceRoute } from "../../traceability";
import { useMeetingsLocalization } from "./use-localization";
/** Read through the owning domain's authorized endpoint; the meeting stores references. */
export function MeetingReviewItem({
  context,
  item,
  meetingId,
}: {
  context: FeatureContext;
  item: { id: string; kind: string; title: string };
  meetingId: string;
}) {
  const [open, setOpen] = useState(false),
    [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7)),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  const { formatNumber } = useMeetingsLocalization();
  useEffect(() => {
    if (!open || item.kind !== "INDICATOR") return;
    const controller = new AbortController();
    setData(null);
    setError("");
    void context
      .api<any>(
        `/organizations/${context.organizationId}/structure-advanced/indicators/${item.id}/records?period=${encodeURIComponent(period)}`,
        { signal: controller.signal },
      )
      .then((r) => {
        if (!controller.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [open, period, item.id, item.kind, context.organizationId]);
  if (item.kind !== "INDICATOR") {
    const route = traceRoute(
      { kind: item.kind as "PROJECT", id: item.id, title: item.title },
      "/meetings/" + meetingId,
    );
    return (
      <p>
        <strong>{item.title}</strong>
        {route && (
          <Button onClick={() => context.navigate(route)}>Consultar</Button>
        )}
      </p>
    );
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{item.title}</summary>
      <label>
        Período{" "}
        <input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
      </label>
      {error && <Notice>{error}</Notice>}
      {open && !data && !error && <p role="status">Carregando registros…</p>}
      {data && (
        <>
          {data.indicator.kind === "CHECKLIST" && (
            <p>
              {data.completion.status === "UNKNOWN"
                ? "Sem unidades exigíveis neste período"
                : `${formatNumber(data.completion.numerator)} de ${formatNumber(data.completion.denominator)} concluídos`}
            </p>
          )}
          {data.latest.length ? (
            <table>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Valor atual</th>
                </tr>
              </thead>
              <tbody>
                {data.latest.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.unitKey}</td>
                    <td>
                      {typeof r.value === "boolean"
                        ? r.value
                          ? "Concluído"
                          : "Pendente"
                        : typeof r.value === "number"
                          ? formatNumber(r.value)
                          : String(r.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>Nenhum registro para este período.</p>
          )}
        </>
      )}
    </details>
  );
}

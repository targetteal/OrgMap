import { useEffect, useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { RefreshCw } from "lucide-react";
import { Button, Notice } from "../../ui";
import { useLocalization } from "../../localization";
import type {
  MeetingStatistics,
  MeetingMetricName,
  MeetingDistributionName,
} from "../../../../server/modules/meetings/statistics-types.js";
import { meetingStatisticsTranslator } from "./statistics-messages";
import { meetingTranslator } from "./messages";

const metricLabels: Record<MeetingMetricName, string> = {
  totalDuration: "Duração total real",
  averageDuration: "Duração média",
  averageParticipants: "Participantes médios",
  attendanceRate: "Taxa de presença",
  actionCompletionRate: "Conclusão de ações",
  agendaCompletionRate: "Conclusão da agenda",
  activeOrganizers: "Organizadores ativos",
};
const distributionLabels: Record<MeetingDistributionName, string> = {
  state: "Estado",
  method: "Método",
  circle: "Círculo",
  template: "Modelo de reunião",
};
const valueLabels: Record<string, string> = {
  SCHEDULED: "Agendada",
  RUNNING: "Em andamento",
  CLOSED: "Encerrada",
  CANCELLED: "Cancelada",
  CUSTOM: "Personalizado",
  HOLACRACY: "Holacracia",
};
export function MeetingStatisticsView({
  context: c,
  formatError: externalError,
}: {
  context: FeatureContext;
  formatError?: (error: unknown) => string;
}) {
  const { locale, formatNumber, formatInstant, formatError } =
    useLocalization();
  const text = meetingStatisticsTranslator(locale),
    common = meetingTranslator(locale);
  const [month, setMonth] = useState(""),
    [circleId, setCircleId] = useState("");
  const [statistics, setStatistics] = useState<MeetingStatistics | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setStatistics(null);
    const query = new URLSearchParams();
    if (month) query.set("month", month);
    if (circleId) query.set("circleId", circleId);
    c.api<MeetingStatistics>(
      `/organizations/${c.organizationId}/meetings/statistics${query.size ? "?" + query : ""}`,
      { signal: abort.signal },
    )
      .then((result) => {
        if (!abort.signal.aborted) setStatistics(result.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError((externalError ?? formatError)(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [month, circleId, c.organizationId, c.api, revision, locale]);
  const number = (n: number | null) =>
    n === null
      ? text("Indisponível")
      : formatNumber(n, { maximumFractionDigits: 2 });
  const circles = c.structure.nodes.filter((e) => e.kind === "CIRCLE");
  const maxMonthParts = statistics
    ? new Intl.DateTimeFormat("en", {
        timeZone: statistics.period.timezone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(new Date(statistics.period.asOf))
    : [];
  const maxMonth = statistics
    ? `${maxMonthParts.find((p) => p.type === "year")?.value}-${maxMonthParts.find((p) => p.type === "month")?.value}`
    : undefined;
  return (
    <div className="meetings-page mare-meetings-report">
      <header className="mare-meetings-report-heading">
        <h2>{text("Estatísticas de reuniões")}</h2>
        <p>
          {text(
            "Apenas ocorrências que você pode ler. O mês usa o fuso da organização; métricas realizadas usam o primeiro fechamento.",
          )}
        </p>
      </header>
      <div className="mare-statistics-filters">
        <label className="field">
          {text("Mês")}
          <input
            type="month"
            value={month || statistics?.period.month || ""}
            max={maxMonth}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <label className="field">
          {common("Círculo")}
          <select
            value={circleId}
            onChange={(e) => setCircleId(e.target.value)}
          >
            <option value="">{text("Todos os círculos")}</option>
            {circles.map((circle) => (
              <option key={circle.entityId} value={circle.entityId}>
                {circle.name}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => setRevision((v) => v + 1)} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {text("Atualizar")}
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {loading && <p role="status">{text("Carregando estatísticas…")}</p>}
      {statistics && (
        <>
          <dl className="mare-statistics-summary">
            {(
              [
                ["observed", text("Ocorrências observadas")],
                ["realized", text("Realizadas")],
                ["running", common("Em andamento")],
                ["cancelled", text("Canceladas")],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{number(statistics.counts[key])}</dd>
              </div>
            ))}
          </dl>
          <div className="mare-statistics-results">
            <div
              className="mare-statistics-table"
              tabIndex={0}
              role="region"
              aria-label={text("Estatísticas de reuniões")}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">{text("Métrica")}</th>
                    <th scope="col">{text("Valor")}</th>
                    <th scope="col">{text("Numerador")}</th>
                    <th scope="col">{text("Denominador")}</th>
                    <th scope="col">{text("Conhecidas / elegíveis")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(metricLabels) as MeetingMetricName[]).map(
                    (key) => {
                      const metric = statistics.metrics[key];
                      return (
                        <tr key={key}>
                          <th scope="row">
                            {text(metricLabels[key])}
                            {metric.unit === "SECONDS"
                              ? ` (${text("Segundos")})`
                              : ""}
                          </th>
                          <td>
                            {metric.value === null
                              ? text("Indisponível")
                              : metric.unit === "RATIO"
                                ? formatNumber(metric.value, {
                                    style: "percent",
                                    maximumFractionDigits: 1,
                                  })
                                : number(metric.value)}
                          </td>
                          <td>{number(metric.numerator)}</td>
                          <td>
                            {metric.denominator === null
                              ? "—"
                              : number(metric.denominator)}
                          </td>
                          <td>
                            {number(metric.known)} / {number(metric.eligible)}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
            <aside className="mare-statistics-coverage">
              <h3>
                {text("Cobertura dos dados")}:{" "}
                {text(
                  statistics.coverage.state === "OBSERVED"
                    ? "Observado"
                    : statistics.coverage.state === "PARTIAL"
                      ? "Parcial"
                      : "Indisponível",
                )}
              </h3>
              <p>
                {text(
                  "Ausência de dados não significa zero. Confira a cobertura e os denominadores.",
                )}
              </p>
              <dl>
                <div>
                  <dt>{text("Início da cobertura")}</dt>
                  <dd>
                    {statistics.coverage.coveredFrom
                      ? formatInstant(statistics.coverage.coveredFrom)
                      : text("Indisponível")}
                  </dd>
                </div>
                <div>
                  <dt>{text("Snapshots conhecidos")}</dt>
                  <dd>{number(statistics.coverage.snapshotKnown)}</dd>
                </div>
                <div>
                  <dt>{text("Snapshots ausentes")}</dt>
                  <dd>{number(statistics.coverage.snapshotMissing)}</dd>
                </div>
                <div>
                  <dt>{text("Durações desconhecidas")}</dt>
                  <dd>{number(statistics.coverage.durationMissing)}</dd>
                </div>
              </dl>
              <p>{text("Sem estimativas")}</p>
              <p className="mare-statistics-period">
                {statistics.period.month} · {statistics.period.timezone}
                <br />
                {text("Atualizado em")} {formatInstant(statistics.period.asOf)}
              </p>
            </aside>
          </div>
          <div className="mare-statistics-distributions">
            {(Object.keys(distributionLabels) as MeetingDistributionName[]).map(
              (name) => (
                <section key={name}>
                  <h3>
                    {name === "state"
                      ? text("Estado")
                      : common(distributionLabels[name])}
                  </h3>
                  {statistics.distributions[name].length === 0 ? (
                    <p>{text("Sem registros observados.")}</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">
                            {name === "state"
                              ? text("Valor")
                              : common(distributionLabels[name])}
                          </th>
                          <th scope="col">{text("Quantidade")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statistics.distributions[name].map((entry, i) => (
                          <tr key={`${entry.key}-${i}`}>
                            <th scope="row">
                              {entry.label === "UNKNOWN"
                                ? text("Desconhecido")
                                : valueLabels[entry.label]
                                  ? common(valueLabels[entry.label])
                                  : entry.label}
                            </th>
                            <td>{number(entry.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

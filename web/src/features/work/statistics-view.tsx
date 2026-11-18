import { workTranslator } from "./messages";
import { useEffect, useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { useLocalization } from "../../localization";
type Statistics = {
  period: { month: string; start: string; asOf: string; timezone: string };
  totalProjects: number;
  total: number | null;
  completed: number | null;
  completedPercent: number | null;
  byStatus: Record<string, number | null>;
  created: number | null;
  changes: number | null;
  activeCircleRate: number | null;
  activeCircles: number | null;
  circlesWithProjects: number;
  activeUserRate: number | null;
  activeParticipants: number | null;
  participants: number | null;
  participantCoverage?: string;
  coverage: {
    state: string;
    firstObserved: string | null;
    unknownCreationDates: number;
    unknownActivityActors: number;
    notes: string;
  };
};
export function WorkStatisticsView({
  context: c,
  formatError,
}: {
  context: FeatureContext;
  formatError: (e: unknown) => string;
}) {
  const { locale, formatNumber, formatDate, formatInstant } = useLocalization(),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [stats, setStats] = useState<Statistics | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true);
  const text = workTranslator(locale);
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    setStats(null);
    setError("");
    c.api<Statistics>(
      `/organizations/${c.organizationId}/work/statistics?month=${month}`,
      { signal: a.signal },
    )
      .then((r) => {
        if (!a.signal.aborted) setStats(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(formatError(e));
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [month, c.organizationId, c.api, revision]);
  const number = (n: number | null | undefined) =>
      n == null ? "—" : formatNumber(n),
    rate = (n: number | null | undefined) =>
      n == null
        ? "—"
        : formatNumber(n / 100, { style: "percent", maximumFractionDigits: 1 }),
    periods = Array.from({ length: 25 }, (_, i) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - i);
      return d.toISOString().slice(0, 7);
    });
  return (
    <div className="work-root work-global-settings">
      <header className="page-heading">
        <h2>{text("Configurações")}</h2>
      </header>
      <nav
        className="work-settings-tabs"
        aria-label={text("Configurações dos projetos")}
      >
        {[
          ["general", "Geral"],
          ["templates", "Modelos"],
          ["stats", "Estatísticas"],
          ["import", "Importar"],
          ["export", "Exportar"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={key === "stats" ? "work-setting-tab-active" : ""}
            onClick={() =>
              c.navigate(
                key === "stats"
                  ? "/projects/stats"
                  : "/projects/settings?tab=" + key,
              )
            }
          >
            {text(label)}
          </button>
        ))}
      </nav>
      <div className="work-statistics work-period-statistics">
        <div className="work-stats-heading">
          <div>
            <h3>{text("Insights de projetos")}</h3>
            <p>
              {text(
                "Atividade dos projetos que você pode acessar. Tarefas pessoais ficam fora desta análise.",
              )}
            </p>
          </div>
          <label className="field">
            {text("Selecionar período")}
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {periods.map((m, i) => (
                <option key={m} value={m}>
                  {i === 0
                    ? text("Mês atual")
                    : formatDate(m + "-01", { month: "long", year: "numeric" })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          {text(
            "Meses delimitados em UTC. Histórico de estados até o fim do período ou o instante atual.",
          )}
        </p>
        {error && (
          <div className="notice" role="alert">
            {error}
            <button onClick={() => setRevision((v) => v + 1)}>
              {text("Tentar novamente")}
            </button>
          </div>
        )}
        {loading ? (
          <p role="status">{text("Carregando estatísticas…")}</p>
        ) : (
          stats && (
            <>
              <div className="work-stat-tiles">
                {[
                  ["Projetos atuais", number(stats.totalProjects)],
                  ["Tarefas observadas", number(stats.total)],
                  ["Tarefas concluídas", number(stats.completed)],
                  ["Taxa de conclusão", rate(stats.completedPercent)],
                ].map(([label, value]) => (
                  <section key={text(label)}>
                    <h4>{text(label)}</h4>
                    <strong>{value}</strong>
                  </section>
                ))}
              </div>
              <section className="work-stat-card">
                <h3>{text("Tarefas por estado")}</h3>
                <p>
                  {text(
                    "Percentual sobre as tarefas observadas, incluindo subtarefas. Sem tarefas, a taxa fica indisponível.",
                  )}
                </p>
                {[
                  ["TODO", "A fazer"],
                  ["DONE", "Concluída"],
                  ["IN_PROGRESS", "Em andamento"],
                  ["BLOCKED", "Bloqueada"],
                ].map(([key, label]) => {
                  const count = stats.byStatus[key],
                    percentage =
                      count != null && stats.total
                        ? (100 * count) / stats.total
                        : null;
                  return (
                    <div className="work-status-distribution" key={key}>
                      <div>
                        <span>{text(label)}</span>
                        <span>
                          {number(count)} · {rate(percentage)}
                        </span>
                      </div>
                      {percentage !== null ? (
                        <progress
                          aria-label={text(label)}
                          max={100}
                          value={percentage}
                        />
                      ) : (
                        <span className="muted">
                          {text("Distribuição indisponível neste período.")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </section>
              <div className="work-stat-tiles work-activity-tiles">
                <section>
                  <h4>{text("Círculos com atividade de tarefas")}</h4>
                  <strong>{rate(stats.activeCircleRate)}</strong>
                  <p>
                    {text(
                      "{active} de {total} círculos vinculados aos projetos do escopo atual.",
                      {
                        active: number(stats.activeCircles),
                        total: number(stats.circlesWithProjects),
                      },
                    )}
                  </p>
                </section>
                <section>
                  <h4>{text("Participantes com atividade")}</h4>
                  <strong>{rate(stats.activeUserRate)}</strong>
                  {stats.participantCoverage ===
                    "ROLE_CAPACITY_UNAVAILABLE" && (
                    <p>
                      {text(
                        "Capacidade de alguns papéis indisponível. A taxa de participação não pode ser calculada.",
                      )}
                    </p>
                  )}
                  <p>
                    {text(
                      "{active} de {total} participantes atuais desses projetos. Não representa todos os membros da organização.",
                      {
                        active: number(stats.activeParticipants),
                        total: number(stats.participants),
                      },
                    )}
                  </p>
                </section>
              </div>
              <section className="work-stat-card">
                <h3>{text("Cobertura dos dados")}</h3>
                <p>
                  {text(
                    stats.coverage.state === "UNAVAILABLE"
                      ? "Sem observações para reconstruir este período. Traços não significam zero atividade."
                      : stats.coverage.state === "PARTIAL"
                        ? "Cobertura parcial: as primeiras observações começam dentro deste período."
                        : "Há observações anteriores ao início deste período para o escopo atual.",
                  )}
                </p>
                <p>
                  {text(
                    "{created} tarefas criadas · {changed} tarefas alteradas no período.",
                    {
                      created: number(stats.created),
                      changed: number(stats.changes),
                    },
                  )}
                </p>
                <p>
                  {text(
                    "Primeira observação: {first}. {dates} datas de criação desconhecidas; {actors} registros de atividade sem autoria identificada.",
                    {
                      first: stats.coverage.firstObserved
                        ? formatInstant(stats.coverage.firstObserved)
                        : text("indisponível"),
                      dates: number(stats.coverage.unknownCreationDates),
                      actors: number(stats.coverage.unknownActivityActors),
                    },
                  )}
                </p>
                <p className="muted">
                  {text(
                    "A migração registra o estado conhecido naquele instante e não cria atividade histórica. Projetos e vínculos atuais delimitam o escopo; esta visão não é um backup histórico de permissões.",
                  )}
                </p>
              </section>
            </>
          )
        )}
      </div>
    </div>
  );
}

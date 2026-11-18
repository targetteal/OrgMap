import { useEffect, useState } from "react";
import type { FeatureContext } from "../../feature-contract";
type Capabilities = {
  queueAvailable: boolean;
  privateAvailable: boolean;
  tabularAvailable: boolean;
};
export function WorkExportView({
  context: c,
  formatError,
}: {
  context: FeatureContext;
  formatError: (e: unknown) => string;
}) {
  const [caps, setCaps] = useState<Capabilities | null>(null),
    [privateIntent, setPrivateIntent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      job: { id: string; state: string };
      selection: { projects: number; months: number };
    } | null>(null),
    [format, setFormat] = useState("JSON");
  const base = `/organizations/${c.organizationId}/work/exports`;
  useEffect(() => {
    const a = new AbortController();
    setCaps(null);
    setPrivateIntent(false);
    setResult(null);
    c.api<Capabilities>(base + "/capabilities", { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) setCaps(r.data);
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(formatError(e));
      });
    return () => a.abort();
  }, [base, c.api]);
  async function enqueue(kind: string) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await c.api<{
        job: { id: string; state: string };
        selection: { projects: number; months: number };
      }>(base, {
        method: "POST",
        body: { kind, format, includePrivate: privateIntent },
      });
      setResult(r.data);
      c.notify("Exportação adicionada à fila.");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="work-global-form work-export-panel">
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {!caps ? (
        <p role="status">Carregando opções de exportação…</p>
      ) : (
        <>
          {!caps.queueAvailable && (
            <p className="notice" role="status">
              A fila de exportação ainda não está disponível nesta instalação.
            </p>
          )}
          {caps.privateAvailable && (
            <label className="work-setting-switch">
              <input
                type="checkbox"
                checked={privateIntent}
                disabled={busy}
                onChange={(e) => setPrivateIntent(e.target.checked)}
              />
              <span>
                Incluir também projetos e tarefas privados por supervisão
                administrativa
              </span>
            </label>
          )}
          {privateIntent && (
            <p className="notice" role="note">
              Esta solicitação incluirá projetos privados. A política
              administrativa será verificada novamente ao processar e baixar o
              arquivo.
            </p>
          )}
          <label className="field">
            Formato do arquivo
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              disabled={busy}
            >
              <option value="JSON">JSON</option>
              {caps.tabularAvailable && (
                <>
                  <option value="XLSX">Planilha Excel</option>
                  <option value="CSV">CSV</option>
                </>
              )}
            </select>
          </label>
          {!caps.tabularAvailable && (
            <p className="muted">
              A exportação em planilha ainda não está disponível nesta
              instalação.
            </p>
          )}
          <section>
            <h3>Exportar as tarefas da organização</h3>
            <p>
              Projetos acessíveis e todas as suas tarefas ativas, com subtarefas
              após a tarefa principal, seções, datas, checklist e dependências.
              Tarefas pessoais ficam fora do arquivo.
            </p>
            <button
              className="primary"
              disabled={busy || !caps.queueAvailable}
              onClick={() => enqueue("TASKS")}
            >
              Exportar tarefas
            </button>
          </section>
          <section>
            <h3>Exportar estatísticas mensais</h3>
            <p>
              Uma linha por mês dos últimos24meses e o mês atual até agora, em
              UTC. Meses sem observações ficam indisponíveis; o arquivo informa
              cobertura e denominadores, sem estimar o histórico ausente.
            </p>
            <button
              className="primary"
              disabled={busy || !caps.queueAvailable}
              onClick={() => enqueue("STATISTICS")}
            >
              Exportar estatísticas
            </button>
          </section>
          {result && (
            <div className="notice" role="status">
              <p>
                Exportação na fila: {result.selection.projects} projetos
                {result.selection.months
                  ? ` · ${result.selection.months} meses`
                  : ""}
                . A conclusão e o arquivo aparecerão em Transferências.
              </p>
              <button onClick={() => c.navigate("/platform/jobs")}>
                Acompanhar exportação
              </button>
            </div>
          )}
          <p className="muted">
            O conjunto de projetos é definido ao solicitar o arquivo. Acesso
            revogado impede processamento e download. Conteúdo atual é lido no
            processamento. Não é backup de comentários, anexos ou histórico
            completo.
          </p>
        </>
      )}
    </div>
  );
}

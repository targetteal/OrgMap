import { useState } from "react";
import type { FeatureContext } from "../../feature-contract";
type Item = {
  index: number;
  sourceId: string | null;
  title: string | null;
  status: string;
  code?: string;
  projectId?: string;
};
type Preview = { items: Item[]; planHash: string; coverage: string };
const importMessages: Record<string, string> = {
  IMPORT_CONTEXT_ORGANIZATION_MISMATCH: "Os vínculos deste projeto pertencem a outra organização e precisam ser removidos ou mapeados antes da importação.",
  IMPORT_PARENT_MISSING:
    "Uma subtarefa aponta para uma tarefa principal que não existe no arquivo.",
  DUPLICATE_IMPORT_SOURCE: "Há identificadores de origem repetidos no arquivo.",
  DEPENDENCY_CYCLE: "As dependências ou a hierarquia formam um ciclo.",
  SECTION_STATUS_MISMATCH: "A seção não corresponde ao estado da tarefa.",
  INVALID_TEMPLATE:
    "As vistas, seções ou a seção de conclusão do modelo são inválidas.",
  INVALID_DATE: "Uma data não está no formato esperado.",
  INVALID_IMPORT_SCHEMA:
    "A estrutura deste projeto não corresponde ao formato JSON do OrgMap.",
  INVALID_REQUEST: "Há campos inválidos ou obrigatórios ausentes.",
  CIRCLE_PROJECT_LIMIT: "O círculo já possui o número permitido de projetos.",
};
const sample = {
  schemaVersion: 1,
  projects: [
    {
      sourceId: "projeto-1",
      title: "Meu projeto",
      visibility: "PRIVATE",
      definition: {
        views: ["BOARD", "LIST", "TIMELINE", "CALENDAR"],
        sections: [
          { name: "A fazer", semantic: "NONE" },
          { name: "Concluído", semantic: "DONE" },
        ],
        defaultDoneSection: 1,
      },
      tasks: [
        {
          sourceId: "tarefa-1",
          title: "Primeira tarefa",
          status: "TODO",
          sectionIndex: 0,
        },
        {
          sourceId: "subtarefa-1",
          title: "Detalhamento",
          parentSourceId: "tarefa-1",
          status: "TODO",
          sectionIndex: 0,
        },
      ],
      dependencies: [],
    },
  ],
};
export function WorkImportView({
  context: c,
  formatError,
}: {
  context: FeatureContext;
  formatError: (e: unknown) => string;
}) {
  const [document, setDocument] = useState<unknown>(null),
    [fileName, setFileName] = useState(""),
    [prefix, setPrefix] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [report, setReport] = useState<Item[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/organizations/${c.organizationId}/work/project-import`;
  async function load(file: File | undefined) {
    setPreview(null);
    setReport(null);
    setDocument(null);
    setFileName(file?.name ?? "");
    setError("");
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error(
          "Use um arquivo JSON de até 5 MB. Divida arquivos maiores em lotes.",
        );
      setDocument(JSON.parse(await file.text()));
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "O arquivo não contém JSON válido."
          : e instanceof Error
            ? e.message
            : "Não foi possível ler o arquivo.",
      );
    }
  }
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      const r = await c.api<Preview>(base + "/preview", {
        method: "POST",
        body: { document, prefix },
      });
      setPreview(r.data);
      setReport(null);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const r = await c.api<{ report: Item[] }>(base + "/apply", {
        method: "POST",
        body: { document, prefix, planHash: preview.planHash },
      });
      setReport(r.data.report);
      setPreview(null);
      c.notify("Importação processada. Confira o relatório por projeto.");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }
  function downloadSample() {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(sample, null, 2)], {
          type: "application/json",
        }),
      ),
      a = window.document.createElement("a");
    a.href = url;
    a.download = "orgmap-projetos-exemplo.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const rows = report ?? preview?.items;
  return (
    <div className="work-global-form work-import-panel">
      <h3>Importar projetos</h3>
      <p>
        Selecione um arquivo JSON do OrgMap e confira a prévia antes de
        importar. Cada projeto é aplicado por inteiro; itens inválidos ficam no
        relatório.
      </p>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <label className="field">
        Arquivo de projetos
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </label>
      {fileName && <p className="muted">{fileName}</p>}
      <label className="field">
        Prefixo dos nomes dos projetos (opcional)
        <input
          maxLength={100}
          value={prefix}
          disabled={busy}
          placeholder="Ex.: Planejamento 2027"
          onChange={(e) => {
            setPrefix(e.target.value);
            setPreview(null);
            setReport(null);
          }}
        />
      </label>
      <div className="button-row">
        <button type="button" onClick={downloadSample}>
          Baixar exemplo JSON
        </button>
        <button
          className="primary"
          disabled={!document || busy}
          onClick={inspect}
        >
          {busy ? "Processando…" : "Conferir importação"}
        </button>
      </div>
      {rows && (
        <section
          className="work-import-report"
          aria-label={
            report ? "Relatório de importação" : "Prévia de importação"
          }
        >
          <h3>{report ? "Relatório de importação" : "Prévia de importação"}</h3>
          <ul>
            {rows.map((item) => (
              <li key={item.index}>
                <strong>{item.title || "Projeto " + (item.index + 1)}</strong>
                <span>
                  {item.status === "READY"
                    ? "Pronto para importar"
                    : item.status === "IMPORTED"
                      ? "Importado"
                      : item.status === "INVALID"
                        ? "Inválido"
                        : "Falha na importação"}
                </span>
                {item.code && (
                  <p role="status">
                    {importMessages[item.code] ??
                      "Não foi possível importar este projeto. Confira os campos no arquivo."}
                  </p>
                )}
                {item.projectId && (
                  <button
                    onClick={() => c.navigate("/projects/" + item.projectId)}
                  >
                    Abrir projeto
                  </button>
                )}
              </li>
            ))}
          </ul>
          {preview && (
            <>
              <p className="muted">{preview.coverage}</p>
              <button
                className="primary"
                disabled={
                  busy || !preview.items.some((i) => i.status === "READY")
                }
                onClick={apply}
              >
                Importar{" "}
                {preview.items.filter((i) => i.status === "READY").length}{" "}
                projeto(s) válido(s)
              </button>
            </>
          )}
        </section>
      )}
      <p className="muted">
        Aceita JSON de projetos do OrgMap ou exportação JSON de trabalho. Vínculos organizacionais são validados na organização de origem; acessos e atribuições não são concedidos. Não transfere comentários, anexos, grupos ou histórico. Novos projetos ficam sob sua
        gestão. Arquivos de até 5 MB.
      </p>
    </div>
  );
}

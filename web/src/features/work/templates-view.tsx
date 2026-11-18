import { useEffect, useState, type FormEvent } from "react";
import type { FeatureContext } from "../../feature-contract";
type Definition = {
  tasks?:unknown[];
  checklists?:unknown[];
  description?:string;
  tags?:string[];
  [key:string]:unknown;
  views: string[];
  sections: { name: string; semantic: "NONE" | "DONE" }[];
  defaultDoneSection: number | null;
};
export type WorkTemplate = {
  id: string;
  name: string;
  definition: Definition;
  isDefault: boolean;
  version: number;
};
type Catalog = { key: string; name: string; definition: Definition };
export function ProjectTemplateSelect({
  context: c,
}: {
  context: FeatureContext;
}) {
  const [templates, setTemplates] = useState<WorkTemplate[]>([]);
  useEffect(() => {
    const a = new AbortController();
    c.api<{ templates: WorkTemplate[] }>(
      `/organizations/${c.organizationId}/work/templates`,
      { signal: a.signal },
    )
      .then((r) => {
        if (!a.signal.aborted) setTemplates(r.data.templates);
      })
      .catch(() => {});
    return () => a.abort();
  }, [c.api, c.organizationId]);
  return (
    <label className="field">
      Modelo
      <select name="templateId" defaultValue="">
        <option value="">Modelo padrão da organização</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.isDefault ? " · Padrão" : ""}
          </option>
        ))}
      </select><small>Descrição e tags do modelo são usadas quando os campos correspondentes ficam vazios. Copia conteúdo e tarefas com novos IDs; permissões, pessoas atribuídas, conversa e anexos não são copiados.</small>
    </label>
  );
}
export function WorkTemplatesView({
  context: c,
  formatError,
}: {
  context: FeatureContext;
  formatError: (e: unknown) => string;
}) {
  const [templates, setTemplates] = useState<WorkTemplate[]>([]),
    [gallery, setGallery] = useState<Catalog[]>([]),
    [manage, setManage] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [catalogOpen, setCatalogOpen] = useState(false),
    [editing, setEditing] = useState<WorkTemplate | null | undefined>(
      undefined,
    );
  const base = `/organizations/${c.organizationId}/work/templates`;
  useEffect(() => {
    const a = new AbortController();
    setLoading(true);
    setError("");
    c.api<{
      templates: WorkTemplate[];
      gallery: Catalog[];
      capabilities: { manage: boolean };
    }>(base, { signal: a.signal })
      .then((r) => {
        if (!a.signal.aborted) {
          setTemplates(r.data.templates);
          setGallery(r.data.gallery);
          setManage(r.data.capabilities.manage);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(formatError(e));
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [base, c.api, revision]);
  async function change(
    path: string,
    body: unknown,
    version?: number,
    method = "POST",
  ) {
    setBusy(true);
    setError("");
    try {
      await c.api(base + path, { method, body, version });
      setRevision((v) => v + 1);
      c.notify("Modelo de projeto salvo.");
      return true;
    } catch (e) {
      setError(formatError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      names = f.getAll("sectionName").map(String),
      semantics = f.getAll("sectionSemantic").map(String),
      sections = names
        .map((name, i) => ({ name: name.trim(), semantic: semantics[i] }))
        .filter((s) => s.name),
      done = String(f.get("defaultDone"));
    const definition = {
      ...editing?.definition,
      views: f.getAll("views"),
      sections:editing?.definition.tasks?.length ? editing.definition.sections : sections,
      defaultDoneSection: editing?.definition.tasks?.length ? editing.definition.defaultDoneSection :
        done === ""
          ? null
          : sections.findIndex((s) => s.name === done && s.semantic === "DONE"),
    };
    if (
      await change(
        editing ? "/" + editing.id : "",
        { name: f.get("name"), definition },
        editing?.version,
        editing ? "PATCH" : "POST",
      )
    )
      setEditing(undefined);
  }
  return (
    <div className="work-global-form work-template-panel">
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <div className="work-template-toolbar">
        <h3>Modelos de projetos</h3>
        {manage && (
          <div className="button-row">
            <button onClick={() => setCatalogOpen(!catalogOpen)}>
              Galeria de modelos
            </button>
            <button className="primary" onClick={() => setEditing(null)}>
              Adicionar modelo
            </button>
          </div>
        )}
      </div>
      {loading ? (
        <p role="status">Carregando modelos…</p>
      ) : templates.length ? (
        <ul className="work-template-list">
          {templates.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <span className="work-template-badge">Organização</span>
                {t.isDefault && (
                  <span className="work-template-badge">Padrão</span>
                )}
                <p className="muted">
                  {t.definition.views.length} vistas ·{" "}
                  {t.definition.sections.length} seções{t.definition.tasks?.length ? ` · ${t.definition.tasks.length} tarefas` : ""}{t.definition.checklists?.length ? ` · ${t.definition.checklists.length} checklists` : ""}
                </p>
              </div>
              {manage && (
                <div className="button-row">
                  <button onClick={() => setEditing(t)}>Editar</button>
                  {!t.isDefault && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          change(
                            "/" + t.id,
                            { isDefault: true },
                            t.version,
                            "PATCH",
                          )
                        }
                      >
                        Usar como padrão
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          change("/" + t.id, undefined, t.version, "DELETE")
                        }
                      >
                        Excluir
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Nenhum modelo salvo. Ao criar o primeiro projeto, o modelo Default é
          registrado para a organização.
        </p>
      )}
      {catalogOpen && (
        <section
          className="work-template-gallery"
          aria-label="Galeria de modelos"
        >
          <h3>Galeria de modelos</h3>
          {gallery.map((g) => (
            <article key={g.key}>
              <h4>{g.name}</h4>
              <p>
                {g.definition.sections.length
                  ? g.definition.sections.map((s) => s.name).join(" → ")
                  : "Projeto sem seções pré-definidas, com as quatro vistas habilitadas."}
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  if (await change("", { galleryKey: g.key }))
                    setCatalogOpen(false);
                }}
              >
                Adicionar {g.name}
              </button>
            </article>
          ))}
        </section>
      )}
      {editing !== undefined && (
        <form
          key={editing?.id ?? "new"}
          className="edit-form work-template-editor"
          onSubmit={save}
        >
          <h3>{editing ? "Editar modelo" : "Adicionar modelo"}</h3>
          <label className="field">
            Nome
            <input
              name="name"
              required
              maxLength={200}
              defaultValue={editing?.name ?? ""}
            />
          </label>
          <fieldset>
            <legend>Vistas habilitadas</legend>
            {["LIST", "BOARD", "TIMELINE", "CALENDAR"].map((v, i) => (
              <label key={v}>
                <input
                  type="checkbox"
                  name="views"
                  value={v}
                  defaultChecked={editing?.definition.views.includes(v) ?? true}
                />
                {["Lista", "Quadro", "Timeline", "Calendário"][i]}
              </label>
            ))}
          </fieldset>
          <p>Seções opcionais. Campos vazios são ignorados.</p>{!!editing?.definition.tasks?.length&&<p className="notice">Este modelo inclui conteúdo e tarefas. As seções são preservadas para manter seus vínculos. Para mudar o trabalho do modelo, crie um projeto com ele e publique uma nova versão como modelo.</p>}
          {Array.from(
            { length: Math.max(4, editing?.definition.sections.length ?? 0) },
            (_, i) => {
              const s = editing?.definition.sections[i];
              return (
                <div className="work-template-section" key={i}>
                  <input
                    aria-label={"Nome da seção " + (i + 1)}
                    name="sectionName"
                    disabled={!!editing?.definition.tasks?.length}
                    maxLength={200}
                    defaultValue={s?.name ?? ""}
                  />
                  <select
                    aria-label={"Semântica da seção " + (i + 1)}
                    name="sectionSemantic"
                    disabled={!!editing?.definition.tasks?.length}
                    defaultValue={s?.semantic ?? "NONE"}
                  >
                    <option value="NONE">Normal</option>
                    <option value="DONE">Concluída</option>
                  </select>
                </div>
              );
            },
          )}
          <label className="field">
            Seção de conclusão padrão
            <input
              name="defaultDone"
              disabled={!!editing?.definition.tasks?.length}
              placeholder="Nome exato de uma seção concluída, ou deixe vazio"
              defaultValue={
                editing?.definition.defaultDoneSection != null
                  ? editing.definition.sections[
                      editing.definition.defaultDoneSection
                    ]?.name
                  : ""
              }
            />
          </label>
          <div className="form-actions">
            <button type="button" onClick={() => setEditing(undefined)}>
              Cancelar
            </button>
            <button className="primary" disabled={busy}>
              Salvar modelo
            </button>
          </div>
        </form>
      )}
      <p className="muted">
        Alterar um modelo afeta projetos criados depois da alteração. Projetos
        existentes preservam sua configuração.
      </p>
    </div>
  );
}

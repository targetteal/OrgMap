import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Save } from "lucide-react";
import type { FeatureContext } from "./feature-contract";
import { errorMessage } from "./api";
import { Button, Dialog, Field, Notice } from "./ui";
export type StructureViewConfig = {
  view: "PACK" | "TREE" | "DIRECTORY" | "NETWORK";
  query: string;
  kind: "ALL" | "CIRCLE" | "ROLE";
  rootId: string | null;
  memberId: string | null;
  flag: string | null;
  maxDepth: number;
  field?: { fieldId: string; equals: unknown };
  presentation?: {
    quick:
      "none" | "my-roles" | "my-circles" | "no-purpose" | "members-no-role";
    highlight: "none" | "mine" | "vacant";
    labels: boolean;
    avatars: boolean;
    minimap: boolean;
  };
};
export type SavedStructureView = {
  id: string;
  name: string;
  version: number;
  config: StructureViewConfig;
};
export type ViewGraph = {
  entities: {
    id: string;
    nodeId: string;
    kind: "CIRCLE" | "ROLE";
    name: string;
    parentId: string | null;
    purpose?: string;
    version: number;
  }[];
  coverage: { complete: boolean; depthLimited: boolean };
};
export function StructureViews({
  context,
  currentConfig,
  selectedId,
  onSelected,
  onApply,
  onDeleted,
  isCompatible,
}: {
  context: FeatureContext;
  currentConfig: StructureViewConfig;
  selectedId: string;
  onSelected: (id: string) => void;
  onApply: (view: SavedStructureView, graph: ViewGraph) => void;
  onDeleted?: (id: string) => void;
  isCompatible?: (view: SavedStructureView) => boolean;
}) {
  const [items, setItems] = useState<SavedStructureView[]>([]),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [dialog, setDialog] = useState<
      "create" | "rename" | "update" | "delete" | null
    >(null),
    [editing, setEditing] = useState<SavedStructureView | null>(null),
    [formError, setFormError] = useState("");
  const alive = useRef(true),
    attempt = useRef<{ payload: string; key: string } | null>(null);
  const base = `/organizations/${context.organizationId}/structure-advanced`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    context
      .api<{
        items: SavedStructureView[];
        page: { hasMore: boolean; nextCursor: string | null };
        contract?: { viewModes: string[]; presentation: boolean };
      }>(base + "/views?limit=100", { signal: ctrl.signal })
      .then(async (response) => {
        let all = response.data.items,
          page = response.data.page;
        const supported =
          response.data.contract?.viewModes.includes("PACK") &&
          response.data.contract.presentation;
        while (page.hasMore && page.nextCursor) {
          const more = await context.api<{
            items: SavedStructureView[];
            page: typeof page;
          }>(
            base +
              "/views?limit=100&cursor=" +
              encodeURIComponent(page.nextCursor),
            { signal: ctrl.signal },
          );
          all = all.concat(more.data.items);
          page = more.data.page;
        }
        if (!ctrl.signal.aborted) {
          setItems(all);
          setReady(!!supported);
          if (!supported)
            setError(
              "As visualizações salvas precisam de atualização do serviço nesta organização.",
            );
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setReady(false);
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [base, context.api, revision]);
  function open(kind: typeof dialog, item: SavedStructureView | null = null) {
    setEditing(item);
    setFormError("");
    attempt.current = null;
    setDialog(kind);
  }
  async function apply(item: SavedStructureView) {
    if (busy) return;
    if (isCompatible && !isCompatible(item)) {
      setError("Esta visualização não está disponível no modelo atual da organização.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fresh = await context.api<SavedStructureView>(
        base + "/views/" + item.id,
      );
      if (isCompatible && !isCompatible(fresh.data)) {
        setError("Esta visualização não está disponível no modelo atual da organização.");
        return;
      }
      const graph = await context.api<ViewGraph>(
        base + "/graph?viewId=" + encodeURIComponent(item.id),
      );
      if (!alive.current) return;
      onSelected(fresh.data.id);
      onApply(fresh.data, graph.data);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    const body =
      dialog === "delete"
        ? {}
        : {
            name: String(data.get("name")),
            config: dialog === "rename" ? editing!.config : currentConfig,
          };
    const endpoint =
        base + "/views" + (dialog === "create" ? "" : "/" + editing!.id),
      method =
        dialog === "create" ? "POST" : dialog === "delete" ? "DELETE" : "PATCH";
    const fingerprint = JSON.stringify({
      endpoint,
      method,
      body,
      version: editing?.version,
    });
    if (attempt.current?.payload !== fingerprint)
      attempt.current = { payload: fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setFormError("");
    try {
      const result = await context.api<SavedStructureView>(endpoint, {
        method,
        body,
        version: dialog === "create" ? undefined : editing!.version,
        key: attempt.current.key,
      });
      if (!alive.current) return;
      if (dialog === "delete") {
        if (selectedId === editing!.id) { onSelected(""); onDeleted?.(editing!.id); }
        context.notify(
          "Visualização removida. As opções desta sessão foram mantidas.",
        );
      } else if (dialog !== "rename" || selectedId === result.data.id) {
        onSelected(result.data.id);
      }
      if (dialog !== "delete") {
        context.notify("Visualização salva.");
      }
      setDialog(null);
      setRevision((v) => v + 1);
    } catch (e) {
      if (alive.current) setFormError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const selected = items.find((item) => item.id === selectedId);
  return (
    <section className="sx-saved-views">
      <div className="sx-saved-search">
        <input
          aria-label="Pesquisar visualização"
          placeholder="Pesquisar visualização"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          className="primary"
          disabled={!ready || busy}
          title={
            ready
              ? "Criar visualização"
              : "Visualizações salvas indisponíveis neste serviço"
          }
          onClick={() => open("create")}
        >
          <Plus size={16} />
        </Button>
      </div>
      {loading ? (
        <p role="status">Carregando visualizações…</p>
      ) : error ? (
        <Notice>
          {error}
          <Button onClick={() => setRevision((v) => v + 1)}>
            Tentar novamente
          </Button>
        </Notice>
      ) : (
        <>
          {items
            .filter((item) =>
              item.name
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            )
            .map((item) => (
              <div
                className={
                  "sx-saved-row " +
                  (selectedId === item.id ? "sx-filter-active" : "")
                }
                key={item.id}
              >
                <Button disabled={busy} onClick={() => void apply(item)}>
                  {item.name}
                </Button>
                <Button
                  disabled={busy}
                  title={"Renomear " + item.name}
                  ariaLabel={"Renomear " + item.name}
                  onClick={() => open("rename", item)}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  disabled={busy}
                  title={"Remover " + item.name}
                  ariaLabel={"Remover " + item.name}
                  onClick={() => open("delete", item)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          {!items.length && (
            <p className="muted">Nenhuma visualização salva.</p>
          )}
          {selected && (
            <Button
              disabled={busy || !ready}
              onClick={() => open("update", selected)}
            >
              <Save size={14} />
              Atualizar com opções atuais
            </Button>
          )}
        </>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === "delete"
              ? "Remover visualização"
              : dialog === "rename"
                ? "Renomear visualização"
                : dialog === "update"
                  ? "Atualizar visualização"
                  : "Salvar visualização"
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <form className="edit-form" onSubmit={submit}>
            {formError && <Notice>{formError}</Notice>}
            {dialog === "delete" ? (
              <p>
                Remover “{editing?.name}” das visualizações salvas? A estrutura
                e seus dados serão preservados.
              </p>
            ) : (
              <>
                <Field
                  label="Nome da visualização"
                  name="name"
                  required
                  maxLength={200}
                  value={editing?.name ?? ""}
                />
                <p className="muted">
                  {dialog === "rename"
                    ? "Os filtros e as opções desta visualização serão preservados."
                    : "Salva a vista, os filtros, os destaques e as opções atuais para sua conta nesta organização."}
                </p>
              </>
            )}
            <div className="form-actions">
              <Button disabled={busy} onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <button
                className={dialog === "delete" ? "danger" : "primary"}
                disabled={busy}
              >
                {busy
                  ? "Salvando…"
                  : dialog === "delete"
                    ? "Remover"
                    : "Salvar"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}

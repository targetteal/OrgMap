import { useMeetingsLocalization } from "./use-localization";
import { useEffect, useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Notice } from "../../ui";
export function LinkedItems({
  context,
  meetingId,
  canAdd,
  onAdd,
}: {
  context: FeatureContext;
  meetingId: string;
  canAdd: boolean;
  onAdd: (
    item: { id: string; kind: string; title: string },
    includeSubcircles: boolean,
  ) => void;
}) {
  const { t, formatError } = useMeetingsLocalization();
  const [subcircles, setSubcircles] = useState(false),
    [items, setItems] = useState<
      { id: string; kind: string; title: string; circleId: string }[]
    >([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setItems([]);
    setError("");
    void context
      .api<{ items: typeof items }>(
        `/organizations/${context.organizationId}/meetings/${meetingId}/linked-items?includeSubcircles=${subcircles}`,
        { signal: c.signal },
      )
      .then((r) => setItems(r.data.items))
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            (e as any).code === "LINKED_ITEMS_PORT_UNAVAILABLE"
              ? t(
                  "A integração com itens dos círculos ainda não está disponível nesta composição.",
                )
              : formatError(e),
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [context.organizationId, meetingId, subcircles]);
  return (
    <section className="meetings-linked">
      <h3>{t("Itens do círculo")}</h3>
      <label>
        <input
          type="checkbox"
          checked={subcircles}
          onChange={(e) => setSubcircles(e.target.checked)}
        />{" "}
        {t("Incluir subcírculos")}
      </label>
      <p className="muted">
        {t("Apenas itens que você pode consultar são exibidos.")}
      </p>
      {error && <Notice>{error}</Notice>}
      {loading ? (
        <p role="status">{t("Carregando itens…")}</p>
      ) : items.length ? (
        items.map((item) => (
          <div className="meetings-agenda-row" key={item.kind + item.id}>
            <div>
              <strong>{item.title}</strong>
              <small>
                {t(
                  (
                    {
                      PROJECT: "Projeto",
                      TASK: "Tarefa",
                      GOAL: "Objetivo",
                      PROPOSAL: "Proposta",
                    } as Record<string, string>
                  )[item.kind] ?? item.kind,
                )}
              </small>
            </div>
            {canAdd && (
              <Button onClick={() => onAdd(item, subcircles)}>
                {t("Adicionar à agenda")}
              </Button>
            )}
          </div>
        ))
      ) : (
        !error && (
          <p className="muted">{t("Nenhum item disponível neste escopo.")}</p>
        )
      )}
    </section>
  );
}

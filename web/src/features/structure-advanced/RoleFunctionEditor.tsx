import React, { useEffect, useId, useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Notice } from "../../ui";
import { RequestError } from "../../api";
import { useLocalization } from "../../localization";
type FunctionCode = "LEAD_LINK" | null;
type RoleFunction = {
  roleId: string;
  functionCode: FunctionCode;
  version: number;
  capabilities: { manage: boolean };
};
export function RoleFunctionEditor(props: {
  context: FeatureContext;
  roleId: string;
}) {
  return (
    <Editor
      key={props.context.organizationId + ":" + props.roleId}
      {...props}
    />
  );
}
function Editor({
  context: c,
  roleId,
}: {
  context: FeatureContext;
  roleId: string;
}) {
  const { formatError } = useLocalization();
  const [current, setCurrent] = useState<RoleFunction | null>(null),
    [draft, setDraft] = useState<FunctionCode>(null),
    [revision, setRevision] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const titleId = useId(),
    selectId = useId();
  const path = `/organizations/${c.organizationId}/structure-advanced/roles/${roleId}/function`;
  const dirty = current !== null && draft !== current.functionCode;
  useEffect(() => {
    setCurrent(null);
    setError("");
    const ctrl = new AbortController();
    c.api<RoleFunction>(path, { signal: ctrl.signal })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        if (
          r.data.roleId !== roleId ||
          !Number.isSafeInteger(r.data.version) ||
          (r.data.functionCode !== null && r.data.functionCode !== "LEAD_LINK")
        )
          throw Error("INVALID_RESPONSE");
        setCurrent(r.data);
        setDraft(r.data.functionCode);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(formatError(e));
      });
    return () => ctrl.abort();
  }, [path, c.api, revision]);
  useEffect(
    () =>
      c.registerNavigationGuard?.(() =>
        dirty || pending
          ? "Há uma alteração de função pendente. Revise antes de sair."
          : null,
      ),
    [c.registerNavigationGuard, dirty, pending],
  );
  async function save(code: FunctionCode) {
    if (!current?.capabilities.manage || pending) return;
    setPending(true);
    setError("");
    try {
      await c.api(path, {
        method: "PUT",
        version: current.version,
        body: { functionCode: code },
      });
      const result = await c.api<RoleFunction>(path);
      setCurrent(result.data);
      setDraft(result.data.functionCode);
      c.notify("Função canônica confirmada.");
    } catch (e) {
      setError(
        e instanceof RequestError && e.code === "VERSION_CONFLICT"
          ? "Este papel foi alterado. O rascunho foi preservado; atualize e revise antes de salvar."
          : formatError(e),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="sa-role-function" aria-labelledby={titleId}>
      <h2 id={titleId}>Governança do papel</h2>
      {current && <p>{current.functionCode === "LEAD_LINK" ? "Função atual: Lead link" : "Sem função canônica atribuída."}</p>}
      <details className="structure-governance-disclosure">
        <summary>Configurações de governança</summary>
        <p>O acesso às propostas usa esta função e uma ocupação vigente.</p>
      {error && <Notice>{error}</Notice>}
      {!current ? (
        <>
          <p role="status">
            {error ? "Configuração indisponível." : "Carregando função…"}
          </p>
          <Button onClick={() => setRevision((x) => x + 1)}>Atualizar</Button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft);
          }}
        >
          <label htmlFor={selectId}>
            Função
            <select
              id={selectId}
              value={draft ?? ""}
              disabled={pending || !current.capabilities.manage}
              onChange={(e) =>
                setDraft(e.target.value === "LEAD_LINK" ? "LEAD_LINK" : null)
              }
            >
              <option value="">Sem função canônica</option>
              <option value="LEAD_LINK">Lead link</option>
            </select>
          </label>
          <small>Versão {current.version}</small>
          {!current.capabilities.manage ? (
            <p>Configuração disponível para proprietários da organização.</p>
          ) : (
            <div className="form-actions">
              <button className="primary" disabled={pending || !dirty}>
                {pending ? "Salvando…" : "Salvar função"}
              </button>
              {current.functionCode === "LEAD_LINK" && (
                <Button disabled={pending} onClick={() => void save(null)}>
                  Remover função
                </Button>
              )}
              <Button
                disabled={pending}
                onClick={() => setRevision((x) => x + 1)}
              >
                Atualizar
              </Button>
            </div>
          )}
        </form>
      )}
      </details>
    </section>
  );
}
export function StructureEntitySections({
  context,
}: {
  context: FeatureContext;
}) {
  return !context.bootstrap.governanceModel && context.selectedEntity?.kind === "ROLE" ? (
    <RoleFunctionEditor
      context={context}
      roleId={context.selectedEntity.entityId}
    />
  ) : null;
}

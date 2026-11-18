import { useEffect, useState, type FormEvent } from "react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Field, Notice } from "../../ui";
import { RequestError, errorMessage } from "../../api";
import { useLocalization } from "../../localization";
type Kind = "PNG" | "PDF" | "JSON" | "UTF8_TEXT";
type Policy = {
  schemaVersion: 1;
  policyId: string | null;
  revision: number;
  mode: "ANY" | "ALLOWLIST" | "DISABLED";
  allowedKinds: Kind[];
};
const modes = {
  ANY: "Qualquer arquivo — somente download",
  ALLOWLIST: "Somente classes permitidas",
  DISABLED: "Novos envios desativados",
};
const kinds: Record<Kind, string> = {
  PNG: "Imagem PNG",
  PDF: "Documento PDF",
  JSON: "Documento JSON",
  UTF8_TEXT: "Texto UTF-8, incluindo código e marcação",
};
function message(error: unknown) {
  const codes: Record<string, string> = {
    POLICY_CONSUMER_UNAVAILABLE:
      "O serviço de arquivos ainda não pode aplicar esta política. A revisão anterior foi preservada.",
    UPLOAD_KINDS_REQUIRED:
      "Selecione ao menos uma classe, ou escolha novos envios desativados.",
    INVALID_UPLOAD_POLICY:
      "Revise o modo e as classes de arquivo selecionadas.",
  };
  return error instanceof RequestError && codes[error.code]
    ? codes[error.code]
    : errorMessage(error);
}
export function UploadPolicySettings({
  context: c,
}: {
  context: FeatureContext;
}) {
  const { formatInstant, formatNumber } = useLocalization();
  const [policy, setPolicy] = useState<Policy | null>(null),
    [supported, setSupported] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [hidden, setHidden] = useState(false),
    [stale, setStale] = useState(false),
    [history, setHistory] = useState<any[]>([]);
  const path =
    "/organizations/" + c.organizationId + "/administration/upload-policy";
  useEffect(() => {
    const controller = new AbortController();
    setPolicy(null);
    setSupported(false);
    setError("");
    setHidden(false);
    setStale(false);
    setHistory([]);
    c.api<{ policy: Policy; supported: boolean }>(path, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) {
          setPolicy(r.data.policy);
          setSupported(r.data.supported);
        }
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof RequestError && e.code === "RESOURCE_NOT_FOUND")
          setHidden(true);
        else setError(message(e));
      });
    return () => controller.abort();
  }, [path]);
  if (hidden) return null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    setBusy(true);
    setError("");
    try {
      const result = await c.api<{ policy: Policy; supported: boolean }>(path, {
        method: "PUT",
        body: { mode: policy.mode, allowedKinds: policy.allowedKinds },
        version: policy.revision,
      });
      setPolicy(result.data.policy);
      setSupported(result.data.supported);
      c.notify("Política de arquivos salva.");
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && e.code === "VERSION_CONFLICT")
        setStale(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="admin-settings admin-security"
      aria-labelledby="upload-policy-title"
    >
      <h2 id="upload-policy-title">Envio de arquivos</h2>
      <p>
        A política se aplica a novos anexos de recursos. Arquivos já disponíveis
        continuam sujeitos às permissões do recurso; esta alteração não os
        apaga.
      </p>
      {error && <Notice>{error}</Notice>}
      {!policy ? (
        <p role="status">Carregando política de arquivos…</p>
      ) : (
        <>
          {!supported && (
            <Notice>
              Configuração do serviço de arquivos necessária. Os controles estão
              somente para consulta.
            </Notice>
          )}
          <p>Versão {formatNumber(policy.revision)}</p>
          <form onSubmit={save}>
            <fieldset
              aria-label="Política de novos anexos"
              disabled={busy || !supported || stale}
            >
              <Field label="Arquivos permitidos" name="upload-policy-mode">
                <select
                  value={policy.mode}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      mode: e.target.value as Policy["mode"],
                      allowedKinds: [],
                    })
                  }
                >
                  {Object.entries(modes).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              {policy.mode === "ALLOWLIST" && (
                <div
                  role="group"
                  aria-label="Classes verificadas pelo servidor"
                >
                  {(Object.entries(kinds) as [Kind, string][]).map(
                    ([kind, label]) => (
                      <label className="admin-check" key={kind}>
                        <input
                          type="checkbox"
                          checked={policy.allowedKinds.includes(kind)}
                          onChange={(e) =>
                            setPolicy({
                              ...policy,
                              allowedKinds: e.target.checked
                                ? [...policy.allowedKinds, kind]
                                : policy.allowedKinds.filter((k) => k !== kind),
                            })
                          }
                        />
                        {label}
                      </label>
                    ),
                  )}
                </div>
              )}
              <p>
                Qualquer arquivo inclui bytes opacos e formatos sem prévia,
                dentro do limite do serviço. Os anexos são oferecidos para
                download; não são executados, extraídos ou exibidos
                automaticamente. A classe é verificada no servidor, não
                declarada pelo nome ou pelo navegador.
              </p>
              <p>
                Fotos de perfil, identidade visual e exports gerados pelo
                servidor seguem seus próprios controles.
              </p>
              <button
                className="primary"
                disabled={busy || !supported || stale}
              >
                {busy ? "Salvando…" : "Salvar política de arquivos"}
              </button>
            </fieldset>
          </form>
          <Button
            disabled={busy}
            onClick={() => {
              setError("");
              void c
                .api<any>(path + "/history")
                .then((r) => setHistory(r.data.items))
                .catch((e) => setError(message(e)));
            }}
          >
            Ver histórico de arquivos
          </Button>
          {history.map((row) => (
            <details key={row.version}>
              <summary>
                Versão {formatNumber(row.version)} ·{" "}
                {formatInstant(row.created_at)}
              </summary>
              <dl>
                <dt>Modo</dt>
                <dd>{modes[row.snapshot.mode as keyof typeof modes]}</dd>
                <dt>Classes permitidas</dt>
                <dd>
                  {row.snapshot.allowedKinds
                    .map((kind: Kind) => kinds[kind])
                    .join(", ") || "Não se aplica"}
                </dd>
              </dl>
            </details>
          ))}
        </>
      )}
    </section>
  );
}

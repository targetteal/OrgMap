import { useEffect, useState, type FormEvent } from "react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Field, Notice } from "../../ui";
import { RequestError, errorMessage } from "../../api";
import { useLocalization } from "../../localization";
type Configuration = {
  complexity: boolean;
  strength: "LOW" | "MEDIUM" | "HIGH";
  expirationDays: null | 30 | 90 | 180 | 365;
  mfaEnforced: boolean;
};
type Policy = {
  id: string | null;
  version: number;
  enabled: boolean;
  configuration: Configuration;
  supported: boolean;
  state: string;
};
const strength = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };
function message(error: unknown) {
  if (
    error instanceof RequestError &&
    [
      "CREDENTIAL_POLICY_CONFIGURATION_REQUIRED",
      "MFA_CONFIGURATION_REQUIRED",
    ].includes(error.code)
  )
    return "A ativação depende da configuração de segurança do servidor. A política anterior foi preservada.";
  return errorMessage(error);
}
export function CredentialPolicySettings({
  context: c,
}: {
  context: FeatureContext;
}) {
  const { formatInstant, formatNumber } = useLocalization();
  const [policy, setPolicy] = useState<Policy | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<any[]>([]),
    [hidden, setHidden] = useState(false),
    [stale, setStale] = useState(false);
  const path =
    "/organizations/" + c.organizationId + "/administration/security-policy";
  useEffect(() => {
    const controller = new AbortController();
    setPolicy(null);
    setError("");
    setHidden(false);
    setStale(false);
    setHistory([]);
    c.api<Policy>(path, { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setPolicy(r.data);
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
  const update = (key: keyof Configuration, value: unknown) =>
    setPolicy((p) =>
      p ? { ...p, configuration: { ...p.configuration, [key]: value } } : p,
    );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!policy) return;
    setBusy(true);
    setError("");
    try {
      const result = await c.api<Policy>(path, {
        method: "PUT",
        body: { enabled: policy.enabled, configuration: policy.configuration },
        version: policy.version,
      });
      setPolicy(result.data);
      c.notify("Política de segurança salva.");
      c.refresh();
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
      aria-labelledby="credential-policy-title"
    >
      <h2 id="credential-policy-title">Segurança de acesso à organização</h2>
      <p>
        Estes requisitos se aplicam à entrada nesta organização. Salvar não
        altera a senha da conta nem as políticas de outras organizações.
      </p>
      {error && <Notice>{error}</Notice>}
      {!policy ? (
        <p role="status">Carregando política de segurança…</p>
      ) : (
        <>
          {!policy.supported && (
            <Notice>
              Configuração do servidor necessária. Os controles estão somente
              para consulta.
            </Notice>
          )}
          <p>
            Estado:{" "}
            {!policy.supported
              ? "Configuração necessária"
              : policy.enabled
                ? "Ativa"
                : "Desativada"}{" "}
            · Versão {formatNumber(policy.version)}
          </p>
          <form onSubmit={save}>
              <fieldset aria-label="Requisitos de segurança" disabled={busy || !policy.supported || stale}>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={policy.enabled}
                  onChange={(e) =>
                    setPolicy({ ...policy, enabled: e.target.checked })
                  }
                />
                Aplicar requisitos de segurança nesta organização
              </label>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={policy.configuration.complexity}
                  onChange={(e) => update("complexity", e.target.checked)}
                />
                Exigir maiúscula, minúscula e caractere especial
              </label>
              <p>
                A regra de complexidade inclui oito caracteres; o piso técnico
                da conta continua valendo. A força é avaliada separadamente.
              </p>
              <Field label="Força mínima da senha" name="credential-strength">
                <select
                  value={policy.configuration.strength}
                  onChange={(e) => update("strength", e.target.value)}
                >
                  {Object.entries(strength).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Expiração da senha nesta organização"
                name="credential-expiration"
              >
                <select
                  value={policy.configuration.expirationDays ?? ""}
                  onChange={(e) =>
                    update(
                      "expirationDays",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                >
                  <option value="">Sem expiração por idade</option>
                  {[30, 90, 180, 365].map((days) => (
                    <option key={days} value={days}>
                      {formatNumber(days)} dias
                    </option>
                  ))}
                </select>
              </Field>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={policy.configuration.mfaEnforced}
                  onChange={(e) => update("mfaEnforced", e.target.checked)}
                />
                Exigir autenticação em dois fatores
              </label>
              <p>
                A ativação só é confirmada quando o servidor pode aplicar os
                requisitos. Uma nova versão pode pedir verificação da credencial
                antes de continuar.
              </p>
              <button
                className="primary"
                disabled={busy || !policy.supported || stale}
              >
                {busy ? "Salvando…" : "Salvar política de segurança"}
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
            Ver histórico de segurança
          </Button>
          {history.map((row) => (
            <details key={row.version}>
              <summary>
                Versão {formatNumber(row.version)} ·{" "}
                {formatInstant(row.created_at)}
              </summary>
              <dl>
                <dt>Aplicação</dt>
                <dd>{row.snapshot.enabled ? "Ativa" : "Desativada"}</dd>
                <dt>Complexidade</dt>
                <dd>
                  {row.snapshot.configuration.complexity
                    ? "Exigida"
                    : "Não exigida"}
                </dd>
                <dt>Força mínima</dt>
                <dd>
                  {
                    strength[
                      row.snapshot.configuration
                        .strength as keyof typeof strength
                    ]
                  }
                </dd>
                <dt>Expiração</dt>
                <dd>
                  {row.snapshot.configuration.expirationDays
                    ? formatNumber(row.snapshot.configuration.expirationDays) +
                      " dias"
                    : "Sem expiração por idade"}
                </dd>
                <dt>Dois fatores</dt>
                <dd>
                  {row.snapshot.configuration.mfaEnforced
                    ? "Exigidos"
                    : "Não exigidos"}
                </dd>
              </dl>
            </details>
          ))}
        </>
      )}
    </section>
  );
}

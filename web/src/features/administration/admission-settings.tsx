import { useEffect, useState, type FormEvent } from "react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Field, Notice } from "../../ui";
import { RequestError, errorMessage } from "../../api";
import { useLocalization } from "../../localization";
type Configuration = {
  registrationMode: "OPEN" | "DOMAIN_RESTRICTED" | "DISABLED";
  allowedDomains: string[];
  membersMayInvite: boolean;
  limitMemberInvitesToDomains: boolean;
  invitationLinkEnabled: boolean;
};
type Policy = Configuration & {
  schemaVersion: 1;
  policyId: string | null;
  revision: number;
};
const modes = {
  OPEN: "Aberto",
  DOMAIN_RESTRICTED: "Restrito por domínio",
  DISABLED: "Desativado — somente convite",
};
const flagLabels = {
  membersMayInvite: "Permitir que membros convidem outros membros",
  limitMemberInvitesToDomains:
    "Restringir convites de membros aos domínios permitidos",
  invitationLinkEnabled: "Habilitar link de inscrição",
};
function message(error: unknown) {
  const codes: Record<string, string> = {
    POLICY_CONSUMER_UNAVAILABLE:
      "Esta capacidade de ingresso ainda não está operacional. A política anterior foi preservada.",
    INVALID_ADMISSION_DOMAIN:
      "Informe domínios completos, um por linha, sem espaços, arroba, URL, IP ou curinga.",
    DUPLICATE_ADMISSION_DOMAIN:
      "Há domínios repetidos após a normalização. Revise a lista.",
    ADMISSION_DOMAINS_REQUIRED:
      "Informe ao menos um domínio para a restrição selecionada.",
    ADMISSION_LINK_DISABLED:
      "O link de inscrição exige cadastro aberto ou restrito por domínio.",
  };
  return error instanceof RequestError && codes[error.code]
    ? codes[error.code]
    : errorMessage(error);
}
export function AdmissionPolicySettings({
  context: c,
}: {
  context: FeatureContext;
}) {
  const { formatInstant, formatNumber } = useLocalization();
  const [policy, setPolicy] = useState<Policy | null>(null),
    [supported, setSupported] = useState(false),
    [error, setError] = useState(""),
    [hidden, setHidden] = useState(false),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [history, setHistory] = useState<any[]>([]);
  const [domainsText, setDomainsText] = useState("");
  const path =
    "/organizations/" + c.organizationId + "/administration/admission-policy";
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
          setDomainsText(r.data.policy.allowedDomains.join("\n"));
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
      const {
        registrationMode,
        allowedDomains,
        membersMayInvite,
        limitMemberInvitesToDomains,
        invitationLinkEnabled,
      } = policy;
      const result = await c.api<{ policy: Policy; supported: boolean }>(path, {
        method: "PUT",
        body: {
          registrationMode,
          allowedDomains: domainsText.split(/\r?\n/).filter(Boolean),
          membersMayInvite,
          limitMemberInvitesToDomains,
          invitationLinkEnabled,
        },
        version: policy.revision,
      });
      setPolicy(result.data.policy);
      setDomainsText(result.data.policy.allowedDomains.join("\n"));
      setSupported(result.data.supported);
      c.notify("Política de admissão salva.");
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
      aria-labelledby="admission-policy-title"
    >
      <h2 id="admission-policy-title">Cadastro e convites</h2>
      <p>
        Esta política controla o ingresso nesta organização. Ela não altera o
        cadastro da conta, o login global nem as associações já existentes.
      </p>
      {error && <Notice>{error}</Notice>}
      {!policy ? (
        <p role="status">Carregando política de admissão…</p>
      ) : (
        <>
          {!supported && (
            <Notice>
              Configuração do serviço de ingresso necessária. Os controles estão
              somente para consulta.
            </Notice>
          )}
          <p>Versão {formatNumber(policy.revision)}</p>
          <form onSubmit={save}>
            <fieldset
              aria-label="Política de admissão e convites"
              disabled={busy || !supported || stale}
            >
              <Field label="Acesso ao cadastro" name="admission-mode">
                <select
                  value={policy.registrationMode}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      registrationMode: e.target
                        .value as Configuration["registrationMode"],
                      invitationLinkEnabled:
                        e.target.value === "DISABLED"
                          ? false
                          : policy.invitationLinkEnabled,
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
              <Field
                label="Domínios de e-mail permitidos — um por linha"
                name="admission-domains"
              >
                <textarea
                  value={domainsText}
                  required={
                    policy.registrationMode === "DOMAIN_RESTRICTED" ||
                    policy.limitMemberInvitesToDomains
                  }
                  onChange={(e) => setDomainsText(e.target.value)}
                />
              </Field>
              <p>
                A correspondência é exata: um subdomínio precisa ser listado
                separadamente. Cadastrar um domínio não comprova sua
                propriedade.
              </p>
              {(
                Object.entries(flagLabels) as [
                  keyof typeof flagLabels,
                  string,
                ][]
              ).map(([key, label]) => (
                <label className="admin-check" key={key}>
                  <input
                    type="checkbox"
                    checked={policy[key]}
                    disabled={
                      key === "invitationLinkEnabled" &&
                      policy.registrationMode === "DISABLED"
                    }
                    onChange={(e) =>
                      setPolicy({ ...policy, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
              <p>
                Convidados não podem convidar. Convites nominais administrativos
                continuam separados do autocadastro. Habilitar o link não gera
                nem divulga um segredo; sua emissão pertence à gestão de
                convites.
              </p>
              <button
                className="primary"
                disabled={busy || !supported || stale}
              >
                {busy ? "Salvando…" : "Salvar política de admissão"}
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
            Ver histórico de admissão
          </Button>
          {history.map((row) => (
            <details key={row.version}>
              <summary>
                Versão {formatNumber(row.version)} ·{" "}
                {formatInstant(row.created_at)}
              </summary>
              <dl>
                <dt>Acesso ao cadastro</dt>
                <dd>
                  {modes[row.snapshot.registrationMode as keyof typeof modes]}
                </dd>
                <dt>Domínios permitidos</dt>
                <dd>{row.snapshot.allowedDomains.join(", ") || "Nenhum"}</dd>
                {Object.entries(flagLabels).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{row.snapshot[key] ? "Sim" : "Não"}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </>
      )}
    </section>
  );
}

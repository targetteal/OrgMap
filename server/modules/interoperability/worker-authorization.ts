import type { ModuleRuntime } from "../../src/runtime.js";
import type { FederationConfiguration } from "./federation.js";
import type { SamlConfigurations } from "./saml-routes.js";
import type { EnrollmentConfiguration } from "./enrollment-ports.js";
import { registerEnrollmentAuthority } from "./enrollment-authority.js";
import { registerAccountFederatedReauthentication } from "./account-reauth.js";
/** Register once on a worker runtime. It validates persisted authorization and accepts no callback/enrollment proof. */
export function registerInteroperabilityWorkerAuthorization(core: ModuleRuntime, input: {
  oidc?: FederationConfiguration;
  saml?: SamlConfigurations;
  enrollment?: EnrollmentConfiguration;
}) {
  const oidc = input.oidc ?? {}, saml = input.saml ?? {};
  registerEnrollmentAuthority(core, input.enrollment ?? {}, oidc, saml, {
    // No HTTP verifier is installed on this runtime. All attempted proof consumption is denied.
    consumeProvisioningProof: () => null,
  });
  registerAccountFederatedReauthentication(core, (org, connection, provider) => provider === "OIDC" ? oidc[org + ":" + connection]?.issuer : provider === "SAML" ? saml[org + ":" + connection]?.idpIssuer : undefined);
}

import type { GuestAccessAdapter } from "../../src/guest-contract.js";
/** Only closed metadata/transport routes. Resource grants belong to the delegated domain. */
export function createInteroperabilityGuestAccessAdapter(): GuestAccessAdapter {
  const base = "/api/v1/organizations/:organizationId/interoperability";
  return {
    context: "interoperability",
    routes: [
      { method: "POST", path: base + "/mcp", action: "read", transport: "REENTER_DECLARED_TARGET" },
      { method: "GET", path: base + "/commands", action: "read", transport: "REENTER_DECLARED_TARGET" },
      { method: "POST", path: base + "/commands/:commandName", action: "read", transport: "REENTER_DECLARED_TARGET" },
    ],
    // Credentials, connections, calendar and deliveries cannot be shared through this module.
    validateSharePlan: async () => false,
  };
}

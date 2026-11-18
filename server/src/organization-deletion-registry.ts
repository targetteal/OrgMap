import type { OrganizationTeardownParticipant } from "./organization-lifecycle-contract.js";
import { assertFoundationDispositionCoverage, foundationDisposition, deletionTableInventory } from "./organization-deletion-catalog.js";
import { createAdministrationTeardownParticipant } from "../modules/administration/teardown.js";
import { createStructureTeardownParticipant } from "../modules/structure/teardown.js";
import { createGovernanceTeardownParticipant } from "../modules/governance/teardown.js";
import { createGoalsTeardownParticipant } from "../modules/goals/teardown.js";
import { createWorkTeardownParticipant } from "../modules/work/teardown.js";
import { createMeetingsTeardownParticipant } from "../modules/meetings/teardown.js";
import { createInteroperabilityTeardownParticipant } from "../modules/interoperability/teardown.js";
import { createFoundationTeardownParticipant } from "./foundation-teardown.js";
import { createPlatformTeardownParticipant } from "../modules/platform/teardown.js";

// These are the actual private objects, not caller supplied factories or claims.
const registered = new Map<string, OrganizationTeardownParticipant>([
  ["administration", Object.freeze(createAdministrationTeardownParticipant())],
  ["platform", Object.freeze(createPlatformTeardownParticipant())],
  ["structure", Object.freeze(createStructureTeardownParticipant())],
  ["governance", Object.freeze(createGovernanceTeardownParticipant())],
  ["goals", Object.freeze(createGoalsTeardownParticipant())],
  ["work", Object.freeze(createWorkTeardownParticipant())],
  ["meetings", Object.freeze(createMeetingsTeardownParticipant())],
  ["interoperability", Object.freeze(createInteroperabilityTeardownParticipant())],
  ["foundation", Object.freeze(createFoundationTeardownParticipant())],
]);
const expectedContexts = ["foundation", "structure", "governance", "work", "goals", "meetings", "administration", "platform", "interoperability"] as const;

/** Partial registry inspection; this is not an authorization to purge. */
export function inspectDeletionRegistry(): { missing: readonly string[] } {
  assertFoundationDispositionCoverage();
  const missing = expectedContexts.filter(id => !registered.has(id));
  for (const [id, participant] of registered) {
    if (!(id === "administration" || id === "platform" || id === "structure" || id === "governance" || id === "goals" || id === "work" || id === "meetings" || id === "interoperability" || id === "foundation") || participant.contextId !== id || participant.version !== 1)
      throw Error("DELETION_REGISTRY_IDENTITY_MISMATCH");
    const description = participant.describe();
    const expected: readonly string[] = id === "foundation" ? foundationDisposition.tenantCandidate : deletionTableInventory[id];
    const sets = description.ownedSets;
    if (!Array.isArray(sets) || new Set(sets).size !== sets.length || sets.length !== expected.length ||
        expected.some(name => !sets.includes(name)))
      throw Error("DELETION_REGISTRY_OWNERSHIP_MISMATCH");
    const dependencies = id === "foundation" ? expectedContexts.filter(name => name !== "foundation") : [];
    if (!Array.isArray(description.after) || new Set(description.after).size !== description.after.length ||
        description.after.length !== dependencies.length || dependencies.some(name => !description.after.includes(name)))
      throw Error("DELETION_REGISTRY_DEPENDENCIES_UNREVIEWED");
  }
  return { missing };
}

/** Until all ownership, dependencies and the I/O barrier are verified, no runner can start. */
export function assertDeletionRegistryReady(): void {
  inspectDeletionRegistry();
  throw Error("DELETION_REGISTRY_NOT_READY");
}

/** Bind dispatch to the specific object created here; caller-supplied lookalikes are rejected.
 * Retrieval does not imply that the registry or an I/O barrier is ready. */
export function registeredDeletionParticipant(id: string): OrganizationTeardownParticipant {
  inspectDeletionRegistry();
  const participant = registered.get(id);
  if (!participant) throw Error("DELETION_PARTICIPANT_NOT_REGISTERED");
  return participant;
}
export function assertRegisteredDeletionParticipant(participant: OrganizationTeardownParticipant): void {
  if (registeredDeletionParticipant(participant.contextId) !== participant)
    throw Error("DELETION_PARTICIPANT_IDENTITY_MISMATCH");
}

/** Internal ordered view; readiness is a separate, stronger gate. */
export function registeredDeletionParticipants(): readonly OrganizationTeardownParticipant[] {
  const inspection = inspectDeletionRegistry();
  if (inspection.missing.length) throw Error("DELETION_REGISTRY_INCOMPLETE");
  return expectedContexts.map(id => registeredDeletionParticipant(id));
}

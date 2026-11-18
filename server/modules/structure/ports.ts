import type { MemberIndicatorAuthorityPort } from "./profile-capacity-contract.js";
import type { ScopedResource } from "../../src/guest-contract.js";
import type { Ctx } from "../../src/runtime.js";
export type CollectiveOrganizationPolicy = {
  enabled: boolean;
  allowCircleOverride: boolean;
  revision: number;
};
/** Conservative product default, not inferred from the observed tenant. */
export const defaultCollectivePolicy: CollectiveOrganizationPolicy = {
  enabled: false,
  allowCircleOverride: false,
  revision: 0,
};
export type LocalCircleAction =
  "MEMBERSHIP_MANAGE" | "CIRCLE_CONTENT_EDIT" | "CIRCLE_LOCAL_CONFIGURATION";
export const collectiveLocalActions: readonly LocalCircleAction[] = [
  "MEMBERSHIP_MANAGE",
  "CIRCLE_CONTENT_EDIT",
  "CIRCLE_LOCAL_CONFIGURATION",
];
export type CircleCreatedEvent = {
  circleId: string;
  occurredAt: string;
  eventId: string;
  requestId?: string;
};
export type StructurePortsOptions = {
  memberIndicatorAuthority?: MemberIndicatorAuthorityPort;
  guestStructureScope?: (ctx: Ctx) => Promise<{
    roots: readonly ScopedResource[];
    authorizationRevision: number;
  }>;
  organizationPolicy?: (ctx: Ctx) => Promise<CollectiveOrganizationPolicy>;
  onCircleCreated?: (ctx: Ctx, input: CircleCreatedEvent) => Promise<unknown>;
};

/** Display-only configuration: never policies, flags, grants or fallback activation. */
export type CircleDisplayPreferences = {
  labels: boolean;
  avatars: boolean;
  minimap: boolean;
};

export type CanonicalRoleFunction = "LEAD_LINK" | null;

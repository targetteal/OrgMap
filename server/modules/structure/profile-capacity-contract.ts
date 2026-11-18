import type { Ctx } from "../../src/runtime.js";

/** LF10 draft SPI. Explicit identities; a member UUID is never an entity UUID. */
export type IndicatorSubject =
  | { kind: "CIRCLE"; circleId: string }
  | { kind: "ROLE"; roleId: string }
  | { kind: "MEMBER"; memberId: string };

export type MemberIndicatorAction = "READ" | "DEFINE" | "RECORD";
export type MemberIndicatorAuthority = {
  allowed: boolean;
  organizationId: string;
  actorMemberId: string;
  subjectMemberId: string;
  action: MemberIndicatorAction;
  organizationAuthorizationRevision: number;
  subjectVersion: number;
  /** Empty on denial. References are server-only provenance, never bearer grants. */
  reasons: readonly {
    kind: "SELF" | "EXPLICIT_GRANT";
    grantId?: string;
    grantRevision?: number;
  }[];
};

/** Injected by trusted composition, evaluated in the caller's current tenant UoW. */
export interface MemberIndicatorAuthorityPort {
  authorize(
    ctx: Ctx,
    input: { memberId: string; action: MemberIndicatorAction },
  ): Promise<MemberIndicatorAuthority>;
}

/** LF09 runtime SPI. It resolves current people; it grants no Work or admin authority. */
export type RoleCapacityOrigin = {
  source: "OCCUPANCY" | "MANDATE";
  sourceId: string;
  kind: "DIRECT" | "INTERIM" | "ELECTED";
  startsAt: string;
  endsAt: string | null;
};
export type CurrentRoleCapacity = {
  roleId: string;
  circleId: string;
  roleVersion: number;
  authorizationRevision: number;
  asOf: string;
  occupants: readonly {
    memberId: string;
    origins: readonly RoleCapacityOrigin[];
  }[];
};
export interface RoleCapacityPort {
  resolveRoleCapacity(
    ctx: Ctx,
    input: { roleId: string },
  ): Promise<CurrentRoleCapacity>;
}

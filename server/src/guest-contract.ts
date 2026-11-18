import type { FastifyRequest } from "fastify";
import type { Ctx } from "./runtime.js";
export type MemberType = "MEMBER" | "GUEST";
export type ScopedResource = { context: string; kind: string; id: string };
export type InvitationAccessPlan = {
  resource: ScopedResource;
  actions: string[];
}[];
export type GuestGrant = {
  id: string;
  resource: ScopedResource;
  actions: readonly string[];
  grantorMemberId: string;
  version: number;
};
/** Trusted module route declaration; never supplied through request DTOs. */
export type GuestRoute = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  action: string;
  /** Collection handlers must use guestResourceIds/visibleMemberIds before counting/paging. */
  collection?: boolean;
  /** Closed API/MCP transport only: no business data before re-entering a declared target. */
  transport?: "REENTER_DECLARED_TARGET";
  resolve?: (ctx: Ctx, request: FastifyRequest) => Promise<ScopedResource>;
};
export interface GuestAccessAdapter {
  context: string;
  routes: readonly GuestRoute[];
  /** Called as the current grantor, including during subsequent reads. Same ctx.c. */
  validateSharePlan(ctx: Ctx, plan: InvitationAccessPlan): Promise<boolean>;
  visibleMemberIds?(
    ctx: Ctx,
    resources: readonly ScopedResource[],
    purpose: "DIRECTORY" | "ASSIGNEE_PICKER",
  ): Promise<readonly string[]>;
}
export interface MembershipAccessPort {
  requireRoute(
    ctx: Ctx,
    input: {
      routeId: string;
      method: string;
      request: FastifyRequest;
      mode: Ctx["mode"];
    },
  ): Promise<void>;
  visibleMemberIds(
    ctx: Ctx,
    input: {
      purpose: "DIRECTORY" | "ASSIGNEE_PICKER";
      resource?: ScopedResource;
    },
  ): Promise<readonly string[]>;
  structureScope(
    ctx: Ctx,
  ): Promise<{
    roots: readonly ScopedResource[];
    authorizationRevision: number;
  }>;
}

import type { Ctx } from "../../src/runtime.js";
import type { ModelRules, ModelOverrides } from "./package.js";
import type { Policy } from "../governance/domain.js";
export const functionCodes = [
  "GUIDE",
  "REPRESENTATIVE",
  "FACILITATOR",
  "SCRIBE",
] as const;
export type RoleFunction = (typeof functionCodes)[number];
export type AssignmentInput = {
  roleId: string;
  memberId: string;
  kind?: string;
  startsAt?: string;
  endsAt?: string | null;
  election?: boolean;
};
export type ModelReasons = {
  memberId: string;
  asOf: string;
  reasons: {
    circleId: string;
    roleId?: string;
    sourceId: string;
    source: string;
    capability: string;
  }[];
  circles: string[];
};
export type ModelState = {
  packageId: string;
  packageVersion: string;
  sourceReference: {
    url: string;
    revision: string;
    accessedAt: string;
    definitionsDigest: string;
  };
  phase: "PREPARATION" | "OPERATING";
  revision: number;
  overrides: ModelOverrides;
  rules: ModelRules;
  installedAt: string;
  startedAt: string | null;
};
export interface GovernanceModelPort {
  state(ctx: Ctx): Promise<ModelState | null>;
  governancePolicy(
    ctx: Ctx,
  ): Promise<{
    configuration: Partial<Policy>;
    packageId: string;
    packageVersion: string;
    modelRevision: number;
  } | null>;
  summary(ctx: Ctx): Promise<any>;
  roleFunctions(
    ctx: Ctx,
    circleId: string,
  ): Promise<
    | {
        roleId: string;
        functionCode: RoleFunction;
        occupants: {
          memberId: string;
          occupancyId: string;
          startsAt: string;
          endsAt: string | null;
        }[];
      }[]
    | null
  >;
  hasFunction(
    ctx: Ctx,
    circleId: string,
    functionCode: RoleFunction,
    memberId?: string,
  ): Promise<boolean>;
  reasons(ctx: Ctx, memberId: string): Promise<ModelReasons | null>;
  participates(ctx: Ctx, circleId: string): Promise<boolean | null>;
  authorizeCircle(
    ctx: Ctx,
    circleId: string,
    action: string,
  ): Promise<boolean | null>;
  authorizeAssignment(
    ctx: Ctx,
    input: AssignmentInput,
  ): Promise<boolean | null>;
  authorizeEnd(
    ctx: Ctx,
    source: string,
    occupancyId: string,
  ): Promise<boolean | null>;
  validateAssignment(ctx: Ctx, input: AssignmentInput): Promise<boolean>;
  recordOccupancy(
    ctx: Ctx,
    source: string,
    row: any,
    origin?: string,
    agreement?: { exitNotBefore?: string; exitAgreement?: string },
  ): Promise<void>;
  recordEnd(ctx: Ctx, source: string, row: any): Promise<void>;
  recordStructureChange(ctx:Ctx,input:{resourceId:string;action:string;before:unknown;after:unknown}):Promise<void>;
  ensureCircle(ctx: Ctx, circleId: string): Promise<void>;
  preflight(
    ctx: Ctx,
    input: { operation: string; entityId?: string; changedFields?: string[] },
  ): Promise<void>;
  validateElection(
    ctx: Ctx,
    input: {
      circleId: string;
      roleId: string;
      winnerId?: string | null;
      mandateEnd?: string;
    },
  ): Promise<void>;
  validateDocument(
    ctx: Ctx,
    input: { circleId: string; documentId: string },
  ): Promise<void>;
  /** True while the installed model is OPERATING and routes structure/agreement changes through governance. */
  governedChanges(ctx: Ctx): Promise<boolean>;
  validateChanges(
    ctx: Ctx,
    input: { circleId: string; changes: any[] },
  ): Promise<void>;
}

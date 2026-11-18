export const roleFunctions = [
  "GUIDE",
  "REPRESENTATIVE",
  "FACILITATOR",
  "SCRIBE",
] as const;
export type RoleFunction = (typeof roleFunctions)[number];
export const functionLabels: Record<RoleFunction, string> = {
  GUIDE: "Guia",
  REPRESENTATIVE: "Representante",
  FACILITATOR: "Facilitador",
  SCRIBE: "Escriba",
};
export type EssentialDefinition={purpose:string;responsibilities:string[];artifacts:string[]};
export type EssentialDefinitions=Record<RoleFunction,EssentialDefinition>;
export type ModelRules = {
  membership: "OCCUPANCY" | "LEGACY";
  assignment: "GUIDE" | "LEGACY";
  guideSelection: "PARENT_GUIDE" | "LEGACY";
  structureChanges: "GOVERNANCE" | "LEGACY";
  essentialFunctions: RoleFunction[];
  electedFunctions: RoleFunction[];
  protectEssentials: boolean;
  enforceEligibility: boolean;
  essentialDefinitions: EssentialDefinitions;
};
export type ModelOverrides = Partial<Omit<ModelRules,"essentialDefinitions">> & {essentialDefinitions?:Partial<Record<RoleFunction,Partial<EssentialDefinition>>>};
export type PackageManifest = {
  id: string;
  name: string;
  version: string;
  reference: { url: string; revision: string; accessedAt: string };
  capabilities: string[];
};
export type CircleConfiguration = {
  circleId: string;
  selfAssignment: boolean;
  version: number;
  canConfigure: boolean;
  memberIds: string[];
};
export type FunctionBinding = {
  roleId: string;
  functionCode: RoleFunction | null;
  version: number;
};
export type ModelView = {
  installed: boolean;
  package: PackageManifest;
  canManage: boolean;
  revision?: number;
  phase?: "PREPARATION" | "OPERATING";
  startedAt?: string | null;
  overrides?: ModelOverrides;
  rules?: ModelRules;
  circles?: CircleConfiguration[];
  bindings?: FunctionBinding[];
  essentialDefinitionDefaults?: EssentialDefinitions;
};
export type Occupancy = {
  id: string;
  source: "OCCUPANCY" | "MANDATE";
  memberId: string;
  startsAt: string;
  endsAt: string | null;
  version: number;
  canEnd: boolean;
  exitAgreement?: string | null;
  exitNotBefore?: string | null;
  endedAt?: string | null;
  origin?: string | null;
};
export type RoleView = {
  roleId: string;
  functionCode: RoleFunction | null;
  canAssign: boolean;
  canAssignOthers: boolean;
  canSelfAssign: boolean;
  canLeave: boolean;
  occupancies: Occupancy[];
  members: { id: string; displayName: string }[];
};

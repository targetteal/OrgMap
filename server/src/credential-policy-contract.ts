/** Native OrgMap policy vocabulary; not an imported provider schema. */
export interface CredentialPolicy {
  policyId: string;
  revision: number;
  complexity: boolean;
  strength: "LOW" | "MEDIUM" | "HIGH";
  expirationDays: null | 30 | 90 | 180 | 365;
  mfaEnforced: boolean;
}
export type PasswordRequirementReason =
  "PASSWORD_COMPLEXITY_REQUIRED" | "PASSWORD_STRENGTH_REQUIRED";
export interface PasswordEvaluation {
  evaluatorVersion: string;
  passed: boolean;
  reasons: PasswordRequirementReason[];
}

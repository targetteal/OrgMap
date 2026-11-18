export type UUID = string;
export type OrgRole = "OWNER" | "MEMBER";
export interface Meta {
  requestId: string;
  organizationId: string | null;
  resourceVersion: number | null;
  authorizationRevision: number | null;
  asOf: string;
}
export interface Envelope<T> {
  data: T;
  meta: Meta;
  capabilities: Record<string, boolean>;
}
export interface ApiError {
  error: {
    code: string;
    message: string;
    fieldErrors: unknown[];
    retryable: boolean;
    conflictDetails: unknown;
  };
  meta: { requestId: string };
}
export interface StructureNode {
  nodeId: UUID;
  entityId: UUID;
  kind: "CIRCLE" | "ROLE";
  parentNodeId: UUID | null;
  name: string;
  version: number;
}
export interface Account {
  id: UUID;
  email: string;
  displayName: string;
}

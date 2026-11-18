import { fail, id, text } from "../../src/core.js";
import { normalizePurposeChange } from "../structure/purpose.js";
import { normalizeDefinitionChange, type DefinitionItem } from "../structure/definition.js";
import type { RichDocument } from "../../../packages/content/index.js";
export type Policy = {
  draftAccess?: "AUTHOR_ONLY" | "AUTHOR_AND_LEAD_LINKS" | "CIRCLE_MEMBERS";
  decisionProcess?: "STANDARD" | "HOLACRACY_O2";
  method: "MANUAL_FACILITATED" | "CONSENT_ROUND" | "CONSENT_WINDOW";
  quorumPercent: number;
  responseRequirement: "QUORUM" | "ALL";
  reviewDurationHours: number;
  allowRevote: boolean;
  allowAbstain: boolean;
  workflowSteps: string[];
};
export const defaultPolicy: Policy = {
  draftAccess: "AUTHOR_ONLY",
  decisionProcess: "STANDARD",
  method: "MANUAL_FACILITATED",
  quorumPercent: 100,
  responseRequirement: "QUORUM",
  reviewDurationHours: 168,
  allowRevote: false,
  allowAbstain: true,
  workflowSteps: ["PRESENT", "CLARIFY", "REACT", "OBJECT", "DECIDE"],
};
/** Initial local draft policy: author-only; OWNER facilitates election nominations. Submitted history stays visible in its perimeter. */
export function draftIsHidden(row: any, memberId: string, owner: boolean) {
  return (
    row.state === "DRAFT" &&
    !row.first_submitted_at &&
    row.author_id !== memberId &&
    !(row.kind === "ELECTION" && owner)
  );
}
export function policy(value: unknown): Policy {
  const p = value as Policy;
  if (
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    Object.keys(p).some((k) => !Object.keys(defaultPolicy).includes(k))
  )
    fail(400, "INVALID_REQUEST");
  if (
    !["MANUAL_FACILITATED", "CONSENT_ROUND", "CONSENT_WINDOW"].includes(
      p.method,
    ) ||
    !Number.isInteger(p.quorumPercent) ||
    p.quorumPercent < 1 ||
    p.quorumPercent > 100 ||
    !["QUORUM", "ALL"].includes(p.responseRequirement) ||
    !Number.isFinite(p.reviewDurationHours) ||
    p.reviewDurationHours <= 0 ||
    p.reviewDurationHours > 8760 ||
    typeof p.allowRevote !== "boolean" ||
    typeof p.allowAbstain !== "boolean" ||
    (p.decisionProcess !== undefined && !["STANDARD", "HOLACRACY_O2"].includes(p.decisionProcess)) ||
    (p.draftAccess !== undefined && !["AUTHOR_ONLY","AUTHOR_AND_LEAD_LINKS","CIRCLE_MEMBERS"].includes(p.draftAccess)) ||
    !Array.isArray(p.workflowSteps) ||
    p.workflowSteps.length < 1 ||
    p.workflowSteps.length > 20 ||
    new Set(p.workflowSteps).size !== p.workflowSteps.length ||
    p.workflowSteps.some(
      (s) => typeof s !== "string" || !s.trim() || s.length > 50,
    )
  )
    fail(422, "DOMAIN_INVARIANT");
  return structuredClone({...p,draftAccess:p.draftAccess ?? "AUTHOR_ONLY",decisionProcess:p.decisionProcess ?? "STANDARD"});
}
export type Change =
  | {
      kind: "FIELD";
      entityId: string;
      fieldId: string;
      baseVersion: number;
      value: string | number | boolean | null | string[];
    }
  | {
      kind: "UPDATE";
      entityId: string;
      baseVersion: number;
      name?: string;
      purpose?: string;
      purposeRich?: RichDocument | null;
      responsibilities?: DefinitionItem[];
      artifacts?: DefinitionItem[];
    }
  | {
      kind: "MOVE";
      entityId: string;
      baseVersion: number;
      parentCircleId: string;
    }
  | { kind: "ARCHIVE" | "RESTORE"; entityId: string; baseVersion: number }
  | {
      kind: "CREATE";
      entityId: string;
      entityKind: "CIRCLE" | "ROLE";
      parentCircleId: string;
      name: string;
      purpose: string;
      purposeRich?: RichDocument | null;
      responsibilities?: DefinitionItem[];
      artifacts?: DefinitionItem[];
    };
export type DocumentPart =
  | {
      documentId: string;
      documentVersion: number;
      documentAction?: undefined;
      documentBaseVersion?: undefined;
    }
  | {
      documentId: string;
      documentVersion: number;
      documentAction: "ARCHIVE";
      documentBaseVersion: number;
    };
export function changes(value: unknown): Change[] {
  if (!Array.isArray(value) || value.length > 100 || value.length < 1)
    fail(400, "INVALID_REQUEST");
  const parsed = (value as any[]).map((v: any) => {
    if (!v || typeof v !== "object") fail(400, "INVALID_REQUEST");
    const keys: Record<string, string[]> = {
      FIELD: ["kind", "entityId", "fieldId", "baseVersion", "value"],
      UPDATE: ["kind", "entityId", "baseVersion", "name", "purpose", "purposeRich", "responsibilities", "artifacts"],
      MOVE: ["kind", "entityId", "baseVersion", "parentCircleId"],
      ARCHIVE: ["kind", "entityId", "baseVersion"],
      RESTORE: ["kind", "entityId", "baseVersion"],
      CREATE: [
        "kind",
        "entityId",
        "entityKind",
        "parentCircleId",
        "name",
        "purpose",
        "purposeRich",
        "responsibilities",
        "artifacts",
      ],
    };
    if (!keys[v.kind] || Object.keys(v).some((k) => !keys[v.kind].includes(k)))
      fail(400, "INVALID_REQUEST");
    id(v.entityId);
    if (v.kind === "CREATE") {
      if (!["CIRCLE", "ROLE"].includes(v.entityKind))
        fail(400, "INVALID_REQUEST");
      id(v.parentCircleId);
      text(v.name);
      const purpose=normalizePurposeChange(v);
      if (!purpose) fail(400, "INVALID_REQUEST");
      v={...v,...purpose,...normalizeDefinitionChange(v)};
    } else {
      if (
        !Number.isInteger(v.baseVersion) ||
        v.baseVersion < (v.kind === "FIELD" ? 0 : 1)
      )
        fail(400, "INVALID_REQUEST");
      if (v.kind === "FIELD") {
        id(v.fieldId);
        if (!(
          v.value === null ||
          (typeof v.value === "string" && v.value.length <= 10000) ||
          (typeof v.value === "number" && Number.isFinite(v.value)) ||
          typeof v.value === "boolean" ||
          (Array.isArray(v.value) &&
            v.value.length <= 100 &&
            v.value.every(
              (x: unknown) => typeof x === "string" && x.length <= 1000,
            ))
        ))
          fail(400, "INVALID_REQUEST");
      }
      if (v.kind === "MOVE") id(v.parentCircleId);
      if (v.kind === "UPDATE") {
        if (v.name === undefined && v.purpose === undefined && v.purposeRich === undefined && v.responsibilities === undefined && v.artifacts === undefined)
          fail(400, "INVALID_REQUEST");
        if (v.name !== undefined) text(v.name);
        const purpose=normalizePurposeChange(v);
        if(purpose) v={...v,...purpose};
        v={...v,...normalizeDefinitionChange(v)};
      }
    }
    return structuredClone(v) as Change;
  });
  const structural = new Map<string, Change>();
  const paired = new Set<string>();
  const fields = new Set<string>();
  for (const item of parsed) {
    if (item.kind === "FIELD") {
      const key = item.entityId + ":" + item.fieldId;
      if (fields.has(key)) fail(422, "DUPLICATE_ENTITY_CHANGE");
      fields.add(key); continue;
    }
    const previous = structural.get(item.entityId);
    if (previous) {
      if (paired.has(item.entityId)) fail(422, "DUPLICATE_ENTITY_CHANGE");
      if (!((previous.kind === "UPDATE" && item.kind === "MOVE") || (previous.kind === "MOVE" && item.kind === "UPDATE"))) fail(422, "DUPLICATE_ENTITY_CHANGE");
      if ((previous as {baseVersion:number}).baseVersion !== (item as {baseVersion:number}).baseVersion) fail(409, "VERSION_CONFLICT");
      paired.add(item.entityId);
    } else structural.set(item.entityId, item);
  }
  return parsed;
}
export function mayVote(round: any, memberId: string, now: Date) {
  if (round.state !== "OPEN") fail(409, "STATE_CONFLICT");
  if (!round.electorate.includes(memberId)) fail(403, "ACTION_DENIED");
  if (round.deadline && now.getTime() >= new Date(round.deadline).getTime())
    fail(409, "ROUND_DEADLINE_PASSED");
}
export function verdict(
  round: any,
  participation: number,
  openObjections: number,
  now: Date,
): "ADOPT" | "REVIEW_REQUIRED" {
  if(!Array.isArray(round.electorate)||round.electorate.length===0)fail(422,'EMPTY_ELECTORATE');
  const p = policy(round.policy);
  if (round.state !== "OPEN") fail(409, "STATE_CONFLICT");
  if (
    p.method === "CONSENT_WINDOW" &&
    now.getTime() < new Date(round.deadline).getTime()
  )
    fail(409, "REVIEW_WINDOW_OPEN");
  const threshold =
    p.responseRequirement === "ALL"
      ? round.electorate.length
      : Math.ceil((round.electorate.length * p.quorumPercent) / 100);
  return participation >= threshold && openObjections === 0
    ? "ADOPT"
    : "REVIEW_REQUIRED";
}

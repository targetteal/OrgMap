import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import {
  randomUUID,
  randomBytes,
  createHash,
  scrypt as scryptCb,
} from "node:crypto";
import { promisify } from "node:util";
export const scrypt = promisify(scryptCb);
export const uuid = () => randomUUID();
export const secret = () => randomBytes(32).toString("hex");
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export const fail = (s: number, c: string): never => {
  throw new Failure(s, c);
};
export function text(v: unknown, max = 200) {
  if (typeof v !== "string" || !v.trim() || [...v.trim()].length > max)
    fail(400, "INVALID_REQUEST");
  return (v as string).trim();
}
export function optionalText(v: unknown, max = 10000) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || [...v].length > max)
    fail(400, "INVALID_REQUEST");
  return v as string;
}
export function id(v: unknown) {
  const s = text(v);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  )
    fail(400, "INVALID_REQUEST");
  return s;
}
export function body(r: FastifyRequest, keys: string[]): Record<string, any> {
  const b = r.body as Record<string, any>;
  if (
    !b ||
    typeof b !== "object" ||
    Array.isArray(b) ||
    Object.keys(b).some((k) => !keys.includes(k))
  )
    fail(400, "INVALID_REQUEST");
  return b as Record<string, any>;
}
export function version(r: FastifyRequest, v: number) {
  const h = r.headers["if-match"];
  if (!h) fail(428, "PRECONDITION_REQUIRED");
  if (h !== `"${v}"`) fail(409, "VERSION_CONFLICT");
}
export function key(r: FastifyRequest) {
  if (!r.headers["idempotency-key"]) fail(428, "PRECONDITION_REQUIRED");
  return text(r.headers["idempotency-key"], 200);
}
export const camel = (row: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, x) => x.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  );
export function entity(row: any) {
  const x = camel(row);
  return {
    ...x,
    parentCircleId: x.parentId,
    ...(x.kind === "ROLE" ? { circleId: x.parentId } : {}),
  };
}
export async function event(
  c: PoolClient,
  org: string,
  actor: string,
  resource: string,
  action: string,
  request: string,
) {
  const eid = uuid();
  await c.query("INSERT INTO audit_events VALUES($1,$2,$3,$4,$5,now(),$6)", [
    org,
    uuid(),
    actor,
    resource,
    action,
    request,
  ]);
  await c.query("INSERT INTO domain_events VALUES($1,$2,$3,$4,now())", [
    org,
    eid,
    action,
    resource,
  ]);
  await c.query(
    "INSERT INTO outbox(organization_id,id,event_id) VALUES($1,$2,$3)",
    [org, uuid(), eid],
  );
}

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export function commandHash(r: FastifyRequest) {
  return digest(
    JSON.stringify(
      canonical({
        method: r.method,
        path: r.url.split("?")[0],
        version: r.headers["if-match"] ?? null,
        body: r.body ?? null,
      }),
    ),
  );
}

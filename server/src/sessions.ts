import type { PoolClient } from "pg";
import { digest, fail, secret } from "./core.js";
import type { SessionProvenance } from "./enrollment-contract.js";
export async function createSessionRecord(
  c: PoolClient,
  accountId: string,
  provenance: SessionProvenance,
  supplied?: { token: string; csrf: string },
) {
  const result = supplied ?? { token: secret(), csrf: secret() };
  const modern = (
    await c.query(
      "SELECT 1 FROM pg_attribute WHERE attrelid='sessions'::regclass AND attname='auth_method' AND NOT attisdropped",
    )
  ).rowCount;
  if (!modern) {
    if (provenance.method === "FEDERATED")
      fail(503, "SESSION_PROVENANCE_UNAVAILABLE");
    await c.query(
      "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '7 days')",
      [digest(result.token), accountId, result.csrf],
    );
    return result;
  }
  if (
    provenance.method === "FEDERATED" &&
    (!provenance.organizationId ||
      !provenance.connectionId ||
      !provenance.issuer ||
      !provenance.subject ||
      !provenance.verifiedAt ||
      !Number.isFinite(provenance.verifiedAt.getTime()))
  )
    fail(401, "UNAUTHENTICATED");
  if (provenance.method === "FEDERATED") {
    // Serialize with lifecycle cut without acquiring Org after Account.
    const account = (await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[accountId])).rows[0];
    if (!account) fail(401,"UNAUTHENTICATED");
    const lifecycle = (await c.query("SELECT state FROM organization_lifecycle WHERE organization_id=$1",[provenance.organizationId])).rows[0];
    if (!lifecycle || lifecycle.state !== "ACTIVE") fail(401,"UNAUTHENTICATED");
  }
  // Freshness is checked against PostgreSQL's clock. Keep earlier proof times
  // and prevent a fast application clock from persisting a future timestamp.
  await c.query(
    "INSERT INTO sessions(token_hash,account_id,csrf,expires_at,auth_method,auth_organization_id,auth_connection_id,auth_issuer,auth_subject,auth_verified_at) VALUES($1,$2,$3,clock_timestamp()+interval '7 days',$4,$5,$6,$7,$8,LEAST($9::timestamptz,clock_timestamp()))",
    [
      digest(result.token),
      accountId,
      result.csrf,
      provenance.method,
      provenance.organizationId ?? null,
      provenance.connectionId ?? null,
      provenance.issuer ?? null,
      provenance.subject ?? null,
      provenance.verifiedAt ?? null,
    ],
  );
  const hasAmr = (
    await c.query(
      "SELECT 1 FROM pg_attribute WHERE attrelid='sessions'::regclass AND attname='auth_amr' AND NOT attisdropped",
    )
  ).rowCount;
  if (hasAmr) {
    const amr = provenance.amr ?? [];
    if (
      !Array.isArray(amr) ||
      amr.length > 32 ||
      amr.some((v) => typeof v !== "string" || !v || v.length > 100) ||
      (provenance.authTime &&
        (!Number.isFinite(provenance.authTime.getTime()) ||
          +provenance.authTime > Date.now() + 5000))
    )
      fail(401, "UNAUTHENTICATED");
    await c.query(
      "UPDATE sessions SET auth_amr=$3,auth_time=$4 WHERE token_hash=$1 AND account_id=$2",
      [
        digest(result.token),
        accountId,
        JSON.stringify(amr),
        provenance.authTime ?? null,
      ],
    );
  } else if (provenance.amr?.length || provenance.authTime)
    fail(503, "SESSION_PROVENANCE_UNAVAILABLE");
  return result;
}

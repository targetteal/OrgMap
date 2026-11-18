import type { PoolClient } from "pg";
import { FilesystemBlobStore } from "./blob.js";

/** Operator-only metadata. Never expose this port through a tenant HTTP route. */
export type PlatformBackupReference = {
  organizationId: string;
  id: string;
  kind: "FILE" | "ARTIFACT";
  key: string;
  sha256: string;
  size: number;
};

/**
 * Caller owns an open REPEATABLE READ (or SERIALIZABLE), READ ONLY transaction
 * on the same snapshot used for its database dump. Requires a table-owning or
 * BYPASSRLS operator connection, so a tenant-filtered manifest cannot look complete.
 * Keep the snapshot open and suspend external GC until all referenced bytes are copied.
 */
export async function listPlatformBackupReferences(
  client: Pick<PoolClient, "query">,
): Promise<PlatformBackupReference[]> {
  const state = (
    await client.query(`SELECT
    current_setting('transaction_isolation') AS isolation,
    current_setting('transaction_read_only') AS read_only,
    (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user)
      OR (SELECT bool_and(pg_has_role(current_user,c.relowner,'USAGE'))
          FROM pg_class c WHERE c.oid IN ('platform_files'::regclass,'platform_artifacts'::regclass)) AS operator
  `)
  ).rows[0];
  if (
    !["repeatable read", "serializable"].includes(state.isolation) ||
    state.read_only !== "on"
  )
    throw Error("PLATFORM_BACKUP_SNAPSHOT_REQUIRED");
  if (state.operator !== true) throw Error("PLATFORM_BACKUP_OPERATOR_REQUIRED");
  const result = await client.query(`
    SELECT organization_id AS "organizationId",id,'FILE'::text AS kind,blob_key AS key,sha256,size
    FROM platform_files
    UNION ALL
    SELECT organization_id AS "organizationId",id,'ARTIFACT'::text AS kind,blob_key AS key,sha256,size
    FROM platform_artifacts
    ORDER BY "organizationId",kind,id
  `);
  return result.rows as PlatformBackupReference[];
}

/** Existing keys are read-only through this port. Both digest and recorded byte length must agree. */
export async function readPlatformBackupBlob(
  store: FilesystemBlobStore,
  reference: PlatformBackupReference,
): Promise<Buffer> {
  if (
    !/^[0-9a-f]{64}$/.test(reference.sha256) ||
    !Number.isSafeInteger(reference.size) ||
    reference.size < 0
  )
    throw Error("INVALID_PLATFORM_BACKUP_REFERENCE");
  const bytes = await store.read(reference.key, reference.sha256);
  if (bytes.length !== reference.size)
    throw Error("PLATFORM_BACKUP_SIZE_MISMATCH");
  return bytes;
}

/** Global IAM refs, inventoried by the operator on the same locked snapshot. */
export async function listAccountMediaBackupReferences(client: Pick<PoolClient, "query">): Promise<import("../../src/account-media-contract.js").AccountMediaBackupReference[]> {
  const state=(await client.query(`SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only,(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS operator`)).rows[0];
  if(!['repeatable read','serializable'].includes(state.isolation)||state.read_only!=='on') throw Error('ACCOUNT_BACKUP_SNAPSHOT_REQUIRED');
  if(state.operator!==true) throw Error('ACCOUNT_BACKUP_OPERATOR_REQUIRED');
  const exists=(await client.query("SELECT to_regclass('public.account_media') AS name")).rows[0]?.name;
  if(!exists) return [];
  const rows=(await client.query("SELECT account_id,kind,asset_id,storage_namespace,blob_key,sha256,size FROM account_media WHERE state='ACTIVE' ORDER BY account_id,kind")).rows;
  return rows.map(r=>({owner:'ACCOUNT',accountId:r.account_id,storageNamespace:r.storage_namespace,kind:r.kind,assetId:r.asset_id,key:r.blob_key,sha256:r.sha256,size:r.size}));
}

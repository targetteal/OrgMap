import type { Pool, PoolClient } from 'pg';
import { assertManagedWriter } from '../src/managed-writer.js';
import { inspectDeletionRegistry, registeredDeletionParticipants } from '../src/organization-deletion-registry.js';
import { assertJoinedHostStorageBinding } from './organization-storage-binding.js';
import type { OrganizationLedger } from './organization-ledger.js';

async function endpoint(c:PoolClient) {
 const r=(await c.query("SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port")).rows[0];
 if(typeof r?.name!=='string'||typeof r.host!=='string'||(r.port!==null&&typeof r.port!=='number'))throw Error('DELETION_READINESS_ENDPOINT_INVALID');
 return JSON.stringify([r.name,r.host,r.port]);
}

/** Point-in-time pre-cut check, not a stopped-host receipt or future guarantee.
 * This process must have joined as a managed writer before invoking it. */
export function createOrganizationDeletionReadiness(input:{ledger:OrganizationLedger;application:Pool;acceptance:Pool}):()=>Promise<void> {
 return async()=>{
  const registry=inspectDeletionRegistry();
  if(registry.missing.length||registeredDeletionParticipants().length!==9)throw Error('DELETION_REGISTRY_INCOMPLETE');
  const app=await input.application.connect();
  try {
   await assertManagedWriter(app);
   await assertJoinedHostStorageBinding(input.ledger,app);
   const privateClient=await input.acceptance.connect();
   try {
    if(await endpoint(app)!==await endpoint(privateClient))throw Error('DELETION_READINESS_DATABASE_MISMATCH');
    await privateClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
     await privateClient.query('SELECT pg_advisory_xact_lock(730184)');
     const ready=(await privateClient.query('SELECT public.orgmap_deletion_preflight_schema_ready() AS ready')).rows[0]?.ready;
     if(ready!==true)throw Error('DELETION_SCHEMA_ATTESTATION_REQUIRED');
     await assertManagedWriter(app);
     await assertJoinedHostStorageBinding(input.ledger,app);
     await privateClient.query('COMMIT');
    } catch(error) {await privateClient.query('ROLLBACK').catch(()=>{});throw error;}
   } finally {privateClient.release();}
  } finally {app.release();}
 };
}

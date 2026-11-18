import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { OrganizationLedger } from '../ops/organization-ledger.js';
import { joinOrganizationHostLease } from '../ops/organization-host-lease.js';
import { assertJoinedHostStorageBinding } from '../ops/organization-storage-binding.js';

type Client = Pick<PoolClient, 'query'>;
type Binding = { authority_id: string; instance_id: string; epoch: string; database: string; host: string; port: number | null };
type Registration = { binding: Binding; active: boolean; pid: number; ledger: OrganizationLedger; assertRegistered: () => Promise<void> };
let registration: Registration | null = null;

async function databaseBinding(c: Client): Promise<Binding | null> {
 const mode=(await c.query("SELECT to_regclass('public.organization_runtime_mode') AS name")).rows[0]?.name;
 if(!mode) {
  const identityTable=(await c.query("SELECT to_regclass('public.organization_runtime_identity') AS name")).rows[0]?.name;
  if(identityTable && (await c.query('SELECT 1 FROM organization_runtime_identity WHERE singleton=true')).rowCount)throw Error('HOST_DATABASE_BINDING_MISMATCH');
  return null;
 }
 const managed=(await c.query('SELECT managed FROM organization_runtime_mode WHERE singleton=true')).rows[0]?.managed;
 if(typeof managed!=='boolean') throw Error('HOST_RUNTIME_MODE_INVALID');
 const identityTable=(await c.query("SELECT to_regclass('public.organization_runtime_identity') AS name")).rows[0]?.name;
 const row=identityTable && (await c.query('SELECT authority_id,instance_id,epoch::text AS epoch FROM organization_runtime_identity WHERE singleton=true')).rows[0];
 if(!managed){if(row)throw Error('HOST_DATABASE_BINDING_MISMATCH');return null;}
 if(!row || typeof row.authority_id!=='string' || typeof row.instance_id!=='string' || typeof row.epoch!=='string')throw Error('HOST_DATABASE_BINDING_MISMATCH');
 const target=(await c.query("SELECT current_database() AS database,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port")).rows[0];
 if(typeof target?.database!=='string' || typeof target.host!=='string' || (target.port!==null && typeof target.port!=='number'))throw Error('HOST_DATABASE_BINDING_MISMATCH');
 return {authority_id:row.authority_id,instance_id:row.instance_id,epoch:row.epoch,database:target.database,host:target.host,port:target.port};
}

/** Check at each write/I/O boundary using the connection for the target DB.
 * A process-local registration is required; an environment token is not one.
 * Callers must drain in-flight operations before releasing the registration. */
export async function assertManagedWriter(c: Client): Promise<void> {
 const binding=await databaseBinding(c);
 if(!binding)return;
 const current=registration;
 if(!current?.active || current.pid!==process.pid || current.binding.authority_id!==binding.authority_id ||
    current.binding.instance_id!==binding.instance_id || current.binding.epoch!==binding.epoch ||
    current.binding.database!==binding.database || current.binding.host!==binding.host || current.binding.port!==binding.port)
  throw Error('HOST_WRITER_REGISTRATION_REQUIRED');
 await current.assertRegistered();
 await assertJoinedHostStorageBinding(current.ledger,c);
 if(!current.active || registration!==current)throw Error('HOST_WRITER_REGISTRATION_REQUIRED');
}

/** Explicitly join before managed work. A no-ledger legacy DB remains unmanaged. */
export async function enterManagedWriter(options: {ledger?: OrganizationLedger; token?: string; client?: Client} = {}) {
 if(registration?.active)throw Error('HOST_WRITER_ALREADY_REGISTERED');
 const directory=process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY;
 const token=options.token ?? process.env.ORGMAP_HOST_LEASE_TOKEN;
 const borrowed=options.client ? null : await pool.connect(), c=options.client ?? borrowed!;
 try {
  const ledger=options.ledger ?? (directory ? await OrganizationLedger.open(directory) : null);
  if(!ledger){if(token)throw Error('LIFECYCLE_LEDGER_REQUIRED');if(await databaseBinding(c))throw Error('LIFECYCLE_LEDGER_REQUIRED');return null;}
  if(!token)throw Error('HOST_WRITER_TOKEN_REQUIRED');
  const joined=await joinOrganizationHostLease(ledger,token,c);
  try {
   await assertJoinedHostStorageBinding(ledger,c);
   const binding=await databaseBinding(c);
   if(!binding || binding.authority_id!==ledger.authorityId)throw Error('HOST_DATABASE_BINDING_MISMATCH');
   // Check again after await: concurrent join attempts must not leave two live
   // registrations with one capability reference.
   if(registration?.active)throw Error('HOST_WRITER_ALREADY_REGISTERED');
   const current: Registration={binding,active:true,pid:process.pid,ledger,assertRegistered:joined.assertRegistered}; registration=current;
   return {async release(){if(!current.active)return;current.active=false;if(registration===current)registration=null;await joined.release();}};
  } catch(error) {await joined.release();throw error;}
 } finally {borrowed?.release();}
}

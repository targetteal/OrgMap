import type { Pool } from 'pg';
import { transaction } from './db.js';
import { assertManagedWriter } from './managed-writer.js';
/** Dedicated discovery credentials cannot read runtime identity. Check the
 * capability on the app connection, and bind it to the discovery connection's
 * actual database/server before every privileged metadata operation. */
export async function assertManagedDispatchTarget(dispatch: Pool): Promise<void> {
 const query="SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port";
 const target=(await dispatch.query(query)).rows[0];
 await transaction(async c=>{
  await assertManagedWriter(c);
  const current=(await c.query(query)).rows[0];
  if(!target||!current||target.name!==current.name||target.host!==current.host||target.port!==current.port) throw Error('HOST_DISPATCH_DATABASE_MISMATCH');
 });
}

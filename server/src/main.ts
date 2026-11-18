import { loadIntegrationOptions } from "../integration/config.js";
import { createOrgMapIntegration } from "../integration/index.js";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { OrganizationLedger } from "../ops/organization-ledger.js";
import { acquireOrganizationHostLease, assertHostDatabaseBinding } from "../ops/organization-host-lease.js";
import { enterManagedWriter } from "./managed-writer.js";
import { configureOrganizationDeletionHttp } from "../ops/organization-deletion-http-configuration.js";
const directory=process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY;
let ownerLease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined;
let registration:{release():Promise<void>}|null|undefined;
let app:Awaited<ReturnType<typeof buildApp>>|undefined;
let deletionHttp:Awaited<ReturnType<typeof configureOrganizationDeletionHttp>>;
try {
  if(directory && process.env.ORGMAP_HOST_LEASE_TOKEN) registration=await enterManagedWriter();
  else if(directory){const ledger=await OrganizationLedger.open(directory);ownerLease=await acquireOrganizationHostLease(ledger);const client=await pool.connect();try{await assertHostDatabaseBinding(ledger,ownerLease,client);registration=await enterManagedWriter({ledger,token:ownerLease.token,client});}finally{client.release();}}
  else registration=await enterManagedWriter();
  deletionHttp=await configureOrganizationDeletionHttp(pool);
  app=await buildApp([createOrgMapIntegration(await loadIntegrationOptions())],{migrationMaxPrefix:999,organizationDeletion:deletionHttp?.options});
  await app.listen({host:process.env.ORGMAP_HTTP_HOST??"127.0.0.1",port:Number(process.env.PORT??3001)});
} catch(error) {await app?.close();await deletionHttp?.close();await pool.end();await registration?.release();await ownerLease?.release();throw error;}
let closing:Promise<void>|undefined;
function close() { return closing??=(async()=>{await app?.close();await deletionHttp?.close();await pool.end();await registration?.release();await ownerLease?.release();})(); }
for(const signal of ["SIGINT","SIGTERM"] as const) process.on(signal,()=>{void close().then(()=>process.exit(0),()=>process.exit(1));});

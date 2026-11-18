/** Disposable crash-probe child. Never a server entry point. */
import { buildApp } from '../../server/src/app.js';
import { createBrandingServices } from '../../server/modules/administration/branding.js';
import { createBrandingDecoder,createBrandingStorage } from '../../server/modules/administration/branding-image.js';
import { lockActiveOrganization } from '../../server/src/organization-lifecycle.js';
import { enterManagedWriter } from '../../server/src/managed-writer.js';
const database=new URL(process.env.DATABASE_URL??'postgres://invalid/main').pathname;
if(!process.send||!/^\/orgmap_(?:integration|fresh)_[a-f0-9]{32}$/.test(database))throw Error('EXCLUSIVE_CRASH_PROBE_REQUIRED');
process.once('message',async(message:any)=>{
  try{
    if(database.startsWith('/orgmap_fresh_')){
      if(!process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY||!process.env.ORGMAP_HOST_LEASE_TOKEN)throw Error('MANAGED_CRASH_PROBE_REQUIRED');
      await enterManagedWriter(); // Deliberately left registered by SIGKILL.
    }
    const storage=createBrandingStorage(message.root),put=storage.store.putReserved.bind(storage.store);
    storage.store.putReserved=async(key,bytes)=>{
      const result=await put(key,bytes);
      process.send!({state:'BYTES_WRITTEN',key});
      // The parent kills this writer at a deterministic durable-I/O boundary.
      await new Promise<void>(()=>{});return result;
    };
    const svc=createBrandingServices({authorize:async ctx=>ctx.member.org_role==='OWNER',decoder:createBrandingDecoder(),storage,lifecycle:{assertTenantReadable:async ctx=>{await lockActiveOrganization(ctx.c,ctx.org.id);},assertTenantWritable:async ctx=>{await lockActiveOrganization(ctx.c,ctx.org.id);},assertPublicReadable:async(c,org)=>{await lockActiveOrganization(c,org);}}});
    const app=await buildApp([async(app,core)=>svc.register(app,core)],{migrationScope:'foundation'});
    const result=await app.inject(message.request);
    process.send!({state:'UNEXPECTED_RESPONSE',statusCode:result.statusCode});
    await app.close();process.exitCode=1;
  }catch{process.send!({state:'PROBE_FAILED'});process.exitCode=1;}
});

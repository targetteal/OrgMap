import { createHash } from "node:crypto";
import { hostname } from "node:os";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { pool, transaction } from "../../src/db.js";
import { body, commandHash, fail, id, key, uuid, version } from "../../src/core.js";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { BRANDING_INPUT_BYTES, BRANDING_EMAIL_OUTPUT_BYTES, BRANDING_PURPOSES, type BrandingDecoder, type BrandingPurpose, type BrandingStorage } from "./branding-image.js";
import type { BrandingLifecycleGate, BrandingBackupReference } from "./branding-contract.js";
import { BRANDING_MULTIPART_LIMIT, parseBrandingMultipart } from "./branding-upload.js";

/** Shared with any future GC/backup runner. OPS must acquire session lock before its snapshot. */
export const BRANDING_GC_LOCK = 730409;
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const base = "/api/v1/organizations/:organizationId/administration/branding-assets";
const paths: Record<BrandingPurpose,string> = { WORKSPACE_LOGO:"workspace-logo", EMAIL_LOGO:"email-logo", LOGIN_BACKGROUND:"login-background" };
function purposeOf(r: FastifyRequest): BrandingPurpose {
  const value = (r.params as any).purpose;
  const p = BRANDING_PURPOSES.find(x => paths[x] === value);
  if (!p) fail(404,"RESOURCE_NOT_FOUND");
  return p!;
}
function input(r: FastifyRequest, purpose: BrandingPurpose) {
  const b = body(r, ["base64", "publish"]);
  if (purpose === "LOGIN_BACKGROUND" ? b.publish !== true : b.publish !== undefined) fail(400,"BRANDING_PUBLICATION_REQUIRED");
  if (typeof b.base64 !== "string" || !b.base64.length || b.base64.length > 4*Math.ceil(BRANDING_INPUT_BYTES/3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.base64)) fail(400,"INVALID_IMAGE_INPUT");
  const data = Buffer.from(b.base64,"base64");
  if (!data.length || data.length > BRANDING_INPUT_BYTES || data.toString("base64") !== b.base64) fail(413,"BRANDING_IMAGE_SIZE_LIMIT");
  return data;
}
function view(row: any, p: BrandingPurpose, org: string, legacy: string | null = null) {
  const active = row?.origin === "UPLOADED";
  return { purpose:p, revision:row?.revision ?? 0, origin:row?.origin ?? (p === "WORKSPACE_LOGO" && legacy ? "LEGACY_EXTERNAL" : "NONE"), state:active ? "READY" : "EMPTY", width:active ? row.width : null, height:active ? row.height : null, mime:active ? row.mime : null, updatedAt:row?.updated_at instanceof Date ? row.updated_at.toISOString() : row?.updated_at ?? null,
    readUrl:active && p === "WORKSPACE_LOGO" ? `/api/v1/organizations/${org}/branding/workspace-logo` : active && p === "LOGIN_BACKGROUND" ? `/api/v1/public/branding/${row.public_ref}` : null,
    legacyUrl:!row && p === "WORKSPACE_LOGO" ? legacy : null };
}
export type BrandingOptions = { authorize: (ctx: Ctx) => Promise<boolean>; lifecycle: BrandingLifecycleGate; decoder?: BrandingDecoder; storage?: BrandingStorage; appearance?: (ctx: Ctx) => Promise<{ color: string; colorTheme?: string; showOrganizationName: boolean }> };
export function createBrandingServices(options: BrandingOptions) {
  const { authorize, lifecycle } = options;
  function ready() { if (!options.storage || !options.decoder || typeof options.storage.store.putReserved!=='function') fail(503,"BRANDING_UNAVAILABLE"); return { storage:options.storage!, decoder:options.decoder! }; }
  async function row(c: PoolClient, org: string, p: BrandingPurpose) { return (await c.query("SELECT * FROM administration_branding_assets WHERE organization_id=$1 AND purpose=$2",[org,p])).rows[0]; }
  async function legacy(c: PoolClient, org: string) { const v=(await c.query("SELECT settings->'branding'->>'logoUrl' AS url FROM administration_settings WHERE organization_id=$1",[org])).rows[0]?.url; return typeof v === "string" && v ? v : null; }
  async function summary(ctx: Ctx) { const rows=(await ctx.c.query("SELECT * FROM administration_branding_assets WHERE organization_id=$1",[ctx.org.id])).rows; const url=await legacy(ctx.c,ctx.org.id); return BRANDING_PURPOSES.map(p=>view(rows.find(x=>x.purpose===p),p,ctx.org.id,url)); }
  async function bytes(c: PoolClient, asset: any) {
    if (!asset || asset.origin !== "UPLOADED") return null;
    const {storage}=ready(); await c.query("SELECT pg_advisory_xact_lock($1)",[BRANDING_GC_LOCK]);
    let data: Uint8Array; try { data=await storage.store.read({key:asset.blob_key,sha256:asset.sha256}); } catch { return fail(503,"BRANDING_READ_FAILED"); }
    if (data.byteLength !== asset.size || hash(data)!==asset.sha256) fail(503,"BRANDING_INTEGRITY_FAILED");
    return {bytes:data,mime:"image/png" as const,width:asset.width as number,height:asset.height as number};
  }
  async function queue(c: PoolClient, asset: any, reason: string) { await c.query("INSERT INTO administration_branding_gc(id,organization_id,purpose,blob_key,sha256,size,reason,available_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+($8 * interval '1 second')) ON CONFLICT(id) DO NOTHING",[asset.asset_id,asset.organization_id,asset.purpose,asset.blob_key,asset.sha256,asset.size,reason,reason==='UNPUBLISHED'?600:0]); }
  async function workspace(ctx: Ctx) { await lifecycle.assertTenantReadable(ctx); return view(await row(ctx.c,ctx.org.id,"WORKSPACE_LOGO"),"WORKSPACE_LOGO",ctx.org.id,await legacy(ctx.c,ctx.org.id)); }
  async function workspaceBytes(ctx: Ctx) { await lifecycle.assertTenantReadable(ctx); return bytes(ctx.c,await row(ctx.c,ctx.org.id,"WORKSPACE_LOGO")); }
  async function emailInline(ctx: Ctx) { await lifecycle.assertTenantReadable(ctx); const b=await bytes(ctx.c,await row(ctx.c,ctx.org.id,"EMAIL_LOGO")); return b ? {content:b.bytes,contentType:b.mime,cid:`orgmap-brand-${uuid()}@inline`} : null; }
  async function publicBackground(ref: string) { id(ref); return transaction(async c=> { const org=(await c.query("SELECT administration_branding_public_owner($1) AS id",[ref])).rows[0]?.id; if(!org) return null; await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[org]); await lifecycle.assertPublicReadable(c,org); const asset=await row(c,org,"LOGIN_BACKGROUND"); if(!asset || asset.public_ref!==ref) return null; return bytes(c,asset); }); }
  async function backupReferences(c: PoolClient, org: string): Promise<BrandingBackupReference[]> {
    await c.query('SELECT pg_advisory_xact_lock($1)',[BRANDING_GC_LOCK]);id(org);
    if((await c.query("SELECT 1 FROM administration_branding_stages WHERE organization_id=$1 AND state='WRITING' LIMIT 1",[org])).rowCount)fail(503,'BRANDING_STAGING_RECONCILIATION_REQUIRED');
    const refs=(await c.query("SELECT organization_id,purpose,asset_id,blob_key,sha256,size,'ACTIVE'::text AS state FROM administration_branding_assets WHERE organization_id=$1 AND origin='UPLOADED' UNION ALL SELECT organization_id,purpose,id AS asset_id,blob_key,sha256,size,'READY'::text AS state FROM administration_branding_stages WHERE organization_id=$1 AND state='READY'",[org])).rows;
    return refs.map(r=>({owner:'ORGANIZATION',state:r.state,organizationId:r.organization_id,storageNamespace:'ORG_BRANDING',purpose:r.purpose,assetId:r.asset_id,key:r.blob_key,sha256:r.sha256,size:r.size}));
  }
  async function retireAll(ctx: Ctx) { for (const p of BRANDING_PURPOSES) { const previous=await row(ctx.c,ctx.org.id,p); if(previous?.origin==='UPLOADED') await queue(ctx.c,previous,'DELETED'); await ctx.c.query("INSERT INTO administration_branding_assets(organization_id,purpose,revision,origin) VALUES($1,$2,1,'NONE') ON CONFLICT(organization_id,purpose) DO UPDATE SET revision=administration_branding_assets.revision+1,origin='NONE',asset_id=NULL,blob_key=NULL,sha256=NULL,size=NULL,mime=NULL,width=NULL,height=NULL,public_ref=NULL,updated_at=clock_timestamp()",[ctx.org.id,p]); } }
  /** Caller supplies a backup hold check and owns scheduling; called in org-locked context. */
  async function collectGarbage(ctx: Ctx, isHeld: (r: BrandingBackupReference)=>Promise<boolean>, limit=50) {
    if (!Number.isInteger(limit) || limit<1 || limit>1000) fail(400,"INVALID_REQUEST");
    const {storage}=ready(); await ctx.c.query("SELECT pg_advisory_xact_lock($1)",[BRANDING_GC_LOCK]);
    const jobs=(await ctx.c.query("SELECT * FROM administration_branding_gc WHERE organization_id=$1 AND available_at<=clock_timestamp() ORDER BY available_at,id LIMIT $2 FOR UPDATE",[ctx.org.id,limit])).rows;
    let removed=0, deferred=0, failed=0;
    for (const job of jobs) {
      if ((await ctx.c.query('SELECT administration_branding_blob_referenced($1,$2) AS referenced',[ctx.org.id,job.blob_key])).rows[0]?.referenced!==false) { deferred++; continue; }
      const ref: BrandingBackupReference={owner:"ORGANIZATION",organizationId:ctx.org.id,storageNamespace:"ORG_BRANDING",purpose:job.purpose,assetId:job.id,key:job.blob_key,sha256:job.sha256,size:job.size};
      if(await isHeld(ref)) { deferred++; continue; }
      try { await storage.store.removeChecked({key:job.blob_key,sha256:job.sha256,size:job.size}); await ctx.c.query("UPDATE administration_branding_stages SET storage_removed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE blob_key=$1 AND state IN ('PUBLISHED','ABANDONED') AND storage_removed_at IS NULL",[job.blob_key]); await ctx.c.query("DELETE FROM administration_branding_gc WHERE id=$1",[job.id]); removed++; }
      catch { await ctx.c.query("UPDATE administration_branding_gc SET attempts=attempts+1,available_at=clock_timestamp()+interval '1 minute' WHERE id=$1",[job.id]); failed++; }
    }
    return {removed,deferred,failed};
  }
  function register(app: FastifyInstance, core: ModuleRuntime) {
    // Fastify bounds the buffered stream before calling the parser; decoder receives at most 5 MiB.
    if (app.hasContentTypeParser("multipart/form-data")) throw Error("Branding requires its bounded multipart parser");
    app.addContentTypeParser("multipart/form-data", {parseAs:"buffer",bodyLimit:BRANDING_MULTIPART_LIMIT}, (request, data, done) => {
      try { done(null, parseBrandingMultipart(String(request.headers["content-type"] ?? ""),data as Buffer)); }
      catch (error) { done(error as Error, undefined); }
    });
    app.get(base, r=>core.tenant(r,{mode:"read",authorize},async ctx=>{ await lifecycle.assertTenantReadable(ctx); return {assets:await summary(ctx),ready:!!options.decoder&&!!options.storage}; }));
    app.get('/api/v1/organizations/:organizationId/branding/workspace', r => core.tenant(r, { mode: 'read' }, async ctx => ({ asset: await workspace(ctx), appearance: options.appearance ? await options.appearance(ctx) : { color: '#a84622', showOrganizationName: true } })));
    app.get("/api/v1/organizations/:organizationId/branding/workspace-logo",async (r,reply)=>{ const result=await core.tenant(r,{mode:"read"},workspaceBytes); if(!result.data) fail(404,"RESOURCE_NOT_FOUND"); return reply.header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").type(result.data.mime).send(Buffer.from(result.data.bytes)); });
    app.get("/api/v1/public/branding/:ref",async (r,reply)=>{ const result=await publicBackground((r.params as any).ref); if(!result) return fail(404,"RESOURCE_NOT_FOUND"); return reply.header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").type(result.mime).send(Buffer.from(result.bytes)); });
    const path=base+"/:purpose";
    app.post(path,{bodyLimit:4*Math.ceil(BRANDING_INPUT_BYTES/3)+1024},async r=>{
      const p=purposeOf(r), requestKey=key(r), requestHash=commandHash(r);
      const credentialScope=(ctx:Ctx)=>ctx.principal?`credential:${ctx.principal.credentialId}`:'cookie';
      const replay=async(ctx:Ctx,stage:any)=>{
        const current=await row(ctx.c,ctx.org.id,p);
        if(!current || current.revision!==stage.published_revision || current.asset_id!==stage.id) fail(409,'BRANDING_REPLAY_STALE');
        return {asset:view(current,p,ctx.org.id)};
      };
      // Reserve metadata in an authorized committed transaction before storage is
      // called. This module owns replay across reservation, I/O and publication.
      const reservation=await core.tenant(r,{mode:'authorization_write',authorize,moduleManagedCreateIdempotency:true},async ctx=>{
        await lifecycle.assertTenantWritable(ctx);
        const legacyOperation=(ctx.principal?`credential:${ctx.principal.credentialId}:`:'cookie:')+r.url.split('?')[0];
        const legacyResult=(await ctx.c.query('SELECT hash,result FROM command_results WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4',[ctx.org.id,ctx.account.id,legacyOperation,requestKey])).rows[0];
        if(legacyResult){
          if(legacyResult.hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT');
          const current=await row(ctx.c,ctx.org.id,p);
          if(!current||current.revision!==legacyResult.result?.asset?.revision)fail(409,'BRANDING_REPLAY_STALE');
          return {completed:true,result:legacyResult.result};
        }
        const prior=(await ctx.c.query('SELECT * FROM administration_branding_stages WHERE organization_id=$1 AND actor_id=$2 AND credential_scope=$3 AND purpose=$4 AND request_key=$5 FOR UPDATE',[ctx.org.id,ctx.account.id,credentialScope(ctx),p,requestKey])).rows[0];
        if(prior){
          if(prior.request_hash!==requestHash) fail(409,'IDEMPOTENCY_CONFLICT');
          if(prior.state==='PUBLISHED') return {completed:true,result:await replay(ctx,prior)};
          if(prior.state==='WRITING') fail(503,'BRANDING_UPLOAD_IN_PROGRESS');
          if(prior.state!=='READY') fail(409,'BRANDING_UPLOAD_ABANDONED');
          return {completed:false,stage:prior,image:null};
        }
        const before=await row(ctx.c,ctx.org.id,p);version(r,before?.revision??0);
        const {decoder}=ready(),image=await decoder.decodeAndNormalize(input(r,p),p);
        const bounds=p==='LOGIN_BACKGROUND'?[2560,1920]:p==='EMAIL_LOGO'?[360,180]:[720,720];
        if(!(image.bytes instanceof Uint8Array)||!image.bytes.byteLength||image.bytes.byteLength>(p==='EMAIL_LOGO'?BRANDING_EMAIL_OUTPUT_BYTES:BRANDING_INPUT_BYTES)||image.mime!=='image/png'||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width>bounds[0]||image.height>bounds[1])fail(503,'BRANDING_DECODER_INVALID');
        const fence=(await ctx.c.query("SELECT fence::text FROM organization_lifecycle WHERE organization_id=$1 AND state='ACTIVE'",[ctx.org.id])).rows[0]?.fence;
        if(!fence)fail(404,'RESOURCE_NOT_FOUND');
        const stage=(await ctx.c.query("INSERT INTO administration_branding_stages(id,organization_id,actor_id,credential_scope,purpose,request_key,request_hash,lifecycle_fence,base_revision,blob_key,sha256,size,width,height,write_token,writer_host,writer_pid,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'WRITING') RETURNING *",[uuid(),ctx.org.id,ctx.account.id,credentialScope(ctx),p,requestKey,requestHash,fence,before?.revision??0,uuid(),hash(image.bytes),image.bytes.byteLength,image.width,image.height,uuid(),hostname(),process.pid])).rows[0];
        return {completed:false,stage,image};
      });
      if(reservation.data.completed)return {...reservation,data:reservation.data.result};
      const stage=reservation.data.stage;
      if(reservation.data.image){
        // No Org lock is held during disk I/O. Backup/GC serialization covers
        // bytes and the durable outcome, and ends before reacquiring Org.
        const outcome=await transaction(async c=>{
          await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[stage.organization_id]);
          await c.query('SELECT pg_advisory_xact_lock($1)',[BRANDING_GC_LOCK]);
          try{
            const blob=await ready().storage.store.putReserved(stage.blob_key,reservation.data.image.bytes);
            if(blob.key!==stage.blob_key||blob.sha256!==stage.sha256||blob.size!==stage.size)throw Error('BRANDING_STORE_INVALID');
          }catch(error){
            // A partial write or filename collision does not establish byte
            // ownership/completion. Preserve WRITING for explicit recovery.
            return {error};
          }
          const changed=await c.query("UPDATE administration_branding_stages SET state='READY',updated_at=clock_timestamp() WHERE id=$1 AND write_token=$2 AND state='WRITING' RETURNING id",[stage.id,stage.write_token]);
          if(changed.rowCount!==1)throw Error('BRANDING_STAGE_OUTCOME_CONFLICT');
          return {error:null};
        });
        // A DB failure after the write leaves WRITING, requiring reconciliation;
        // it must never be converted to safe/expired by an elapsed lease.
        if(outcome.error)fail(503,'BRANDING_STAGING_RECONCILIATION_REQUIRED');
      }
      try{return await core.tenant(r,{mode:'authorization_write',authorize,moduleManagedCreateIdempotency:true},async ctx=>{
        await lifecycle.assertTenantWritable(ctx);
        const currentStage=(await ctx.c.query('SELECT * FROM administration_branding_stages WHERE id=$1 AND organization_id=$2 AND actor_id=$3 AND credential_scope=$4 FOR UPDATE',[stage.id,ctx.org.id,ctx.account.id,credentialScope(ctx)])).rows[0];
        if(!currentStage||currentStage.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT');
        if(currentStage.state==='PUBLISHED')return replay(ctx,currentStage);
        if(currentStage.state!=='READY')fail(503,'BRANDING_UPLOAD_IN_PROGRESS');
        const fence=(await ctx.c.query("SELECT fence::text FROM organization_lifecycle WHERE organization_id=$1 AND state='ACTIVE'",[ctx.org.id])).rows[0]?.fence;
        if(fence!==String(currentStage.lifecycle_fence))fail(404,'RESOURCE_NOT_FOUND');
        const before=await row(ctx.c,ctx.org.id,p);
        if((before?.revision??0)!==currentStage.base_revision)fail(409,'VERSION_CONFLICT');
        // Recheck the reserved bytes before publishing any reader/capability.
        await bytes(ctx.c,{origin:'UPLOADED',blob_key:currentStage.blob_key,sha256:currentStage.sha256,size:currentStage.size,width:currentStage.width,height:currentStage.height});
        const next=(await ctx.c.query("INSERT INTO administration_branding_assets(organization_id,purpose,revision,origin,asset_id,blob_key,sha256,size,mime,width,height,public_ref) VALUES($1,$2,1,'UPLOADED',$3,$4,$5,$6,'image/png',$7,$8,$9) ON CONFLICT(organization_id,purpose) DO UPDATE SET revision=administration_branding_assets.revision+1,origin='UPLOADED',asset_id=excluded.asset_id,blob_key=excluded.blob_key,sha256=excluded.sha256,size=excluded.size,mime=excluded.mime,width=excluded.width,height=excluded.height,public_ref=excluded.public_ref,updated_at=clock_timestamp() RETURNING *",[ctx.org.id,p,currentStage.id,currentStage.blob_key,currentStage.sha256,currentStage.size,currentStage.width,currentStage.height,p==='LOGIN_BACKGROUND'?uuid():null])).rows[0];
        if(before?.origin==='UPLOADED')await queue(ctx.c,before,'REPLACED');
        await ctx.c.query("UPDATE administration_branding_stages SET state='PUBLISHED',published_revision=$2,updated_at=clock_timestamp() WHERE id=$1",[currentStage.id,next.revision]);
        await ctx.c.query("INSERT INTO administration_branding_history(organization_id,purpose,revision,origin,actor_id) VALUES($1,$2,$3,'UPLOADED',$4)",[ctx.org.id,p,next.revision,ctx.account.id]);
        await core.changed(ctx,r,currentStage.id,'OrganizationBrandingUpdated');
        return {asset:view(next,p,ctx.org.id)};
      });}catch(error){
        // Only an I/O-complete READY stage can be abandoned. WRITING remains an
        // explicit unsafe state; no direct best-effort deletion hides a crash.
        await transaction(async c=>{
          await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[stage.organization_id]);
          const abandoned=(await c.query("UPDATE administration_branding_stages SET state='ABANDONED',updated_at=clock_timestamp() WHERE id=$1 AND write_token=$2 AND state='READY' RETURNING *",[stage.id,stage.write_token])).rows[0];
          if(abandoned)await queue(c,{...abandoned,asset_id:abandoned.id},'UNPUBLISHED');
        }).catch(()=>{});
        throw error;
      }
    });
    app.delete(path,r=>{ const p=purposeOf(r); return core.tenant(r,{mode:"authorization_write",authorize},async ctx=>{
      await lifecycle.assertTenantWritable(ctx); ready(); const k=key(r), h=commandHash(r), prior=(await ctx.c.query("SELECT hash FROM administration_branding_commands WHERE organization_id=$1 AND actor_id=$2 AND purpose=$3 AND operation='DELETE' AND key=$4",[ctx.org.id,ctx.account.id,p,k])).rows[0];
      const before=await row(ctx.c,ctx.org.id,p); if(prior) { if(prior.hash!==h) fail(409,"IDEMPOTENCY_CONFLICT"); return {asset:view(before,p,ctx.org.id,await legacy(ctx.c,ctx.org.id))}; }
      version(r,before?.revision??0); if(r.body!==undefined && r.body!==null) body(r,[]);
      const next=(await ctx.c.query("INSERT INTO administration_branding_assets(organization_id,purpose,revision,origin) VALUES($1,$2,1,'NONE') ON CONFLICT(organization_id,purpose) DO UPDATE SET revision=administration_branding_assets.revision+1,origin='NONE',asset_id=NULL,blob_key=NULL,sha256=NULL,size=NULL,mime=NULL,width=NULL,height=NULL,public_ref=NULL,updated_at=clock_timestamp() RETURNING *",[ctx.org.id,p])).rows[0];
      if(before?.origin==='UPLOADED') await queue(ctx.c,before,'DELETED');
      await ctx.c.query("INSERT INTO administration_branding_commands VALUES($1,$2,$3,'DELETE',$4,$5)",[ctx.org.id,ctx.account.id,p,k,h]);
      await ctx.c.query("INSERT INTO administration_branding_history(organization_id,purpose,revision,origin,actor_id) VALUES($1,$2,$3,'NONE',$4)",[ctx.org.id,p,next.revision,ctx.account.id]);
      await core.changed(ctx,r,ctx.org.id,'OrganizationBrandingRemoved'); return {asset:view(next,p,ctx.org.id)};
    }); });
  }
  return { register, workspace, workspaceBytes, emailInline, publicBackground, backupReferences, retireAll, collectGarbage };
}

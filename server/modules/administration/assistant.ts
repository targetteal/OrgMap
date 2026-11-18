import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { body, commandHash, fail, key, version } from "../../src/core.js";
const base="/api/v1/organizations/:organizationId/administration/assistant";
type Scope="personal"|"workspace";
type Authorize=(ctx:Ctx)=>Promise<boolean>;
export type AssistantSettings={revision:number;instructions:string;updatedAt:string|null};
const member=(ctx:Ctx)=>ctx.member.member_type!=="GUEST";
const capabilities=Object.freeze({configuration:true,execution:false,rag:false});
function normalize(row:any):AssistantSettings {return {revision:row?.revision??0,instructions:row?.instructions??"",updatedAt:row?.updated_at instanceof Date?row.updated_at.toISOString():row?.updated_at??null};}
async function identity(ctx:Ctx) { await ctx.c.query("SELECT set_config('orgmap.assistant_member_id',$1,true),set_config('orgmap.assistant_account_id',$2,true)",[ctx.member.id,ctx.account.id]); }
async function load(ctx:Ctx,scope:Scope):Promise<AssistantSettings> {
  await identity(ctx);
  return normalize((await ctx.c.query(scope==='personal' ? "SELECT revision,instructions,updated_at FROM administration_assistant_personal WHERE organization_id=$1 AND member_id=$2 AND account_id=$3" : "SELECT revision,instructions,updated_at FROM administration_assistant_workspace WHERE organization_id=$1",scope==='personal'?[ctx.org.id,ctx.member.id,ctx.account.id]:[ctx.org.id])).rows[0]);
}
/** Every read is guarded; future runtime must supply its own explicit authority, not bypass this port. */
export function createAssistantAdministration(options:{canManageSettings:Authorize}) {
  const allowed=(scope:Scope)=>async(ctx:Ctx)=>member(ctx) && (scope==='personal'||await options.canManageSettings(ctx));
  async function readPersonal(ctx:Ctx) { if(!member(ctx)) fail(403,'ACTION_DENIED'); return load(ctx,'personal'); }
  async function readWorkspace(ctx:Ctx, authority:Authorize) { if(!member(ctx)||!await authority(ctx)) fail(403,'ACTION_DENIED'); return load(ctx,'workspace'); }
  function register(app:FastifyInstance,core:ModuleRuntime) {
    app.get(base+'/status',r=>core.tenant(r,{mode:'read',authorize:async ctx=>member(ctx)},async()=>({capabilities,usage:{status:'NO_DATA',requests:null,tokens:null},active:false})));
    for(const scope of ['personal','workspace'] as const) {
      const path=base+'/'+scope, authorize=allowed(scope);
      app.get(path,r=>core.tenant(r,{mode:'read',authorize},async ctx=>({settings:await load(ctx,scope)})));
      app.put(path,r=>core.tenant(r,{mode:'authorization_write',authorize},async ctx=>{
        const k=key(r), h=commandHash(r); await identity(ctx);
        const old=(await ctx.c.query("SELECT hash FROM administration_assistant_commands WHERE organization_id=$1 AND member_id=$2 AND scope=$3 AND key=$4",[ctx.org.id,ctx.member.id,scope,k])).rows[0];
        if(old){if(old.hash!==h)fail(409,'IDEMPOTENCY_CONFLICT');return {settings:await load(ctx,scope)};}
        const before=await load(ctx,scope);version(r,before.revision);
        const b=body(r,['instructions']);if(typeof b.instructions!=='string'||[...b.instructions].length>10000||b.instructions.includes('\0')) fail(422,'INVALID_ASSISTANT_INSTRUCTIONS');
        const sql=scope==='personal' ? "INSERT INTO administration_assistant_personal(organization_id,member_id,account_id,revision,instructions) VALUES($1,$2,$3,1,$4) ON CONFLICT(organization_id,member_id) DO UPDATE SET revision=administration_assistant_personal.revision+1,instructions=excluded.instructions,updated_at=clock_timestamp() RETURNING revision,instructions,updated_at" : "INSERT INTO administration_assistant_workspace(organization_id,revision,instructions) VALUES($1,1,$2) ON CONFLICT(organization_id) DO UPDATE SET revision=administration_assistant_workspace.revision+1,instructions=excluded.instructions,updated_at=clock_timestamp() RETURNING revision,instructions,updated_at";
        const params=scope==='personal'?[ctx.org.id,ctx.member.id,ctx.account.id,b.instructions]:[ctx.org.id,b.instructions];
        const next=normalize((await ctx.c.query(sql,params)).rows[0]);
        await ctx.c.query("INSERT INTO administration_assistant_commands VALUES($1,$2,$3,$4,$5)",[ctx.org.id,ctx.member.id,scope,k,h]);
        await core.changed(ctx,r,scope==='personal'?ctx.member.id:ctx.org.id,scope==='personal'?'AssistantPersonalInstructionsChanged':'AssistantWorkspaceInstructionsChanged');
        return {settings:next};
      }));
    }
    for(const action of ['execute','rag','upload','query','activate'] as const) app.post(base+'/'+action,(r:FastifyRequest)=>core.tenant(r,{mode:'authorization_write',authorize:async ctx=>member(ctx)},async()=>{ if(r.body!==undefined&&r.body!==null) body(r,[]); return fail(503,'CAPABILITY_UNAVAILABLE'); }));
  }
  return {register,readPersonal,readWorkspace};
}

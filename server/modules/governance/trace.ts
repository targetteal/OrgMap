import type { Ctx, ModuleRuntime } from '../../src/runtime.js';
import { Failure, id } from '../../src/core.js';
import type { TraceReference, TraceabilityPort } from '../../src/traceability.js';
import { createGovernanceResourceAdapters } from './ports.js';
import type { GovernancePorts } from './service.js';
/** Only Governance reads its tables and enforces its current original ACL. */
export function createGovernanceTraceReader(core:ModuleRuntime,ports:GovernancePorts) {
 const adapters=createGovernanceResourceAdapters(ports);
 async function lookup(ctx:Ctx,kind:'tension'|'proposal',rid:string):Promise<TraceReference|null> {
  if(ctx.member.member_type==='GUEST')return null;
  try { await core.assertModuleAvailable(ctx,'governance');
   if(!await adapters[kind].authorize(ctx,id(rid),'read'))return null;
   const row=(await ctx.c.query(`SELECT id,title FROM ${kind==='tension'?'gov_tensions':'gov_proposals'} WHERE organization_id=$1 AND id=$2`,[ctx.org.id,rid])).rows[0];
   return row?{kind:kind==='tension'?'TENSION':'PROPOSAL',id:row.id,title:row.title}:null;
  } catch(e) {if(e instanceof Failure && [403,404].includes(e.status))return null;throw e;}
 }
 return {
  tension:(ctx:Ctx,rid:string)=>lookup(ctx,'tension',rid),
  proposal:(ctx:Ctx,rid:string)=>lookup(ctx,'proposal',rid),
  async goalOrigin(ctx:Ctx,goalId:string):Promise<TraceReference|null>{
   if(ctx.member.member_type==='GUEST')return null;
   try{await core.assertModuleAvailable(ctx,'governance');
    const rows=(await ctx.c.query("SELECT tension_id FROM gov_tension_links WHERE organization_id=$1 AND target_kind='GOAL' AND target_id=$2 ORDER BY tension_id LIMIT 2",[ctx.org.id,id(goalId)])).rows;
    return rows.length===1?lookup(ctx,'tension',rows[0].tension_id):null;
   }catch(e){if(e instanceof Failure&&[403,404].includes(e.status))return null;throw e;}
  },
 };
}
export async function tensionDestinations(ctx:Ctx,tid:string,port:TraceabilityPort):Promise<TraceReference[]> {
 if(ctx.member.member_type==='GUEST'||!await port.tension(ctx,id(tid)))return [];
 const links=(await ctx.c.query("SELECT target_kind,target_id FROM gov_tension_links WHERE organization_id=$1 AND tension_id=$2 ORDER BY target_kind,target_id",[ctx.org.id,tid])).rows;
 const proposals=(await ctx.c.query('SELECT id FROM gov_proposals WHERE organization_id=$1 AND tension_id=$2 ORDER BY id',[ctx.org.id,tid])).rows;
 const candidates=[...links.map((r:any)=>({kind:r.target_kind,id:r.target_id})),...proposals.map((r:any)=>({kind:'PROPOSAL',id:r.id}))];
 const out:TraceReference[]=[],seen=new Set<string>();
 for(const x of candidates){if(!['TASK','GOAL','AGENDA','PROPOSAL'].includes(x.kind))continue;const key=x.kind+':'+x.id;if(seen.has(key))continue;seen.add(key);const found=await port.destination(ctx,x.kind,x.id);if(found)out.push(found);}
 return out;
}

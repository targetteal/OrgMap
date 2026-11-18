import type {GuestAccessAdapter,ScopedResource} from "../../src/guest-contract.js";
import type {ModuleRuntime} from "../../src/runtime.js";
import {id} from "../../src/core.js";
import {Governance,type GovernancePorts} from "./service.js";
const tables={proposal:"gov_proposals",tension:"gov_tensions",agreement:"gov_documents"} as const;
type Kind=keyof typeof tables;
export function createGovernanceGuestAccessAdapter(core:ModuleRuntime,ports:GovernancePorts):GuestAccessAdapter{
 const base="/api/v1/organizations/:organizationId";
 return {context:"governance",routes:[
  ...Object.entries({proposals:"proposal",tensions:"tension",documents:"agreement"}).flatMap(([path,kind])=>[
   {method:"GET" as const,path:base+"/"+path,action:"read",collection:true},
   ...(kind==="tension"?[]:[{method:"GET" as const,path:base+"/"+path+"/:id",action:"read",resolve:async(_ctx:any,r:any):Promise<ScopedResource>=>({context:"governance",kind,id:id(r.params.id)})}]),
  ]),
  {method:"POST",path:base+"/proposals/:id/votes",action:"vote",resolve:async(_ctx,r)=>({context:"governance",kind:"proposal",id:id((r.params as any).id)})},
 ],async validateSharePlan(ctx,plan){
  if(ctx.member.member_type==="GUEST"||ctx.member.status!=="ACTIVE")return false;
  await core.assertModuleAvailable(ctx,"governance");
  const g=new Governance(ctx,{} as any,ports);
  for(const item of plan){
   const kind=item.resource.kind as Kind;
   if(item.resource.context!=="governance"||!Object.hasOwn(tables,kind)||!item.actions.includes("read")||item.actions.some(action=>!["read","comment","follow",...(kind==="proposal"?["vote"]:[])].includes(action)))return false;
   try{
    const row=kind==="agreement"?await g.documentRow(item.resource.id):await g.row(tables[kind],item.resource.id);
    if(row.archived||row.visibility==="AUTHOR"||(row.author_id!==ctx.member.id&&ctx.member.org_role!=="OWNER"))return false;
    if(kind!=="agreement"&&row.author_id!==ctx.member.id&&!(await g.participates(row.circle_id)))return false;
   }catch{return false;}
  }
  return true;
 },async visibleMemberIds(ctx,resources){
  const ids=new Set<string>([ctx.member.id]);
  for(const resource of resources){
   const kind=resource.kind as Kind;if(resource.context!=="governance"||!Object.hasOwn(tables,kind))continue;
   const rows=await ctx.c.query(`SELECT author_id FROM ${tables[kind]} WHERE organization_id=$1 AND id=$2`,[ctx.org.id,resource.id]);
   for(const row of rows.rows)ids.add(row.author_id);
  }
  return [...ids];
 }};
}
const runtimes=new WeakMap<ModuleRuntime,GovernancePorts>();
/** One shared binding for HTTP, adapters and resource-scoped workers. */
export function createGovernanceRuntimePorts(core:ModuleRuntime,input:GovernancePorts={}):GovernancePorts{
 const existing=runtimes.get(core);if(existing)return existing;
 const ports={...input,guestAccess:core};
 core.registerGuestAccessAdapter(createGovernanceGuestAccessAdapter(core,ports));
 runtimes.set(core,ports);return ports;
}

import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { uuid } from "../../src/core.js";

const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==="object"&&!(value instanceof Date)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
function comparable(row:any) {
  const {version,access_role,...fields}=row;
  return stable(fields);
}

/** Work owns both the mutation preimage and notification intent; no global event inference. */
export function createWorkNotifications(core: Pick<ModuleRuntime,"publishNotification">) {
  const before = new WeakMap<Ctx,Map<string,string>>();
  async function fingerprint(ctx:Ctx,project:any){
    const sections=(await ctx.c.query("SELECT * FROM work_sections WHERE organization_id=$1 AND project_id=$2 ORDER BY id",[ctx.org.id,project.id])).rows.map(comparable);
    const access=(await ctx.c.query("SELECT member_id,role FROM work_access WHERE organization_id=$1 AND project_id=$2 ORDER BY member_id",[ctx.org.id,project.id])).rows;
    return JSON.stringify({project:comparable(project),sections,access});
  }
  return {
    async captureProject(ctx:Ctx,project:any){
      if(ctx.mode==="read")return;
      const records=before.get(ctx)??new Map<string,string>();
      if(!records.has(project.id))records.set(project.id,await fingerprint(ctx,project));
      before.set(ctx,records);
    },
    async changed(ctx:Ctx,resourceId:string){
      const records=before.get(ctx),previous=records?.get(resourceId);if(!previous)return;
      const project=(await ctx.c.query("SELECT * FROM work_projects WHERE organization_id=$1 AND id=$2",[ctx.org.id,resourceId])).rows[0];if(!project)return;
      const current=await fingerprint(ctx,project);records!.set(resourceId,current);if(previous===current)return;
      await core.publishNotification(ctx,{eventId:uuid(),event:"ProjectUpdated",ref:{type:"project",id:resourceId},recipients:[],followers:true,context:{resourceTitle:project.title,excerpt:project.description?.slice(0,500),details:[...(project.starts_at?[{key:"startsAt" as const,value:new Date(project.starts_at).toISOString()}]:[]),...(project.ends_at?[{key:"dueAt" as const,value:new Date(project.ends_at).toISOString()}]:[])]}});
    },
  };
}

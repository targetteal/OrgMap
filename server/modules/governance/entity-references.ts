import type {Ctx} from '../../src/runtime.js';

/** Resolve only structural references already visible in this proposal's revisions. */
export async function proposalEntityReferences(ctx:Ctx,circleId:string,revisions:{payload?:unknown}[]) {
  if(ctx.member.member_type!=='MEMBER'||ctx.member.status!=='ACTIVE')return [];
  const valid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i,ids=new Set<string>();
  const add=(v:unknown)=>{if(typeof v==='string'&&valid.test(v))ids.add(v.toLowerCase());};
  add(circleId);
  for(const revision of revisions){
    const payload=revision.payload;if(!payload||typeof payload!=='object'||Array.isArray(payload))continue;
    const p=payload as {roleId?:unknown;changes?:unknown};add(p.roleId);
    if(Array.isArray(p.changes))for(const change of p.changes){if(!change||typeof change!=='object'||Array.isArray(change))continue;add(change.entityId);add(change.parentCircleId);}
  }
  if(!ids.size)return [];
  const rows=(await ctx.c.query("SELECT id,name,kind,archived FROM entities WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND kind IN ('CIRCLE','ROLE') ORDER BY id",[ctx.org.id,[...ids]])).rows;
  return rows.map(row=>({entityId:row.id,name:row.name,kind:row.kind,archived:row.archived}));
}

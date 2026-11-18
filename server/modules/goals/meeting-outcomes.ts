import type { Ctx } from '../../src/runtime.js';
import { camel,event,fail,id,text,uuid } from '../../src/core.js';
import type { MeetingOutcomeInput,MeetingOutcomePort } from '../meetings/outcomes.js';
import { goalAccess } from './ports.js';

export function createGoalsMeetingOutcomePort():MeetingOutcomePort {
 async function authorize(ctx:Ctx,input:MeetingOutcomeInput){
  if(input.kind!=='GOAL'||ctx.member.status!=='ACTIVE'||ctx.member.member_type==='GUEST'||ctx.member.org_role!=='OWNER'||ctx.member.organization_id!==ctx.org.id||ctx.member.account_id!==ctx.account.id||!['write','authorization_write'].includes(ctx.mode))fail(403,'ACTION_DENIED');
  if(!(await ctx.c.query("SELECT 1 FROM entities WHERE organization_id=$1 AND id=$2 AND kind='CIRCLE' AND NOT archived",[ctx.org.id,id(input.circleId)])).rowCount)fail(404,'RESOURCE_NOT_FOUND');
 }
 return {
  authorize,
  async create(ctx,input){
   await authorize(ctx,input);if(ctx.mode!=='write')fail(403,'READ_ONLY_TRANSACTION');
   const periods=(await ctx.c.query("SELECT id FROM goal_periods WHERE organization_id=$1 AND NOT archived AND starts_on<=(now() AT TIME ZONE $2)::date AND ends_on>=(now() AT TIME ZONE $2)::date ORDER BY starts_on,id",[ctx.org.id,ctx.org.time_zone])).rows;
   const selected=input.periodId==null?(periods.length===1?periods[0]:null):periods.find(p=>p.id===id(input.periodId!));
   if(!selected)fail(422,'GOAL_PERIOD_SELECTION_REQUIRED');
   const gid=uuid(),title=text(input.title),circleId=id(input.circleId);
   const goal=(await ctx.c.query("INSERT INTO goals(organization_id,id,title,owner_type,owner_id,circle_id,privacy) VALUES($1,$2,$3,'CIRCLE',$4,$4,'PRIVATE') RETURNING *",[ctx.org.id,gid,title,circleId])).rows[0];
   await ctx.c.query('INSERT INTO goal_period_links VALUES($1,$2,$3)',[ctx.org.id,gid,selected.id]);
   await ctx.c.query("INSERT INTO goal_assignments VALUES($1,$2,$3,NULL,$4,'LEAD',NULL)",[ctx.org.id,uuid(),gid,ctx.member.id]);
   await ctx.c.query('INSERT INTO goal_history(organization_id,id,goal_id,actor_id,action,snapshot) VALUES($1,$2,$3,$4,$5,$6)',[ctx.org.id,uuid(),gid,ctx.account.id,'goal.created',{formulaVersion:'orgmap-progress-v1',goal:camel(goal)}]);
   await ctx.c.query('UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1',[ctx.org.id]);await event(ctx.c,ctx.org.id,ctx.account.id,gid,'goal.created',uuid());
   return {kind:'GOAL',id:gid,title};
  },
  async read(ctx,input){
   if(input.kind!=='GOAL'||ctx.member.member_type==='GUEST')return null;
   const row=(await ctx.c.query("SELECT * FROM goals WHERE organization_id=$1 AND id=$2 AND lifecycle<>'ARCHIVED'",[ctx.org.id,id(input.id)])).rows[0];
   if(!row||!(await goalAccess(ctx,row)))return null;return {kind:'GOAL',id:row.id,title:row.title};
  },
 };
}

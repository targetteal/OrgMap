import type { Ctx, ModuleRuntime } from '../../src/runtime.js';
import { Failure, id } from '../../src/core.js';
import type { TraceReference } from '../../src/traceability.js';
import { access, type MeetingPorts } from './service.js';
/** Current meeting authorization is independent of a historical origin. */
export function createMeetingReferenceReader(core:ModuleRuntime,ports:MeetingPorts) {
 return async(ctx:Ctx,rid:string):Promise<TraceReference|null>=>{
  if(ctx.member.member_type==='GUEST')return null;
  try {
   await core.assertModuleAvailable(ctx,'meetings');
   const {m}=await access(ctx,id(rid),'read',ports.readPolicy);
   return {kind:'MEETING',id:m.id,title:m.title};
  }catch(e){if(e instanceof Failure && [403,404].includes(e.status))return null;throw e;}
 };
}
/** Agenda row and meeting authorization stay inside Meetings. */
export function createMeetingTraceReader(core:ModuleRuntime,ports:MeetingPorts) {
 return async(ctx:Ctx,rid:string):Promise<TraceReference|null>=>{
  if(ctx.member.member_type==='GUEST')return null;
  try {await core.assertModuleAvailable(ctx,'meetings');
   const row=(await ctx.c.query('SELECT id,meeting_id,title FROM meeting_agenda WHERE organization_id=$1 AND id=$2',[ctx.org.id,id(rid)])).rows[0];
   if(!row)return null;await access(ctx,row.meeting_id,'read',ports.readPolicy);
   return {kind:'AGENDA',id:row.id,title:row.title,meetingId:row.meeting_id};
  }catch(e){if(e instanceof Failure && [403,404].includes(e.status))return null;throw e;}
 };
}

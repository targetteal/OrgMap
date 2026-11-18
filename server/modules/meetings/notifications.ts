import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { uuid } from "../../src/core.js";

/** One invitation per person/command, even when a recurring series materializes many occurrences. */
export async function publishMeetingScheduled(core: Pick<ModuleRuntime,"publishNotification">,ctx:Ctx,meetingIds:string[],newInvitations?:ReadonlyMap<string,ReadonlySet<string>>) {
  const onlyMembers=newInvitations?[...new Set([...newInvitations.values()].flatMap(members=>[...members]))]:undefined;
  if(!meetingIds.length || onlyMembers?.length===0)return;
  const rows=(await ctx.c.query(`SELECT m.*,p.member_id FROM meeting_occurrences m
    JOIN meeting_participants p ON p.organization_id=m.organization_id AND p.meeting_id=m.id AND p.access IN ('READ','EDIT')
    JOIN members member ON member.organization_id=p.organization_id AND member.id=p.member_id AND member.status='ACTIVE'
    WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND m.state IN ('SCHEDULED','RUNNING')
      AND ($3::uuid[] IS NULL OR p.member_id=ANY($3::uuid[]))
      AND NOT EXISTS(SELECT 1 FROM meeting_reports r JOIN meeting_report_access a ON a.organization_id=r.organization_id AND a.report_id=r.id WHERE r.organization_id=m.organization_id AND r.meeting_id=m.id AND a.member_id=p.member_id AND NOT a.can_read)
    ORDER BY array_position($2::uuid[],m.id),p.member_id`,[ctx.org.id,meetingIds,onlyMembers ?? null])).rows;
  const people=new Set<string>(),groups=new Map<string,{meeting:any;members:string[]}>();
  for(const row of rows){if(people.has(row.member_id)||(newInvitations&&!newInvitations.get(row.id)?.has(row.member_id)))continue;people.add(row.member_id);const group=groups.get(row.id)??{meeting:row,members:[]};group.members.push(row.member_id);groups.set(row.id,group);}
  for(const {meeting,members} of groups.values())await core.publishNotification(ctx,{eventId:uuid(),event:"MeetingScheduled",ref:{type:"meeting",id:meeting.id},recipients:members.map(memberId=>({memberId,nominal:true})),context:{resourceTitle:meeting.title,details:[{key:"startsAt",value:new Date(meeting.start_at).toISOString()},{key:"endsAt",value:new Date(+new Date(meeting.start_at)+meeting.duration_minutes*60000).toISOString()},{key:"occurrences",value:String(meetingIds.length)},{key:"status",value:meeting.state}]}});
}

export async function publishReportPublished(core: Pick<ModuleRuntime,"publishNotification">,ctx:Ctx,meeting:any,report:any){
  const rows=(await ctx.c.query(`SELECT p.member_id FROM meeting_participants p JOIN members m ON m.organization_id=p.organization_id AND m.id=p.member_id AND m.status='ACTIVE'
    WHERE p.organization_id=$1 AND p.meeting_id=$2 AND p.access IN ('READ','EDIT')
      AND NOT EXISTS(SELECT 1 FROM meeting_report_access a WHERE a.organization_id=p.organization_id AND a.report_id=$3 AND a.member_id=p.member_id AND NOT a.can_read)
    ORDER BY p.member_id`,[ctx.org.id,meeting.id,report.id])).rows;
  await core.publishNotification(ctx,{eventId:uuid(),event:"ReportPublished",ref:{type:"report",id:report.id},recipients:rows.map(row=>({memberId:row.member_id,nominal:true})),followers:true,followersOf:[{type:"meeting",id:meeting.id}],context:{resourceTitle:meeting.title,details:[{key:"startsAt",value:new Date(meeting.start_at).toISOString()},{key:"status",value:report.state}]}});
}

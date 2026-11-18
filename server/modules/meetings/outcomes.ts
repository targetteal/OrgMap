import {ContentValidationError,validateRichDocument,toPlainText,type RichDocument} from "../../../packages/content/index.js";
import type {Ctx} from '../../src/runtime.js';
import type {FastifyRequest} from 'fastify';
import {body,fail,id,text} from '../../src/core.js';
import {access,type MeetingReadPolicy} from './service.js';
import {isMeetingGuest} from './guest.js';
export type MeetingOutcomeKind='TASK'|'PROJECT'|'GOAL'|'PROPOSAL'|'POLICY';
export type MeetingOutcomeTargetKind=Exclude<MeetingOutcomeKind,'POLICY'>;
export type MeetingWorkLink =
 | { kind:'MEMBER'; targetId:string }
 | { kind:'ROLE'; targetId:string; selection?: { snapshot:string; people:'ROLE'|string[] } };
export type MeetingRoleOccupantsInput = { kind:'TASK'|'PROJECT'; roleId:string; projectId?:string };
export type MeetingRoleOccupants = { snapshot:string; people:{ id:string; name:string; assignable:boolean }[] };
export type MeetingOutcomeInput={meetingId:string;circleId:string;agendaId:string|null;title:string;kind:MeetingOutcomeKind;projectId?:string|null;workLink?:MeetingWorkLink;periodId?:string|null;visibility?:'PRIVATE'|'PUBLIC';description?:string;roleId?:string|null;leadMemberId?:string|null;proposalKind?:'GOVERNANCE'|'DOCUMENT'|'ELECTION';payload?:unknown;content?:string;richContent?:RichDocument};
export type MeetingOutcomeProposalDocument={documentId:string;title:string;proposedContent:string|null;proposedRich:RichDocument|null;publishedContent:string|null;publishedRich:RichDocument|null};
export type MeetingOutcomeProposal={state:string;version:number;authorId:string;payload:unknown;originTension?:{id:string;title:string;state:string;version:number;authorId:string}|null;entityReferences:{entityId:string;name:string;kind:string;archived:boolean}[];documents:MeetingOutcomeProposalDocument[]};
export type MeetingOutcomeReference={kind:MeetingOutcomeTargetKind;id:string;title:string;proposal?:MeetingOutcomeProposal};
export type MeetingOutcomePort={authorize(ctx:Ctx,input:MeetingOutcomeInput):Promise<void>;create(ctx:Ctx,input:MeetingOutcomeInput):Promise<MeetingOutcomeReference>;read(ctx:Ctx,input:{kind:MeetingOutcomeTargetKind;id:string}):Promise<MeetingOutcomeReference|null>;roleOccupants?(ctx:Ctx,input:MeetingRoleOccupantsInput):Promise<MeetingRoleOccupants>};
export function parseMeetingOutcome(r:FastifyRequest,meeting:{id:string;circle_id:string}):MeetingOutcomeInput{
 const b=body(r,['title','agendaId','kind','projectId','workLink','periodId','visibility','description','roleId','leadMemberId','proposalKind','payload','content','richContent']);
 if(!['TASK','PROJECT','GOAL','PROPOSAL','POLICY'].includes(b.kind))fail(400,'INVALID_REQUEST');
 if(b.projectId!==undefined&&b.kind!=='TASK'||b.periodId!==undefined&&b.kind!=='GOAL'||b.visibility!==undefined&&b.kind!=='PROJECT'||b.description!==undefined&&b.kind!=='PROJECT'||b.roleId!==undefined&&b.kind!=='PROJECT'||b.leadMemberId!==undefined&&b.kind!=='PROJECT'||b.proposalKind!==undefined&&b.kind!=='PROPOSAL'||b.payload!==undefined&&b.kind!=='PROPOSAL'||b.content!==undefined&&b.kind!=='POLICY'||b.richContent!==undefined&&b.kind!=='POLICY')fail(400,'INVALID_REQUEST');
 if(b.visibility!==undefined&&!['PRIVATE','PUBLIC'].includes(b.visibility)||b.proposalKind!==undefined&&!['GOVERNANCE','DOCUMENT','ELECTION'].includes(b.proposalKind))fail(400,'INVALID_REQUEST');
 let workLink:MeetingWorkLink|undefined;
 if(b.workLink!==undefined){
  const link=b.workLink;
  if((b.kind!=='TASK'&&b.kind!=='PROJECT')||!link||typeof link!=='object'||Array.isArray(link)||Object.keys(link).some(key=>!['kind','targetId','selection'].includes(key))||(link.kind!=='MEMBER'&&link.kind!=='ROLE'))fail(400,'INVALID_REQUEST');
  const targetId=id(link.targetId).toLowerCase();
  workLink={kind:link.kind,targetId};
  if (link.selection !== undefined) {
   const { selection } = link;
   if (link.kind!=='ROLE'||!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(key=>!['snapshot','people'].includes(key))||typeof selection.snapshot!=='string'||!/^[a-f0-9]{64}$/.test(selection.snapshot)) fail(400,'INVALID_REQUEST');
   const { people, snapshot } = selection;
   if (b.kind === 'TASK' && people === 'ROLE') workLink={kind:'ROLE',targetId,selection:{snapshot,people}};
   else {
    const limit = b.kind === 'PROJECT' ? 199 : 100;
    if (!Array.isArray(people)||people.length>limit||(b.kind==='TASK'&&!people.length)) fail(400,'INVALID_REQUEST');
    const memberIds = people.map((person:unknown) => id(person).toLowerCase());
    if (new Set(memberIds).size !== memberIds.length) fail(400,'INVALID_REQUEST');
    workLink={kind:'ROLE',targetId,selection:{snapshot,people:memberIds}};
   }
  }
 }
 if(b.richContent!==undefined){if(b.content!==undefined)fail(400,'AMBIGUOUS_DOCUMENT_CONTENT');try{b.richContent=validateRichDocument(b.richContent);if([...toPlainText(b.richContent)].length>10000)fail(422,'INVALID_RICH_DOCUMENT');}catch(error){if(error instanceof ContentValidationError)fail(422,'INVALID_RICH_DOCUMENT');throw error;}}
 return {meetingId:meeting.id,circleId:meeting.circle_id,agendaId:b.agendaId==null?null:id(b.agendaId),title:text(b.title),kind:b.kind,...(b.projectId!==undefined?{projectId:b.projectId===null?null:id(b.projectId)}:{}),...(workLink?{workLink}:{}),...(b.periodId!==undefined?{periodId:b.periodId===null?null:id(b.periodId)}:{}),...(b.visibility!==undefined?{visibility:b.visibility}:{}),...(b.description!==undefined?{description:text(b.description,2000)}:{}),...(b.roleId!==undefined?{roleId:b.roleId===null?null:id(b.roleId)}:{}),...(b.leadMemberId!==undefined?{leadMemberId:b.leadMemberId===null?null:id(b.leadMemberId)}:{}),...(b.proposalKind!==undefined?{proposalKind:b.proposalKind}:{}),...(b.payload!==undefined?{payload:b.payload}:{}),...(b.content!==undefined?{content:text(b.content,10000)}:{}),...(b.richContent!==undefined?{richContent:b.richContent}:{})};
}
/** Only current authorized source is returned; no trust in a destination URL or old snapshot. */
export async function originForMeetingOutput(ctx:Ctx,input:{kind:MeetingOutcomeTargetKind;id:string},policy?:MeetingReadPolicy){
 if(isMeetingGuest(ctx))return null;
 const rows=(await ctx.c.query('SELECT meeting_id,agenda_id FROM meeting_actions WHERE organization_id=$1 AND target_kind=$2 AND target_id=$3',[ctx.org.id,input.kind,id(input.id)])).rows;
 if(rows.length!==1)return null;
 const row=rows[0];try{const {m}=await access(ctx,row.meeting_id,'read',policy);if(row.agenda_id){const a=(await ctx.c.query('SELECT title FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND id=$3',[ctx.org.id,m.id,row.agenda_id])).rows[0];if(a)return {kind:'AGENDA' as const,id:row.agenda_id,meetingId:m.id,title:a.title};}return {kind:'MEETING' as const,id:m.id,title:m.title};}catch(e:any){if(e?.status===403||e?.status===404)return null;throw e;}
}

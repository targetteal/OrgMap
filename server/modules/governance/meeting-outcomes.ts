import {validateRoleMentions} from "../../content/role-mentions.js";
import type { FastifyRequest } from 'fastify';
import type { Ctx } from '../../src/runtime.js';
import { event,fail,Failure,id,text,uuid } from '../../src/core.js';
import type { MeetingOutcomeInput,MeetingOutcomePort,MeetingOutcomeProposal } from '../meetings/outcomes.js';
import { proposalEntityReferences } from './entity-references.js';
import { Governance,type GovernancePorts } from './service.js';

/** Uses Governance's own validator and drafting service, in the caller's UoW. */
export function createGovernanceMeetingOutcomePort(ports:GovernancePorts={}):MeetingOutcomePort {
 const service=(ctx:Ctx)=>new Governance(ctx,{id:uuid()} as FastifyRequest,ports);
 async function authorize(ctx:Ctx,input:MeetingOutcomeInput){
  if(!['PROPOSAL','POLICY'].includes(input.kind)||ctx.member.status!=='ACTIVE'||ctx.member.member_type==='GUEST'||ctx.member.organization_id!==ctx.org.id||ctx.member.account_id!==ctx.account.id||!['write','authorization_write'].includes(ctx.mode))fail(403,'ACTION_DENIED');
  const g=service(ctx);if(!(await g.participates(id(input.circleId))))fail(403,'ACTION_DENIED');
 }
 async function changed(ctx:Ctx,rid:string,action:string){
  await ctx.c.query('UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1',[ctx.org.id]);
  await event(ctx.c,ctx.org.id,ctx.account.id,rid,action,uuid());
 }
 /** Current revision plus the content needed to show what the proposal adds or removes. */
 async function detail(ctx:Ctx,p:any):Promise<MeetingOutcomeProposal|undefined>{
  const payload=(await ctx.c.query('SELECT payload FROM gov_revisions WHERE organization_id=$1 AND proposal_id=$2 AND number=$3',[ctx.org.id,p.id,p.revision])).rows[0]?.payload;
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return undefined;
  const entityReferences=await proposalEntityReferences(ctx,p.circle_id,[{payload}]);
  const parts=[...(Array.isArray(payload.documents)?payload.documents:[]),...(payload.documentId?[payload]:[])];
  const documentIds=[...new Set(parts.map((part:any)=>part?.documentId).filter((value:unknown):value is string=>typeof value==='string'))];
  const documents=[];
  for(const documentId of documentIds){
   const doc=(await ctx.c.query('SELECT title,published_version FROM gov_documents WHERE organization_id=$1 AND id=$2',[ctx.org.id,documentId])).rows[0];
   if(!doc)continue;
   const version=async(number:unknown)=>{
    if(!Number.isInteger(number))return {content:null,richContent:null};
    const row=(await ctx.c.query('SELECT content,rich_content FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2 AND number=$3',[ctx.org.id,documentId,number])).rows[0];
    return {content:row?.content??null,richContent:row?.rich_content??null};
   };
   const part=parts.find((part:any)=>part?.documentId===documentId);
   const proposed=await version(part?.documentVersion),published=await version(doc.published_version);
   documents.push({documentId,title:doc.title,proposedContent:proposed.content,proposedRich:proposed.richContent,publishedContent:published.content,publishedRich:published.richContent});
  }
  let tensionId=typeof p.tension_id==='string'?p.tension_id:null;
  if(!tensionId&&ctx.member.member_type!=='GUEST'&&ports.trace?.tension)
   tensionId=await ports.agenda?.proposalSourceTension?.(ctx,p.id)??null;
  let originTension=null;
  if(tensionId&&ctx.member.member_type!=='GUEST'&&await ports.trace?.tension(ctx,tensionId)){
   const t=(await ctx.c.query('SELECT id,title,state,version,author_id FROM gov_tensions WHERE organization_id=$1 AND id=$2',[ctx.org.id,tensionId])).rows[0];
   if(t)originTension={id:t.id,title:t.title,state:t.state,version:t.version,authorId:t.author_id};
  }
  return {state:p.state,version:p.version,authorId:p.author_id,payload,originTension,entityReferences,documents};
 }
 return {
  authorize,
  async create(ctx,input){
   await authorize(ctx,input);if(ctx.mode!=='write')fail(403,'READ_ONLY_TRANSACTION');
   await validateRoleMentions(ctx,input);
   const g=service(ctx),title=text(input.title),circleId=id(input.circleId);
   let payload=input.payload,kind=input.proposalKind??'GOVERNANCE';
   if(input.kind==='POLICY'){
    const doc=await g.document({ownerId:circleId,title,workflow:'GOVERNANCE',visibility:'ORGANIZATION',...(input.richContent?{richContent:input.richContent}:{content:input.content??''})});
    await changed(ctx,doc.id,'Governance.document');
    kind='GOVERNANCE';payload={documents:[{documentId:doc.id,documentVersion:doc.draftVersion}]};
   }
   const proposal=await g.proposal({title,circleId,kind,payload});
   await changed(ctx,proposal.id,'Governance.proposal');
   return {kind:'PROPOSAL',id:proposal.id,title};
  },
  async read(ctx,input){
   if(input.kind!=='PROPOSAL'||ctx.member.member_type==='GUEST'||ctx.member.status!=='ACTIVE')return null;
   try {const g=service(ctx),p=await g.row('gov_proposals',id(input.id));if(await g.isDraftHidden(p)||(p.author_id!==g.actor&&!(await g.meetingConsentAuthority(p,true))&&!(await g.participates(p.circle_id))))return null;const proposal=await detail(ctx,p);return {kind:'PROPOSAL',id:p.id,title:p.title,...(proposal?{proposal}:{})};}
   catch(e){if(e instanceof Failure&&[403,404].includes(e.status))return null;throw e;}
  },
 };
}

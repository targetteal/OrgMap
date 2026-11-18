import type {LegacyTaskCommentSource,CommentPosition} from '../platform/comments-contract.js';
import {id,fail} from '../../src/core.js';
import {authorizedTask} from './index.js';
import type {WorkGuestPort} from './guest.js';
/** Historical read source only: no thread service, HTTP, conversion, backfill, notifications or writer fallback. */
export function createWorkLegacyCommentSource(options:{guest?:WorkGuestPort}={}):LegacyTaskCommentSource{return {
 async list(ctx,input){
  if(!input||Object.keys(input).some(k=>!['taskId','after','take'].includes(k))||!Number.isInteger(input.take)||input.take<1||input.take>101)fail(400,'INVALID_COMMENT_PAGE');
  if(ctx.member.status!=='ACTIVE'||ctx.member.organization_id!==ctx.org.id||ctx.member.account_id!==ctx.account.id)fail(404,'RESOURCE_NOT_FOUND');
  const taskId=id(input.taskId);await authorizedTask(ctx,taskId,false,options.guest);
  const after:CommentPosition|undefined=input.after;
  if(after&&(Object.keys(after).some(k=>!['createdAt','id','source'].includes(k))||!['WORK_LEGACY','PLATFORM'].includes(after.source)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(after.createdAt)))fail(400,'INVALID_COMMENT_CURSOR');
  if(after)id(after.id);
  const rows=(await ctx.c.query(`SELECT id,author_id,content,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS instant FROM work_comments WHERE organization_id=$1 AND task_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id,0)>($3::timestamptz,$4::uuid,$5::int)) ORDER BY created_at,id LIMIT $6`,[ctx.org.id,taskId,after?.createdAt??null,after?.id??null,after?.source==='PLATFORM'?1:0,input.take])).rows;
  return rows.map(row=>({id:row.id,authorId:row.author_id,content:row.content,createdAt:row.instant}));
 }
};}

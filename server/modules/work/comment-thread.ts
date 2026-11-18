import type {Ctx} from '../../src/runtime.js';
import type {CommentThreadPort,CommentPosition,ThreadComment} from '../platform/comments-contract.js';
import {fail} from '../../src/core.js';
export function requireWorkComments(port?:CommentThreadPort):CommentThreadPort{if(!port)return fail(503,'COMMENT_THREAD_UNAVAILABLE');return port;}
/** Compatibility detail exhausts the canonical stream in the caller's read UoW; UI renders only CommentsThread. */
export async function listWorkTaskComments(ctx:Ctx,taskId:string,port?:CommentThreadPort){const comments=requireWorkComments(port),items:ThreadComment[]=[];let after:CommentPosition|undefined;for(;;){const result=await comments.list(ctx,{ref:{type:'task',id:taskId},limit:100,...(after?{after}:{})});items.push(...result.items);if(!result.page.hasMore)return items;const next=result.page.after;if(!next||JSON.stringify(next)===JSON.stringify(after))fail(503,'COMMENT_THREAD_INVALID_PAGE');after=next!;}}

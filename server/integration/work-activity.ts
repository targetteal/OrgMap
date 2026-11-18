import {fail,id} from '../src/core.js';
import type {WorkActivityPort} from '../modules/work/activity-contract.js';
/** Foundation audit projection. Work authorizes every resource before calling.
 * Payloads, request IDs, account IDs and email addresses never cross the port. */
export function createWorkActivityPort():WorkActivityPort{
  return {async read(ctx,input){
    if(!Array.isArray(input.resourceIds)||input.resourceIds.length>5001||!Number.isInteger(input.limit)||input.limit<1||input.limit>100)fail(400,'INVALID_REQUEST');
    const ids=[...new Set(input.resourceIds.map(value=>id(value)))];
    if(!ids.length)return {entries:[],coverage:'CANONICAL_AUDIT',hasMore:false};
    const rows=(await ctx.c.query(
      `SELECT e.id,e.resource_id,e.action,e.at,m.id AS actor_member_id
       FROM audit_events e LEFT JOIN members m
         ON m.organization_id=e.organization_id AND m.account_id=e.actor_id
       WHERE e.organization_id=$1 AND e.resource_id=ANY($2::uuid[])
       ORDER BY e.at DESC,e.id DESC LIMIT $3`,[ctx.org.id,ids,input.limit+1])).rows;
    const hasMore=rows.length>input.limit;
    return {entries:rows.slice(0,input.limit).map(row=>({id:row.id,resourceId:row.resource_id,action:row.action,at:new Date(row.at).toISOString(),actorMemberId:row.actor_member_id??null})),coverage:'CANONICAL_AUDIT',hasMore};
  }};
}

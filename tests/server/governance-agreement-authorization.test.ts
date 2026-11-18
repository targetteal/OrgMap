import test from 'node:test';
import assert from 'node:assert/strict';
import { createGovernanceResourceAdapters } from '../../server/modules/governance/ports.js';
const resource='11111111-1111-4111-8111-111111111111', owner='22222222-2222-4222-8222-222222222222';
function context(kind:'GUEST'|'MEMBER', error?:Error) {
 return {org:{id:'org'},account:{id:'account'},member:{id:'member',member_type:kind,org_role:'MEMBER'},c:{query:async(sql:string)=>{
  if(sql.includes('FROM members'))return {rows:[{id:'member'}]};
  if(sql.includes('FROM gov_documents'))return {rows:[{id:resource,owner_id:owner,author_id:'author',visibility:'ORGANIZATION',archived:false}]};
  if(sql.includes('FROM entities')){if(error)throw error;return {rows:[{id:owner,kind:'CIRCLE'}]};}
  throw Error('unexpected query');
 }}} as any;
}
test('agreement Guest comment requires both read and comment grants',async()=>{
 let actions=['read','comment'];
 const adapter=createGovernanceResourceAdapters({guestAccess:{guestResourceIds:async(_ctx:any,input:any)=>actions.includes(input.action)?[resource]:[]} as any}).agreement;
 assert.equal(await adapter.authorize(context('GUEST'),resource,'comment'),true);
 actions=['read'];assert.equal(await adapter.authorize(context('GUEST'),resource,'comment'),false);
 actions=['comment'];assert.equal(await adapter.authorize(context('GUEST'),resource,'comment'),false);
});
test('agreement owner lookup technical failure propagates instead of silently denying',async()=>{
 const failure=Error('database unavailable');
 await assert.rejects(createGovernanceResourceAdapters().agreement.authorize(context('MEMBER',failure),resource,'comment'),error=>error===failure);
});

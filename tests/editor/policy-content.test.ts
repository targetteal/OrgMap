import {test} from "node:test";
import assert from "node:assert/strict";
import {parseMeetingOutcome} from "../../server/modules/meetings/outcomes.ts";
import {fromPlainText} from "../../packages/content/index.ts";
const meeting={id:'11111111-1111-4111-8111-111111111111',circle_id:'22222222-2222-4222-8222-222222222222'};
const parse=(body:unknown)=>parseMeetingOutcome({body} as any,meeting);
test('policy accepts explicit rich content, keeps literal legacy and rejects ambiguous or misplaced content',()=>{
 const richContent=fromPlainText('Descrição @literal');
 assert.deepEqual(parse({title:'Restrição',kind:'POLICY',richContent}).richContent,richContent);
 assert.equal(parse({title:'Legacy',kind:'POLICY',content:'<b>@literal</b>'}).content,'<b>@literal</b>');
 assert.throws(()=>parse({title:'Ambiguous',kind:'POLICY',content:'x',richContent}),/AMBIGUOUS_DOCUMENT_CONTENT/);
 assert.throws(()=>parse({title:'Wrong kind',kind:'TASK',richContent}),/INVALID_REQUEST/);
 assert.throws(()=>parse({title:'Bad',kind:'POLICY',richContent:{...richContent,version:2}}),/INVALID_RICH_DOCUMENT/);
 assert.throws(()=>parse({title:'Too long',kind:'POLICY',richContent:fromPlainText('x'.repeat(10001))}),/INVALID_RICH_DOCUMENT/);
});

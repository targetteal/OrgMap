import {test} from 'node:test';
import assert from 'node:assert/strict';
import {purposePayload} from '../src/purpose-payload.ts';
test('name-only updates omit both purpose fields while edited rich content and explicit clearing stay rich',()=>{
 assert.deepEqual(purposePayload(undefined),{});
 assert.deepEqual(purposePayload(undefined,true),{purpose:''});
 const rich={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Propósito',marks:[{type:'bold'}]}]}]} as any;
 assert.deepEqual(purposePayload(rich),{purposeRich:rich});
 const cleared={type:'doc',content:[{type:'paragraph'}]} as any;
 assert.deepEqual(purposePayload(cleared),{purposeRich:cleared});
});

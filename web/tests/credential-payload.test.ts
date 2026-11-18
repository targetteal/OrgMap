import {test} from 'node:test';
import assert from 'node:assert/strict';
import {credentialProof} from '../src/credential-payload.ts';
test('federated confirmation passes own TOTP without transmitting a global password',()=>{
 assert.deepEqual(credentialProof('local-secret','123456',true),{totpCode:'123456'});
 assert.deepEqual(credentialProof('local-secret','',true),{});
 assert.deepEqual(credentialProof('local-secret','123456',false),{password:'local-secret',totpCode:'123456'});
});

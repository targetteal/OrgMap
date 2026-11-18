import {test} from 'node:test';
import assert from 'node:assert/strict';
import {admissionRoute,admissionPath,admissionLinkPath} from '../src/admission-route.ts';
const org='00000000-0000-4000-8000-000000000001',request='00000000-0000-4000-8000-000000000002';
test('admission captures only a fragment capability and retains only a valid non-secret request identifier',()=>{
 const parsed=admissionRoute('/join/'+org+'?requestId='+request+'&linkToken=discarded#linkToken=transient%20secret');
 assert.equal(parsed?.linkToken,'transient secret');assert.equal(parsed?.requestId,request);assert.equal(parsed?.path,admissionPath(org,request));
 assert.equal(admissionRoute(parsed!.path)?.linkToken,undefined);
 assert.equal(admissionRoute('/join/'+org+'?requestId=bad&token=discarded#unknown=discarded')?.path,admissionPath(org));
 assert.equal(admissionRoute('/join/not-an-id'),null);assert.equal(admissionRoute('https://external.test/join/'+org),null);
 assert.equal(admissionLinkPath(org,'a+b'),'/join/'+org+'#linkToken=a%2Bb');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalTombstone,tombstoneSha256} from '../../server/ops/organization-ledger.js';

test('tombstone canonical record has stable order and hashes bytes without newline',()=>{
 const entry={acceptedAt:'2026-10-30T12:34:56.123Z',fence:'2',jobId:'00000000-0000-4000-8000-000000000002',organizationId:'00000000-0000-4000-8000-000000000001'};
 assert.equal(canonicalTombstone(entry),'{"organizationId":"00000000-0000-4000-8000-000000000001","jobId":"00000000-0000-4000-8000-000000000002","fence":"2","acceptedAt":"2026-10-30T12:34:56.123Z"}');
 assert.equal(tombstoneSha256(entry),'c50be54ed93ff0df9f1ded81927e0345225bd50723a236e15a33e67fe72ad7b4');
 assert.throws(()=>tombstoneSha256({...entry,acceptedAt:'2026-10-30T12:34:56Z'}),/LIFECYCLE_LEDGER_INVALID/);
});

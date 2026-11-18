import {test} from 'node:test';import assert from 'node:assert/strict';
import {entryLanding,entryMediaUrl,canApplyEntryLanding,skipGuestEntryError} from '../src/organization-entry.ts';
const member={membership:{memberType:'MEMBER'},modules:{goals:true,work:true,meetings:false}} as any;
test('organization entry destination is used only on an unchanged implicit landing',()=>{
 assert.equal(canApplyEntryLanding(true,'/structure','/structure'),true);
 assert.equal(canApplyEntryLanding(false,'/structure','/structure'),false);
 assert.equal(canApplyEntryLanding(true,'/structure','/goals/specific-id'),false);
 assert.equal(canApplyEntryLanding(true,'/roles/specific-id','/roles/specific-id'),false);
 assert.equal(entryLanding('GOALS',member),'/goals');assert.equal(entryLanding('MEETINGS',member),'/structure');
 const guest={membership:{memberType:'GUEST'},modules:{goals:false,work:true,structure:false}} as any;
 assert.equal(entryLanding('SHARED',guest),'/projects');assert.equal(entryLanding('GOALS',guest),'/projects');assert.equal(entryLanding('SHARED',{...guest,modules:{}}),'/structure');
 assert.equal(entryLanding('SHARED',{...guest,modules:{governance:true},sharedResources:[{context:'governance',kind:'tension',id:'t'}]}),'/structure/tensions');
});
test('only a Guest without entry access silently skips the optional welcome',()=>{
 const guest={membership:{memberType:'GUEST'}} as any;
 assert.equal(skipGuestEntryError(guest,'RESOURCE_NOT_FOUND'),true);
 assert.equal(skipGuestEntryError(guest,'NETWORK_ERROR'),false);
 assert.equal(skipGuestEntryError(member,'RESOURCE_NOT_FOUND'),false);
});
test('entry media never invents a default or accepts credentialed/unsafe URLs',()=>{
 assert.equal(entryMediaUrl(null),null);assert.equal(entryMediaUrl('javascript:alert(1)'),null);assert.equal(entryMediaUrl('http://example.test/video.mp4'),null);assert.equal(entryMediaUrl('https://user:secret@example.test/video.mp4'),null);
 assert.equal(entryMediaUrl('https://example.test/video.mp4'),'https://example.test/video.mp4');
});

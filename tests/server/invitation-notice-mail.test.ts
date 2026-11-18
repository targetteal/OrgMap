import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_LOCALES} from '../../packages/i18n/index.js';
import {renderInvitationNotice} from '../../server/modules/platform/invitation-notice-mail.js';
const input={locale:'es-ES',email:'person@example.test',organizationName:'Bosque',organizationId:'11111111-1111-4111-8111-111111111111',invitationId:'22222222-2222-4222-8222-222222222222'};
test('inviter notices have translated context and an organization-specific tracking action in all languages',()=>{
 for(const locale of SUPPORTED_LOCALES)for(const event of ['InvitationAccepted','InvitationDeliveryFailed'] as const){
  const mail=renderInvitationNotice({...input,event,locale},'https://orgmap.example.test');
  assert.ok(mail.subject.includes(input.organizationName));assert.ok(mail.text.includes(input.email));
  assert.ok(mail.html?.includes('lang="'+locale+'"'));assert.doesNotMatch(mail.subject+mail.text,/InvitationAccepted|InvitationDeliveryFailed|\{(?:email|organization)\}/);
  const url=new URL(mail.text.match(/https:\/\/\S+/)![0]);assert.equal(url.pathname,'/organization-invitations');assert.equal(url.searchParams.get('organizationId'),input.organizationId);assert.equal(url.searchParams.get('invitationId'),input.invitationId);assert.equal(url.hash,'');
  assert.equal(url.searchParams.has('token'),false);
 }
 const failed=renderInvitationNotice({...input,event:'InvitationDeliveryFailed'},'http://127.0.0.1:5288');
 assert.match(failed.text,/confirm/);assert.doesNotMatch(failed.text,/no se entregó definitivamente/i);
});
test('inviter notice renders literal private context safely and rejects an unsafe origin',()=>{
 const mail=renderInvitationNotice({...input,event:'InvitationAccepted',organizationName:'<Equipe & "A">\r\nBcc: example',email:'<pessoa>@example.test'},'https://orgmap.example.test');
 assert.doesNotMatch(mail.subject,/[\r\n]/);assert.ok(mail.html?.includes('&lt;Equipe &amp; &quot;A&quot;&gt;'));
 assert.ok(mail.html?.includes('&lt;pessoa&gt;'));assert.ok(!mail.html?.includes('<Equipe'));
 for(const origin of ['javascript:alert(1)','http://external.example.test','https://user:pass@example.test','https://example.test/path'])assert.throws(()=>renderInvitationNotice({...input,event:'InvitationAccepted'},origin),/INVITATION_ORIGIN/);
});

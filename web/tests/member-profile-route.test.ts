import {test} from 'node:test';import assert from 'node:assert/strict';
import {memberProfileTab,memberProfilePath,memberProfileLabels} from '../src/member-profile-route.ts';
import {guestRouteAvailable} from '../src/guest-navigation.ts';
test('profile indicator tabs preserve directory context without using Account or entity identities',()=>{
 const from='/members?view=cards&status=ACTIVE';const path=memberProfilePath('membership-subject','metrics',from);
 assert.equal(memberProfileTab(path),'metrics');assert.equal(new URL(path,'https://orgmap.invalid').pathname,'/members/membership-subject');
 assert.equal(new URL(path,'https://orgmap.invalid').searchParams.get('from'),from);
 assert.equal(memberProfileTab('/members/id?tab=unknown'),'general');
 assert.equal(new URL(memberProfilePath('id','checklists','https://external.test'),'https://orgmap.invalid').searchParams.get('from'),'/members');
 const guest={membership:{memberType:'GUEST'},modules:{}} as any;
 assert.equal(guestRouteAvailable(guest,'/members/id?tab=metrics'),false);assert.equal(guestRouteAvailable(guest,'/members/id?tab=checklists'),false);assert.equal(guestRouteAvailable(guest,'/members/id'),true);
 for(const tab of ['projects','goals'] as const){assert.equal(memberProfileTab(memberProfilePath('id',tab,from)),tab);assert.equal(guestRouteAvailable(guest,`/members/id?tab=${tab}`),false);}
 for(const locale of ['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','nl-NL','ja-JP'])assert.ok(memberProfileLabels(locale).metrics);
});

test('new profile sections and path-form aliases retain safe directory return context',()=>{
 for(const tab of ['structure','activity'] as const){const path=memberProfilePath('id',tab,'/members?view=list&status=ACTIVE');assert.equal(memberProfileTab(path),tab);assert.equal(new URL(path,'https://orgmap.invalid').searchParams.get('from'),'/members?view=list&status=ACTIVE');}
 assert.equal(memberProfileTab('/members/id/projects'),'projects');
 assert.equal(memberProfileTab('/members/id/metrics'),'metrics');
});

test('profile tabs preserve the validated role and its structure origin',()=>{
 const source='/roles/11111111-1111-4111-8111-111111111111?from='+encodeURIComponent('/structure/directory?viewId=team-1');
 for(const tab of ['general','structure','activity','projects'] as const){
  const path=memberProfilePath('id',tab,source);
  assert.equal(new URL(path,'https://orgmap.invalid').searchParams.get('from'),source);
 }
 const search='/roles/11111111-1111-4111-8111-111111111111?from='+encodeURIComponent('/platform/search?q=Sementes&type=role');
 assert.equal(new URL(memberProfilePath('id','activity',search),'https://orgmap.invalid').searchParams.get('from'),search);
});

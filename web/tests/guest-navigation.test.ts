import {test} from 'node:test';import assert from 'node:assert/strict';import {guestModuleAvailable,guestRouteAvailable,guestRailPath,canLoadStructureHistory} from '../src/guest-navigation.ts';
const guest={membership:{memberType:'GUEST'},modules:{structure:false,work:false,goals:false,governance:false,meetings:false},rootCircleId:null,sharedResources:[]} as any;
test('minimal guest bootstrap does not advertise unshared modules or administrative routes',()=>{
 for(const module of ['structure','projects','goals','meetings'])assert.equal(guestModuleAvailable(guest,module),false);
 assert.equal(guestModuleAvailable(guest,'members'),true);assert.equal(guestRouteAvailable(guest,'/structure'),true);
 for(const path of ['/administration','/platform/preferences','/platform/jobs','/members?view=hierarchy','/structure/history','/structure/advanced','/goals','/circles/known-id'])assert.equal(guestRouteAvailable(guest,path),false,path);
 assert.equal(guestRouteAvailable(guest,'/account/accessibility'),true);assert.equal(guestRouteAvailable(guest,'/members?view=cards'),true);
 const scoped={...guest,modules:{...guest.modules,structure:true,work:true}};
 assert.equal(guestModuleAvailable(scoped,'projects'),true);assert.equal(guestRouteAvailable(scoped,'/projects/shared-id'),true);assert.equal(guestRouteAvailable(scoped,'/circles/shared-id'),true);
 assert.equal(guestRouteAvailable(scoped,'/structure?savedView=private'),false);assert.equal(guestRouteAvailable(scoped,'/structure/directory?viewId=private'),false);
 assert.equal(guestRouteAvailable({...guest,membership:{memberType:'MEMBER'}},'/administration'),true);
});

test('Guest governance and platform reads remain reachable without structure shares or admin entry points',()=>{
 const governance={...guest,modules:{...guest.modules,governance:true},sharedResources:[{context:'governance',kind:'tension',id:'shared'}]};
 assert.equal(guestRailPath(governance,'structure','/structure'),'/structure/tensions');
 assert.equal(guestRouteAvailable(governance,'/structure/tensions'),true);
 assert.equal(guestRouteAvailable(governance,'/structure/proposals/shared'),true);
 assert.equal(guestRouteAvailable(governance,'/structure/branches'),false);
 assert.equal(guestRouteAvailable(governance,'/circles/private'),false);
 for(const path of ['/platform/search','/platform/favorites','/platform/notifications','/platform/resource/role/shared'])assert.equal(guestRouteAvailable(governance,path),true,path);
 for(const path of ['/platform/preferences','/platform/jobs','/platform/admin','/structure/advanced'])assert.equal(guestRouteAvailable(governance,path),false,path);
 assert.equal(canLoadStructureHistory(guest,'/structure/history'),false);
 assert.equal(canLoadStructureHistory(null,'/structure/history'),false);
 assert.equal(canLoadStructureHistory({...guest,membership:{memberType:'MEMBER'}},'/structure/history'),true);
});

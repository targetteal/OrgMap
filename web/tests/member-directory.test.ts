import {test} from 'node:test';import assert from 'node:assert/strict';
import {memberDirectoryOptions,memberDirectoryPath,memberReturnPath,selectDirectoryMembers,groupDirectoryMembers} from '../src/member-directory.ts';
test('directory filtering is shared by views and survives safe return links',()=>{
 const options=memberDirectoryOptions('/members?view=cards&status=ACTIVE&type=GUEST');
 const members=[{id:'a',displayName:'Pessoa A',status:'ACTIVE',memberType:'GUEST',orgRole:'MEMBER'},{id:'b',displayName:'Pessoa B',status:'SUSPENDED',memberType:'GUEST',orgRole:'MEMBER'},{id:'c',displayName:'Pessoa C',status:'ACTIVE',memberType:'MEMBER',orgRole:'OWNER'}] as any;
 assert.deepEqual(selectDirectoryMembers(members,options,'pessoa').map(m=>m.id),['a']);
 const link=memberDirectoryPath(options);assert.deepEqual(memberDirectoryOptions(memberReturnPath(link)),options);
 assert.equal(memberReturnPath('https://example.test/members'),'/members');assert.equal(memberReturnPath('http://['),'/members');
 assert.equal(memberDirectoryOptions('/members?status=UNKNOWN').status,'ALL');
 assert.deepEqual(memberDirectoryOptions(memberDirectoryPath({...options,view:'list'})),{...options,view:'list'});
});

test('profile return accepts only local structure origins and sanitizes nested views',()=>{
 const role='/roles/11111111-1111-4111-8111-111111111111';
 const circle='/circles/22222222-2222-4222-8222-222222222222';
 const from='/structure/directory?viewId=team-1';
 assert.equal(memberReturnPath(role+'?from='+encodeURIComponent(from)),role+'?from='+encodeURIComponent(from));
 assert.equal(memberReturnPath(circle+'?from='+encodeURIComponent('/structure?view=network&secret=drop')),circle+'?from='+encodeURIComponent('/structure?view=network'));
 assert.equal(memberReturnPath('/structure/directory?viewId=team-1&secret=drop'),from);
 for(const unsafe of ['//evil.test/members','/\\evil.test/members','https://example.test/members','/roles/not-a-uuid','/account'])assert.equal(memberReturnPath(unsafe),'/members');
 for(const unsafe of ['//evil.test/structure','https://example.test/structure','/account','/\\evil.test/structure'])assert.equal(memberReturnPath(role+'?from='+encodeURIComponent(unsafe)),role);
});

test('grouping partitions the already authorized filtered members without duplication',()=>{
 const members=[{id:'a',status:'ACTIVE',memberType:'GUEST',orgRole:'MEMBER'},{id:'b',status:'SUSPENDED',memberType:'MEMBER',orgRole:'MEMBER'},{id:'c',status:'ACTIVE',memberType:'MEMBER',orgRole:'OWNER'}] as any;
 const groups=groupDirectoryMembers(members,'status');assert.deepEqual(groups.map(g=>[g.label,g.members.length]),[['Ativos',2],['Suspensos',1]]);
 assert.deepEqual(groups.flatMap(g=>g.members).map(m=>m.id).sort(),['a','b','c']);
 assert.equal(groupDirectoryMembers(members.filter((m:any)=>m.id==='a'),'type')[0].label,'Convidados');
 const options=memberDirectoryOptions('/members?view=cards&group=role');assert.equal(memberDirectoryOptions(memberReturnPath(memberDirectoryPath(options))).group,'role');
 assert.equal(memberDirectoryOptions('/members?group=unsupported').group,'none');
});

test('affiliations and search use active role/circle relations without conflating organization access',async()=>{
 const {memberAffiliations,memberMatchesQuery}=await import('../src/member-directory.ts');
 const person={id:'p',displayName:'Lia',status:'ACTIVE',orgRole:'MEMBER',memberType:'MEMBER'} as any;
 const structure={nodes:[{nodeId:'root',entityId:'root',kind:'CIRCLE',name:'Raiz',parentNodeId:null},{nodeId:'c',entityId:'circle',kind:'CIRCLE',name:'Comunicação',parentNodeId:'root'},{nodeId:'r',entityId:'role',kind:'ROLE',name:'Curadoria',parentNodeId:'c'}],occupancies:[{id:'a',memberId:'p',roleId:'role',circleId:'circle',startsAt:'2020-01-01T00:00:00Z'},{id:'expired',memberId:'p',roleId:'old',circleId:'root',startsAt:'2020-01-01T00:00:00Z',endsAt:'2021-01-01T00:00:00Z'}],memberships:[],coverage:{complete:true}} as any;
 const affiliation=memberAffiliations('p',structure,Date.parse('2025-01-01T00:00:00Z'));
 assert.deepEqual(affiliation.roles.map(r=>r.name),['Curadoria']);
 assert.deepEqual(affiliation.circles.map(r=>r.name),['Comunicação']);
 assert.equal(memberMatchesQuery(person,structure,'comunicacao'),true);
 assert.equal(memberMatchesQuery(person,structure,'curadoria'),true);
 assert.equal(memberMatchesQuery(person,structure,'raiz'),false);
});

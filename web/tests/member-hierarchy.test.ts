import {test} from 'node:test';import assert from 'node:assert/strict';import {memberHierarchy} from '../src/member-hierarchy.ts';
const members=[{id:'a',displayName:'Pessoa A'},{id:'b',displayName:'Pessoa B'},{id:'c',displayName:'Pessoa C'}] as any;
test('person hierarchy follows only explicit authorized profile relations',()=>{
 const result=memberHierarchy(members,[{value:{memberId:'b',managerId:'a'}},{value:{memberId:'c',managerId:'b'}}]);
 assert.equal(result.relationCount,2);assert.equal(result.roots[0].member.id,'a');assert.equal(result.roots[0].children[0].children[0].member.id,'c');
 assert.equal(memberHierarchy(members,[]).relationCount,0);
 const hidden=memberHierarchy(members,[{value:{memberId:'b',managerId:'private-not-returned'}}]);assert.equal(hidden.incomplete,true);assert.equal(hidden.roots.length,0);
 assert.throws(()=>memberHierarchy(members,[{value:{memberId:'a',managerId:'b'}},{value:{memberId:'b',managerId:'a'}}]),/circular/);
 assert.throws(()=>memberHierarchy(members,[{value:{memberId:'b',managerId:'a'}},{value:{memberId:'b',managerId:'c'}}]),/conflitantes/);
});

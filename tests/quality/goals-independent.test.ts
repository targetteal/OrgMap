/** Independent golden values from implementation/ACCEPTANCE; pure domain only. */
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const candidate=process.env.ORGMAP_QA_CANDIDATE??fileURLToPath(new URL('../../',import.meta.url));
import {test} from 'node:test';
import assert from 'node:assert/strict';
const {progress,average,aggregate,date}=await import(pathToFileURL(resolve(candidate,'server/modules/goals/domain.ts')).href);
test('Progress golden values preserve raw, decreasing targets and display clamp',()=>{
 for(const [initial,current,target,raw,display] of [
  ['0','25','100',25,25],['20','60','100',50,50],['50','30','10',50,50],['0','120','100',120,100],['20','0','100',-25,0]
 ] as const){const r=progress(initial,current,target);assert.equal(r.raw,raw);assert.equal(r.display,display);assert.equal(r.formulaVersion,'orgmap-progress-v1');}
});
test('Degenerate target and invalid numeric text cannot create a number',()=>{
 assert.throws(()=>progress('20','30','20'));
 for(const invalid of ['12abc','NaN','Infinity','-1','1e2',''])assert.throws(()=>progress('0',invalid,'100'));
});
test('Weighted progress uses active contributors and UNKNOWN for denominator zero',()=>{
 const items=[{id:'a',progress:20,weight:'1'},{id:'b',progress:60,weight:'3'}];
 assert.equal(average(items),50);assert.equal(average([items[0],{...items[1],excluded:true}]),20);
 assert.equal(average(items.map(x=>({...x,weight:'0'}))),null);assert.equal(average(items.map(x=>({...x,archived:true}))),null);
});
test('BOTH missing positive source remains UNKNOWN; zero weight source can be empty',()=>{
 const known=[{id:'known',progress:40,weight:'1'}];
 const unknown=aggregate('BOTH','0',known,[],'50','50');assert.equal(unknown.raw,null);assert.ok(unknown.reason);
 assert.equal(aggregate('BOTH','0',known,[],'100','0').raw,40);
 assert.throws(()=>aggregate('BOTH','0',known,[],'60','60'));
});
test('Invalid calendar date is a safe typed validation error',()=>{
 assert.equal(date('2024-02-29'),'2024-02-29');
 for(const value of ['2026-02-29','2026-99-99']){
  assert.throws(()=>date(value),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='INVALID_REQUEST');
 }
});

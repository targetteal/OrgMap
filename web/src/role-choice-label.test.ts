import test from 'node:test';
import assert from 'node:assert/strict';
import type {VisibleStructureNode} from './api';
import {roleChoiceLabel} from './role-choice-label';

const circle=(id:string,name:string):VisibleStructureNode=>({nodeId:id,entityId:`entity-${id}`,kind:'CIRCLE',parentNodeId:null,name,version:1});
const role=(id:string,parentNodeId:string|null,pathRedacted=false):VisibleStructureNode=>({nodeId:id,entityId:`entity-${id}`,kind:'ROLE',parentNodeId,name:'Facilitação',version:1,pathRedacted});
test('homonymous roles name their visible circle and never reconstruct a redacted parent',()=>{
 const a=circle('a','Pesquisa'),b=circle('b','Operações'),first=role('r1','a'),second=role('r2','b'),hidden=role('r3',null,true);
 const nodes=[a,b,first,second,hidden];
 assert.equal(roleChoiceLabel(first,nodes),'Facilitação · Pesquisa');
 assert.equal(roleChoiceLabel(second,nodes),'Facilitação · Operações');
 assert.equal(roleChoiceLabel(hidden,nodes),'Facilitação · Círculo não compartilhado');
 assert.equal(roleChoiceLabel(role('r4','a',true),nodes),'Facilitação · Círculo não compartilhado');
 assert.equal(roleChoiceLabel(role('r5','unknown'),nodes,'Circle not shared'),'Facilitação · Circle not shared');
 assert.equal(roleChoiceLabel(role('r6','r1'),nodes),'Facilitação · Círculo não compartilhado');
});

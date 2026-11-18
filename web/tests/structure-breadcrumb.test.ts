import {test} from 'node:test';import assert from 'node:assert/strict';import {structureParentLabel} from '../src/structure-breadcrumb.ts';
test('redacted or incomplete parent paths never become an invented root',()=>{
 const parent={nodeId:'np',entityId:'p',kind:'CIRCLE',name:'Pai autorizado',parentNodeId:null,version:1} as const;
 const role={nodeId:'nr',entityId:'r',kind:'ROLE',name:'Papel autorizado',parentNodeId:null,version:1} as const;
 assert.equal(structureParentLabel({...role,pathRedacted:true},[role],null),'Caminho não compartilhado');
 assert.equal(structureParentLabel(role,[role],null),'Caminho não compartilhado');
 assert.equal(structureParentLabel({...role,parentNodeId:'hidden'},[role],'p'),'Caminho não disponível');
 assert.equal(structureParentLabel({...role,parentNodeId:'np'},[parent,role],'p'),'Pai autorizado');
 assert.equal(structureParentLabel(parent,[parent],'p'),'Círculo raiz');
 assert.equal(structureParentLabel(role,[role],'p'),'Caminho não disponível');
});

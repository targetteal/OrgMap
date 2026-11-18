import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('member cards count unique active roles and qualify partial coverage',async()=>{
 const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
 try{
 const {MemberCards}=await vite.ssrLoadModule('/src/MemberCards.tsx');
 const {MemberDirectoryResults}=await vite.ssrLoadModule('/src/MemberDirectoryResults.tsx');
 const member={id:'m',displayName:'Nome dinâmico',memberType:'GUEST',orgRole:'MEMBER'};
 const relation={memberId:'m',roleId:'r',startsAt:'2020-01-01',endsAt:null};
 const render=(occupancies:any[],complete:boolean)=>renderToStaticMarkup(createElement(MemberCards,{members:[member],occupancies,complete,onOpen:()=>{}}));
 const active=render([relation,relation,{...relation,roleId:'old',endsAt:'2021-01-01'},{...relation,roleId:'future',startsAt:'2999-01-01'}],true);
 assert.match(active,/1 papel</);assert.match(active,/Nome dinâmico/);assert.match(active,/Convidado/);
 const minimal=renderToStaticMarkup(createElement(MemberCards,{members:[{id:'limited',displayName:'Pessoa autorizada'}],occupancies:[],complete:true,minimal:true,onOpen:()=>{}}));const limitedList=renderToStaticMarkup(createElement(MemberDirectoryResults,{members:[{id:'limited',displayName:'Pessoa autorizada'}],view:'list',group:'none',occupancies:[],complete:true,minimal:true,onOpen:()=>{}}));assert.match(limitedList,/Pessoa autorizada/);assert.doesNotMatch(limitedList,/Suspenso|<th>Estado|<th>Tipo/);assert.match(minimal,/Pessoa autorizada/);assert.doesNotMatch(minimal,/Sem papéis|Membro|Convidado|Suspenso/);
 assert.match(render([],true),/Sem papéis/);assert.match(render([],false),/cobertura parcial/);assert.doesNotMatch(render([],false),/Sem papéis/);
 }finally{await vite.close();}
});

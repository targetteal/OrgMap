import {test} from 'node:test';import assert from 'node:assert/strict';
import {sessionOwnsBootstrap} from '../src/session-scope.ts';
const bootstrap={organization:{id:'org-a'},membership:{id:'member-a'}} as any;
test('tenant chrome requires the current session exact organization association',()=>{
 assert.equal(sessionOwnsBootstrap({organizations:[{id:'org-a',memberId:'member-a'}]} as any,bootstrap),true);
 for(const organizations of [[],[{id:'org-b',memberId:'member-b'}],[{id:'org-a',memberId:'member-other'}]])assert.equal(sessionOwnsBootstrap({organizations} as any,bootstrap),false);
 assert.equal(sessionOwnsBootstrap({organizations:[]} as any,null),false);
});

import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('account shell suppresses stale organization chrome and search for a different association',async()=>{
 const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
 try {
  const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
  const {AccountShell}=await vite.ssrLoadModule('/src/AccountShell.tsx');
  const session={account:{id:'account-b',displayName:'Pessoa B'},organizations:[]};
  const stale={organization:{id:'org-a',name:'Organização anterior A'},membership:{id:'member-a',memberType:'MEMBER'},modules:{}};
  const context={session:{account:{id:'account-a'}},organizationId:'org-a'};
  const html=renderToStaticMarkup(createElement(LocalizationProvider,{accountId:'account-b',preferences:null,children:createElement(AccountShell,{session,bootstrap:stale,context,Search:()=>createElement('span',null,'Busca do tenant anterior'),path:'/account',navigate:()=>{},onLogout:()=>{},onChangeOrg:()=>{},children:'Perfil B'})}));
  assert.ok(html.includes('Pessoa B'));assert.ok(html.includes('Perfil B'));assert.ok(!html.includes('Organização anterior A'));assert.ok(!html.includes('Busca do tenant anterior'));assert.ok(!html.includes('aria-label="Módulos"'));assert.ok(html.includes('aria-label="Navegação da conta"'));
 } finally {await vite.close();}
});

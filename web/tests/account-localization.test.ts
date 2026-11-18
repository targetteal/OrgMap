import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('account navigation and shell render labels from the selected locale',async()=>{
 const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
 try{
  const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
  const {AccountNavigation}=await vite.ssrLoadModule('/src/account/index.tsx');
  const {AccountShell}=await vite.ssrLoadModule('/src/AccountShell.tsx');
  const render=(locale:string)=>renderToStaticMarkup(createElement(LocalizationProvider,{accountId:'synthetic',preferences:{locale},children:createElement(AccountNavigation,{context:{path:'/account/preferences',navigate:()=>{}}})}));
  assert.match(render('en-US'),/General/);assert.match(render('en-US'),/Accessibility/);assert.match(render('en-US'),/Preferences/);assert.match(render('en-US'),/Authentication/);
  assert.match(render('pt-BR'),/Preferências/);assert.match(render('pt-BR'),/Autenticação/);
  const session={account:{id:'synthetic',displayName:'Synthetic User'},organizations:[{id:'org',name:'Organização',memberId:'member'}]};
  const shell=(locale:string)=>renderToStaticMarkup(createElement(LocalizationProvider,{accountId:'synthetic',preferences:{locale},children:createElement(AccountShell,{session,bootstrap:null,context:null,path:'/account/preferences',navigate:()=>{},onLogout:()=>{},onChangeOrg:()=>{},children:'Synthetic content'})}));
  assert.match(shell('es-ES'),/Navegación de la cuenta/);
  assert.match(shell('es-ES'),/<a[^>]+href="\/structure"[^>]+aria-label="OrgMap"/);
  assert.match(shell('es-ES'),/<main[^>]*>[\s\S]*Volver a la organización/);
  assert.match(shell('ja-JP'),/アカウントナビゲーション/);
  assert.match(shell('ja-JP'),/組織に戻る/);
 }finally{await vite.close();}
});

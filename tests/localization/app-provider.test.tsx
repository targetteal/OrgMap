import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createServer} from 'vite';
import {accessibilityStorageKey,DEFAULT_ACCESSIBILITY} from '../../web/src/accessibility/preferences';

const orgId='11111111-1111-4111-8111-111111111111',accountId='22222222-2222-4222-8222-222222222222';
const dom=new JSDOM('<html lang="pt-BR"><body><div id="root"></div></body></html>',{url:'http://a11y.localhost/join/'+orgId});
for(const key of ['window','document','location','history','localStorage','sessionStorage','navigator','HTMLElement','HTMLInputElement','MutationObserver','Event','CustomEvent','DOMException','FormData']as const)Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true,writable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
Object.defineProperty(globalThis,'getComputedStyle',{value:dom.window.getComputedStyle.bind(dom.window),configurable:true});
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}as unknown as MediaQueryList);
const sourceFiles=['tests/localization/app-provider.test.tsx','web/src/App.tsx','web/src/admission-route.ts','web/src/admission/OrgAdmission.tsx','web/src/admission/messages.ts','web/src/localization/index.tsx','web/src/accessibility/index.tsx','web/src/accessibility/preferences.ts','web/src/accessibility/effects.ts','web/src/api.ts','packages/i18n/index.ts'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const sourceBefore=await snapshot(),originalFetch=globalThis.fetch;
const vite=await createServer({root:new URL('../../web/',import.meta.url).pathname,configFile:false,cacheDir:new URL('./.vite-cache/app-provider',import.meta.url).pathname,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
after(async()=>{try{const sourceAfter=await snapshot(),changed=sourceFiles.filter(file=>sourceBefore[file]!==sourceAfter[file]);await writeFile('tests/localization/evidence/app-provider-snapshot.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Real App branch /join, ViteSSR + jsdom and predetermined HTTP; excludes API/PG/GUI/layout/physical assistive technology',sourceStable:!changed.length,changedDuringTests:changed,sourceBefore,sourceAfter,completion:false},null,2)+'\n');assert.deepEqual(changed,[],'App source changed during test');}finally{globalThis.fetch=originalFetch;await vite.close();dom.window.close();}});
const{App}=await vite.ssrLoadModule('/src/App.tsx');
const{createRoot}=await import('react-dom/client');
test('real App admission branch inherits account preferences before membership/bootstrap and reacts to a saved preference event',async()=>{
 const calls:string[]=[];
 let preferences={locale:'ja-JP',timeZone:'Asia/Tokyo',dateFormat:'YYYY-MM-DD',reducedMotion:true};
 globalThis.fetch=async(input)=>{
  const url=String(input);calls.push(url);
  const data=url==='/api/v1/me'?{account:{id:accountId,email:'synthetic@example.test',displayName:'Synthetic account',passwordEnabled:true},organizations:[],csrfToken:'synthetic-csrf'}:url==='/api/v1/account/preferences'?{preferences}:null;
  assert.ok(data,'Unexpected request before membership: '+url);
  return new Response(JSON.stringify({data,meta:{requestId:'synthetic'}}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 dom.window.localStorage.setItem(accessibilityStorageKey({accountId}),JSON.stringify({...DEFAULT_ACCESSIBILITY,bold:true}));
 dom.window.localStorage.setItem(accessibilityStorageKey({accountId,organizationId:orgId}),JSON.stringify({...DEFAULT_ACCESSIBILITY,letterSpacing:true}));
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 try{
  await act(async()=>root.render(<App/>));
  assert.equal(dom.window.document.documentElement.lang,'ja-JP');
  assert.ok(container.querySelector('#admission-content'));
  assert.match(container.querySelector('h1')?.textContent??'',/組織に参加/);
  assert.equal(dom.window.document.documentElement.getAttribute('data-a11y-bold'),'true');
  assert.equal(dom.window.document.documentElement.getAttribute('data-a11y-letter-spacing'),'false');
  assert.equal(dom.window.document.documentElement.getAttribute('data-a11y-motion'),'true');
  const beforeHeading=container.querySelector('h1');
  preferences={...preferences,locale:'en-US'};
  await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('orgmap:preferences-changed'));});
  assert.equal(dom.window.document.documentElement.lang,'en-US');
  assert.match(container.querySelector('h1')?.textContent??'',/Join organization/);
  assert.equal(container.querySelector('h1'),beforeHeading,'Preference refresh must update, not remount, the admission component');
  assert.deepEqual(calls,['/api/v1/me','/api/v1/account/preferences','/api/v1/account/preferences']);
 }finally{await act(async()=>root.unmount());}
 assert.equal(dom.window.document.documentElement.hasAttribute('data-a11y-bold'),false);
});

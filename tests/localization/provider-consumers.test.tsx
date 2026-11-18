import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dom=new JSDOM('<html><body><main></main></body></html>',{url:'http://a11y.localhost'});
for(const key of ['window','document','HTMLElement','HTMLInputElement','Event','DOMException','navigator']as const)Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true,writable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true,writable:true});
const{createRoot}=await import('react-dom/client');
const originalFetch=globalThis.fetch;
const sourceFiles=['tests/localization/provider-consumers.test.tsx','web/src/localization/index.tsx','packages/i18n/index.ts','packages/i18n/messages.ts','packages/i18n/errors.ts','web/src/api.ts','web/src/ui.tsx','web/src/account/MfaSettings.tsx','web/src/admission/OrgAdmission.tsx','web/src/admission/messages.ts','web/src/features/work/statistics-view.tsx','web/src/features/work/messages.ts'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const sourceBefore=await snapshot();
const vite=await createServer({root:new URL('../../web/',import.meta.url).pathname,configFile:false,cacheDir:new URL('./.vite-cache/providers',import.meta.url).pathname,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
after(async()=>{try{const sourceAfter=await snapshot(),changed=sourceFiles.filter(file=>sourceBefore[file]!==sourceAfter[file]);await writeFile('tests/localization/evidence/provider-consumers-snapshot.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Real component/provider in Vite SSR + jsdom, predetermined HTTP only; excludes App composition/PG/GUI/layout/physical assistive technology',testArguments:process.execArgv,sourceStable:!changed.length,changedDuringTests:changed,sourceBefore,sourceAfter,completion:false},null,2)+'\n');assert.deepEqual(changed,[],'Consumer source changed during tests');}finally{globalThis.fetch=originalFetch;await vite.close();dom.window.close();}});
const{LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const{MfaSettings}=await vite.ssrLoadModule('/src/account/MfaSettings.tsx');
const{OrgAdmission}=await vite.ssrLoadModule('/src/admission/OrgAdmission.tsx');
const{RequestError}=await vite.ssrLoadModule('/src/api.ts');
const{WorkStatisticsView}=await vite.ssrLoadModule('/src/features/work/statistics-view.tsx');
const container=dom.window.document.querySelector('main')!;
function statusResponse(error=false){return new Response(JSON.stringify(error?{ok:false,error:{code:'NETWORK_ERROR',message:'SYNTHETIC_RAW_PRIVATE'}}:{ok:true,data:{enabled:false,factorRevision:0}}),{status:error?503:200,headers:{'Content-Type':'application/json'}});}
test('MFA inherits and reacts to the account provider without locale override or remount',async()=>{
 let requests=0;globalThis.fetch=async()=>{requests++;return statusResponse();};
 const root=createRoot(container);
 try{
  for(const[locale,title]of [['en-US','Two-step authentication'],['ja-JP','2段階認証'],['de-DE','Authentifizierung in zwei Schritten']]){
   await act(async()=>root.render(<LocalizationProvider accountId="synthetic-account" preferences={{locale}}><MfaSettings passwordEnabled /></LocalizationProvider>));
   assert.equal(container.querySelector('h3')?.textContent,title);
   assert.equal(dom.window.document.documentElement.lang,locale);
  }
  assert.equal(requests,1,'Locale changes must not remount/refetch the MFA component');
 }finally{await act(async()=>root.unmount());}
});
test('MFA current error follows provider locale changes without exposing raw server text',async()=>{
 globalThis.fetch=async()=>statusResponse(true);
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><MfaSettings passwordEnabled /></LocalizationProvider>));
  assert.match(container.querySelector('[role=alert]')?.textContent??'',/Unable to connect/);
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'ja-JP'}}><MfaSettings passwordEnabled /></LocalizationProvider>));
  const alert=container.querySelector('[role=alert]')?.textContent??'';
  assert.ok(!alert.includes('Unable to connect'),'An existing error must be translated from its code in the current locale');
  assert.match(alert,/[\u3040-\u30ff\u4e00-\u9fff]/);
  assert.ok(!alert.includes('SYNTHETIC_RAW_PRIVATE'));
 }finally{await act(async()=>root.unmount());}
});
test('admission inherits provider changes and translates an existing semantic error without repeating its command',async()=>{
 let calls=0;
 const props={orgId:'11111111-1111-4111-8111-111111111111',organizationName:'Synthetic <safe>',accountEmail:'synthetic@example.test',onJoined:async()=>{},onSignIn:()=>{},api:async()=>{calls++;throw new RequestError('RATE_LIMITED','SYNTHETIC_RAW_PRIVATE');}};
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><OrgAdmission {...props}/></LocalizationProvider>));
  const start=Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Request email code');assert.ok(start);
  await act(async()=>start.click());
  assert.match(container.querySelector('[role=alert]')?.textContent??'',/Too many attempts/);
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'ja-JP'}}><OrgAdmission {...props}/></LocalizationProvider>));
  const alert=container.querySelector('[role=alert]')?.textContent??'';
  assert.match(alert,/試行回数/);assert.ok(!alert.includes('SYNTHETIC_RAW_PRIVATE'));
  assert.equal(dom.window.document.documentElement.lang,'ja-JP');assert.equal(calls,1);
  assert.equal(container.querySelector('safe'),null);
 }finally{await act(async()=>root.unmount());}
});
test('Work statistics follows saved locale and timezone in the existing consumer without refetching statistics',async()=>{
 let calls=0;
 const context={organizationId:'11111111-1111-4111-8111-111111111111',api:async(url:string)=>{calls++;return{data:{period:{month:url.split('month=')[1],start:'2026-01-01T00:00:00Z',asOf:'2026-10-19T10:00:00Z',timezone:'UTC'},totalProjects:1234,total:100,completed:25,completedPercent:25,byStatus:{TODO:50,DONE:25,IN_PROGRESS:20,BLOCKED:5},created:100,changes:3,activeCircleRate:50,activeCircles:1,circlesWithProjects:2,activeUserRate:50,activeParticipants:1,participants:2,coverage:{state:'OBSERVED',firstObserved:'2026-01-01T01:30:00Z',unknownCreationDates:0,unknownActivityActors:0,notes:''}}};}};
 const formatError=()=>'';
 const root=createRoot(container);
 try{
  for(const[locale,timeZone,number,date]of [['en-US','America/Sao_Paulo','1,234','2025-12-31'],['de-DE','Asia/Tokyo','1.234','2026-01-01']]){
   await act(async()=>root.render(<LocalizationProvider preferences={{locale,timeZone,dateFormat:'YYYY-MM-DD'}}><WorkStatisticsView context={context} formatError={formatError}/></LocalizationProvider>));
   assert.equal(container.querySelector('.work-stat-tiles strong')?.textContent,number);
   assert.ok(container.querySelector('.work-stat-card:last-child')?.textContent?.includes(date));
   assert.equal(dom.window.document.documentElement.lang,locale);
  }
  assert.equal(calls,1);
 }finally{await act(async()=>root.unmount());}
});

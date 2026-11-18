import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import type {Root} from 'react-dom/client';
import {applyTextScale} from '../../web/src/accessibility/effects';
import {accessibilityStorageKey,DEFAULT_ACCESSIBILITY} from '../../web/src/accessibility/preferences';

const dom=new JSDOM('<!doctype html><html lang="pt-BR"><body><div id="root"></div></body></html>',{url:'http://a11y.localhost'});
const {window}=dom;
for(const key of ['window','document','HTMLElement','HTMLInputElement','MutationObserver','Event','MouseEvent','DOMException','navigator'] as const)Object.defineProperty(globalThis,key,{value:key==='window'?window:(window as any)[key],configurable:true,writable:true});
Object.defineProperty(globalThis,'getComputedStyle',{value:window.getComputedStyle.bind(window),configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true,writable:true});
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList);
const {createRoot}=await import('react-dom/client');
const {LocalizationProvider,useLocalization}=await import('../../web/src/localization/index');
const {GlobalAccessibilityProvider,AccessibilitySettings,useAccessibility}=await import('../../web/src/accessibility/index');
const container=window.document.getElementById('root')!;
let root:Root;
async function mount(element:React.ReactNode){await act(async()=>{root=createRoot(container);root.render(element);});}
async function unmount(){await act(async()=>root.unmount());container.innerHTML='';window.localStorage.clear();}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('text scaling changes text and inputs without resizing SVG, canvas or hidden controls; cleanup restores',async()=>{
 const fixture=window.document.createElement('div');fixture.innerHTML='<p style="font-size:16px">Text <span style="font-size:14px">child</span></p><button style="font-size:12px">Action<svg width="18" height="18"><text font-size="10">icon</text></svg></button><input style="font-size:13px" value="typed"><input type="hidden" style="font-size:8px"><canvas width="80" height="50"></canvas><div data-a11y-preserve style="font-size:11px">preserved</div>';
 window.document.body.append(fixture);
 const cleanup=applyTextScale(fixture,'large');
 assert.equal(fixture.querySelector('p')!.style.fontSize,'20px');assert.equal(fixture.querySelector('span')!.style.fontSize,'17.5px');
 assert.equal(fixture.querySelector('button')!.style.fontSize,'15px');assert.equal(fixture.querySelector('svg')!.getAttribute('width'),'18');assert.equal(fixture.querySelector('svg text')!.getAttribute('font-size'),'10');
 assert.equal(fixture.querySelector('input')!.style.fontSize,'16.25px');assert.equal(fixture.querySelector('input')!.value,'typed');assert.equal(fixture.querySelector('input[type=hidden]')!.getAttribute('style'),'font-size:8px');
 assert.equal(fixture.querySelector('canvas')!.width,80);assert.equal(fixture.querySelector<HTMLElement>('[data-a11y-preserve]')!.style.fontSize,'11px');
 const added=window.document.createElement('p');added.style.fontSize='10px';added.textContent='new';fixture.append(added);await flush();assert.equal(added.style.fontSize,'12.5px');assert.equal(fixture.querySelector('p')!.style.fontSize,'20px');
 cleanup();assert.equal(added.style.fontSize,'10px');assert.equal(fixture.querySelector('p')!.style.fontSize,'16px');fixture.remove();
});

test('provider and controls translate all eight locales and persist/reset effects only in active scope',async()=>{
 const locales=['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL'];
 for(const locale of locales){
  await mount(<LocalizationProvider accountId="a" preferences={{locale}}><GlobalAccessibilityProvider accountId="a" organizationId="one"><AccessibilitySettings/></GlobalAccessibilityProvider></LocalizationProvider>);
  assert.equal(window.document.documentElement.lang,locale);
  assert.ok(container.querySelector('h1')?.textContent);assert.equal(container.querySelectorAll('fieldset').length,5);
  const boxes=container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');assert.equal(boxes.length,15);assert.equal(boxes[0].disabled,true);
  await act(async()=>boxes[3].click()); // speech, line, letter, bold
  assert.equal(window.document.documentElement.getAttribute('data-a11y-bold'),'true');assert.equal(JSON.parse(window.localStorage.getItem(accessibilityStorageKey({accountId:'a',organizationId:'one'}))!)!.bold,true);
  const select=container.querySelector('select')!;await act(async()=>{select.value='extraLarge';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(window.document.documentElement.getAttribute('data-a11y-text-size'),'extraLarge');
  await act(async()=>container.querySelector<HTMLButtonElement>('.a11y-reset button')!.click());
  assert.equal(window.document.documentElement.getAttribute('data-a11y-bold'),'false');assert.equal(window.localStorage.getItem(accessibilityStorageKey({accountId:'a',organizationId:'one'})),null);
  await unmount();assert.equal(window.document.documentElement.hasAttribute('data-orgmap-accessibility'),false);
 }
});

test('switching organizations applies their local state and reset preserves account motion',async()=>{
 window.localStorage.setItem(accessibilityStorageKey({accountId:'a',organizationId:'one'}),JSON.stringify({...DEFAULT_ACCESSIBILITY,bold:true}));
 function State(){const a=useAccessibility();return <><output>{JSON.stringify({bold:a.preferences.bold,motion:a.effectiveReducedMotion})}</output><button onClick={a.reset}>reset</button></>;}
 const ui=(organizationId:string)=><LocalizationProvider accountId="a" preferences={{reducedMotion:true}}><GlobalAccessibilityProvider accountId="a" organizationId={organizationId}><State/></GlobalAccessibilityProvider></LocalizationProvider>;
 await mount(ui('one'));assert.match(container.textContent!,/"bold":true/);
 await act(async()=>root.render(ui('two')));assert.match(container.textContent!,/"bold":false/);assert.match(container.textContent!,/"motion":true/);
 await act(async()=>container.querySelector('button')!.click());assert.match(container.textContent!,/"motion":true/);
 assert.equal(JSON.parse(window.localStorage.getItem(accessibilityStorageKey({accountId:'a',organizationId:'one'}))!).bold,true);
 await unmount();
});

test('every local toggle changes its named applied attribute; tabs and skiplink support keyboard/focus',async()=>{
 const {AccessibilitySkipLink}=await import('../../web/src/accessibility/index');
 await mount(<LocalizationProvider accountId="a" preferences={{locale:'en-US'}}><GlobalAccessibilityProvider accountId="a" organizationId="one"><AccessibilitySkipLink/><main id="main-content" tabIndex={-1}><AccessibilitySettings/></main></GlobalAccessibilityProvider></LocalizationProvider>);
 const controls:Record<string,string>={'a11y.lineSpacing':'line-spacing','a11y.letterSpacing':'letter-spacing','a11y.bold':'bold','a11y.dyslexia':'dyslexia','a11y.contrast':'contrast','a11y.saturation':'saturation','a11y.invert':'invert','a11y.highContrast':'high-contrast','a11y.links':'links','a11y.headings':'headings','a11y.guide':'guide','a11y.images':'images','a11y.pointer':'pointer','a11y.motion':'motion'};
 for(const [key,attribute] of Object.entries(controls)){
  const input=container.querySelector<HTMLInputElement>(`input[data-orgmap-speech-key="${key}"]`);assert.ok(input,key);
  await act(async()=>input.click());assert.equal(window.document.documentElement.getAttribute(`data-a11y-${attribute}`),'true',key);
 }
 assert.ok(container.querySelector('.a11y-guide'));assert.ok(container.querySelector('.a11y-checked-indicator'));
 const tabs=container.querySelectorAll<HTMLButtonElement>('[role=tab]');await act(async()=>{tabs[0].focus();tabs[0].dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));});assert.equal(tabs[1].getAttribute('aria-selected'),'true');assert.equal(window.document.activeElement,tabs[1]);
 assert.match(container.querySelector('[role=tabpanel]')!.textContent!,/target is WCAG/);
 await act(async()=>container.querySelector<HTMLAnchorElement>('.a11y-skip')!.click());assert.equal(window.document.activeElement,container.querySelector('main'));
 await unmount();
});

test('API provider rejects stale account response, refetches after saved event and clears on logout',async()=>{
 const calls:{resolve:(value:Response)=>void;signal:AbortSignal}[]=[];
 const original=globalThis.fetch;
 globalThis.fetch=((_url:unknown,options:RequestInit)=>new Promise<Response>(resolve=>calls.push({resolve,signal:options.signal as AbortSignal}))) as typeof fetch;
 function State(){const l=useLocalization();return <output>{l.locale}|{l.loading?'loading':'ready'}|{l.formatInstant('2026-01-01T01:30:00Z',false)}</output>;}
 const ui=(accountId:string|null)=><LocalizationProvider accountId={accountId}><State/></LocalizationProvider>;
 const response=(locale:string,timeZone='America/Sao_Paulo')=>new Response(JSON.stringify({data:{preferences:{locale,timeZone,dateFormat:'YYYY-MM-DD'}}}),{status:200,headers:{'Content-Type':'application/json'}});
 try{
  await mount(ui('a'));assert.equal(calls.length,1);
  await act(async()=>root.render(ui('b')));assert.equal(calls.length,2);assert.equal(calls[0].signal.aborted,true);
  await act(async()=>{calls[1].resolve(response('ja-JP','Asia/Tokyo'));await flush();});assert.match(container.textContent!,/^ja-JP\|ready\|2026-01-01$/);
  await act(async()=>{calls[0].resolve(response('de-DE'));await flush();});assert.match(container.textContent!,/^ja-JP/);
  await act(async()=>window.dispatchEvent(new window.Event('orgmap:preferences-changed')));assert.equal(calls.length,3);
  await act(async()=>{calls[2].resolve(response('fr-FR'));await flush();});assert.match(container.textContent!,/^fr-FR\|ready\|2025-12-31$/);
  await act(async()=>root.render(ui(null)));assert.match(container.textContent!,/^pt-BR/);
  await unmount();
 }finally{globalThis.fetch=original;}
});

test('speech reads only approved translated UI keys after opt-in; sensitive values never reach synthesis',async()=>{
 const spoken:{text:string}[]=[];let cancellations=0;
 const synthesis={getVoices:()=>[{lang:'pt-BR'}],addEventListener(){},removeEventListener(){},cancel(){cancellations++;},speak:(utterance:{text:string})=>spoken.push(utterance)};
 class Utterance{lang='';voice:unknown;onend:unknown;onerror:unknown;constructor(public text:string){}}
 Object.defineProperty(window,'speechSynthesis',{value:synthesis,configurable:true});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
 window.localStorage.setItem(accessibilityStorageKey({accountId:'a',organizationId:'one'}),JSON.stringify({...DEFAULT_ACCESSIBILITY,speech:true}));
 await mount(<LocalizationProvider accountId="a" preferences={{locale:'pt-BR'}}><GlobalAccessibilityProvider accountId="a" organizationId="one"><AccessibilitySettings/><button id="safe" data-orgmap-speech-key="common.save">Ignored DOM text</button><input id="secret" type="password" value="SYNTHETIC-SECRET-DO-NOT-READ" data-orgmap-speech-key="common.save" readOnly/><div data-private><button id="private" data-orgmap-speech-key="common.save">Private</button></div><button id="unknown" data-orgmap-speech-key="unknown">Unknown</button></GlobalAccessibilityProvider></LocalizationProvider>);
 await act(async()=>window.document.getElementById('safe')!.focus());assert.equal(spoken.length,1);assert.equal(spoken[0].text,'Salvar');
 for(const id of ['secret','private','unknown'])await act(async()=>window.document.getElementById(id)!.focus());assert.equal(spoken.length,1);assert.ok(spoken.every(v=>!v.text.includes('SECRET')));
 await act(async()=>container.querySelector<HTMLInputElement>('input[role=switch]')!.click());
 await act(async()=>window.document.getElementById('safe')!.focus());assert.equal(spoken.length,1);assert.ok(cancellations>0);
 await unmount();delete (window as any).speechSynthesis;delete (window as any).SpeechSynthesisUtterance;delete (globalThis as any).SpeechSynthesisUtterance;
});

test('keyboard reading guide follows the visible card instead of its one-pixel native checkbox',async()=>{
 window.localStorage.setItem(accessibilityStorageKey({accountId:'a',organizationId:'one'}),JSON.stringify({...DEFAULT_ACCESSIBILITY,guide:true}));
 await mount(<LocalizationProvider accountId="a" preferences={{locale:'en-US'}}><GlobalAccessibilityProvider accountId="a" organizationId="one"><AccessibilitySettings/></GlobalAccessibilityProvider></LocalizationProvider>);
 const input=container.querySelector<HTMLInputElement>('input[data-orgmap-speech-key="a11y.bold"]')!;
 const card=input.closest('label')!;
 card.getBoundingClientRect=()=>({bottom:200,top:116,left:0,right:320,width:320,height:84,x:0,y:116,toJSON(){return {};}});
 input.getBoundingClientRect=()=>({bottom:133,top:132,left:16,right:17,width:1,height:1,x:16,y:132,toJSON(){return {};}});
 await act(async()=>input.focus());assert.equal(container.querySelector<HTMLElement>('.a11y-guide')!.style.top,'204px');
 await unmount();
});

test('color status and reset copy expose state and remain translated',async()=>{
 await mount(<LocalizationProvider accountId="a" preferences={{locale:'pt-BR'}}><GlobalAccessibilityProvider accountId="a" organizationId="one"><AccessibilitySettings/></GlobalAccessibilityProvider></LocalizationProvider>);
 const status=()=>[...container.querySelectorAll('.a11y-card-status')].map(element=>element.textContent);
 assert.deepEqual(status(),['Desativado','Desativada']);
 await act(async()=>container.querySelector<HTMLInputElement>('input[data-orgmap-speech-key="a11y.contrast"]')!.click());
 assert.deepEqual(status(),['Ativado','Desativada']);
 assert.equal(container.querySelector('.a11y-reset-title')!.textContent,'Redefinir');assert.equal(container.querySelector('.a11y-reset-help')!.textContent,'Restaurar as preferências de acessibilidade padrão para este navegador.');
 await act(async()=>container.querySelector<HTMLButtonElement>('.a11y-reset button')!.click());assert.deepEqual(status(),['Desativado','Desativada']);await unmount();
 await mount(<LocalizationProvider accountId="a" preferences={{locale:'ja-JP'}}><GlobalAccessibilityProvider accountId="a" organizationId="one"><AccessibilitySettings/></GlobalAccessibilityProvider></LocalizationProvider>);
 assert.deepEqual(status(),['無効','無効']);assert.equal(container.querySelector('.a11y-reset-title')!.textContent,'リセット');await unmount();
});

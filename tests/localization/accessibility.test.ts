import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_ACCESSIBILITY,accessibilityStorageKey,normalizeAccessibility,readAccessibility,saveAccessibility,resetAccessibility,type PreferenceStorage} from '../../web/src/accessibility/preferences';
import {applyAccessibilityAttributes} from '../../web/src/accessibility/effects';
import {selectSpeechVoice,speechCapability,SPEECH_EXAMPLES} from '../../web/src/accessibility/speech';

function storage():PreferenceStorage {const map=new Map<string,string>();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value);},removeItem:key=>{map.delete(key);}};}
test('local preferences isolate browser/account/organization and reset only active scope',()=>{
 const browser=storage(),otherBrowser=storage(),a={accountId:'a',organizationId:'one'},b={accountId:'a',organizationId:'two'},c={accountId:'b',organizationId:'one'};
 const changed={...DEFAULT_ACCESSIBILITY,bold:true,textSize:'large' as const};
 assert.equal(saveAccessibility(browser,a,changed),true);
 assert.deepEqual(readAccessibility(browser,a),changed);
 for(const scope of [b,c,{accountId:'a'}])assert.deepEqual(readAccessibility(browser,scope),DEFAULT_ACCESSIBILITY);
 assert.deepEqual(readAccessibility(otherBrowser,a),DEFAULT_ACCESSIBILITY);
 saveAccessibility(browser,b,{...DEFAULT_ACCESSIBILITY,guide:true});resetAccessibility(browser,a);
 assert.deepEqual(readAccessibility(browser,a),DEFAULT_ACCESSIBILITY);assert.equal(readAccessibility(browser,b).guide,true);
 assert.notEqual(accessibilityStorageKey({accountId:'a:b',organizationId:'c'}),accessibilityStorageKey({accountId:'a',organizationId:'b:c'}));
});
test('corrupt storage and unknown fields cannot enable features; denied storage reports failure',()=>{
 const browser=storage(),scope={accountId:'a'};
 browser.setItem(accessibilityStorageKey(scope),'broken');assert.deepEqual(readAccessibility(browser,scope),DEFAULT_ACCESSIBILITY);
 assert.deepEqual(normalizeAccessibility({textSize:'HUGE',bold:'true',evil:true}),DEFAULT_ACCESSIBILITY);
 const denied={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};
 assert.deepEqual(readAccessibility(denied,scope),DEFAULT_ACCESSIBILITY);assert.equal(saveAccessibility(denied,scope,{...DEFAULT_ACCESSIBILITY}),false);assert.equal(resetAccessibility(denied,scope),false);
});
test('effective motion combines account preference and local choice; cleanup restores prior attributes',()=>{
 const attrs=new Map<string,string>([['data-a11y-motion','previous']]);
 const root={getAttribute:(key:string)=>attrs.get(key)??null,setAttribute:(key:string,value:string)=>attrs.set(key,value),removeAttribute:(key:string)=>attrs.delete(key)} as unknown as HTMLElement;
 const cleanup=applyAccessibilityAttributes(root,{...DEFAULT_ACCESSIBILITY,bold:true},true);
 assert.equal(attrs.get('data-a11y-motion'),'true');assert.equal(attrs.get('data-a11y-bold'),'true');assert.equal(attrs.get('data-a11y-guide'),'false');
 cleanup();assert.deepEqual([...attrs],[['data-a11y-motion','previous']]);
});
test('speech requires a matching runtime voice and uses only fixed synthetic examples',()=>{
 const voice=(lang:string)=>({lang} as SpeechSynthesisVoice);
 const voices=[voice('fr-FR'),voice('pt-PT'),voice('pt-BR')];
 assert.equal(selectSpeechVoice(voices,'pt-BR'),voices[2]);assert.equal(selectSpeechVoice(voices,'pt-AO'),voices[1]);assert.equal(selectSpeechVoice(voices,'ja-JP'),undefined);
 assert.equal(speechCapability(undefined,'pt-BR').available,false);
 assert.equal(speechCapability({speechSynthesis:{getVoices:()=>[]},SpeechSynthesisUtterance:{}},'pt-BR').available,false);
 assert.equal(speechCapability({speechSynthesis:{getVoices:()=>voices},SpeechSynthesisUtterance:{}},'pt-BR').available,true);
 assert.equal(Object.keys(SPEECH_EXAMPLES).length,8);assert.ok(Object.values(SPEECH_EXAMPLES).every(value=>!/@|password|token|senha/.test(value)));
});

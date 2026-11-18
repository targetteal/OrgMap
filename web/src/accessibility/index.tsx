import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {Volume2,Type,ArrowDownUp,ALargeSmall,Bold,CaseSensitive,Contrast,Droplets,Blend,Link,List,Flashlight,ImageOff,MousePointer2,CircleOff,Check,type LucideIcon} from 'lucide-react';
import { useLocalization, createMessageTranslator, catalogs, type MessageKey } from '../localization';
import { DEFAULT_ACCESSIBILITY, accessibilityStorageKey, readAccessibility, saveAccessibility, resetAccessibility, type AccessibilityPreferences, type AccessibilityScope } from './preferences';
import { applyAccessibilityAttributes, applyTextScale } from './effects';
import { SPEECH_EXAMPLES, selectSpeechVoice, safeSpeechKey } from './speech';
import {accessibilityMessages} from './messages';
import {accessibilityStatusMessages} from './status-messages';
import './styles.css';
export * from './preferences';
export {applyAccessibilityAttributes,applyTextScale} from './effects';

type AccessibilityContextValue = {
 preferences:AccessibilityPreferences; update:<K extends keyof AccessibilityPreferences>(key:K,value:AccessibilityPreferences[K])=>void;
 reset:()=>void; storageError:boolean; voiceAvailable:boolean; speaking:boolean; speakExample:()=>void; stopSpeech:()=>void;
 accountReducedMotion:boolean; effectiveReducedMotion:boolean; inheritedReducedMotion:boolean; enabled:boolean; fontError:boolean; speechError:boolean;
};
const AccessibilityContext=createContext<AccessibilityContextValue>({preferences:{...DEFAULT_ACCESSIBILITY},update:()=>{},reset:()=>{},storageError:false,voiceAvailable:false,speaking:false,speakExample:()=>{},stopSpeech:()=>{},accountReducedMotion:false,effectiveReducedMotion:false,inheritedReducedMotion:false,enabled:false,fontError:false,speechError:false});
export function useAccessibility(){return useContext(AccessibilityContext);}
function getStorage():Storage|null {try{return window.localStorage;}catch{return null;}}
/** Source V179: local to this browser, account AND current organization. No tenant content is persisted. */
export function GlobalAccessibilityProvider({accountId,organizationId,reducedMotion,children}:{accountId?:string|null;organizationId?:string|null;reducedMotion?:boolean;children:ReactNode}){
 const localization=useLocalization();
 const scope=accountId?{accountId,organizationId}:null;
 return <ScopedAccessibility key={scope?accessibilityStorageKey(scope):'anonymous'} scope={scope} reducedMotion={reducedMotion??localization.prefs.reducedMotion===true}>{children}</ScopedAccessibility>;
}
function ScopedAccessibility({scope,reducedMotion,children}:{scope:AccessibilityScope|null;reducedMotion:boolean;children:ReactNode}){
 const {locale,t}=useLocalization();
 const [preferences,setPreferences]=useState<AccessibilityPreferences>(()=>{const storage=getStorage();return scope&&storage?readAccessibility(storage,scope):{...DEFAULT_ACCESSIBILITY};});
 const [storageError,setStorageError]=useState(false),[voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[speaking,setSpeaking]=useState(false),[fontError,setFontError]=useState(false),[systemMotion,setSystemMotion]=useState(false),[speechError,setSpeechError]=useState(false);
 const scopeKey=scope?accessibilityStorageKey(scope):'';
 const utteranceRef=useRef<SpeechSynthesisUtterance|null>(null);
 const cancelSpeech=()=>{utteranceRef.current=null;if('speechSynthesis'in window)window.speechSynthesis.cancel();setSpeaking(false);};
 useEffect(()=>{
  if(!scopeKey)return;
  const listener=(event:StorageEvent)=>{if(event.key===scopeKey||event.key===null){const storage=getStorage();if(storage)setPreferences(readAccessibility(storage,scope!));}};
  window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);
 },[scopeKey]);
 useEffect(()=>{
  const query=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setSystemMotion(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);
 },[]);
 useLayoutEffect(()=>{
  if(!scope)return;
  const restore=applyAccessibilityAttributes(document.documentElement,preferences,reducedMotion||systemMotion);
  const restoreScale=applyTextScale(document.body,preferences.textSize);
  return()=>{restoreScale();restore();};
 },[preferences,reducedMotion,systemMotion,scopeKey]);
 useEffect(()=>{
  if(!preferences.dyslexia){setFontError(false);return;}
  if(!document.fonts){setFontError(true);return;}
  let active=true;document.fonts.load('16px OpenDyslexic').then(fonts=>{if(active)setFontError(fonts.length===0);}).catch(()=>{if(active)setFontError(true);});return()=>{active=false;};
 },[preferences.dyslexia]);
 useEffect(()=>{
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return;
  const synthesis=window.speechSynthesis;const update=()=>setVoices(synthesis.getVoices());update();synthesis.addEventListener('voiceschanged',update);
  return()=>{utteranceRef.current=null;synthesis.removeEventListener('voiceschanged',update);synthesis.cancel();};
 },[]);
 useEffect(()=>{cancelSpeech();setSpeechError(false);},[locale,preferences.speech]);
 const voice=selectSpeechVoice(voices,locale);
 const speak=(text:string)=>{
  if(!scope||!preferences.speech||!voice||!('SpeechSynthesisUtterance'in window))return;
  cancelSpeech();const utterance=new SpeechSynthesisUtterance(text);utteranceRef.current=utterance;utterance.lang=locale;utterance.voice=voice;
  utterance.onend=()=>{if(utteranceRef.current===utterance){utteranceRef.current=null;setSpeaking(false);}};
  utterance.onerror=()=>{if(utteranceRef.current===utterance){utteranceRef.current=null;setSpeaking(false);setSpeechError(true);}};
  setSpeechError(false);try{window.speechSynthesis.speak(utterance);setSpeaking(true);}catch{utteranceRef.current=null;setSpeaking(false);setSpeechError(true);}
 };
 useEffect(()=>{
  if(!scope||!preferences.speech||!voice)return;
  const keys=new Set(Object.keys(catalogs[locale]));
  const listener=(event:FocusEvent)=>{if(event.target instanceof HTMLElement){const key=safeSpeechKey(event.target,keys);if(key)speak(t(key as MessageKey));}};
  window.addEventListener('focusin',listener);return()=>window.removeEventListener('focusin',listener);
 },[scopeKey,preferences.speech,voice,locale]);
 const value:AccessibilityContextValue={
  preferences,enabled:!!scope,storageError,fontError,speechError,voiceAvailable:!!voice,speaking,accountReducedMotion:reducedMotion,effectiveReducedMotion:preferences.motion||reducedMotion||systemMotion,inheritedReducedMotion:reducedMotion||systemMotion,
  update:(key,value)=>{
   if(!scope)return;
   const next={...preferences,[key]:value};setPreferences(next);const storage=getStorage();setStorageError(!storage||!saveAccessibility(storage,scope,next));
  },
  reset:()=>{if(!scope)return;setPreferences({...DEFAULT_ACCESSIBILITY});const storage=getStorage();setStorageError(!storage||!resetAccessibility(storage,scope));},
  stopSpeech:cancelSpeech,
  speakExample:()=>speak(SPEECH_EXAMPLES[locale]),
 };
 return <AccessibilityContext.Provider value={value}>{children}{scope&&preferences.guide&&<ReadingGuide/>}</AccessibilityContext.Provider>;
}
function ReadingGuide(){
 const [position,setPosition]=useState(()=>Math.round(window.innerHeight/2));
 useEffect(()=>{
  const pointer=(event:PointerEvent)=>setPosition(Math.min(window.innerHeight-4,Math.max(0,event.clientY+12)));
  const focus=(event:FocusEvent)=>{if(event.target instanceof HTMLElement){const anchor=event.target.closest('.a11y-control')??event.target;const rect=anchor.getBoundingClientRect();setPosition(Math.min(window.innerHeight-4,Math.max(0,rect.bottom+4)));}};
  window.addEventListener('pointermove',pointer);window.addEventListener('focusin',focus);return()=>{window.removeEventListener('pointermove',pointer);window.removeEventListener('focusin',focus);};
 },[]);
 return <div className="a11y-guide" style={{top:position}} aria-hidden="true" data-a11y-preserve/>;
}
export function AccessibilitySkipLink({targetId='main-content'}:{targetId?:string}){
 const {t}=useLocalization();return <a className="a11y-skip" href={`#${targetId}`} onClick={()=>document.getElementById(targetId)?.focus()}>{t('a11y.skip')}</a>;
}
type BooleanPreference=Exclude<keyof AccessibilityPreferences,'textSize'>;
const sections:{title:MessageKey;controls:{key:BooleanPreference;label:MessageKey;Icon:LucideIcon}[]}[]=[
 {title:'a11y.text',controls:[{key:'lineSpacing',label:'a11y.lineSpacing',Icon:ArrowDownUp},{key:'letterSpacing',label:'a11y.letterSpacing',Icon:ALargeSmall},{key:'bold',label:'a11y.bold',Icon:Bold},{key:'dyslexia',label:'a11y.dyslexia',Icon:CaseSensitive}]},
 {title:'a11y.color',controls:[{key:'contrast',label:'a11y.contrast',Icon:Contrast},{key:'saturation',label:'a11y.saturation',Icon:Droplets},{key:'invert',label:'a11y.invert',Icon:Blend},{key:'highContrast',label:'a11y.highContrast',Icon:Contrast}]},
 {title:'a11y.reading',controls:[{key:'links',label:'a11y.links',Icon:Link},{key:'headings',label:'a11y.headings',Icon:List},{key:'guide',label:'a11y.guide',Icon:Flashlight},{key:'images',label:'a11y.images',Icon:ImageOff}]},
 {title:'a11y.interaction',controls:[{key:'pointer',label:'a11y.pointer',Icon:MousePointer2},{key:'motion',label:'a11y.motion',Icon:CircleOff}]},
];
/** Owner composes this under /account/accessibility; controls save locally immediately as source V179. */
export function AccessibilitySettings(){
 const {t,locale}=useLocalization(),a=useAccessibility();const extra=createMessageTranslator(locale,accessibilityMessages),labels=createMessageTranslator(locale,accessibilityStatusMessages);const [statement,setStatement]=useState(false);const id=useId(),tabs=useRef<HTMLDivElement>(null);
 return <section className="a11y-settings" lang={locale} aria-labelledby="a11y-title">
  <header className="a11y-header"><h1 id="a11y-title">{t('a11y.title')}</h1>
  <div className="a11y-tabs" role="tablist" ref={tabs} aria-label={t('a11y.title')} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?false:event.key==='End'?true:!statement;setStatement(next);tabs.current?.querySelectorAll<HTMLButtonElement>('button')[next?1:0]?.focus();}}}><button id={`${id}-preferences`} type="button" role="tab" aria-selected={!statement} tabIndex={statement?-1:0} aria-controls={`${id}-panel`} onClick={()=>setStatement(false)}>{t('a11y.preferences')}</button><button id={`${id}-statement`} type="button" role="tab" aria-selected={statement} tabIndex={statement?0:-1} aria-controls={`${id}-panel`} onClick={()=>setStatement(true)}>{t('a11y.statement')}</button></div></header>
  <div className="a11y-body" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${statement?'statement':'preferences'}`} tabIndex={0}>
  {statement?<p>{t('a11y.statementText')}</p>:<>
   <h2>{t('a11y.personalize')}</h2><p>{t('a11y.scope')}</p>
   {a.storageError&&<p className="a11y-status" role="status">{t('a11y.storageError')}</p>}
   <fieldset disabled={!a.enabled} className="a11y-speech"><legend>{t('a11y.speech')}</legend><label className="a11y-control a11y-speech-control"><span className="a11y-icon" aria-hidden="true"><Volume2 size={20}/></span><span className="a11y-card-label" data-a11y-text>{t('a11y.speech')}</span><input type="checkbox" role="switch" checked={a.preferences.speech} onChange={e=>a.update('speech',e.target.checked)} disabled={!a.voiceAvailable}/><span className="a11y-switch-track" aria-hidden="true"/></label>
    <p className="a11y-help">{t('a11y.speechHint')}</p>{!a.voiceAvailable&&<p className="a11y-help" role="status">{t('a11y.speechUnavailable')}</p>}
    {a.speechError&&<p role="status">{extra('speechFailed')}</p>}
    <button type="button" className="a11y-action" disabled={!a.preferences.speech||!a.voiceAvailable} onClick={a.speaking?a.stopSpeech:a.speakExample}>{t(a.speaking?'a11y.speechStop':'a11y.speechAction')}</button>
   </fieldset>
   {sections.map(section=><fieldset className={section.title==='a11y.interaction'?'a11y-interaction':''} key={section.title} disabled={!a.enabled}><legend>{t(section.title)}</legend>
    {section.title==='a11y.text'&&<label className="a11y-control a11y-size"><span className="a11y-icon" aria-hidden="true"><Type size={20}/></span><span className="a11y-card-label" data-a11y-text>{t('a11y.textSize')}</span><select data-orgmap-speech-key="a11y.textSize" value={a.preferences.textSize} onChange={e=>a.update('textSize',e.target.value as AccessibilityPreferences['textSize'])}>{(['default','large','extraLarge']as const).map(size=><option key={size} value={size}>{t(`a11y.${size}`)}</option>)}</select><span className="a11y-size-bars" aria-hidden="true">{[0,1,2].map((n)=><i key={n} data-active={n<=['default','large','extraLarge'].indexOf(a.preferences.textSize)}/>)}</span></label>}
    <div className="a11y-control-grid">{section.controls.map(({Icon,...control})=><label className="a11y-control a11y-card" data-checked={a.preferences[control.key]} key={control.key}><input type="checkbox" data-orgmap-speech-key={control.label} checked={a.preferences[control.key]} onChange={e=>a.update(control.key,e.target.checked)}/><span className="a11y-icon" aria-hidden="true"><Icon size={20}/></span><span className="a11y-card-copy"><span className="a11y-card-label" data-a11y-text>{t(control.label)}</span>{(control.key==='contrast'||control.key==='saturation')&&<span className="a11y-card-status" data-a11y-text>{labels(control.key==='saturation'?(a.preferences.saturation?'enabledFeminine':'disabledFeminine'):(a.preferences.contrast?'enabled':'disabled'))}</span>}</span>{a.preferences[control.key]&&<span className="a11y-checked-indicator" aria-hidden="true"><Check size={14}/></span>}</label>)}</div>
    {section.title==='a11y.text'&&a.preferences.dyslexia&&<p>{extra('fontCoverage')} <a href={new URL('./assets/OFL.txt',import.meta.url).href}>OpenDyslexic · SIL OFL 1.1</a></p>}
    {section.title==='a11y.reading'&&a.preferences.images&&<p>{extra('imageHint')}</p>}
    {section.title==='a11y.interaction'&&a.inheritedReducedMotion&&<p>{extra('motionInherited')}</p>}
   </fieldset>)}
   {a.fontError&&<p role="status" className="a11y-status">{extra('fontFailure')}</p>}
   <div className="a11y-reset"><h2 className="a11y-reset-title">{labels('resetHeading')}</h2><p className="a11y-reset-help">{labels('resetHelper')}</p><div className="a11y-reset-actions"><button type="button" className="a11y-action" onClick={a.reset} disabled={!a.enabled}>{t('a11y.reset')}</button></div></div>
  </>}
 </div></section>;
}

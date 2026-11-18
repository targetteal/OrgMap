import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { FeatureContext } from "../../feature-contract";
import { RequestError } from "../../api";
import "./assistant-settings.css";
import {useLocalization} from "../../localization";
import {assistantTranslator,type AssistantMessage} from "./assistant-messages";
type Settings={revision:number;instructions:string;updatedAt:string|null};
type Scope="personal"|"workspace";
type Editor={current:Settings|null;draft:string;error:AssistantMessage|'';stale:boolean;loading:boolean;busy:boolean;notice:AssistantMessage|''};
const fresh=():Editor=>({current:null,draft:"",error:"",stale:false,loading:true,busy:false,notice:""});
const tabs=[['activation','activation'],['preferences','preferences'],['instructions','instructions'],['knowledge','knowledge'],['usage','usage']] as const;
type Tab=typeof tabs[number][0];
export function AssistantSettings({context}:{context:FeatureContext}) { return <AssistantSettingsBody key={context.organizationId} context={context}/>; }
function AssistantSettingsBody({context:c}:{context:FeatureContext}) {
  const {locale}=useLocalization(), t=assistantTranslator(locale);
  const base=`/organizations/${c.organizationId}/administration/assistant`, [tab,setTab]=useState<Tab>('activation');
  const [personal,setPersonal]=useState<Editor>(fresh),[workspace,setWorkspace]=useState<Editor>(fresh), [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
  const requestKeys=useRef<Record<Scope,string|null>>({personal:null,workspace:null}), abort=useRef<AbortController|null>(null), buttons=useRef<(HTMLButtonElement|null)[]>([]), pending=useRef<Record<Scope,boolean>>({personal:false,workspace:false});
  const set=(scope:Scope)=>scope==='personal'?setPersonal:setWorkspace;
  async function loadStatus(signal:AbortSignal) {
    setStatus('loading');
    try { const r=await c.api<{capabilities:{configuration:boolean;execution:boolean;rag:boolean};usage:{status:string;requests:number|null;tokens:number|null}}>(base+'/status',{signal});
      if (!signal.aborted) setStatus(r.data?.capabilities?.configuration===true && r.data.capabilities.execution===false && r.data.capabilities.rag===false && r.data.usage?.status==='NO_DATA' && r.data.usage.requests===null && r.data.usage.tokens===null ? 'ready':'error');
    } catch { if(!signal.aborted)setStatus('error'); }
  }
  useEffect(()=>{const ctrl=new AbortController();abort.current=ctrl;void loadStatus(ctrl.signal); for(const scope of ['personal','workspace'] as const) void load(scope,false,ctrl.signal);return ()=>ctrl.abort();},[base]);
  async function load(scope:Scope,preserve:boolean,signal:AbortSignal) {
    const update=set(scope);update(v=>({...v,loading:true,error:""}));
    try {const result=await c.api<{settings:Settings}>(base+'/'+scope,{signal});if(!signal.aborted){update(v=>({...v,current:result.data.settings,draft:preserve?v.draft:result.data.settings.instructions,loading:false,stale:false,error:""}));requestKeys.current[scope]=null;}}
    catch(e){if(!signal.aborted)update(v=>({...v,loading:false,error:e instanceof RequestError && e.code==='ACTION_DENIED'?'denied':'loadError'}));}
  }
  async function save(scope:Scope) {
    const value=scope==='personal'?personal:workspace,signal=abort.current?.signal;
    if(!signal||signal.aborted||pending.current[scope]||!value.current||value.stale)return;
    pending.current[scope]=true;const update=set(scope);update(v=>({...v,busy:true,error:"",notice:""}));
    try {const k=requestKeys.current[scope]??=crypto.randomUUID();const result=await c.api<{settings:Settings}>(base+'/'+scope,{method:'PUT',body:{instructions:value.draft},version:value.current.revision,key:k,signal});if(!signal.aborted){update(v=>({...v,current:result.data.settings,draft:result.data.settings.instructions,notice:'saved',busy:false}));requestKeys.current[scope]=null;}}
    catch(e){if(!signal.aborted)update(v=>({...v,busy:false,stale:e instanceof RequestError && e.code==='VERSION_CONFLICT',error:e instanceof RequestError && e.code==='VERSION_CONFLICT'?'conflict':'saveError'}));}
    finally {pending.current[scope]=false;}
  }
  function keys(event:KeyboardEvent<HTMLButtonElement>,index:number){let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();setTab(tabs[next][0]);buttons.current[next]?.focus();}
  function editor(scope:Scope) {
    const e=scope==='personal'?personal:workspace,update=set(scope),title=t(scope==='personal'?'personalTitle':'workspaceTitle');
    return <div><h3>{title}</h3><p>{t(scope==='personal'?'personalHelp':'workspaceHelp')} {t('futureHelp')}</p>
      {e.loading ? <p role="status">{t('loadingInstructions')}</p> : <>{e.error && <p role="alert">{t(e.error)}</p>}{!e.current ? <button type="button" onClick={()=>{const s=abort.current?.signal;if(s)void load(scope,false,s);}}>{t('retry')}</button> : <>
        <label htmlFor={`assistant-${scope}`}>{t('instructions')}</label><textarea id={`assistant-${scope}`} maxLength={10000} rows={6} value={e.draft} disabled={e.busy} onChange={event=>{requestKeys.current[scope]=null;update(v=>({...v,draft:event.target.value,notice:""}));}} />
        <p>{t('version')} {e.current.revision}</p>{e.notice && <p role="status">{t(e.notice)}</p>}
        <div className="assistant-actions"><button type="button" className="primary" disabled={e.busy||e.stale||e.draft===e.current.instructions} onClick={()=>void save(scope)}>{t(e.busy?'saving':'save')}</button>{e.stale && <button type="button" disabled={e.busy} onClick={()=>{const s=abort.current?.signal;if(s)void load(scope,true,s);}}>{t('refresh')}</button>}</div>
      </>}</>}
    </div>;
  }
  return <section className="admin-settings admin-security assistant-settings"><h2>{t('title')}</h2><div className="assistant-tabs" role="tablist" aria-label={t('title')}>{tabs.map(([id,label],i)=><button key={id} ref={el=>{buttons.current[i]=el;}} id={`assistant-tab-${id}`} type="button" role="tab" aria-selected={tab===id} aria-controls={`assistant-panel-${id}`} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={e=>keys(e,i)}>{t(label)}</button>)}</div>
    {status==='loading'?<p role="status">{t('loadingCapabilities')}</p>:status==='error'?<div><p role="alert">{t('statusError')}</p><button type="button" onClick={()=>{const signal=abort.current?.signal;if(signal)void loadStatus(signal);}}>{t('retry')}</button></div>:<div id={`assistant-panel-${tab}`} role="tabpanel" aria-labelledby={`assistant-tab-${tab}`} tabIndex={0}>
      {tab==='activation'&&<><h3>{t('activation')}</h3><p>{t('activationHelp')}</p><button type="button" disabled>{t('activate')}</button></>}
      {tab==='preferences'&&editor('personal')}{tab==='instructions'&&editor('workspace')}
      {tab==='knowledge'&&<><h3>{t('knowledge')}</h3><p>{t('knowledgeHelp')}</p><button type="button" disabled>{t('activateKnowledge')}</button></>}
      {tab==='usage'&&<><h3>{t('usage')}</h3><p>{t('usageHelp')}</p></>}
    </div>}
  </section>;
}

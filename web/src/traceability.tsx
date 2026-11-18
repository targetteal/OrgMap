import { useEffect, useState } from 'react';
import type { FeatureContext } from './feature-contract';
import { traceTranslator } from './traceability-messages';
import './traceability.css';

export type TraceReference = { kind:'TENSION'|'TASK'|'PROJECT'|'GOAL'|'AGENDA'|'MEETING'|'PROPOSAL'; id:string; title:string; meetingId?:string };
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

/** Accept only known, local trace destinations and their supported query keys. */
export function safeReturnTo(value: string | null | undefined): string | null {
 if(!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f#]/.test(value))return null;
 let url:URL;try{url=new URL(value,'https://trace.invalid');}catch{return null;}
 if(url.origin!=='https://trace.invalid'||url.username||url.password||url.hash||url.pathname.includes('%'))return null;
 const path=url.pathname, id='[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}';
 const simple=new RegExp(`^(?:/projects/tasks/${id}|/projects/${id}|/goals/${id}|/structure/proposals/${id}|/structure/working-agreements/${id})$`);
 if(simple.test(path))return url.search ? null : path;
 if(path==='/structure/tensions') {
  const entries=[...url.searchParams.entries()];
  return entries.length===1 && entries[0][0]==='tensionId' && uuid.test(entries[0][1]) ? `${path}?tensionId=${entries[0][1].toLowerCase()}` : null;
 }
 if(new RegExp(`^/meetings/${id}$`).test(path)) {
  const entries=[...url.searchParams.entries()];
  return entries.length===0 ? path : entries.length===1 && entries[0][0]==='step' && entries[0][1]==='agenda' ? `${path}?step=agenda` : null;
 }
 return null;
}
export function traceRoute(ref: TraceReference, returnTo?: string | null): string | null {
 if(!ref || !uuid.test(ref.id))return null;
 const id=ref.id.toLowerCase();let path:string;
 switch(ref.kind){
  case 'TENSION':path=`/structure/tensions?tensionId=${id}`;break;
  case 'TASK':path=`/projects/tasks/${id}`;break;
  case 'PROJECT':path=`/projects/${id}`;break;
  case 'GOAL':path=`/goals/${id}`;break;
  case 'PROPOSAL':path=`/structure/proposals/${id}`;break;
  case 'AGENDA':if(!ref.meetingId || !uuid.test(ref.meetingId))return null;path=`/meetings/${ref.meetingId.toLowerCase()}?step=agenda`;break;
  case 'MEETING':path=`/meetings/${id}?step=agenda`;break;
  default:return null;
 }
 const back=safeReturnTo(returnTo);return back ? path+(path.includes('?')?'&':'?')+'returnTo='+encodeURIComponent(back) : path;
}

function validEndpoint(organizationId:string, endpoint:string):boolean {
 if(!uuid.test(organizationId) || typeof endpoint!=='string')return false;
 const id='[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}';
 const prefix=`/organizations/${organizationId}/`;
 if(!endpoint.startsWith(prefix))return false;
 return new RegExp(`^(?:work/tasks/${id}/origin|work/projects/${id}/origin|meetings/${id}/agenda/${id}/origin|meetings/${id}/outcomes|proposals/${id}/origin|goals/${id}/origin|tensions/${id}/trace)$`).test(endpoint.slice(prefix.length));
}

type State<T>={key:string;status:'loading'|'ready'|'error';data:T|null};
function useTrace<T>(c:FeatureContext,endpoint:string,guest:boolean) {
 const account=c.session.account.id, key=JSON.stringify([
  c.organizationId,account,endpoint,guest,c.bootstrap.membership.id,
  c.bootstrap.authorizationRevision,c.structure?.structureRevision,
  ...['governance','work','goals','meetings'].map(module=>c.bootstrap.modules?.[module]),
 ]);
 const [state,setState]=useState<State<T>>({key:'',status:'loading',data:null});
 useEffect(()=>{
  if(guest)return;
  if(!validEndpoint(c.organizationId,endpoint)){setState({key,status:'error',data:null});return;}
  const ctrl=new AbortController();setState({key,status:'loading',data:null});
  void c.api<T>(endpoint,{signal:ctrl.signal}).then(r=>{if(!ctrl.signal.aborted)setState({key,status:'ready',data:r.data});},()=>{if(!ctrl.signal.aborted)setState({key,status:'error',data:null});});
  return ()=>ctrl.abort();
 },[key,c.api,endpoint,guest]);
 return guest ? null : state.key===key ? state : {key,status:'loading' as const,data:null};
}
type Props={context:FeatureContext;endpoint:string;returnTo?:string|null;disabled?:boolean};
function Link({reference,context,returnTo,disabled}:{reference:TraceReference;context:FeatureContext;returnTo?:string|null;disabled?:boolean}){
 const route=traceRoute(reference,returnTo),t=traceTranslator(context.accountPreferences?.locale??'pt-BR');
 if(!route || typeof reference.title!=='string' || !reference.title.trim())return null;
 return <button className="trace-links__link" type="button" disabled={disabled} onClick={()=>context.navigate(route)}>{t(reference.kind)}: {reference.title}</button>;
}
export function TraceOrigin({context:c,endpoint,returnTo,disabled}:Props){
 const guest=c.bootstrap.membership.memberType==='GUEST',state=useTrace<{origin:TraceReference|null}>(c,endpoint,guest),t=traceTranslator(c.accountPreferences?.locale??'pt-BR');
 if(!state)return null;
 if(state.status==='loading')return <p role="status">{t('loading')}</p>;
 if(state.status==='error')return <p role="status">{t('error')}</p>;
 const origin=state.data?.origin;if(!origin || !traceRoute(origin) || typeof origin.title!=='string' || !origin.title.trim())return null;
 return <section className="trace-links" aria-label={t('origin')}><strong className="trace-links__title">{t('origin')}</strong>{' '}<Link reference={origin} context={c} returnTo={returnTo} disabled={disabled}/></section>;
}
export function TensionDestinations({context:c,endpoint,returnTo,disabled}:Props){
 const guest=c.bootstrap.membership.memberType==='GUEST',state=useTrace<{items:TraceReference[]}>(c,endpoint,guest),t=traceTranslator(c.accountPreferences?.locale??'pt-BR');
 if(!state)return null;
 if(state.status==='loading')return <p role="status">{t('loading')}</p>;
 if(state.status==='error')return <p role="status">{t('error')}</p>;
 const items=Array.isArray(state.data?.items)?state.data.items.filter(item=>item && traceRoute(item) && typeof item.title==='string' && item.title.trim()):[];
 if(!items.length)return null;
 return <section className="trace-links" aria-label={t('destinations')}><strong className="trace-links__title">{t('destinations')}</strong><ul>{items.map(item=><li key={`${item.kind}:${item.id}`}><Link reference={item} context={c} returnTo={returnTo} disabled={disabled}/></li>)}</ul></section>;
}
export function TraceReturnLink({context:c,returnTo,disabled}:{context:FeatureContext;returnTo:string|null|undefined;disabled?:boolean}){
 const route=safeReturnTo(returnTo),t=traceTranslator(c.accountPreferences?.locale??'pt-BR');
 if(!route || c.bootstrap.membership.memberType==='GUEST')return null;
 return <button className="trace-links__link" type="button" disabled={disabled} onClick={()=>c.navigate(route)}>{t('back')}</button>;
}

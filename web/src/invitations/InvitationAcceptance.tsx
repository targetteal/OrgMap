import {useEffect,useRef,useState,type FormEvent} from 'react';
import {request,RequestError,type Session} from '../api';
import {resolveLocale,type Locale} from '../localization';
import {OrgMapBrand} from '../OrgMapBrand';
import {PublicLanguageSelector} from '../account/PublicLanguageSelector';
import {Button,Notice} from '../ui';
import {invitationTranslator} from './messages';
import './invitation-acceptance.css';
type Preview={organizationName:string;locale:string;emailHint:string;memberType:'MEMBER'|'GUEST';expiresAt:string};
type Props={token?:string;session:Session|null;locale:Locale;onLocaleChange:(locale:Locale)=>void;onToken:(token:string)=>void;onAuth:(register:boolean)=>void;onSwitchAccount:()=>Promise<void>;onAccepted:(organizationId:string)=>Promise<void>;onBack:()=>void;api?:typeof request};
export function InvitationAcceptance({token:initialToken,session,locale,onLocaleChange,onToken,onAuth,onSwitchAccount,onAccepted,onBack,api=request}:Props){
 const [token,setToken]=useState(initialToken??''),[preview,setPreview]=useState<Preview|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<'invalid'|'failure'|'openFailure'|null>(null),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[accepted,setAccepted]=useState<string|null>(null);
 const inFlight=useRef(false),commandKey=useRef(crypto.randomUUID()),alive=useRef(true),draft=useRef<HTMLInputElement>(null);
 const t=invitationTranslator(locale);
 useEffect(()=>{document.documentElement.lang=locale;},[locale]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(draft.current)draft.current.value='';};},[]);
 useEffect(()=>{
  if(!token)return;
  const ctrl=new AbortController();setLoading(true);setPreview(null);setError(null);
  void api<Preview>('/invitations/preview',{method:'POST',body:{token},signal:ctrl.signal}).then(result=>{
   if(ctrl.signal.aborted)return;setPreview(result.data);onLocaleChange(resolveLocale(result.data.locale));
  }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof RequestError&&['RESOURCE_NOT_FOUND','INVALID_REQUEST'].includes(e.code)?'invalid':'failure');}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return()=>ctrl.abort();
 },[token,retry,api]);
 function enterCode(e:FormEvent<HTMLFormElement>){e.preventDefault();const value=draft.current?.value.trim()??'';if(!/^[a-f0-9]{64}$/i.test(value)){setError('invalid');return;}onToken(value);setToken(value);if(draft.current)draft.current.value='';}
 async function accept(){
  if(inFlight.current||!session||!token)return;inFlight.current=true;setBusy(true);setError(null);
  try{const result=await api<{organizationId:string}>('/invitations/accept',{method:'POST',body:{token},key:commandKey.current});if(!alive.current)return;setAccepted(result.data.organizationId);try{await onAccepted(result.data.organizationId);}catch{if(alive.current)setError('openFailure');}}
  catch{if(alive.current)setError('failure');}finally{inFlight.current=false;if(alive.current)setBusy(false);}
 }
 async function switchAccount(){if(inFlight.current)return;inFlight.current=true;setBusy(true);try{await onSwitchAccount();}catch{if(alive.current)setError('failure');}finally{inFlight.current=false;if(alive.current)setBusy(false);}}
 return <main className="invitation-acceptance" aria-busy={loading||busy}>
  <header><OrgMapBrand/><PublicLanguageSelector locale={locale} onChange={onLocaleChange}/></header>
  <section className="invitation-card" aria-labelledby="invitation-heading">
   <h1 id="invitation-heading">{preview?t('title',{organization:preview.organizationName}):t('accept')}</h1>
   {loading&&<p role="status">{t('loading')}</p>}
   {error&&<Notice>{t(error)}</Notice>}
   {accepted?<><p role="status">{t('joined')}</p><Button className="primary" disabled={busy} onClick={()=>void onAccepted(accepted).catch(()=>setError('openFailure'))}>{t('open')}</Button></>:preview?<>
    <p>{t('intro')}</p><p className="invitation-email">{t('email',{email:preview.emailHint})}</p>
    <p>{t('expires',{date:new Intl.DateTimeFormat(locale,{dateStyle:'long',timeStyle:'short'}).format(new Date(preview.expiresAt))})}</p>
    {preview.memberType==='GUEST'&&<p>{t('limited')}</p>}
    {session?<><p>{t('currentAccount',{email:session.account.email})}</p><div className="invitation-actions"><Button className="primary" disabled={busy} onClick={()=>void accept()}>{t(busy?'accepting':'accept')}</Button><Button disabled={busy} onClick={()=>void switchAccount()}>{t('switchAccount')}</Button></div></>:<div className="invitation-actions"><Button className="primary" onClick={()=>onAuth(false)}>{t('signIn')}</Button><Button onClick={()=>onAuth(true)}>{t('register')}</Button></div>}
   </>:!loading&&!token?<><p>{t('codeHelp')}</p><form onSubmit={enterCode}><label className="field">{t('code')}<input ref={draft} type="password" autoComplete="one-time-code" name="invitationCode" required maxLength={64} pattern="[a-fA-F0-9]{64}"/></label><button className="primary">{t('continue')}</button></form></>:null}
   {error&&!accepted&&token&&<Button disabled={busy||loading} onClick={()=>setRetry(n=>n+1)}>{t('retry')}</Button>}
   <footer><Button disabled={busy} onClick={onBack}>{t('back')}</Button></footer>
  </section>
 </main>;
}

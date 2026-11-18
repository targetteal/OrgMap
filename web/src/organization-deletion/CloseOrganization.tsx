import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { FeatureContext } from '../feature-contract';
import { RequestError } from '../api';
import { Dialog, Field, Notice } from '../ui';
import { useLocalization } from '../localization';
import { deletionTranslator } from './messages';
import './organization-deletion.css';

type Preflight={organizationVersion:number;dependentAccounts:number;continuityBlockedAccounts:number;pendingFederatedSessions:number;canAccept:boolean;available:boolean;backupCopies:'UNKNOWN'};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function CloseOrganization({context:c}:{context:FeatureContext}) {
 const {locale,formatNumber}=useLocalization(),t=deletionTranslator(locale);
 const owner=c.bootstrap.membership.orgRole==='OWNER'&&c.bootstrap.membership.memberType!=='GUEST';
 const scope=JSON.stringify([c.organizationId,c.session.account.id,c.bootstrap.membership.id,owner,c.bootstrap.authorizationRevision]);
 const [inspection,setInspection]=useState<{scope:string;data:Preflight|null;error:boolean;loading:boolean}>({scope:'',data:null,error:false,loading:false});
 const [dialog,setDialog]=useState(false),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState(''),[password,setPassword]=useState(''),[totp,setTotp]=useState(''),[error,setError]=useState('');
 const pending=useRef(false),reason=useRef(''),controller=useRef<AbortController|null>(null),activeScope=useRef(scope),mounted=useRef(true),generation=useRef(0),attempt=useRef<{signature:string;key:string}|null>(null);
 if(activeScope.current!==scope)generation.current++;
 reason.current=t('pendingRequest');activeScope.current=scope;
 useEffect(()=>{mounted.current=true;const unload=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{mounted.current=false;window.removeEventListener('beforeunload',unload);};},[]);
 useEffect(()=>c.registerNavigationGuard?.(()=>pending.current?reason.current:null),[c.registerNavigationGuard]);
 useEffect(()=>()=>controller.current?.abort(),[scope]);
 useEffect(()=>{pending.current=false;setBusy(false);setDialog(false);setConfirmation('');setPassword('');setTotp('');setError('');attempt.current=null;},[scope]);
 const current=inspection.scope===scope?inspection:{scope,data:null,error:false,loading:false};
 function close(){if(pending.current)return;setDialog(false);setConfirmation('');setPassword('');setTotp('');setError('');attempt.current=null;}
 async function inspect(){
  controller.current?.abort();const ctrl=new AbortController();controller.current=ctrl;
  setInspection({scope,data:null,error:false,loading:true});close();
  try{
   const result=await c.api<Preflight>(`/organizations/${c.organizationId}/deletion-preflight`,{signal:ctrl.signal});
   if(!ctrl.signal.aborted&&activeScope.current===scope){
    const value=result.data;
    if(!Number.isSafeInteger(value.organizationVersion)||value.organizationVersion<1||![value.dependentAccounts,value.continuityBlockedAccounts,value.pendingFederatedSessions].every(n=>Number.isSafeInteger(n)&&n>=0)||typeof value.available!=='boolean'||typeof value.canAccept!=='boolean'||value.backupCopies!=='UNKNOWN')throw Error('Invalid preflight');
    setInspection({scope,data:value,error:false,loading:false});
   }
  }catch{if(!ctrl.signal.aborted&&activeScope.current===scope)setInspection({scope,data:null,error:true,loading:false});}
 }
 async function submit(event:FormEvent){
  event.preventDefault();const value=current.data;
  if(pending.current||!owner||!value?.canAccept||!value.available||confirmation!==c.bootstrap.organization.name)return;
  const body={confirmationOrganizationId:c.organizationId,confirmationName:confirmation,...(password?{currentPassword:password}:{}),...(totp?{totpCode:totp}:{})};
  const signature=JSON.stringify([scope,value.organizationVersion,body]);
  const requestGeneration=generation.current;
  if(attempt.current?.signature!==signature)attempt.current={signature,key:crypto.randomUUID()};
  pending.current=true;setBusy(true);setError('');
  try{
   const result=await c.api<{jobId:string;reauthenticationRequired:boolean}>(`/organizations/${c.organizationId}/deletion-requests`,{method:'POST',body,version:value.organizationVersion,key:attempt.current.key,signal:AbortSignal.timeout(30000)});
   if(!mounted.current||activeScope.current!==scope||generation.current!==requestGeneration)return;
   if(!uuid.test(result.data.jobId)||typeof result.data.reauthenticationRequired!=='boolean')throw Error('Invalid closure response');
   pending.current=false;setBusy(false);close();
   if(c.onOrganizationClosed)await c.onOrganizationClosed({organizationId:c.organizationId,jobId:result.data.jobId,reauthenticationRequired:result.data.reauthenticationRequired});
   else {c.navigate(`/account/organization-deletions/${result.data.jobId}`);await c.refreshSession?.();}
  }catch(cause){
   if(mounted.current&&activeScope.current===scope&&generation.current===requestGeneration){const code=cause instanceof RequestError?cause.code:'';
    setError(t(code==='AUTH_CONTINUITY_REQUIRED'?'errorContinuity':code==='VERSION_CONFLICT'?'errorVersion':code==='CONFIRMATION_INVALID'?'errorConfirmation':/AUTH|MFA|TOTP/.test(code)?'errorReauth':code==='DELETION_OPERATIONS_UNAVAILABLE'?'unavailable':'requestFailed'));
   }
  }finally{if(mounted.current&&generation.current===requestGeneration){pending.current=false;setBusy(false);}}
 }
 if(!owner)return null;
 return <section className="organization-closure" aria-label={t('closeTitle')}>
  <h2>{t('closeTitle')}</h2><p>{t('closeDescription')}</p><p className="muted">{t('backupUnknown')}</p>
  <button type="button" disabled={busy||current.loading} onClick={()=>void inspect()}>{t('inspect')}</button>
  {current.loading&&<p role="status">{t('loading')}</p>}
  {(current.error||current.data&&!current.data.available)&&<Notice>{t('unavailable')}</Notice>}
  {current.data&&<>
   {current.data.continuityBlockedAccounts>0&&<Notice>{t('continuity',{count:formatNumber(current.data.continuityBlockedAccounts)})}</Notice>}
   {current.data.available&&!current.data.canAccept&&current.data.continuityBlockedAccounts===0&&<Notice>{t('operator')}</Notice>}
   <p>{t('sessions',{count:formatNumber(current.data.pendingFederatedSessions)})}</p>
   {current.data.canAccept&&current.data.available&&<button type="button" className="danger" disabled={busy} onClick={()=>setDialog(true)}>{t('review')}</button>}
  </>}
  {dialog&&current.data?.canAccept&&<Dialog title={t('review')} onClose={close}>
   <form className="edit-form" onSubmit={event=>void submit(event)}>
    <p><strong>{c.bootstrap.organization.name}</strong></p><p>{t('noUndo')}</p>
    {error&&<Notice>{error}</Notice>}
    {error&&!busy&&<button type="button" onClick={()=>{close();c.navigate('/account/organization-deletions');}}>{t('closures')}</button>}
    <Field label={t('confirmationName')} name="confirmationName"><input name="confirmationName" value={confirmation} autoComplete="off" required disabled={busy} onChange={event=>setConfirmation(event.target.value)} /></Field>
    <Field label={t('currentPassword')} name="currentPassword"><input name="currentPassword" type="password" autoComplete="current-password" value={password} disabled={busy} onChange={event=>setPassword(event.target.value)} /></Field>
    <Field label={t('totp')} name="totpCode"><input name="totpCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={totp} maxLength={6} disabled={busy} onChange={event=>setTotp(event.target.value)} /></Field>
    <div className="dialog-actions"><button type="button" disabled={busy} onClick={close}>{t('cancel')}</button><button type="submit" className="danger" disabled={busy||confirmation!==c.bootstrap.organization.name}>{t('confirm')}</button></div>
   </form>
  </Dialog>}
 </section>;
}

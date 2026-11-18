import { useEffect, useState } from 'react';
import { request } from '../api';
import { useLocalization } from '../localization';
import { Notice } from '../ui';
import { deletionTranslator, type DeletionMessageKey } from './messages';
import './organization-deletion.css';
type Receipt={jobId:string;organizationId:string;state:string;phase:string;acceptedAt:string;completedAt:string|null;primaryPurge:'PENDING'|'COMPLETE';localObjects:number|null;localBytes:number|null;remoteEffects:'UNKNOWN';backupCopies:'UNKNOWN';needsOperator:boolean};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const phases=['QUIESCE','INVENTORY','PURGE','BLOBS','FINALIZE','COMPLETED'];
function valid(value:any):value is Receipt{return !!value&&uuid.test(value.jobId)&&uuid.test(value.organizationId)&&phases.includes(value.phase)&&['PENDING','RUNNING','FAILED','COMPLETED'].includes(value.state)&&Number.isFinite(Date.parse(value.acceptedAt))&&['PENDING','COMPLETE'].includes(value.primaryPurge)&&value.remoteEffects==='UNKNOWN'&&value.backupCopies==='UNKNOWN'&&typeof value.needsOperator==='boolean'&&(value.primaryPurge!=='COMPLETE'||value.state==='COMPLETED'&&value.phase==='COMPLETED'&&Number.isFinite(Date.parse(value.completedAt))&&Number.isSafeInteger(value.localObjects)&&value.localObjects>=0&&Number.isSafeInteger(value.localBytes)&&value.localBytes>=0);}
export function OrganizationDeletionReceipts({accountId,path,navigate}:{accountId:string;path:string;navigate:(path:string)=>void}) {
 const {locale,formatInstant,formatNumber}=useLocalization(),t=deletionTranslator(locale),[revision,setRevision]=useState(0);
 const match=/^\/account\/organization-deletions\/([^/?#]+)$/.exec(path.split('?')[0]),jobId=match?.[1];
 const cursor=new URLSearchParams(path.split('?')[1]??'').get('cursor');
 const key=JSON.stringify([accountId,path,revision]);
 const [response,setResponse]=useState<{key:string;items:Receipt[];cursor:string|null;error:boolean;loading:boolean}>({key:'',items:[],cursor:null,error:false,loading:true});
 const current=response.key===key?response:{key,items:[],cursor:null,error:false,loading:true};
 useEffect(()=>{
  const ctrl=new AbortController();setResponse({key,items:[],cursor:null,error:false,loading:true});
  if(!accountId||jobId&&!uuid.test(jobId)||cursor&&!/^[A-Za-z0-9_-]{1,256}$/.test(cursor)){setResponse({key,items:[],cursor:null,error:true,loading:false});return;}
  void request<any>('/account/organization-deletions'+(jobId?'/'+jobId:cursor?'?cursor='+encodeURIComponent(cursor):''),{signal:ctrl.signal}).then(result=>{
   if(ctrl.signal.aborted)return;
   const items=jobId?[result.data]:result.data.items;
   if(!Array.isArray(items)||!items.every(valid)||jobId&&items[0]?.jobId!==jobId)throw Error('Invalid status');
   const next=jobId?null:result.data.page?.nextCursor??null;
   if(next!==null&&(typeof next!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(next)))throw Error('Invalid cursor');
   setResponse({key,items,cursor:next,error:false,loading:false});
  }).catch(()=>{if(!ctrl.signal.aborted)setResponse({key,items:[],cursor:null,error:true,loading:false});});
  return()=>ctrl.abort();
 },[key,accountId,jobId,cursor]);
 return <section className="organization-closure-receipts">
  <div className="page-heading">{jobId?<h2>{t('receiptTitle')}</h2>:<p>{t('requesterOnly')}</p>}<button type="button" onClick={()=>setRevision(n=>n+1)} disabled={current.loading}>{t('refresh')}</button></div>
  {jobId&&<button type="button" onClick={()=>navigate('/account/organization-deletions')}>{t('back')}</button>}
  {current.loading?<p role="status">{t('loading')}</p>:current.error?<Notice>{t('unavailableReceipt')}</Notice>:!current.items.length?<p>{t('empty')}</p>:current.items.map(item=><article className="organization-closure-receipt" key={item.jobId}>
   <h2>{t(('phase.'+item.phase) as DeletionMessageKey)}</h2>
   <dl><div><dt>{t('organization')}</dt><dd className="organization-closure-reference">{item.organizationId}</dd></div><div><dt>{t('acceptedAt')}</dt><dd>{formatInstant(item.acceptedAt)}</dd></div></dl>
   <p><strong>{t(item.primaryPurge==='COMPLETE'?'primaryComplete':'primaryPending')}</strong></p>
   {item.completedAt&&<p>{t('completedAt')}: {formatInstant(item.completedAt)}</p>}
   {item.localObjects!==null&&<p>{t('localFiles',{count:formatNumber(item.localObjects)})}</p>}
   {item.needsOperator&&<Notice>{t('operator')}</Notice>}
   <p>{t('backupUnknown')}</p><p>{t('remoteUnknown')}</p>
   {!jobId&&<button type="button" onClick={()=>navigate('/account/organization-deletions/'+item.jobId)}>{t('open')}</button>}
  </article>)}
  {!jobId&&current.cursor&&<button type="button" onClick={()=>navigate('/account/organization-deletions?cursor='+encodeURIComponent(current.cursor!))}>{t('more')}</button>}
 </section>;
}

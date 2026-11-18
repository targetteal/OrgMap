import { useEffect, useState } from 'react';
import type { FeatureContext } from '../../feature-contract';
import { useLocalization, createMessageTranslator } from '../../localization';
import { Field, Notice } from '../../ui';
import { tensionTaskMessages } from './tension-task-messages';

type Project = { id:string; title:string; accessRole:string; frozen:boolean; archived?:boolean; visibility:string };
export function TensionTaskForm({context:c,disabled=false,error,onSubmit}:{context:FeatureContext;disabled?:boolean;error?:string;onSubmit:(projectId:string|null)=>Promise<void>}) {
 const {locale}=useLocalization(),t=createMessageTranslator(locale,tensionTaskMessages);
 const scope=JSON.stringify([c.organizationId,c.session.account.id,c.bootstrap.membership.id,c.bootstrap.membership.memberType,c.bootstrap.authorizationRevision]);
 const [response,setResponse]=useState<{scope:string;projects:Project[];status:'loading'|'ready'|'error'}>({scope:'',projects:[],status:'loading'});
 const [selection,setSelection]=useState<{scope:string;id:string}>({scope:'',id:''});
 const [attempt,setAttempt]=useState(0);
 const current=response.scope===scope?response:{scope,projects:[],status:'loading' as const};
 const projectId=selection.scope===scope?selection.id:'';
 useEffect(()=>{
  const ctrl=new AbortController();
  setResponse({scope,projects:[],status:'loading'});
  if(c.bootstrap.membership.memberType==='GUEST'){setResponse({scope,projects:[],status:'error'});return;}
  void c.api<{projects:Project[]}>(`/organizations/${c.organizationId}/work/projects`,{signal:ctrl.signal}).then(result=>{
   if(!ctrl.signal.aborted)setResponse({scope,status:'ready',projects:result.data.projects.filter(p=>['MANAGER','EDITOR'].includes(p.accessRole)&&!p.frozen&&!p.archived)});
  },()=>{if(!ctrl.signal.aborted)setResponse({scope,projects:[],status:'error'});});
  return()=>ctrl.abort();
 },[scope,attempt,c.api]);
 const selected=current.projects.find(p=>p.id===projectId);
 return <form className="gov-form" onSubmit={event=>{event.preventDefault();if(!disabled&&current.status==='ready'&&(!projectId||selected))void onSubmit(projectId||null);}}>
  {error&&<Notice>{error}</Notice>}
  {current.status==='loading'&&<p role="status">{t('loading')}</p>}
  {current.status==='error'&&<Notice>{t('error')} <button type="button" disabled={disabled} onClick={()=>setAttempt(n=>n+1)}>{t('retry')}</button></Notice>}
  <Field label={t('destination')} name="projectId">
   <select value={projectId} disabled={disabled||current.status!=='ready'} onChange={event=>setSelection({scope,id:event.target.value})}>
    <option value="">{t('personal')}</option>
    {current.projects.map(project=><option key={project.id} value={project.id}>{project.title} · {t(project.visibility==='PRIVATE'?'private':'organization')}</option>)}
   </select>
  </Field>
  <p>{selected?t('projectVisibility'):t('personalVisibility')}</p>
  <button type="submit" disabled={disabled||current.status!=='ready'||!!projectId&&!selected}>{t('create')}</button>
 </form>;
}

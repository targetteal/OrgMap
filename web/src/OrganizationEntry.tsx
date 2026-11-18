import {useEffect,useRef,useState} from 'react';
import type {Bootstrap} from './api';
import {request,errorMessage,RequestError} from './api';
import {RichTextView} from './editor/RichTextView';
import {Button,Dialog,Notice} from './ui';
import {entryLanding,entryMediaUrl,canApplyEntryLanding,skipGuestEntryError,type OrganizationEntry as Entry} from './organization-entry';
import './organization-entry.css';
export function OrganizationEntry({accountId,organizationId,bootstrap,path,implicitLanding,onResolved,navigate}:{accountId:string;organizationId:string;bootstrap:Bootstrap;path:string;implicitLanding:boolean;onResolved:()=>void;navigate:(path:string)=>void}){
 const [entry,setEntry]=useState<Entry|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[closed,setClosed]=useState(false),[revision,setRevision]=useState(0);
 const controller=useRef<AbortController|null>(null),arrival=useRef(path),attempt=useRef<{version:number;key:string}|null>(null),latest=useRef({bootstrap,path,implicitLanding,onResolved,navigate});latest.current={bootstrap,path,implicitLanding,onResolved,navigate};
 const base=`/organizations/${organizationId}/entry`;
 const finish=()=>{const current=latest.current;setClosed(true);current.onResolved();if(canApplyEntryLanding(current.implicitLanding,arrival.current,current.path))current.navigate(entryLanding(entry!.destination,current.bootstrap));};
 useEffect(()=>{const ctrl=new AbortController();controller.current=ctrl;setEntry(null);setError('');setClosed(false);setBusy(false);attempt.current=null;
 request<Entry>(base,{signal:ctrl.signal}).then(response=>{if(ctrl.signal.aborted)return;setEntry(response.data);if(response.data.acknowledged){const current=latest.current;setClosed(true);current.onResolved();if(canApplyEntryLanding(current.implicitLanding,arrival.current,current.path))current.navigate(entryLanding(response.data.destination,current.bootstrap));}}).catch(e=>{if(ctrl.signal.aborted)return;if(e instanceof RequestError&&skipGuestEntryError(latest.current.bootstrap,e.code)){setClosed(true);latest.current.onResolved();return;}setError(errorMessage(e));});return()=>ctrl.abort();},[accountId,base,revision]);
 async function acknowledge(){if(!entry||busy||!controller.current||controller.current.signal.aborted)return;setBusy(true);setError('');if(attempt.current?.version!==entry.revision)attempt.current={version:entry.revision,key:crypto.randomUUID()};
 try{await request(base+'/acknowledge',{method:'POST',body:{},version:entry.revision,key:attempt.current.key,signal:controller.current.signal});if(!controller.current.signal.aborted)finish();}catch(e){if(!controller.current.signal.aborted)setError(e instanceof RequestError&&e.code==='VERSION_CONFLICT'?'As boas-vindas foram atualizadas. Recarregue antes de confirmar.':errorMessage(e));}finally{if(!controller.current?.signal.aborted)setBusy(false);}}
 if(closed)return null;
 if(!entry)return error?<div className="organization-entry-error"><Notice>Não foi possível carregar as boas-vindas. {error}<Button onClick={()=>setRevision(v=>v+1)}>Tentar novamente</Button><Button onClick={()=>{setClosed(true);latest.current.onResolved();}}>Fechar aviso</Button></Notice></div>:null;
 if(entry.acknowledged)return null;
 const video=entryMediaUrl(entry.welcome.videoUrl),attachment=entryMediaUrl(entry.welcome.attachmentUrl),terms=entryMediaUrl(entry.legal.termsUrl),privacy=entryMediaUrl(entry.legal.privacyUrl);
 return <Dialog title={entry.welcome.title||'Boas-vindas'} onClose={()=>{if(!busy)void acknowledge();}}><div className="organization-entry-body">
 {error&&<Notice>{error}<Button disabled={busy} onClick={()=>setRevision(v=>v+1)}>Recarregar boas-vindas</Button></Notice>}
 <RichTextView value={entry.welcome.body}/>
 {video?<video controls preload="none" src={video} aria-label="Vídeo de boas-vindas"/>:<p className="muted">Continue para acessar o espaço de trabalho.</p>}
 {attachment&&<a href={attachment} target="_blank" rel="noopener noreferrer">Abrir material de boas-vindas</a>}
 {(entry.legal.name||entry.legal.address||terms||privacy||entry.legal.contactName||entry.legal.contactEmail||entry.legal.contactPhone)&&<details><summary>Informações da organização</summary><address>{entry.legal.name&&<strong>{entry.legal.name}</strong>}{entry.legal.address&&<p>{entry.legal.address}</p>}{entry.legal.contactName&&<p>{entry.legal.contactName}</p>}{entry.legal.contactEmail&&<p>{entry.legal.contactEmail}</p>}{entry.legal.contactPhone&&<p>{entry.legal.contactPhone}</p>}</address>{terms&&<a href={terms} target="_blank" rel="noopener noreferrer">Termos de uso</a>}{privacy&&<a href={privacy} target="_blank" rel="noopener noreferrer">Política de privacidade</a>}</details>}
 <div className="form-actions"><button type="button" className="primary" disabled={busy} onClick={()=>void acknowledge()}>{busy?'Confirmando…':'Continuar'}</button></div>
 </div></Dialog>;
}

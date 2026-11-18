import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {request,setCsrf,errorMessage,RequestError} from '../../api';
import type {FeatureContext} from '../../feature-contract';
import {StructureEntitySections} from './RoleFunctionEditor';
import '../../styles.css';
import './structure.css';
function Preview(){
 const [scenario,setScenario]=useState<any>(null),[error,setError]=useState(''),[log,setLog]=useState<string[]>([]),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const password='synthetic-p17-qa-password';
 async function login(email:string){const r=await request<any>('/auth/login',{method:'POST',body:{email,password}});setCsrf(r.data.csrfToken);}
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 async function setup(){
  const defaultPolicy=(await request<any>('/qa-policy')).data;
  const owner=crypto.randomUUID()+'@example.test',reader=crypto.randomUUID()+'@example.test';
  const a=await request<any>('/auth/register',{method:'POST',body:{email:owner,password,displayName:'Autora sintética'}});setCsrf(a.data.csrfToken);
  const b=await request<any>('/auth/register',{method:'POST',body:{email:reader,password,displayName:'Ocupante sintética'}});
  await login(owner);
  const org=(await request<any>('/organizations',{method:'POST',body:{name:'P17 · QA isolado'}})).data;
  const base='/organizations/'+org.organization.id,circleId=org.rootCircle.id;
  const member=(await request<any>(base+'/members',{method:'POST',body:{accountId:b.data.account.id}})).data.membership;
  await request(base+'/circles/'+circleId+'/memberships',{method:'POST',body:{memberId:member.id}});
  const role=(await request<any>(base+'/roles',{method:'POST',body:{name:'Guardiã de ciclos',circleId,mode:'DIRECT'}})).data.role;
  const doc=(await request<any>(base+'/documents',{method:'POST',body:{title:'Acordo sintético',ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Texto inicial'}})).data;
  const proposal=(await request<any>(base+'/proposals',{method:'POST',body:{title:'Rascunho reservado',circleId,kind:'DOCUMENT',payload:{documentId:doc.id,documentVersion:1}}})).data;
  await request(base+'/governance/policies',{method:'POST',body:{circleId,configuration:{...defaultPolicy,draftAccess:'AUTHOR_AND_LEAD_LINKS'}}});
  setScenario({owner,reader,base,role,member,proposal,orgId:org.organization.id});
 }
 async function check(){
  await login(scenario.reader);
  let result='';
  try {const r=await request<any>(scenario.base+'/proposals/'+scenario.proposal.id);result='Proposta: 200; pode editar: '+r.data.proposal.canEdit;}
  catch(e){if(e instanceof RequestError&&e.code==='RESOURCE_NOT_FOUND')result='Proposta: 404; acesso revogado/ausente';else throw e;}
  finally{await login(scenario.owner);}
  setLog(x=>[...x,result]);
 }
 const context={organizationId:scenario?.orgId,selectedEntity:{kind:'ROLE',entityId:scenario?.role.id},api:request,notify:setNotice} as FeatureContext;
 return <main className="sa-page" style={{maxWidth:700,margin:'24px auto',padding:24}}><h1>Guardiã de ciclos</h1><p>QA sintético local · API composta real · PostgreSQL efêmero</p>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{!scenario?<button disabled={busy} onClick={()=>void run(setup)}>Preparar cenário real</button>:<><StructureEntitySections context={context}/><section><h2>Verificação da proposta</h2><div className="form-actions"><button disabled={busy} onClick={()=>void run(check)}>Verificar como ocupante</button><button disabled={busy||!!scenario.occupancy} onClick={()=>void run(async()=>{const occupancy=(await request<any>(scenario.base+'/roles/'+scenario.role.id+'/occupancies',{method:'POST',body:{memberId:scenario.member.id,kind:'DIRECT',startsAt:'2020-01-01T00:00:00.000Z'}})).data.occupancy;setScenario({...scenario,occupancy});setLog(x=>[...x,'Ocupação criada']);})}>Ocupar papel</button><button disabled={busy||!scenario.occupancy} onClick={()=>void run(async()=>{await request(scenario.base+'/occupancies/'+scenario.occupancy.id+'/end',{method:'POST',version:scenario.occupancy.version,body:{}});setLog(x=>[...x,'Ocupação encerrada']);})}>Encerrar ocupação</button></div><ol>{log.map((entry,i)=><li key={i}>{entry}</li>)}</ol></section></>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);

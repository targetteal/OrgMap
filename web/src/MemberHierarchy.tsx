import {useEffect,useState} from 'react';
import type {Member} from './api';
import {request,errorMessage} from './api';
import {Button,Notice} from './ui';
import {initials} from './model';
import {memberHierarchy,type MemberProfileRelation,type HierarchyBranch} from './member-hierarchy';
import './member-hierarchy.css';
export function MemberHierarchy({organizationId,members,filtered,onOpen}:{organizationId:string;members:Member[];filtered:boolean;onOpen:(id:string)=>void}){
 const [profiles,setProfiles]=useState<MemberProfileRelation[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();setProfiles([]);setLoading(true);setError('');
 request<{items:MemberProfileRelation[]}>(`/organizations/${organizationId}/administration/profiles`,{signal:controller.signal}).then(response=>{
 if(controller.signal.aborted)return;if(!Array.isArray(response.data.items)||response.data.items.some(p=>!p.value||typeof p.value.memberId!=='string'||p.value.managerId!=null&&typeof p.value.managerId!=='string'))throw new Error('Dados de hierarquia incompatíveis.');setProfiles(response.data.items);
 }).catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[organizationId,revision]);
 let result;try{result=memberHierarchy(members,profiles);}catch(e){return <Notice>{errorMessage(e)}</Notice>;}
 const branch=(item:HierarchyBranch):React.ReactNode=><li key={item.member.id}><button type="button" className="member-hierarchy-node" onClick={()=>onOpen(item.member.id)}><span className="avatar" aria-hidden="true">{initials(item.member.displayName)}</span>{item.member.displayName}</button>{item.children.length>0&&<ul>{item.children.map(branch)}</ul>}</li>;
 if(loading)return <div className="mare-loading member-hierarchy-loading" role="status" aria-label="Carregando hierarquia…"><i/><i/><i/><i/><i/></div>;
 if(error)return <div className="member-hierarchy-error"><Notice>Não foi possível carregar as relações de hierarquia. {error}<Button onClick={()=>setRevision(v=>v+1)}>Tentar novamente</Button></Notice></div>;
 return <section className="member-hierarchy" aria-label="Hierarquia de pessoas">
 {result.incomplete&&<Notice>Algumas relações não podem ser exibidas com os membros disponíveis. A hierarquia apresentada é parcial.</Notice>}
 {!result.relationCount?<div className="member-hierarchy-empty"><p>Nenhuma hierarquia para exibir</p><small>{filtered||result.incomplete?'Nenhuma relação visível corresponde aos filtros atuais.':'Nenhuma relação de subordinação foi definida entre os perfis disponíveis.'}</small></div>:<ul className="member-hierarchy-tree">{result.roots.map(branch)}</ul>}
 </section>;
}

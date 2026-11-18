import {Circle, CircleDot, CircleCheck, CirclePause, CircleHelp} from 'lucide-react';
import type {Member,Structure} from './api';
import type {FeatureContext} from './feature-contract';
import {memberAffiliations} from './member-directory';
import {memberProfilePath,memberProfileTab,type MemberProfileTab} from './member-profile-route';
import {MemberActivity} from './member-profile';
import {MemberProfileIndicators} from './MemberProfileIndicators';
import {entityPath,initials} from './model';
import {Button} from './ui';

export function MemberProfileContent({member,structure,context,path,guest,owner,currentMemberId,navigate,onEdit}:{member:Member;structure:Structure|null;context:FeatureContext|null;path:string;guest:boolean;owner:boolean;currentMemberId:string;navigate:(path:string)=>void;onEdit:()=>void}) {
 const parsedTab=memberProfileTab(path), tab=guest && parsedTab!=='structure'?'general':parsedTab, from=new URLSearchParams(path.split('?')[1]??'').get('from');
 const affiliation=memberAffiliations(member.id,structure), complete=structure?.coverage.complete??false;
 const primaryTab=tab==='general'?'general':tab==='structure'?'structure':'activity';
 const link=(target:MemberProfileTab)=>memberProfilePath(member.id,target,from);
 const anchor=(target:MemberProfileTab,label:string,active:boolean)=><a key={target} href={link(target)} aria-current={active?'page':undefined} className={active?'tab-active':''} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate(link(target))}}}>{label}</a>;
 const status=member.status==='ACTIVE'?'Ativo':member.status==='SUSPENDED'?'Suspenso':'Estado não informado';
 const access=member.orgRole==='OWNER'?'Proprietário':member.orgRole==='MEMBER'?'Membro':'Acesso não informado';
 const type=member.memberType==='GUEST'?'Convidado':member.memberType==='MEMBER'?'Membro':'Tipo não informado';
 return <>
  <div className="mare-profile-identity"><span className="mare-member-avatar large" aria-hidden="true">{initials(member.displayName)}</span><div><h1>{member.displayName}</h1>{!guest&&<p><span className={'mare-member-state '+(member.status==='ACTIVE'?'active':member.status==='SUSPENDED'?'suspended':'unknown')}>{member.status==='ACTIVE'?<CircleCheck size={14} aria-hidden="true"/>:member.status==='SUSPENDED'?<CirclePause size={14} aria-hidden="true"/>:<CircleHelp size={14} aria-hidden="true"/>}{status}</span></p>}</div>{owner&&member.id!==currentMemberId&&member.orgRole!=='OWNER'&&<Button onClick={onEdit}>Alterar acesso</Button>}</div>
  <nav className="entity-tabs member-profile-tabs" aria-label="Perfil do membro">{anchor('general','Visão geral',primaryTab==='general')}{anchor('structure','Estrutura',primaryTab==='structure')}{!guest&&anchor('activity','Atividade',primaryTab==='activity')}</nav>
  <article className="entity-content mare-profile-body">
   {(tab==='general'||tab==='structure')&&<>
    {!complete&&<p className="muted">Os vínculos exibem apenas a estrutura visível neste acesso.</p>}
    <section><h3>Papéis que energiza <small>{affiliation.roles.length}</small></h3>{affiliation.roles.length?affiliation.roles.map(role=>{const relation=affiliation.occupancy.find(item=>item.roleId===role.entityId);const circle=structure?.nodes.find(node=>node.entityId===relation?.circleId);return <Button className="entity-row mare-profile-relation" key={role.entityId} onClick={()=>navigate(entityPath(role))}><Circle size={18}/><span><strong>{role.name}</strong><small>{circle?.name??'Círculo não disponível'}</small></span></Button>}):<p className="muted">{complete?'Nenhum papel atribuído.':'Nenhum papel visível neste acesso.'}</p>}</section>
    <section><h3>Círculos <small>{affiliation.circles.length}</small></h3><p className="muted">Participação por papéis ou associação explícita.</p>{affiliation.circles.length?affiliation.circles.map(circle=>{const explicit=affiliation.membership.some(relation=>relation.circleId===circle.entityId&&relation.origin==='EXPLICIT');const count=new Set(affiliation.occupancy.filter(relation=>relation.circleId===circle.entityId&&relation.roleId).map(relation=>relation.roleId)).size;return <Button className="entity-row mare-profile-relation" key={circle.entityId} onClick={()=>navigate(entityPath(circle))}><CircleDot size={18}/><span><strong>{circle.name}</strong><small>{explicit?(count?'Associação explícita e ocupação de papel':'Associação explícita'):`${count} ${count===1?'papel neste círculo':'papéis neste círculo'}`}</small></span></Button>}):<p className="muted">{complete?'Nenhum vínculo de círculo.':'Nenhum círculo visível neste acesso.'}</p>}</section>
    {!guest&&<section><h3>Na organização</h3><dl className="mare-profile-details"><div><dt>Estado</dt><dd>{status}</dd></div><div><dt>Tipo</dt><dd>{type}</dd></div><div><dt>Acesso</dt><dd>{access}</dd></div></dl></section>}
   </>}
   {primaryTab==='activity'&&!guest&&<><nav className="mare-profile-activity-nav" aria-label="Atividades e indicadores">{anchor('projects','Projetos',tab==='projects')}{anchor('goals','Objetivos',tab==='goals')}{anchor('metrics','Métricas',tab==='metrics')}{anchor('checklists','Checklists',tab==='checklists')}</nav>{!context?<p>Atividade indisponível neste acesso.</p>:tab==='activity'?<><MemberActivity context={context} memberId={member.id} kind="PROJECT"/><MemberActivity context={context} memberId={member.id} kind="GOAL"/></>:tab==='projects'||tab==='goals'?<MemberActivity context={context} memberId={member.id} kind={tab==='projects'?'PROJECT':'GOAL'}/>:<MemberProfileIndicators key={member.id+':'+tab} context={context} memberId={member.id} kind={tab==='metrics'?'METRIC':'CHECKLIST'}/>}</>}
  </article>
 </>;
}

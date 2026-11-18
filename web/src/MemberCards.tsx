import type { Member, Relation } from './api';
import { initials } from './model';
import './member-cards.css';
export function MemberCards({members,occupancies,complete,onOpen,minimal=false}:{members:Member[];occupancies:Relation[];complete:boolean;onOpen:(id:string)=>void;minimal?:boolean}) {
 const roles=new Map<string,Set<string>>();const now=Date.now();
 for(const relation of occupancies){
  if(!relation.roleId||Date.parse(relation.startsAt)>now||(relation.endsAt&&Date.parse(relation.endsAt)<=now))continue;
  const ids=roles.get(relation.memberId)??new Set<string>();ids.add(relation.roleId);roles.set(relation.memberId,ids);
 }
 return <div className="member-card-grid">{members.map(member=>{
  const count=roles.get(member.id)?.size??0;
  return <button type="button" className="member-card" key={member.id} onClick={()=>onOpen(member.id)} aria-label={`Abrir perfil de ${member.displayName}`}>
   <span className="member-card-cover" aria-hidden="true"/>
   <span className="member-card-avatar" aria-hidden="true">{initials(member.displayName)}</span>
   <span className="member-card-identity"><strong>{member.displayName}</strong>{!minimal && <span className="badge">{member.memberType==='GUEST'?'Convidado':member.orgRole==='OWNER'?'Proprietário':'Membro'}</span>}</span>
   {!minimal && <span className="member-card-count">{complete ? count ? `${count} ${count===1?'papel':'papéis'}` : 'Sem papéis' : count ? `${count} ${count===1?'papel visível':'papéis visíveis'}` : 'Papéis: cobertura parcial'}</span>}
  </button>;
 })}</div>;
}

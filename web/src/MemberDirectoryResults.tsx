import type {Member,Relation} from './api';
import {MemberCards} from './MemberCards';
import {groupDirectoryMembers,type MemberDirectoryOptions} from './member-directory';
import {Button} from './ui';
import {initials} from './model';
export function MemberDirectoryResults({members,view,group,occupancies,complete,onOpen,minimal=false}:{members:Member[];view:'list'|'cards';group:MemberDirectoryOptions['group'];occupancies:Relation[];complete:boolean;onOpen:(id:string)=>void;minimal?:boolean}){
 return <>{groupDirectoryMembers(members,group).map(section=><section className="member-directory-group" key={section.key} aria-label={section.label||undefined}>
 {section.label&&<h2 className="member-group-title">{section.label} <span>{section.members.length}</span></h2>}
 {view==='cards'?<MemberCards members={section.members} occupancies={occupancies} complete={complete} onOpen={onOpen} minimal={minimal}/>:<div className="table-scroll"><table><thead><tr><th>Nome</th>{!minimal&&<><th>Estado</th><th>Papel</th><th>Tipo</th></>}</tr></thead><tbody>{section.members.map(member=><tr key={member.id}>
 <td><Button className="member-name" onClick={()=>onOpen(member.id)}><span className="avatar" aria-hidden="true">{initials(member.displayName)}</span>{member.displayName}</Button></td>
 {!minimal&&<><td><span className={'badge '+(member.status==='ACTIVE'?'active-badge':'')}>{member.status==='ACTIVE'?'Ativo':'Suspenso'}</span></td>
 <td><span className="badge">{member.orgRole==='OWNER'?'Proprietário':'Membro'}</span></td>
 <td>{member.memberType==='GUEST'?'Convidado':'Membro'}</td></>}
 </tr>)}</tbody></table></div>}
 </section>)}</>;
}

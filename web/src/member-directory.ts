import type {Member} from './api';
import {structureReturnPath,platformEntityReturnPath} from './model';
export type MemberDirectoryOptions={view:'list'|'cards'|'hierarchy';status:'ALL'|'ACTIVE'|'SUSPENDED';type:'ALL'|'MEMBER'|'GUEST';role:'ALL'|'OWNER'|'MEMBER';group:'none'|'status'|'type'|'role'};
export function memberDirectoryOptions(path:string):MemberDirectoryOptions{
 const q=new URLSearchParams(path.split('?')[1]??'');
 return {group:['status','type','role'].includes(q.get('group')??'')?q.get('group') as MemberDirectoryOptions['group']:'none',view:q.get('view')==='hierarchy'?'hierarchy':q.get('view')==='cards'?'cards':'list',status:q.get('status')==='ACTIVE'?'ACTIVE':q.get('status')==='SUSPENDED'?'SUSPENDED':'ALL',type:q.get('type')==='MEMBER'?'MEMBER':q.get('type')==='GUEST'?'GUEST':'ALL',role:q.get('role')==='OWNER'?'OWNER':q.get('role')==='MEMBER'?'MEMBER':'ALL'};
}
export function memberDirectoryPath(options:MemberDirectoryOptions):string{
 const q=new URLSearchParams({view:options.view});for(const key of ['status','type','role'] as const)if(options[key]!=='ALL')q.set(key,options[key]);if(options.group!=='none')q.set('group',options.group);return '/members?'+q;
}
export function memberReturnPath(value:string|null):string{
 if(!value||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return '/members';
 try{
  const url=new URL(value,'http://orgmap.local');
  if(url.origin!=='http://orgmap.local')return '/members';
  if(url.pathname==='/members')return memberDirectoryPath(memberDirectoryOptions(value));
  if(url.pathname==='/structure'||url.pathname==='/structure/directory')return structureReturnPath(value);
  if(!/^\/(?:roles|circles)\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(url.pathname))return '/members';
  const origin=url.searchParams.get('from');
  if(!origin)return url.pathname;
  // Preserve only known local structure or resource-list origins.
  if(!origin.startsWith('/')||origin.startsWith('//')||origin.includes('\\'))return url.pathname;
  const nested=new URL(origin,'http://orgmap.local');
  const platformOrigin=platformEntityReturnPath(origin);
  if(platformOrigin)return url.pathname+'?from='+encodeURIComponent(platformOrigin);
  if(nested.origin!=='http://orgmap.local'||!['/structure','/structure/directory'].includes(nested.pathname))return url.pathname;
  return url.pathname+'?from='+encodeURIComponent(structureReturnPath(origin));
 }catch{return '/members';}
}
export function selectDirectoryMembers(members:Member[],options:MemberDirectoryOptions,query:string):Member[]{
 return members.filter(m=>(options.status==='ALL'||m.status===options.status)&&(options.type==='ALL'||m.memberType===options.type)&&(options.role==='ALL'||m.orgRole===options.role)&&m.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
}

export function groupDirectoryMembers(members:Member[],group:MemberDirectoryOptions['group']):{key:string;label:string;members:Member[]}[]{
 if(group==='none')return [{key:'all',label:'',members}];
 const groups=new Map<string,{key:string;label:string;members:Member[]}>();
 for(const member of members){
 const key=(group==='status'?member.status:group==='type'?member.memberType:member.orgRole)??'__unavailable';
 const label=key==='__unavailable'?'Não informado neste acesso':group==='status'?(key==='ACTIVE'?'Ativos':key==='SUSPENDED'?'Suspensos':'Outro estado'):group==='type'?(key==='GUEST'?'Convidados':key==='MEMBER'?'Membros':'Outro tipo'):(key==='OWNER'?'Proprietários':key==='MEMBER'?'Membros':'Outro papel');
 const item:{key:string;label:string;members:Member[]}=groups.get(key)??{key,label,members:[]};item.members.push(member);groups.set(key,item);
 }
 return [...groups.values()];
}

/** Relations are separate from organization access; use only currently visible, active edges. */
export function memberAffiliations(memberId:string, structure:import('./api').Structure|null|undefined, now=Date.now()) {
 const active=(r:import('./api').Relation)=>r.memberId===memberId && (!r.startsAt||Date.parse(r.startsAt)<=now) && (!r.endsAt||Date.parse(r.endsAt)>now);
 const occupancy=(structure?.occupancies??[]).filter(active), membership=(structure?.memberships??[]).filter(active);
 const nodes=structure?.nodes??[];
 const roles=nodes.filter(n=>n.kind==='ROLE'&&occupancy.some(r=>r.roleId===n.entityId));
 const circles=nodes.filter(n=>n.kind==='CIRCLE'&&(membership.some(r=>r.circleId===n.entityId&&r.origin==='EXPLICIT')||occupancy.some(r=>r.circleId===n.entityId)));
 return {roles,circles,occupancy,membership};
}
export function normalizeMemberQuery(value:string) {return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();}
export function memberMatchesQuery(member:Member,structure:import('./api').Structure|null|undefined,query:string) {
 const q=normalizeMemberQuery(query);if(!q)return true;const affiliation=memberAffiliations(member.id,structure);
 return [member.displayName,...affiliation.roles.map(r=>r.name),...affiliation.circles.map(c=>c.name)].some(value=>normalizeMemberQuery(value).includes(q));
}

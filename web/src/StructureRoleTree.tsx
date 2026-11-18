import {useState} from 'react';
import type {Member, Relation, Structure, StructureNode} from './api';
import {entityPath, initials} from './model';
import {Button} from './ui';
import {StructureIcon} from './StructureIcon';
import {ChevronRight, Circle, Search} from 'lucide-react';
type Props = {nodes:StructureNode[];parentId:string;navigate:(path:string)=>void;seen?:Set<string>;definitions?:Structure['roles'];members?:Member[];relations?:Relation[];filter?:string};
export function StructureRoleTree({nodes, parentId, navigate, seen = new Set<string>(),definitions = [],members = [],relations = [],filter}:Props) {
  const [query,setQuery]=useState('');
  const term=(filter??query).trim().toLocaleLowerCase('pt-BR');
  if(seen.has(parentId)) return null;
  function matches(node:StructureNode,visited=new Set<string>()):boolean { if(visited.has(node.nodeId))return false;const nextSeen=new Set(visited);nextSeen.add(node.nodeId);return !term||node.name.toLocaleLowerCase('pt-BR').includes(term)||nodes.some(child=>child.parentNodeId===node.nodeId&&matches(child,nextSeen)); }
  const next = new Set(seen); next.add(parentId);
  const children=nodes.filter(node=>node.parentNodeId===parentId&&matches(node)).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true}));
  const roles=children.filter(node=>node.kind==='ROLE'), circles=children.filter(node=>node.kind==='CIRCLE');
  return <div className="mare-role-tree">{seen.size===0&&<label className="mare-role-search"><Search size={17}/><input aria-label="Buscar papéis no círculo" placeholder="Buscar papéis ou subcírculos…" value={query} onChange={event=>setQuery(event.target.value)}/></label>}{!children.length&&<p className="muted">{term?'Nenhum papel ou subcírculo encontrado.':'Nenhum papel ou subcírculo.'}</p>}{roles.map(node=>{
    const purpose=definitions.find(role=>role.id===node.entityId)?.purpose;
    const people=[...new Set(relations.filter(relation=>relation.roleId===node.entityId).map(relation=>relation.memberId))].map(id=>members.find(member=>member.id===id)).filter((member):member is Member=>!!member);
    return <Button key={node.nodeId} className="entity-row mare-role-list-row" onClick={()=>navigate(entityPath(node))}>
      <Circle size={18}/><span className="mare-role-list-copy"><strong>{node.name}</strong>{purpose&&<small>{purpose}</small>}</span>
      {people.length?<span className="mare-role-list-people" aria-label={people.map(person=>person.displayName).join(', ')}>{people.slice(0,3).map(person=><span className="avatar" key={person.id} title={person.displayName}>{initials(person.displayName)}</span>)}{people.length>3&&<small>+{people.length-3}</small>}</span>:<small>Papel</small>}
      <ChevronRight size={16}/>
    </Button>;
  })}{circles.map(node=><details key={node.nodeId} open={term?true:undefined}><summary><StructureIcon size={18}/><span>{node.name}</span></summary><Button className="entity-row" onClick={()=>navigate(entityPath(node))}>Abrir {node.name}</Button><StructureRoleTree nodes={nodes} parentId={node.nodeId} navigate={navigate} seen={next} definitions={definitions} members={members} relations={relations} filter={term}/></details>)}</div>;
}

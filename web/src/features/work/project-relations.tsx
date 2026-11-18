import { Circle, UserRound } from "lucide-react";
import { StructureIcon } from "../../StructureIcon";
import type { FeatureContext } from "../../feature-contract";
type ProjectContext = {circleId?:string|null;contextLinks?:{kind:string;targetId:string}[]};
export function projectRelations(project:ProjectContext,c:FeatureContext){
  const roleIds=[...new Set((project.contextLinks??[]).filter(link=>link.kind==='ROLE').map(link=>link.targetId))];
  const circleIds=new Set([...(project.circleId?[project.circleId]:[]),...(project.contextLinks??[]).filter(link=>link.kind==='CIRCLE').map(link=>link.targetId)]);
  for(const id of roleIds){const role=c.structure.nodes.find(node=>node.entityId===id),parent=c.structure.nodes.find(node=>node.nodeId===role?.parentNodeId);if(parent?.kind==='CIRCLE')circleIds.add(parent.entityId);}
  const entry=(id:string,kind:'ROLE'|'CIRCLE')=>({id,kind,name:c.structure.nodes.find(node=>node.entityId===id&&node.kind===kind)?.name??'Vínculo indisponível',available:c.structure.nodes.some(node=>node.entityId===id&&node.kind===kind)});
  return {roles:roleIds.map(id=>entry(id,'ROLE')),circles:[...circleIds].map(id=>entry(id,'CIRCLE'))};
}
export function ProjectContextLine({project,context:c}:{project:ProjectContext;context:FeatureContext}){
  const {roles,circles}=projectRelations(project,c);
  return <div className="mare-project-context-line" title={[...circles,...roles].map(item=>item.name).join(' · ')||'Projeto pessoal'}>{circles.length?<StructureIcon size={16}/>:<UserRound size={16}/>}<span>{circles.length?circles.map(item=>item.name).join(', '):'Projeto pessoal'}{roles.length>0&&<small>{roles.map(item=>item.name).join(', ')}</small>}</span></div>;
}
export function ProjectRelationFields({project,context:c}:{project:ProjectContext;context:FeatureContext}){
  const {roles,circles}=projectRelations(project,c);
  return <>{([{label:circles.length>1?'Círculos':'Círculo',items:circles,empty:'Sem círculo vinculado'},{label:roles.length>1?'Papéis':'Papel',items:roles,empty:'Sem papel vinculado'}]).map(({label,items,empty})=><div key={label}><dt>{label}</dt><dd>{items.length?items.map(item=>item.available?<button type="button" key={item.id} onClick={()=>c.navigate('/'+(item.kind==='ROLE'?'roles':'circles')+'/'+item.id)}>{item.kind==='ROLE'?<Circle size={13}/>:<StructureIcon size={14}/>}<span>{item.name}</span></button>:<span key={item.id}>{item.name}</span>):<span className="muted">{empty}</span>}</dd></div>)}</>;
}

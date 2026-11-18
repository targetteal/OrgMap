import type {Member} from './api';
export type MemberProfileRelation={value:{memberId:string;managerId?:string|null}};
export type HierarchyBranch={member:Member;children:HierarchyBranch[]};
export function memberHierarchy(members:Member[],profiles:MemberProfileRelation[]){
 const known=new Map(members.map(m=>[m.id,m])), parents=new Map<string,string>();let incomplete=false;
 for(const p of profiles){const {memberId,managerId}=p.value;if(!managerId)continue;if(!known.has(memberId)||!known.has(managerId)){incomplete=true;continue;}if(parents.has(memberId)&&parents.get(memberId)!==managerId)throw new Error('Relações de hierarquia conflitantes.');parents.set(memberId,managerId);}
 for(const id of parents.keys()){const seen=new Set<string>();let cursor:string|undefined=id;while(cursor){if(seen.has(cursor))throw new Error('A hierarquia contém uma referência circular.');seen.add(cursor);cursor=parents.get(cursor);}}
 const included=new Set([...parents.keys(),...parents.values()]);const branches=new Map<string,HierarchyBranch>([...included].map(id=>[id,{member:known.get(id)!,children:[]}]));
 const roots:HierarchyBranch[]=[];for(const [id,branch]of branches){const parent=parents.get(id);if(parent)branches.get(parent)!.children.push(branch);else roots.push(branch);}
 return {roots,incomplete,relationCount:parents.size};
}

export type ProjectGrouping = "NONE" | "STATE" | "CIRCLE" | "PERSON" | "ROLE" | "TAG" | "SECTION";
export type ProjectSort = "TITLE" | "DUE" | "PROGRESS" | "MANUAL" | "PRIORITY";
export const defaultProjectProperties = ["state", "participants", "due", "progress"] as const;
export type ProjectProperty = typeof defaultProjectProperties[number];
export type SavedProjectView = {
  id:string; name:string; view:"LIST"|"BOARD"|"GALLERY"; relevance:"ALL"|"MINE"|"CIRCLES";
  query:string; sort:ProjectSort; stateFilter?:string; tagFilter?:string;
  personFilter?:string; circleFilter?:string; roleFilter?:string; grouping?:ProjectGrouping;
  orderIds?:string[];
  visibleProperties?:ProjectProperty[];
  archived?:boolean;
};
/** Retain known saved identities and append newly visible projects in a deterministic order. */
export function projectOrderIds<T extends {id:string;title:string}>(projects:T[],saved:string[],compare:(a:string,b:string)=>number):string[] {
  const current=new Set(projects.map((project)=>project.id));
  const known=[...new Set(saved)].filter((id)=>current.has(id));
  const included=new Set(known);
  return [...known,...projects.filter((project)=>!included.has(project.id)).sort((a,b)=>compare(a.title,b.title)||a.id.localeCompare(b.id)).map((project)=>project.id)];
}
export function moveProjectOrder(ids:string[],source:string,target:string,placement:"before"|"after"):string[] {
  if(source===target || !ids.includes(source) || !ids.includes(target)) return ids;
  const next=ids.filter((id)=>id!==source), at=next.indexOf(target)+(placement === "after" ? 1 : 0);
  next.splice(at,0,source);
  return next;
}
type CatalogItem = {
  id:string; creatorId:string; circleId?:string|null; projectStateId?:string|null; tags:string[];
  contextLinks?:{kind:string;targetId:string}[];
  sectionName?:string|null;
};
export const projectGroupingHint: Record<ProjectGrouping,string> = {
  NONE:"", STATE:"Cada projeto aparece uma vez, pelo seu estado.",
  CIRCLE:"Cada projeto aparece uma vez: círculo principal ou primeiro círculo vinculado.",
  PERSON:"Cada projeto aparece uma vez: primeiro participante vinculado ou, na ausência, a pessoa que o criou.",
  ROLE:"Cada projeto aparece uma vez, pelo primeiro papel vinculado.",
  TAG:"Cada projeto aparece uma vez, pela primeira tag cadastrada.",
  SECTION:"Seções de projetos são independentes dos estados e das seções internas de tarefas.",
};
/** Stable, exclusive groups preserve the collection count, as in the approved first-circle grouping. */
export function groupProjects<T extends CatalogItem>(items:T[],grouping:ProjectGrouping,names:{
  entity:(id:string)=>string|undefined; member:(id:string)=>string|undefined; state:(id:string)=>string|undefined;
}):{id:string;name:string;projects:T[]}[] {
  if (grouping === "NONE") return [{id:"all",name:"",projects:items}];
  const groups=new Map<string,{id:string;name:string;projects:T[]}>();
  for(const project of items) {
    const first=(kind:string)=>project.contextLinks?.find((link)=>link.kind===kind)?.targetId;
    const key=grouping === "STATE" ? project.projectStateId ?? "" : grouping === "CIRCLE" ? project.circleId ?? first("CIRCLE") ?? "" : grouping === "PERSON" ? first("PARTICIPANT") ?? project.creatorId : grouping === "ROLE" ? first("ROLE") ?? "" : grouping === "SECTION" ? project.sectionName ?? "" : project.tags?.[0] ?? "";
    const label=grouping === "STATE" ? key ? names.state(key) ?? "Estado indisponível" : "Sem estado" : grouping === "CIRCLE" ? key ? names.entity(key) ?? "Círculo indisponível" : "Sem círculo" : grouping === "PERSON" ? names.member(key) ?? "Pessoa indisponível" : grouping === "ROLE" ? key ? names.entity(key) ?? "Papel indisponível" : "Sem papel vinculado" : key || (grouping === "SECTION"?"Sem seção":"Sem tag");
    if(!groups.has(key)) groups.set(key,{id:key,name:label,projects:[]});
    groups.get(key)!.projects.push(project);
  }
  return [...groups.values()];
}

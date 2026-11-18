import { useEffect, useRef, useState, type ReactNode, type MutableRefObject } from "react";
import { Bookmark, Filter, Plus, SlidersHorizontal, X } from "lucide-react";
import type { FeatureContext } from "../../feature-contract";
import { CatalogPopover } from "./catalog-popover";
import { errorMessage } from "../../api";
import { roleChoiceLabel } from "../../role-choice-label";
import { useLocalization } from "../../localization";
import { workTranslator } from "./messages";
export type TaskViewConfig = {
  view:string;query:string;sort:string;grouping:string;personFilter:string;roleFilter:string;circleFilter:string;statusFilter:string;tagFilter:string;
  visibleProperties:("state"|"participants"|"due")[];archived:boolean;archiveMode?:"ACTIVE"|"ARCHIVED"|"ALL";orderIds:string[];
};
export type SavedTaskView=TaskViewConfig & {id:string;name:string};
export function TaskViewControls({context:c,projectId,current,onChange,states,onNew,onError,manualOrderRef}:{context:FeatureContext;projectId:string;current:TaskViewConfig;onChange:(patch:Partial<TaskViewConfig>)=>void;states:{id:string;name:string}[];onNew?:()=>void;onError:(error:string)=>void;manualOrderRef?:MutableRefObject<((ids:string[])=>Promise<boolean>)|null>}) {
  const {locale}=useLocalization(), text=workTranslator(locale);
  const [views,setViews]=useState<SavedTaskView[]>([]),[version,setVersion]=useState(0),[name,setName]=useState(""),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const applied=useRef(false),active=useRef<string|null>(null),base=`/organizations/${c.organizationId}/work/task-views`;
  useEffect(()=>{const abort=new AbortController();applied.current=false;setLoaded(false);c.api<{views:SavedTaskView[];version:number}>(base+"?projectId="+projectId,{signal:abort.signal}).then((result)=>{if(abort.signal.aborted)return;setViews(result.data.views);setVersion(result.data.version);setLoaded(true);if(!applied.current&&result.data.views[0]){applied.current=true;active.current=result.data.views[0].id;onChange({...result.data.views[0],query:result.data.views[0].query ?? "",statusFilter:result.data.views[0].statusFilter ?? "",tagFilter:result.data.views[0].tagFilter ?? ""});}}).catch((error)=>{if(!abort.signal.aborted){setLoaded(true);onError(errorMessage(error));}});return()=>abort.abort();},[c.api,base,projectId]);
  const save=async(next:SavedTaskView[])=>{setBusy(true);try{const result=await c.api<{views:SavedTaskView[];version:number}>(base,{method:"POST",body:{projectId,views:next},version});setViews(result.data.views);setVersion(result.data.version);c.notify("Vistas pessoais de tarefas salvas.");return true;}catch(error){onError(errorMessage(error));return false;}finally{setBusy(false);}};
  useEffect(()=>{if(!manualOrderRef)return;manualOrderRef.current=async(orderIds)=>{const currentView=views.find((view)=>view.id===active.current);if(!currentView&&views.length>=20){onError("Remova uma vista de tarefas antes de salvar uma nova ordem pessoal.");return false;}const next={...current,id:currentView?.id ?? crypto.randomUUID(),name:currentView?.name ?? "Ordem pessoal de tarefas",orderIds};if(await save([next,...views.filter((view)=>view.id!==next.id)])){active.current=next.id;return true;}return false;};return()=>{manualOrderRef.current=null;};},[manualOrderRef,current,views,version]);
  const field=(label:string,node:ReactNode)=><label className="field"><span>{label}</span>{node}</label>;
  return <div className="mare-task-view-controls">
    <CatalogPopover label="Filtros de tarefas" shortLabel="Filtros" title="Encontrar próximas ações" icon={<Filter size={16}/>} count={[current.personFilter,current.roleFilter,current.circleFilter,current.statusFilter,current.tagFilter].filter(Boolean).length}>
      {field("Pessoa",<select value={current.personFilter} onChange={(e)=>onChange({personFilter:e.target.value})}><option value="">Todas as pessoas</option>{c.members.filter((m)=>m.status==="ACTIVE").map((m)=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select>)}
      {field("Papel",<select value={current.roleFilter} onChange={(e)=>onChange({roleFilter:e.target.value})}><option value="">Todos os papéis</option>{c.structure.nodes.filter((n)=>n.kind==="ROLE").map((n)=><option key={n.entityId} value={n.entityId}>{roleChoiceLabel(n,c.structure.nodes)}</option>)}</select>)}
      {field("Círculo",<select value={current.circleFilter} onChange={(e)=>onChange({circleFilter:e.target.value})}><option value="">Todos os círculos</option>{c.structure.nodes.filter((n)=>n.kind==="CIRCLE").map((n)=><option key={n.entityId} value={n.entityId}>{n.name}</option>)}</select>)}
      {field("Estado",<select value={current.statusFilter} onChange={(e)=>onChange({statusFilter:e.target.value})}><option value="">Todos os estados</option>{states.map((state)=><option key={state.id} value={state.id}>{state.name}</option>)}</select>)}
      {field("Tag",<input value={current.tagFilter} onChange={(e)=>onChange({tagFilter:e.target.value})}/>)}
      <button className="mare-text-button" onClick={()=>onChange({personFilter:"",roleFilter:"",circleFilter:"",statusFilter:"",tagFilter:"",query:""})}>Limpar recorte</button>
    </CatalogPopover>
    <CatalogPopover label="Vista de tarefas" shortLabel="Visualização" title="Organizar as tarefas" icon={<SlidersHorizontal size={16}/>}>
      {field("Agrupar tarefas",<select value={current.grouping} onChange={(e)=>onChange({grouping:e.target.value})}>{[["NONE","Sem agrupamento"],["SECTION","Agrupar por seção"],["STATUS","Agrupar por estado"],["PROJECT","Projeto"],["CIRCLE","Círculo"]].map(([id,label])=><option key={id} value={id}>{text(label)}</option>)}</select>)}
      {field("Ordenar tarefas",<select value={current.sort} onChange={(e)=>onChange({sort:e.target.value})}>{[["POSITION","Ordem manual"],["TITLE","Nome"],["DUE","Prazo"],["PRIORITY","Prioridade"]].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>)}
      <fieldset className="mare-property-options"><legend>Propriedades das tarefas</legend>{([["state","Estado"],["participants","Responsáveis"],["due","Prazo"]] as const).map(([id,label])=><label className="work-check" key={id}><input type="checkbox" checked={current.visibleProperties.includes(id)} onChange={(e)=>onChange({visibleProperties:e.target.checked?[...current.visibleProperties,id]:current.visibleProperties.filter((property)=>property!==id)})}/>{label}</label>)}</fieldset>
      {field("Mostrar tarefas",<select value={current.archiveMode ?? (current.archived?"ARCHIVED":"ACTIVE")} onChange={(e)=>onChange({archiveMode:e.target.value as TaskViewConfig["archiveMode"],archived:e.target.value==="ARCHIVED"})}><option value="ACTIVE">Ativas</option><option value="ARCHIVED">Arquivadas</option><option value="ALL">Todas</option></select>)}
    </CatalogPopover>
    <CatalogPopover label="Vistas de tarefas" shortLabel="Vistas salvas" title="Vistas pessoais deste projeto" icon={<Bookmark size={16}/>}>
      {!loaded&&<p role="status">Carregando vistas…</p>}{views.map((view)=><div className="work-access" key={view.id}><button onClick={()=>{active.current=view.id;onChange({...view,query:view.query ?? "",statusFilter:view.statusFilter ?? "",tagFilter:view.tagFilter ?? ""});}}>{view.name}</button><button className="mare-icon-button" aria-label={`Remover vista de tarefas ${view.name}`} disabled={busy} onClick={()=>void save(views.filter((item)=>item.id!==view.id))}><X size={16}/></button></div>)}
      <form className="work-inline" onSubmit={async(e)=>{e.preventDefault();if(await save([{...current,id:crypto.randomUUID(),name:name.trim()},...views]))setName("");}}><label className="field">Nome da vista<input required maxLength={100} value={name} onChange={(e)=>setName(e.target.value)}/></label><button className="primary" disabled={busy||!loaded||views.length>=20}>Salvar esta vista</button></form>
    </CatalogPopover>
    {onNew&&<button className="primary" onClick={onNew}><Plus size={16}/>Tarefa</button>}
  </div>;
}

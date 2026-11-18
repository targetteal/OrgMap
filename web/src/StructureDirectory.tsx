import { StructureCreateMenu } from "./StructureCreateMenu";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { Search, ChevronDown, ChevronRight, Circle, List, Waypoints, Filter, Plus, X, Bookmark } from "lucide-react";
import type { FeatureContext } from "./feature-contract";
import type { VisibleStructureNode } from "./api";
import { errorMessage } from "./api";
import { Button, Notice } from "./ui";
import { StructureIcon } from "./StructureIcon";
import { entityPath, initials, structureReturnPath } from "./model";
import { structureParentLabel } from "./structure-breadcrumb";
import { StructureViews, type SavedStructureView, type StructureViewConfig, type ViewGraph } from "./StructureViews";
import "./structure-directory.css";
import type { ExplorerSnapshot } from "./StructureExplorer";
/** Keep only nodes and parent relations already present in the authorized structure. */
export function authorizedDirectoryViewNodes(graph:ViewGraph,nodes:VisibleStructureNode[]):VisibleStructureNode[] {
  const visible = new Map(nodes.map(node => [node.entityId, node]));
  const allowed = new Set(graph.entities.map(entity => entity.id));
  return graph.entities.flatMap(entity => {
    const node = visible.get(entity.id);
    if (!node || node.kind !== entity.kind) return [];
    const parent = !node.pathRedacted && node.parentNodeId && nodes.find(item => item.nodeId === node.parentNodeId);
    return [{...node, name:entity.name, version:entity.version, parentNodeId:parent && allowed.has(parent.entityId) ? parent.nodeId : null}];
  });
}
export function StructureDirectory({ context, initialState, onStateChange, selectedNodeId }: { context: FeatureContext; initialState?: ExplorerSnapshot; onStateChange?: (state: ExplorerSnapshot) => void; selectedNodeId?:string }) {
  const viewId = new URLSearchParams(context.path.split("?")[1] ?? "").get(
      "viewId",
    ),
    [items, setItems] = useState<VisibleStructureNode[]>(context.structure.nodes),
    [query, setQuery] = useState(initialState?.query ?? ""),
    [kind, setKind] = useState<"ALL" | "CIRCLE" | "ROLE">(initialState?.kindFilter === "CIRCLE" || initialState?.kindFilter === "ROLE" ? initialState.kindFilter : "ALL"),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!!viewId),
    [refresh, setRefresh] = useState(0);
  const [coverage, setCoverage] = useState<ViewGraph["coverage"]>(context.structure.coverage);
  const [viewsOpen,setViewsOpen] = useState(false);
  const savedMenu = useRef<HTMLDetailsElement>(null);
  const [snapshot, setSnapshot] = useState<ExplorerSnapshot>(initialState ?? {mode:"pack", quick:"none", memberFilter:"", circleFilter:"", kindFilter:"", query:"", highlight:"none", labels:true, avatars:true, minimap:false, locked:false, collapsed:[], scale:1, pan:{x:0,y:0}});
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  function graphItems(graph:ViewGraph):VisibleStructureNode[] {
    return authorizedDirectoryViewNodes(graph,context.structure.nodes);
  }
  function restoreView(view:SavedStructureView, graph:ViewGraph) {
    const config=view.config, presentation=config.presentation;
    setQuery(config.query); setKind(config.kind); setName(view.name); setCoverage(graph.coverage); setItems(graphItems(graph));
    const next:ExplorerSnapshot={...snapshotRef.current,selectedViewId:view.id,appliedConfig:config,savedMatchIds:graph.entities.map(entity=>entity.id),savedCoverage:graph.coverage,query:config.query,kindFilter:config.kind==='ALL'?'':config.kind,circleFilter:config.rootId??'',memberFilter:config.memberId??'',quick:presentation?.quick??'none',highlight:presentation?.highlight??'none',labels:presentation?.labels??true,avatars:presentation?.avatars??true,minimap:presentation?.minimap??false};
    snapshotRef.current=next;setSnapshot(next);onStateChange?.(next);
  }
  useEffect(() => {
    if (!viewId) {
      setItems(context.structure.nodes);
      setCoverage(context.structure.coverage);
      setError("");
      setName("");
      setLoading(false);
      return;
    }
    const ctrl = new AbortController(),
      base = "/organizations/" + context.organizationId + "/structure-advanced";
    setLoading(true);
    setError("");
    Promise.all([
      context.api<SavedStructureView>(
        base + "/views/" + encodeURIComponent(viewId),
        { signal: ctrl.signal },
      ),
      context.api<ViewGraph>(
        base + "/graph?viewId=" + encodeURIComponent(viewId),
        { signal: ctrl.signal },
      ),
    ])
      .then(([view, graph]) => {
        if (ctrl.signal.aborted) return;
        if (context.bootstrap.governanceModel && view.data.config.view === 'TREE') {
          setError('Esta visualização não está disponível no modelo atual da organização.');
          return;
        }
        restoreView(view.data, graph.data);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [viewId, context.organizationId, context.structure, context.api, refresh]);
  const scrollArea = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(initialState?.directoryScrollTop ?? 0);
  useLayoutEffect(() => {
    if (!loading && scrollArea.current) scrollArea.current.scrollTop = scrollPosition.current;
  }, [loading]);
  function saveSnapshot(value:ExplorerSnapshot) {const next={...value,directoryScrollTop:scrollPosition.current};snapshotRef.current=next;setSnapshot(next);onStateChange?.(next);}
  const currentConfig:StructureViewConfig = {...snapshot.appliedConfig,view:'DIRECTORY',query,kind,rootId:snapshot.circleFilter||null,memberId:snapshot.memberFilter||null,flag:snapshot.appliedConfig?.flag??null,maxDepth:snapshot.appliedConfig?.maxDepth??100,presentation:{quick:snapshot.quick,highlight:snapshot.highlight,labels:snapshot.labels,avatars:snapshot.avatars,minimap:snapshot.minimap}};
  function applyView(view:SavedStructureView,graph:ViewGraph) {
    if(savedMenu.current)savedMenu.current.open=false;
    if(view.config.view==='DIRECTORY') {restoreView(view,graph);context.navigate('/structure/directory?viewId='+encodeURIComponent(view.id));return;}
    const mode=view.config.view==='PACK'?'pack':view.config.view==='NETWORK'?'network':'hierarchy';
    context.navigate('/structure?view='+mode+'&savedView='+encodeURIComponent(view.id));
  }
  const configKey=JSON.stringify(currentConfig);
  useEffect(()=>{
    if(!snapshot.appliedConfig || (viewId && snapshot.selectedViewId!==viewId))return;
    if(configKey===JSON.stringify(snapshot.appliedConfig))return;
    const ctrl=new AbortController();
    setLoading(true);setError('');
    void context.api<ViewGraph>(`/organizations/${context.organizationId}/structure-advanced/graph?config=`+encodeURIComponent(configKey),{signal:ctrl.signal}).then(({data})=>{
      if(ctrl.signal.aborted)return;
      setItems(graphItems(data));setCoverage(data.coverage);
      saveSnapshot({...snapshotRef.current,savedMatchIds:data.entities.map(entity=>entity.id),savedCoverage:data.coverage});
    }).catch(e=>{if(!ctrl.signal.aborted)setError(errorMessage(e));}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[configKey,viewId,snapshot.selectedViewId,snapshot.appliedConfig,context.organizationId,context.api,context.structure]);
  function clearAllFilters(){
    saveSnapshot({...snapshotRef.current,query:'',kindFilter:'',memberFilter:'',circleFilter:'',quick:'none',savedMatchIds:undefined,savedCoverage:undefined,appliedConfig:undefined,selectedViewId:undefined});
    setQuery('');setKind('ALL');setItems(context.structure.nodes);setCoverage(context.structure.coverage);setName('');setError('');
    if(viewId)context.navigate('/structure/directory');
  }
  function updateQuery(value:string) { setQuery(value); saveSnapshot({...snapshot,query:value,kindFilter:kind === "ALL" ? "" : kind}); }
  function updateKind(value:"ALL" | "CIRCLE" | "ROLE") { setKind(value); saveSnapshot({...snapshot,query,kindFilter:value === "ALL" ? "" : value}); }
  const collapsed = new Set(snapshot.directoryCollapsed ?? items.filter(node=>node.kind==='CIRCLE'&&node.parentNodeId).map(node=>node.nodeId));
  const [filteredCollapsed,setFilteredCollapsed]=useState<string[]>([]);
  useEffect(()=>setFilteredCollapsed([]),[query,kind,snapshot.circleFilter,snapshot.memberFilter,snapshot.quick]);
  function toggleCircle(nodeId:string) { if(searching){setFilteredCollapsed(previous=>previous.includes(nodeId)?previous.filter(id=>id!==nodeId):[...previous,nodeId]);return;} const next=new Set(collapsed); next.has(nodeId)?next.delete(nodeId):next.add(nodeId); saveSnapshot({...snapshot,directoryCollapsed:[...next]}); }
  const openEntity=(node:VisibleStructureNode)=>context.navigate(entityPath(node)+"?from="+encodeURIComponent(structureReturnPath(context.path)));
  const term = query.trim();
  const filtered = items.filter((n) =>
    (kind === "ALL" || n.kind === kind) &&
    n.name.toLocaleLowerCase("pt-BR").includes(term.toLocaleLowerCase("pt-BR")) &&
    (!snapshot.savedMatchIds || snapshot.savedMatchIds.includes(n.entityId)) &&
    (!snapshot.memberFilter || [...context.structure.occupancies, ...context.structure.memberships].some(r => r.memberId === snapshot.memberFilter && (r.roleId === n.entityId || r.circleId === n.entityId) && Date.parse(r.startsAt) <= Date.now() && (!r.endsAt || Date.parse(r.endsAt) > Date.now()))) &&
    (!snapshot.circleFilter || (() => { const selected = items.find(item => item.entityId === snapshot.circleFilter); let current: VisibleStructureNode | undefined = n; const seen = new Set<string>(); while (current && !seen.has(current.nodeId)) {if(current.nodeId === selected?.nodeId)return true;seen.add(current.nodeId);current=items.find(item=>item.nodeId===current?.parentNodeId);} return false; })()) &&
    (snapshot.quick === "none" || (() => {const active = [...context.structure.occupancies, ...context.structure.memberships].filter(r => r.memberId === context.bootstrap.membership.id && Date.parse(r.startsAt) <= Date.now() && (!r.endsAt || Date.parse(r.endsAt) > Date.now())); if(snapshot.quick === "my-roles")return n.kind === "ROLE" && active.some(r=>r.roleId===n.entityId); if(snapshot.quick === "my-circles")return n.kind === "CIRCLE" && active.some(r=>r.circleId===n.entityId); if(snapshot.quick === "no-purpose")return n.kind === "ROLE" && !context.structure.roles.find(r=>r.id===n.entityId)?.purpose?.trim(); return n.kind === "CIRCLE" && context.structure.memberships.some(m=>m.circleId===n.entityId && Date.parse(m.startsAt)<=Date.now() && (!m.endsAt||Date.parse(m.endsAt)>Date.now()) && !context.structure.occupancies.some(o=>o.memberId===m.memberId&&o.circleId===n.entityId && Date.parse(o.startsAt)<=Date.now() && (!o.endsAt||Date.parse(o.endsAt)>Date.now())));})()),
  ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true }));
  const parentLabel = (node: VisibleStructureNode) => {
    if (node.pathRedacted) return "Caminho não compartilhado";
    const path: string[] = [], seen = new Set([node.nodeId]);
    let parent = items.find(n => n.nodeId === node.parentNodeId);
    while (parent && !seen.has(parent.nodeId)) {
      seen.add(parent.nodeId); path.unshift(parent.name);
      if (parent.pathRedacted) break;
      parent = items.find(n => n.nodeId === parent!.parentNodeId);
    }
    return path.join(" / ") || structureParentLabel(node, items, context.bootstrap?.rootCircleId ?? null);
  };
  const included=new Set(filtered.map(node=>node.nodeId));
  // Filtered descendants retain their authorized ancestors as context, never infer missing parents.
  for(const node of filtered) { let parent=items.find(item=>item.nodeId===node.parentNodeId);const seen=new Set<string>();while(parent&&!seen.has(parent.nodeId)){included.add(parent.nodeId);seen.add(parent.nodeId);parent=items.find(item=>item.nodeId===parent?.parentNodeId);} }
  const searching=!!term||kind!=="ALL"||!!snapshot.circleFilter||!!snapshot.memberFilter||snapshot.quick!=="none"||!!snapshot.savedMatchIds;
  const closed=searching?new Set(filteredCollapsed):collapsed;
  const allCircles=items.filter(node=>node.kind==='CIRCLE'&&included.has(node.nodeId));
  const canExpand=allCircles.some(node=>closed.has(node.nodeId));
  function foldAll(){const next=canExpand?[]:allCircles.map(node=>node.nodeId);if(searching)setFilteredCollapsed(next);else saveSnapshot({...snapshot,directoryCollapsed:next});}
  function renderNode(node:VisibleStructureNode,seen=new Set<string>(),depth=0):ReactNode {
    if(seen.has(node.nodeId)||!included.has(node.nodeId))return null;
    const next=new Set(seen);next.add(node.nodeId);
    const circle=node.kind==='CIRCLE',folded=closed.has(node.nodeId);
    const children=items.filter(item=>item.parentNodeId===node.nodeId&&included.has(item.nodeId)).sort((a,b)=>a.kind!==b.kind?(a.kind==='ROLE'?-1:1):a.name.localeCompare(b.name,'pt-BR'));
    const allChildren=items.filter(item=>item.parentNodeId===node.nodeId),roleCount=allChildren.filter(item=>item.kind==='ROLE').length,circleCount=allChildren.filter(item=>item.kind==='CIRCLE').length;
    const definition=(circle?context.structure.circles:context.structure.roles)?.find(item=>item.id===node.entityId);
    const purpose=definition?.purpose||'Propósito ainda não definido.';
    const people=circle?[]:[...new Set((context.structure.occupancies??[]).filter(r=>r.roleId===node.entityId&&Date.parse(r.startsAt)<=Date.now()&&(!r.endsAt||Date.parse(r.endsAt)>Date.now())).map(r=>r.memberId))].flatMap(id=>(context.members??[]).find(member=>member.id===id)??[]);
    const summary=circle&&folded?`${roleCount} ${roleCount===1?'papel':'papéis'}${circleCount?` · ${circleCount} ${circleCount===1?'subcírculo':'subcírculos'}`:''}`:purpose;
    return <li key={node.nodeId} className={'outline-row '+(circle?'outline-circle':'outline-role')+(selectedNodeId===node.nodeId?' outline-selected':'')} style={{'--depth':depth} as CSSProperties}>
      <div className="outline-row-line">
        {circle&&children.length>0&&<button className="outline-disclosure" aria-label={(folded?'Expandir ':'Recolher ')+node.name} aria-expanded={!folded} onClick={()=>toggleCircle(node.nodeId)}>{folded?<ChevronRight size={15}/>:<ChevronDown size={15}/>}</button>}
        <button data-node={node.nodeId} className="outline-open" aria-label={'Abrir '+(circle?'círculo ':'papel ')+node.name} aria-current={selectedNodeId===node.nodeId?'location':undefined} title={node.name} onClick={()=>openEntity(node)}><span className="outline-title"><span className="outline-entity-icon">{circle?<StructureIcon size={19}/>:<Circle size={14}/>}</span><strong>{node.name}</strong>{people.length>0&&<span className="outline-people" title={people.map(person=>person.displayName).join(', ')}>{people.slice(0,3).map(person=><span className="outline-avatar" key={person.id} aria-hidden="true">{initials(person.displayName)}</span>)}{people.length>3&&<small>+{people.length-3}</small>}</span>}</span><span className={'outline-purpose'+(circle&&folded?' outline-folded':'')+(definition?.purpose||circle&&folded?'':' outline-purpose-empty')} title={summary}>{summary}</span></button>
      </div>
      {circle&&children.length>0&&!folded&&<ul className="outline-children" aria-label={'Papéis e subcírculos de '+node.name}>{children.map(child=>renderNode(child,next,depth+1))}</ul>}
    </li>;
  }
  return (
    <section className="mare-directory" aria-label="Lista da estrutura">
      <div className="sx-toolbar mare-directory-toolbar">
        {context.bootstrap?.membership?.memberType!=='GUEST'&&context.bootstrap?.modules?.governance!==false&&<StructureCreateMenu navigate={context.navigate} circleId={context.bootstrap.rootCircleId ?? undefined}/>}
        <div className="sx-modes" role="group" aria-label="Visualização da estrutura"><Button title="Círculos" onClick={()=>context.navigate('/structure?view=pack')}><StructureIcon size={17}/><span>Círculos</span></Button><Button title="Rede" onClick={()=>context.navigate('/structure?view=network')}><Waypoints size={17}/><span>Rede</span></Button><Button pressed title="Lista"><List size={17}/><span>Lista</span></Button></div>
        <div className="toolbar-spacer"/>
        <label className="mare-directory-search"><Search size={17}/><input aria-label="Pesquisar no diretório" value={query} onChange={event=>updateQuery(event.target.value)} placeholder="Pesquisar na estrutura…"/>{query&&<Button ariaLabel="Limpar pesquisa no diretório" onClick={()=>updateQuery('')}><X size={15}/></Button>}</label>
        {context.bootstrap.membership.memberType !== 'GUEST' && <details ref={savedMenu} className="mare-directory-saved" onToggle={event=>setViewsOpen(event.currentTarget.open)} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!(event.target as Element).closest('dialog')){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary><Bookmark size={17}/><span>Vistas</span></summary>{viewsOpen&&<div className="mare-directory-saved-panel"><h3>Visualizações salvas</h3><StructureViews context={context} currentConfig={currentConfig} selectedId={snapshot.selectedViewId??viewId??''} onSelected={id=>saveSnapshot({...snapshotRef.current,selectedViewId:id||undefined})} onApply={applyView} isCompatible={view=>!(context.bootstrap.governanceModel&&view.config.view==='TREE')} onDeleted={()=>{if(viewId)context.navigate('/structure/directory');}}/></div>}</details>}
        <details className="mare-directory-filters" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary><Filter size={17}/><span>Filtrar</span></summary><div className="structure-kind-filter" role="group" aria-label="Tipo de entidade">{([['ALL','Todos'],['CIRCLE','Círculos'],['ROLE','Papéis']] as const).map(([value,label])=><Button key={value} pressed={kind===value} onClick={()=>updateKind(value)}>{label}</Button>)}</div></details>
      </div>
      {error && (
        <Notice>
          {error}
          <Button onClick={() => setRefresh((v) => v + 1)}>
            Tentar novamente
          </Button>
        </Notice>
      )}
      {!loading && !error && !coverage.complete && (
        <Notice>
          Diretório parcial. A lista não cobre toda a estrutura.
          {coverage.depthLimited && " O limite de profundidade foi atingido."}
        </Notice>
      )}
      {(snapshot.memberFilter || snapshot.circleFilter || snapshot.quick !== "none" || snapshot.savedMatchIds) && <div className="sx-filter-summary">Filtros do mapa estão ativos. <Button onClick={clearAllFilters}>Limpar todos</Button></div>}
      <div className="directory-list structure-directory-list outline-browser" ref={scrollArea} onScroll={event=>{scrollPosition.current=event.currentTarget.scrollTop;onStateChange?.({...snapshot,directoryScrollTop:scrollPosition.current});}}>
        <div className="outline-heading"><div><h2>Círculos e papéis</h2><p role="status" aria-live="polite">{searching?`${filtered.length} ${filtered.length===1?'resultado':'resultados'}`:`${items.filter(node=>node.kind==='CIRCLE').length} círculos · ${items.filter(node=>node.kind==='ROLE').length} papéis`}{name&&` · ${name}`}</p></div>{allCircles.length>0&&<button className="outline-fold-all" onClick={foldAll}>{canExpand?'Expandir tudo':'Recolher tudo'}</button>}</div>
        {loading ? (
          <div className="mare-loading outline-loading" role="status" aria-label="Carregando visualização…"><i/><i/><i/><i/><i/></div>
        ) : (
          <div className="outline-surface"><div className="outline-columns" aria-hidden="true"><span>Nome</span><span>Propósito</span></div><ul className="outline-rows" aria-label="Estrutura em árvore">{items.filter(node=>included.has(node.nodeId)&&(!node.parentNodeId||!included.has(node.parentNodeId))).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(node=>renderNode(node))}</ul></div>
        )}
        {!loading && !filtered.length && !error && coverage.complete && (
          <div className="empty-state"><h3>Nenhum círculo ou papel encontrado</h3><p>{term ? `Nenhum resultado para “${term}”.` : "Não há entidades deste tipo na estrutura."}</p>{(term || kind !== "ALL") && <Button onClick={clearAllFilters}>Limpar filtros</Button>}</div>
        )}
        {!loading && !filtered.length && !error && !coverage.complete && (
          <div className="empty-state"><h3>Nenhum resultado nos dados disponíveis</h3>{term && <p>Pesquisa: “{term}”.</p>}{(term || kind !== "ALL") && <Button onClick={clearAllFilters}>Limpar filtros</Button>}</div>
        )}
      </div>
    </section>
  );
}

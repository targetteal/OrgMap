import {useEffect, useMemo, useRef, useState} from 'react';
import {ChevronRight, CircleDot, FileText, FolderKanban, Maximize, Minimize, X} from 'lucide-react';
import {collectRoleMentionIds, type RichDocument} from '../../packages/content';
import type {FeatureContext} from './feature-contract';
import type {StructureNode} from './api';
import {RichTextView} from './editor';
import {governanceVocabulary} from './governance-vocabulary';
import {entityPath, structureReturnPath, platformEntityReturnPath} from './model';
import {StructureIcon} from './StructureIcon';
import {Button} from './ui';

type Restriction = {id:string; title:string; ownerId?:string; publishedVersion?:number|null; draftVersion?:number|null; richContent?:RichDocument|null; content?:string; archived?:boolean};
type Project = {id:string; title:string; circleId?:string|null; contextLinks?:{kind:string;targetId:string}[]};
type Revision = {number:number; content:string; richContent?:RichDocument|null};
type RestrictionDetail = {document:Restriction; versions:Revision[]};
function mentionsRole(document:Restriction, id:string) {
  if (!document.richContent) return false;
  try { return collectRoleMentionIds(document.richContent).includes(id); } catch { return false; }
}
/** The circle a restriction belongs to: its owner, or the parent circle of the owning role. */
export function restrictionCircleNode(context:FeatureContext, ownerId?:string) {
  const node=context.structure.nodes.find(item=>item.entityId===ownerId);
  return node?.kind==='ROLE'?context.structure.nodes.find(item=>item.nodeId===node.parentNodeId):node?.kind==='CIRCLE'?node:undefined;
}
function entityReturnSource(path?:string) {
  const from=new URLSearchParams((path??'').split('?')[1]??'').get('from');
  return platformEntityReturnPath(from) ?? structureReturnPath(from);
}
export function StructureRelated({context,entity}:{context:FeatureContext;entity:StructureNode}) {
  const [restrictions,setRestrictions]=useState<Restriction[]|null>(null), [projects,setProjects]=useState<Project[]|null>(null);
  const [restrictionError,setRestrictionError]=useState(false), [projectError,setProjectError]=useState(false);
  useEffect(()=>{
    const abort=new AbortController(), base=`/organizations/${context.organizationId}`;
    setRestrictions(null); setProjects(null); setRestrictionError(false); setProjectError(false);
    void (async()=>{const items:Restriction[]=[];let cursor:string|null=null;do {const page: {data:{items:Restriction[];page:{nextCursor:string|null}}}=await context.api(base+'/documents'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{signal:abort.signal});items.push(...page.data.items);cursor=page.data.page.nextCursor;}while(cursor&&!abort.signal.aborted);if(!abort.signal.aborted)setRestrictions(items);})().catch(()=>{if(!abort.signal.aborted)setRestrictionError(true)});
    context.api<{projects:Project[]}>(base+'/work/projects',{signal:abort.signal}).then(r=>{if(!abort.signal.aborted)setProjects(r.data.projects)}).catch(()=>{if(!abort.signal.aborted)setProjectError(true)});
    return ()=>abort.abort();
  },[context.organizationId,context.api]);
  const roles=useMemo(()=>new Set(entity.kind==='CIRCLE' ? context.structure.nodes.filter(n=>n.parentNodeId===entity.nodeId&&n.kind==='ROLE').map(n=>n.entityId) : [entity.entityId]),[context.structure.nodes,entity]);
  const linkedRestrictions=restrictions?.filter(d=>!d.archived && (entity.kind==='CIRCLE' ? d.ownerId===entity.entityId : mentionsRole(d,entity.entityId))) ?? [];
  const linkedProjects=projects?.filter(p=>entity.kind==='CIRCLE' && p.circleId===entity.entityId || (p.contextLinks??[]).some(link=>link.kind==='CIRCLE' && entity.kind==='CIRCLE' && link.targetId===entity.entityId || link.kind==='ROLE' && roles.has(link.targetId))) ?? [];
  function openRestriction(item:Restriction) {
    const circle=restrictionCircleNode(context,item.ownerId);
    context.navigate(entityPath(circle??entity)+'?from='+encodeURIComponent(entityReturnSource(context.path))+'&document='+encodeURIComponent(item.id));
  }
  return <>
    <section id="entity-restrictions"><h3>Restrições</h3><p className="muted mare-entity-section-note">{entity.kind==='CIRCLE'?'Restrições deste círculo.':'Restrições que mencionam este papel.'}</p>{restrictionError?<p role="alert">Não foi possível carregar as restrições.</p>:restrictions===null?<p role="status" className="mare-entity-pending">Carregando restrições…</p>:linkedRestrictions.length?linkedRestrictions.map(item=><Button className="entity-row" key={item.id} onClick={()=>openRestriction(item)}><FileText size={18}/><span><strong>{item.title}</strong><small>{item.publishedVersion?'Publicada':'Rascunho'}</small></span><ChevronRight size={16}/></Button>):<p className="mare-entity-empty"><FileText size={16} aria-hidden="true"/><span>Nenhuma restrição vinculada.</span></p>}</section>
    <section id="entity-projects"><h3>Projetos</h3>{context.bootstrap.membership.memberType === "GUEST" && <p className="muted">Os vínculos entre projetos e estrutura não estão disponíveis para convidados.</p>}{!context.structure.coverage.complete && <p className="muted">A estrutura compartilhada é parcial; alguns vínculos podem não estar incluídos.</p>}<p className="muted mare-entity-section-note">{entity.kind==='CIRCLE'?'Projetos vinculados ao círculo e aos seus papéis.':'Projetos vinculados a este papel.'}</p>{projectError?<p role="alert">Não foi possível carregar os projetos.</p>:projects===null?<p role="status" className="mare-entity-pending">Carregando projetos…</p>:context.bootstrap.membership.memberType === "GUEST" ? null : linkedProjects.length?linkedProjects.map(item=><Button className="entity-row" key={item.id} onClick={()=>context.navigate('/projects/'+encodeURIComponent(item.id))}><FolderKanban size={18}/><span><strong>{item.title}</strong></span><ChevronRight size={16}/></Button>):<p className="mare-entity-empty"><FolderKanban size={16} aria-hidden="true"/><span>Nenhum projeto vinculado.</span></p>}</section>
  </>;
}

/** A restriction opens in the entity drawer like roles and circles; the owning circle stays highlighted in the map. */
export function StructureDocumentPanel({context,entity,documentId,expanded,onToggleExpand,onClose}:{context:FeatureContext;entity:StructureNode;documentId:string;expanded:boolean;onToggleExpand:()=>void;onClose:()=>void}) {
  const scope=JSON.stringify([context.organizationId,context.session?.account?.id,context.bootstrap.membership.id,context.bootstrap.authorizationRevision,documentId]);
  const [state,setState]=useState<{scope:string;detail:RestrictionDetail|null;error:boolean}>({scope,detail:null,error:false});
  const detail=state.scope===scope?state.detail:null,detailError=state.scope===scope&&state.error;
  const agreement=governanceVocabulary(context.bootstrap).agreement;
  useEffect(()=>{const abort=new AbortController();setState({scope,detail:null,error:false});context.api<RestrictionDetail>(`/organizations/${context.organizationId}/documents/${encodeURIComponent(documentId)}`,{signal:abort.signal}).then(r=>{if(!abort.signal.aborted)setState({scope,detail:r.data,error:false})}).catch(()=>{if(!abort.signal.aborted)setState({scope,detail:null,error:true})});return()=>abort.abort()},[scope,context.api]);
  const published=detail?.versions.find(v=>v.number===detail.document.publishedVersion), draft=detail?.versions.find(v=>v.number===detail.document.draftVersion);
  return <aside className="mare-entity-drawer" aria-label={`${agreement}: ${detail?.document.title??''}`} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!(event.target as Element).closest('dialog')&&!(event.target as Element).closest('details[open]')){event.preventDefault();onClose();}}}>
    <header className="mare-entity-header">
      <div className="mare-entity-topline">
        <div className="mare-entity-location">
          {entity.kind==='CIRCLE'?<StructureIcon size={16}/>:<CircleDot size={16}/>}
          <Button onClick={()=>context.navigate(entityPath(entity)+'?from='+encodeURIComponent(entityReturnSource(context.path)))}>{entity.name}</Button>
        </div>
        <div className="mare-entity-header-actions">
          <Button className="mare-entity-expand" title={expanded?'Reduzir painel':'Expandir painel'} ariaLabel={expanded?'Reduzir painel':'Expandir painel'} onClick={onToggleExpand}>{expanded?<Minimize size={18}/>:<Maximize size={18}/>}</Button>
          <Button title="Fechar painel" ariaLabel="Fechar painel" onClick={onClose}><X size={20}/></Button>
        </div>
      </div>
      <div className="mare-entity-heading">
        <div className="mare-entity-kind"><FileText size={18}/><span>{agreement}</span></div>
        <h2 id="mare-entity-title" tabIndex={-1}>{detail?.document.title??agreement}</h2>
      </div>
    </header>
    <article className="entity-content structure-entity-content">
      <section id="entity-document">
        {detailError?<p role="alert">Não foi possível carregar a restrição.</p>:!detail?<p role="status">Carregando restrição…</p>:<>
          <h3>Versão publicada</h3>
          {published?<RichTextView value={published.richContent??published.content}/>:<p>Esta restrição ainda não foi publicada.</p>}
          {draft&&draft.number!==published?.number&&<details><summary>Rascunho separado da versão publicada</summary><RichTextView value={draft.richContent??draft.content}/></details>}
          <Button onClick={()=>context.navigate('/structure/working-agreements/'+encodeURIComponent(documentId))}>Abrir restrição e versões</Button>
        </>}
      </section>
    </article>
  </aside>;
}


/** These controls navigate sections in one document; they are not separate tab panels. */
export function StructureEntityNavigation({kind}:{kind:StructureNode['kind']}) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState('entity-overview');
  const requested = useRef<string|null>(null);
  const sections = kind === 'CIRCLE'
    ? [['entity-overview','Visão geral'],['entity-roles','Papéis'],['entity-restrictions','Restrições'],['entity-projects','Projetos']]
    : [['entity-overview','Visão geral'],['entity-restrictions','Restrições'],['entity-projects','Projetos']];
  useEffect(() => {
    const content = ref.current?.closest('aside')?.querySelector<HTMLElement>('.structure-entity-content');
    if (!content) return;
    const update = () => {
      const top = content.getBoundingClientRect().top + 24;
      let current = 'entity-overview';
      for (const [id] of sections) {
        const section = content.querySelector<HTMLElement>('#' + id);
        if (section && section.getBoundingClientRect().top <= top) current = id;
      }
      // Short final sections cannot reach the top; at the end of the document keep the section the person asked for.
      const atEnd = content.scrollTop + content.clientHeight >= content.scrollHeight - 2;
      const asked = requested.current && content.querySelector<HTMLElement>('#' + requested.current);
      if (atEnd && asked && asked.getBoundingClientRect().top < content.getBoundingClientRect().bottom) current = requested.current!;
      setActive(current);
    };
    const release = () => { requested.current = null; };
    content.addEventListener('scroll', update, {passive:true});
    for (const type of ['wheel','touchstart','keydown'] as const) content.addEventListener(type, release, {passive:true});
    return () => { content.removeEventListener('scroll', update); for (const type of ['wheel','touchstart','keydown'] as const) content.removeEventListener(type, release); };
  }, [kind]);
  function go(id:string) {
    const section = ref.current?.closest('aside')?.querySelector<HTMLElement>('#' + id);
    if (!section) return;
    setActive(id);
    requested.current = id;
    section.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'start'});
  }
  return <nav ref={ref} className="entity-tabs mare-entity-tabs" aria-label={kind === 'CIRCLE' ? 'Seções do círculo' : 'Seções do papel'}>
    {sections.map(([id,label]) => <Button key={id} ariaCurrent={active === id ? 'location' : undefined} onClick={() => go(id)}>{label}</Button>)}
  </nav>;
}

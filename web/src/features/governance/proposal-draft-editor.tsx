import { useEffect, useRef, useState } from 'react';
import { readContent, serializeRichDocument, toPlainText } from '../../../../packages/content/index';
import { RequestError } from '../../api';
import { RichTextEditor, type RichDocument } from '../../editor';
import type { FeatureContext } from '../../feature-contract';
import { DefinitionListEditor } from '../../structure-definition';
import { governanceError } from './error-messages';
import type { Change, Detail, Row } from './index';
import { useGovernanceLocalization } from './state-messages';

const EDIT_DELAY_MS = 900;
const editableChange = (change: Change) => change.kind === 'CREATE' || change.kind === 'UPDATE';
const inputErrors = ['INVALID_REQUEST','INVALID_RICH_DOCUMENT','DOCUMENT_CONTENT_REQUIRED','DOMAIN_INVARIANT'];
type Draft = {kind:'DOCUMENT';content:RichDocument} | {kind:'GOVERNANCE';changes:Change[]};
type Attempt = { key:string; signature:string; version:number; body:unknown; writtenVersion?:number };

export function canEditDraftInline(detail: Detail) {
  const {proposal,revisions,meetingDocument} = detail;
  if (proposal.state !== 'DRAFT' || !(proposal.canAmend ?? proposal.canEdit)) return false;
  if (proposal.kind === 'DOCUMENT') return !!(meetingDocument && proposal.editableDocumentVersion);
  const payload = revisions.find(item=>item.number===proposal.revision)?.payload;
  // The structural-only editor cannot save a mixed proposal without dropping its restrictions.
  return proposal.kind === 'GOVERNANCE' && !payload?.documents?.length && !!payload?.changes?.some(editableChange);
}

function signature(draft:Draft) {
  return draft.kind === 'DOCUMENT' ? serializeRichDocument(draft.content) : JSON.stringify(draft.changes);
}

export function ProposalDraftEditor({context,detail,entityName,onSaved,onDone,onReload,onSaveState}: {
  context:FeatureContext;detail:Detail;entityName:(id:string)=>string;
  onSaved:(detail:Detail)=>void;onDone:()=>void;onReload:()=>void;
  onSaveState?:(state:{dirty:boolean;busy:boolean})=>void;
}) {
  const {locale,f} = useGovernanceLocalization();
  const pt = locale.startsWith('pt');
  const {proposal} = detail;
  const endpoint = `/organizations/${context.organizationId}/proposals/${proposal.id}`;
  const payload = detail.revisions.find(item=>item.number===proposal.revision)!.payload;
  const [draft,setDraft] = useState<Draft>(()=>proposal.kind === 'DOCUMENT' ? {
    kind:'DOCUMENT',content:readContent(detail.meetingDocument!.richContent ?? detail.meetingDocument!.content),
  } : {kind:'GOVERNANCE',changes:payload.changes ?? []});
  const [saved,setSaved] = useState(()=>signature(draft));
  const [phase,setPhase] = useState<'idle'|'saving'|'error'|'conflict'>('idle');
  const [failure,setFailure] = useState<unknown>();
  const mounted = useRef(false), attempt = useRef<Attempt|undefined>(undefined);
  const sending = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const draftSignature = signature(draft), dirty = draftSignature !== saved;
  const valid = draft.kind === 'DOCUMENT' ? !!toPlainText(draft.content).trim() : draft.changes.every(change=>
    (!editableChange(change) || change.kind !== 'CREATE' || !!change.name?.trim()) &&
    [...(change.responsibilities ?? []),...(change.artifacts ?? [])].every(item=>!!item.text.trim()));
  const blocked = dirty || phase !== 'idle';
  const guard = useRef('');
  guard.current = blocked ? (pt?'Há alterações da proposta aguardando salvamento.':'The proposal has changes waiting to be saved.') : '';

  useEffect(()=>{
    mounted.current=true;
    heading.current?.focus();
    const beforeUnload=(event:BeforeUnloadEvent)=>{
      if(guard.current){event.preventDefault();event.returnValue='';}
    };
    window.addEventListener('beforeunload',beforeUnload);
    return ()=>{mounted.current=false;window.removeEventListener('beforeunload',beforeUnload);};
  },[]);
  useEffect(()=>context.registerNavigationGuard?.(()=>guard.current || null),[context.registerNavigationGuard]);
  useEffect(()=>onSaveState?.({dirty:blocked,busy:phase==='saving'}),[blocked,phase,onSaveState]);

  async function save() {
    if (sending.current || phase==='conflict') return;
    if (!attempt.current) {
      if (!dirty || !valid) return;
      const body = draft.kind === 'DOCUMENT'
        ? {draftOnly:true,documentRevision:{documentId:payload.documentId,version:proposal.editableDocumentVersion,richContent:draft.content}}
        : {draftOnly:true,payload:{changes:draft.changes}};
      attempt.current={key:crypto.randomUUID(),signature:draftSignature,version:proposal.version,body};
    }
    const current = attempt.current;
    sending.current=true;
    setPhase('saving');
    setFailure(undefined);
    try {
      if (current.writtenVersion===undefined) {
        const result = await context.api<Row>(endpoint+'/revisions',{method:'POST',version:current.version,key:current.key,body:current.body});
        current.writtenVersion=result.data.version;
      }
      const result = await context.api<Detail>(endpoint);
      if (!mounted.current) return;
      if (result.data.proposal.version!==current.writtenVersion) {
        setPhase('conflict');
        return;
      }
      attempt.current=undefined;
      setSaved(current.signature);
      onSaved(result.data);
      setPhase('idle');
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof RequestError && current.writtenVersion===undefined && inputErrors.includes(error.code)) attempt.current=undefined;
      setFailure(error);
      setPhase(error instanceof RequestError && ['VERSION_CONFLICT','STATE_CONFLICT','DOCUMENT_REVISION_CONFLICT'].includes(error.code) ? 'conflict' : 'error');
    } finally { sending.current=false; }
  }
  useEffect(()=>{
    if (!dirty || !valid || phase!=='idle') return;
    const timer=window.setTimeout(()=>void save(),EDIT_DELAY_MS);
    return ()=>window.clearTimeout(timer);
  },[draftSignature,saved,valid,phase,proposal.version]);

  function resumeAfterCorrection() {
    if (phase==='error' && !attempt.current) {
      setFailure(undefined);
      setPhase('idle');
    }
  }
  function updateChange(index:number, update:Partial<Change>) {
    resumeAfterCorrection();
    setDraft(current=>current.kind==='GOVERNANCE' ? {...current,changes:current.changes.map((change,i)=>i===index ? {...change,...update} : change)} : current);
  }
  function discard() {
    if(window.confirm(pt?'Descartar o texto local e abrir a revisão atual?':'Discard local text and open the current revision?'))onReload();
  }
  const status = phase==='saving' ? (pt?'Salvando…':'Saving…') : phase==='conflict' ?
    (pt?'Outra revisão foi registrada. Seu texto continua no editor.':'Another revision was recorded. Your text is still in the editor.') :
    phase==='error' ? (pt?'Não foi possível salvar. Seu texto continua no editor.':'Could not save. Your text is still in the editor.') :
    !valid ? (pt?'Preencha os campos em aberto para salvar.':'Fill in the empty fields to save.') :
    dirty ? (pt?'Aguardando salvamento…':'Waiting to save…') : (pt?'Salvo':'Saved');

  return <section className="gov-inline-draft" aria-labelledby="gov-inline-draft-title">
    <header className="gov-inline-draft-head">
      <h2 ref={heading} tabIndex={-1} id="gov-inline-draft-title">{pt?'Editar proposta':'Edit proposal'}</h2>
      <button type="button" disabled={blocked} onClick={onDone}>{pt?'Concluir edição':'Done editing'}</button>
    </header>
    <p role="status" className="gov-inline-save-status">{status}</p>
    {phase==='error' && <div className="gov-inline-recovery">
      {failure != null && <p>{governanceError(failure,locale)}</p>}
      <button type="button" disabled={!attempt.current && !valid} onClick={()=>void save()}>{pt?'Tentar novamente':'Try again'}</button>
      <button type="button" onClick={discard}>{pt?'Descartar mudanças locais':'Discard local changes'}</button>
    </div>}
    {phase==='conflict' && <div className="gov-inline-recovery">
      <p>{pt?'Copie as mudanças que quiser manter antes de abrir a revisão atual.':'Copy the changes you want to keep before opening the current revision.'}</p>
      <button type="button" onClick={discard}>{pt?'Abrir revisão atual':'Open current revision'}</button>
    </div>}
    {dirty&&!valid&&phase==='idle' && <button type="button" className="gov-inline-discard" onClick={discard}>{pt?'Descartar mudanças locais':'Discard local changes'}</button>}
    {draft.kind==='DOCUMENT' ? <RichTextEditor label={pt?'Texto proposto da restrição':'Proposed restriction text'} value={draft.content} required maxLength={50000}
      onChange={content=>{resumeAfterCorrection();setDraft({kind:'DOCUMENT',content});}}/> : draft.changes.map((change,index)=>
      <section className="gov-inline-change" key={`${change.entityId}:${index}`}>
        <h3>{change.name ?? entityName(change.entityId)}</h3>
        {editableChange(change) ? <>
          <label className="field">{f('name')}<input value={change.name ?? ''} placeholder={entityName(change.entityId)} maxLength={200} onChange={event=>updateChange(index,{name:event.target.value || undefined})}/></label>
          <RichTextEditor label={f('purpose')} value={change.purposeRich ?? change.purpose ?? ''} onChange={purposeRich=>updateChange(index,{purpose:undefined,purposeRich})}/>
          {(['responsibilities','artifacts'] as const).map(kind=><DefinitionListEditor key={kind} kind={kind} locale={locale} items={change[kind] ?? []} onChange={items=>updateChange(index,{[kind]:items})}/>)}
        </> : <p className="muted">{pt?'Alteração de estrutura mantida nesta revisão.':'This structural change is kept in the revision.'}</p>}
      </section>)}
  </section>;
}

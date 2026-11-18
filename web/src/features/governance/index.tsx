import { SearchSelect } from "../../SearchSelect";
import { Dialog as SurfaceDialog } from "../../ui";
import { governanceVocabulary } from "../../governance-vocabulary";
import {ChevronDown,ChevronRight,X,Plus,Search,Filter,List,Columns3,ChevronsUpDown,CalendarDays,Clock,CheckCircle2,FileText,Shield,Vote,ArrowUpRight,ArrowRight,User,Users,Layers,MessageSquare,Maximize2,Minimize2,CheckSquare,Link2,Pencil,Inbox,XCircle,AlertTriangle,SearchX,CircleDot,Undo2} from 'lucide-react';
import {StructureIcon} from '../../StructureIcon';
import {governanceUXTranslator} from './ux-messages';
import {proposalComposerTranslator} from './proposal-composer-copy';
import {DecisionWindow} from './decision-window';
import {DefinitionListEditor, DefinitionList, words as definitionWords, type EntityDefinition, type DefinitionItem} from '../../structure-definition';
import {DefinitionsDiff, DiffText, diffText, plain} from '../../text-diff';
import {useDocumentActionText} from './document-action';
import {DocumentContent, DocumentOrigin, type DocumentOriginData} from './document-content';
import { canEditDraftInline, ProposalDraftEditor } from './proposal-draft-editor';
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useId,
  Children,
  Fragment,
  isValidElement,
  cloneElement,
  type ReactElement,
  type MouseEvent,
  type MutableRefObject,
  type FormEvent,
  type ReactNode,
} from "react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import { governanceMetadata } from "./metadata";
import { RequestError } from "../../api";
import { FeatureRoleMentions, RichTextEditor, RichTextView, type RichDocument } from "../../editor";
import { readContent, toPlainText, fromPlainText, collectRoleMentionIds } from "../../../../packages/content/index";
import { useGovernanceLocalization } from "./state-messages";
import {isGovernanceFormMessage} from "./form-messages";
import {governanceError} from "./error-messages";
import {localizedGovernanceActivity} from "./misc-messages";
import { mandateInput,mandateInstant } from "./date-input";
import { TraceOrigin, TraceReturnLink, TensionDestinations, traceRoute } from "../../traceability";
import { TensionTaskForm } from "./tension-task-form";
import { ResourcePanel } from "../platform";
import { meetingProposalTranslator } from "./meeting-proposal-messages";
import { asyncConsentTranslator, consentTranslator, consentHistoryTranslator, consentScopeTranslator, meetingConsentHelpTranslator } from "./consent-messages";
import "./style.css";
import "./proposal-catalogue.css";
import "./catalogue-surfaces.css";
import "./governance-uplift.css";
import { governanceCatalogueTranslator } from "./catalogue-messages";
export type Row = {
  consentMeetingId?: string;
  consentMeetingVersion?: number;
  meetingConsentRequired?: boolean;
  meetingConsentPending?: boolean;
  canAmend?: boolean;
  editableDocumentVersion?: number;
  description?:string;
  descriptionRich?:RichDocument|null;
  content?:string;
  richContent?:RichDocument|null;
  canEdit?: boolean;
  createdAt?: string;
  changeKinds?: ("ROLE"|"CIRCLE"|"DOCUMENT")[];
  evolutionCount?: number;
  responseCount?: number;
  electorateCount?: number;
  ownVote?: string | null;
  canVote?: boolean;
  scheduledMeeting?:{proposalId:string;meetingId:string;agendaId:string;circleId:string;title:string;startAt:string;state:string;version:number};
  deadline?: string | null;
  canProcess?: boolean;
  canProcessAgenda?:boolean;
  name?: string;
  active?: boolean;
  typeId?: string;
  changes?: Change[];
  archived?: boolean;
  id: string;
  title: string;
  targetId?: string | null;
  version: number;
  circleId?: string;
  ownerId?: string;
  authorId?: string;
  kind?: string;
  state?: string;
  verdict?: string;
  applyState?: string;
  revision?: number;
  draftVersion?: number;
  publishedVersion?: number;
  workflow?: string;
  visibility?: string;
  configuration?: Policy;
  policy?: Policy;
  allowOverride?: boolean;
};
type Policy = {
  draftAccess?: string;
  decisionProcess?: string;
  method: string;
  quorumPercent: number;
  responseRequirement: string;
  reviewDurationHours: number;
  allowRevote: boolean;
  allowAbstain: boolean;
  workflowSteps: string[];
};
const proposalDisplayState=(row:Row)=>row.state==='DRAFT'&&row.scheduledMeeting?'SCHEDULED':row.state;
const initialPolicy: Policy = {
  draftAccess: "AUTHOR_ONLY",
  decisionProcess: "STANDARD",
  method: "MANUAL_FACILITATED",
  quorumPercent: 100,
  responseRequirement: "QUORUM",
  reviewDurationHours: 168,
  allowRevote: false,
  allowAbstain: true,
  workflowSteps: ["PRESENT", "CLARIFY", "REACT", "OBJECT", "DECIDE"],
};
export type Change = {
  responsibilities?: NonNullable<EntityDefinition['responsibilities']>;
  artifacts?: NonNullable<EntityDefinition['artifacts']>;
  fieldId?: string;
  value?: string | number | boolean | null | string[];
  kind: string;
  entityId: string;
  baseVersion?: number;
  entityKind?: string;
  parentCircleId?: string;
  name?: string;
  purpose?: string;
  purposeRich?: RichDocument | null;
};
type GovernedField = {
  field: {
    id: string;
    label: string;
    schema: { type: string; options?: string[] };
  };
  version: number;
  value: Change["value"];
};
type DocumentPart = {
  documentId?: string;
  documentVersion?: number;
  documentAction?: 'ARCHIVE';
  documentBaseVersion?: number;
  newDocument?: {title:string;richContent:RichDocument};
  documentRevision?: {documentId:string;version:number;richContent:RichDocument};
};
type DocumentPartDraft =
  | {mode:'CREATE';title:string;richContent?:RichDocument;attachment?:File}
  | {mode:'PUBLISH';documentId:string;documentVersion?:number;richContent?:RichDocument;edited?:boolean;attachment?:File}
  | {mode:'ARCHIVE';documentId:string;documentVersion?:number;documentBaseVersion?:number};
export type Detail = {
  originTension?:Row;
  meetingDocument?: {title:string;number:number;content:string;richContent:RichDocument|null;proposalRevision?:number};
  meetingDocuments?: {documentId:string;title:string;number:number;content:string;richContent:RichDocument|null;proposalRevision:number;documentAction?:'ARCHIVE';editableDocumentVersion?:number}[];
  entityReferences?: {entityId:string;name:string;kind:"CIRCLE"|"ROLE";archived:boolean}[];
  history?:{id:string;actorId:string;action:string;at:string;reason?:string;source?:string;verdict?:string;choice?:string;revision?:number}[];
  proposal: Row;
  revisions: {
    number: number;
    payload: {
      changes?: Change[];
      documents?: DocumentPart[];
      documentId?: string;
      documentVersion?: number;
      documentAction?: 'ARCHIVE';
      documentBaseVersion?: number;
      roleId?: string;
      winnerId?: string;
      mandateEnd?: string;
    };
  }[];
  rounds: {
    id: string;
    revision: number;
    policy: Policy;
    electorate: string[];
    deadline?: string;
    state: string;
    step: string;
  }[];
  ballots: {
    roundId: string;
    memberId: string;
    choice: string;
    number: number;
    rationale: string;
  }[];
  objections: {
    id: string;
    roundId: string;
    authorId: string;
    state: string;
    rationale: string;
    version: number;
  }[];
  commits: { id: string; at: string }[];
  nominations: {
    id: string;
    candidateId: string;
    authorId: string;
    rationale: string;
  }[];
};
type DocDetail = {
  document: Row;
  versions: { number: number; content: string; richContent?: RichDocument|null; createdAt: string; origin?:DocumentOriginData }[];
};
const versionContent=(version:DocDetail["versions"][number]|undefined)=>version?.richContent ?? version?.content ?? "";

function Field({
  label: caption,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const captionId = useId();
  return (
    <label className="gov-field">
      <span id={captionId}>{caption}</span>
      {Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(
              child as ReactElement<{ "aria-labelledby"?: string }>,
              { "aria-labelledby": captionId },
            )
          : child,
      )}
    </label>
  );
}
type ModalState={dirty:boolean;busy:boolean};
export function Modal({title,close,children,context,busy=false,state}: {
 title:string;close:()=>void;children:ReactNode;context?:FeatureContext;busy?:boolean;state?:MutableRefObject<ModalState>;
}) {
 const {d,locale}=useGovernanceLocalization(), ux=governanceUXTranslator(locale);
 const ref=useRef<HTMLDialogElement>(null), localState=useRef<ModalState>({dirty:false,busy:false}), titleId=useId(),descriptionId=useId();
 const closeButton=useRef<HTMLButtonElement>(null),keepButton=useRef<HTMLButtonElement>(null),confirmReturnFocus=useRef<HTMLElement|null>(null),accepting=useRef(false);
 const [confirmDiscard,setConfirmDiscard]=useState(false);
 const current=state??localState;current.current.busy=busy;
 const requestClose=()=>{
  if(current.current.busy)return;
  if(confirmDiscard){setConfirmDiscard(false);return;}
  if(current.current.dirty){confirmReturnFocus.current=document.activeElement as HTMLElement|null;setConfirmDiscard(true);return;}
  close();
 };
 const discard=()=>{
  if(current.current.busy||accepting.current||!confirmDiscard)return;
  accepting.current=true;current.current.dirty=false;setConfirmDiscard(false);close();
 };
 useEffect(()=>{
  if(confirmDiscard)keepButton.current?.focus();
  else {accepting.current=false;const target=confirmReturnFocus.current;if(target){confirmReturnFocus.current=null;(target.isConnected?target:closeButton.current)?.focus();}}
 },[confirmDiscard]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,dialog=ref.current;dialog?.showModal();return()=>{if(dialog?.open)dialog.close();if(previous?.isConnected)previous.focus();};},[]);
 useEffect(()=>context?.registerNavigationGuard?.(()=>current.current.busy?ux('pending'):current.current.dirty?ux('unsaved'):null),[context?.registerNavigationGuard,busy,locale]);
 useEffect(()=>{const prevent=(e:BeforeUnloadEvent)=>{if(current.current.dirty||current.current.busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[busy]);
 return <dialog ref={ref} className="gov-dialog mare-governance-dialog" data-confirming={confirmDiscard||undefined} aria-labelledby={titleId} aria-describedby={confirmDiscard?descriptionId:undefined} onInputCapture={()=>{current.current.dirty=true;}} onChangeCapture={()=>{current.current.dirty=true;}} onCancel={event=>{event.preventDefault();requestClose();}}>
  <header><h2 id={titleId}>{confirmDiscard?ux('discard'):title}</h2><button ref={closeButton} type="button" disabled={busy} onClick={requestClose} aria-label={d('close')}><X size={18}/></button></header>
  <div className="gov-dialog-body" hidden={confirmDiscard} style={confirmDiscard?{display:'none'}:undefined}>{children}</div>
  {confirmDiscard && <div className="gov-discard-confirmation">
   <p id={descriptionId}>{ux('unsaved')}</p>
   <div className="gov-actions">
    <button ref={keepButton} type="button" className="primary" disabled={busy} onClick={()=>setConfirmDiscard(false)}>{ux('keepEditing')}</button>
    <button type="button" className="danger" disabled={busy} onClick={discard}>{ux('discardChanges')}</button>
   </div>
  </div>}
 </dialog>;
}
function cancelDialog(event:MouseEvent<HTMLButtonElement>){event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel',{cancelable:true}));}
function TensionActions({title,children}:{title:string;children:ReactNode}){
 const {locale}=useGovernanceLocalization(),ux=governanceUXTranslator(locale),ref=useRef<HTMLDetailsElement>(null);
 return <details ref={ref} className="gov-tension-menu" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();ref.current?.removeAttribute('open');ref.current?.querySelector('summary')?.focus();}}}>
  <summary aria-label={ux('process')+': '+title}>{ux('process')}</summary>
  <div className="gov-tension-menu-items" onClick={e=>{if((e.target as HTMLElement).closest('button')){ref.current?.removeAttribute('open');ref.current?.querySelector('summary')?.focus();}}}>{children}</div>
 </details>;
}
function GovernanceExperience({context}:{context:FeatureContext}) {
  const match=/^\/structure\/proposals\/[a-f0-9-]{36}(?:[?#]|$)/i.test(context.path);
  const {locale,d}=useGovernanceLocalization();
  return <><GovernanceFeature context={match?{...context,path:"/structure/proposals"}:context}/>{match&&<SurfaceDialog title={governanceCatalogueTranslator(locale)('proposalDialog')} closeLabel={d('close')} onClose={()=>context.navigate("/structure/proposals")}><div className="proposal-detail-dialog"><GovernanceFeature context={context}/></div></SurfaceDialog>}</>;
}
function GovernanceFeature({ context: c }: { context: FeatureContext }) {
  const documentText=useDocumentActionText();
  const modalState=useRef<ModalState>({dirty:false,busy:false});
  const [showArchivedDocuments,setShowArchivedDocuments]=useState(false);
 const {p:processText}=useGovernanceLocalization();
  const {locale,formatInstant,formatNumber,label,countLabel,ui,d,f,m} = useGovernanceLocalization();
  const consentText = consentTranslator(locale);
  const composerText = proposalComposerTranslator(locale);
  const asyncConsentText = asyncConsentTranslator(locale);
  const meetingConsentHelp = meetingConsentHelpTranslator(locale);
  const consentHistory = consentHistoryTranslator(locale);
  const ux=governanceUXTranslator(locale);
  const cat=governanceCatalogueTranslator(locale);
  const scopeHelpId=useId();
  const [items, setItems] = useState<Row[]>([]),
    [types, setTypes] = useState<Row[]>([]),
    [docs, setDocs] = useState<Row[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailReferenceScope, setDetailReferenceScope] = useState(""),
    [detailClock, setDetailClock] = useState<{asOf:string;receivedAt:number}|null>(null),
    [docDetail, setDocDetail] = useState<DocDetail | null>(null),
    [errorCause, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [modal, setModal] = useState<string | null>(null),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState("");
  const error=errorCause?governanceError(errorCause,locale):'';
  const [proposalEntryCircle,setProposalEntryCircle]=useState<string|undefined>();
  const [proposalEntryType,setProposalEntryType]=useState<"role"|"circle"|"restriction"|undefined>();
  const [viewRevision,setViewRevision]=useState<number|null>(null);
  const [inlineEditing,setInlineEditing]=useState(false);
  const inlineEntry=useRef<string|undefined>(undefined);
  const [historicalDocument,setHistoricalDocument]=useState<{key:string;document?:Detail['meetingDocument'];documents?:Detail['meetingDocuments'];failed?:boolean}>();
  const [historyRetry,setHistoryRetry]=useState(0);
  const editButton=useRef<HTMLButtonElement>(null);
  const [proposalFilterType,setProposalFilterType]=useState('');
  const [proposalFilterCircle,setProposalFilterCircle]=useState('');
  const [proposalView,setProposalView]=useState<'list'|'cards'>('list');
  const [proposalGroup,setProposalGroup]=useState<'state'|'circle'|'none'>('circle');
  const [proposalSort,setProposalSort]=useState<'newest'|'oldest'|'name'>('newest');
  const [quickFilter,setQuickFilter]=useState('vote');
  const [tensionScope,setTensionScope]=useState<'mine'|'circles'|'all'>('mine');
  const [documentScope,setDocumentScope]=useState<'roles'|'circles'|'all'>('roles');
  const [restrictionCircle,setRestrictionCircle]=useState('');
  const [restrictionCircleSearch,setRestrictionCircleSearch]=useState('');
  const [restrictionPreview,setRestrictionPreview]=useState<DocDetail|null>(null);
  const [tensionExpanded,setTensionExpanded]=useState(false);
  const tensionDrawerRef=useRef<HTMLElement>(null);
  const tensionOpenerRef=useRef<HTMLElement|null>(null);
  const tensionReturnRef=useRef<{id:string;scope:string}|null>(null);
  const [tensionMobile,setTensionMobile]=useState(false);
  useEffect(()=>{const query=window.matchMedia?.('(max-width:767px)');if(!query)return;const update=()=>setTensionMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  const [filterOpen,setFilterOpen]=useState(false);
  const filterButton=useRef<HTMLButtonElement>(null), filterPanel=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!filterOpen)return;filterPanel.current?.focus();const outside=(event:PointerEvent)=>{const target=event.target as Node;if(!filterPanel.current?.contains(target)&&!filterButton.current?.contains(target))setFilterOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[filterOpen]);
  const closeFilters=()=>{setFilterOpen(false);filterButton.current?.focus();};
  const clearFilters=()=>{setSearch('');setFilter('');setQuickFilter('');setProposalFilterType('');setProposalFilterCircle('');};
  const noPendingProposals=!error&&quickFilter==='vote'&&!search.trim()&&!filter&&!proposalFilterType&&!proposalFilterCircle;
  const activeFilters=Number(Boolean(filter))+Number(Boolean(proposalFilterType))+Number(Boolean(proposalFilterCircle))+Number(Boolean(quickFilter)&&!['vote','mine','circles'].includes(quickFilter));
  const path = c.path.split("?")[0],
    section = path.includes("working-agreements")
      ? "documents"
      : path.includes("tensions")
        ? "tensions"
        : path.includes("branches")
          ? "branches"
          : path.includes("governance-policy")
            ? "policies"
            : "proposals";
  const noScopedRestrictions=section==='documents'&&documentScope!=='all'&&!error&&!search.trim()&&!filter&&!restrictionCircle;
  const selectedId = path.match(
    /\/(?:proposals|working-agreements)\/([\da-f-]{36})$/,
  )?.[1];
  const query = new URLSearchParams(c.path.split("?")[1] ?? "");
  const requestedRevision = query.get('revision');
  const requestedRevisionApplied = useRef('');
  useEffect(() => {
    if (!detail || detail.proposal.id !== selectedId) return;
    const key = `${c.organizationId}:${selectedId}:${requestedRevision ?? ''}`;
    if (requestedRevisionApplied.current === key) return;
    requestedRevisionApplied.current = key;
    if (!requestedRevision) { setViewRevision(null); return; }
    const number = Number(requestedRevision);
    if (requestedRevision && Number.isInteger(number) && detail.revisions.some(revision => revision.number === number)) setViewRevision(number);
  }, [c.organizationId, selectedId, requestedRevision, detail]);
  useEffect(()=>{
    if (query.get('edit')!=='1') {inlineEntry.current=undefined;return;}
    if (!detail || detail.proposal.id!==selectedId || inlineEntry.current===c.path) return;
    inlineEntry.current=c.path;
    if (canEditDraftInline(detail)) {setDetailTab('proposal');setViewRevision(null);setInlineEditing(true);}
  },[c.path,selectedId,detail]);
  const vocabulary = governanceVocabulary(c.bootstrap);
  useEffect(() => {
    if (section === "documents" && query.get("create") === "1" && c.bootstrap.membership.memberType !== "GUEST") {
      setModal("create");
      c.navigate("/structure/working-agreements");
    }
  }, [c.path]);
  const focusedTensionId = section === "tensions" ? query.get("tensionId") : null;
  const root =
    "/structure/" +
    (section === "documents"
      ? "working-agreements"
      : section === "policies"
        ? "governance-policy"
        : section);
  const apiRoot = "/organizations/" + c.organizationId;
  const guest=c.bootstrap.membership.memberType==="GUEST";
  const owner = c.bootstrap.capabilities?.["structure.direct"] === true,
    actor = c.bootstrap.membership.id;
  const entityName = (eid?: string) =>
    c.structure.nodes.find((n) => n.entityId === eid)?.name ?? "—";
  const documentCircle=(ownerId?:string)=>{const node=c.structure.nodes.find(item=>item.entityId===ownerId);return node?.kind==='ROLE'?c.structure.nodes.find(item=>item.nodeId===node.parentNodeId)?.entityId:ownerId;};
  const governedChanges=!!c.bootstrap.governanceModel&&c.bootstrap.governanceModel.phase==='OPERATING'&&c.bootstrap.governanceModel.rules.structureChanges==='GOVERNANCE';
  const circleDocument=(ownerId?:string)=>c.structure.nodes.find(item=>item.entityId===ownerId)?.kind==='CIRCLE';
  const governedRestriction=(doc:{ownerId?:string})=>governedChanges&&circleDocument(doc.ownerId);
  const referenceScope=JSON.stringify([c.organizationId,c.session.account.id,actor,c.bootstrap.membership.orgRole,c.bootstrap.membership.memberType,c.bootstrap.authorizationRevision,selectedId]);
  const referenceScopeRef=useRef(referenceScope);referenceScopeRef.current=referenceScope;
  const historicalRevision=detail && viewRevision!==null && viewRevision!==detail.proposal.revision && (detail.revisions.find(revision=>revision.number===viewRevision)?.payload.documentId || detail.revisions.find(revision=>revision.number===viewRevision)?.payload.documents?.length) ? viewRevision : null;
  const historyKey=JSON.stringify([referenceScope,historicalRevision,historyRetry]);
  useEffect(()=>{
    if (!selectedId || historicalRevision===null) return;
    const controller=new AbortController();
    void c.api<Detail>(`${apiRoot}/proposals/${selectedId}?documentRevision=${historicalRevision}`,{signal:controller.signal}).then(({data})=>{
      if (!controller.signal.aborted) setHistoricalDocument({key:historyKey,document:data.meetingDocument,documents:data.meetingDocuments});
    },()=>{if(!controller.signal.aborted)setHistoricalDocument({key:historyKey,failed:true});});
    return ()=>controller.abort();
  },[historyKey,c.api]);
  useEffect(()=>{setRestrictionPreview(null);setModal(null);},[c.organizationId,c.session.account.id,actor,c.bootstrap.authorizationRevision]);
  useEffect(()=>{
    if(section!=='proposals'||selectedId||guest||query.get('new')!=='1')return;
    setProposalEntryCircle(query.get('circleId')||undefined);const entryType=query.get('proposalType');setProposalEntryType(entryType==='role'||entryType==='circle'||entryType==='restriction'?entryType:undefined);setModal('create');
    const remaining=new URLSearchParams(query);remaining.delete('new');remaining.delete('circleId');remaining.delete('proposalType');
    c.navigate(root+(remaining.size?'?'+remaining.toString():''));
  },[c.path,c.organizationId,c.session.account.id,actor,c.bootstrap.authorizationRevision]);
  const detailEntityName=(eid?:string)=>c.structure.nodes.find(n=>n.entityId===eid)?.name ?? (!guest && detailReferenceScope===referenceScope && detail?.proposal.id===selectedId ? detail?.entityReferences?.find(ref=>ref.entityId===eid)?.name : undefined) ?? "—";
  const memberName = (mid: string) =>
    c.members.find((m) => m.id === mid)?.displayName ?? m('member');
  const loadedScope = useRef("");
  useEffect(() => {
    const abort = new AbortController();
    const scope = JSON.stringify([referenceScope, section, path]);
    const sameScope = loadedScope.current === scope;
    loadedScope.current = scope;
    if (!sameScope) {
      setItems([]);
      setDocs([]);
      setTypes([]);
      setDetail(null);
      setInlineEditing(false);
      setDetailClock(null);
      setViewRevision(null);
      setDocDetail(null);
      setLoading(true);
    }
    setError("");
    const resource =
      section === "branches"
        ? "governance/branches"
        : section === "policies"
          ? "governance/policies"
          : section;
    const load = async () => {
      try {
        if (sameScope && selectedId && section === 'proposals') {
          const response = await c.api<Detail>(`${apiRoot}/proposals/${selectedId}`, { signal: abort.signal });
          if (!abort.signal.aborted) {
            setDetail(response.data);
            setDetailReferenceScope(referenceScope);
            setDetailClock({asOf:response.meta?.asOf??"",receivedAt:performance.now()});
          }
          return;
        }
        const [list, agreements, documentTypes] = await Promise.all([
          listGovernanceRows(c.api, apiRoot + "/" + resource, abort.signal),
          listGovernanceRows(c.api, apiRoot + "/documents", abort.signal),
          guest ? Promise.resolve([] as Row[]) : listGovernanceRows(c.api, apiRoot + "/document-types", abort.signal),
        ]);
        if (abort.signal.aborted) return;
        setItems(list);
        setDocs(agreements);
        setTypes(documentTypes);
        if (selectedId) {
          const d = await c.api<Detail | DocDetail>(
            apiRoot +
              "/" +
              (section === "documents" ? "documents" : "proposals") +
              "/" +
              selectedId,
            { signal: abort.signal },
          );
          if (abort.signal.aborted) return;
          if (section === "documents") setDocDetail(d.data as DocDetail);
          else {setDetail(d.data as Detail);setDetailReferenceScope(referenceScope);setDetailClock({asOf:d.meta?.asOf??"",receivedAt:performance.now()});}
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(e);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => abort.abort();
  }, [c.organizationId, path, revision,guest,referenceScope]);
  async function command(path: string, body: unknown = {}, version?: number, refreshShell = true) {
    setError("");
    setBusy(true);
    try {
      const result = await c.api<Row>(apiRoot + path, {
        method: "POST",
        body,
        version,
      });
      modalState.current.dirty=false;
      setRevision((v) => v + 1);
      if (refreshShell) c.refresh();
      return result.data;
    } catch (e) {
      setError(e);
      if (e instanceof RequestError && e.code === "APPLY_CONFLICT")
        setRevision((v) => v + 1);
      throw e;
    } finally {
      modalState.current.busy=false;
      setBusy(false);
    }
  }
  async function act(path: string, body: unknown = {}, version?: number) {
    try {
      await command(path, body, version);
      c.notify(d('saved'));
    } catch {}
  }
  async function processTension(row: Row, kind: "TASK" | "GOAL", projectId?: string | null) {
    try {
      const result = await command(`/tensions/${row.id}/actions/process`, { targetKind: kind, ...(projectId !== undefined ? { projectId } : {}) }, row.version);
      c.notify(d('saved'));
      setModal(null);
      const destination = result.targetId && traceRoute({ kind, id: result.targetId, title: row.title }, `/structure/tensions?tensionId=${row.id}`);
      if (destination) c.navigate(destination);
    } catch {}
  }
  const myCircleIds=new Set([...(c.structure.memberships??[]),...(c.structure.occupancies??[])].filter(relation=>relation.memberId===actor && Date.parse(relation.startsAt)<=Date.now() && (!relation.endsAt||Date.parse(relation.endsAt)>Date.now())).map(relation=>relation.circleId));
  function matchesProposalScope(row:Row,scope:string){return !scope || (scope==='open'&&['DRAFT','REVIEW'].includes(row.state??'')) || (scope==='adopted'&&row.verdict==='ADOPT') || (scope==='rejected'&&row.verdict==='REJECT') || (scope==='mine'&&row.authorId===actor) || (scope==='vote'&&row.canVote===true&&!row.ownVote) || (scope==='circles'&&!!row.circleId&&myCircleIds.has(row.circleId));}
  function matchesDocumentScope(i:Row,scope:string){return scope === 'all' || (scope === 'circles' && c.structure.memberships.some(m=>m.memberId===actor && m.circleId===documentCircle(i.ownerId) && Date.parse(m.startsAt)<=Date.now() && (!m.endsAt||Date.parse(m.endsAt)>Date.now()))) || (scope === 'roles' && !!i.richContent && collectRoleMentionIds(i.richContent).some(roleId=>c.structure.occupancies.some(o=>o.memberId===actor && o.roleId===roleId && Date.parse(o.startsAt)<=Date.now() && (!o.endsAt||Date.parse(o.endsAt)>Date.now()))));}
  function matchesTensionScope(i:Row,scope:string){return scope === 'all' || (scope === 'mine' && i.authorId === actor) || (scope === 'circles' && c.structure.memberships.some(m=>m.memberId===actor && m.circleId===i.circleId && Date.parse(m.startsAt)<=Date.now() && (!m.endsAt||Date.parse(m.endsAt)>Date.now())));}
  const recordScopeCounts:Record<string,number>=section==='documents'?Object.fromEntries(['roles','circles','all'].map(scope=>[scope,items.filter(i=>(showArchivedDocuments||!i.archived)&&matchesDocumentScope(i,scope)).length])):section==='tensions'?Object.fromEntries(['mine','circles','all'].map(scope=>[scope,items.filter(i=>matchesTensionScope(i,scope)).length])):{};
  const proposalScopeCounts=Object.fromEntries(['vote','mine','circles',''].map(scope=>[scope,items.filter(row=>matchesProposalScope(row,scope)).length]));
  const filtered = items.filter(
    (i) => {
      if (section === 'tensions' && i.id === focusedTensionId) return true;
      return (
      (section !== 'documents' || showArchivedDocuments || !i.archived) &&
      (section !== 'documents' || !restrictionCircle || documentCircle(i.ownerId)===restrictionCircle) &&
      (section !== 'documents' || matchesDocumentScope(i,documentScope)) &&
      (section !== 'tensions' || matchesTensionScope(i,tensionScope)) &&
      (!filter || (section==='proposals'?proposalDisplayState(i):i.state) === filter) &&
      (section!=='proposals'||(matchesProposalScope(i,quickFilter)&&(!proposalFilterType||(['ROLE','CIRCLE'].includes(proposalFilterType)?i.kind==='GOVERNANCE'&&i.changeKinds?.includes(proposalFilterType as 'ROLE'|'CIRCLE'):proposalFilterType==='DOCUMENT'?(i.kind==='DOCUMENT'||(i.kind==='GOVERNANCE'&&i.changeKinds?.includes('DOCUMENT'))):i.kind===proposalFilterType))&&(!proposalFilterCircle||i.circleId===proposalFilterCircle))) &&
      (!search || i.title?.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)) || (section==='documents' && (i.richContent?toPlainText(i.richContent):i.content??'').toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale))))
      );
    },
  );
  const [detailTab,setDetailTab]=useState<"proposal"|"decision"|"activity">("proposal");
  useEffect(() => { setDetailTab("proposal"); }, [c.organizationId, c.session.account.id, actor, selectedId]);
  const selected = detail?.proposal ?? docDetail?.document;
  const focusedTension = section === 'tensions' ? items.find(row=>row.id===focusedTensionId) : undefined;
  useEffect(()=>{
    if(focusedTension){tensionReturnRef.current={id:focusedTension.id,scope:referenceScope};tensionDrawerRef.current?.focus();return;}
    const previous=tensionReturnRef.current;
    if(previous&&previous.scope!==referenceScope){tensionReturnRef.current=null;return;}
    if(section!=='tensions'||focusedTensionId||loading||!previous)return;
    const target=tensionOpenerRef.current?.isConnected?tensionOpenerRef.current:document.querySelector<HTMLElement>(`[data-tension-id="${previous.id}"]`);
    if(target){target.focus();tensionReturnRef.current=null;}
  },[focusedTension?.id,focusedTensionId,loading,referenceScope]);
  // A record route never falls back to the catalogue: it shows the record, a loading state or why it is unavailable.
  const missingRecord=!!selectedId&&(section==='proposals'||section==='documents')&&!loading&&!detail&&!docDetail;
  const missingNotFound=missingRecord&&errorCause instanceof RequestError&&['RESOURCE_NOT_FOUND','NOT_FOUND','FORBIDDEN'].includes(errorCause.code);
  type ScopeTab=readonly [string,string,(props:{size?:number})=>ReactNode];
  const proposalScopes:readonly ScopeTab[]=[['vote',ui('needsMe'),Inbox],['mine',ui('mine'),User],['circles',ui('myCircles'),StructureIcon],['',ui('allScope'),Layers]];
  const recordScopes:readonly ScopeTab[]=section==='tensions'?[['mine','Minhas',User],['circles','Meus círculos',StructureIcon],['all','Todas',Layers]]:[['roles','Meus papéis',User],['circles','Meus círculos',StructureIcon],['all','Todas',Layers]];
  const currentRecordScope:string=section==='tensions'?tensionScope:documentScope;
  // Scoped empty state: counts come from the already loaded catalogue, never from a new request.
  const scopeCountOf=(value:string)=>section==='proposals'?proposalScopeCounts[value]??0:recordScopeCounts[value]??0;
  const scopedEmpty=!error&&!search.trim()&&(section==='proposals'?['vote','mine','circles'].includes(quickFilter)&&!filter&&!proposalFilterType&&!proposalFilterCircle:section==='documents'?documentScope!=='all'&&!restrictionCircle:section==='tensions'?tensionScope!=='all'&&!filter:false);
  const allScopeCount=section==='proposals'?proposalScopeCounts['']??0:recordScopeCounts.all??0;
  const otherScopes=(section==='proposals'?proposalScopes:recordScopes).filter(([value])=>value!==''&&value!=='all'&&value!==(section==='proposals'?quickFilter:currentRecordScope)&&scopeCountOf(value)>0);
  const scopeHelpText=section==='proposals'?(quickFilter==='mine'?ui('scopeMine'):ui('scopeCircles')):section==='tensions'?(tensionScope==='mine'?'As situações que você percebeu e seus próximos encaminhamentos.':'Tensões compartilhadas nos seus círculos.'):(documentScope==='roles'?'Restrições que mencionam os papéis que você energiza.':'Restrições que orientam o trabalho nos seus círculos.');
  return (
    <div className={"gov-page mare-governance"+(missingRecord?' is-missing-record':'')+(selectedId?' mare-governance-detail':'')+(section==='proposals'&&!selectedId?' mare-proposal-catalogue':'')+(!selectedId&&(section==='documents'||section==='tensions')?' mare-record-catalogue mare-'+section+'-catalogue':'')+(focusedTension?' has-tension-drawer':'')}>
      <div className="gov-heading">
        <div>
          {selectedId && (
            <button className="gov-back" onClick={() => c.navigate(root)}>{d('back')}</button>
          )}
          <h1>
            {selected?.title ??
              {
                proposals: d('proposals'),
                documents: vocabulary.agreements,
                tensions: d('tensions'),
                branches: d('branches'),
                policies: d('process'),
              }[section]}
          </h1>
          {detail && (
            <div className="gov-title-state">
              <ProposalStatus row={detail.proposal}/>
              {detail.proposal.circleId && <span className="gov-title-meta"><StructureIcon size={15}/>{detailEntityName(detail.proposal.circleId)}</span>}
              {detail.proposal.authorId && <span className="gov-title-meta"><User size={14} aria-hidden="true"/>{memberName(detail.proposal.authorId)}</span>}
            </div>
          )}
        </div>
        <div className="gov-actions">
          {detail && !inlineEditing && canEditDraftInline(detail) && <button ref={editButton} type="button"
            disabled={busy || (viewRevision!==null && viewRevision!==detail.proposal.revision)} onClick={()=>{setDetailTab('proposal');setViewRevision(null);setInlineEditing(true);}}>
            <Pencil size={16} aria-hidden="true" />{locale.startsWith('pt')?'Editar proposta':'Edit proposal'}
          </button>}
          {!selectedId && !guest && section!=='proposals' && section!=='documents' && section!=='tensions' && (
            <button className="primary"
              onClick={() => {setProposalEntryCircle(undefined);setProposalEntryType(undefined);
                setModal(section === "policies" ? "policy" : "create");
              }}
            >
              <Plus size={18}/>{section === "policies"
                ? d('configureProcess')
                : d('createBranch')}
            </button>
          )}
          {detail &&
            detail.proposal.state === "DRAFT" &&
            !detail.proposal.meetingConsentRequired &&
            detail.proposal.canEdit && (
              <button
                className="primary"
                disabled={
                  busy || inlineEditing ||
                  (detail.proposal.kind === "ELECTION" &&
                    !detail.revisions.at(-1)?.payload.winnerId)
                }
                onClick={() =>
                  detail.proposal.policy?.decisionProcess === "HOLACRACY_O2" &&
                  detail.proposal.policy.method !== "CONSENT_WINDOW"
                    ? setModal("conduct")
                    : void act(
                        "/proposals/" + selectedId + "/actions/submit",
                        {},
                        detail.proposal.version,
                      )
                }
              >{d('submit')}</button>
            )}
          {detail?.proposal.consentMeetingId && (
            <button className="primary" disabled={busy || inlineEditing || (viewRevision !== null && viewRevision !== detail.proposal.revision)} onClick={() => setModal('meeting-consent')}>
              {consentText('record')}
            </button>
          )}
        </div>
      </div>
      {error && !missingRecord && (
        <div className="gov-notice" role="alert">
          {error}{" "}
          <button onClick={() => setRevision((v) => v + 1)}>{d('refresh')}</button>
        </div>
      )}
      {loading ? (
        <div role="status" aria-label={d('loading')} className="mare-loading gov-loading"><i/><i/><i/><i/><i/></div>
      ) : missingRecord ? (
        <section className="gov-missing-record" role={missingNotFound?'status':'alert'}>
          {missingNotFound?<SearchX size={28} aria-hidden="true"/>:<AlertTriangle size={28} aria-hidden="true"/>}
          <h2>{missingNotFound?cat(section==='documents'?'restrictionMissingTitle':'proposalMissingTitle'):cat('loadFailedTitle')}</h2>
          <p>{missingNotFound?cat(section==='documents'?'restrictionMissingText':'proposalMissingText'):error}</p>
          <div className="gov-missing-actions">
            {!missingNotFound&&<button type="button" onClick={() => setRevision((v) => v + 1)}>{d('refresh')}</button>}
            <button type="button" className={missingNotFound?'primary':undefined} onClick={() => c.navigate(root)}>{cat(section==='documents'?'backToRestrictions':'backToProposals')}</button>
          </div>
        </section>
      ) : detail ? (
        <>
          {(detail.proposal.meetingConsentRequired || detail.proposal.meetingConsentPending) && <p className="muted gov-meeting-consent-note">{
            detail.proposal.meetingConsentPending ? (locale.startsWith('pt')
              ? 'O escriba em exercício pode registrar o consentimento após a aprovação desta revisão na reunião.'
              : 'The acting secretary can record consent after this revision is approved in the meeting.') : meetingConsentHelp('required')
          }</p>}
          <TraceReturnLink context={c} returnTo={query.get("returnTo")} disabled={busy} />
          <TraceOrigin context={c} endpoint={`${apiRoot}/proposals/${detail.proposal.id}/origin`} returnTo={`/structure/proposals/${detail.proposal.id}`} disabled={busy} />
        <nav className="proposal-detail-tabs" aria-label="Detalhes da proposta">{[["proposal","Proposta"],["decision","Decisão"],["activity","Atividade"]].map(([value,title])=><button key={value} type="button" aria-pressed={detailTab===value} disabled={inlineEditing&&value!=='proposal'} onClick={()=>setDetailTab(value as typeof detailTab)}>{title}</button>)}</nav>
        <div className="gov-detail">
          <section className="gov-evolution">
            <div hidden={detailTab!=="proposal"}>
            {inlineEditing ? <ProposalDraftEditor
              context={c} detail={detail} entityName={detailEntityName}
              onSaved={setDetail}
              onDone={()=>{setInlineEditing(false);requestAnimationFrame(()=>editButton.current?.focus());}}
              onReload={()=>{setInlineEditing(false);setRevision(value=>value+1);}}
            /> : <>
            <div className="gov-detail-toolbar">
              <h2>
                {d('changes',{count:formatNumber(detail.revisions.find(r=>r.number===(viewRevision??detail.proposal.revision))?.payload.changes?.length ?? 1)})}
              </h2>
              {!canEditDraftInline(detail) && (detail.proposal.canAmend ?? detail.proposal.canEdit) &&
                (detail.proposal.kind !== "ELECTION" ||
                  owner ||
                  !detail.revisions.at(-1)?.payload.winnerId) &&
                detail.proposal.applyState !== "APPLIED" &&
                detail.proposal.state !== "WITHDRAWN" && (
                  (detail.proposal.canEdit || detail.proposal.kind==='GOVERNANCE') &&
                  <button disabled={busy || (viewRevision!==null && viewRevision!==detail.proposal.revision)} onClick={() => {setViewRevision(null);setModal("amend");}}>{d('amend')}</button>
                )}
            </div>
            {detail.revisions.length>1&&<Field label={m('revisionOfChange')}><select value={viewRevision??detail.proposal.revision} onChange={e=>setViewRevision(Number(e.target.value))}>{detail.revisions.map(r=><option key={r.number} value={r.number}>{d('revision')} {r.number}{' ('+m(r.number===detail.proposal.revision?'current':'historical')+')'}</option>)}</select></Field>}
            <ProposalPayload
              detail={detail}
              revision={viewRevision??undefined}
              historicalDocument={historicalDocument?.key===historyKey ? historicalDocument.document : undefined}
              historicalDocuments={historicalDocument?.key===historyKey ? historicalDocument.documents : undefined}
              entityName={detailEntityName}
              docs={docs}
              memberName={memberName}
              navigate={c.navigate}
              context={c}
            />
            {historicalRevision!==null && historicalDocument?.key!==historyKey && <p role="status" className="muted">{d('loading')}</p>}
            {historicalRevision!==null && historicalDocument?.key===historyKey && historicalDocument.failed && <button type="button" onClick={()=>setHistoryRetry(n=>n+1)}>{d('refresh')}</button>}
            </>}
            </div>
            <div hidden={detailTab!=="decision"} className="proposal-decision-panel">
            {detail.proposal.kind === "ELECTION" && (
              <section className="gov-process">
                <h2>{m('nominationsRegistered')} </h2>
                {detail.nominations.length ? (
                  <ul>
                    {detail.nominations.map((n) => (
                      <li key={n.id}>
                        {memberName(n.candidateId)}: {n.rationale}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{m('noNominations')} </p>
                )}
                {detail.proposal.state === "DRAFT" &&
                  detail.proposal.canEdit && (
                    <NominationForm
                      c={c}
                      disabled={busy}
                      onSubmit={(candidateId, rationale) =>
                        void act(
                          "/proposals/" + selectedId + "/nominations",
                          { candidateId, rationale },
                          detail.proposal.version,
                        )
                      }
                    />
                  )}
              </section>
            )}
            {detail.rounds.length > 0 && (
              <section className="gov-process">
                <h2>{d('decisionRound')}</h2>
                {detail.rounds
                  .filter((r) => r.revision === detail.proposal.revision)
                  .map((round) => (
                    <div key={round.id}>
                      <p>
                        {label(round.policy.method)} · {d('step')}:{" "}
                        {label(round.step)}
                      </p>
                      {detail.proposal.kind !== 'ELECTION' && round.policy.decisionProcess === 'HOLACRACY_O2' && round.policy.method === 'CONSENT_WINDOW' && round.state === 'OPEN' && <div role="status">
                        <p>{round.deadline ? asyncConsentText('waiting',{date:formatInstant(round.deadline)}) : asyncConsentText('distributing')}</p>
                        <p>{asyncConsentText('automatic')}</p>
                        <button type="button" disabled={busy} onClick={() => setRevision(v=>v+1)}>{d('refresh')}</button>
                      </div>}
                      <p>
                        {!(detail.proposal.kind !== 'ELECTION' && round.policy.decisionProcess === 'HOLACRACY_O2' && round.policy.method === 'CONSENT_WINDOW') && <>{d('quorum')} {formatNumber(round.policy.quorumPercent/100,{style:'percent'})} · </>}
                        {countLabel(round.electorate.length,'participants')}
                        {round.deadline && (
                          <>
                            {" "}
                            · {ui('deadline')}{" "}
                            {formatInstant(round.deadline)}
                          </>
                        )}
                      </p>
                      {round.state === "OPEN" && <p className="gov-process-help">{ux('voteHelp')}</p>}
                      {round.state === "OPEN" &&
                        detail.proposal.canVote &&
                        round.electorate.includes(actor) && (
                          <VoteForm
                            disabled={busy}
                            allowAbstain={round.policy.allowAbstain}
                            locked={
                              !round.policy.allowRevote &&
                              detail.ballots.some(
                                (b) =>
                                  b.roundId === round.id &&
                                  b.memberId === actor,
                              )
                            }
                            onSubmit={async (choice, rationale) => {
                              try {
                                await command("/proposals/" + selectedId + "/votes", { choice, rationale }, detail.proposal.version, false);
                              } catch { /* Keep the form and its rationale available for retry. */ }
                            }}
                          />
                        )}
                      {round.state==='OPEN' && round.policy.method==='CONSENT_WINDOW' && !!round.deadline && detail.proposal.canVote && round.electorate.includes(actor) && <div className="gov-round-controls"><p>Levar para reunião interrompe o período assíncrono sem registrar um voto.</p><button type="button" disabled={busy} onClick={()=>setModal('escalate')}>Escalar para reunião</button></div>}
                      {(() => {
                        const own = detail.ballots.filter(ballot => ballot.roundId === round.id && ballot.memberId === actor).sort((a, b) => b.number - a.number)[0];
                        if (!own) return null;
                        const text = locale.startsWith('pt')
                          ? own.choice === 'CONSENT' ? 'Consentimento registrado' : own.choice === 'OBJECT' ? 'Objeção registrada' : 'Abstenção registrada'
                          : `${label(own.choice)} · ${d('saved')}`;
                        return <p role="status" className="gov-own-vote">{text}</p>;
                      })()}
                      <ul className="gov-votes">
                        {detail.ballots
                          .filter((b) => b.roundId === round.id)
                          .map((b, i) => (
                            <li key={i}>
                              {memberName(b.memberId)}: {label(b.choice)}
                              {b.number > 1 && ' '+d('voteNumber',{number:formatNumber(b.number)})}
                              {b.rationale && <p>{b.rationale}</p>}
                            </li>
                          ))}
                      </ul>
                      {round.state === "OPEN" && owner && !(detail.proposal.kind !== 'ELECTION' && round.policy.decisionProcess === 'HOLACRACY_O2' && round.policy.method === 'CONSENT_WINDOW') && (
                        <div className="gov-round-controls">
                         <p className="gov-process-help">{ux('advanceHelp')}</p>
                         <div className="gov-actions">
                          <button className={round.step !== round.policy.workflowSteps.at(-1)?'primary':undefined}
                            disabled={
                              busy ||
                              round.policy.workflowSteps.at(-1) === round.step
                            }
                            onClick={() =>
                              void act(
                                "/proposals/" + selectedId + "/actions/step",
                                {
                                  step: round.policy.workflowSteps[
                                    round.policy.workflowSteps.indexOf(
                                      round.step,
                                    ) + 1
                                  ],
                                },
                                detail.proposal.version,
                              )
                            }
                          >{d('nextStep')}</button>
                          <DecisionWindow key={`${c.organizationId}:${detail.proposal.id}:${round.id}:${round.revision}`} method={round.policy.method} deadline={round.deadline} clock={detailClock} locale={locale} formatInstant={formatInstant} disabled={busy || round.step !== round.policy.workflowSteps.at(-1)} onDecide={() => setModal("decide")} label={d('recordDecision')}/>
                         </div>
                         {round.step !== round.policy.workflowSteps.at(-1) && <p className="gov-process-help">{ux('decisionHelp')}</p>}
                        </div>
                      )}
                    </div>
                  ))}
              </section>
            )}
            {detail.objections.length > 0 && (
              <section className="gov-process">
                <h2>{d('objections')}</h2>
                {detail.objections.map((o) => (
                  <article className="gov-objection" key={o.id}>
                    <p>{o.rationale}</p>
                    <p className="muted">
                      {memberName(o.authorId)} · {label(o.state)}
                      {detail.rounds.find(round => round.id === o.roundId) && <> · {d('revision')} {formatNumber(detail.rounds.find(round => round.id === o.roundId)!.revision)}</>}
                    </p>
                    {detail.rounds.some(round => round.id === o.roundId && round.state === "OPEN" && round.revision === detail.proposal.revision) && !["INTEGRATED", "INVALID", "WITHDRAWN"].includes(
                      o.state,
                    ) && (
                      <ObjectionForm
                        owner={owner}
                        mine={o.authorId === actor}
                        disabled={busy}
                        onSubmit={(state, reason) =>
                          act(
                            "/governance/objections/" +
                              o.id +
                              "/actions/review",
                            { state, reason },
                            o.version,
                          )
                        }
                      />
                    )}
                  </article>
                ))}
              </section>
            )}
            {detail.proposal.state === "DECIDED" && (
              <section className="gov-process">
                <h2>{label(detail.proposal.verdict)}</h2>
                <p>{label(detail.proposal.applyState)}</p>
                {owner &&
                  detail.proposal.verdict === "ADOPT" &&
                  detail.proposal.applyState !== "APPLIED" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          "/proposals/" + selectedId + "/actions/apply",
                          {},
                          detail.proposal.version,
                        )
                      }
                    >{d('apply')}</button>
                  )}
                {detail.proposal.applyState === "APPLY_CONFLICT" && (
                  <p>
                    {d('conflict')}
                  </p>
                )}
              </section>
            )}
            {detail.commits.map((commit) => (
              <p className="muted" key={commit.id}>
                {d('appliedAt',{at:formatInstant(commit.at)})}
              </p>
            ))}
            </div>
            <div hidden={detailTab!=="activity"} className="proposal-activity-panel">
            {detail.history&&<details className="gov-history" open><summary>{d('activity')}<span className="gov-count">{formatNumber(detail.history.length)}</span></summary><ol>{detail.history.map(item=><li key={item.id}><strong>{item.action==='ConsentWindowOpened'?consentHistory('windowOpened'):localizedGovernanceActivity(item.action,locale)}</strong><span>{item.source==='ASYNC_CONSENT'?consentHistory('automatic'):memberName(item.actorId)}</span><time dateTime={item.at}>{formatInstant(item.at)}</time>{item.revision&&<span>{d('revision')} {formatNumber(item.revision)}</span>}{item.verdict&&<span>{label(item.verdict)}</span>}{item.choice&&<span>{label(item.choice)}</span>}{item.reason&&<p>{item.reason==='ASYNC_NO_OBJECTIONS'?consentHistory('noObjections'):item.reason==='ASYNC_OBJECTION_PENDING'?consentHistory('objections'):item.reason}</p>}</li>)}</ol></details>}
            </div>
          </section>
          <aside className="gov-properties">
            <h2>{d('properties')}</h2>
            <dl>
              <dt>{ui('circle')}</dt>
              <dd>{detailEntityName(detail.proposal.circleId)}</dd>
              <dt>{ui('state')}</dt>
              <dd>
                {[label(proposalDisplayState(detail.proposal)),detail.proposal.verdict?label(detail.proposal.verdict):'',detail.proposal.applyState?label(detail.proposal.applyState):''].filter(Boolean).join(' · ')}
              </dd>
              <dt>{d('type')}</dt>
              <dd>{label(detail.proposal.kind)}</dd>
              <dt>{d('author')}</dt>
              <dd>{memberName(detail.proposal.authorId ?? "")}</dd>
              <dt>{d('revision')}</dt>
              <dd>{detail.proposal.revision}</dd>
            </dl>
            {["DRAFT", "REVIEW"].includes(detail.proposal.state ?? "") &&
              !guest && (owner || detail.proposal.authorId === actor) && (
                <button onClick={() => setModal("withdraw")}>{d('withdraw')}</button>
              )}

          </aside>
        </div>
        </>
      ) : docDetail ? (
        <div className="gov-detail">
          <section className="gov-document">
            {docDetail.document.archived && <p className="badge">{documentText('archived')}</p>}
            <p className="muted">
              {docDetail.document.workflow === "DIRECT"
                ? f('directPublication')
                : f('governedPublication')}
            </p>
            <DocumentContent document={docDetail.document} versions={docDetail.versions} />
            <DocumentOrigin origin={docDetail.versions.find(v => v.number === (docDetail.document.workflow === 'GOVERNANCE' && docDetail.document.publishedVersion != null ? docDetail.document.publishedVersion : docDetail.document.draftVersion))?.origin} documentId={docDetail.document.id} navigate={c.navigate}/>
            <ResourcePanel context={c} type="agreement" resourceId={docDetail.document.id}/>
          </section>
          <aside className="gov-properties">
            <h2>{d('properties')} </h2>
            <dl>
              <dt>{f('linkedTo')} </dt>
              <dd>{entityName(docDetail.document.ownerId)}</dd>
              <dt>{f('publication')} </dt>
              <dd>
                {docDetail.document.publishedVersion
                  ? `${d('revision')} ${formatNumber(docDetail.document.publishedVersion)}`
                  : f('notPublished')}
              </dd>
            </dl>
            {!guest && !docDetail.document.archived && (owner || docDetail.document.authorId === actor) && (
              <div className="gov-vertical-actions">
                {governedRestriction(docDetail.document) ? (
                  <button onClick={() => setModal("propose-document")}>{f('proposeChange')}</button>
                ) : (
                  <>
                    <button onClick={() => setModal("edit-document")}>
                      {f('editAgreement')} </button>
                    {docDetail.document.workflow === "DIRECT" ? (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(
                            "/documents/" + selectedId + "/actions/publish",
                            {},
                            docDetail.document.version,
                          )
                        }
                      >
                        {f('publishRevision')} </button>
                    ) : (
                      <>
                        <button onClick={() => setModal("propose-document")}>{f('proposePublication')}</button>
                        {!!docDetail.document.publishedVersion && <button onClick={() => setModal("archive-document")}>{documentText('proposeArchive')}</button>}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
            <h2>{f('versionHistory')} </h2>
            <ol className="gov-versions">
              {docDetail.versions.map((v) => (
                <li key={v.number}>
                  {d('revision')} {v.number}
                  <small>{formatInstant(v.createdAt)}</small>
                  <details className="mare-disclosure quiet"><summary>{locale.startsWith('pt')?'Ver conteúdo e origem':'View content and origin'}</summary><RichTextView value={versionContent(v)}/><DocumentOrigin origin={v.origin} documentId={docDetail.document.id} navigate={c.navigate}/></details>
                  {!guest && !docDetail.document.archived && (owner || docDetail.document.authorId === actor) &&
                    v.number !== docDetail.document.draftVersion && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(
                            "/documents/" + selectedId + "/actions/restore",
                            { number: v.number },
                            docDetail.document.version,
                          )
                        }
                      >
                        {f('restoreRevision')} </button>
                    )}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      ) : (
        <>
          <TraceReturnLink context={c} returnTo={query.get("returnTo")} disabled={busy} />
          {section==='proposals' ? <div className="proposals-controls gov-catalogue-controls">
            <div className="gov-catalogue-head">
              <div className="gov-catalogue-tabs" role="group" aria-label={ui('relevance')} aria-describedby={scopeHelpId}>{proposalScopes.map(([value,title,Icon])=><button key={value} type="button" aria-label={title} aria-pressed={quickFilter===value} className={quickFilter===value?'current':''} data-count={formatNumber(proposalScopeCounts[value]??0)} onClick={()=>setQuickFilter(value)}><Icon size={18} aria-hidden="true"/>{title}</button>)}</div>
              {!guest&&<button className="primary proposal-new gov-catalogue-primary" aria-label={d('addProposal')} onClick={()=>{setProposalEntryCircle(proposalFilterCircle||undefined);setProposalEntryType(undefined);setModal('create');}}><Plus size={18}/>{ui('newProposal')}</button>}
            </div>
            <p id={scopeHelpId} className="gov-sr">{quickFilter==='vote'?ui('scopeVote'):quickFilter==='mine'?ui('scopeMine'):quickFilter==='circles'?ui('scopeCircles'):ui('scopeAll')}</p>
            <div className="gov-catalogue-bar">
              <label className="proposal-search gov-catalogue-search"><Search size={17}/><input aria-label={ui('search')} placeholder={ui('searchProposals')} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label={ui('clearProposalSearch')} onClick={()=>setSearch('')}><X size={15}/></button>}</label>
              <div className="proposal-filter-wrap"><button className={'proposal-filter gov-catalogue-button'+(activeFilters>0?' has-filters':'')} ref={filterButton} aria-expanded={filterOpen} aria-controls="proposal-filter-panel" onClick={()=>filterOpen?closeFilters():setFilterOpen(true)}><Filter size={17}/>{ui('filter')}{activeFilters>0&&<span className="gov-filter-count">{activeFilters}</span>}</button>
                {filterOpen&&<div id="proposal-filter-panel" ref={filterPanel} tabIndex={-1} className="proposal-filter-panel" role="group" aria-label={ui('filter')} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closeFilters();}}}><div className="proposal-filter-heading"><strong>{ui('filterProposals')}</strong><button aria-label={d('close')} onClick={closeFilters}><X size={17}/></button></div><Field label={ui('state')}><select value={filter} onChange={event=>setFilter(event.target.value)}><option value="">{ui('allStatuses')}</option>{['DRAFT','SCHEDULED','REVIEW','DECIDED','ESCALATED','WITHDRAWN'].map(value=><option key={value} value={value}>{label(value)}</option>)}</select></Field><Field label={d('type')}><select value={proposalFilterType} onChange={event=>setProposalFilterType(event.target.value)}><option value="">{ui('allTypes')}</option>{[['ROLE',f('role')],['CIRCLE',ui('circle')],['DOCUMENT',ui('restrictionKind')],['ELECTION',f('election')]].map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></Field><Field label={ui('circle')}><select value={proposalFilterCircle} onChange={event=>setProposalFilterCircle(event.target.value)}><option value="">{ui('allCircles')}</option>{c.structure.nodes.filter(node=>node.kind==='CIRCLE').map(node=><option key={node.entityId} value={node.entityId}>{node.name}</option>)}</select></Field><div className="gov-quick-filters" role="group" aria-label={ui('quick')}>{([['open','open'],['adopted','adopted'],['rejected','rejected']] as const).map(([value,title])=><button aria-pressed={quickFilter===value} key={value} onClick={()=>setQuickFilter(quickFilter===value?'':value)}>{ui(title)}</button>)}</div><button onClick={clearFilters}>{ui('clear')}</button></div>}
              </div>
              <div className="gov-catalogue-view">
                {proposalView==='cards'?<span className="proposal-board-grouping">{ui('boardGroupHint')}</span>:<label className="gov-select-wrap"><span className="gov-sr">{ui('group')}</span><select className="gov-select" aria-label={ui('group')} value={proposalGroup} onChange={event=>setProposalGroup(event.target.value as typeof proposalGroup)}><option value="circle">{ui('circleGroup')}</option><option value="state">{ui('stateGroup')}</option><option value="none">{ui('noGroup')}</option></select></label>}
                <label className="gov-select-wrap proposal-sort"><ChevronsUpDown size={15} aria-hidden="true"/><select className="gov-select" aria-label={ui('sort')} value={proposalSort} onChange={event=>setProposalSort(event.target.value as typeof proposalSort)}><option value="newest">{ui('newest')}</option><option value="oldest">{ui('oldest')}</option><option value="name">{ui('nameAZ')}</option></select></label>
                <div className="proposal-view-toggle gov-segmented" role="group" aria-label={ui('view')}><button aria-pressed={proposalView==='list'} className={proposalView==='list'?'current':''} onClick={()=>setProposalView('list')}><List size={17}/>{ui('list')}</button><button aria-pressed={proposalView==='cards'} className={proposalView==='cards'?'current':''} onClick={()=>setProposalView('cards')}><Columns3 size={17}/>Kanban</button></div>
                <span className="gov-catalogue-count proposal-result-count" role="status">{countLabel(filtered.length,'proposals')}</span>
              </div>
            </div>
            {activeFilters>0&&<div className="proposal-active-filters">{filter&&<button onClick={()=>setFilter('')}>{label(filter)}<X size={12}/></button>}{proposalFilterType&&<button onClick={()=>setProposalFilterType('')}>{({ROLE:f('role'),CIRCLE:ui('circle'),DOCUMENT:ui('restrictionKind'),ELECTION:f('election')} as Record<string,string>)[proposalFilterType]}<X size={12}/></button>}{proposalFilterCircle&&<button onClick={()=>setProposalFilterCircle('')}>{entityName(proposalFilterCircle)}<X size={12}/></button>}<button onClick={clearFilters}>{ui('clear')}</button></div>}
          </div> : (section==='tensions'||section==='documents') ? <div className={'gov-catalogue-controls gov-record-controls gov-record-controls-'+section}>
            <div className="gov-catalogue-head">
              <div className="gov-catalogue-tabs mare-governance-scopes" role="group" aria-label={section==='tensions'?'Tensões por vínculo':'Restrições por vínculo'} aria-describedby={scopeHelpId}>{recordScopes.map(([value,title,Icon])=><button key={value} type="button" aria-label={title} aria-pressed={currentRecordScope===value} className={currentRecordScope===value?'current':''} data-count={formatNumber(recordScopeCounts[value]??0)} onClick={()=>section==='tensions'?setTensionScope(value as typeof tensionScope):setDocumentScope(value as typeof documentScope)}><Icon size={18} aria-hidden="true"/>{title}</button>)}</div>
              {!guest&&<button className="primary gov-catalogue-primary" onClick={()=>{setProposalEntryCircle(undefined);setProposalEntryType(undefined);setModal(section==='documents'?'new-restriction':'create');}}><Plus size={18}/>{section==='documents'?`Nova ${vocabulary.agreement.toLowerCase()}`:d('addTension')}</button>}
            </div>
            <p id={scopeHelpId} className="gov-sr record-scope-help">{section==='tensions'?(tensionScope==='mine'?'As situações que você percebeu e seus próximos encaminhamentos.':tensionScope==='circles'?'Tensões compartilhadas nos seus círculos.':'Tensões de toda a organização.'):(documentScope==='roles'?'Restrições que mencionam os papéis que você energiza.':documentScope==='circles'?'Restrições que orientam o trabalho nos seus círculos.':'Restrições de todos os círculos da organização.')}</p>
            <div className={'gov-catalogue-bar gov-toolbar-'+section}>
              <label className="record-search gov-catalogue-search"><Search size={17}/>
                <span className="gov-sr">{ui('search')}</span>
                <input
                  placeholder={section==='documents'?'Pesquisar nome ou conteúdo':ui('searchTitle')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {section==='tensions'&&<label className="gov-select-wrap gov-tension-state"><Filter size={15} aria-hidden="true"/><span className="gov-sr">Estado das tensões</span><select className="gov-select" aria-label="Estado das tensões" value={filter} onChange={event=>setFilter(event.target.value)}><option value="">Todos os estados</option>{['OPEN','PROCESSED','CLOSED'].map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>}
              {section === 'documents' && <details className="mare-governance-options" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary className="gov-catalogue-button"><Filter size={17}/>Filtros e opções{(restrictionCircle||showArchivedDocuments)&&<span className="gov-filter-count">{Number(Boolean(restrictionCircle))+Number(showArchivedDocuments)}</span>}<ChevronDown size={16}/></summary><div className="mare-governance-options-panel">
                <Field label="Pesquisar círculo"><input placeholder="Nome do círculo" value={restrictionCircleSearch} onChange={event=>setRestrictionCircleSearch(event.target.value)}/></Field>
                <Field label="Círculo"><select value={restrictionCircle} onChange={event=>setRestrictionCircle(event.target.value)}><option value="">Todos os círculos</option>{c.structure.nodes.filter(node=>node.kind==='CIRCLE' && (node.entityId===restrictionCircle || node.name.toLocaleLowerCase(locale).includes(restrictionCircleSearch.toLocaleLowerCase(locale)))).map(node=><option key={node.entityId} value={node.entityId}>{node.name}</option>)}</select></Field>
                <label className="gov-checkbox"><input type="checkbox" checked={showArchivedDocuments} onChange={event=>setShowArchivedDocuments(event.target.checked)} />{documentText('showArchived')}</label>
                {restrictionCircle && <button type="button" onClick={()=>{setRestrictionCircle('');setRestrictionCircleSearch('');}}>Limpar filtro de círculo</button>}
                {!guest && <button onClick={()=>setModal('create-direct-document')}>Criar documento diretamente</button>}
                {owner && <button onClick={()=>setModal('document-type')}>{ui('configTypes')}</button>}
              </div></details>}
              <strong className="gov-catalogue-count" role="status">
                {section==='documents'?`${filtered.length} ${filtered.length===1?'restrição':'restrições'}`:countLabel(filtered.length,'tensions')}
              </strong>
            </div>
          </div> : <>
          <div className={'gov-toolbar gov-toolbar-'+section}>
            <strong>
              {countLabel(filtered.length,'records')}
            </strong>
            <div className="gov-actions">
              <label className="record-search"><Search size={19}/>
                <span className="gov-sr">{ui('search')}</span>
                <input
                  placeholder={ui('searchTitle')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>

            </div>
          </div>
          </>}
          {filtered.length === 0 && scopedEmpty ? (
            <div className="empty-state gov-scope-empty">
              <span className="gov-scope-empty-icon" aria-hidden="true">{section==='proposals'&&quickFilter==='vote'?<CheckCircle2 size={20}/>:<Inbox size={20}/>}</span>
              <div className="gov-scope-empty-copy">
                <h2>{section==='proposals'?(quickFilter==='vote'?ui('upToDate'):cat('emptyProposalScope')):cat(section==='documents'?'emptyRestrictionScope':'emptyTensionScope')}</h2>
                <p>{section==='proposals'&&quickFilter==='vote'?ui('noPending'):otherScopes.length||allScopeCount?cat('otherScopes'):scopeHelpText}</p>
              </div>
              {(allScopeCount>0||otherScopes.length>0)&&<div className="gov-scope-empty-actions">
                {allScopeCount>0&&<button type="button" onClick={()=>section==='proposals'?setQuickFilter(''):section==='documents'?setDocumentScope('all'):setTensionScope('all')}>{section==='proposals'?ui('viewAllCount',{count:formatNumber(allScopeCount)}):cat(section==='documents'?'viewAllRestrictions':'viewAllTensions',{count:formatNumber(allScopeCount)})}</button>}
                {otherScopes.map(([value,title])=><button type="button" className="gov-scope-link" key={value} onClick={()=>section==='proposals'?setQuickFilter(value):section==='documents'?setDocumentScope(value as typeof documentScope):setTensionScope(value as typeof tensionScope)}>{cat('scopeCount',{scope:title,count:formatNumber(scopeCountOf(value))})}</button>)}
              </div>}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <h2>
                {section==='proposals'&&noPendingProposals ? ui('upToDate') : noScopedRestrictions
                  ? (locale.startsWith('pt') ? 'Nenhuma restrição neste recorte' : 'No restrictions in this view')
                  : search || filter || (section==='proposals' && (quickFilter||proposalFilterType||proposalFilterCircle)) || (section==='documents' && (documentScope!=='all' || restrictionCircle)) || (section==='tensions' && tensionScope!=='all')
                  ? ui('noResults')
                  : m(section==='proposals'?'emptyProposals':section==='documents'?'emptyAgreements':section==='tensions'?'emptyTensions':'emptyRecords')}
              </h2>
              <p>
                {section==='proposals'&&noPendingProposals ? ui('noPending') : noScopedRestrictions
                  ? (locale.startsWith('pt') ? 'Você pode consultar as restrições disponíveis na organização.' : 'You can browse the restrictions available in your organization.')
                  : search || filter || (section==='proposals' && (quickFilter||proposalFilterType||proposalFilterCircle)) || (section==='documents' && (documentScope!=='all' || restrictionCircle)) || (section==='tensions' && tensionScope!=='all')
                  ? ui('adjustFilters')
                  : m('firstRecordHelp')}
              </p>
              {section==='proposals' && activeFilters>0 && <button type="button" onClick={clearFilters}>{ui('clear')}</button>}
              {section==='proposals' && quickFilter && (!noPendingProposals || proposalScopeCounts['']>0) && <button type="button" onClick={()=>setQuickFilter('')}>{noPendingProposals ? ui('viewAllCount',{count:formatNumber(proposalScopeCounts['']??0)}) : ui('allProposals')}</button>}
              {section==='documents' && documentScope!=='all' && <button type="button" onClick={()=>setDocumentScope('all')}>Ver todas as restrições</button>}
              {section==='tensions' && tensionScope!=='all' && <button type="button" onClick={()=>setTensionScope('all')}>Ver todas as tensões</button>}
            </div>
          ) : section === "policies" ? (
            <div className="gov-policy-list">
              {filtered.map((p) => (
                <article key={p.id}>
                  <h2>{entityName(p.circleId)}</h2>
                  <p>
                    {label(p.configuration?.method)} · {processText('quorum')} {formatNumber((p.configuration?.quorumPercent??0)/100,{style:'percent'})}
                  </p>
                  <button onClick={() => setModal("policy:" + p.id)}>
                    {m('editProcess')} </button>
                </article>
              ))}
            </div>
          ) : section === "proposals" ? (
            <ProposalList
              rows={filtered}
              entityName={entityName}
              navigate={c.navigate}
              context={c} docs={docs} memberName={memberName}
              view={proposalView} group={proposalGroup} sortOrder={proposalSort} onSort={setProposalSort} onCreate={guest?undefined:circleId=>{setProposalEntryCircle(circleId);setProposalEntryType(undefined);setModal('create');}}
            />
          ) : section === 'documents' ? (
            <RestrictionList rows={filtered} entityName={entityName} documentCircle={documentCircle} memberName={memberName} onOpen={async id=>{const scope=referenceScope;try{const result=await c.api<DocDetail>(apiRoot+'/documents/'+id);if(referenceScopeRef.current===scope)setRestrictionPreview(result.data);}catch(e){if(referenceScopeRef.current===scope)setError(e);}}}/>
          ) : (
            <>
            {section==='tensions'&&<div className="tension-catalogue-list" aria-label="Lista de tensões">{filtered.map(row=><article key={row.id} className={'tension-catalogue-row'+(row.id===focusedTensionId?' is-selected':'')}><button className="tension-catalogue-open" data-tension-id={row.id} aria-label={'Abrir tensão '+row.title} aria-current={row.id===focusedTensionId?'true':undefined} onClick={event=>{tensionOpenerRef.current=event.currentTarget;c.navigate(`/structure/tensions?tensionId=${row.id}`);}}><span className="tension-row-title"><strong>{row.title}</strong></span><span className="tension-row-state"><span className={'gov-status record-state tone-'+(row.state==='OPEN'?'open':row.state==='PROCESSED'?'processed':'closed')}>{row.state==='OPEN'?<CircleDot size={14} aria-hidden="true"/>:row.state==='PROCESSED'?<ArrowUpRight size={14} aria-hidden="true"/>:<CheckCircle2 size={14} aria-hidden="true"/>}{label(row.state)}</span></span><span className="tension-row-context"><span><StructureIcon size={16}/>{entityName(row.circleId)}</span><span><User size={15}/>{memberName(row.authorId??'')}</span>{row.createdAt&&<time>{formatInstant(row.createdAt,false,{day:'numeric',month:'short',year:'numeric'})}</time>}</span>{(row.descriptionRich?toPlainText(row.descriptionRich):row.description)?<span className="tension-row-excerpt">{row.descriptionRich?toPlainText(row.descriptionRich):row.description}</span>:<span className="tension-row-excerpt mare-empty-value">Descrição ainda não informada.</span>}<ArrowRight className="tension-row-arrow" size={19}/></button>{row.state!=='CLOSED'&&row.authorId===actor&&<button className="tension-row-route" onClick={event=>{tensionOpenerRef.current=event.currentTarget;c.navigate(`/structure/tensions?tensionId=${row.id}`);}}><Link2 size={15}/>{row.state==='PROCESSED'?ui('viewDestinations'):'Escolher encaminhamento'}<ArrowRight size={15}/></button>}</article>)}</div>}
            <div className="gov-table-scroll" hidden={section==='tensions'}>
              <table className={"gov-table " + (section==='tensions'?'gov-tensions-table':'')}>
                <thead>
                  <tr>
                    <th>{ui('title')} </th>
                    <th>
                      {section === "branches" ? "Escopo" : ui('circle')}
                    </th>
                    <th>{ui('state')} </th>
                    <th>{d('author')} </th>
                    <th>{d('revision')} </th>
                    <th>
                      <span>{m('actions')} </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {section === "tensions" ? (
                          <button
                            className="gov-title-link"
                            onClick={() => c.navigate(section === "tensions" ? `/structure/tensions?tensionId=${row.id}` : root + "/" + row.id)}
                          >
                            {row.title}
                          </button>
                        ) : (
                          row.title
                        )}
                        {section==='tensions' && (row.descriptionRich||row.description) && <details className="gov-tension-description"><summary>{f('description')} </summary><RichTextView value={row.descriptionRich ?? row.description ?? ''} /></details>}
                      </td>
                      <td>
                        <span className="badge">
                          {section === "branches" ? f('organization') : entityName(row.circleId ?? row.ownerId)}
                        </span>
                      </td>
                      <td>
                        <span className="badge">{label(row.state)}</span>
                      </td>
                      <td>{memberName(row.authorId ?? "")}</td>
                      <td>{row.revision ?? row.draftVersion ?? row.version}</td>
                      <td>
                        {!guest && (owner||row.authorId===actor) && section === "tensions" && row.state !== "CLOSED" && (
                          <TensionActions title={row.title}>
                            {row.authorId === actor && <button aria-label={m('createProposal')+': '+row.title}
                              onClick={() =>
                                setModal("tension-proposal:" + row.id)
                              }
                            >
                              {m('createProposal')} </button>}
                            {row.canProcess && (
                              <>
                                <button aria-label={m('createTask')+': '+row.title}
                                  disabled={busy}
                                  onClick={() =>
                                    setModal("task:" + row.id)
                                  }
                                >
                                  {m('createTask')} </button>
                                <button aria-label={m('createGoal')+': '+row.title}
                                  disabled={busy}
                                  onClick={() =>
                                    void processTension(row, "GOAL")
                                  }
                                >
                                  {m('createGoal')} </button>
                              </>
                            )}
                            {row.canProcessAgenda && c.bootstrap.modules.meetings!==false && <button aria-label={processText('agendaAction')+': '+row.title} disabled={busy} onClick={()=>setModal("agenda:"+row.id)}>{processText('agendaAction')}</button>}
                            <button aria-label={m('closeTension')+': '+row.title}
                              disabled={busy}
                              onClick={() => setModal("close-tension:" + row.id)}
                            >
                              {m('closeTension')} </button>
                          </TensionActions>
                        )}
                        {section === "branches" && row.state === "OPEN" && (
                          <div className="gov-actions">
                            <button
                              onClick={() => setModal("edit-branch:" + row.id)}
                            >
                              {m('editDraft')} </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  "/governance/branches/" +
                                    row.id +
                                    "/actions/close",
                                  {},
                                  row.version,
                                )
                              }
                            >
                              {m('closeDraft')} </button>
                            <button
                              onClick={() =>
                                setModal("branch-proposal:" + row.id)
                              }
                            >
                              {m('createProposal')} </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {focusedTension && <aside ref={tensionDrawerRef} tabIndex={-1} role="dialog" aria-modal={tensionMobile||undefined} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setTensionExpanded(false);c.navigate(root);}if(tensionMobile&&event.key==='Tab'){const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(element=>element.getClientRects().length>0);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===event.currentTarget)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}} className={'mare-governance-tension-drawer'+(tensionExpanded?' is-expanded':'')} aria-label={'Tensão: '+focusedTension.title}>
              <div className="mare-governance-drawer-actions"><span><StructureIcon size={18}/>{entityName(focusedTension.circleId)}</span><button type="button" aria-label={tensionExpanded?'Reduzir foco':'Expandir foco'} onClick={()=>setTensionExpanded(value=>!value)}>{tensionExpanded?<Minimize2 size={20}/>:<Maximize2 size={20}/>}</button><button type="button" aria-label="Fechar detalhes da tensão" onClick={()=>{setTensionExpanded(false);c.navigate(root);}}><X size={21}/></button></div>
              <h2>{focusedTension.title}</h2><div className="tension-drawer-person"><span className="tension-person-avatar" aria-hidden="true">{memberName(focusedTension.authorId??'').split(' ').map(word=>word[0]).slice(0,2).join('')}</span><span>{memberName(focusedTension.authorId??'')}</span><span className="record-state">{label(focusedTension.state)}</span></div>
              {(focusedTension.descriptionRich||focusedTension.description) && <div className="tension-drawer-description"><RichTextView value={focusedTension.descriptionRich ?? focusedTension.description ?? ''} /></div>}
              <p className="tension-process-help">{ux('processHelp')}</p>
              <TensionDestinations context={c} endpoint={`${apiRoot}/tensions/${focusedTension.id}/trace`} returnTo={`/structure/tensions?tensionId=${focusedTension.id}`} disabled={busy} />
              {!guest && focusedTension.state !== 'CLOSED' && <div className="gov-actions tension-forward-actions"><h3>Novo encaminhamento</h3>
                {focusedTension.authorId===actor && <button onClick={()=>setModal('tension-proposal:'+focusedTension.id)}><FileText size={18}/>{m('createProposal')}</button>}
                {(owner||focusedTension.authorId===actor) && focusedTension.canProcess && <><button onClick={()=>setModal('task:'+focusedTension.id)}><CheckSquare size={18}/>{m('createTask')}</button>{c.bootstrap.modules.goals!==false&&<button disabled={busy} onClick={()=>void processTension(focusedTension,'GOAL')}>{m('createGoal')}</button>}</>}
                {(owner||focusedTension.authorId===actor) && focusedTension.canProcessAgenda && c.bootstrap.modules.meetings!==false && <button onClick={()=>setModal('agenda:'+focusedTension.id)}><CalendarDays size={18}/>{processText('agendaAction')}</button>}
                {(owner||focusedTension.authorId===actor) && <button onClick={()=>setModal('close-tension:'+focusedTension.id)}>{m('closeTension')}</button>}
              </div>}
            </aside>}
            </>
          )}
        </>
      )}
      {restrictionPreview && <Modal title={restrictionPreview.document.title} close={()=>setRestrictionPreview(null)} context={c}>
        <div className="mare-governance-restriction-preview"><p>{entityName(restrictionPreview.document.ownerId)} · {memberName(restrictionPreview.document.authorId??'')}</p><DocumentContent document={restrictionPreview.document} versions={restrictionPreview.versions}/><DocumentOrigin origin={restrictionPreview.versions.find(v=>v.number===(restrictionPreview.document.workflow==='GOVERNANCE'&&restrictionPreview.document.publishedVersion!=null?restrictionPreview.document.publishedVersion:restrictionPreview.document.draftVersion))?.origin} documentId={restrictionPreview.document.id} navigate={c.navigate}/><details className="restriction-history mare-disclosure"><summary>Histórico de versões</summary><ol>{restrictionPreview.versions.map(version=><li key={version.number}><details className="mare-disclosure quiet"><summary>Revisão {version.number}{version.createdAt?' · '+formatInstant(version.createdAt):''}</summary><RichTextView value={versionContent(version)}/><DocumentOrigin origin={version.origin} documentId={restrictionPreview.document.id} navigate={c.navigate}/></details></li>)}</ol></details><details className="mare-restriction-more mare-disclosure"><summary>Comentários, anexos e exportação</summary><ResourcePanel context={c} type="agreement" resourceId={restrictionPreview.document.id}/></details><button onClick={()=>{const id=restrictionPreview.document.id;setRestrictionPreview(null);c.navigate(root+'/'+id);}}>Abrir detalhes e propor alteração</button></div>
      </Modal>}
      {modal && (modal!=='meeting-consent' || (!!detail?.proposal.consentMeetingId && !inlineEditing)) && (
        <Modal context={c} state={modalState} busy={busy}
          title={
            modal === 'conduct' ? composerText('deliveryHeading') : modal === 'escalate' ? 'Escalar para reunião' : modal === 'meeting-consent' ? consentText('record') : modal.startsWith("close-tension:") ? m('closeTension') : modal.startsWith("task:") ? m('createTask') : modal.startsWith("agenda:") ? processText('toAgenda') : modal.startsWith("edit-branch:")
              ? m('editStructureDraft')
              : modal === "document-type"
              ? m('configureAgreementTypes')
              : section === "branches" && modal === "create"
                ? m('createStructureDraft')
                : modal === "decide"
              ? d('recordDecision')
              : modal === "withdraw"
                ? d('withdraw')
                : modal.startsWith("policy")
                  ? d('configureProcess')
                  : modal === "amend"
                    ? d('amend')
                    : modal === "edit-document"
                      ? f('editAgreement')
                      : (modal === 'create-direct-document' ? `Nova ${vocabulary.agreement.toLowerCase()}` : modal === 'create' && section === 'tensions'?d('addTension'):d('addProposal'))
          }
          close={() => setModal(null)}
        >
          {modal === 'conduct' && detail ? (
            <ConductionForm c={c} circleId={detail.proposal.circleId!} policy={detail.proposal.policy} allowOverride={detail.proposal.allowOverride} busy={busy} error={error} onCancel={cancelDialog} onSubmit={async delivery=>{
              try{
                if(delivery.mode==='async') await command('/proposals/'+selectedId+'/actions/submit',{reviewDurationHours:delivery.reviewDurationHours},detail.proposal.version);
                else await command('/meetings/'+delivery.meetingId+'/agenda',{title:detail.proposal.title,sourceId:detail.proposal.id},delivery.meetingVersion);
                setModal(null);c.notify(d('saved'));
              }catch{}
            }}/>
          ) : modal.startsWith("close-tension:") ? <form className="gov-form" onSubmit={async e=>{e.preventDefault();const row=items.find(i=>i.id===modal.split(':')[1]);if(row){try{await command('/tensions/'+row.id+'/actions/close',{},row.version);setModal(null);c.notify(d('saved'));}catch{}}}}><p>{ux('closeQuestion')}</p><div className="gov-actions"><button type="button" onClick={cancelDialog}>{ux('cancel')}</button><button className="danger" disabled={busy}>{m('closeTension')}</button></div></form> : modal.startsWith("task:") ? (
            <TensionTaskForm context={c} disabled={busy} error={error} onSubmit={async projectId=>{const tension=items.find(row=>row.id===modal.split(':')[1]);if(tension)await processTension(tension,"TASK",projectId);}} />
          ) : modal.startsWith("agenda:") ? (
            <AgendaForm c={c} tension={items.find(row=>row.id===modal.split(':')[1])} disabled={busy} error={error} onSubmit={async(values)=>{
              const tension=items.find(row=>row.id===modal.split(':')[1]);if(!tension)return;
              try{const result=await command('/tensions/'+tension.id+'/actions/process',{targetKind:'AGENDA',...values},tension.version);setModal(null);c.notify(d('saved'));if(result.targetId)c.navigate('/meetings/'+values.meetingId+'?step=agenda');}catch{}
            }}/>
          ) : modal === "document-type" ? (
            <DocumentTypeForm
              types={types}
              disabled={busy}
              onSubmit={async (values, type) => {
                try {
                  await command(
                    "/document-types" +
                      (type ? "/" + type.id + "/actions/configure" : ""),
                    values,
                    type?.version,
                  );
                  setModal(null);
                } catch {}
              }}
            />
          ) : modal === 'meeting-consent' && detail?.proposal.consentMeetingId && !inlineEditing ? (
            <form className="gov-form" onSubmit={e => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void command('/proposals/' + selectedId + '/actions/meeting-consent', {
                meetingVersion:detail.proposal.consentMeetingVersion,
                revision:detail.proposal.revision,
                confirmed:form.has('confirmed'),
                reason:form.get('reason'),
              },detail.proposal.version).then(()=>setModal(null)).catch(()=>{});
            }}>
              <p>{consentText('explain')}</p>
              <p>{d('revision')} {detail.proposal.revision}</p>
              <label className="gov-checkbox"><input type="checkbox" name="confirmed" required /> {consentText('confirm')}</label>
              <Field label={consentText('reason')}><textarea name="reason" required maxLength={10000} /></Field>
              {error && <div className="gov-notice" role="alert">{error}</div>}
              <button className="primary" disabled={busy}>{consentText('submit')}</button>
            </form>
          ) : modal === "decide" || modal === "withdraw" || modal === 'escalate' ? (
            <ReasonForm
              error={error}
              onRefresh={()=>setRevision(v=>v+1)}
              decide={modal === "decide"}
              manual={
                detail?.rounds.find(
                  (r) => r.revision === detail.proposal.revision,
                )?.policy.method === "MANUAL_FACILITATED"
              }
              disabled={busy||loading||!detail}
              onSubmit={async (values) => {
                try {
                  await command(
                    "/proposals/" + selectedId + "/actions/" + modal,
                    values,
                    detail!.proposal.version,
                  );
                  setModal(null);
                } catch {}
              }}
            />
          ) : modal.startsWith("policy") ? (
            <PolicyForm
              c={c}
              existing={items.find((i) => i.id === modal.split(":")[1])}
              disabled={busy}
              onSubmit={async (values, version) => {
                try {
                  await command("/governance/policies", values, version);
                  setModal(null);
                } catch {}
              }}
            />
          ) : modal === "edit-document" ? (
            <ContentForm
              error={error}
              content={
                versionContent(docDetail?.versions.find(
                  (v) => v.number === docDetail.document.draftVersion,
                ))
              }
              disabled={busy}
              onSubmit={async (content) => {
                try {
                  await command(
                    "/documents/" + selectedId + "/actions/draft",
                    { richContent:content },
                    docDetail!.document.version,
                  );
                  setModal(null);
                } catch {}
              }}
            />
          ) : (
            <CreateForm
              c={c}
              section={
                modal.startsWith("edit-branch:")
                  ? "branches"
                  : modal === 'create-direct-document' ? 'documents'
                  : modal === "create"
                    ? section
                    : "proposals"
              }
              editingBranch={modal.startsWith("edit-branch:")}
              docs={docs}
              types={types}
              branch={
                modal.startsWith("branch-proposal:") ||
                modal.startsWith("edit-branch:")
                  ? items.find((i) => i.id === modal.split(":")[1])
                  : undefined
              }
              tension={
                modal.startsWith("tension-proposal:")
                  ? items.find((i) => i.id === modal.split(":")[1])
                  : undefined
              }
              detail={modal === "amend" ? detail : undefined}
              document={
                modal === "propose-document" || modal === "archive-document" ? docDetail?.document : undefined
              }
              documentAction={modal === 'archive-document' ? 'ARCHIVE' : undefined}
              initialKind={modal === 'new-restriction' || (modal === 'create' && proposalEntryType === 'restriction') ? 'DOCUMENT' : undefined}
              initialEntityKind={modal === 'create' && proposalEntryType === 'circle' ? 'CIRCLE' : undefined}
              initialCircleId={modal==='create'?proposalEntryCircle:undefined}
              disabled={busy}
              onSubmit={async (values) => {
                try {
                  const delivery=values._delivery as {mode:'draft'|'async'|'meeting';reviewDurationHours?:number;meetingId?:string;meetingVersion?:number}|undefined;
                  const attachments=values._attachments as {index:number;file:File}[]|undefined;
                  delete values._delivery;
                  delete values._attachments;
                  let endpoint =
                    "/" +
                    (section === "branches" && modal === "create"
                      ? "governance/branches"
                      : modal === 'create-direct-document' ? 'documents'
                      : modal === "create"
                        ? section
                        : "proposals");
                  if (modal === "amend")
                    endpoint = "/proposals/" + selectedId + "/revisions";
                  if (modal.startsWith("tension-proposal:"))
                    values.tensionId = modal.split(":")[1];
                  if (modal.startsWith("branch-proposal:")) {
                    values.branchId = modal.split(":")[1];
                    delete values.payload;
                  }
                  if (modal.startsWith("edit-branch:"))
                    endpoint =
                      "/governance/branches/" +
                      modal.split(":")[1] +
                      "/actions/revise";
                  const result = await command(
                    endpoint,
                    values,
                    modal === "amend"
                      ? detail!.proposal.version
                      : modal.startsWith("edit-branch:")
                        ? items.find((i) => i.id === modal.split(":")[1])!
                            .version
                        : undefined,
                  );
                  if(result.id && endpoint==='/proposals' && attachments?.length) {
                    try {
                      const proposal=await c.api<Detail>(apiRoot+'/proposals/'+result.id);
                      const parts=proposal.data.revisions.at(-1)?.payload.documents;
                      for(const {index,file} of attachments){
                        const documentId=parts?.[index]?.documentId;
                        if(!documentId)throw new Error('A proposta não contém uma restrição para receber o anexo.');
                        const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
                        await c.api(apiRoot+'/platform/resources/agreement/'+documentId+'/uploads',{method:'POST',body:{name:file.name,mime:file.type,base64:btoa(binary)}});
                      }
                    } catch {
                      setModal(null);c.notify('O rascunho foi salvo, mas o anexo não foi enviado. Abra a restrição para adicioná-lo.');c.navigate('/structure/proposals/'+result.id);return;
                    }
                  }
                  if(result.id && endpoint==='/proposals' && delivery && delivery.mode!=='draft') {
                    try {
                      if(delivery.mode==='async') await command('/proposals/'+result.id+'/actions/submit',{reviewDurationHours:delivery.reviewDurationHours},result.version);
                      else await c.api(apiRoot+'/meetings/'+delivery.meetingId+'/agenda',{method:'POST',version:delivery.meetingVersion,body:{title:values.title,sourceId:result.id}});
                    } catch {
                      setModal(null);
                      c.notify('O rascunho foi salvo, mas a condução não foi concluída. Abra a proposta para continuar.');
                      c.navigate('/structure/proposals/'+result.id);
                      return;
                    }
                  }
                  setModal(null);
                  if (result.id && endpoint === "/proposals") {
                    if (delivery?.mode === 'draft') c.notify(d('saved'));
                    else c.navigate("/structure/proposals/" + result.id);
                  }
                } catch {}
              }}
            />
          )}
          {error && (
            <p className="gov-notice" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {section==='proposals'&&!selectedId&&query.has('fromMeeting')&&!guest&&
        <MeetingProposalEditor key={JSON.stringify([c.organizationId,c.session.account.id,actor,c.bootstrap.authorizationRevision,c.path])} c={c} docs={docs} types={types}/>
      }
    </div>
  );
}
async function listGovernanceRows(api: FeatureContext['api'], path: string, signal: AbortSignal) {
 const items: Row[] = [];
 let cursor: string | null = null;
 do {
  const {data}: {data: {items: Row[]; page?: {nextCursor: string | null}}} = await api(path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), {signal});
  items.push(...data.items);
  cursor = data.page?.nextCursor ?? null;
 } while (cursor && !signal.aborted);
 return items;
}

export type MeetingProposalType = 'restriction' | 'role' | 'circle';
type MeetingPlacement = {
 meetingId: string;
 agendaId: string | null;
 type?: MeetingProposalType;
 onClose: () => void;
 onCreated: () => void;
};
const validMeetingId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const noGovernanceRows: Row[] = [];

export function MeetingProposalEditor({c,docs,types=noGovernanceRows,placement}: {
 c: FeatureContext; docs?: Row[]; types?: Row[]; placement?: MeetingPlacement;
}){
 const {locale}=useGovernanceLocalization(),t=meetingProposalTranslator(locale);
 const params=placement ? null : new URLSearchParams(c.path.split('?')[1]??'');
 const meetingId=placement ? placement.meetingId : params!.get('fromMeeting');
 const agendaId=placement ? placement.agendaId : params!.get('fromAgenda');
 const proposalType=placement ? placement.type : params!.get('proposalType');
 const base=`/organizations/${c.organizationId}`;
 const scope=JSON.stringify([c.organizationId,c.session.account.id,c.bootstrap.membership.id,c.bootstrap.membership.memberType,c.bootstrap.authorizationRevision,c.path,c.bootstrap.modules,meetingId,agendaId,proposalType]);
 const currentScope=useRef(scope);currentScope.current=scope;
 const alive=useRef(true), pending=useRef(false), modalState=useRef<ModalState>({dirty:false,busy:false});
 const [source,setSource]=useState<{scope:string;meeting:{id:string;title:string;circleId:string;version:number};title:string;docs:Row[]}|null>(null);
 const [failed,setFailed]=useState(false),[failure,setFailure]=useState<unknown>(null),[busy,setBusy]=useState(false);
 const attempt=useRef<{signature:string;key:string}|null>(null);
 const loadDocuments=!!placement && !docs;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  const ctrl=new AbortController();setSource(null);setFailed(false);setFailure(null);modalState.current.dirty=false;
  if(!meetingId||!validMeetingId.test(meetingId)||(agendaId!==null&&!validMeetingId.test(agendaId))||c.bootstrap.membership.memberType==='GUEST'||c.bootstrap.modules.meetings===false||c.bootstrap.modules.governance===false){setFailed(true);return;}
  async function load(){
   try {
    const {data}=await c.api<{meeting:{id:string;title:string;circleId:string;version:number;state:string};agenda:{id:string;title:string;status?:string}[];capabilities:{edit:boolean;proposeGovernance?:boolean}}>(base+'/meetings/'+meetingId,{signal:ctrl.signal});
    if(ctrl.signal.aborted)return;
    const m=data.meeting,a=agendaId?data.agenda.find(a=>a.id===agendaId):null;
    if(m.id!==meetingId||!validMeetingId.test(m.circleId)||m.state!=='RUNNING'||(!data.capabilities.edit&&!data.capabilities.proposeGovernance)||(agendaId&&(!a||(a.status&&a.status!=='OPEN')))){setFailed(true);return;}
    const availableDocuments=loadDocuments ? await listGovernanceRows(c.api,base+'/documents',ctrl.signal) : noGovernanceRows;
    if(!ctrl.signal.aborted)setSource({scope,meeting:m,title:a?.title??m.title,docs:availableDocuments});
   }catch(e){if(!ctrl.signal.aborted){setFailed(true);setFailure(e);}}
  }
  void load();
  return()=>ctrl.abort();
 },[scope,c.api,loadDocuments]);
 const current=source?.scope===scope?source:null;
 const back=meetingId&&validMeetingId.test(meetingId)?`/meetings/${meetingId}?step=agenda`:null;
 const close=()=>{
  if(pending.current)return;
  modalState.current.dirty=false;
  if(placement)placement.onClose();else c.navigate(back??'/structure/proposals');
 };
 return <FeatureRoleMentions context={c}><Modal context={c} state={modalState} busy={busy} title={t('title')} close={close}>
  {!placement&&<TraceReturnLink context={c} returnTo={back} disabled={busy}/>}
  {failed?<p className="gov-notice" role="alert">{t('unavailable')}</p>:!current?<p role="status">{t('loading')}</p>:<div className="gov-meeting-proposal-form">
   <CreateForm key={scope} c={c} section="proposals" docs={docs??current.docs} types={types} meetingSource={{title:current.title,circleId:current.meeting.circleId}} initialKind={proposalType==='restriction'?'DOCUMENT':undefined} initialEntityKind={proposalType==='circle'?'CIRCLE':proposalType==='role'?'ROLE':undefined} disabled={busy} onSubmit={async values=>{
    if(pending.current||!current||currentScope.current!==scope)return;
    const origin=agendaId?{agendaId}:{};
    const body=values.newDocument
      ? {kind:'POLICY',title:values.newDocument.title,richContent:values.newDocument.richContent,...origin}
      : {kind:'PROPOSAL',title:values.title,proposalKind:values.kind,payload:values.payload,...origin};
    const signature=JSON.stringify([scope,current.meeting.version,body]);
    if(attempt.current?.signature!==signature)attempt.current={signature,key:crypto.randomUUID()};
    pending.current=true;modalState.current.busy=true;setBusy(true);setFailure(null);
    try{
     const result=await c.api<{target:{kind:'PROPOSAL';id:string;title:string}}>(base+'/meetings/'+current.meeting.id+'/outcomes',{method:'POST',body,version:current.meeting.version,key:attempt.current.key});
     if(!alive.current||currentScope.current!==scope)return;
     const route=traceRoute(result.data.target,back);if(!route)throw Error('INVALID_OUTPUT');
     modalState.current={dirty:false,busy:false};pending.current=false;
     if(placement)placement.onCreated();
     else {c.refresh();c.navigate(route);}
    }catch(e){if(alive.current&&currentScope.current===scope)setFailure(e);}
    finally{if(alive.current&&currentScope.current===scope){pending.current=false;setBusy(false);}}
   }}/>
  </div>}
  {!!failure&&<p className="gov-notice" role="alert">{governanceError(failure,locale)}</p>}
 </Modal></FeatureRoleMentions>;
}

export function MeetingProposalRevision({context:c,proposalId,onClose,onSaved}: {
 context:FeatureContext; proposalId:string; onClose:()=>void; onSaved:()=>void;
}) {
 const {d,locale}=useGovernanceLocalization();
 const endpoint=`/organizations/${c.organizationId}/proposals/${proposalId}`;
 const state=useRef<ModalState>({dirty:false,busy:false});
 const [loaded,setLoaded]=useState<{detail:Detail;docs:Row[]} | null>(null);
 const [failure,setFailure]=useState<unknown>();
 const [busy,setBusy]=useState(false);
 const [retry,setRetry]=useState(0);
 const [readFailed,setReadFailed]=useState(false);
 const saveState=useCallback((next:ModalState)=>{
  state.current=next;
  setBusy(next.busy);
 },[]);
 const reload=()=>{
  state.current.dirty=false;
  setLoaded(null);
  setFailure(undefined);
  setReadFailed(false);
  setRetry(n=>n+1);
 };
 useEffect(()=>{
  const abort=new AbortController();
  async function load(){
   try {
    const {data}=await c.api<Detail>(endpoint,{signal:abort.signal});
    const payload=data.revisions.find(revision=>revision.number===data.proposal.revision)?.payload;
    const docs=(data.proposal.kind==='DOCUMENT'||!!payload?.documents?.length)&&!canEditDraftInline(data)
     ? await listGovernanceRows(c.api,`/organizations/${c.organizationId}/documents`,abort.signal) : noGovernanceRows;
    if(!abort.signal.aborted)setLoaded({detail:data,docs});
   }catch(error){if(!abort.signal.aborted){setFailure(error);setReadFailed(true);}}
  }
  void load();
  return()=>abort.abort();
 },[endpoint,c.api,retry]);
 const detail=loaded?.detail, p=detail?.proposal;
 const inline=!!detail&&canEditDraftInline(detail);
 const canAmend=p&&(p.canAmend??p.canEdit)&&p.state!=='WITHDRAWN'&&p.applyState!=='APPLIED'&&
   (p.canEdit||p.kind==='GOVERNANCE')&&
   (p.kind!=='ELECTION'||c.bootstrap.membership.orgRole==='OWNER'||!detail?.revisions.at(-1)?.payload.winnerId);
 const entityName=(id:string)=>c.structure.nodes.find(node=>node.entityId===id)?.name??detail?.entityReferences?.find(ref=>ref.entityId===id)?.name??'—';
 return <FeatureRoleMentions context={c}><Modal title={p?.title??(locale.startsWith('pt')?'Editar proposta':'Edit proposal')} close={onClose} context={c} busy={busy} state={state}>
  {failure!=null&&<p className="gov-notice" role="alert">{governanceError(failure,locale)}</p>}
  {readFailed ? <button type="button" onClick={reload}>{d('refresh')}</button>
   : !detail ? <p role="status">{d('loading')}</p>
   : inline ? <ProposalDraftEditor context={c} detail={detail} entityName={entityName}
       onSaveState={saveState} onSaved={next=>{setLoaded(current=>current&&{...current,detail:next});onSaved();}}
       onDone={onClose} onReload={reload}/>
   : canAmend ? <CreateForm c={c} section="proposals" docs={loaded.docs} types={noGovernanceRows} detail={detail} disabled={busy}
       onSubmit={async values=>{
        if(state.current.busy)return;
        state.current.busy=true;setBusy(true);setFailure(undefined);
        try{
         await c.api(endpoint+'/revisions',{method:'POST',body:values,version:detail.proposal.version,key:crypto.randomUUID()});
         state.current={dirty:false,busy:false};onSaved();onClose();
        }catch(error){setFailure(error);}
        finally{state.current.busy=false;setBusy(false);}
       }}/>
   : <p role="status">{meetingProposalTranslator(locale)('unavailable')}</p>}
 </Modal></FeatureRoleMentions>;
}

function SortArrow({ ascending }: { ascending: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      style={{
        marginLeft: 5,
        transform: ascending ? "rotate(180deg)" : undefined,
      }}
    >
      <path
        d="M8 3v10m-4-4 4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}
function RestrictionList({rows,entityName,documentCircle,onOpen}:{rows:Row[];entityName:(id?:string)=>string;documentCircle:(id?:string)=>string|undefined;memberName:(id:string)=>string;onOpen:(id:string)=>void}) {
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>({});
  const {formatInstant}=useGovernanceLocalization();
  const groups=[...new Set(rows.map(row=>documentCircle(row.ownerId)??''))].sort((a,b)=>entityName(a).localeCompare(entityName(b)));
  return <div className="mare-governance-restrictions">{groups.map(id=>{const group=rows.filter(row=>(documentCircle(row.ownerId)??'')===id);return <section key={id}>
    <h2><button className="gov-group-toggle" aria-expanded={!collapsed[id]} onClick={()=>setCollapsed(current=>({...current,[id]:!current[id]}))}><span className="restriction-circle-icon"><StructureIcon size={24}/></span><span>{entityName(id)}</span><span className="restriction-group-count">{group.length} {group.length===1?'restrição':'restrições'}</span><ChevronDown size={17} className={collapsed[id]?'is-collapsed':''}/></button></h2>
    {!collapsed[id] && <div className="restriction-group-rows">{group.map(row=><button className="restriction-reading-row" aria-label={'Ler restrição '+row.title} onClick={()=>onOpen(row.id)} key={row.id}><FileText size={23}/><span className="restriction-row-copy"><strong>{row.title}</strong><span className="restriction-row-excerpt">{row.richContent?toPlainText(row.richContent):row.content||'Abra para ler o conteúdo desta restrição.'}</span>{row.richContent&&<span className="restriction-role-chips">{collectRoleMentionIds(row.richContent).map(roleId=><span key={roleId}>{entityName(roleId)}</span>)}</span>}</span><span className="restriction-row-meta"><span className={'gov-status record-state tone-'+(row.archived?'closed':row.publishedVersion?'adopted':'draft')}>{row.archived?<Undo2 size={14} aria-hidden="true"/>:row.publishedVersion?<CheckCircle2 size={14} aria-hidden="true"/>:<FileText size={14} aria-hidden="true"/>}{row.archived?'Arquivada':row.publishedVersion?'Publicada':'Rascunho'}</span><small>Revisão {row.publishedVersion??row.draftVersion??row.version}{row.createdAt?' · '+formatInstant(row.createdAt,false,{day:'numeric',month:'short'}):''}</small></span><ArrowRight size={18}/></button>)}</div>}
  </section>})}</div>;
}
/** One status badge per proposal: the verdict when decided, otherwise the (display) state; the full trail stays readable for assistive technology. */
function ProposalStatus({row}:{row:Row}){
 const {label}=useGovernanceLocalization();
 const state=proposalDisplayState(row);
 const tone=row.verdict==='ADOPT'?'adopted':row.verdict==='REJECT'?'rejected':(state??'').toLowerCase();
 const Icon=row.verdict==='ADOPT'?CheckCircle2:row.verdict==='REJECT'?XCircle:state==='DRAFT'?FileText:state==='SCHEDULED'?CalendarDays:state==='REVIEW'?Clock:state==='ESCALATED'?AlertTriangle:state==='WITHDRAWN'?Undo2:CircleDot;
 const pending=row.applyState&&row.applyState!=='APPLIED'?label(row.applyState):'';
 const trail=[label(state),row.verdict?label(row.verdict):'',row.applyState?label(row.applyState):''].filter(Boolean).join(' · ');
 return <span className={'gov-status tone-'+tone} title={trail}><Icon size={14} aria-hidden="true"/><span aria-hidden="true">{row.verdict?label(row.verdict):label(state)}</span>{pending&&<small aria-hidden="true">{pending}</small>}<span className="gov-sr">{trail}</span></span>;
}
function ProposalList({rows,entityName,navigate,view,group,sortOrder,context,docs,memberName,onCreate}:{rows:Row[];entityName:(id?:string)=>string;navigate:(path:string)=>void;view:'list'|'cards';group:'state'|'circle'|'none';sortOrder:'newest'|'oldest'|'name';onSort:(value:'newest'|'oldest'|'name')=>void;context:FeatureContext;docs:Row[];memberName:(id:string)=>string;onCreate?:(circleId?:string)=>void}){
 const {formatInstant,formatNumber,compareText,label,ui,locale}=useGovernanceLocalization(),cat=governanceCatalogueTranslator(locale);
 const [collapsed,setCollapsed]=useState<Record<string,boolean>>({}),[expanded,setExpanded]=useState<Record<string,boolean>>({});
 const sorted=[...rows].sort((a,b)=>(sortOrder==='name'?compareText(a.title,b.title):(sortOrder==='newest'?-1:1)*((Date.parse(a.createdAt??'')||0)-(Date.parse(b.createdAt??'')||0)))||a.id.localeCompare(b.id));
 const effectiveGroup=view==='cards'?'circle':group;
 const groups=effectiveGroup==='none'?['all']:effectiveGroup==='circle'?[...new Set(sorted.map(row=>row.circleId??''))].sort((a,b)=>compareText(entityName(a),entityName(b))):['REVIEW','DRAFT','SCHEDULED','DECIDED','ESCALATED','WITHDRAWN'];
 const date=(value?:string|null)=>value?formatInstant(value,true,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
 function voteLabel(row:Row){return row.state==='ESCALATED'?<span className="proposal-label">Escalada para reunião</span>:row.canVote&&!row.ownVote?<span className="proposal-label waiting">Seu voto pendente</span>:row.ownVote?<span className="proposal-label answered">{label(row.ownVote)}</span>:null;}
 function when(row:Row){return row.scheduledMeeting?.startAt?cat('meetingOn',{date:date(row.scheduledMeeting.startAt)}):row.deadline?cat('deadlineOn',{date:date(row.deadline)}):row.createdAt?cat('createdOn',{date:formatInstant(row.createdAt,false,{day:'numeric',month:'short'})}):'';}
 function typeName(row:Row){return row.kind==='DOCUMENT'?'Restrição':row.kind==='GOVERNANCE'&&row.changeKinds?.length===1?(({ROLE:'Papel',CIRCLE:'Círculo',DOCUMENT:'Restrição'} as Record<string,string>)[row.changeKinds[0]]??label(row.kind)):label(row.kind);}
 function typeIcon(row:Row){return row.kind==='DOCUMENT'||(row.kind==='GOVERNANCE'&&row.changeKinds?.length===1&&row.changeKinds[0]==='DOCUMENT')?<Shield size={16}/>:row.kind==='ELECTION'?<Vote size={16}/>:<StructureIcon size={16}/>;}
 return <div className={'proposal-results gov-proposal-groups'+(view==='cards'?' is-kanban':'')}><p className="gov-sr" role="status">{ui(sortOrder==='name'?'nameAZ':sortOrder==='oldest'?'oldest':'newest')}</p>{groups.map(id=>{
  const items=sorted.filter(row=>effectiveGroup==='none'||(effectiveGroup==='circle'?(row.circleId??'')===id:proposalDisplayState(row)===id));if(!items.length)return null;
  const title=effectiveGroup==='none'?ui('allProposals'):effectiveGroup==='circle'?entityName(id):label(id);
  return <section className="proposal-circle-group gov-proposal-group" key={id}><div className="proposal-group-heading"><h2><button className="gov-group-toggle" aria-expanded={!collapsed[id]} onClick={()=>setCollapsed(previous=>({...previous,[id]:!previous[id]}))}>{effectiveGroup==='circle'&&<StructureIcon size={24}/>}<span>{title}</span><span className="proposal-group-count">{formatNumber(items.length)}</span><ChevronDown size={18} className={collapsed[id]?'is-collapsed':''}/></button></h2>{effectiveGroup==='circle'&&onCreate&&<button className="group-new-proposal" aria-label={'Nova proposta em '+title} onClick={()=>onCreate(id)}><Plus size={18}/></button>}</div>
   {!collapsed[id]&&(view==='cards'?<div className="proposal-circle-board"><div className="proposal-kanban mare-governance-board" tabIndex={0} aria-label={'Kanban de '+title}>{[['DRAFT','Rascunhos'],['SCHEDULED','Agendadas'],['REVIEW','Em decisão'],['DECIDED','Decididas'],['ESCALATED','Escaladas'],...(items.some(row=>row.state==='WITHDRAWN')?[['WITHDRAWN','Retiradas']]:[])].map(([state,title])=>{const column=items.filter(row=>proposalDisplayState(row)===state);return <section className={'proposal-kanban-column mare-governance-column column-'+state.toLowerCase()} key={state}><h3><i className={'proposal-state-dot state-'+state.toLowerCase()}/>{title}<span>{column.length}</span></h3><div className="proposal-kanban-stack">{column.map(row=><article className="proposal-kanban-card" key={row.id}><div className="kanban-card-context"><StructureIcon size={16}/>{entityName(row.circleId)}</div><button className="kanban-card-title" onClick={()=>navigate('/structure/proposals/'+row.id)}>{row.title}<ArrowUpRight size={15}/></button><span className="kanban-card-type">{typeIcon(row)}{typeName(row)}</span>{row.verdict&&<div className="kanban-card-outcome"><ProposalStatus row={row}/></div>}<p className="kanban-card-author"><span>{memberName(row.authorId??'').split(' ').map(word=>word[0]).slice(0,2).join('')}</span>{memberName(row.authorId??'')}</p><footer><span>{row.scheduledMeeting?<CalendarDays size={14}/>:<Clock size={14}/>} {date(row.scheduledMeeting?.startAt??row.deadline??row.createdAt)}</span>{voteLabel(row)}</footer>{row.canVote&&!row.ownVote&&<button className="kanban-reply" onClick={()=>navigate('/structure/proposals/'+row.id)}>{ui('vote')}<ChevronRight size={15}/></button>}</article>)}{!column.length&&<p className="proposal-kanban-empty">Nenhuma proposta</p>}</div></section>;})}</div></div>:
   <div className="proposal-group-list">{items.map(row=><article key={row.id} className={'proposal-entry gov-proposal-row'+(expanded[row.id]?' is-expanded':'')}><button type="button" className="proposal-entry-summary gov-proposal-open" aria-label={cat('openProposal',{title:row.title??''})} onClick={()=>navigate('/structure/proposals/'+row.id)}><span className="gov-proposal-main"><span className="proposal-entry-title">{row.title}</span><span className="gov-proposal-context">{effectiveGroup!=='circle'&&row.circleId&&<span className="gov-proposal-circle"><StructureIcon size={14}/>{entityName(row.circleId)}</span>}<span className="proposal-entry-type">{typeIcon(row)}{typeName(row)}</span>{row.authorId&&<span className="gov-proposal-author"><User size={13} aria-hidden="true"/>{memberName(row.authorId)}</span>}{when(row)&&<span className="proposal-entry-date">{when(row)}</span>}</span></span>{!!row.electorateCount&&<span className="proposal-entry-participation">{`${formatNumber(row.responseCount??0)} de ${formatNumber(row.electorateCount)} respostas`}</span>}{voteLabel(row)&&<span className="proposal-entry-vote">{voteLabel(row)}</span>}<span className="proposal-entry-state"><ProposalStatus row={row}/></span></button><button type="button" className="gov-proposal-expand" aria-label={cat(expanded[row.id]?'hideSummary':'showSummary',{title:row.title??''})} title={cat(expanded[row.id]?'hideSummary':'showSummary',{title:row.title??''})} aria-expanded={!!expanded[row.id]} onClick={()=>setExpanded(previous=>({...previous,[row.id]:!previous[row.id]}))}><ChevronDown size={17} aria-hidden="true"/></button>{expanded[row.id]&&<InlineProposal context={context} id={row.id} docs={docs} entityName={entityName} memberName={memberName} navigate={navigate}/>}</article>)}</div>)}
  </section>;
 })}</div>;
}
function InlineProposal({context,id,docs,entityName,memberName,navigate}:{context:FeatureContext;id:string;docs:Row[];entityName:(id?:string)=>string;memberName:(id:string)=>string;navigate:(path:string)=>void}){
 const [detail,setDetail]=useState<Detail|null>(null),[failure,setFailure]=useState<unknown>(null);
 const {label,locale}=useGovernanceLocalization();
 useEffect(()=>{const abort=new AbortController();setDetail(null);setFailure(null);void context.api<Detail>('/organizations/'+context.organizationId+'/proposals/'+id,{signal:abort.signal}).then(result=>{if(!abort.signal.aborted)setDetail(result.data);}).catch(error=>{if(!abort.signal.aborted)setFailure(error);});return()=>abort.abort();},[context.organizationId,context.session.account.id,context.bootstrap.membership.id,context.bootstrap.authorizationRevision,id]);
 return <section className="mare-governance-inline proposal-expanded">{failure?<p role="alert">{governanceError(failure,locale)}</p>:!detail?<div className="mare-loading gov-inline-loading" role="status" aria-label="Carregando proposta…"><i/><i/><i/><i/><i/></div>:<>
  <div className="proposal-process-summary"><span>Estado: <strong>{label(detail.proposal.state)}</strong></span>{detail.proposal.verdict&&<span>Resultado: <strong>{label(detail.proposal.verdict)}</strong></span>}{detail.proposal.applyState&&<span>Aplicação: <strong>{label(detail.proposal.applyState)}</strong></span>}</div>
  <ProposalPayload detail={detail} entityName={entityName} docs={docs} memberName={memberName} navigate={navigate} context={context}/>
  <footer><span className="proposal-context-action">Conteúdo da revisão {detail.proposal.revision}</span><button onClick={()=>navigate('/structure/proposals/'+id)}>Ver detalhes e condução</button></footer>
 </>}</section>;
}
function DefinitionDiff({kind,proposed,current,locale}:{kind:'responsibilities'|'artifacts';proposed?:DefinitionItem[];current?:DefinitionItem[];locale:string}) {
  const t=definitionWords(locale);
  return <section className="definition-section"><h3>{t[kind]}</h3><DefinitionsDiff proposed={proposed} current={current} empty={t.empty}/></section>;
}
function changeEntity(change:Change,context:FeatureContext){
  return change.kind==='CREATE'?undefined:[...context.structure.circles,...context.structure.roles].find(e=>e.id===change.entityId);
}
function PurposeWordDiff({change,context}:{change:Change;context:FeatureContext}){
  const current=changeEntity(change,context);
  const next=change.purposeRich?toPlainText(change.purposeRich):change.purpose??'';
  const before=current?(current.purposeRich?toPlainText(current.purposeRich):current.purpose??''):'';
  return next===before?<RichTextView value={change.purposeRich??change.purpose??''}/>:<DiffText parts={diffText(before,next)}/>;
}
function ChangeDefinitions({kind,change,context,locale}:{kind:'responsibilities'|'artifacts';change:Change;context:FeatureContext;locale:string}) {
  const current=changeEntity(change,context);
  if(current) return <DefinitionDiff kind={kind} proposed={change[kind]} current={current[kind]} locale={locale}/>;
  return <DefinitionList kind={kind} items={change[kind]} locale={locale}/>;
}
function ChangeEntityContent({change,context,locale,purposeLabel}:{change:Change;context:FeatureContext;locale:string;purposeLabel:string}) {
  const t=definitionWords(locale);
  const archived=change.kind==='ARCHIVE';
  const entity=changeEntity(change,context) as any;
  const purposeProvided=change.purpose!==undefined||change.purposeRich!==undefined;
  const entityPurpose=entity?(entity.purposeRich?toPlainText(entity.purposeRich):entity.purpose??''):'';
  const definitions=(['responsibilities','artifacts'] as const).map(kind=>{
    const rows:DefinitionItem[]=(entity?.[kind])??[];
    if(archived) return rows.length?<section key={kind} className="definition-section"><h3>{t[kind]}</h3><DefinitionsDiff proposed={[]} current={rows}/></section>:null;
    if(change[kind]!==undefined) return <ChangeDefinitions key={kind} kind={kind} change={change} context={context} locale={locale}/>;
    return rows.length?<DefinitionList key={kind} kind={kind} items={rows} locale={locale}/>:null;
  });
  return <>
    {archived
      ? entityPurpose!==''&&<section className="proposal-definition-purpose"><h4>{purposeLabel}</h4><DiffText parts={diffText(entityPurpose,'')}/></section>
      : (purposeProvided||entityPurpose!=='')&&<section className="proposal-definition-purpose"><h4>{purposeLabel}</h4>{purposeProvided?(change.purposeRich||change.purpose?<PurposeWordDiff change={change} context={context}/>:<p className="proposal-muted">Propósito ainda não definido.</p>):<RichTextView value={entity.purposeRich??entity.purpose??''}/>}</section>}
    {definitions}
  </>;
}
function DocumentPartContent({part,current,proposed}:{part:{documentId?:string;documentVersion?:number;documentAction?:string};current?:Row;proposed?:Detail['meetingDocument']}){
  const proposedDoc=proposed&&part.documentVersion===proposed.number?proposed:undefined;
  const publishedText=plain(current?.richContent,current?.content??null);
  const proposedText=proposedDoc?plain(proposedDoc.richContent,proposedDoc.content):'';
  if(part.documentAction==='ARCHIVE')return publishedText!==''?<DiffText parts={diffText(publishedText,'')}/>:null;
  if(!proposedDoc)return null;
  if(publishedText!==proposedText)return publishedText||proposedText!==''?<DiffText parts={diffText(publishedText,proposedText)}/>:null;
  return proposedText!==''?<RichTextView value={proposedDoc.richContent??proposedDoc.content??''}/>:null;
}
function ProposalPayload({
  detail,
  revision,
  historicalDocument,
  historicalDocuments,
  entityName,
  docs,
  memberName,
  navigate,
  context,
}: {
  detail: Detail;
  revision?:number;
  historicalDocument?:Detail['meetingDocument'];
  historicalDocuments?:Detail['meetingDocuments'];
  entityName: (s?: string) => string;
  docs: Row[];
  memberName: (s: string) => string;
  navigate: (path: string) => void;
  context: FeatureContext;
}) {
  const {formatInstant,f,ui,d,formatNumber,locale} = useGovernanceLocalization();
  const documentText=useDocumentActionText();
  const proposalRevision = revision ?? detail.proposal.revision;
  const payload = detail.revisions.find(r => r.number === proposalRevision)?.payload;
  const document = docs.find((d) => d.id === payload?.documentId);
  const content = proposalRevision === detail.proposal.revision ? detail.meetingDocument : historicalDocument;
  const contents = proposalRevision === detail.proposal.revision ? detail.meetingDocuments : historicalDocuments;
  return (
    <article className="gov-change">
      {detail.originTension && <section className="mare-governance-source"><strong>Tensão de origem: {detail.originTension.title}</strong>{(detail.originTension.descriptionRich||detail.originTension.description) && <RichTextView value={detail.originTension.descriptionRich??detail.originTension.description??''}/>}</section>}
      {payload?.changes?.map((change, i) => (
        <section key={i} className="proposal-definition-change">
          <h3>
            {
              (
                {
                  UPDATE: f('updateLabel'),
                  MOVE: f('move'),
                  ARCHIVE: f('archive'),
                  RESTORE: f('restore'),
                  FIELD: f('fieldChange'),
                  CREATE: f('create'),
                } as Record<string, string>
              )[change.kind]
            }{" "}
            · {change.name ?? entityName(change.entityId)}
          </h3>
          <ChangeEntityContent change={change} context={context} locale={locale} purposeLabel={f('purpose')} />
          {change.kind === "FIELD" && (
            <p>
              {f('proposedValue')}: {" "}
              {Array.isArray(change.value)
                ? change.value.join(", ")
                : String(change.value ?? f('empty'))}
            </p>
          )}
          {change.parentCircleId && (
            <p>{f('destination')}: {entityName(change.parentCircleId)}</p>
          )}
        </section>
      ))}
      {payload?.documents?.map((part, i) => {
        const partDocument = docs.find((d) => d.id === part.documentId);
        const pinned = contents?.find(document => document.documentId === part.documentId && document.number === part.documentVersion && document.proposalRevision === proposalRevision);
        return (
          <section key={'document-'+i} className="proposal-definition-change">
            <h3>
              {part.documentAction === 'ARCHIVE' ? documentText('archive') : part.newDocument ? f('create') : f('publishAgreement')} · {part.newDocument?.title ?? pinned?.title ?? partDocument?.title ?? f('agreement')}
            </h3>
            <p>{f('revisionLower')} {formatNumber(part.documentVersion??0)}</p>
            {proposalRevision === detail.proposal.revision
              ? <DocumentPartContent part={part} current={partDocument} proposed={pinned}/>
              : pinned && <RichTextView value={pinned.richContent ?? pinned.content}/>}
            {partDocument && <button className="gov-title-link" onClick={() => navigate('/structure/working-agreements/' + partDocument.id)}>{f('openAgreement')}</button>}
          </section>
        );
      })}
      {payload?.documentId && (
        <>
          <strong>{payload.documentAction === 'ARCHIVE' ? documentText('archive') : f('publishAgreement')} </strong>
          <p>
            {document?.title ?? content?.title ?? f('agreement')} · {f('revisionLower')} {formatNumber(payload.documentVersion??0)}
          </p>
          {content && payload.documentVersion === content.number && (content.proposalRevision===undefined || content.proposalRevision===proposalRevision) && <DocumentPartContent part={{documentId:payload.documentId,documentVersion:payload.documentVersion,documentAction:payload.documentAction}} current={document} proposed={content}/>}
          {document && <button className="gov-title-link" onClick={() => navigate('/structure/working-agreements/' + document.id)}>{f('openAgreement')}</button>}
        </>
      )}
      {payload?.roleId && (
        <>
          <strong>{f('election')} · {entityName(payload.roleId)}</strong>
          <p>
            {f('candidate')}: {" "}
            {payload.winnerId
              ? memberName(payload.winnerId)
              : f('notChosen')}
          </p>
          <p>
            {f('termUntil')} {" "}
            {payload.mandateEnd &&
              formatInstant(payload.mandateEnd)}
          </p>
        </>
      )}
    </article>
  );
}
type AgendaMeeting={id:string;circleId:string;title:string;state:string;startAt:string;version:number;method:string};
function ConductionForm({c,circleId,policy,allowOverride,busy,error,onCancel,onSubmit}:{c:FeatureContext;circleId:string;policy?:Policy;allowOverride?:boolean;busy:boolean;error:string;onCancel:(event:MouseEvent<HTMLButtonElement>)=>void;onSubmit:(delivery:{mode:'async';reviewDurationHours:number}|{mode:'meeting';meetingId:string;meetingVersion:number})=>Promise<void>}){
  const {locale,formatInstant,formatNumber}=useGovernanceLocalization();
  const cm=proposalComposerTranslator(locale);
  const asyncOk=policy?.method==='CONSENT_WINDOW'||allowOverride!==false;
  const [mode,setMode]=useState<'async'|'meeting'>(asyncOk?'async':'meeting');
  const [duration,setDuration]=useState(()=>Math.min(30,Math.max(1,Math.round((policy?.reviewDurationHours??168)/24)))*24);
  const [meetingId,setMeetingId]=useState('');
  const [targets,setTargets]=useState<AgendaMeeting[]>([]);
  const [loadError,setLoadError]=useState('');
  const meeting=targets.find(target=>target.id===meetingId);
  useEffect(()=>{
    if(c.bootstrap.modules.meetings===false)return;
    const abort=new AbortController();
    void Promise.all([c.api<{items:AgendaMeeting[]}>('/organizations/'+c.organizationId+'/meeting-agenda-items/targets',{signal:abort.signal}),c.api<{items:AgendaMeeting[]}>('/organizations/'+c.organizationId+'/meetings?circleId='+encodeURIComponent(circleId),{signal:abort.signal})]).then(([response,meetings])=>{if(!abort.signal.aborted)setTargets(response.data.items.filter(target=>target.circleId===circleId).map(target=>({...target,startAt:meetings.data.items.find(item=>item.id===target.id)?.startAt??''})));}).catch(e=>{if(!abort.signal.aborted)setLoadError(governanceError(e,locale));});
    return()=>abort.abort();
  },[c,circleId,locale]);
  return <form className="gov-form" onSubmit={async event=>{event.preventDefault();if(mode==='async')await onSubmit({mode:'async',reviewDurationHours:duration});else if(meeting)await onSubmit({mode:'meeting',meetingId:meeting.id,meetingVersion:meeting.version});}}>
    <div className="proposal-async-choice">
      <Clock size={21} aria-hidden="true"/>
      <div><strong>{cm('asyncTitle')}</strong><p>{cm('asyncHelp')}</p></div>
      <button type="button" role="switch" className="proposal-async-switch" aria-checked={mode==='async'} disabled={busy||!asyncOk} onClick={()=>setMode(mode==='async'?'meeting':'async')}><span/></button>
    </div>
    {!asyncOk&&<p className="muted">{cm('mandatoryProcess')}</p>}
    {mode==='async'?<div className="proposal-conduction-details">
      <Field label={cm('objectionPeriod')}><select value={duration} onChange={event=>setDuration(Number(event.target.value))}>{[...new Set([1,3,5,7,10,14,21,30,duration/24])].sort((a,b)=>a-b).map(days=><option key={days} value={days*24}>{formatNumber(days)} {cm(days===1?'day':'days')}</option>)}</select></Field>
      <p className="proposal-conduction-note"><MessageSquare size={18} aria-hidden="true"/><span>{cm('asyncNote',{count:formatNumber(duration/24),unit:cm(duration===24?'day':'days')})}</span></p>
    </div>:<div className="proposal-conduction-details">
      <Field label={cm('meetingLabel')}><select value={meetingId} onChange={event=>setMeetingId(event.target.value)}><option value="">{cm('noMeeting')}</option>{targets.map(target=><option key={target.id} value={target.id}>{target.title}{target.startAt?' · '+formatInstant(target.startAt):''}</option>)}</select></Field>
      <p className="proposal-conduction-note"><CalendarDays size={18} aria-hidden="true"/><span>{cm('meetingNote')}</span></p>
    </div>}
    {loadError&&<p role="alert">{loadError}</p>}
    {error&&<p className="gov-form-error" role="alert">{error}</p>}
    <footer className="gov-form-footer">
      <button type="button" disabled={busy} onClick={onCancel}>{governanceUXTranslator(locale)('cancel')}</button>
      <button type="submit" className="primary" disabled={busy||(mode==='async'&&!asyncOk)||(mode==='meeting'&&!meeting)}>{mode==='async'?cm('openAsync'):cm('scheduleProposal')}</button>
    </footer>
  </form>;
}
export function AgendaForm({c,tension,disabled,error,onSubmit}:{c:FeatureContext;tension?:Row;disabled:boolean;error:string;onSubmit:(input:{meetingId:string;meetingVersion:number})=>Promise<void>}){
 const {p:processText,formatInstant,locale}=useGovernanceLocalization();
 const scope=JSON.stringify([c.organizationId,c.session.account.id,c.bootstrap.membership.id,c.bootstrap.membership.orgRole,c.bootstrap.membership.memberType,c.bootstrap.authorizationRevision,tension?.id,tension?.circleId]);
 const [result,setResult]=useState<{scope:string;generation:number;items:AgendaMeeting[];loading:boolean;failure:unknown}>({scope:'',generation:-1,items:[],loading:true,failure:null});
 const [selection,setSelection]=useState({scope:'',id:''}),[refresh,setRefresh]=useState(0);
 const current=result.scope===scope&&result.generation===refresh?result:{scope,generation:refresh,items:[],loading:true,failure:null};
 const selected=selection.scope===scope?selection.id:'';
 const target=current.items.find(meeting=>meeting.id===selected)??null;
 const loadError=current.failure?governanceError(current.failure,locale):'';
 useEffect(()=>{
  const abort=new AbortController();setResult({scope,generation:refresh,items:[],loading:true,failure:null});
  if(!tension?.id)return()=>abort.abort();
  void (async()=>{try{
   let cursor:string|null=null;const items:AgendaMeeting[]=[];
   do {const response:{data:{items:AgendaMeeting[];page?:{nextCursor?:string|null}}}=await c.api<{items:AgendaMeeting[];page?:{nextCursor?:string|null}}>('/organizations/'+c.organizationId+'/tensions/'+tension.id+'/agenda-meetings?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{signal:abort.signal});
    items.push(...response.data.items);cursor=response.data.page?.nextCursor??null;
   } while(cursor&&!abort.signal.aborted);
   if(!abort.signal.aborted)setResult({scope,generation:refresh,items,loading:false,failure:null});
  }catch(failure){if(!abort.signal.aborted)setResult({scope,generation:refresh,items:[],loading:false,failure});}})();return()=>abort.abort();
 },[c.api,scope,refresh]);
 return <form className="gov-form" onSubmit={event=>{event.preventDefault();if(target&&!disabled&&!current.loading)void onSubmit({meetingId:target.id,meetingVersion:target.version});}}>
  <p>{tension?.title}</p>
  {current.loading?<p role="status">{processText('loadingMeetings')} </p>:loadError?null:current.items.length===0?<p role="status">{processText('noMeetings')} </p>:<Field label={processText('destinationMeeting')}><select value={target?selected:''} disabled={disabled} required onChange={event=>setSelection({scope,id:event.target.value})}><option value="">{processText('selectMeeting')} </option>{current.items.map(meeting=><option key={meeting.id} value={meeting.id}>{meeting.title} · {formatInstant(meeting.startAt)}</option>)}</select></Field>}
  {target&&<p className="muted">{processText('agendaExplanation',{meeting:target.title})}</p>}
  {(loadError||error)&&<p role="alert">{loadError||error}</p>}
  {selected&&<button type="button" disabled={disabled||current.loading} onClick={()=>setRefresh(value=>value+1)}>{processText('refreshMeeting')} </button>}
  <button className="primary" disabled={disabled||current.loading||!target}>{processText('addToAgenda')} </button>
 </form>;
}
function NominationForm({
  c,
  disabled,
  onSubmit,
}: {
  c: FeatureContext;
  disabled: boolean;
  onSubmit: (candidateId: string, rationale: string) => void;
}) {
  const {f,ui,d,formatNumber}=useGovernanceLocalization();
  return (
    <section className="gov-process">
      <h2>{f('nominations')} </h2>
      <form
        className="gov-form"
        onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          onSubmit(
            String(values.get("candidateId")),
            String(values.get("rationale")),
          );
        }}
      >
        <Field label={f('candidate')}>
          <select required name="candidateId">
            <option value="">{f('select')} </option>
            {c.members
              .filter((m) => m.status === "ACTIVE")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
          </select>
        </Field>
        <Field label={f('nominationReason')}>
          <textarea name="rationale" required maxLength={10000} />
        </Field>
        <button disabled={disabled}>{f('recordNomination')} </button>
      </form>
      <p className="muted">
        {f('nominationHelp')} </p>
    </section>
  );
}
function DocumentTypeForm({
  types,
  disabled,
  onSubmit,
}: {
  types: Row[];
  disabled: boolean;
  onSubmit: (values: any, type?: Row) => void;
}) {
  const {f,ui,d,formatNumber}=useGovernanceLocalization();
  const [selected, setSelected] = useState("");
  const type = types.find((t) => t.id === selected);
  return (
    <form
      className="gov-form"
      key={selected}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        onSubmit(
          {
            name: data.get("name"),
            workflow: data.get("workflow"),
            ...(type ? { active: data.get("active") === "on" } : {}),
          },
          type,
        );
      }}
    >
      <Field label={d('type')}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{f('createType')} </option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={f('name')}>
        <input
          name="name"
          defaultValue={type?.name ?? ""}
          required
          maxLength={200}
        />
      </Field>
      <Field label={f('publication')}>
        <select name="workflow" defaultValue={type?.workflow ?? "DIRECT"}>
          <option value="DIRECT">{f('direct')} </option>
          <option value="GOVERNANCE">{f('byGovernance')} </option>
        </select>
      </Field>
      {type && (
        <label className="gov-checkbox">
          <input type="checkbox" name="active" defaultChecked={type.active} />{" "}
          {f('activeType')} </label>
      )}
      <p className="muted">
        {f('keepWorkflow')} </p>
      <button className="primary" disabled={disabled}>
        {f('saveType')} </button>
    </form>
  );
}
function VoteForm({
  disabled,
  allowAbstain,
  locked,
  onSubmit,
}: {
  disabled: boolean;
  allowAbstain: boolean;
  locked: boolean;
  onSubmit: (choice: string, rationale: string) => void;
}) {
  const {label,d,ui} = useGovernanceLocalization();
  const [choice, setChoice] = useState("CONSENT"),
    [rationale, setRationale] = useState("");
  if (locked)
    return (
      <p>
        {d('lockedVote')}
      </p>
    );
  return (
    <form
      className="gov-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(choice, rationale);
      }}
    >
      <Field label={ui('yourVote')}>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {(allowAbstain
            ? ["CONSENT", "ABSTAIN", "OBJECT"]
            : ["CONSENT", "OBJECT"]
          ).map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={choice === "OBJECT" ? d('objectionReason') : d('comment')}>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          required={choice === "OBJECT"}
          maxLength={10000}
        />
      </Field>
      <button disabled={disabled}>{d('recordVote')}</button>
    </form>
  );
}
function ObjectionForm({
  owner,
  mine,
  disabled,
  onSubmit,
}: {
  owner: boolean;
  mine: boolean;
  disabled: boolean;
  onSubmit: (state: string, reason: string) => void;
}) {
  const {label,d,ui} = useGovernanceLocalization();
  const [state, setState] = useState(owner ? "TESTING" : "WITHDRAWN"),
    [reason, setReason] = useState("");
  if (!owner && !mine) return null;
  return (
    <form
      className="gov-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(state, reason);
      }}
    >
      <Field label={d('reviewOutcome')}>
        <select value={state} onChange={(e) => setState(e.target.value)}>
          {(owner
            ? ["TESTING", "VALID", "INTEGRATED", "INVALID", "WITHDRAWN"]
            : ["WITHDRAWN"]
          ).map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={d('humanReason')}>
        <textarea
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <button disabled={disabled}>{d('recordOutcome')}</button>
    </form>
  );
}
function ReasonForm({
  error,
  onRefresh,
  decide,
  manual = true,
  disabled,
  onSubmit,
}: {
  error?:string;
  onRefresh?:()=>void;
  decide: boolean;
  manual?: boolean;
  disabled: boolean;
  onSubmit: (b: any) => void;
}) {
  const {label,d,ui} = useGovernanceLocalization();
  const [verdict,setVerdict]=useState('ADOPT');
  return (
    <form
      className="gov-form"
      onSubmit={(e) => {
        e.preventDefault();
        if(disabled)return;
        const f = new FormData(e.currentTarget);
        onSubmit({
          reason: f.get("reason"),
          ...(decide && manual ? { verdict: f.get("verdict") } : {}),
        });
      }}
    >
      {error && <div className="gov-notice" role="alert">{error}{onRefresh && <button type="button" disabled={disabled} onClick={onRefresh}>{d('refresh')}</button>}</div>}
      {decide && manual && (
        <Field label={d('decision')}>
          <select name="verdict" value={verdict} disabled={disabled} onChange={event=>setVerdict(event.target.value)}>
            {["ADOPT", "REVIEW_REQUIRED", "REJECT"].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {decide && !manual && (
        <p>
          {d('automaticResult')}
        </p>
      )}
      <Field label={d('reason')}>
        <textarea name="reason" required maxLength={10000} disabled={disabled} />
      </Field>
      <button className="primary" disabled={disabled}>{d('record')}</button>
    </form>
  );
}
function ContentForm({
  content,
  disabled,
  error,
  onSubmit,
}: {
  content: RichDocument|string;
  error?:string;
  disabled: boolean;
  onSubmit: (s: RichDocument) => void;
}) {
  const {f,ui,d,formatNumber}=useGovernanceLocalization();
  const [value, setValue] = useState<RichDocument>(()=>readContent(content));
  return (
    <form
      className="gov-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <RichTextEditor label={f('content')} value={value} onChange={setValue} readOnly={disabled} pending={disabled} error={error} />
      <button className="primary" disabled={disabled}>
        {f('saveRevision')} </button>
    </form>
  );
}
class LocalGovernanceFormError extends Error {}
function CreateForm({
  c,
  section,
  docs: availableDocs,
  types,
  branch,
  editingBranch = false,
  tension,
  meetingSource,
  detail,
  document,
  documentAction:initialDocumentAction,
  initialKind,
  initialCircleId,
  initialEntityKind,
  disabled: requestPending,
  onSubmit,
}: {
  c: FeatureContext;
  section: string;
  docs: Row[];
  types: Row[];
  branch?: Row;
  editingBranch?: boolean;
  tension?: Row;
  meetingSource?:{title:string;circleId:string};
  detail?: Detail | null;
  document?: Row;
  documentAction?: 'ARCHIVE';
  initialKind?:string;
  initialCircleId?:string;
  initialEntityKind?:"ROLE"|"CIRCLE";
  disabled: boolean;
  onSubmit: (b: any) => void;
}) {
  const {label,prefs,f,ui,d,formatNumber,formatInstant,locale} = useGovernanceLocalization();
  const cm=proposalComposerTranslator(locale);
  const documentText=useDocumentActionText();
  const docs = useMemo(() => {
    const rows = new Map(availableDocs.map(row => [row.id,row]));
    // Draft restrictions can be readable through their proposal while absent from the published catalogue.
    for (const pinned of detail?.meetingDocuments ?? []) {
      const current = rows.get(pinned.documentId);
      rows.set(pinned.documentId, {...current,id:pinned.documentId,title:pinned.title,
        version:pinned.editableDocumentVersion ?? current?.version ?? 1,draftVersion:pinned.number,
        content:pinned.content,richContent:pinned.richContent,workflow:current?.workflow??'GOVERNANCE',visibility:'ORGANIZATION',
        canEdit:Number.isSafeInteger(pinned.editableDocumentVersion),
        ...(pinned.documentAction==='ARCHIVE'?{publishedVersion:pinned.number}:{}),
      });
    }
    return [...rows.values()];
  }, [availableDocs, detail?.meetingDocuments]);

  const circleDoc=(d:Row)=>c.structure.nodes.find(node=>node.entityId===d.ownerId)?.kind==='CIRCLE';
  const isComposer=section==='proposals' && !detail && !branch && !meetingSource;
  const meetingRestriction = !!meetingSource && initialKind === 'DOCUMENT';
  const original = detail?.revisions.find(
    (r) => r.number === detail.proposal.revision,
  )?.payload;
  const [kind, setKind] = useState(
      document ? "DOCUMENT" : initialKind === 'DOCUMENT' ? "GOVERNANCE" : (initialKind ?? (detail?.proposal.kind ?? "GOVERNANCE")),
    ),
    [partKind, setPartKind] = useState<'ROLE'|'CIRCLE'|'DOCUMENT'>(initialKind === 'DOCUMENT' || document ? 'DOCUMENT' : (initialEntityKind ?? 'ROLE')),
    [documentParts, setDocumentParts] = useState<DocumentPartDraft[]>(()=>{
      if(document) return [{mode:initialDocumentAction==='ARCHIVE'?'ARCHIVE':'PUBLISH' as const,documentId:document.id,documentVersion:initialDocumentAction==='ARCHIVE'?document.publishedVersion:document.draftVersion,documentBaseVersion:document.version}];
      return (original?.documents ?? []).map(part=>part.documentAction==='ARCHIVE'?{mode:'ARCHIVE' as const,documentId:part.documentId!,documentVersion:part.documentVersion,documentBaseVersion:part.documentBaseVersion}:{mode:'PUBLISH' as const,documentId:part.documentId!,documentVersion:part.documentVersion});
    }),
    [editingDocumentPart,setEditingDocumentPart] = useState<number|null>(null),
    [documentAction,setDocumentAction]=useState<'PUBLISH'|'ARCHIVE'>(original?.documentAction ?? initialDocumentAction ?? 'PUBLISH'),
    [circle, setCircle] = useState(
      isComposer ? '' : detail?.proposal.circleId ??
        meetingSource?.circleId ??
        tension?.circleId ??
        (document?.ownerId ? (()=>{const ownerNode=c.structure.nodes.find(node=>node.entityId===document.ownerId);return ownerNode?.kind==='ROLE'?c.structure.nodes.find(node=>node.nodeId===ownerNode.parentNodeId)?.entityId:document.ownerId;})() : undefined) ??
        (c.bootstrap.rootCircleId ?? ""),
    ),
    [selectedDocument, setSelectedDocument] = useState(
      document?.id ?? original?.documentId ?? "",
    ),
    [changeKind, setChangeKind] = useState(section==='proposals' && !detail && !branch && (!meetingSource || initialEntityKind) ? "CREATE" : "UPDATE"),
    [entityId, setEntityId] = useState(""),
    [list, setList] = useState<Change[]>(
      original?.changes ?? branch?.changes ?? [],
    ),
    [changeName, setChangeName] = useState(""),
    [purpose, setPurpose] = useState(""),
    [parent, setParent] = useState(circle),
    [entityKind, setEntityKind] = useState<string>(initialEntityKind ?? "ROLE"),
    [governedFields, setGovernedFields] = useState<GovernedField[]>([]),
    [fieldId, setFieldId] = useState(""),
    [fieldValue, setFieldValue] = useState<Change["value"]>(null),
    [localFailure, setLocalError] = useState<unknown>(null);
  const localError=isGovernanceFormMessage(localFailure)?f(localFailure):localFailure instanceof LocalGovernanceFormError?localFailure.message:localFailure?governanceError(localFailure,locale):'';
  const changeBuilder=useRef<HTMLFieldSetElement>(null);
  const restoreEditContent=useRef<RichDocument|null>(null);
  const draftEntityId=useRef(crypto.randomUUID());
  const [editingChange,setEditingChange]=useState<number|null>(null);
  const [changeEditorRevision,setChangeEditorRevision]=useState(0);
  const [richContent,setRichContent] = useState<RichDocument|undefined>();
  const [purposeRich,setPurposeRich] = useState<RichDocument|undefined>();
  const [purposeTouched,setPurposeTouched] = useState(false);
  const [definitionDraft, setDefinitionDraft] = useState<EntityDefinition>({});
  const currentDefinition = [...(c.structure.circles ?? []), ...(c.structure.roles ?? [])].find(entity => entity.id === entityId);
  const [descriptionRich,setDescriptionRich] = useState<RichDocument|undefined>();
  const [composerStep,setComposerStep]=useState(0);
  const composerFields=useRef<HTMLDivElement>(null);
  const formId=useId();
  useEffect(()=>{if(composerFields.current)composerFields.current.scrollTop=0;},[composerStep]);
  const [sources,setSources]=useState<Row[]>([]);
  const [sourceId,setSourceId]=useState(tension?.id??'new');
  const [sourceDescriptionDrafts,setSourceDescriptionDrafts]=useState<Record<string,string>>({});
  const selectedSource=sourceId&&sourceId!=='new'?(tension?.id===sourceId?tension:sources.find(item=>item.id===sourceId)):undefined;
  const sourceNeedsDescription=!!selectedSource&&!selectedSource.description?.trim();
  const sourceDescriptionText=sourceDescriptionDrafts[sourceId]??'';
  const [newTensionTitle,setNewTensionTitle]=useState('');
  const [newTensionRich,setNewTensionRich]=useState<RichDocument|undefined>();
  const [restrictionMode,setRestrictionMode]=useState<'CREATE'|'PUBLISH'|'ARCHIVE'>(initialDocumentAction==='ARCHIVE'?'ARCHIVE':document?'PUBLISH':'CREATE');
  const [newRestrictionName,setNewRestrictionName]=useState('');
  const [newRestrictionContent,setNewRestrictionContent]=useState<RichDocument|undefined>();
  const [restrictionAttachment,setRestrictionAttachment]=useState<File|undefined>();
  const [editRestrictionContent,setEditRestrictionContent]=useState<RichDocument|undefined>(()=>{
    const selected=docs.find(item=>item.id===(document?.id??""));
    return selected?readContent(selected.richContent??selected.content??''):undefined;
  });
  const [restrictionEdited,setRestrictionEdited]=useState(false);
  const [delivery,setDelivery]=useState<'draft'|'async'|'meeting'>('draft');
  const [duration,setDuration]=useState(168);
  const [asyncAvailable,setAsyncAvailable]=useState<boolean|null>(null);
  const [targets,setTargets]=useState<AgendaMeeting[]>([]);
  const [electableRoleIds,setElectableRoleIds]=useState<string[]>([]);
  const [meetingId,setMeetingId]=useState('');
  const [composerLoadError,setComposerLoadError]=useState('');
  const eligibilityScope=JSON.stringify([c.organizationId,c.session.account.id,c.bootstrap.membership.id,c.bootstrap.membership.orgRole,c.bootstrap.membership.memberType,c.bootstrap.authorizationRevision,initialCircleId,tension?.id,document?.id]);
  const [eligibleCircles,setEligibleCircles]=useState<{scope:string;items:{id:string;name:string}[];loading:boolean;failure:unknown;contextUnavailable:boolean}>({scope:'',items:[],loading:true,failure:null,contextUnavailable:false});
  const [eligibilityRevision,setEligibilityRevision]=useState(0);
  const eligible=eligibleCircles.scope===eligibilityScope?eligibleCircles:{scope:eligibilityScope,items:[],loading:true,failure:null,contextUnavailable:false};
  const composerReady=!isComposer||(!eligible.loading&&!eligible.failure&&eligible.items.some(item=>item.id===circle));
  const disabled=requestPending||(isComposer&&!composerReady);
  useEffect(()=>{
    if(!isComposer)return;
    const abort=new AbortController();setCircle('');setEligibleCircles({scope:eligibilityScope,items:[],loading:true,failure:null,contextUnavailable:false});
    void c.api<{items:{id:string;name:string}[]}>('/organizations/'+c.organizationId+'/governance/proposal-circles',{signal:abort.signal}).then(response=>{
      if(abort.signal.aborted)return;
      const items=response.data.items;
      const documentOwner=document?.ownerId?c.structure.nodes.find(node=>node.entityId===document.ownerId):undefined;
      const documentCircle=documentOwner?.kind==='ROLE'?c.structure.nodes.find(node=>node.nodeId===documentOwner.parentNodeId)?.entityId:document?.ownerId;
      const lockedContext=tension?.circleId??documentCircle;
      const preferred=lockedContext??initialCircleId??c.bootstrap.rootCircleId;
      const authorized=items.find(item=>item.id===preferred);
      const selected=authorized?.id??(lockedContext?'':items[0]?.id??'');
      setCircle(selected);setParent(selected);
      setEligibleCircles({scope:eligibilityScope,items,loading:false,failure:null,contextUnavailable:!!(lockedContext||initialCircleId)&&!authorized});
    }).catch(failure=>{if(!abort.signal.aborted)setEligibleCircles({scope:eligibilityScope,items:[],loading:false,failure,contextUnavailable:false});});
    return()=>abort.abort();
  },[isComposer,eligibilityScope,eligibilityRevision]);

  useEffect(()=>{
    if(!isComposer||!composerReady)return;
    const abort=new AbortController();setSources([]);
    void (async()=>{try {
      let cursor:string|null=null;const all:Row[]=[];
      do {const response: {data:{items:Row[];page:{nextCursor:string|null}}}=await c.api('/organizations/'+c.organizationId+'/tensions'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{signal:abort.signal});all.push(...response.data.items);cursor=response.data.page.nextCursor;} while(cursor&&!abort.signal.aborted);
      if(!abort.signal.aborted)setSources(all.filter(row=>row.authorId===c.bootstrap.membership.id && row.state!=='CLOSED'));
    } catch(e){if(!abort.signal.aborted)setComposerLoadError(cm('loadTensionsFailed',{reason:governanceError(e,locale)}));}})();
    return()=>abort.abort();
  },[isComposer,composerReady,eligibilityScope,locale]);
  useEffect(()=>{
    if(restoreEditContent.current){const value=restoreEditContent.current;restoreEditContent.current=null;setEditRestrictionContent(value);setRestrictionEdited(true);return;}
    const selected=docs.find(item=>item.id===selectedDocument);setEditRestrictionContent(selected?readContent(selected.richContent??selected.content??''):undefined);setRestrictionEdited(false);
  },[selectedDocument,docs]);
  useEffect(()=>{
    if(!isComposer||!composerReady||!circle)return;
    const abort=new AbortController();setAsyncAvailable(null);setTargets([]);setMeetingId('');setComposerLoadError('');
    void c.api<{configuration:Policy;allowOverride?:boolean}>('/organizations/'+c.organizationId+'/governance/policies/'+circle+'/effective',{signal:abort.signal}).then(response=>{if(!abort.signal.aborted){setAsyncAvailable(response.data.configuration.method==='CONSENT_WINDOW'||response.data.allowOverride!==false);setDuration(Math.min(30,Math.max(1,Math.round((response.data.configuration.reviewDurationHours??168)/24)))*24);}}).catch(e=>{if(!abort.signal.aborted)setComposerLoadError(cm('loadProcessFailed',{reason:governanceError(e,locale)}));});
    if(c.bootstrap.modules.meetings!==false) void Promise.all([c.api<{items:AgendaMeeting[]}>('/organizations/'+c.organizationId+'/meeting-agenda-items/targets',{signal:abort.signal}),c.api<{items:AgendaMeeting[]}>('/organizations/'+c.organizationId+'/meetings?circleId='+encodeURIComponent(circle),{signal:abort.signal})]).then(([response,meetings])=>{if(!abort.signal.aborted)setTargets(response.data.items.filter(target=>target.circleId===circle).map(target=>({...target,startAt:meetings.data.items.find(item=>item.id===target.id)?.startAt??''})));}).catch(e=>{if(!abort.signal.aborted)setComposerLoadError(cm('loadMeetingsFailed',{reason:governanceError(e,locale)}));});
    return()=>abort.abort();
  },[isComposer,composerReady,eligibilityScope,circle,locale]);
  useEffect(()=>{
    if(section!=='proposals'||kind!=='ELECTION'||!circle)return;
    const abort=new AbortController();setElectableRoleIds([]);
    void c.api<{items:{id:string}[]}>('/organizations/'+c.organizationId+'/governance/election-roles?circleId='+encodeURIComponent(circle),{signal:abort.signal}).then(response=>{if(!abort.signal.aborted)setElectableRoleIds(response.data.items.map(item=>item.id));}).catch(error=>{if(!abort.signal.aborted)setLocalError(error);});
    return()=>abort.abort();
  },[section,kind,circle,c.organizationId]);
  useEffect(() => {
    const abort = new AbortController();
    setGovernedFields([]);
    setFieldId("");
    if (entityId && changeKind === "FIELD")
      void c
        .api<GovernedField[]>(
          "/organizations/" +
            c.organizationId +
            "/structure-advanced/entities/" +
            entityId +
            "/fields",
          { signal: abort.signal },
        )
        .then((result) => {
          if (abort.signal.aborted) return;
          setGovernedFields(
            result.data.filter((f) => f.field.schema.type !== "COMPUTED"),
          );
        })
        .catch((e) => {
          if (!abort.signal.aborted) setLocalError(e);
        });
    return () => abort.abort();
  }, [entityId, changeKind, c.organizationId]);
  const circles = isComposer?eligible.items.map(item=>({entityId:item.id,name:item.name})):c.structure.nodes.filter((n) => n.kind === "CIRCLE"),
    roles = c.structure.nodes.filter((n) => n.kind === "ROLE"),
    circleNode = c.structure.nodes.find((n) => n.entityId === circle),
    inCircle = (n: (typeof c.structure.nodes)[number]) => !circleNode || n.entityId === circle || n.parentNodeId === circleNode.nodeId;
  const creatingMeetingRestriction = meetingRestriction && kind === 'DOCUMENT' && restrictionMode === 'CREATE';
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(isComposer&&(!composerReady||composerStep!==2))return;
    const submitDelivery=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='draft'?'draft':delivery;
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "");
    if (section === "tensions" && (!title.trim() || Array.from(title.trim()).length > 200)) {
      setLocalError("titleInvalid");
      return;
    }
    if(editingChange!==null||editingDocumentPart!==null){
      setLocalError(new LocalGovernanceFormError(cm('saveChangeFirst')));
      return;
    }
    let values: any;
    if (section === "tensions")
      values = {
        title,
        circleId: circle,
        ...(descriptionRich?{descriptionRich}:{description:''}),
      };
    else if (section === "documents")
      values = {
        title,
        ownerId: circle,
        workflow: form.get("workflow"),
        visibility: form.get("visibility"),
        ...(richContent ? {richContent} : {content:""}),
        ...(form.get("typeId") ? { typeId: form.get("typeId") } : {}),
      };
    else if (section === "branches") {
      if (!list.length) {
        setLocalError("changeRequired");
        return;
      }
      values = { title, changes: list };
    } else {
      let payload: any;
      let collectedDocuments=documentParts;
      if (kind === "GOVERNANCE") {
        const collected=collectParts();
        if(collected){
          collectedDocuments=collected.documents;
          const documents=collected.documents.map(serializeDocumentPart);
          payload = {};
          if (collected.changes.length) payload.changes = collected.changes;
          if (documents.length) payload.documents = documents;
        } else if (meetingSource && initialEntityKind) {
          const change = buildChange(draftEntityId.current);
          if (!change) return;
          setLocalError('');
          payload = { changes: [change] };
        } else {
          if (isComposer) setComposerStep(1);
          return;
        }
      } else if (kind === "DOCUMENT") {
        const d = docs.find((d) => d.id === selectedDocument);
        if((isComposer || meetingRestriction) && restrictionMode==='CREATE') {
          const restrictionName = creatingMeetingRestriction ? title : newRestrictionName;
          if(!restrictionName.trim()||!newRestrictionContent||!toPlainText(newRestrictionContent).trim()){setLocalError(new LocalGovernanceFormError(cm('restrictionRequired')));setComposerStep(1);return;}
          payload=undefined;
        } else if (!d || d.archived || (documentAction === 'ARCHIVE' && !d.publishedVersion)) {
          setLocalError("agreementRequired");
          return;
        } else payload = documentAction === 'ARCHIVE'
          ? {documentId:d.id,documentVersion:d.publishedVersion,documentAction:'ARCHIVE',documentBaseVersion:d.version}
          : { documentId: d.id, documentVersion: d.draftVersion };
      } else {
        let mandateEnd:string;
        try {mandateEnd=mandateInstant(String(form.get("mandateEnd")),prefs.timeZone,original?.mandateEnd);}
        catch(error){setLocalError(error instanceof Error && error.message==="AMBIGUOUS_MANDATE_TIME" ? "dstFold" : "dstGap");return;}
        payload = {
          roleId: form.get("roleId"),
          winnerId: form.get("winnerId") || null,
          mandateEnd,
        };
      }
      values = detail
        ? { payload }
        : { title, circleId: circle, kind, payload };
      if (creatingMeetingRestriction) {
        values.newDocument={title,richContent:newRestrictionContent};
      }
      if(isComposer){
        if(kind==='DOCUMENT'&&restrictionMode==='CREATE') {delete values.payload;values.newDocument={title:newRestrictionName,richContent:newRestrictionContent};}
        if(kind==='DOCUMENT'&&restrictionMode==='PUBLISH'&&restrictionEdited){const target=docs.find(item=>item.id===selectedDocument);if(!target||!editRestrictionContent||!toPlainText(editRestrictionContent).trim()){setLocalError(new LocalGovernanceFormError(cm('restrictionContentRequired')));setComposerStep(1);return;}delete values.payload;values.documentRevision={documentId:target.id,version:target.version,richContent:editRestrictionContent};}
        if(kind==='DOCUMENT'&&restrictionAttachment){if(restrictionAttachment.size>5*1024*1024){setLocalError(new LocalGovernanceFormError(cm('attachmentTooLarge')));setComposerStep(1);return;}values._attachment=restrictionAttachment;}
        const attachments:{index:number;file:File}[]=[];
        collectedDocuments.forEach((part,index)=>{if('attachment' in part&&part.attachment)attachments.push({index,file:part.attachment});});
        if(attachments.some(({file})=>file.size>5*1024*1024)){setLocalError(new LocalGovernanceFormError(cm('attachmentTooLarge')));setComposerStep(1);return;}
        if(attachments.length)values._attachments=attachments;
        if(sourceId && sourceId!=='new') {
          if(!selectedSource){setLocalError(new LocalGovernanceFormError(cm('sourceUnavailable')));setComposerStep(0);return;}
          values.tensionId=sourceId;
          if(sourceNeedsDescription){
            if(!sourceDescriptionText.trim()){setLocalError(new LocalGovernanceFormError(cm('sourceDescriptionRequired')));setComposerStep(0);return;}
            values.tensionRevision={version:selectedSource.version,descriptionRich:fromPlainText(sourceDescriptionText)};
          }
        }
        if(!sourceId){setLocalError(new LocalGovernanceFormError(cm('sourceRequired')));setComposerStep(0);return;}
        if(sourceId==='new') {if(!newTensionTitle.trim()||!newTensionRich||!toPlainText(newTensionRich).trim()){setLocalError(new LocalGovernanceFormError(cm('sourceDetailsRequired')));setComposerStep(0);return;}values.newTension={title:newTensionTitle,descriptionRich:newTensionRich};}
        const target=targets.find(item=>item.id===meetingId);
        if(submitDelivery==='async' && asyncAvailable!==true){setLocalError(new LocalGovernanceFormError(cm(asyncAvailable===false?'mandatoryProcessError':'waitProcess')));return;}
        if(submitDelivery==='async' && (!Number.isFinite(duration)||duration<=0||duration>8760)){setLocalError(new LocalGovernanceFormError(cm('durationInvalid')));return;}
        if(submitDelivery==='meeting'&&!target){setLocalError(new LocalGovernanceFormError(cm('meetingUnavailable')));return;}
        values._delivery=submitDelivery==='meeting'?{mode:submitDelivery,meetingId:target!.id,meetingVersion:target!.version}:submitDelivery==='async'?{mode:submitDelivery,reviewDurationHours:duration}:{mode:'draft'};
      }
    }
    onSubmit(values);
  }
  function collectParts():{changes:Change[];documents:DocumentPartDraft[]}|undefined{
    let nextList=list,nextParts=documentParts;
    if(partKind==='DOCUMENT'){
      const touched=restrictionMode==='CREATE'?!!(newRestrictionName.trim()||newRestrictionContent||restrictionAttachment):!!selectedDocument;
      if(touched){const part=buildDocumentPart();if(!part)return;nextParts=editingDocumentPart===null?[...nextParts,part]:nextParts.map((current,index)=>index===editingDocumentPart?part:current);}
    } else {
      const touched=!!entityId||!!changeName.trim();
      if(touched){const change=buildChange();if(!change)return;nextList=editingChange===null?[...nextList,change]:nextList.map((current,index)=>index===editingChange?change:current);}
    }
    if(!nextList.length&&!nextParts.length){setLocalError("changeRequired");return;}
    return {changes:nextList,documents:nextParts};
  }
  function serializeDocumentPart(part:DocumentPartDraft):DocumentPart{
    if(part.mode==='CREATE')return {newDocument:{title:part.title,richContent:part.richContent!}};
    const d=docs.find(item=>item.id===part.documentId) ?? (document?.id===part.documentId?document:undefined);
    if(part.mode==='ARCHIVE')return {documentId:part.documentId,documentVersion:part.documentVersion??d?.publishedVersion,documentAction:'ARCHIVE',documentBaseVersion:part.documentBaseVersion??d?.version};
    if(part.edited)return {documentRevision:{documentId:part.documentId,version:d?.version??document?.version??1,richContent:part.richContent!}};
    return {documentId:part.documentId,documentVersion:part.documentVersion??d?.draftVersion};
  }
  function buildDocumentPart():DocumentPartDraft|undefined{
    if(restrictionMode==='CREATE'){
      if(!newRestrictionName.trim()||!newRestrictionContent||!toPlainText(newRestrictionContent).trim()){setLocalError(new LocalGovernanceFormError('Informe o nome e a descrição da restrição.'));return;}
      return {mode:'CREATE',title:newRestrictionName.trim(),richContent:newRestrictionContent,attachment:restrictionAttachment};
    }
    const d=docs.find(item=>item.id===selectedDocument);
    if(!d||d.archived||(restrictionMode==='ARCHIVE'&&!d.publishedVersion)){setLocalError("agreementRequired");return;}
    if(restrictionMode==='ARCHIVE')return {mode:'ARCHIVE',documentId:d.id};
    if(restrictionEdited){
      if(!editRestrictionContent||!toPlainText(editRestrictionContent).trim()){setLocalError(new LocalGovernanceFormError('Informe o conteúdo da restrição.'));return;}
      return {mode:'PUBLISH',documentId:d.id,richContent:editRestrictionContent,edited:true,attachment:restrictionAttachment};
    }
    return {mode:'PUBLISH',documentId:d.id,attachment:restrictionAttachment};
  }
  function resetRestrictionFields(){
    setRestrictionMode('CREATE');setDocumentAction('PUBLISH');setNewRestrictionName('');setNewRestrictionContent(undefined);setSelectedDocument('');setEditRestrictionContent(undefined);setRestrictionEdited(false);setRestrictionAttachment(undefined);
  }
  function addDocumentPart(){
    const part=buildDocumentPart();if(!part)return;
    setDocumentParts(editingDocumentPart===null?[...documentParts,part]:documentParts.map((current,index)=>index===editingDocumentPart?part:current));
    setEditingDocumentPart(null);resetRestrictionFields();setLocalError('');
  }
  function editDocumentPart(index:number){
    const part=documentParts[index];
    setPartKind('DOCUMENT');
    setRestrictionMode(part.mode);setDocumentAction(part.mode==='ARCHIVE'?'ARCHIVE':'PUBLISH');
    if(part.mode==='CREATE'){setNewRestrictionName(part.title);setNewRestrictionContent(part.richContent);setSelectedDocument('');}
    else if(part.mode==='PUBLISH'){if(part.edited)restoreEditContent.current=part.richContent??null;setSelectedDocument(part.documentId);if(part.edited){setEditRestrictionContent(part.richContent);setRestrictionEdited(true);}else if(selectedDocument===part.documentId)setRestrictionEdited(false);}
    else setSelectedDocument(part.documentId);
    setRestrictionAttachment('attachment' in part?part.attachment:undefined);
    setEditingDocumentPart(index);setLocalError('');
  }
  function buildChange(newEntityId?:string): Change | undefined {
    if (Object.values(definitionDraft).some(items => items?.some(item => !item.text.trim()))) {
      setLocalError(new LocalGovernanceFormError(cm('definitionItemRequired')));
      return;
    }
    let change: Change;
    if (changeKind === "CREATE") {
      if (!changeName.trim()) {
        setLocalError("nameRequired");
        return;
      }
      change = {
        kind: changeKind,
        entityId: editingChange!==null?list[editingChange].entityId:newEntityId??(isComposer?draftEntityId.current:crypto.randomUUID()),
        entityKind,
        parentCircleId: parent,
        name: changeName,
        ...(purposeRich?{purposeRich}:{purpose}),
        ...definitionDraft,
      };
    } else {
      const node = c.structure.nodes.find((n) => n.entityId === entityId);
      if (!node) {
        setLocalError("entityRequired");
        return;
      }
      change = { kind: changeKind, entityId, baseVersion: editingChange!==null?list[editingChange].baseVersion:node.version };
      if (changeKind === "FIELD") {
        const field = governedFields.find((f) => f.field.id === fieldId);
        if (!field) {
          setLocalError("fieldRequired");
          return;
        }
        change = {
          kind: "FIELD",
          entityId,
          fieldId,
          baseVersion: field.version,
          value: fieldValue,
        };
      }
      if (changeKind === "UPDATE") {
        Object.assign(change, definitionDraft);
        change.name = changeName || node.name;
        if(purposeTouched) {
          if(purposeRich) change.purposeRich=purposeRich;
          else change.purpose=purpose;
        }
      }
      if (changeKind === "MOVE") change.parentCircleId = parent;
    }
    return change;
  }
  function addChange() {
    const change=buildChange();
    if(!change)return;
    setList(editingChange===null?[...list,change]:list.map((current,index)=>index===editingChange?change:current));
    setEditingChange(null);setChangeEditorRevision(n=>n+1);
    setLocalError("");
    setEntityId("");setFieldId("");setFieldValue(null);
    setChangeName("");
    setPurpose("");
    setPurposeRich(undefined);setPurposeTouched(false);
    setDefinitionDraft({});
  }
  function editChange(index:number){
    const change=list[index];
    changeBuilder.current?.scrollIntoView?.({block:'start'});
    const targetKind=(change.entityKind??c.structure.nodes.find(n=>n.entityId===change.entityId)?.kind??'ROLE') as 'ROLE'|'CIRCLE';
    setPartKind(targetKind);
    setEditingChange(index);setChangeEditorRevision(n=>n+1);setChangeKind(change.kind);
    setEntityId(change.entityId);setEntityKind(targetKind);setParent(change.parentCircleId??circle);
    const entity=[...c.structure.circles,...c.structure.roles].find(entity=>entity.id===change.entityId);
    setChangeName(change.name??c.structure.nodes.find(node=>node.entityId===change.entityId)?.name??'');
    setPurpose(change.purpose??entity?.purpose??'');setPurposeRich(change.purposeRich??entity?.purposeRich??undefined);
    setPurposeTouched(change.purpose!==undefined||change.purposeRich!==undefined);
    setDefinitionDraft({...change.responsibilities!==undefined?{responsibilities:change.responsibilities}:{},...change.artifacts!==undefined?{artifacts:change.artifacts}:{}});
    setFieldId(change.fieldId??'');setFieldValue(change.value??null);setLocalError('');
  }
  return (
    <form className={"gov-form gov-create-form " + (section==='proposals'?'gov-proposal-form ':'') + (isComposer?'mare-governance-composer':'')} onSubmit={submit}>
      {isComposer && <aside className="mare-governance-composer-rail"><div className="mare-governance-composer-context">{circles.find(item=>item.entityId===circle)?.name || cm('chooseCircle')}</div><nav className="mare-governance-steps" aria-label={cm('steps')}>{[cm('contextStep'),cm('agreementStep'),cm('deliveryStep')].map((name,index)=><button key={index} type="button" disabled={!composerReady||index>composerStep} aria-current={composerStep===index?'step':undefined} onClick={()=>setComposerStep(index)}><span className="mare-governance-step-number">{index+1}</span><span>{name}</span></button>)}</nav><p>{cm('railFirst')}<br/>{cm('railSecond')}</p></aside>}
      <div className="gov-form-fields" ref={composerFields}>
      {isComposer && eligible.loading && <p role="status">{cm('checkingCircles')}</p>}
      {isComposer && !!eligible.failure && <div className="mare-governance-eligibility" role="alert"><h3>{cm('circlesFailed')}</h3><p>{governanceError(eligible.failure,locale)}</p><p>{cm('circlesFailedHelp')}</p><button type="button" onClick={()=>setEligibilityRevision(value=>value+1)}>{cm('retry')}</button></div>}
      {isComposer && !eligible.loading && !eligible.failure && !composerReady && <div className="mare-governance-eligibility"><h3>{cm(eligible.contextUnavailable&&eligible.items.length>0?'contextUnavailable':'noCircle')}</h3><p>{cm(eligible.contextUnavailable&&eligible.items.length>0?'contextUnavailableHelp':'noCircleHelp')}</p><button type="button" onClick={cancelDialog}>{cm('close')}</button></div>}
      {isComposer && composerReady && eligible.contextUnavailable && <p className="mare-governance-context-notice" role="status">{cm('circleFallback')}</p>}
      <div hidden={isComposer&&(!composerReady||composerStep!==0)}>
      {isComposer && <div className="mare-governance-stage-heading"><h3>{cm('contextHeading')}</h3><p>{cm('contextHelp')}</p></div>}
      {tension && <section className="mare-governance-source"><strong>{cm('source')}: {tension.title}</strong>{(tension.descriptionRich||tension.description) && <RichTextView value={tension.descriptionRich ?? tension.description ?? ''}/>}</section>}
      {!detail && (
        <Field label={creatingMeetingRestriction ? 'Nome da restrição' : ui('title')}>
          <input
            name="title"
            required
            maxLength={section === "tensions" ? 400 : 200}
            defaultValue={
              document
                ? (initialDocumentAction === 'ARCHIVE'
                    ? (circleDoc(document) ? f('removalProposalTitle',{title:document.title}) : documentText('archiveTitle',{title:document.title}))
                    : (circleDoc(document) ? f('changeProposalTitle',{title:document.title}) : f('publishTitle',{title:document.title})))
                : (meetingSource?.title ?? branch?.title ?? tension?.title ?? "")
            }
          />
        </Field>
      )}
      {!detail && section !== "branches" && (
        <>
        {isComposer ? <Field label={ui('circle')}><SearchSelect label={ui('circle')} value={circle} options={circles.map(node=>({value:node.entityId,label:node.name}))} disabled={!!tension||!!document||disabled} onChange={next=>{if(!parent||parent===circle)setParent(next);setCircle(next);setEntityId('');setSelectedDocument('');setList([]);setDocumentParts([]);}}/></Field> : <>
        <Field
          label={section === "documents" ? f('linkedCircle') : ui('circle')}
        >
          <select value={circle} disabled={!!meetingSource||!!tension||!!document||disabled} onChange={(e) => {if(!parent||parent===circle)setParent(e.target.value);setCircle(e.target.value);setEntityId('');setSelectedDocument('');setList([]);setDocumentParts([]);}}>
            {circles.map((n) => (
              <option key={n.entityId} value={n.entityId}>
                {n.name}
              </option>
            ))}
          </select>
        </Field></>}

        </>
      )}
      {isComposer && !tension && <><Field label={cm('source')}><select value={sourceId} onChange={event=>setSourceId(event.target.value)}><option value="">{cm('noSource')}</option><option value="new">{cm('createTension')}</option>{sources.filter(source=>source.circleId===circle).map(source=><option key={source.id} value={source.id}>{source.title}</option>)}</select></Field>{sourceId==='new' && <><Field label={cm('tensionTitle')}><input value={newTensionTitle} onChange={event=>setNewTensionTitle(event.target.value)} maxLength={200}/></Field><RichTextEditor label={cm('tensionDescription')} value={newTensionRich??''} onChange={setNewTensionRich} readOnly={disabled} pending={disabled}/></>}</>}
      {isComposer && selectedSource && <section className="proposal-tension-source"><strong>{selectedSource.title}</strong>{sourceNeedsDescription?<><p>{cm('completeSource')}</p><Field label={cm('tensionDescription')}><textarea rows={4} maxLength={10000} value={sourceDescriptionText} disabled={disabled} onChange={event=>{const value=event.target.value;setSourceDescriptionDrafts(previous=>({...previous,[sourceId]:value}));setLocalError('');}}/></Field></>:<RichTextView value={selectedSource.descriptionRich??selectedSource.description??''}/>}</section>}
      {composerLoadError && isComposer && <p role="alert">{composerLoadError}</p>}
      </div>
      <div hidden={isComposer&&(!composerReady||composerStep!==1)}>
      {isComposer && <div className="mare-governance-stage-heading"><h3>{cm('changeHeading')}</h3><p>{cm('changeHelp')}</p></div>}
      {section === "tensions" && (
        <RichTextEditor label={f('description')} value={descriptionRich??''} onChange={setDescriptionRich} readOnly={disabled} pending={disabled} />
      )}
      {section === "documents" && (
        <>
          <Field label={f('agreementType')}>
            <select name="typeId">
              <option value="">{f('noType')} </option>
              {types
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ·{" "}
                    {t.workflow === "DIRECT" ? "Direto" : f('governance')}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={f('publicationProcess')}>
            <select name="workflow">
              <option value="DIRECT">{f('directPublication')} </option>
              <option value="GOVERNANCE">{f('governanceProposal')} </option>
            </select>
          </Field>
          <Field label={f('visibility')}>
            <select name="visibility">
              <option value="ORGANIZATION">{f('organization')} </option>
              <option value="AUTHOR">{f('authorOnly')} </option>
            </select>
          </Field>
          <RichTextEditor label={f('content')} value={richContent ?? ""} onChange={setRichContent} readOnly={disabled} pending={disabled} />
        </>
      )}
      {section === "proposals" && !detail && !branch && !(meetingSource && (initialKind || initialEntityKind)) && (
        <Field label={d('type')}>
          <select value={kind==='GOVERNANCE'?(isComposer?partKind:partKind==='DOCUMENT'?'DOCUMENT':'GOVERNANCE'):kind} onChange={(e) => {const value=e.target.value;if(value==='ROLE'||value==='CIRCLE'||value==='DOCUMENT'){setKind('GOVERNANCE');setPartKind(value);if(value!=='DOCUMENT')setEntityKind(value);}else setKind(value);}}>
            {isComposer ? <><option value="ROLE">{f('role')}</option><option value="CIRCLE">{ui('circle')}</option><option value="DOCUMENT">{cm('restriction')}</option><option value="ELECTION">{f('election')}</option></> : ["GOVERNANCE", "DOCUMENT", "ELECTION"].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {section === "proposals" && kind === "GOVERNANCE" && !isComposer && (
        <Field label={locale.startsWith('pt')?'Tipo de parte':'Part type'}>
          <select value={partKind} onChange={(e) => {const value=e.target.value as 'ROLE'|'CIRCLE'|'DOCUMENT';setPartKind(value);if(value!=='DOCUMENT')setEntityKind(value);}}>
            <option value="ROLE">Papel</option><option value="CIRCLE">Círculo</option><option value="DOCUMENT">Restrição</option>
          </select>
        </Field>
      )}
      {branch && !editingBranch && (
        <p>
          {f('branchExact')} </p>
      )}
      {(!branch || editingBranch) &&
        (section === "branches" ||
          (section === "proposals" && kind === "GOVERNANCE" && partKind !== 'DOCUMENT')) && (
          <fieldset ref={changeBuilder} className="gov-change-builder">
            <legend>{isComposer?cm(entityKind==='ROLE'?'proposedRole':'proposedCircle'):f('structureEvolution')} </legend>
            {editingChange!==null&&<p role="status">{locale.startsWith('pt')?'Editando alteração ':'Editing change '}{editingChange+1}</p>}
            <Field label={f('change')}>
              <select
                value={changeKind}
                disabled={disabled||editingChange!==null}
                onChange={(e) => {setChangeKind(e.target.value);setDefinitionDraft({});}}
              >
                {(isComposer ? [["CREATE", cm('createNew')], ["UPDATE", cm('modifyExisting')], ["ARCHIVE", f('remove')]] : [
                  ["UPDATE", f('update')], ["CREATE", f('create')], ["MOVE", f('move')], ["ARCHIVE", f('archive')], ["FIELD", f('fieldChange')],
                ]).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            {changeKind === "CREATE" ? (!isComposer&&
              <Field label={f('create')}>
                <select
                  value={entityKind}
                  disabled={disabled||editingChange!==null}
                  onChange={(e) => setEntityKind(e.target.value)}
                >
                  <option value="ROLE">{f('role')} </option>
                  <option value="CIRCLE">{ui('circle')} </option>
                </select>
              </Field>
            ) : (
              <Field label={f('entity')}>
                <select
                  value={entityId}
                  disabled={disabled||editingChange!==null}
                  onChange={(e) => {
                    setEntityId(e.target.value);
                    setDefinitionDraft({});
                    const selectedPurpose=[...c.structure.circles,...c.structure.roles].find(n=>n.id===e.target.value) as {purpose:string|null;purposeRich?:RichDocument|null}|undefined;
                    setPurposeRich(selectedPurpose?.purposeRich ?? undefined);setPurposeTouched(false);
                    setPurpose(
                      [...c.structure.circles, ...c.structure.roles].find(
                        (n) => n.id === e.target.value,
                      )?.purpose ?? "",
                    );
                    setChangeName(
                      c.structure.nodes.find(
                        (n) => n.entityId === e.target.value,
                      )?.name ?? "",
                    );
                  }}
                >
                  <option value="">{f('select')} </option>
                  {c.structure.nodes.filter(n=>(!isComposer||!['UPDATE','ARCHIVE'].includes(changeKind)||n.kind===entityKind)&&inCircle(n)).map((n) => (
                    <option key={n.entityId} value={n.entityId}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {changeKind === "FIELD" && (
              <>
                <Field label={f('field')}>
                  <select
                    value={fieldId}
                    onChange={(e) => {
                      setFieldId(e.target.value);
                      setFieldValue(
                        governedFields.find(
                          (f) => f.field.id === e.target.value,
                        )?.value ?? null,
                      );
                    }}
                  >
                    <option value="">{f('select')} </option>
                    {governedFields.map((f) => (
                      <option key={f.field.id} value={f.field.id}>
                        {f.field.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {fieldId &&
                  (() => {
                    const schema = governedFields.find(
                      (f) => f.field.id === fieldId,
                    )!.field.schema;
                    return (
                      <Field label={f('newValue')}>
                        {schema.type === "BOOLEAN" ? (
                          <select
                            value={
                              fieldValue === null ? "" : String(fieldValue)
                            }
                            onChange={(e) =>
                              setFieldValue(
                                e.target.value === ""
                                  ? null
                                  : e.target.value === "true",
                              )
                            }
                          >
                            <option value="">{f('empty')} </option>
                            <option value="true">{f('yes')} </option>
                            <option value="false">{f('no')} </option>
                          </select>
                        ) : schema.type === "SELECT" ||
                          schema.type === "MULTI" ? (
                          <select
                            multiple={schema.type === "MULTI"}
                            value={
                              schema.type === "MULTI"
                                ? Array.isArray(fieldValue)
                                  ? fieldValue
                                  : []
                                : String(fieldValue ?? "")
                            }
                            onChange={(e) =>
                              setFieldValue(
                                schema.type === "MULTI"
                                  ? Array.from(e.target.selectedOptions).map(
                                      (o) => o.value,
                                    )
                                  : e.target.value,
                              )
                            }
                          >
                            {schema.type === "SELECT" && (
                              <option value="">{f('select')} </option>
                            )}
                            {schema.options?.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={
                              schema.type === "NUMBER"
                                ? "number"
                                : schema.type === "DATE"
                                  ? "date"
                                  : "text"
                            }
                            value={String(fieldValue ?? "")}
                            onChange={(e) =>
                              setFieldValue(
                                e.target.value === ""
                                  ? null
                                  : schema.type === "NUMBER"
                                    ? Number(e.target.value)
                                    : e.target.value,
                              )
                            }
                          />
                        )}
                      </Field>
                    );
                  })()}
              </>
            )}
            {["UPDATE", "CREATE"].includes(changeKind) && (
              <>
                <Field label={f('name')}>
                  <input
                    value={changeName}
                    onChange={(e) => setChangeName(e.target.value)}
                    maxLength={200}
                  />
                </Field>
                <RichTextEditor label={f('purpose')} key={entityId+':'+list.length+':'+changeKind+':'+changeEditorRevision} value={purposeRich ?? purpose} onChange={value=>{setPurposeRich(value);setPurposeTouched(true);}} readOnly={disabled} pending={disabled} />
                {(["responsibilities", "artifacts"] as const).map(kind => <DefinitionListEditor
                  key={kind+':'+entityId+':'+changeKind+':'+list.length+':'+changeEditorRevision} kind={kind} locale={locale} disabled={disabled}
                  items={definitionDraft[kind] ?? (changeKind === "UPDATE" ? currentDefinition?.[kind] ?? [] : [])}
                  onChange={items => setDefinitionDraft(current => ({...current, [kind]: items}))} />)}
              </>
            )}
            {["MOVE", "CREATE"].includes(changeKind) && (
              <details className="composer-destination" open={!isComposer||changeKind==='MOVE'}><summary>{f('destination')}</summary><Field label={f('destination')}>
                <select
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                >
                  {circles.map((n) => (
                    <option key={n.entityId} value={n.entityId}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </Field></details>
            )}
            <>
            <button type="button" className="composer-add-change" onClick={addChange}>
              {editingChange===null?(meetingSource && locale.startsWith('pt')?'Adicionar alteração':f('addChange')):(locale.startsWith('pt')?'Salvar alteração':'Save change')} </button>
            {editingChange!==null&&<button type="button" onClick={()=>{setEditingChange(null);setChangeEditorRevision(n=>n+1);setDefinitionDraft({});setPurposeRich(undefined);setPurposeTouched(false);setPurpose('');setChangeName('');}}>{locale.startsWith('pt')?'Cancelar edição':'Cancel edit'}</button>}
            </>
            {section !== 'proposals' && <ol>
              {list.map((change, i) => (
                <li key={i}>
                  {change.kind} ·{" "}
                  {change.name ??
                    c.structure.nodes.find(
                      (n) => n.entityId === change.entityId,
                    )?.name}
                  {['CREATE','UPDATE','MOVE','ARCHIVE'].includes(change.kind)&&<button type="button" disabled={disabled||editingChange!==null||editingDocumentPart!==null} onClick={()=>editChange(i)} aria-label={(locale.startsWith('pt')?'Editar alteração ':'Edit change ')+(i+1)}>{locale.startsWith('pt')?'Editar':'Edit'}</button>}
                  <button
                    type="button"
                    disabled={disabled||editingChange!==null||editingDocumentPart!==null}
                    onClick={() =>
                      setList(list.filter((_, index) => index !== i))
                    }
                    aria-label={f('removeChange',{number:formatNumber(i+1)})}
                  >
                    {f('remove')} </button>
                </li>
              ))}
            </ol>}

          </fieldset>
        )}
      {section === "proposals" && kind === "GOVERNANCE" && partKind === "DOCUMENT" && (
        <fieldset className="gov-change-builder">
          <legend>{isComposer?'Restrição proposta':f('agreement')}</legend>
          {editingDocumentPart!==null&&<p role="status">{locale.startsWith('pt')?'Editando alteração ':'Editing change '}{editingDocumentPart+1}</p>}
          {kind==='GOVERNANCE' ? (
            <Field label="Alteração da restrição">
              <select value={restrictionMode} disabled={disabled||editingDocumentPart!==null} onChange={event=>{const next=event.target.value as typeof restrictionMode;setRestrictionMode(next);setDocumentAction(next==='ARCHIVE'?'ARCHIVE':'PUBLISH');}}>
                <option value="CREATE">Criar restrição</option><option value="PUBLISH">Alterar restrição</option><option value="ARCHIVE">Remover restrição</option>
              </select>
            </Field>
          ) : (
            <Field label={documentText('action')}>
              <select name="documentAction" value={documentAction} disabled={disabled||isComposer} onChange={event=>{setDocumentAction(event.target.value as 'PUBLISH'|'ARCHIVE');setSelectedDocument('');}}>
                <option value="PUBLISH">{documentText('publish')}</option>
                <option value="ARCHIVE">{documentText('archive')}</option>
              </select>
            </Field>
          )}
          {(kind==='GOVERNANCE'?restrictionMode:documentAction) === 'ARCHIVE' && <p>{documentText('notice')}</p>}
          {kind==='GOVERNANCE' && restrictionMode==='CREATE' ? <>
            <Field label="Nome da restrição"><input value={newRestrictionName} onChange={event=>setNewRestrictionName(event.target.value)} maxLength={200}/></Field>
            <RichTextEditor label="Descrição da restrição" value={newRestrictionContent??''} onChange={setNewRestrictionContent} readOnly={disabled} pending={disabled}/>
          </> : <>
          <Field label={(kind==='GOVERNANCE'?restrictionMode:documentAction) === 'ARCHIVE' ? documentText('target') : f('agreementToPublish')}>
            <select
              value={selectedDocument}
              disabled={disabled || !!document || editingDocumentPart!==null}
              onChange={(e) => setSelectedDocument(e.target.value)}
            >
              <option value="">{f('select')} </option>
              {docs
                .filter(
                  (d) =>
                    d.visibility === "ORGANIZATION" &&
                    (d.workflow === "GOVERNANCE" || circleDoc(d)) && !d.archived && ((kind==='GOVERNANCE'?restrictionMode:documentAction) !== 'ARCHIVE' || !!d.publishedVersion) && !documentParts.some((part,index)=>index!==editingDocumentPart&&'documentId' in part&&part.documentId===d.id),
                )
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} · {f('revisionLower')} {(kind==='GOVERNANCE'?restrictionMode:documentAction) === 'ARCHIVE' ? d.publishedVersion : d.draftVersion}
                  </option>
                ))}
            </select>
          </Field>
          {kind==='GOVERNANCE' && restrictionMode==='PUBLISH' && selectedDocument && <RichTextEditor label="Conteúdo proposto" value={editRestrictionContent??''} onChange={value=>{setEditRestrictionContent(value);setRestrictionEdited(true);}} readOnly={disabled || !(docs.find(item=>item.id===selectedDocument)?.canEdit ?? (c.bootstrap.capabilities?.['structure.direct'] || docs.find(item=>item.id===selectedDocument)?.authorId===c.bootstrap.membership.id))} pending={disabled}/>}
          </>}
          {isComposer && restrictionMode!=='ARCHIVE' && <Field label="Anexo (até 5 MB)"><input type="file" onChange={event=>setRestrictionAttachment(event.target.files?.[0])}/></Field>}
          {kind==='GOVERNANCE' && <>
            <button type="button" className="composer-add-change" onClick={addDocumentPart}>
              {editingDocumentPart===null?(locale.startsWith('pt')?'Adicionar restrição':'Add restriction'):(locale.startsWith('pt')?'Salvar alteração':'Save change')} </button>
            {editingDocumentPart!==null&&<button type="button" onClick={()=>{setEditingDocumentPart(null);resetRestrictionFields();}}>{locale.startsWith('pt')?'Cancelar edição':'Cancel edit'}</button>}
          </>}
        </fieldset>
      )}
      {section === "proposals" && kind === "GOVERNANCE" && (list.length>0||documentParts.length>0) && (
        <ol className="proposal-parts-list">
          {list.map((change, i) => (
            <li key={'change-'+i}><details className="proposal-part"><summary><span>{({CREATE:'Criar',UPDATE:'Modificar',ARCHIVE:'Remover',MOVE:'Mover',RESTORE:'Restaurar',FIELD:'Campo'} as Record<string,string>)[change.kind]??change.kind} ·{" "}
              {change.name ??
                c.structure.nodes.find(
                  (n) => n.entityId === change.entityId,
                )?.name}</span></summary>
              <div className="proposal-part-actions">
                {change.parentCircleId&&<p className="proposal-muted">{f('destination')}: {c.structure.nodes.find(n=>n.entityId===change.parentCircleId)?.name??change.parentCircleId}</p>}
                {['CREATE','UPDATE','MOVE','ARCHIVE'].includes(change.kind)&&<button type="button" disabled={disabled||editingChange!==null||editingDocumentPart!==null} onClick={()=>editChange(i)} aria-label={(locale.startsWith('pt')?'Editar alteração ':'Edit change ')+(i+1)}>{locale.startsWith('pt')?'Editar':'Edit'}</button>}
                <button
                  type="button"
                  disabled={disabled||editingChange!==null||editingDocumentPart!==null}
                  onClick={() =>
                    setList(list.filter((_, index) => index !== i))
                  }
                  aria-label={f('removeChange',{number:formatNumber(i+1)})}
                >
                  {f('remove')} </button>
              </div>
            </details></li>
          ))}
          {documentParts.map((part, i) => {
            const doc=part.mode==='CREATE'?null:docs.find(d=>d.id===part.documentId);
            const title=part.mode==='CREATE'?part.title:(doc?.title??'');
            const kindLabel=part.mode==='CREATE'?(locale.startsWith('pt')?'Criar restrição':'Create restriction'):part.mode==='ARCHIVE'?(locale.startsWith('pt')?'Remover restrição':'Remove restriction'):(locale.startsWith('pt')?'Alterar restrição':'Change restriction');
            return <li key={'document-'+i}><details className="proposal-part"><summary><span>{kindLabel} · {title}</span></summary>
              <div className="proposal-part-actions">
                {part.mode==='CREATE'&&part.richContent&&<RichTextView value={part.richContent}/>}
                {'attachment' in part&&part.attachment&&<p className="proposal-muted">{part.attachment.name}</p>}
                <button type="button" disabled={disabled||editingChange!==null||editingDocumentPart!==null} onClick={()=>editDocumentPart(i)} aria-label={(locale.startsWith('pt')?'Editar alteração ':'Edit change ')+(list.length+i+1)}>{locale.startsWith('pt')?'Editar':'Edit'}</button>
                <button
                  type="button"
                  disabled={disabled||editingChange!==null||editingDocumentPart!==null}
                  onClick={() => setDocumentParts(documentParts.filter((_, index) => index !== i))}
                  aria-label={f('removeChange',{number:formatNumber(list.length+i+1)})}
                >
                  {f('remove')} </button>
              </div>
            </details></li>;
          })}
        </ol>
      )}
      {section === "proposals" && kind === "DOCUMENT" && (
        <>
        {(isComposer || meetingRestriction) && <Field label={cm('restrictionAction')}><select value={restrictionMode} onChange={event=>{const next=event.target.value as typeof restrictionMode;setRestrictionMode(next);setDocumentAction(next==='ARCHIVE'?'ARCHIVE':'PUBLISH');}}><option value="CREATE">{cm('createRestriction')}</option><option value="PUBLISH">{cm('modifyRestriction')}</option><option value="ARCHIVE">{cm('removeRestriction')}</option></select></Field>}
        {(isComposer || meetingRestriction) && restrictionMode==='CREATE' ? <>{isComposer && <Field label={cm('restrictionName')}><input value={newRestrictionName} onChange={event=>setNewRestrictionName(event.target.value)} maxLength={200}/></Field>}<RichTextEditor label={cm('restrictionDescription')} value={newRestrictionContent??''} onChange={setNewRestrictionContent} readOnly={disabled} pending={disabled}/></> : <>
        {!isComposer && !meetingRestriction && <Field label={documentText('action')}>
          <select name="documentAction" value={documentAction} disabled={disabled} onChange={event=>{setDocumentAction(event.target.value as 'PUBLISH'|'ARCHIVE');setSelectedDocument('');}}>
            <option value="PUBLISH">{documentText('publish')}</option>
            <option value="ARCHIVE">{documentText('archive')}</option>
          </select>
        </Field>}
        {documentAction === 'ARCHIVE' && <p>{documentText('notice')}</p>}
        <Field label={isComposer || meetingRestriction ? cm('restriction') : documentAction === 'ARCHIVE' ? documentText('target') : f('agreementToPublish')}>
          <select
            required
            value={selectedDocument}
            disabled={disabled || !!document}
            onChange={(e) => setSelectedDocument(e.target.value)}
          >
            <option value="">{f('select')} </option>
            {docs
              .filter(
                (d) =>
                  d.visibility === "ORGANIZATION" &&
                  (d.workflow === "GOVERNANCE" || circleDoc(d)) && !d.archived && (documentAction !== 'ARCHIVE' || !!d.publishedVersion),
              )
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} · {f('revisionLower')} {documentAction === 'ARCHIVE' ? d.publishedVersion : d.draftVersion}
                </option>
              ))}
          </select>
        </Field>
        {isComposer && restrictionMode==='PUBLISH' && selectedDocument && <RichTextEditor label={cm('proposedContent')} value={editRestrictionContent??''} onChange={value=>{setEditRestrictionContent(value);setRestrictionEdited(true);}} readOnly={disabled || !(docs.find(item=>item.id===selectedDocument)?.canEdit ?? (c.bootstrap.capabilities?.['structure.direct'] || docs.find(item=>item.id===selectedDocument)?.authorId===c.bootstrap.membership.id))} pending={disabled}/>}
        </>}
        {isComposer && restrictionMode!=='ARCHIVE' && <Field label={cm('attachment')}><input type="file" onChange={event=>setRestrictionAttachment(event.target.files?.[0])}/></Field>}
        </>
      )}
      {section === "proposals" && kind === "ELECTION" && (
        <>
          <Field label={f('electedRole')}>
            <select name="roleId" required defaultValue={original?.roleId}>
              <option value="">{f('select')} </option>
              {roles.filter(n=>electableRoleIds.includes(n.entityId)).map((n) => (
                <option key={n.entityId} value={n.entityId}>
                  {n.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={f('facilitatorCandidate')}>
            <select
              name="winnerId"
              disabled={!c.bootstrap.capabilities?.["structure.direct"]}
              defaultValue={original?.winnerId ?? ""}
            >
              <option value="">{f('chooseOnRevision')} </option>
              {c.members
                .filter((m) => m.status === "ACTIVE")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={f('termEnd')+' · '+prefs.timeZone}>
            <input type="datetime-local" name="mandateEnd" required defaultValue={mandateInput(original?.mandateEnd,prefs.timeZone)} />
          </Field>
          <p className="muted">
            {f('electionHelp')} </p>
        </>
      )}
      </div>
      {isComposer && <div hidden={!composerReady||composerStep!==2} className="proposal-conduction">
        <div className="mare-governance-stage-heading"><h3>{cm('deliveryHeading')}</h3><p>{cm('deliveryHelp')}</p></div>
        <div className="proposal-async-choice">
          <Clock size={21} aria-hidden="true"/>
          <div><strong id={formId+'-async-label'}>{cm('asyncTitle')}</strong><p id={formId+'-async-help'}>{cm('asyncHelp')}</p></div>
          <button type="button" role="switch" className="proposal-async-switch" aria-labelledby={formId+'-async-label'} aria-describedby={formId+'-async-help'} aria-checked={delivery==='async'} disabled={disabled||asyncAvailable!==true} onClick={()=>setDelivery(delivery==='async'?(meetingId?'meeting':'draft'):'async')}><span/></button>
        </div>
        {asyncAvailable===null&&<p role="status" className="muted">{cm('checkingProcess')}</p>}
        {asyncAvailable===false&&<p className="muted">{cm('mandatoryProcess')}</p>}
        {delivery==='async'?<div className="proposal-conduction-details">
          <Field label={cm('objectionPeriod')}><select value={duration} onChange={event=>setDuration(Number(event.target.value))}>{[...new Set([1,3,5,7,10,14,21,30,duration/24])].sort((a,b)=>a-b).map(days=><option key={days} value={days*24}>{formatNumber(days)} {cm(days===1?'day':'days')}</option>)}</select></Field>
          <p className="proposal-conduction-note"><MessageSquare size={18} aria-hidden="true"/><span>{cm('asyncNote',{count:formatNumber(duration/24),unit:cm(duration===24?'day':'days')})}</span></p>
        </div>:<div className="proposal-conduction-details">
          <Field label={cm('meetingLabel')}><select value={meetingId} onChange={event=>{setMeetingId(event.target.value);setDelivery(event.target.value?'meeting':'draft');}}><option value="">{cm('noMeeting')}</option>{targets.map(target=><option key={target.id} value={target.id}>{target.title}{target.startAt?' · '+formatInstant(target.startAt):''}</option>)}</select></Field>
          <p className="proposal-conduction-note"><CalendarDays size={18} aria-hidden="true"/><span>{cm(meetingId?'meetingNote':'draftNote')}</span></p>
        </div>}
      </div>}
      </div>
      {localError && <p className="gov-form-error" role="alert">{localError}</p>}
      <footer className="gov-form-footer">
       {isComposer && <span className="mare-governance-progress">{cm('progress',{current:formatNumber(composerStep+1)})}</span>}
       <button type="button" disabled={requestPending} onClick={cancelDialog}>{governanceUXTranslator(locale)('cancel')}</button>
       {isComposer && composerStep>0 && <button type="button" disabled={disabled} onClick={()=>setComposerStep(step=>step-1)}>{cm('back')}</button>}
       {isComposer && composerStep===2 && delivery!=='draft' && <button type="submit" name="intent" value="draft" disabled={disabled}>{f('saveDraft')}</button>}
       {isComposer && composerStep<2 ? <button key="continue-step" type="button" className="primary" disabled={disabled} onClick={event=>{
         event.preventDefault();
         if(composerStep===0){const title=event.currentTarget.form?.querySelector<HTMLInputElement>('input[name=title]');if(!title?.reportValidity())return;if(!sourceId || (sourceId==='new'&&(!newTensionTitle.trim()||!newTensionRich||!toPlainText(newTensionRich).trim()))){setLocalError(new LocalGovernanceFormError(cm('sourceChoiceRequired')));return;}if(sourceId!=='new'&&(!selectedSource||(sourceNeedsDescription&&!sourceDescriptionText.trim()))){setLocalError(new LocalGovernanceFormError(cm('selectedSourceDescriptionRequired')));return;}}
         if(composerStep===1){
          if(kind==='GOVERNANCE'){
            const collected=collectParts();if(!collected)return;
            setList(collected.changes);setDocumentParts(collected.documents);
            setEditingChange(null);setEditingDocumentPart(null);setChangeEditorRevision(n=>n+1);setEntityId('');setFieldId('');setFieldValue(null);setChangeName('');setPurpose('');setPurposeRich(undefined);setPurposeTouched(false);setDefinitionDraft({});resetRestrictionFields();
          }
          const fields=event.currentTarget.form?.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input[required], select[required]');for(const field of fields??[]){if(field.closest('[hidden]'))continue;if(!field.reportValidity())return;}}
         setLocalError('');setComposerStep(step=>step+1);
       }}>{cm('continue')}</button> : <button key="submit-proposal" type="submit" className="primary" disabled={disabled}>
        {disabled ? f('saving') : detail ? f('saveRevision') : editingBranch ? f('saveDraft') : isComposer ? (delivery==='draft'?f('saveDraft'):cm(delivery==='async'?'openAsync':'scheduleProposal')) : section==='proposals' ? governanceUXTranslator(locale)('createProposal') : f('create')}
       </button>}
      </footer>
    </form>
  );
}
function PolicyForm({
  c,
  existing,
  disabled,
  onSubmit,
}: {
  c: FeatureContext;
  existing?: Row;
  disabled: boolean;
  onSubmit: (b: any, v?: number) => void;
}) {
 const {p:processText}=useGovernanceLocalization();
  const {label,ui,locale} = useGovernanceLocalization();
  const consentText = consentTranslator(locale);
  const consentScope = consentScopeTranslator(locale);
  const [config, setConfig] = useState(
    existing?.configuration ?? initialPolicy,
  );
  const [circleId, setCircleId] = useState(existing?.circleId ?? c.bootstrap.rootCircleId ?? "");
  const [resolution, setResolution] = useState<{policySource:string;allowOverride:boolean;localVersion?:number;leadLinkAccessAvailable:boolean} | null>(null);
  const [policyFailure, setPolicyError] = useState<unknown>(null);
  const policyError=policyFailure==='NO_CIRCLE'?processText('noCircle'):policyFailure?governanceError(policyFailure,locale):'';
  useEffect(() => {
    const abort = new AbortController();
    setResolution(null);
    setPolicyError("");
    if(!circleId){setPolicyError('NO_CIRCLE');return ()=>abort.abort();}
    void c.api<{configuration:typeof initialPolicy;policySource:string;allowOverride:boolean;localVersion?:number;leadLinkAccessAvailable:boolean}>(
      "/organizations/"+c.organizationId+"/governance/policies/"+circleId+"/effective",
      {signal:abort.signal},
    ).then(result => {
      if (abort.signal.aborted) return;
      setConfig(result.data.configuration);
      setResolution(result.data);
    }).catch(error => {
      if (!abort.signal.aborted) setPolicyError(error);
    });
    return () => abort.abort();
  },[c.api,c.organizationId,circleId]);
  const locked = !resolution || !resolution.allowOverride;
  return (
    <form
      className="gov-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!resolution || policyError) return;
        onSubmit(
          {
            circleId: new FormData(e.currentTarget).get("circleId"),
            configuration: config,
          },
          resolution?.localVersion ?? existing?.version,
        );
      }}
    >
      <Field label={ui('circle')}>
        <select
          name="circleId"
          value={circleId}
          onChange={e=>{setResolution(null);setCircleId(e.target.value);}}
          disabled={!!existing}
        >
          {c.structure.nodes
            .filter((n) => n.kind === "CIRCLE")
            .map((n) => (
              <option key={n.entityId} value={n.entityId}>
                {n.name}
              </option>
            ))}
        </select>
        {existing && (
          <input type="hidden" name="circleId" value={existing.circleId} />
        )}
      </Field>
      {policyError ? <p role="alert">{policyError}</p> : !resolution ? <p role="status">{processText('loadingPolicy')} </p> : <p className="muted">
        {processText('effectivePolicy')} {({PACKAGE:locale.startsWith('pt')?'Pacote O2':'O2 package',LOCAL:processText('localPolicy'),ORGANIZATION:processText('orgPolicy'),DOMAIN:processText('defaultPolicy')} as Record<string,string>)[resolution.policySource]}.
        {!resolution.allowOverride && ' '+processText('overrideForbidden')}
      </p>}
      <Field label={consentText('process')}>
        <select disabled={disabled || !resolution} value={config.decisionProcess ?? 'STANDARD'} onChange={e=>setConfig({...config,decisionProcess:e.target.value,...(e.target.value === 'HOLACRACY_O2' && !locked?{method:'CONSENT_WINDOW'}:{})})}>
          <option value="STANDARD">{consentText('standard')}</option>
          <option value="HOLACRACY_O2">{consentText('organic')}</option>
        </select>
      </Field>
      <p className="muted">{consentScope('help')}</p>
      <fieldset className="gov-policy-fields" disabled={disabled || locked}>
      <Field label={processText('draftAccess')}>
        <select value={config.draftAccess ?? "AUTHOR_ONLY"} onChange={e=>setConfig({...config,draftAccess:e.target.value})}>
          <option value="AUTHOR_ONLY">{processText('authorOnly')} </option>
          <option value="AUTHOR_AND_LEAD_LINKS" disabled={!resolution?.leadLinkAccessAvailable}>{processText('authorLeads')} </option>
          <option value="CIRCLE_MEMBERS">{processText('circleMembers')} </option>
        </select>
      </Field>
      {!resolution?.leadLinkAccessAvailable && <p className="muted">{processText('leadUnavailable')} </p>}
      {!(config.decisionProcess === 'HOLACRACY_O2' && config.method === 'CONSENT_WINDOW') && <Field label={processText('workflow')}>
        <select
          value={JSON.stringify(config.workflowSteps) === JSON.stringify(initialPolicy.workflowSteps) ? "FULL" : JSON.stringify(config.workflowSteps) === JSON.stringify(["PRESENT","DECIDE"]) ? "SIMPLIFIED" : "CUSTOM"}
          onChange={e => {
            if (e.target.value !== "CUSTOM") setConfig({...config,workflowSteps:e.target.value === "FULL" ? [...initialPolicy.workflowSteps] : ["PRESENT","DECIDE"]});
          }}
        >
          <option value="FULL">{processText('fullFlow')} </option>
          <option value="SIMPLIFIED">{processText('simpleFlow')} </option>
          <option value="CUSTOM" disabled>{processText('customFlow')} </option>
        </select>
      </Field>}
      <Field label={processText('method')}>
        <select
          value={config.method}
          onChange={(e) => setConfig({ ...config, method: e.target.value })}
        >
          {["MANUAL_FACILITATED", "CONSENT_ROUND", "CONSENT_WINDOW"].map(
            (s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ),
          )}
        </select>
      </Field>
      {!(config.decisionProcess === 'HOLACRACY_O2' && config.method === 'CONSENT_WINDOW') && <><Field label={processText('quorumPercent')}>
        <input
          type="number"
          min="1"
          max="100"
          required
          value={config.quorumPercent}
          onChange={(e) =>
            setConfig({ ...config, quorumPercent: Number(e.target.value) })
          }
        />
      </Field>
      <Field label={processText('responses')}>
        <select
          value={config.responseRequirement}
          onChange={(e) =>
            setConfig({ ...config, responseRequirement: e.target.value })
          }
        >
          <option value="QUORUM">{processText('quorum')} </option>
          <option value="ALL">{processText('allParticipants')} </option>
        </select>
      </Field></>}
      <Field label={processText('duration')}>
        <input
          type="number"
          min="1"
          max="8760"
          value={config.reviewDurationHours}
          onChange={(e) =>
            setConfig({
              ...config,
              reviewDurationHours: Number(e.target.value),
            })
          }
        />
      </Field>
      <label className="gov-checkbox">
        <input
          type="checkbox"
          checked={config.allowRevote}
          onChange={(e) =>
            setConfig({ ...config, allowRevote: e.target.checked })
          }
        />{" "}
        {processText('revote')} </label>
      <label className="gov-checkbox">
        <input
          type="checkbox"
          checked={config.allowAbstain}
          onChange={(e) =>
            setConfig({ ...config, allowAbstain: e.target.checked })
          }
        />{" "}
        {processText('abstain')} </label>
      </fieldset>
      <p className="muted">
        {processText('policyEffect')} </p>
      <button className="primary" disabled={disabled || !resolution || !!policyError}>
        {processText('savePolicy')} </button>
    </form>
  );
}
export const feature: FeatureDefinition = {
  ...governanceMetadata,
  Component: ({context}) => <FeatureRoleMentions context={context}><GovernanceExperience context={context}/></FeatureRoleMentions>,
};

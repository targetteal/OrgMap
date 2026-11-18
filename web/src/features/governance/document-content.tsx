import {RichTextView,type RichDocument} from '../../editor';
import {useLocalization} from '../../localization';
import {createMessageTranslator,type Locale} from '../../../../packages/i18n';
import {traceRoute,type TraceReference} from '../../traceability';
const messages:Record<Locale,{published:string;draftUnpublished:string;draft:string;unavailable:string}>={
 'pt-BR':{draft:'Rascunho · revisão {number}',published:'Publicada · revisão {number}',draftUnpublished:'Rascunho · revisão {number} (ainda não publicado)',unavailable:'Conteúdo desta revisão indisponível.'},
 'en-US':{draft:'Draft · revision {number}',published:'Published · revision {number}',draftUnpublished:'Draft · revision {number} (not yet published)',unavailable:'Content for this revision is unavailable.'},
 'es-ES':{draft:'Borrador · revisión {number}',published:'Publicada · revisión {number}',draftUnpublished:'Borrador · revisión {number} (aún no publicado)',unavailable:'El contenido de esta revisión no está disponible.'},
 'fr-FR':{draft:'Brouillon · révision {number}',published:'Publiée · révision {number}',draftUnpublished:'Brouillon · révision {number} (pas encore publié)',unavailable:'Le contenu de cette révision est indisponible.'},
 'de-DE':{draft:'Entwurf · Revision {number}',published:'Veröffentlicht · Revision {number}',draftUnpublished:'Entwurf · Revision {number} (noch nicht veröffentlicht)',unavailable:'Der Inhalt dieser Revision ist nicht verfügbar.'},
 'it-IT':{draft:'Bozza · revisione {number}',published:'Pubblicata · revisione {number}',draftUnpublished:'Bozza · revisione {number} (non ancora pubblicata)',unavailable:'Il contenuto di questa revisione non è disponibile.'},
 'ja-JP':{draft:'下書き · 改訂 {number}',published:'公開済み · 改訂 {number}',draftUnpublished:'下書き · 改訂 {number}（未公開）',unavailable:'この改訂の内容は利用できません。'},
 'nl-NL':{draft:'Concept · revisie {number}',published:'Gepubliceerd · revisie {number}',draftUnpublished:'Concept · revisie {number} (nog niet gepubliceerd)',unavailable:'De inhoud van deze revisie is niet beschikbaar.'},
};
type Version={number:number;content?:string;richContent?:RichDocument|null};
export function DocumentContent({document,versions}:{document:{workflow?:string;draftVersion?:number;publishedVersion?:number|null};versions:Version[]}){
 const {locale,formatNumber}=useLocalization(),t=createMessageTranslator(locale,messages);
 const draft=document.draftVersion,published=document.publishedVersion,governed=document.workflow==='GOVERNANCE';
 const main=governed&&published!=null?published:draft;
 const isPublished=published!=null&&main===published;
 const render=(number:number|undefined)=>{const revision=versions.find(v=>v.number===number);if(!revision || (revision.richContent==null&&revision.content===undefined))return <p>{t('unavailable')}</p>;return <RichTextView value={revision.richContent??revision.content??''}/>;};
 const title=(key:'published'|'draftUnpublished'|'draft',number:number|undefined)=>t(key,{number:number===undefined?'—':formatNumber(number)});
 return <div className="gov-document-content">
  <p>{title(isPublished?'published':published!=null?(governed?'draftUnpublished':'draft'):'draftUnpublished',main)}</p>
  {render(main)}
  {governed&&published!=null&&draft!=null&&draft!==published&&<details className="mare-disclosure quiet"><summary>{title('draftUnpublished',draft)}</summary>{render(draft)}</details>}
 </div>;
}

export type DocumentOriginData = { kind: 'direct'|'governed'|'unavailable'; proposal?: TraceReference; proposalRevision?: number; meeting?: TraceReference };
export function DocumentOrigin({origin, documentId, navigate}:{origin?:DocumentOriginData; documentId:string; navigate:(path:string)=>void}) {
 const {locale}=useLocalization();
 if (!origin) return null;
 const pt=locale.startsWith('pt'), back=`/structure/working-agreements/${documentId}`;
 const proposal=origin.proposal && traceRoute(origin.proposal,back);
 const meeting=origin.meeting && traceRoute(origin.meeting,back);
 const proposalRoute=proposal && origin.proposalRevision ? proposal+(proposal.includes('?')?'&':'?')+'revision='+origin.proposalRevision : proposal;
 return <section className="gov-document-origin" aria-label={pt?'Origem desta versão':'Origin of this version'}>
  <strong>{pt?'Origem desta versão':'Origin of this version'}</strong>
  {origin.kind==='direct' && <p>{pt?'Publicada diretamente':'Published directly'}</p>}
  {origin.kind==='unavailable' && <p>{pt?'Origem indisponível neste acesso.':'Origin unavailable with this access.'}</p>}
  {proposalRoute && <button type="button" onClick={()=>navigate(proposalRoute)}>{pt?'Proposta':'Proposal'}: {origin.proposal!.title}</button>}
  {meeting && <button type="button" onClick={()=>navigate(meeting)}>{pt?'Reunião':'Meeting'}: {origin.meeting!.title}</button>}
 </section>;
}

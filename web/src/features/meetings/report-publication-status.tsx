import {useLocalization} from '../../localization';
import {createMessageTranslator,type Locale} from '../../../../packages/i18n';
const messages:Record<Locale,{published:string;draft:string;current:string;last:string;unverified:string}>={
 'pt-BR':{published:'Ata publicada',draft:'Ata em rascunho',current:'Versão atual: v{number}',last:'Última publicação: v{number}',unverified:'Publicação anterior não verificada.'},
 'en-US':{published:'Published minutes',draft:'Draft minutes',current:'Current version: v{number}',last:'Last publication: v{number}',unverified:'Previous publication is unverified.'},
 'es-ES':{published:'Acta publicada',draft:'Acta en borrador',current:'Versión actual: v{number}',last:'Última publicación: v{number}',unverified:'Publicación anterior no verificada.'},
 'fr-FR':{published:'Compte rendu publié',draft:'Compte rendu en brouillon',current:'Version actuelle : v{number}',last:'Dernière publication : v{number}',unverified:'Publication précédente non vérifiée.'},
 'de-DE':{published:'Protokoll veröffentlicht',draft:'Protokoll im Entwurf',current:'Aktuelle Version: v{number}',last:'Letzte Veröffentlichung: v{number}',unverified:'Vorherige Veröffentlichung nicht bestätigt.'},
 'it-IT':{published:'Verbale pubblicato',draft:'Verbale in bozza',current:'Versione attuale: v{number}',last:'Ultima pubblicazione: v{number}',unverified:'Pubblicazione precedente non verificata.'},
 'ja-JP':{published:'議事録を公開済み',draft:'議事録は下書き',current:'現在のバージョン: v{number}',last:'最終公開: v{number}',unverified:'以前の公開は確認されていません。'},
 'nl-NL':{published:'Verslag gepubliceerd',draft:'Verslag in concept',current:'Huidige versie: v{number}',last:'Laatste publicatie: v{number}',unverified:'Eerdere publicatie niet bevestigd.'},
};
export function ReportPublicationStatus({report,versions,showVersions=true}:{report:{state:string;version:number};versions:{version:number;publicationStatus?:string}[];showVersions?:boolean}){
 const {locale,formatNumber}=useLocalization(),t=createMessageTranslator(locale,messages);
 const currentValid=Number.isSafeInteger(report.version)&&report.version>0;
 const last=currentValid?versions.reduce<number|null>((latest,item)=>item.publicationStatus==='PUBLISHED'&&Number.isSafeInteger(item.version)&&item.version>0&&item.version<=report.version&&(latest===null||item.version>latest)?item.version:latest,null):null;
 return <div className="meetings-report-publication-status"><span className="badge">{t(report.state==='PUBLISHED'?'published':'draft')}</span>{showVersions&&currentValid&&<span>{t('current',{number:formatNumber(report.version)})}</span>}{showVersions&&(last!==null?<span>{t('last',{number:formatNumber(last)})}</span>:report.state==='PUBLISHED'?<span>{t('unverified')}</span>:null)}</div>;
}

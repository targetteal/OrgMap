import {useLocalization} from '../../localization';
const keys=['action','publish','archive','target','archived','notice','archiveTitle','proposeArchive','showArchived'] as const;
const rows:Record<string,readonly string[]>={
 'pt-BR':['Ação sobre a política','Publicar revisão','Arquivar política','Política','Arquivada','O arquivamento será aplicado após aprovação. O conteúdo e o histórico serão preservados.','Arquivar {title}','Propor arquivamento','Mostrar arquivadas'],
 'en-US':['Policy action','Publish revision','Archive policy','Policy','Archived','Archiving will be applied after approval. Content and history will be preserved.','Archive {title}','Propose archiving','Show archived'],
 'es-ES':['Acción sobre la política','Publicar revisión','Archivar política','Política','Archivada','El archivo se aplicará tras la aprobación. Se conservarán el contenido y el historial.','Archivar {title}','Proponer archivo','Mostrar archivadas'],
 'fr-FR':['Action sur la politique','Publier la révision','Archiver la politique','Politique','Archivée','L’archivage sera appliqué après approbation. Le contenu et l’historique seront conservés.','Archiver {title}','Proposer l’archivage','Afficher les archives'],
 'de-DE':['Richtlinienaktion','Revision veröffentlichen','Richtlinie archivieren','Richtlinie','Archiviert','Die Archivierung erfolgt nach der Genehmigung. Inhalt und Verlauf bleiben erhalten.','{title} archivieren','Archivierung vorschlagen','Archivierte anzeigen'],
 'it-IT':['Azione sulla politica','Pubblica revisione','Archivia politica','Politica','Archiviata','L’archiviazione sarà applicata dopo l’approvazione. Contenuto e cronologia saranno conservati.','Archivia {title}','Proponi archiviazione','Mostra archiviate'],
 'ja-JP':['方針への操作','改訂を公開','方針をアーカイブ','方針','アーカイブ済み','承認後にアーカイブされます。内容と履歴は保持されます。','{title}をアーカイブ','アーカイブを提案','アーカイブ済みを表示'],
 'nl-NL':['Beleidsactie','Revisie publiceren','Beleid archiveren','Beleid','Gearchiveerd','Archivering wordt na goedkeuring toegepast. Inhoud en geschiedenis blijven bewaard.','{title} archiveren','Archivering voorstellen','Gearchiveerde tonen'],
};
export function useDocumentActionText(){
 const {locale}=useLocalization(),values=rows[locale]??rows['pt-BR'];
 return (key:typeof keys[number],parameters:Record<string,string>={})=>values[keys.indexOf(key)].replace(/\{(\w+)\}/g,(_,name)=>parameters[name]??'{'+name+'}');
}

import { createMessageTranslator, type Locale } from '../../../../packages/i18n';
type Key = 'process'|'standard'|'organic'|'record'|'explain'|'confirm'|'reason'|'submit';
const messages: Record<Locale, Record<Key,string>> = {
 'pt-BR': {process:'Modelo de decisão',standard:'Padrão',organic:'Holacracia / O2',record:'Registrar consentimento da reunião',explain:'A decisão foi tomada pelas pessoas na reunião. Confira a versão atual e registre o resultado somente depois da rodada de objeções.',confirm:'Confirmo que esta versão foi consentida na reunião, sem objeções pendentes.',reason:'Registro da decisão',submit:'Registrar e efetivar'},
 'en-US': {process:'Decision model',standard:'Standard',organic:'Holacracy / O2',record:'Record meeting consent',explain:'The people in the meeting made the decision. Check the current version and record the outcome only after the objection round.',confirm:'I confirm this version was consented to in the meeting, with no outstanding objections.',reason:'Decision record',submit:'Record and apply'},
 'es-ES': {process:'Modelo de decisión',standard:'Estándar',organic:'Holacracia / O2',record:'Registrar consentimiento de la reunión',explain:'Las personas de la reunión tomaron la decisión. Revisa la versión actual y registra el resultado solo después de la ronda de objeciones.',confirm:'Confirmo que esta versión fue consentida en la reunión, sin objeciones pendientes.',reason:'Registro de la decisión',submit:'Registrar y aplicar'},
 'fr-FR': {process:'Modèle de décision',standard:'Standard',organic:'Holacratie / O2',record:'Enregistrer le consentement de la réunion',explain:'Les personnes réunies ont pris la décision. Vérifiez la version actuelle et enregistrez le résultat après le tour d’objections.',confirm:'Je confirme que cette version a été consentie en réunion, sans objection en suspens.',reason:'Compte rendu de la décision',submit:'Enregistrer et appliquer'},
 'de-DE': {process:'Entscheidungsmodell',standard:'Standard',organic:'Holacracy / O2',record:'Konsent der Sitzung erfassen',explain:'Die Anwesenden haben entschieden. Prüfen Sie die aktuelle Version und erfassen Sie das Ergebnis erst nach der Einwandrunde.',confirm:'Ich bestätige, dass diese Version in der Sitzung ohne offene Einwände angenommen wurde.',reason:'Entscheidungsprotokoll',submit:'Erfassen und anwenden'},
 'it-IT': {process:'Modello decisionale',standard:'Standard',organic:'Holacracy / O2',record:'Registra il consenso della riunione',explain:'La decisione è stata presa dalle persone in riunione. Controlla la versione corrente e registra il risultato solo dopo il giro di obiezioni.',confirm:'Confermo che questa versione ha ricevuto consenso in riunione, senza obiezioni pendenti.',reason:'Registrazione della decisione',submit:'Registra e applica'},
 'ja-JP': {process:'意思決定モデル',standard:'標準',organic:'ホラクラシー / O2',record:'会議の同意を記録',explain:'会議の参加者が意思決定を行いました。現在の版を確認し、異議のラウンド後に結果を記録してください。',confirm:'この版が会議で、未解決の異議なく同意されたことを確認します。',reason:'意思決定の記録',submit:'記録して適用'},
 'nl-NL': {process:'Besluitvormingsmodel',standard:'Standaard',organic:'Holacracy / O2',record:'Consent van vergadering vastleggen',explain:'De aanwezigen hebben het besluit genomen. Controleer de huidige versie en leg de uitkomst pas na de bezwarenronde vast.',confirm:'Ik bevestig dat deze versie in de vergadering zonder openstaande bezwaren consent heeft gekregen.',reason:'Besluitregistratie',submit:'Vastleggen en toepassen'},
};
export const consentTranslator = (locale:string) => createMessageTranslator(locale,messages);
const asyncMessages: Record<Locale,Record<'distributing'|'waiting'|'automatic',string>> = {
 'pt-BR':{distributing:'Aguardando a entrega da proposta a todas as pessoas elegíveis. O prazo começa após a distribuição.',waiting:'Prazo de objeções até {date}. A ausência de objeções resulta em consentimento.',automatic:'Após o prazo, o sistema registra o resultado e aplica a proposta, se não houver objeções pendentes.'},
 'en-US':{distributing:'Waiting for delivery to all eligible people. The review period starts after distribution.',waiting:'Objection deadline: {date}. No objection counts as consent.',automatic:'After the deadline, the system records the outcome and applies the proposal if no objections remain.'},
 'es-ES':{distributing:'Esperando la entrega a todas las personas elegibles. El plazo empieza después de la distribución.',waiting:'Plazo de objeciones: {date}. La ausencia de objeciones cuenta como consentimiento.',automatic:'Al terminar el plazo, el sistema registra el resultado y aplica la propuesta si no hay objeciones pendientes.'},
 'fr-FR':{distributing:'En attente de la remise à toutes les personnes concernées. Le délai commence après la distribution.',waiting:'Date limite des objections : {date}. L’absence d’objection vaut consentement.',automatic:'Après le délai, le système enregistre le résultat et applique la proposition sans objection en suspens.'},
 'de-DE':{distributing:'Die Zustellung an alle berechtigten Personen steht aus. Die Frist beginnt nach der Verteilung.',waiting:'Einwandfrist bis {date}. Ohne Einwand gilt die Zustimmung.',automatic:'Nach Ablauf erfasst das System das Ergebnis und wendet den Vorschlag an, sofern keine Einwände offen sind.'},
 'it-IT':{distributing:'In attesa della consegna a tutte le persone aventi diritto. Il termine inizia dopo la distribuzione.',waiting:'Termine per le obiezioni: {date}. L’assenza di obiezioni vale come consenso.',automatic:'Dopo il termine il sistema registra il risultato e applica la proposta se non restano obiezioni.'},
 'ja-JP':{distributing:'対象者全員への配信を待っています。審査期間は配信後に始まります。',waiting:'異議の期限：{date}。異議がなければ同意とみなします。',automatic:'期限後、未解決の異議がなければシステムが結果を記録して提案を適用します。'},
 'nl-NL':{distributing:'Wachten op bezorging aan alle gerechtigden. De termijn begint na de verspreiding.',waiting:'Bezwarentermijn tot {date}. Geen bezwaar geldt als consent.',automatic:'Na de termijn registreert het systeem de uitkomst en past het voorstel toe als er geen bezwaren openstaan.'},
};
export const asyncConsentTranslator = (locale:string) => createMessageTranslator(locale,asyncMessages);
const meetingHelp:Record<Locale,Record<'required',string>> = {
 'pt-BR':{required:'A secretaria atuante registra o consentimento depois da rodada de objeções na reunião.'},
 'en-US':{required:'The acting secretary records consent after the meeting’s objection round.'},
 'es-ES':{required:'La persona que actúa como secretaria registra el consentimiento después de la ronda de objeciones.'},
 'fr-FR':{required:'La personne assurant le secrétariat enregistre le consentement après le tour d’objections.'},
 'de-DE':{required:'Das amtierende Sekretariat erfasst den Konsent nach der Einwandrunde.'},
 'it-IT':{required:'La persona che svolge la segreteria registra il consenso dopo il giro di obiezioni.'},
 'ja-JP':{required:'会議の書記が異議のラウンド後に同意を記録します。'},
 'nl-NL':{required:'De waarnemend secretaris legt het consent na de bezwarenronde vast.'},
};
export const meetingConsentHelpTranslator = (locale:string) => createMessageTranslator(locale,meetingHelp);
const historyMessages:Record<Locale,Record<'automatic'|'noObjections'|'objections'|'windowOpened',string>>={
 'pt-BR':{automatic:'Processo automático',noObjections:'Prazo encerrado sem objeções pendentes.',objections:'Prazo encerrado com objeções pendentes; revisão necessária.',windowOpened:'Prazo de objeções iniciado'},
 'en-US':{automatic:'Automatic process',noObjections:'The deadline ended with no outstanding objections.',objections:'The deadline ended with outstanding objections; review is required.',windowOpened:'Objection period started'},
 'es-ES':{automatic:'Proceso automático',noObjections:'El plazo terminó sin objeciones pendientes.',objections:'El plazo terminó con objeciones pendientes; se requiere revisión.',windowOpened:'Plazo de objeciones iniciado'},
 'fr-FR':{automatic:'Processus automatique',noObjections:'Le délai a expiré sans objection en suspens.',objections:'Le délai a expiré avec des objections en suspens ; une révision est nécessaire.',windowOpened:'Délai d’objection commencé'},
 'de-DE':{automatic:'Automatisches Verfahren',noObjections:'Die Frist endete ohne offene Einwände.',objections:'Die Frist endete mit offenen Einwänden; eine Überarbeitung ist nötig.',windowOpened:'Einwandfrist begonnen'},
 'it-IT':{automatic:'Processo automatico',noObjections:'Il termine è scaduto senza obiezioni pendenti.',objections:'Il termine è scaduto con obiezioni pendenti; occorre una revisione.',windowOpened:'Termine per le obiezioni iniziato'},
 'ja-JP':{automatic:'自動プロセス',noObjections:'未解決の異議なく期限が終了しました。',objections:'未解決の異議があるまま期限が終了しました。再検討が必要です。',windowOpened:'異議申立期間が開始'},
 'nl-NL':{automatic:'Automatisch proces',noObjections:'De termijn is verstreken zonder openstaande bezwaren.',objections:'De termijn is verstreken met openstaande bezwaren; herziening is nodig.',windowOpened:'Bezwarentermijn gestart'},
};
export const consentHistoryTranslator=(locale:string)=>createMessageTranslator(locale,historyMessages);
const scopeMessages:Record<Locale,Record<'help',string>>={
 'pt-BR':{help:'No círculo raiz, este modelo define o padrão da organização. Outros círculos podem escolher um modelo próprio.'},
 'en-US':{help:'At the root circle, this model sets the organization default. Other circles may choose their own model.'},
 'es-ES':{help:'En el círculo raíz, este modelo define el valor predeterminado de la organización. Otros círculos pueden elegir su propio modelo.'},
 'fr-FR':{help:'Dans le cercle racine, ce modèle définit le choix par défaut de l’organisation. Les autres cercles peuvent choisir le leur.'},
 'de-DE':{help:'Im Wurzelkreis legt dieses Modell den Organisationsstandard fest. Andere Kreise können ein eigenes Modell wählen.'},
 'it-IT':{help:'Nel cerchio radice questo modello definisce il valore predefinito dell’organizzazione. Gli altri cerchi possono sceglierne uno proprio.'},
 'ja-JP':{help:'ルートサークルでは、このモデルが組織の既定値になります。他のサークルは独自のモデルを選べます。'},
 'nl-NL':{help:'In de hoofdkring bepaalt dit model de standaard voor de organisatie. Andere kringen kunnen een eigen model kiezen.'},
};
export const consentScopeTranslator=(locale:string)=>createMessageTranslator(locale,scopeMessages);

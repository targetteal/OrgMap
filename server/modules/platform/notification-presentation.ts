import {resolveLocale, SUPPORTED_LOCALES, validTimeZone} from '../../../packages/i18n/index.js';
import type {NotificationContext, NotificationDetailKey} from '../../../packages/contracts/notifications.js';
import type {Ctx} from '../../src/runtime.js';
import type {ResourceRegistry} from './ports.js';

type Translations = readonly [string,string,string,string,string,string,string,string];
const copy = {
  notification: ['Atualização no workspace','Workspace update','Actualización del espacio de trabajo','Mise à jour de l’espace de travail','Aktualisierung im Workspace','Aggiornamento dello spazio di lavoro','ワークスペースの更新','Update in de werkruimte'],
  InvitationAccepted: ['Convite aceito','Invitation accepted','Invitación aceptada','Invitation acceptée','Einladung angenommen','Invito accettato','招待が承諾されました','Uitnodiging geaccepteerd'],
  InvitationDeliveryFailed: ['Problema no envio de convite','Invitation needs attention','La invitación necesita atención','L’invitation nécessite votre attention','Einladung erfordert Ihre Aufmerksamkeit','L’invito richiede attenzione','招待の送信をご確認ください','Uitnodiging heeft aandacht nodig'],
  ProposalSubmitted: ['Proposta aberta para decisão','Proposal opened for decision','Propuesta abierta para decidir','Proposition ouverte à la décision','Vorschlag zur Entscheidung geöffnet','Proposta aperta alla decisione','意思決定の提案を開始','Voorstel geopend voor besluitvorming'],
  ConsentWindowOpened: ['Prazo de objeções iniciado','Objection period started','Plazo de objeciones iniciado','Délai d’objection commencé','Einwandfrist begonnen','Termine per le obiezioni iniziato','異議申立期間が開始','Bezwarentermijn gestart'],
  ProposalDecided: ['Decisão da proposta registrada','Proposal decision recorded','Decisión de la propuesta registrada','Décision de la proposition enregistrée','Entscheidung zum Vorschlag erfasst','Decisione sulla proposta registrata','提案の決定を記録','Besluit over voorstel vastgelegd'],
  RoleAssigned: ['Atribuição de papel','Role assigned','Asignación de rol','Attribution de rôle','Rolle zugewiesen','Ruolo assegnato','ロールが割り当てられました','Rol toegewezen'],
  RoleScopeUpdated: ['Escopo do papel atualizado','Role scope updated','Alcance del rol actualizado','Périmètre du rôle mis à jour','Rollenbereich aktualisiert','Ambito del ruolo aggiornato','ロールの範囲が更新されました','Rolbereik bijgewerkt'],
  RoleUnassigned: ['Ocupação de papel encerrada','Role occupancy ended','Ocupación del rol finalizada','Occupation du rôle terminée','Rollenbesetzung beendet','Assegnazione del ruolo terminata','ロールの担当が終了しました','Rolbezetting beëindigd'],
  CircleAssigned: ['Entrada em círculo','Circle membership added','Incorporación a un círculo','Ajout à un cercle','Kreismitgliedschaft hinzugefügt','Ingresso in un cerchio','サークルに追加されました','Aan cirkel toegevoegd'],
  CircleUnassigned: ['Participação em círculo encerrada','Circle membership ended','Participación en el círculo finalizada','Participation au cercle terminée','Kreismitgliedschaft beendet','Partecipazione al cerchio terminata','サークルへの参加が終了しました','Cirkellidmaatschap beëindigd'],
  comment: ['Novo comentário','New comment','Nuevo comentario','Nouveau commentaire','Neuer Kommentar','Nuovo commento','新しいコメント','Nieuwe reactie'],
  GoalAssigned: ['Objetivo atribuído','Goal assigned','Objetivo asignado','Objectif attribué','Ziel zugewiesen','Obiettivo assegnato','目標が割り当てられました','Doel toegewezen'],
  KRAssigned: ['Resultado-chave atribuído','Key result assigned','Resultado clave asignado','Résultat clé attribué','Schlüsselergebnis zugewiesen','Risultato chiave assegnato','主要な成果が割り当てられました','Kernresultaat toegewezen'],
  GoalUpdated: ['Objetivo atualizado','Goal updated','Objetivo actualizado','Objectif mis à jour','Ziel aktualisiert','Obiettivo aggiornato','目標が更新されました','Doel bijgewerkt'],
  TaskAssigned: ['Tarefa atribuída','Task assigned','Tarea asignada','Tâche attribuée','Aufgabe zugewiesen','Attività assegnata','タスクが割り当てられました','Taak toegewezen'],
  ProjectUpdated: ['Projeto atualizado','Project updated','Proyecto actualizado','Projet mis à jour','Projekt aktualisiert','Progetto aggiornato','プロジェクトが更新されました','Project bijgewerkt'],
  MeetingScheduled: ['Reunião agendada','Meeting scheduled','Reunión programada','Réunion planifiée','Besprechung geplant','Riunione programmata','会議が予定されました','Vergadering gepland'],
  ReportPublished: ['Ata publicada','Meeting report published','Acta publicada','Compte rendu publié','Protokoll veröffentlicht','Verbale pubblicato','議事録が公開されました','Vergaderverslag gepubliceerd'],
  by: ['Por','By','Por','Par','Von','Da','実行者','Door'],
  on: ['Em','On','El','Le','Am','Il','日時','Op'],
  person: ['Pessoa','Person','Persona','Personne','Person','Persona','メンバー','Persoon'],
  role: ['Papel','Role','Rol','Rôle','Rolle','Ruolo','ロール','Rol'],
  circle: ['Círculo','Circle','Círculo','Cercle','Kreis','Cerchio','サークル','Cirkel'],
  scope: ['Escopo','Scope','Alcance','Périmètre','Umfang','Ambito','範囲','Bereik'],
  project: ['Projeto','Project','Proyecto','Projet','Projekt','Progetto','プロジェクト','Project'],
  application: ['Aplicação das mudanças','Applying the changes','Aplicación de los cambios','Application des changements','Anwendung der Änderungen','Applicazione delle modifiche','変更の適用','Toepassing van de wijzigingen'],
  previousScope: ['Escopo anterior','Previous scope','Alcance anterior','Périmètre précédent','Bisheriger Umfang','Ambito precedente','以前の範囲','Vorig bereik'],
  startsAt: ['Início','Starts','Inicio','Début','Beginn','Inizio','開始','Begin'],
  endsAt: ['Término','Ends','Fin','Fin','Ende','Fine','終了','Einde'],
  deadline: ['Prazo','Deadline','Plazo','Échéance','Frist','Scadenza','期限','Deadline'],
  decision: ['Decisão','Decision','Decisión','Décision','Entscheidung','Decisione','決定','Besluit'],
  status: ['Situação','Status','Estado','Statut','Status','Stato','状態','Status'],
  assignee: ['Responsável','Assignee','Responsable','Responsable','Verantwortlich','Responsabile','担当者','Verantwoordelijke'],
  dueAt: ['Vencimento','Due','Vencimiento','Échéance','Fällig','Scadenza','期日','Vervaldatum'],
  location: ['Local','Location','Lugar','Lieu','Ort','Luogo','場所','Locatie'],
  occurrences: ['Encontros na série','Meetings in series','Reuniones en la serie','Réunions de la série','Termine in der Serie','Riunioni nella serie','シリーズの会議数','Vergaderingen in de reeks'],
  view: ['Abrir no OrgMap','Open in OrgMap','Abrir en OrgMap','Ouvrir dans OrgMap','In OrgMap öffnen','Apri in OrgMap','OrgMapで開く','Openen in OrgMap'],
  preferences: ['Escolher quais notificações receber','Choose which notifications to receive','Elegir qué notificaciones recibir','Choisir les notifications à recevoir','Benachrichtigungen auswählen','Scegli quali notifiche ricevere','受け取る通知を選ぶ','Kiezen welke meldingen je ontvangt'],
  footer: ['Você recebe esta mensagem pelas suas preferências neste workspace.','You receive this message according to your preferences in this workspace.','Recibes este mensaje según tus preferencias en este espacio de trabajo.','Vous recevez ce message selon vos préférences dans cet espace de travail.','Sie erhalten diese Nachricht gemäß Ihren Einstellungen in diesem Workspace.','Ricevi questo messaggio in base alle preferenze di questo spazio di lavoro.','このメールは、このワークスペースの通知設定に基づいて送信されています。','Je ontvangt dit bericht op basis van je voorkeuren in deze werkruimte.'],
  failureNote: ['Uma tentativa de envio falhou ou não pôde ser confirmada. Confira a situação atual antes de reenviar.','A sending attempt failed or could not be confirmed. Check the current status before resending.','Un intento de envío falló o no se pudo confirmar. Comprueba el estado actual antes de reenviar.','Une tentative d’envoi a échoué ou n’a pas pu être confirmée. Vérifiez l’état actuel avant de renvoyer.','Ein Sendeversuch ist fehlgeschlagen oder konnte nicht bestätigt werden. Prüfen Sie vor dem erneuten Senden den aktuellen Status.','Un tentativo di invio non è riuscito o non è stato confermato. Controlla lo stato prima di inviare di nuovo.','送信に失敗したか、確認できませんでした。再送信する前に現在の状態を確認してください。','Een verzendpoging is mislukt of niet bevestigd. Controleer de huidige status voordat je opnieuw verzendt.'],
  assignmentHelp: ['Quando você recebe uma atribuição.','When you receive an assignment.','Cuando recibes una asignación.','Quand une attribution vous concerne.','Wenn Ihnen etwas zugewiesen wird.','Quando ricevi un’assegnazione.','担当が割り当てられたとき。','Wanneer je een toewijzing ontvangt.'],
  removalHelp: ['Quando sua participação ou ocupação é encerrada.','When your participation or occupancy ends.','Cuando termina tu participación u ocupación.','Quand votre participation ou occupation prend fin.','Wenn Ihre Teilnahme oder Besetzung endet.','Quando termina la tua partecipazione o assegnazione.','参加または担当が終了したとき。','Wanneer je deelname of bezetting eindigt.'],
  scopeHelp: ['Mudanças no escopo de um papel que você ocupa.','Changes to the scope of a role you occupy.','Cambios en el alcance de un rol que ocupas.','Modifications du périmètre d’un rôle que vous occupez.','Änderungen am Umfang einer von Ihnen besetzten Rolle.','Modifiche all’ambito di un ruolo che ricopri.','担当するロールの範囲が変更されたとき。','Wijzigingen in het bereik van een rol die je vervult.'],
  proposalHelp: ['Abertura, prazos e decisões de propostas em que você participa.','Opening, deadlines and decisions of proposals you participate in.','Apertura, plazos y decisiones de propuestas en las que participas.','Ouverture, échéances et décisions des propositions auxquelles vous participez.','Eröffnung, Fristen und Entscheidungen zu Vorschlägen, an denen Sie teilnehmen.','Apertura, scadenze e decisioni delle proposte a cui partecipi.','参加する提案の開始、期限、決定に関する通知。','Opening, deadlines en besluiten van voorstellen waaraan je deelneemt.'],
  followHelp: ['Atualizações dos recursos que você acompanha.','Updates to resources you follow.','Actualizaciones de los recursos que sigues.','Mises à jour des ressources que vous suivez.','Aktualisierungen von Ressourcen, denen Sie folgen.','Aggiornamenti delle risorse che segui.','フォロー中のリソースの更新。','Updates van bronnen die je volgt.'],
  commentHelp: ['Comentários nos recursos que você acompanha.','Comments on resources you follow.','Comentarios en los recursos que sigues.','Commentaires sur les ressources que vous suivez.','Kommentare zu Ressourcen, denen Sie folgen.','Commenti sulle risorse che segui.','フォロー中のリソースへのコメント。','Reacties op bronnen die je volgt.'],
  meetingHelp: ['Agendamento de reuniões e publicação de atas para participantes.','Meeting scheduling and report publication for participants.','Programación de reuniones y publicación de actas para participantes.','Planification des réunions et publication des comptes rendus pour les participants.','Terminplanung und Veröffentlichung von Protokollen für Teilnehmende.','Programmazione di riunioni e pubblicazione dei verbali per i partecipanti.','参加者への会議日程と議事録の公開通知。','Planning van vergaderingen en publicatie van verslagen voor deelnemers.'],
  invitationHelp: ['Aceite ou problema no envio de um convite de sua responsabilidade.','Acceptance or sending issues for an invitation you are responsible for.','Aceptación o problemas de envío de una invitación a tu cargo.','Acceptation ou problème d’envoi d’une invitation sous votre responsabilité.','Annahme oder Versandprobleme bei einer Einladung in Ihrer Verantwortung.','Accettazione o problemi di invio di un invito di cui sei responsabile.','担当する招待の承諾または送信の問題。','Acceptatie of verzendproblemen van een uitnodiging waarvoor je verantwoordelijk bent.'],
} as const satisfies Record<string, Translations>;

const values = {
 DRAFT:['Rascunho','Draft','Borrador','Brouillon','Entwurf','Bozza','下書き','Concept'],
 PENDING:['Pendente','Pending','Pendiente','En attente','Ausstehend','In attesa','保留中','In afwachting'],
 APPLIED:['Aplicada','Applied','Aplicada','Appliquée','Angewendet','Applicata','適用済み','Toegepast'],
 APPLY_CONFLICT:['Conflito na aplicação','Application conflict','Conflicto al aplicar','Conflit d’application','Konflikt bei der Anwendung','Conflitto di applicazione','適用時の競合','Conflict bij toepassen'],
 SCHEDULED:['Agendada','Scheduled','Programada','Planifiée','Geplant','Programmata','予定済み','Gepland'],
 RUNNING:['Em andamento','Running','En curso','En cours','Laufend','In corso','進行中','Bezig'],
 ADOPT:['Aprovada','Adopted','Aprobada','Adoptée','Angenommen','Approvata','採択','Aangenomen'],
 REJECT:['Rejeitada','Rejected','Rechazada','Rejetée','Abgelehnt','Respinta','却下','Afgewezen'],
 ABSTAIN:['Abstenção','Abstention','Abstención','Abstention','Enthaltung','Astensione','棄権','Onthouding'],
 ACTIVE:['Ativo','Active','Activo','Actif','Aktiv','Attivo','有効','Actief'],
 ARCHIVED:['Arquivado','Archived','Archivado','Archivé','Archiviert','Archiviato','アーカイブ済み','Gearchiveerd'],
 DONE:['Concluído','Done','Completado','Terminé','Erledigt','Completato','完了','Voltooid'],
 TODO:['A fazer','To do','Por hacer','À faire','Zu erledigen','Da fare','未着手','Te doen'],
 IN_PROGRESS:['Em andamento','In progress','En curso','En cours','In Bearbeitung','In corso','進行中','In uitvoering'],
 BLOCKED:['Bloqueado','Blocked','Bloqueado','Bloqué','Blockiert','Bloccato','ブロック中','Geblokkeerd'],
 CANCELLED:['Cancelado','Cancelled','Cancelado','Annulé','Abgebrochen','Annullato','キャンセル済み','Geannuleerd'],
 ON_TRACK:['No prazo','On track','Según lo previsto','En bonne voie','Im Plan','In linea','順調','Op schema'],
 AT_RISK:['Em risco','At risk','En riesgo','À risque','Gefährdet','A rischio','リスクあり','Loopt risico'],
 OFF_TRACK:['Fora do previsto','Off track','Fuera de lo previsto','En retard','Außer Plan','Fuori linea','遅延','Niet op schema'],
 OPEN:['Aberto','Open','Abierto','Ouvert','Offen','Aperto','未完了','Open'],
 CLOSED:['Encerrado','Closed','Cerrado','Clos','Geschlossen','Chiuso','終了','Gesloten'],
 PUBLISHED:['Publicado','Published','Publicado','Publié','Veröffentlicht','Pubblicato','公開済み','Gepubliceerd'],
} as const satisfies Record<string, Translations>;

export function notificationText(locale:string,key:string):string {
  const index=SUPPORTED_LOCALES.indexOf(resolveLocale(locale));
  return (copy as Record<string,Translations>)[key]?.[index] ?? copy.notification[index];
}
export function notificationHeading(locale:string,event:string) {return notificationText(locale,event.endsWith('CommentAdded')?'comment':event);}
export function notificationDescription(locale:string,event:string) {
  return notificationText(locale,event.startsWith('Invitation')?'invitationHelp':event.startsWith('Proposal')||event==='ConsentWindowOpened'?'proposalHelp':event.endsWith('CommentAdded')?'commentHelp':event==='RoleScopeUpdated'?'scopeHelp':event.endsWith('Unassigned')?'removalHelp':event.endsWith('Assigned')?'assignmentHelp':event==='MeetingScheduled'||event==='ReportPublished'?'meetingHelp':'followHelp');
}
const clean=(value:unknown,max:number)=>typeof value==='string'?Array.from(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'').trim()).slice(0,max).join(''):'';
const detailKeys=new Set<NotificationDetailKey>(['person','role','circle','scope','previousScope','startsAt','endsAt','deadline','decision','status','assignee','dueAt','location','occurrences','project','application']);
export function normalizeNotificationContext(raw:unknown):NotificationContext {
  const value=raw&&typeof raw==='object'?raw as NotificationContext:{};
  return {...(clean(value.resourceTitle,500)?{resourceTitle:clean(value.resourceTitle,500)}:{}),...(clean(value.excerpt,1000)?{excerpt:clean(value.excerpt,1000)}:{}),
    ...(Array.isArray(value.details)?{details:value.details.filter(d=>d&&detailKeys.has(d.key)&&clean(d.value,250)).slice(0,12).map(d=>({key:d.key,value:clean(d.value,250)}))}:{})};
}
export function notificationDestination(type:string,id:string,organizationId:string,override?:string) {
  if(override?.startsWith('/')&&!override.startsWith('//')&&!/[\\\x00-\x1f]/.test(override)){
    const target=new URL(override,'https://orgmap.invalid');
    if(target.origin==='https://orgmap.invalid'){target.searchParams.set('organizationId',organizationId);return target.pathname+target.search;}
  }
  const query=new URLSearchParams({organizationId});
  if(type==='invitation'){query.set('invitationId',id);return '/organization-invitations?'+query;}
  if(type==='tension'){query.set('tensionId',id);return '/structure/tensions?'+query;}
  if(type==='report'){query.set('reportId',id);return '/meetings/reports?'+query;}
  const paths:Record<string,string>={role:'/roles/',circle:'/circles/',proposal:'/structure/proposals/',agreement:'/structure/working-agreements/',goal:'/goals/', 'key-result':'/goals/key-results/',project:'/projects/',task:'/projects/tasks/',meeting:'/meetings/'};
  return paths[type]?paths[type]+encodeURIComponent(id)+'?'+query:'/platform/resource/'+encodeURIComponent(type)+'/'+encodeURIComponent(id)+'?'+query;
}
export type NotificationPresentation = {locale:string;heading:string;summary?:string;resourceTitle:string;actorName?:string;occurredAt?:string;details:{label:string;value:string}[];destination:string;preferencesDestination:string};
export async function notificationPresentation(ctx:Ctx,registry:ResourceRegistry,d:any):Promise<NotificationPresentation> {
  const workspace=await registry.notificationWorkspace(ctx),locale=resolveLocale(workspace.locale);
  const resource=await registry.get(d.resource_type)?.lookup?.(ctx,d.resource_id);
  const guest=ctx.member.member_type==='GUEST';
  const context=guest?{}:normalizeNotificationContext(d.context);
  const currentTitle=resource && resource.id===d.resource_id?clean(resource.title,500):'';
  const resourceTitle=currentTitle||(!guest?context.resourceTitle:'')||workspace.name;
  const format=(key:string,value:string)=>{
    if(['startsAt','endsAt','deadline','dueAt'].includes(key)){
      const date=new Date(value);
      const civil=/^\d{4}-\d{2}-\d{2}$/.test(value);
      if(Number.isFinite(+date))return new Intl.DateTimeFormat(locale,{dateStyle:'medium',...(!civil?{timeStyle:'short'}:{}),timeZone:!civil&&validTimeZone(workspace.timeZone)?workspace.timeZone:'UTC'}).format(date);
    }
    return (values as Record<string,Translations>)[value]?.[SUPPORTED_LOCALES.indexOf(locale)]??value;
  };
  const event=clean(d.event,100),occurredAt=d.created_at?new Date(d.created_at).toISOString():undefined;
  return {locale,heading:notificationHeading(locale,event),resourceTitle,
    ...(event==='InvitationDeliveryFailed'?{summary:notificationText(locale,'failureNote')}:context.excerpt?{summary:context.excerpt}:{}),
    ...(!guest&&clean(d.actor_name,200)?{actorName:clean(d.actor_name,200)}:{}),...(occurredAt?{occurredAt}:{}),
    details:(context.details??[]).map(d=>({label:notificationText(locale,d.key),value:format(d.key,d.value)})),
    destination:notificationDestination(d.resource_type,d.resource_id,ctx.org.id,resource?.destination),
    preferencesDestination:'/platform/preferences?'+new URLSearchParams({organizationId:ctx.org.id,event})};
}

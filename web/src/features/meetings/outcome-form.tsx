import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {FeatureContext} from '../../feature-contract';
import type {MeetingProposalType} from '../governance';
import {Field,Notice} from '../../ui';
import {FeatureRoleMentions,RichTextEditor,type RichDocument} from '../../editor';
import {toPlainText} from '../../../../packages/content';
import {RequestError} from '../../api';
import {governanceVocabulary} from '../../governance-vocabulary';
import {workTranslator} from '../work/messages';
import {roleChoiceLabel} from '../../role-choice-label';
import './outcome-form.css';

type Project={id:string;title:string;accessRole:string;frozen:boolean;archived?:boolean;visibility:string;assignmentPermission?:string;assignmentMode?:string};
type Period={id:string;title:string;startsOn:string;endsOn:string;archived:boolean};
type RoleOccupants = { snapshot:string; people:{ id:string; name:string; assignable:boolean }[] };
type RoleSelection = { key:string; status:'loading'|'error' } | { key:string; status:'ready'; roster:RoleOccupants; checked:string[] };
const outcomeKinds=['TASK','PROJECT','GOAL','POLICY','PROPOSAL'] as const;
export type MeetingOutcomeKind=typeof outcomeKinds[number];
const proposalTypes = ['restriction', 'role', 'circle'] as const;
const labels:Record<string,string[]>={
 conflict:['A reunião mudou. Recarregue para revisar a versão.','The meeting changed. Reload to review the current version.','La reunión cambió. Recárgala para revisar la versión.','La réunion a changé. Rechargez-la pour vérifier la version.','Die Besprechung wurde geändert. Laden Sie sie erneut.','La riunione è cambiata. Ricaricala per controllare la versione.','会議が変更されました。再読み込みして確認してください。','De vergadering is gewijzigd. Herlaad om de versie te controleren.'],invalid:['Revise os dados e o período selecionado.','Review the details and selected period.','Revisa los datos y el período seleccionado.','Vérifiez les données et la période sélectionnée.','Prüfen Sie die Angaben und den gewählten Zeitraum.','Controlla i dati e il periodo selezionato.','入力内容と期間を確認してください。','Controleer de gegevens en gekozen periode.'],pending:['Aguarde a confirmação da saída antes de sair.','Wait for the output to be confirmed before leaving.','Espera la confirmación antes de salir.','Attendez la confirmation avant de quitter.','Warten Sie vor dem Verlassen auf die Bestätigung.','Attendi la conferma prima di uscire.','移動前に確認をお待ちください。','Wacht op de bevestiging voordat je vertrekt.'],editor:['Abrir editor de proposta','Open proposal editor','Abrir editor de propuesta','Ouvrir l’éditeur de proposition','Vorschlagseditor öffnen','Apri editor proposta','提案エディターを開く','Voorstelbewerker openen'],reload:['Recarregar reunião','Reload meeting','Recargar reunión','Recharger la réunion','Besprechung neu laden','Ricarica riunione','会議を再読み込み','Vergadering herladen'],kind:['Tipo de saída','Output type','Tipo de resultado','Type de résultat','Ergebnistyp','Tipo di risultato','出力の種類','Resultaattype'],title:['Título','Title','Título','Titre','Titel','Titolo','タイトル','Titel'],task:['Tarefa','Task','Tarea','Tâche','Aufgabe','Attività','タスク','Taak'],project:['Projeto','Project','Proyecto','Projet','Projekt','Progetto','プロジェクト','Project'],goal:['Objetivo','Goal','Objetivo','Objectif','Ziel','Obiettivo','目標','Doel'],policy:['Política','Policy','Política','Politique','Richtlinie','Politica','方針','Beleid'],proposal:['Proposta','Proposal','Propuesta','Proposition','Vorschlag','Proposta','提案','Voorstel'],personal:['Tarefa pessoal','Personal task','Tarea personal','Tâche personnelle','Persönliche Aufgabe','Attività personale','個人タスク','Persoonlijke taak'],visibility:['Visibilidade','Visibility','Visibilidad','Visibilité','Sichtbarkeit','Visibilità','公開範囲','Zichtbaarheid'],private:['Privado','Private','Privado','Privé','Privat','Privato','非公開','Privé'],public:['Público','Public','Público','Public','Öffentlich','Pubblico','公開','Openbaar'],period:['Período','Period','Período','Période','Zeitraum','Periodo','期間','Periode'],choose:['Selecione','Select','Seleccionar','Sélectionner','Auswählen','Seleziona','選択','Selecteer'],content:['Conteúdo da política','Policy content','Contenido de la política','Contenu de la politique','Richtlinieninhalt','Contenuto della politica','方針の内容','Inhoud van beleid'],create:['Criar saída','Create output','Crear resultado','Créer le résultat','Ergebnis erstellen','Crea risultato','出力を作成','Resultaat maken'],retry:['Tentar novamente','Try again','Intentar de nuevo','Réessayer','Erneut versuchen','Riprova','再試行','Opnieuw proberen'],loading:['Carregando…','Loading…','Cargando…','Chargement…','Wird geladen…','Caricamento…','読み込み中…','Laden…'],error:['Não foi possível carregar ou criar. Tente novamente.','Could not load or create. Try again.','No se pudo cargar o crear. Inténtalo de nuevo.','Impossible de charger ou créer. Réessayez.','Laden oder Erstellen fehlgeschlagen. Erneut versuchen.','Impossibile caricare o creare. Riprova.','読み込みまたは作成できませんでした。再試行してください。','Laden of maken mislukt. Probeer opnieuw.'],notice:['A política será proposta para decisão, não aplicada imediatamente.','The policy will be proposed for decision, not applied immediately.','La política se propondrá para decisión, sin aplicarse de inmediato.','La politique sera proposée à la décision, sans application immédiate.','Die Richtlinie wird zur Entscheidung vorgeschlagen und nicht sofort angewendet.','La politica sarà proposta per decisione, senza applicazione immediata.','方針は意思決定のために提案され、直ちに適用されません。','Het beleid wordt ter besluitvorming voorgesteld en niet meteen toegepast.'],};
labels.unavailable=['Nenhum tipo de saída está disponível neste contexto.','No output types are available in this context.','No hay tipos de resultado disponibles en este contexto.','Aucun type de résultat n’est disponible dans ce contexte.','In diesem Kontext sind keine Ergebnistypen verfügbar.','Nessun tipo di risultato è disponibile in questo contesto.','このコンテキストで利用できる出力の種類はありません。','In deze context zijn geen resultaattypen beschikbaar.'];
labels.responsible=['Responsável','Responsible','Responsable','Responsable','Verantwortlich','Responsabile','責任者','Verantwoordelijk'];
labels.person=['Pessoa','Person','Persona','Personne','Person','Persona','担当者','Persoon'];
labels.anyone=['Todos no papel','Everyone in the role','Todos en el rol','Tout le monde dans le rôle','Alle in der Rolle','Tutti nel ruolo','役割の全員','Iedereen in de rol'];
labels.direct=['Atribuir diretamente a uma pessoa','Assign directly to a person','Asignar directamente a una persona','Attribuer directement à une personne','Direkt einer Person zuweisen','Assegna direttamente a una persona','人に直接割り当てる','Direct aan een persoon toewijzen'];
labels.description=['Descrição','Description','Descripción','Description','Beschreibung','Descrizione','説明','Beschrijving'];
Object.assign(labels, {
 link: ['Vínculo (opcional)', 'Link (optional)', 'Vínculo (opcional)', 'Lien (facultatif)', 'Verknüpfung (optional)', 'Collegamento (facoltativo)', '関連付け（任意）', 'Koppeling (optioneel)'],
 assignee: ['Responsável (opcional)', 'Assignee (optional)', 'Responsable (opcional)', 'Responsable (facultatif)', 'Zuständig (optional)', 'Responsabile (facoltativo)', '担当者（任意）', 'Verantwoordelijke (optioneel)'],
 noLink: ['Sem vínculo', 'No link', 'Sin vínculo', 'Sans lien', 'Ohne Verknüpfung', 'Nessun collegamento', '関連付けなし', 'Geen koppeling'],
 linkAccess: ['O vínculo aparece no projeto. O acesso é configurado separadamente.', 'The link appears on the project. Access is managed separately.', 'El vínculo aparece en el proyecto. El acceso se gestiona por separado.', 'Le lien apparaît dans le projet. L’accès se gère séparément.', 'Die Verknüpfung erscheint im Projekt. Der Zugriff wird separat verwaltet.', 'Il collegamento appare nel progetto. L’accesso si gestisce separatamente.', '関連付けはプロジェクトに表示されます。アクセス権は別途設定します。', 'De koppeling verschijnt bij het project. Toegang wordt apart geregeld.'],
 PERSONAL_TASK_PRIVATE: ['Para atribuir a outra pessoa, escolha um projeto ao qual ela tenha acesso.', 'To assign someone else, choose a project they can access.', 'Para asignar a otra persona, elige un proyecto al que tenga acceso.', 'Pour attribuer la tâche à une autre personne, choisissez un projet auquel elle a accès.', 'Wählen Sie ein Projekt, auf das die andere Person Zugriff hat.', 'Per assegnare la persona, scegli un progetto a cui ha accesso.', '他の人を担当にするには、その人がアクセスできるプロジェクトを選択してください。', 'Kies een project waartoe de andere persoon toegang heeft.'],
 ASSIGNEE_REQUIRES_ACCESS: ['A pessoa escolhida precisa ter acesso ao projeto. Troque o projeto ou o responsável.', 'The assignee needs access to the project. Change the project or assignee.', 'La persona necesita acceso al proyecto. Cambia el proyecto o el responsable.', 'La personne doit avoir accès au projet. Changez de projet ou de responsable.', 'Die Person braucht Zugriff auf das Projekt. Ändern Sie Projekt oder Zuständigkeit.', 'La persona deve avere accesso al progetto. Cambia il progetto o il responsabile.', '担当者にプロジェクトへのアクセス権が必要です。プロジェクトか担当者を変更してください。', 'De verantwoordelijke moet toegang hebben. Kies een ander project of een andere verantwoordelijke.'],
 ASSIGNMENT_DENIED: ['Só gestores podem atribuir responsáveis neste projeto. Escolha outro projeto ou deixe sem responsável.', 'Only managers can assign tasks in this project. Choose another project or leave it unassigned.', 'Solo los gestores pueden asignar tareas en este proyecto. Elige otro proyecto o déjala sin responsable.', 'Seuls les gestionnaires peuvent attribuer des tâches dans ce projet. Changez de projet ou laissez la tâche sans responsable.', 'Nur die Projektleitung darf Aufgaben zuweisen. Wählen Sie ein anderes Projekt oder lassen Sie die Aufgabe offen.', 'Solo i gestori possono assegnare attività in questo progetto. Scegli un altro progetto o lascia l’attività senza responsabile.', 'このプロジェクトでは管理者のみ担当者を設定できます。別のプロジェクトを選ぶか、担当者を未設定にしてください。', 'Alleen beheerders mogen hier taken toewijzen. Kies een ander project of laat de taak zonder verantwoordelijke.'],
 PROJECT_CONFIGURATION_LOCKED: ['A configuração de projetos está bloqueada. Para criar o projeto, retire o vínculo.', 'Project configuration is locked. To create the project, remove the link.', 'La configuración de proyectos está bloqueada. Quita el vínculo para crear el proyecto.', 'La configuration des projets est verrouillée. Retirez le lien pour créer le projet.', 'Die Projektkonfiguration ist gesperrt. Entfernen Sie die Verknüpfung, um das Projekt zu erstellen.', 'La configurazione dei progetti è bloccata. Rimuovi il collegamento per creare il progetto.', 'プロジェクト設定はロックされています。関連付けを外して作成してください。', 'De projectconfiguratie is vergrendeld. Verwijder de koppeling om het project te maken.'],
});
Object.assign(labels, {
 roleOccupants: ['Pessoas que energizam o papel', 'People currently filling the role', 'Personas que ocupan el rol', 'Personnes qui occupent le rôle', 'Aktuelle Rollenbesetzung', 'Persone che ricoprono il ruolo', '現在の役割担当者', 'Huidige rolbezetting'],
 roleLoading: ['Consultando quem energiza este papel…', 'Loading current role holders…', 'Consultando quién ocupa el rol…', 'Recherche des titulaires du rôle…', 'Rollenbesetzung wird geladen…', 'Caricamento dei titolari del ruolo…', '役割担当者を読み込んでいます…', 'Rolbezetting wordt geladen…'],
 roleUnavailable: ['Não foi possível consultar quem energiza este papel.', 'Could not load current role holders.', 'No se pudo consultar quién ocupa el rol.', 'Impossible de charger les titulaires du rôle.', 'Die Rollenbesetzung konnte nicht geladen werden.', 'Impossibile caricare i titolari del ruolo.', '役割担当者を読み込めませんでした。', 'De rolbezetting kon niet worden geladen.'],
 roleVacant: ['Este papel está vago.', 'This role is vacant.', 'Este rol está vacante.', 'Ce rôle est vacant.', 'Diese Rolle ist unbesetzt.', 'Questo ruolo è vacante.', 'この役割は空席です。', 'Deze rol is vacant.'],
 roleDynamic: ['A tarefa acompanha quem energiza o papel e tem acesso a ela.', 'The task follows role holders who have access to it.', 'La tarea sigue a quienes ocupan el rol y tienen acceso.', 'La tâche suit les titulaires du rôle qui y ont accès.', 'Die Aufgabe folgt den Rolleninhabern mit Zugriff.', 'L’attività segue i titolari del ruolo che hanno accesso.', 'タスクはアクセス権のある役割担当者に引き継がれます。', 'De taak volgt rolhouders die toegang hebben.'],
 roleDirect: ['A tarefa fica com as pessoas marcadas.', 'The task stays assigned to the selected people.', 'La tarea queda asignada a las personas seleccionadas.', 'La tâche reste attribuée aux personnes sélectionnées.', 'Die Aufgabe bleibt den ausgewählten Personen zugewiesen.', 'L’attività resta assegnata alle persone selezionate.', 'タスクは選択した人に割り当てられます。', 'De taak blijft toegewezen aan de geselecteerde personen.'],
 roleProject: ['As pessoas marcadas entram como participantes do projeto.', 'The selected people become project participants.', 'Las personas seleccionadas serán participantes del proyecto.', 'Les personnes sélectionnées deviennent participantes du projet.', 'Die ausgewählten Personen nehmen am Projekt teil.', 'Le persone selezionate partecipano al progetto.', '選択した人はプロジェクトの参加者になります。', 'De geselecteerde personen worden projectdeelnemers.'],
 roleNoAccess: ['Sem acesso à tarefa', 'No task access', 'Sin acceso a la tarea', 'Aucun accès à la tâche', 'Kein Aufgabenzugriff', 'Nessun accesso all’attività', 'タスクへのアクセス権なし', 'Geen toegang tot de taak'],
 rolePick: ['Marque pelo menos uma pessoa ou retire o papel.', 'Select at least one person or remove the role.', 'Selecciona al menos una persona o quita el rol.', 'Sélectionnez au moins une personne ou retirez le rôle.', 'Wählen Sie mindestens eine Person oder entfernen Sie die Rolle.', 'Seleziona almeno una persona o rimuovi il ruolo.', '担当者を一人以上選ぶか、役割を外してください。', 'Selecteer minstens één persoon of verwijder de rol.'],
 roleSingle: ['Este projeto permite um responsável direto. Marque uma pessoa ou todas para atribuir ao papel.', 'This project allows one direct assignee. Select one person or select all to assign the role.', 'Este proyecto permite un responsable directo. Selecciona una persona o a todas para asignar al rol.', 'Ce projet permet un responsable direct. Sélectionnez une personne ou toutes pour attribuer le rôle.', 'Dieses Projekt erlaubt eine direkte Zuweisung. Wählen Sie eine Person oder alle für die Rollenzuweisung.', 'Il progetto consente un responsabile diretto. Seleziona una persona o tutte per assegnare il ruolo.', '直接担当は一人までです。一人を選ぶか、全員を選んで役割に割り当ててください。', 'Dit project staat één directe verantwoordelijke toe. Kies één persoon of iedereen voor de rol.'],
 roleTooMany: ['Reduza a seleção antes de salvar.', 'Select fewer people before saving.', 'Reduce la selección antes de guardar.', 'Sélectionnez moins de personnes avant d’enregistrer.', 'Wählen Sie vor dem Speichern weniger Personen aus.', 'Riduci la selezione prima di salvare.', '人数を減らしてから保存してください。', 'Selecteer minder personen voordat je opslaat.'],
 roleChanged: ['As energizações mudaram. Atualize a lista e revise a seleção.', 'The role holders changed. Refresh the list and review your selection.', 'Cambió quién ocupa el rol. Actualiza la lista y revisa la selección.', 'Les titulaires ont changé. Actualisez la liste et vérifiez la sélection.', 'Die Rollenbesetzung hat sich geändert. Aktualisieren Sie die Liste und prüfen Sie Ihre Auswahl.', 'I titolari sono cambiati. Aggiorna l’elenco e rivedi la selezione.', '役割担当者が変わりました。一覧を更新し、選択内容を確認してください。', 'De rolbezetting is gewijzigd. Vernieuw de lijst en controleer je selectie.'],
 roleRefresh: ['Atualizar pessoas', 'Refresh people', 'Actualizar personas', 'Actualiser la liste', 'Liste aktualisieren', 'Aggiorna elenco', '担当者を更新', 'Lijst vernieuwen'],
 hiddenCircle: ['Círculo não compartilhado', 'Circle not shared', 'Círculo no compartido', 'Cercle non partagé', 'Kreis nicht geteilt', 'Cerchio non condiviso', '共有されていないサークル', 'Cirkel niet gedeeld'],
});
const workLinkErrors = ['PERSONAL_TASK_PRIVATE','ASSIGNEE_REQUIRES_ACCESS','ASSIGNMENT_DENIED','PROJECT_CONFIGURATION_LOCKED','ASSIGNMENT_LIMIT'];
const locales=['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL'];
function OutcomeForm({context:c,meetingId,meetingVersion,timeZone,agenda,onCreated,onProposal,onReload,onBusy,allowedKinds,agendaContext,circleId}:{context:FeatureContext;meetingId:string;meetingVersion:number;timeZone:string;agenda:{id:string;title:string}[];onCreated:()=>void;onProposal:(agendaId:string|null,type?:MeetingProposalType)=>void;onReload:()=>void;onBusy?:(busy:boolean)=>void;allowedKinds?:readonly MeetingOutcomeKind[];agendaContext?:{id:string;announceAdapt:boolean};circleId?:string|null}){
 const language=Math.max(0,locales.indexOf(c.accountPreferences?.locale??'pt-BR'));const t=(k:string)=>labels[k][language];
 const availableKinds = outcomeKinds.filter(k => allowedKinds === undefined || allowedKinds.includes(k));
 const governanceKinds = agendaContext && availableKinds.includes('PROPOSAL') ? proposalTypes : [];
 const operationalKinds = agendaContext ? availableKinds.filter(k => k !== 'POLICY' && k !== 'PROPOSAL') : availableKinds;
 const allowed = agendaContext?.announceAdapt ? [...governanceKinds, ...operationalKinds] : [...operationalKinds, ...governanceKinds];
 const scope=JSON.stringify([c.organizationId,c.session.account.id,c.bootstrap.membership.id,c.bootstrap.membership.memberType,c.bootstrap.membership.orgRole,c.bootstrap.authorizationRevision,c.bootstrap.modules?.work,c.bootstrap.modules?.goals,c.bootstrap.modules?.governance,c.bootstrap.modules?.meetings,meetingId,circleId,agendaContext?.id,allowed]);
 const liveScope=useRef(scope),pending=useRef(false),mounted=useRef(false),reason=useRef(t('pending'));liveScope.current=scope;reason.current=t('pending');
 useEffect(()=>{mounted.current=true;const unload=(e:BeforeUnloadEvent)=>{if(pending.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{mounted.current=false;window.removeEventListener('beforeunload',unload);};},[]);
 useEffect(()=>c.registerNavigationGuard?.(()=>pending.current?reason.current:null),[c.registerNavigationGuard]);
 useEffect(()=>{pending.current=false;setBusy(false);onBusy?.(false);},[scope]);
 const [richContent,setRichContent]=useState<RichDocument|undefined>();
 const [workLink,setWorkLink]=useState('');
 const [responsibleRole,setResponsibleRole]=useState(''),[responsibleLead,setResponsibleLead]=useState('');
 const [selectedKind,setKind]=useState<string>(allowed[0] ?? ''),[selection,setSelection]=useState(''),[period,setPeriod]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[attempt,setAttempt]=useState<{signature:string;key:string}|null>(null);
 const modules=c.bootstrap.modules;const available:readonly string[]=allowed.filter(k=>k==='GOAL'?c.bootstrap.membership.orgRole==='OWNER'&&modules?.goals!==false:k==='TASK'||k==='PROJECT'?modules?.work!==false:modules?.governance!==false);
 const kind=available.includes(selectedKind)?selectedKind:(available[0]??'');
 const proposalType = proposalTypes.find(type => type === kind);
 const opensEditor = kind === 'PROPOSAL' || !!proposalType;
 const vocabulary = governanceVocabulary(c.bootstrap);
 const outcomeLabel = (value: string) => {
  if (value === 'restriction') return vocabulary.agreement;
  if (value === 'role' || value === 'circle') return vocabulary[value];
  return t(value.toLowerCase());
 };
 useEffect(()=>{if(selectedKind!==kind)setKind(kind);},[selectedKind,kind]);
 const [choices,setChoices]=useState<{scope:string;kind:string;status:'loading'|'ready'|'error';projects:Project[];periods:Period[]}>({scope:'',kind:'',status:'loading',projects:[],periods:[]});
 const current=choices.scope===scope&&choices.kind===kind?choices:{scope,kind,status:'loading' as const,projects:[],periods:[]};
 useEffect(()=>{setSelection('');setPeriod('');setWorkLink('');setResponsibleRole('');setResponsibleLead('');setAttempt(null);setError('');setRichContent(undefined);},[scope,kind]);
 useEffect(()=>{const ctrl=new AbortController();if(c.bootstrap.membership.memberType==='GUEST'||!kind)return;setChoices({scope,kind,status:'loading',projects:[],periods:[]});if(kind!=='TASK'&&kind!=='GOAL'){setChoices({scope,kind,status:'ready',projects:[],periods:[]});return;}
 const path=kind==='TASK'?`/organizations/${c.organizationId}/work/projects`:`/organizations/${c.organizationId}/goal-periods`;
 void c.api<any>(path,{signal:ctrl.signal}).then(r=>{if(ctrl.signal.aborted)return;const today=new Intl.DateTimeFormat('en-CA',{timeZone:(c.bootstrap.organization as any).timeZone??timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());setChoices({scope,kind,status:'ready',projects:kind==='TASK'?r.data.projects.filter((p:Project)=>['MANAGER','EDITOR'].includes(p.accessRole)&&!p.frozen&&!p.archived):[],periods:kind==='GOAL'?r.data.items.filter((p:Period)=>!p.archived&&p.startsOn<=today&&p.endsOn>=today):[]});},()=>{if(!ctrl.signal.aborted)setChoices({scope,kind,status:'error',projects:[],periods:[]});});return()=>ctrl.abort();},[scope,kind,retry,c.api,timeZone]);
 // A project's responsible role/person is scoped to the meeting's circle. The
 // optional work link below remains an independent project context/task assignment.
 const nodes=c.structure?.nodes??[];
 const circleNode=nodes.find(node=>node.kind==='CIRCLE'&&node.entityId===circleId);
 const circleRoles=circleNode?nodes.filter(node=>node.kind==='ROLE'&&node.parentNodeId===circleNode.nodeId):[];
 const now=Date.now();
 const isActive=(relation:{startsAt:string;endsAt?:string|null})=>Date.parse(relation.startsAt)<=now&&(!relation.endsAt||Date.parse(relation.endsAt)>now);
 const activeMember=(memberId:string)=>(c.members??[]).find(member=>member.id===memberId&&member.status==='ACTIVE'&&member.memberType!=='GUEST');
 const peopleForRoles=(roleIds:Set<string>)=>new Set((c.structure?.occupancies??[]).filter(relation=>relation.roleId&&roleIds.has(relation.roleId)&&isActive(relation)).map(relation=>relation.memberId));
 const roleOccupants=[...peopleForRoles(new Set(circleRoles.some(role=>role.entityId===responsibleRole)?[responsibleRole]:[]))].map(activeMember).filter((member):member is NonNullable<typeof member>=>!!member);
 const circleMemberIds=peopleForRoles(new Set(circleRoles.map(role=>role.entityId)));
 if(circleId)for(const relation of c.structure?.memberships??[])if(relation.circleId===circleId&&isActive(relation))circleMemberIds.add(relation.memberId);
 const circlePeople=[...circleMemberIds].map(activeMember).filter((member):member is NonNullable<typeof member>=>!!member);
 const responsibleValid=responsibleRole==='__person__'?circlePeople.some(member=>member.id===responsibleLead):circleRoles.some(role=>role.entityId===responsibleRole)&&(!responsibleLead||roleOccupants.some(member=>member.id===responsibleLead));
 const workText = workTranslator(locales[language]);
 const isTask = kind === 'TASK', isProject = kind === 'PROJECT';
 const [linkKind, targetId] = workLink.split(':');
 const taskProject = current.projects.find(project => project.id === selection);
 const personalTaskConflict = isTask && !selection && linkKind === 'MEMBER' && targetId !== c.bootstrap.membership.id;
 const assignmentDenied = isTask && !!workLink && taskProject?.accessRole === 'EDITOR' && taskProject.assignmentPermission === 'MANAGERS';
 const roleChosen = (isTask || isProject) && linkKind === 'ROLE';
 const [roleRetry,setRoleRetry]=useState(0);
 const [roleState,setRoleState]=useState<RoleSelection>();
 const roleKey = JSON.stringify([scope, kind, workLink, selection, roleRetry]);
 useEffect(()=>{
  if(!roleChosen || assignmentDenied || c.bootstrap.membership.memberType==='GUEST')return;
  const controller=new AbortController();
  const query = new URLSearchParams({kind, roleId:targetId, ...(isTask && selection ? {projectId:selection} : {})});
  void c.api<RoleOccupants>(`/organizations/${c.organizationId}/meetings/${meetingId}/outcomes/role-occupants?${query}`,{signal:controller.signal}).then(({data})=>{
   if(!controller.signal.aborted)setRoleState({key:roleKey,status:'ready',roster:data,checked:data.people.filter(person=>person.assignable).map(person=>person.id)});
  },()=>{if(!controller.signal.aborted)setRoleState({key:roleKey,status:'error'});});
  return()=>controller.abort();
 },[roleChosen,assignmentDenied,roleKey,c.api]);
 if(c.bootstrap.membership.memberType==='GUEST')return null;
 const roster = roleChosen && roleState?.key===roleKey && roleState.status==='ready' ? roleState : undefined;
 const roleFailed = roleState?.key===roleKey && roleState.status==='error';
 const roleChanged = error==='ROLE_OCCUPANTS_CHANGED' || error==='ROLE_OCCUPANT_REQUIRED';
 const dynamicRole = isTask && !!roster && roster.checked.length===roster.roster.people.filter(person=>person.assignable).length;
 const directCount = roster?.checked.length ?? 0;
 const roleProblem = isTask && roster && !dynamicRole && directCount===0 ? 'rolePick' :
  isTask && !dynamicRole && taskProject?.assignmentMode==='SINGLE' && directCount>1 ? 'roleSingle' :
  (!dynamicRole && directCount>(isTask?100:199)) ? 'roleTooMany' : '';
 const roleBlocked = roleChosen && (!roster || roleChanged || !!roleProblem);
 const linkError = personalTaskConflict ? 'PERSONAL_TASK_PRIVATE' : assignmentDenied ? 'ASSIGNMENT_DENIED' : workLinkErrors.includes(error) ? error : '';
 const linkHint = linkError ? t(linkError==='ASSIGNMENT_LIMIT'?'roleSingle':linkError) : isProject && workLink ? t('linkAccess') : '';
 const refreshRole = () => {setError('');setRoleRetry(n=>n+1);};
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(busy||!available.includes(kind)||current.status!=='ready'||isProject&&!responsibleValid||personalTaskConflict||assignmentDenied||roleBlocked)return;
  const form=new FormData(e.currentTarget),title=String(form.get('title')??'').trim();
  if(opensEditor){onProposal(agendaContext?.id ?? (String(form.get('agendaId')??'')||null),proposalType);return;}
  if(!title)return;
  if(kind==='POLICY'&&(!richContent||!toPlainText(richContent).trim())){setError('invalid');return;}
  const description=String(form.get('description')??'').trim();
  const body={title,kind,
   ...(agendaContext ? {agendaId:agendaContext.id} : form.get('agendaId') ? {agendaId:String(form.get('agendaId'))} : {}),
   ...(isTask ? {projectId:selection||null} : {}),
   ...(isProject ? {visibility:String(form.get('visibility')),...(description?{description}:{}),roleId:responsibleRole==='__person__'?null:responsibleRole,leadMemberId:responsibleLead||null} : {}),
   ...((isTask||isProject)&&workLink ? {workLink:{kind:linkKind,targetId,...(roster ? {selection:{snapshot:roster.roster.snapshot,people:dynamicRole?'ROLE':roster.checked}} : {})}} : {}),
   ...(kind==='GOAL'?{periodId:period||null}:{}),...(kind==='POLICY'?{richContent}: {}),
  };
  const signature=JSON.stringify([scope,meetingVersion,body]);
  const key=attempt?.signature===signature?attempt.key:crypto.randomUUID();
  setAttempt({signature,key});pending.current=true;setBusy(true);onBusy?.(true);setError('');
  try{
   await c.api(`/organizations/${c.organizationId}/meetings/${meetingId}/outcomes`,{method:'POST',body,version:meetingVersion,key});
   if(!mounted.current||liveScope.current!==scope)return;
   pending.current=false;onBusy?.(false);onCreated();
  }catch(e){
   if(!mounted.current||liveScope.current!==scope)return;
   const code=e instanceof RequestError?e.code:'';
   setError(workLinkErrors.includes(code)||['ROLE_OCCUPANTS_CHANGED','ROLE_OCCUPANT_REQUIRED'].includes(code)?code:code==='VERSION_CONFLICT'?'conflict':['GOAL_PERIOD_SELECTION_REQUIRED','DOMAIN_INVARIANT','INVALID_REQUEST'].includes(code)?'invalid':'error');
  }finally{if(mounted.current&&liveScope.current===scope){pending.current=false;setBusy(false);onBusy?.(false);}}
 }
 if(!available.length)return <Notice>{t('unavailable')}</Notice>;
 return <form key={scope} className="edit-form meeting-outcome-form" onSubmit={e=>void submit(e)}>
  <Field name="kind" label={t('kind')}><select name="kind" value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}>{available.map(k=><option key={k} value={k}>{outcomeLabel(k)}</option>)}</select></Field>
  {!opensEditor&&<Field name="title" label={t('title')}><input name="title" required disabled={busy}/></Field>}
  {!agendaContext&&agenda.length>0&&<Field name="agendaId" label="Agenda"><select name="agendaId" disabled={busy}><option value="">—</option>{agenda.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></Field>}
  {current.status==='loading'&&<p role="status">{t('loading')}</p>}
  {current.status==='error'&&<Notice>{t('error')} <button type="button" onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></Notice>}
  {isTask&&<Field name="projectId" label={t('project')}><select name="projectId" value={selection} disabled={busy||current.status!=='ready'} onChange={e=>{setSelection(e.target.value);setRoleState(undefined);setError('');}}><option value="">{t('personal')}</option>{current.projects.map(p=><option key={p.id} value={p.id}>{p.title} · {t(p.visibility==='PRIVATE'?'private':'public')}</option>)}</select></Field>}
  {kind==='GOAL'&&<Field name="periodId" label={t('period')}><select value={period} disabled={busy||current.status!=='ready'} onChange={e=>setPeriod(e.target.value)}><option value="">{t('choose')}</option>{current.periods.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>}
  {isProject&&<Field name="visibility" label={t('visibility')}><select name="visibility" disabled={busy}><option value="PRIVATE">{t('private')}</option><option value="PUBLIC">{t('public')}</option></select></Field>}
  {isProject&&<Field name="description" label={t('description')}><textarea name="description" disabled={busy}/></Field>}
  {isProject&&<>
   <Field name="responsible" label={t('responsible')}><select name="responsible" value={responsibleRole} required disabled={busy} onChange={e=>{setResponsibleRole(e.target.value);setResponsibleLead('');setError('');}}>
    <option value="">{t('choose')}</option>
    {circleRoles.map(role=><option key={role.entityId} value={role.entityId}>{roleChoiceLabel(role,nodes,t('hiddenCircle'))}</option>)}
    <option value="__person__">{t('direct')}</option>
   </select></Field>
   {responsibleRole&&<Field name="leadMemberId" label={t('person')}><select name="leadMemberId" value={responsibleLead} required={responsibleRole==='__person__'} disabled={busy} onChange={e=>{setResponsibleLead(e.target.value);setError('');}}>
    <option value="">{t(responsibleRole==='__person__'?'choose':'anyone')}</option>
    {(responsibleRole==='__person__'?circlePeople:roleOccupants).map(member=><option key={member.id} value={member.id}>{member.displayName}</option>)}
   </select></Field>}
  </>}
  {(isTask||isProject)&&<>
   <Field name="workLink" label={t(isTask?'assignee':'link')}>
    <select name="workLink" value={workLink} disabled={busy||current.status!=='ready'} aria-describedby={linkHint?'meeting-outcome-work-link-help':undefined} onChange={e=>{setWorkLink(e.target.value);setRoleState(undefined);setError('');}}>
     <option value="">{isTask?workText('Sem responsável'):t('noLink')}</option>
     <optgroup label={workText('Pessoas')}>
      {c.members?.filter(member=>member.status==='ACTIVE'&&member.memberType!=='GUEST').map(member=><option key={member.id} value={'MEMBER:'+member.id}>{member.displayName}</option>)}
     </optgroup>
     <optgroup label={workText('Papéis')}>
      {c.structure?.nodes.filter(node=>node.kind==='ROLE').map(role=><option key={role.entityId} value={'ROLE:'+role.entityId}>{roleChoiceLabel(role,c.structure.nodes,t('hiddenCircle'))}</option>)}
     </optgroup>
    </select>
   </Field>
   {linkHint&&<small id="meeting-outcome-work-link-help" className="muted" role={linkError?'status':undefined}>{linkHint}</small>}
   {roleChosen&&!assignmentDenied&&<fieldset className="meeting-role-occupants" disabled={busy}>
    <legend>{t('roleOccupants')}</legend>
    {roleChanged||roleFailed ? <p role="status">{t(roleChanged?'roleChanged':'roleUnavailable')} <button type="button" onClick={refreshRole}>{t('roleRefresh')}</button></p> :
     !roster ? <p role="status">{t('roleLoading')}</p> : <>
      {roster.roster.people.length ? <div className="meeting-role-occupant-list">{roster.roster.people.map(person=><label key={person.id}>
       <input type="checkbox" checked={roster.checked.includes(person.id)} disabled={!person.assignable} onChange={e=>{
        const checked=e.target.checked;
        setRoleState({...roster,checked:checked?[...roster.checked,person.id]:roster.checked.filter(id=>id!==person.id)});
        setError('');
       }}/>
       <span>{person.name}{!person.assignable&&<small>{t('roleNoAccess')}</small>}</span>
      </label>)}</div> : <p role="status">{t('roleVacant')}</p>}
      <p className="muted" role="status">{t(roleProblem || (isProject?'roleProject':dynamicRole?'roleDynamic':'roleDirect'))}</p>
     </>}
   </fieldset>}
  </>}
  {kind==='POLICY'&&<><p>{t('notice')}</p><RichTextEditor maxLength={10000} label={t('content')} value={richContent??''} onChange={setRichContent} required readOnly={busy} pending={busy}/></>}
  {error&&!roleChanged&&!workLinkErrors.includes(error)&&<Notice>{t(error)} <button type="button" onClick={onReload}>{t('reload')}</button></Notice>}
  <button type="submit" disabled={busy||current.status!=='ready'||isProject&&!responsibleValid||personalTaskConflict||assignmentDenied||roleBlocked||kind==='GOAL'&&!period&&current.periods.length!==1}>{t(opensEditor?'editor':'create')}</button>
 </form>;
}

export function MeetingOutcomeForm(props:Parameters<typeof OutcomeForm>[0]){return <FeatureRoleMentions context={props.context}><OutcomeForm {...props}/></FeatureRoleMentions>;}

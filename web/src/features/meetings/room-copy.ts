import { resolveLocale, type Locale } from '../../../../packages/i18n/index.js';

/** Copy owned by the common Maré room. Column order follows SUPPORTED_LOCALES. */
const localeColumn: Record<Locale, number> = {
  'pt-BR': 0, 'en-US': 1, 'es-ES': 2, 'fr-FR': 3,
  'de-DE': 4, 'it-IT': 5, 'ja-JP': 6, 'nl-NL': 7,
};
type Row = readonly [string, string, string, string, string, string, string, string];
const copy = {
  peopleAndRoles: ['Pessoas e funções do encontro', 'Meeting people and roles', 'Personas y funciones de la reunión', 'Personnes et rôles de la réunion', 'Personen und Rollen des Treffens', 'Persone e ruoli della riunione', '会議の参加者と役割', 'Deelnemers en rollen van de vergadering'],
  end: ['Encerrar', 'End', 'Finalizar', 'Terminer', 'Beenden', 'Termina', '終了する', 'Beëindigen'],
  moreMeetingOptions: ['Mais opções do encontro', 'More meeting options', 'Más opciones de la reunión', 'Autres options de la réunion', 'Weitere Besprechungsoptionen', 'Altre opzioni della riunione', '会議のその他のオプション', 'Meer vergaderopties'],
  manageParticipants: ['Gerenciar participantes', 'Manage participants', 'Gestionar participantes', 'Gérer les participants', 'Teilnehmende verwalten', 'Gestisci partecipanti', '参加者を管理', 'Deelnemers beheren'],
  setSecretary: ['Definir secretaria', 'Assign note taker', 'Asignar responsable del acta', 'Désigner le secrétaire', 'Protokollführung festlegen', 'Assegna verbalizzante', '記録担当を指定', 'Notulist aanwijzen'],
  setFacilitator: ['Definir facilitação', 'Assign facilitator', 'Asignar facilitación', 'Désigner la facilitation', 'Moderation festlegen', 'Assegna facilitatore', 'ファシリテーターを指定', 'Facilitator aanwijzen'],
  meetingAgenda: ['Pauta da reunião', 'Meeting agenda', 'Orden del día de la reunión', 'Ordre du jour de la réunion', 'Tagesordnung der Besprechung', 'Ordine del giorno della riunione', '会議の議題', 'Vergaderagenda'],
  addAgendaItemLabel: ['Adicionar assunto à reunião', 'Add a topic to the meeting', 'Añadir un tema a la reunión', 'Ajouter un sujet à la réunion', 'Thema zur Besprechung hinzufügen', 'Aggiungi un argomento alla riunione', '会議に議題を追加', 'Onderwerp aan vergadering toevoegen'],
  agenda: ['Pauta', 'Agenda', 'Orden del día', 'Ordre du jour', 'Tagesordnung', 'Ordine del giorno', '議題', 'Agenda'],
  skipped: ['Pulado nesta sessão', 'Skipped in this session', 'Omitido en esta sesión', 'Passé lors de cette séance', 'In dieser Sitzung übersprungen', 'Saltato in questa sessione', 'このセッションではスキップ', 'In deze sessie overgeslagen'],
  attendanceConfirmed: ['Presença confirmada', 'Attendance confirmed', 'Asistencia confirmada', 'Présence confirmée', 'Teilnahme bestätigt', 'Presenza confermata', '出席確認済み', 'Aanwezigheid bevestigd'],
  readOnly: ['Somente leitura', 'Read only', 'Solo lectura', 'Lecture seule', 'Nur lesen', 'Sola lettura', '閲覧のみ', 'Alleen lezen'],
  minutesAccess: ['A leitura respeita as permissões da reunião e da ata.', 'Reading follows the meeting and minutes permissions.', 'La lectura respeta los permisos de la reunión y del acta.', 'La lecture respecte les autorisations de la réunion et du compte rendu.', 'Der Zugriff richtet sich nach den Berechtigungen für Treffen und Protokoll.', 'La lettura rispetta le autorizzazioni della riunione e del verbale.', '閲覧には会議と議事録のアクセス権が適用されます。', 'Lezen volgt de rechten voor de vergadering en het verslag.'],
  prepareMeeting: ['Vamos preparar o encontro?', 'Ready to prepare the meeting?', '¿Preparamos la reunión?', 'Prêts à préparer la réunion ?', 'Bereit, die Besprechung vorzubereiten?', 'Prepariamo la riunione?', '会議の準備を始めますか？', 'Klaar om de vergadering voor te bereiden?'],
  agendaReady: ['A pauta está disponível para o círculo. Ao iniciar, os passos de condução ficam ativos.', 'The agenda is available to the circle. Facilitation steps become active when the meeting starts.', 'El orden del día está disponible para el círculo. Los pasos de facilitación se activan al iniciar la reunión.', 'L’ordre du jour est disponible pour le cercle. Les étapes de facilitation s’activent au début de la réunion.', 'Die Tagesordnung ist für den Kreis verfügbar. Die Moderationsschritte werden beim Start aktiv.', 'L’ordine del giorno è disponibile per il cerchio. I passaggi di facilitazione si attivano all’avvio.', '議題はサークルに公開されています。会議を開始すると進行のステップが有効になります。', 'De agenda is beschikbaar voor de cirkel. De begeleidingsstappen worden actief zodra de vergadering begint.'],
  question: ['O que você precisa do círculo para seguir?', 'What do you need from the circle to move forward?', '¿Qué necesitas del círculo para avanzar?', 'De quoi avez-vous besoin de la part du cercle pour avancer ?', 'Was brauchen Sie vom Kreis, um weiterzukommen?', 'Di cosa hai bisogno dal cerchio per andare avanti?', '進めるためにサークルから何が必要ですか？', 'Wat heb je van de cirkel nodig om verder te gaan?'],
  outcomes: ['Encaminhamentos', 'Next steps', 'Próximos pasos', 'Suites à donner', 'Nächste Schritte', 'Prossimi passi', '次のアクション', 'Vervolgstappen'],
  record: ['Registrar', 'Record', 'Registrar', 'Consigner', 'Erfassen', 'Registra', '記録', 'Vastleggen'],
  view: ['Consultar', 'View', 'Consultar', 'Consulter', 'Ansehen', 'Visualizza', '表示', 'Bekijken'],
  noOutcome: ['Nenhum próximo passo registrado para este assunto.', 'No next steps recorded for this topic.', 'No hay próximos pasos registrados para este tema.', 'Aucune suite à donner enregistrée pour ce sujet.', 'Für dieses Thema wurden keine nächsten Schritte erfasst.', 'Nessun prossimo passo registrato per questo argomento.', 'この議題には次のアクションが記録されていません。', 'Voor dit onderwerp zijn geen vervolgstappen vastgelegd.'],
  moreOptions: ['Mais opções', 'More options', 'Más opciones', 'Autres options', 'Weitere Optionen', 'Altre opzioni', 'その他のオプション', 'Meer opties'],
  completeTopic: ['Concluir tratamento', 'Complete topic', 'Completar tema', 'Terminer le traitement', 'Thema abschließen', 'Completa argomento', '議題を完了', 'Onderwerp afronden'],
  agendaOpen: ['A pauta está aberta', 'The agenda is open', 'El orden del día está abierto', 'L’ordre du jour est ouvert', 'Die Tagesordnung ist offen', 'L’ordine del giorno è aperto', '議題を追加できます', 'De agenda is open'],
  addFirstTopic: ['Adicione um assunto para começar.', 'Add a topic to get started.', 'Añade un tema para empezar.', 'Ajoutez un sujet pour commencer.', 'Fügen Sie zum Start ein Thema hinzu.', 'Aggiungi un argomento per iniziare.', 'まず議題を追加してください。', 'Voeg een onderwerp toe om te beginnen.'],
  addTopic: ['Adicionar assunto', 'Add topic', 'Añadir tema', 'Ajouter un sujet', 'Thema hinzufügen', 'Aggiungi argomento', '議題を追加', 'Onderwerp toevoegen'],
  checkinTitle: ['Como você chega hoje?', 'How are you arriving today?', '¿Cómo llegas hoy?', 'Comment arrivez-vous aujourd’hui ?', 'Wie kommen Sie heute an?', 'Come arrivi oggi?', '今日はどんな気持ちで参加していますか？', 'Hoe kom je vandaag binnen?'],
  checkoutTitle: ['Como você sai deste encontro?', 'How are you leaving this meeting?', '¿Cómo sales de esta reunión?', 'Comment quittez-vous cette réunion ?', 'Wie gehen Sie aus diesem Treffen?', 'Come esci da questa riunione?', 'この会議を終えてどう感じますか？', 'Hoe verlaat je deze vergadering?'],
  checkinHelp: ['Uma rodada breve para chegar, escutar e estar presente.', 'A brief round to arrive, listen and be present.', 'Una ronda breve para llegar, escuchar y estar presente.', 'Un bref tour pour prendre place, écouter et être présent.', 'Eine kurze Runde, um anzukommen, zuzuhören und präsent zu sein.', 'Un breve giro per arrivare, ascoltare ed essere presenti.', '落ち着いて耳を傾け、参加するための短いラウンドです。', 'Een korte ronde om aan te komen, te luisteren en aanwezig te zijn.'],
  checkoutHelp: ['Compartilhe o que ficou e o que pode melhorar.', 'Share what stayed with you and what could improve.', 'Comparte lo que te llevas y lo que se puede mejorar.', 'Partagez ce que vous retenez et ce qui pourrait être amélioré.', 'Teilen Sie, was bleibt und was besser werden könnte.', 'Condividi ciò che resta e cosa può migliorare.', '印象に残ったことや改善できることを共有してください。', 'Deel wat je bijblijft en wat beter kan.'],
  updateHelp: ['Compartilhe atualizações e identifique o que precisa da atenção do círculo.', 'Share updates and identify what needs the circle’s attention.', 'Comparte novedades e identifica lo que necesita la atención del círculo.', 'Partagez les nouvelles et identifiez ce qui nécessite l’attention du cercle.', 'Teilen Sie Neuigkeiten und benennen Sie, was die Aufmerksamkeit des Kreises braucht.', 'Condividi aggiornamenti e individua ciò che richiede l’attenzione del cerchio.', '近況を共有し、サークルで扱う必要があることを確認します。', 'Deel updates en benoem wat aandacht van de cirkel vraagt.'],
  conversationHelp: ['A rodada acontece em conversa. Não é preciso registrar uma resposta de cada pessoa.', 'This round takes place in conversation. You do not need to record each person’s answer.', 'Esta ronda se hace conversando. No hace falta registrar la respuesta de cada persona.', 'Ce tour se déroule à l’oral. Il n’est pas nécessaire de consigner la réponse de chacun.', 'Diese Runde findet im Gespräch statt. Antworten müssen nicht einzeln erfasst werden.', 'Questo giro si svolge a voce. Non occorre registrare la risposta di ogni persona.', 'このラウンドは会話で行います。一人ずつ回答を記録する必要はありません。', 'Deze ronde verloopt als gesprek. Je hoeft niet ieders antwoord vast te leggen.'],
  goToStep: ['Ir para {section}', 'Go to {section}', 'Ir a {section}', 'Aller à {section}', 'Zu {section} wechseln', 'Vai a {section}', '{section}に進む', 'Ga naar {section}'],
  completeMeeting: ['Concluir encontro', 'Complete meeting', 'Concluir reunión', 'Terminer la réunion', 'Treffen abschließen', 'Concludi riunione', '会議を完了', 'Vergadering afronden'],
  meetingOutcomes: ['Encaminhamentos do encontro', 'Meeting next steps', 'Próximos pasos de la reunión', 'Suites à donner de la réunion', 'Nächste Schritte des Treffens', 'Prossimi passi della riunione', '会議の次のアクション', 'Vervolgstappen van de vergadering'],
  meetingNotes: ['Notas do encontro', 'Meeting notes', 'Notas de la reunión', 'Notes de la réunion', 'Besprechungsnotizen', 'Note della riunione', '会議のメモ', 'Vergadernotities'],
  peopleRoles: ['Pessoas e funções', 'People and roles', 'Personas y funciones', 'Personnes et rôles', 'Personen und Rollen', 'Persone e ruoli', '参加者と役割', 'Deelnemers en rollen'],
  facilitator: ['Facilitação', 'Facilitator', 'Facilitación', 'Facilitation', 'Moderation', 'Facilitazione', 'ファシリテーション', 'Facilitatie'],
  unset: ['Não definida', 'Not assigned', 'Sin asignar', 'Non désigné', 'Nicht festgelegt', 'Non assegnato', '未設定', 'Niet toegewezen'],
  backToMeeting: ['Voltar ao encontro', 'Back to meeting', 'Volver a la reunión', 'Retour à la réunion', 'Zurück zum Treffen', 'Torna alla riunione', '会議に戻る', 'Terug naar vergadering'],
  optionalContext: ['Contexto (opcional)', 'Context (optional)', 'Contexto (opcional)', 'Contexte (facultatif)', 'Kontext (optional)', 'Contesto (facoltativo)', '背景（任意）', 'Context (optioneel)'],
  context: ['Contexto', 'Context', 'Contexto', 'Contexte', 'Kontext', 'Contesto', '背景', 'Context'],
} as const satisfies Record<string, Row>;

export type RoomCopyKey = keyof typeof copy;
export function roomText(locale: string, key: RoomCopyKey, params: Record<string, string | number> = {}): string {
  return copy[key][localeColumn[resolveLocale(locale)]].replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (token, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : token);
}

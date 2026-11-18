import { createMessageTranslator, SUPPORTED_LOCALES, type Locale } from '../../packages/i18n/index.js';

const rows = {
  notifications: ['Notificações','Notifications','Notificaciones','Notifications','Benachrichtigungen','Notifiche','通知','Meldingen'],
  unreadBellOne: ['Notificações · 1 não lida','Notifications · 1 unread','Notificaciones · 1 sin leer','Notifications · 1 non lue','Benachrichtigungen · 1 ungelesen','Notifiche · 1 da leggere','通知 · 未読 1 件','Meldingen · 1 ongelezen'],
  unreadBell: ['Notificações · {count} não lidas','Notifications · {count} unread','Notificaciones · {count} sin leer','Notifications · {count} non lues','Benachrichtigungen · {count} ungelesen','Notifiche · {count} da leggere','通知 · 未読 {count} 件','Meldingen · {count} ongelezen'],
  loadingUpdates: ['Buscando atualizações…','Checking for updates…','Buscando novedades…','Recherche des nouveautés…','Aktualisierungen werden geladen…','Ricerca aggiornamenti…','更新を確認中…','Updates ophalen…'],
  yourUpdates: ['Suas atualizações','Your updates','Tus novedades','Vos nouveautés','Ihre Aktualisierungen','I tuoi aggiornamenti','あなたへの更新','Jouw updates'],
  unreadOne: ['1 não lida','1 unread','1 sin leer','1 non lue','1 ungelesen','1 da leggere','未読 1 件','1 ongelezen'],
  unreadMany: ['{count} não lidas','{count} unread','{count} sin leer','{count} non lues','{count} ungelesen','{count} da leggere','未読 {count} 件','{count} ongelezen'],
  allCaughtUp: ['Você está em dia','You’re all caught up','Estás al día','Vous êtes à jour','Sie sind auf dem Laufenden','Sei in pari','すべて確認済みです','Je bent helemaal bij'],
  preferences: ['Preferências de notificações','Notification preferences','Preferencias de notificaciones','Préférences de notification','Benachrichtigungseinstellungen','Preferenze notifiche','通知設定','Meldingsvoorkeuren'],
  close: ['Fechar notificações','Close notifications','Cerrar notificaciones','Fermer les notifications','Benachrichtigungen schließen','Chiudi notifiche','通知を閉じる','Meldingen sluiten'],
  filter: ['Filtrar notificações','Filter notifications','Filtrar notificaciones','Filtrer les notifications','Benachrichtigungen filtern','Filtra notifiche','通知を絞り込む','Meldingen filteren'],
  all: ['Todas','All','Todas','Toutes','Alle','Tutte','すべて','Alle'],
  unread: ['Não lidas','Unread','Sin leer','Non lues','Ungelesen','Da leggere','未読','Ongelezen'],
  refresh: ['Atualizar notificações','Refresh notifications','Actualizar notificaciones','Actualiser les notifications','Benachrichtigungen aktualisieren','Aggiorna notifiche','通知を更新','Meldingen vernieuwen'],
  retry: ['Tentar novamente','Try again','Volver a intentar','Réessayer','Erneut versuchen','Riprova','再試行','Opnieuw proberen'],
  loading: ['Carregando notificações…','Loading notifications…','Cargando notificaciones…','Chargement des notifications…','Benachrichtigungen werden geladen…','Caricamento notifiche…','通知を読み込み中…','Meldingen laden…'],
  allRead: ['Tudo lido','All read','Todo leído','Tout est lu','Alles gelesen','Tutto letto','すべて既読です','Alles gelezen'],
  noneHere: ['Nenhuma notificação por aqui','No notifications here','No hay notificaciones','Aucune notification ici','Hier sind keine Benachrichtigungen','Nessuna notifica','通知はありません','Hier zijn geen meldingen'],
  allReadDescription: ['Você já conferiu as notificações deste recorte.','You’ve checked every notification in this view.','Ya revisaste todas las notificaciones de esta vista.','Vous avez consulté toutes les notifications de cette vue.','Sie haben alle Benachrichtigungen in dieser Ansicht geprüft.','Hai controllato tutte le notifiche in questa vista.','この表示の通知はすべて確認済みです。','Je hebt alle meldingen in deze weergave bekeken.'],
  noneHereDescription: ['As novidades dos seus trabalhos e decisões aparecem aqui.','Updates about your work and decisions appear here.','Aquí aparecen las novedades sobre tu trabajo y tus decisiones.','Les nouvelles concernant votre travail et vos décisions apparaissent ici.','Neuigkeiten zu Ihrer Arbeit und Ihren Entscheidungen erscheinen hier.','Qui trovi gli aggiornamenti sul tuo lavoro e sulle decisioni.','仕事や意思決定に関する更新がここに表示されます。','Updates over je werk en besluiten verschijnen hier.'],
  markRead: ['Marcar como lida','Mark as read','Marcar como leída','Marquer comme lue','Als gelesen markieren','Segna come letta','既読にする','Markeren als gelezen'],
  markReadItem: ['Marcar como lida: {title}','Mark as read: {title}','Marcar como leída: {title}','Marquer comme lue : {title}','Als gelesen markieren: {title}','Segna come letta: {title}','既読にする：{title}','Markeren als gelezen: {title}'],
  viewAll: ['Ver todas as notificações','View all notifications','Ver todas las notificaciones','Voir toutes les notifications','Alle Benachrichtigungen anzeigen','Vedi tutte le notifiche','すべての通知を見る','Alle meldingen bekijken'],
  eventComment: ['Novo comentário','New comment','Nuevo comentario','Nouveau commentaire','Neuer Kommentar','Nuovo commento','新しいコメント','Nieuwe reactie'],
  eventTaskAssigned: ['Tarefa atribuída a você','Task assigned to you','Tarea asignada','Tâche qui vous est attribuée','Ihnen zugewiesene Aufgabe','Attività assegnata a te','タスクが割り当てられました','Taak aan jou toegewezen'],
  eventTaskUpdated: ['Tarefa atualizada','Task updated','Tarea actualizada','Tâche mise à jour','Aufgabe aktualisiert','Attività aggiornata','タスクが更新されました','Taak bijgewerkt'],
  eventMeetingScheduled: ['Reunião agendada','Meeting scheduled','Reunión programada','Réunion planifiée','Besprechung geplant','Riunione programmata','会議が予定されました','Vergadering gepland'],
  eventMention: ['Você foi mencionado','You were mentioned','Te mencionaron','Vous avez été mentionné','Sie wurden erwähnt','Sei stato menzionato','あなたへのメンション','Je bent genoemd'],
  eventUpdateIn: ['Atualização em {resource}','Update in {resource}','Actualización en {resource}','Mise à jour dans {resource}','Aktualisierung in {resource}','Aggiornamento in {resource}','{resource}の更新','Update in {resource}'],
} as const satisfies Record<string, readonly [string,string,string,string,string,string,string,string]>;

export type NotificationMessage = keyof typeof rows;
export const notificationMessages = Object.fromEntries(SUPPORTED_LOCALES.map((locale,index) => [
  locale, Object.fromEntries(Object.entries(rows).map(([key,values]) => [key,values[index]])),
])) as Record<Locale,Record<NotificationMessage,string>>;
export const notificationTranslator = (locale:string) => createMessageTranslator(locale,notificationMessages);

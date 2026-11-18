import { createMessageTranslator, type Locale } from "../../localization";

const keys = [
  "organization", "intro", "emails", "emailHelp", "languageHelp", "optionalMessage", "personalMessage",
  "messageCount", "send", "sending", "advanced", "results", "queueHelp", "processed", "required",
  "tooMany", "messageTooLong", "denied", "unavailable", "failed", "navigationBusy",
  "QUEUED", "EXISTING_PENDING", "ALREADY_MEMBER", "DUPLICATE_IN_BATCH", "INVALID", "DENIED", "CONFLICT", "UNKNOWN",
] as const;
export type InvitationComposerMessage = (typeof keys)[number];
const catalog = (values: string[]) => Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<InvitationComposerMessage, string>;
export const invitationComposerMessages: Record<Locale, Record<InvitationComposerMessage, string>> = {
  "pt-BR": catalog([
    "esta organização", "Convide pessoas para {organization}.", "E-mails", "Cole um ou vários e-mails, separados por vírgula, espaço ou quebra de linha.", "Os convites são enviados no idioma da organização.", "Adicionar mensagem pessoal", "Mensagem pessoal opcional",
    "{count} de 2.000 caracteres", "Enviar convite", "Enviando convite…", "Acesso limitado e opções avançadas", "Resultado dos convites", "Na fila de envio ainda não significa e-mail entregue ou convite aceito.", "Convites processados.", "Informe pelo menos um e-mail.",
    "Envie até 100 e-mails por vez.", "A mensagem pode ter até 2.000 caracteres.", "Sua permissão para convidar mudou. Atualize a organização antes de tentar novamente.", "O serviço de convites está indisponível. Tente novamente em instantes.", "Não foi possível confirmar o envio. Tente novamente; sua solicitação será retomada sem duplicar convites.", "Há um envio de convites em andamento. Aguarde antes de sair.",
    "Na fila de envio", "Já existe um convite pendente; nenhum novo e-mail foi enviado", "Já participa da organização", "E-mail repetido nesta lista", "Revise este e-mail", "Convite não autorizado", "Há uma pendência diferente; revise o convite existente", "Não foi possível processar este e-mail",
  ]),
  "en-US": catalog([
    "this organization", "Invite people to {organization}.", "Email addresses", "Paste one or more email addresses, separated by commas, spaces or line breaks.", "Invitations are sent in the organization's language.", "Add a personal message", "Personal message (optional)",
    "{count} of 2,000 characters", "Send invitation", "Sending invitation…", "Limited access and advanced options", "Invitation results", "Queued does not yet mean the email was delivered or the invitation accepted.", "Invitations processed.", "Enter at least one email address.",
    "Send up to 100 email addresses at a time.", "The message can contain up to 2,000 characters.", "Your invitation permission has changed. Refresh the organization before trying again.", "The invitation service is unavailable. Try again shortly.", "We could not confirm submission. Try again; your request will resume without duplicating invitations.", "Invitations are being submitted. Wait before leaving.",
    "Queued for sending", "An invitation is already pending; no new email was sent", "Already a member of the organization", "Repeated email address in this list", "Check this email address", "Invitation not permitted", "A different invitation is pending; review the existing invitation", "Could not process this email address",
  ]),
  "es-ES": catalog([
    "esta organización", "Invita a personas a {organization}.", "Correos electrónicos", "Pega uno o varios correos, separados por comas, espacios o saltos de línea.", "Las invitaciones se envían en el idioma de la organización.", "Añadir un mensaje personal", "Mensaje personal opcional",
    "{count} de 2.000 caracteres", "Enviar invitación", "Enviando invitación…", "Acceso limitado y opciones avanzadas", "Resultado de las invitaciones", "Estar en cola todavía no significa que el correo se haya entregado o la invitación aceptado.", "Invitaciones procesadas.", "Introduce al menos un correo electrónico.",
    "Envía hasta 100 correos a la vez.", "El mensaje puede tener hasta 2.000 caracteres.", "Tu permiso para invitar ha cambiado. Actualiza la organización antes de intentarlo de nuevo.", "El servicio de invitaciones no está disponible. Inténtalo en unos instantes.", "No se pudo confirmar el envío. Inténtalo de nuevo; la solicitud se retomará sin duplicar invitaciones.", "Se están enviando invitaciones. Espera antes de salir.",
    "En cola de envío", "Ya existe una invitación pendiente; no se envió otro correo", "Ya pertenece a la organización", "Correo repetido en esta lista", "Revisa este correo", "Invitación no autorizada", "Hay una invitación diferente pendiente; revisa la existente", "No se pudo procesar este correo",
  ]),
  "fr-FR": catalog([
    "cette organisation", "Invitez des personnes à rejoindre {organization}.", "Adresses e-mail", "Collez une ou plusieurs adresses, séparées par des virgules, des espaces ou des retours à la ligne.", "Les invitations sont envoyées dans la langue de l'organisation.", "Ajouter un message personnel", "Message personnel facultatif",
    "{count} caractères sur 2 000", "Envoyer l'invitation", "Envoi de l'invitation…", "Accès limité et options avancées", "Résultat des invitations", "La mise en file ne confirme pas encore la livraison de l'e-mail ni l'acceptation de l'invitation.", "Invitations traitées.", "Saisissez au moins une adresse e-mail.",
    "Envoyez jusqu'à 100 adresses à la fois.", "Le message peut contenir jusqu'à 2 000 caractères.", "Votre autorisation d'inviter a changé. Actualisez l'organisation avant de réessayer.", "Le service d'invitation est indisponible. Réessayez dans un instant.", "L'envoi n'a pas pu être confirmé. Réessayez : la demande reprendra sans dupliquer les invitations.", "Des invitations sont en cours d'envoi. Patientez avant de quitter.",
    "En attente d'envoi", "Une invitation est déjà en attente ; aucun nouvel e-mail n'a été envoyé", "Fait déjà partie de l'organisation", "Adresse répétée dans cette liste", "Vérifiez cette adresse", "Invitation non autorisée", "Une autre invitation est en attente ; vérifiez l'invitation existante", "Impossible de traiter cette adresse",
  ]),
  "de-DE": catalog([
    "diese Organisation", "Laden Sie Personen zu {organization} ein.", "E-Mail-Adressen", "Fügen Sie eine oder mehrere Adressen ein, getrennt durch Kommas, Leerzeichen oder Zeilenumbrüche.", "Einladungen werden in der Sprache der Organisation gesendet.", "Persönliche Nachricht hinzufügen", "Persönliche Nachricht (optional)",
    "{count} von 2.000 Zeichen", "Einladung senden", "Einladung wird gesendet…", "Eingeschränkter Zugriff und erweiterte Optionen", "Ergebnis der Einladungen", "In der Warteschlange bedeutet noch nicht, dass die E-Mail zugestellt oder die Einladung angenommen wurde.", "Einladungen verarbeitet.", "Geben Sie mindestens eine E-Mail-Adresse ein.",
    "Senden Sie bis zu 100 Adressen gleichzeitig.", "Die Nachricht darf bis zu 2.000 Zeichen enthalten.", "Ihre Einladungsberechtigung hat sich geändert. Aktualisieren Sie die Organisation und versuchen Sie es erneut.", "Der Einladungsdienst ist nicht verfügbar. Versuchen Sie es gleich erneut.", "Der Versand konnte nicht bestätigt werden. Versuchen Sie es erneut; die Anfrage wird ohne doppelte Einladungen fortgesetzt.", "Einladungen werden gesendet. Warten Sie, bevor Sie die Seite verlassen.",
    "Zum Versand vorgemerkt", "Eine Einladung ist bereits offen; es wurde keine neue E-Mail gesendet", "Bereits Mitglied der Organisation", "Wiederholte Adresse in dieser Liste", "Prüfen Sie diese Adresse", "Einladung nicht erlaubt", "Eine andere Einladung ist offen; prüfen Sie die vorhandene Einladung", "Diese Adresse konnte nicht verarbeitet werden",
  ]),
  "it-IT": catalog([
    "questa organizzazione", "Invita persone in {organization}.", "Indirizzi e-mail", "Incolla uno o più indirizzi, separati da virgole, spazi o interruzioni di riga.", "Gli inviti vengono inviati nella lingua dell'organizzazione.", "Aggiungi un messaggio personale", "Messaggio personale facoltativo",
    "{count} di 2.000 caratteri", "Invia invito", "Invio dell'invito…", "Accesso limitato e opzioni avanzate", "Risultato degli inviti", "In coda non significa ancora che l'e-mail sia stata consegnata o l'invito accettato.", "Inviti elaborati.", "Inserisci almeno un indirizzo e-mail.",
    "Invia fino a 100 indirizzi alla volta.", "Il messaggio può contenere fino a 2.000 caratteri.", "Il tuo permesso di invitare è cambiato. Aggiorna l'organizzazione prima di riprovare.", "Il servizio inviti non è disponibile. Riprova tra poco.", "Non è stato possibile confermare l'invio. Riprova: la richiesta riprenderà senza duplicare gli inviti.", "Invio degli inviti in corso. Attendi prima di uscire.",
    "In coda per l'invio", "Esiste già un invito in sospeso; non è stata inviata una nuova e-mail", "Fa già parte dell'organizzazione", "Indirizzo ripetuto in questo elenco", "Controlla questo indirizzo", "Invito non autorizzato", "C'è un invito diverso in sospeso; controlla quello esistente", "Impossibile elaborare questo indirizzo",
  ]),
  "ja-JP": catalog([
    "この組織", "{organization} にメンバーを招待します。", "メールアドレス", "メールアドレスを入力または貼り付けてください。複数の場合はカンマ、空白、改行で区切ります。", "招待メールは組織で設定された言語で送信されます。", "個別メッセージを追加", "個別メッセージ（任意）",
    "{count} / 2,000 文字", "招待を送信", "招待を送信中…", "限定アクセスと詳細設定", "招待の処理結果", "送信待ちの状態では、メールの配信や招待の承諾はまだ確認されていません。", "招待を処理しました。", "メールアドレスを1件以上入力してください。",
    "一度に送信できるのは100件までです。", "メッセージは2,000文字以内で入力してください。", "招待権限が変更されました。組織を再読み込みしてからお試しください。", "招待サービスを利用できません。しばらくしてからお試しください。", "送信を確認できませんでした。もう一度お試しください。招待を重複させずに処理を再開します。", "招待を送信中です。完了するまでお待ちください。",
    "送信待ち", "保留中の招待が既にあります。新しいメールは送信されていません", "既に組織に参加しています", "リスト内で重複したアドレス", "このアドレスを確認してください", "招待する権限がありません", "異なる招待が保留中です。既存の招待を確認してください", "このアドレスを処理できませんでした",
  ]),
  "nl-NL": catalog([
    "deze organisatie", "Nodig mensen uit voor {organization}.", "E-mailadressen", "Plak één of meer adressen, gescheiden door komma's, spaties of regeleinden.", "Uitnodigingen worden verzonden in de taal van de organisatie.", "Persoonlijk bericht toevoegen", "Persoonlijk bericht (optioneel)",
    "{count} van 2.000 tekens", "Uitnodiging verzenden", "Uitnodiging wordt verzonden…", "Beperkte toegang en geavanceerde opties", "Resultaat van de uitnodigingen", "In de wachtrij betekent nog niet dat de e-mail is bezorgd of de uitnodiging is geaccepteerd.", "Uitnodigingen verwerkt.", "Voer minstens één e-mailadres in.",
    "Verzend maximaal 100 adressen tegelijk.", "Het bericht mag maximaal 2.000 tekens bevatten.", "Je uitnodigingsrechten zijn gewijzigd. Vernieuw de organisatie voordat je het opnieuw probeert.", "De uitnodigingsdienst is niet beschikbaar. Probeer het zo opnieuw.", "De verzending kon niet worden bevestigd. Probeer het opnieuw; het verzoek wordt zonder dubbele uitnodigingen hervat.", "Uitnodigingen worden verzonden. Wacht voordat je de pagina verlaat.",
    "In de verzendwachtrij", "Er staat al een uitnodiging open; er is geen nieuwe e-mail verzonden", "Is al lid van de organisatie", "Herhaald adres in deze lijst", "Controleer dit adres", "Uitnodiging niet toegestaan", "Er staat een andere uitnodiging open; controleer de bestaande uitnodiging", "Dit adres kon niet worden verwerkt",
  ]),
};
export const invitationComposerTranslator = (locale: string) => createMessageTranslator(locale, invitationComposerMessages);

import { createMessageTranslator, type Locale } from "../localization";

const pt = {
  title: "Entrar na organização",
  namedTitle: "Entrar em {organization}",
  publicIntro:
    "Solicite a entrada com sua conta do OrgMap. A organização verificará se sua conta atende às regras de admissão.",
  linkIntro:
    "Use este convite para solicitar a entrada com sua conta do OrgMap.",
  email: "Conta: {email}",
  proofNote:
    "A entrada só será confirmada após a verificação do código enviado ao e-mail da sua conta.",
  start: "Solicitar código por e-mail",
  starting: "Solicitando código…",
  pendingTitle: "Confirme seu e-mail",
  pending:
    "Use o código recebido para esta solicitação. A entrega pode levar alguns instantes; confira também a pasta de spam.",
  code: "Código de verificação",
  codeHelp:
    "Cole o código completo do e-mail. Ele expira 30 minutos após a solicitação.",
  invalidInput: "Cole o código completo de 64 caracteres recebido por e-mail.",
  confirm: "Confirmar e entrar",
  confirming: "Confirmando entrada…",
  newCode: "Solicitar outro código",
  newCodeHelp:
    "Isso cria outra solicitação. Use o código recebido para a solicitação mais recente desta página.",
  resumeHelp:
    "Para solicitar outro código, abra novamente a entrada pública da organização ou o link de convite recebido.",
  retry: "Tentar novamente",
  cancel: "Cancelar",
  cancelled:
    "Solicitação encerrada nesta página. Os códigos foram removidos desta tela.",
  signIn: "Entrar na minha conta",
  auth: "Sua sessão terminou ou você ainda não entrou na conta. Entre e retome esta solicitação.",
  invalid:
    "O código ou a solicitação não está disponível. Confira o código recebido. O código pode ter expirado, ou o convite pode ter sido revogado. Se necessário, solicite outro código ou um novo convite à organização.",
  policy:
    "As regras de admissão mudaram. Solicite outro código para verificar as regras atuais.",
  conflict:
    "Esta solicitação já foi concluída ou conflita com o acesso atual. Retorne às suas organizações e confira seu acesso antes de iniciar outra solicitação.",
  suspended:
    "Seu acesso a esta organização está suspenso. Peça à organização para revisar seu acesso.",
  typeConflict:
    "Sua conta já possui um acesso de convidado. Peça à organização para revisar esse acesso; este convite não altera seu tipo de membro.",
  unavailable:
    "A admissão está temporariamente indisponível. Tente novamente mais tarde. Se continuar, avise a organização.",
  blocked:
    "A organização ou a entrada não está disponível para esta conta. Confira a conta utilizada ou peça um convite à organização.",
  rate: "Muitas tentativas. Aguarde antes de tentar novamente.",
  session:
    "Sua sessão precisa ser atualizada. Entre novamente na conta e retome a solicitação.",
  generic: "Não foi possível concluir a solicitação. Tente novamente.",
  missingLink:
    "Este convite não está mais disponível nesta página. Abra novamente o link recebido da organização.",
  joined: "Sua entrada foi confirmada.",
  existing: "Sua conta já faz parte desta organização.",
  open: "Abrir organização",
  openFailure:
    "Seu acesso foi confirmado, mas não foi possível abrir a organização. Tente abri-la novamente.",
};
type Key = keyof typeof pt;
const dictionaries: Record<Locale, Record<Key, string>> = {
  "pt-BR": pt,
  "en-US": {
    title: "Join organization",
    namedTitle: "Join {organization}",
    publicIntro:
      "Request to join with your OrgMap account. The organization will check whether your account meets its admission rules.",
    linkIntro:
      "Use this invitation to request to join with your OrgMap account.",
    email: "Account: {email}",
    proofNote:
      "Membership is only confirmed after you verify the code sent to your account email.",
    start: "Request email code",
    starting: "Requesting code…",
    pendingTitle: "Verify your email",
    pending:
      "Use the code for this request. Delivery may take a moment; check your spam folder too.",
    code: "Verification code",
    codeHelp:
      "Paste the full code from the email. It expires 30 minutes after the request.",
    invalidInput: "Paste the full 64-character code received by email.",
    confirm: "Verify and join",
    confirming: "Confirming membership…",
    newCode: "Request another code",
    newCodeHelp:
      "This creates another request. Use the code for the latest request on this page.",
    resumeHelp:
      "To request another code, reopen the organization’s public admission page or the invitation link you received.",
    retry: "Try again",
    cancel: "Cancel",
    cancelled:
      "This page has been closed for admission. Codes have been removed from the screen.",
    signIn: "Sign in to my account",
    auth: "Your session ended or you have not signed in. Sign in and resume this request.",
    invalid:
      "The code or request is unavailable. Check the code you received. It may have expired, or the invitation may have been revoked. If needed, request another code or ask the organization for a new invitation.",
    policy:
      "Admission rules changed. Request another code to check the current rules.",
    conflict:
      "This request is already complete or conflicts with your current access. Return to your organizations and check your access before starting another request.",
    suspended:
      "Your access to this organization is suspended. Ask the organization to review your access.",
    typeConflict:
      "Your account already has guest access. Ask the organization to review it; this invitation does not change your member type.",
    unavailable:
      "Admission is temporarily unavailable. Try again later. If it continues, contact the organization.",
    blocked:
      "The organization or admission is unavailable for this account. Check which account you are using or ask the organization for an invitation.",
    rate: "Too many attempts. Wait before trying again.",
    session:
      "Your session needs to be refreshed. Sign in again and resume the request.",
    generic: "The request could not be completed. Try again.",
    missingLink:
      "This invitation is no longer available on this page. Reopen the link you received from the organization.",
    joined: "Your membership is confirmed.",
    existing: "Your account is already a member of this organization.",
    open: "Open organization",
    openFailure:
      "Your access is confirmed, but the organization could not be opened. Try opening it again.",
  },
  "es-ES": {
    title: "Entrar en la organización",
    namedTitle: "Entrar en {organization}",
    publicIntro:
      "Solicita entrar con tu cuenta de OrgMap. La organización comprobará si tu cuenta cumple sus reglas de admisión.",
    linkIntro:
      "Usa esta invitación para solicitar entrar con tu cuenta de OrgMap.",
    email: "Cuenta: {email}",
    proofNote:
      "La entrada solo se confirma tras verificar el código enviado al correo de tu cuenta.",
    start: "Solicitar código por correo",
    starting: "Solicitando código…",
    pendingTitle: "Verifica tu correo",
    pending:
      "Usa el código de esta solicitud. La entrega puede tardar; revisa también la carpeta de correo no deseado.",
    code: "Código de verificación",
    codeHelp:
      "Pega el código completo del correo. Caduca 30 minutos después de la solicitud.",
    invalidInput:
      "Pega el código completo de 64 caracteres recibido por correo.",
    confirm: "Verificar y entrar",
    confirming: "Confirmando entrada…",
    newCode: "Solicitar otro código",
    newCodeHelp:
      "Esto crea otra solicitud. Usa el código de la solicitud más reciente de esta página.",
    resumeHelp:
      "Para solicitar otro código, abre de nuevo la entrada pública de la organización o el enlace de invitación recibido.",
    retry: "Intentar de nuevo",
    cancel: "Cancelar",
    cancelled:
      "La solicitud se ha cerrado en esta página. Los códigos se han eliminado de la pantalla.",
    signIn: "Iniciar sesión en mi cuenta",
    auth: "Tu sesión terminó o aún no has iniciado sesión. Inicia sesión y retoma esta solicitud.",
    invalid:
      "El código o la solicitud no está disponible. Revisa el código recibido. Puede haber caducado o la invitación puede haberse revocado. Si es necesario, solicita otro código o una nueva invitación a la organización.",
    policy:
      "Las reglas de admisión cambiaron. Solicita otro código para comprobar las reglas actuales.",
    conflict:
      "Esta solicitud ya se completó o entra en conflicto con tu acceso actual. Vuelve a tus organizaciones y comprueba tu acceso antes de iniciar otra solicitud.",
    suspended:
      "Tu acceso a esta organización está suspendido. Pide a la organización que lo revise.",
    typeConflict:
      "Tu cuenta ya tiene acceso de invitado. Pide a la organización que lo revise; esta invitación no cambia tu tipo de miembro.",
    unavailable:
      "La admisión no está disponible temporalmente. Inténtalo más tarde. Si continúa, contacta con la organización.",
    blocked:
      "La organización o la entrada no está disponible para esta cuenta. Comprueba la cuenta utilizada o pide una invitación a la organización.",
    rate: "Demasiados intentos. Espera antes de volver a intentarlo.",
    session:
      "Tu sesión necesita actualizarse. Inicia sesión de nuevo y retoma la solicitud.",
    generic: "No se pudo completar la solicitud. Inténtalo de nuevo.",
    missingLink:
      "Esta invitación ya no está disponible en esta página. Abre de nuevo el enlace recibido de la organización.",
    joined: "Tu entrada está confirmada.",
    existing: "Tu cuenta ya forma parte de esta organización.",
    open: "Abrir organización",
    openFailure:
      "Tu acceso está confirmado, pero no se pudo abrir la organización. Intenta abrirla de nuevo.",
  },
  "fr-FR": {
    title: "Rejoindre l’organisation",
    namedTitle: "Rejoindre {organization}",
    publicIntro:
      "Demandez à rejoindre l’organisation avec votre compte OrgMap. Elle vérifiera si votre compte respecte ses règles d’admission.",
    linkIntro:
      "Utilisez cette invitation pour demander à rejoindre l’organisation avec votre compte OrgMap.",
    email: "Compte : {email}",
    proofNote:
      "L’adhésion sera confirmée uniquement après vérification du code envoyé à l’adresse de votre compte.",
    start: "Demander un code par e-mail",
    starting: "Demande du code…",
    pendingTitle: "Vérifiez votre e-mail",
    pending:
      "Utilisez le code de cette demande. La livraison peut prendre un instant ; vérifiez aussi les courriers indésirables.",
    code: "Code de vérification",
    codeHelp:
      "Collez le code complet reçu par e-mail. Il expire 30 minutes après la demande.",
    invalidInput: "Collez le code complet de 64 caractères reçu par e-mail.",
    confirm: "Vérifier et rejoindre",
    confirming: "Confirmation de l’adhésion…",
    newCode: "Demander un autre code",
    newCodeHelp:
      "Cela crée une autre demande. Utilisez le code de la demande la plus récente sur cette page.",
    resumeHelp:
      "Pour demander un autre code, ouvrez à nouveau la page publique d’admission de l’organisation ou le lien d’invitation reçu.",
    retry: "Réessayer",
    cancel: "Annuler",
    cancelled:
      "La demande est fermée sur cette page. Les codes ont été effacés de l’écran.",
    signIn: "Me connecter à mon compte",
    auth: "Votre session a expiré ou vous n’êtes pas connecté. Connectez-vous pour reprendre cette demande.",
    invalid:
      "Le code ou la demande n’est pas disponible. Vérifiez le code reçu. Il peut avoir expiré ou l’invitation peut avoir été révoquée. Au besoin, demandez un autre code ou une nouvelle invitation à l’organisation.",
    policy:
      "Les règles d’admission ont changé. Demandez un autre code pour vérifier les règles actuelles.",
    conflict:
      "Cette demande est déjà terminée ou entre en conflit avec votre accès actuel. Retournez à vos organisations et vérifiez votre accès avant de commencer une autre demande.",
    suspended:
      "Votre accès à cette organisation est suspendu. Demandez à l’organisation de le réexaminer.",
    typeConflict:
      "Votre compte dispose déjà d’un accès invité. Demandez à l’organisation de le réexaminer ; cette invitation ne change pas votre type de membre.",
    unavailable:
      "L’admission est temporairement indisponible. Réessayez plus tard. Si cela persiste, contactez l’organisation.",
    blocked:
      "L’organisation ou l’admission n’est pas disponible pour ce compte. Vérifiez le compte utilisé ou demandez une invitation à l’organisation.",
    rate: "Trop de tentatives. Patientez avant de réessayer.",
    session:
      "Votre session doit être actualisée. Reconnectez-vous pour reprendre la demande.",
    generic: "La demande n’a pas pu aboutir. Réessayez.",
    missingLink:
      "Cette invitation n’est plus disponible sur cette page. Ouvrez à nouveau le lien reçu de l’organisation.",
    joined: "Votre adhésion est confirmée.",
    existing: "Votre compte est déjà membre de cette organisation.",
    open: "Ouvrir l’organisation",
    openFailure:
      "Votre accès est confirmé, mais l’organisation n’a pas pu être ouverte. Essayez de l’ouvrir à nouveau.",
  },
  "de-DE": {
    title: "Organisation beitreten",
    namedTitle: "{organization} beitreten",
    publicIntro:
      "Beantragen Sie den Beitritt mit Ihrem OrgMap-Konto. Die Organisation prüft, ob Ihr Konto ihre Aufnahmeregeln erfüllt.",
    linkIntro:
      "Verwenden Sie diese Einladung, um mit Ihrem OrgMap-Konto den Beitritt zu beantragen.",
    email: "Konto: {email}",
    proofNote:
      "Die Mitgliedschaft wird erst nach Prüfung des Codes bestätigt, der an Ihre Konto-E-Mail gesendet wird.",
    start: "Code per E-Mail anfordern",
    starting: "Code wird angefordert…",
    pendingTitle: "E-Mail bestätigen",
    pending:
      "Verwenden Sie den Code für diesen Antrag. Die Zustellung kann etwas dauern; prüfen Sie auch den Spamordner.",
    code: "Bestätigungscode",
    codeHelp:
      "Fügen Sie den vollständigen Code aus der E-Mail ein. Er läuft 30 Minuten nach der Anforderung ab.",
    invalidInput:
      "Fügen Sie den vollständigen 64-stelligen Code aus der E-Mail ein.",
    confirm: "Bestätigen und beitreten",
    confirming: "Mitgliedschaft wird bestätigt…",
    newCode: "Weiteren Code anfordern",
    newCodeHelp:
      "Dies erstellt einen weiteren Antrag. Verwenden Sie den Code für den neuesten Antrag auf dieser Seite.",
    resumeHelp:
      "Um einen weiteren Code anzufordern, öffnen Sie die öffentliche Aufnahmeseite der Organisation oder den erhaltenen Einladungslink erneut.",
    retry: "Erneut versuchen",
    cancel: "Abbrechen",
    cancelled:
      "Der Antrag wurde auf dieser Seite geschlossen. Die Codes wurden vom Bildschirm entfernt.",
    signIn: "Bei meinem Konto anmelden",
    auth: "Ihre Sitzung ist abgelaufen oder Sie sind noch nicht angemeldet. Melden Sie sich an und setzen Sie diesen Antrag fort.",
    invalid:
      "Der Code oder Antrag ist nicht verfügbar. Prüfen Sie den erhaltenen Code. Er kann abgelaufen sein oder die Einladung wurde widerrufen. Fordern Sie bei Bedarf einen weiteren Code oder eine neue Einladung von der Organisation an.",
    policy:
      "Die Aufnahmeregeln haben sich geändert. Fordern Sie einen weiteren Code an, um die aktuellen Regeln zu prüfen.",
    conflict:
      "Dieser Antrag ist bereits abgeschlossen oder steht im Konflikt mit Ihrem aktuellen Zugang. Kehren Sie zu Ihren Organisationen zurück und prüfen Sie Ihren Zugang, bevor Sie einen neuen Antrag stellen.",
    suspended:
      "Ihr Zugang zu dieser Organisation ist gesperrt. Bitten Sie die Organisation, Ihren Zugang zu prüfen.",
    typeConflict:
      "Ihr Konto hat bereits Gastzugang. Bitten Sie die Organisation um Prüfung; diese Einladung ändert Ihren Mitgliedstyp nicht.",
    unavailable:
      "Die Aufnahme ist vorübergehend nicht verfügbar. Versuchen Sie es später erneut. Wenden Sie sich an die Organisation, wenn das Problem bestehen bleibt.",
    blocked:
      "Die Organisation oder Aufnahme ist für dieses Konto nicht verfügbar. Prüfen Sie das verwendete Konto oder bitten Sie die Organisation um eine Einladung.",
    rate: "Zu viele Versuche. Warten Sie vor einem weiteren Versuch.",
    session:
      "Ihre Sitzung muss aktualisiert werden. Melden Sie sich erneut an und setzen Sie den Antrag fort.",
    generic:
      "Der Antrag konnte nicht abgeschlossen werden. Versuchen Sie es erneut.",
    missingLink:
      "Diese Einladung ist auf dieser Seite nicht mehr verfügbar. Öffnen Sie den von der Organisation erhaltenen Link erneut.",
    joined: "Ihre Mitgliedschaft wurde bestätigt.",
    existing: "Ihr Konto ist bereits Mitglied dieser Organisation.",
    open: "Organisation öffnen",
    openFailure:
      "Ihr Zugang wurde bestätigt, aber die Organisation konnte nicht geöffnet werden. Versuchen Sie es erneut.",
  },
  "it-IT": {
    title: "Entra nell’organizzazione",
    namedTitle: "Entra in {organization}",
    publicIntro:
      "Richiedi di entrare con il tuo account OrgMap. L’organizzazione verificherà se il tuo account rispetta le regole di ammissione.",
    linkIntro:
      "Usa questo invito per richiedere di entrare con il tuo account OrgMap.",
    email: "Account: {email}",
    proofNote:
      "L’ingresso sarà confermato solo dopo la verifica del codice inviato all’e-mail del tuo account.",
    start: "Richiedi codice via e-mail",
    starting: "Richiesta del codice…",
    pendingTitle: "Verifica la tua e-mail",
    pending:
      "Usa il codice per questa richiesta. La consegna può richiedere qualche istante; controlla anche lo spam.",
    code: "Codice di verifica",
    codeHelp:
      "Incolla il codice completo dell’e-mail. Scade 30 minuti dopo la richiesta.",
    invalidInput:
      "Incolla il codice completo di 64 caratteri ricevuto via e-mail.",
    confirm: "Verifica ed entra",
    confirming: "Conferma dell’ingresso…",
    newCode: "Richiedi un altro codice",
    newCodeHelp:
      "Questo crea un’altra richiesta. Usa il codice per la richiesta più recente su questa pagina.",
    resumeHelp:
      "Per richiedere un altro codice, riapri la pagina pubblica di ammissione dell’organizzazione o il link di invito ricevuto.",
    retry: "Riprova",
    cancel: "Annulla",
    cancelled:
      "La richiesta è stata chiusa su questa pagina. I codici sono stati rimossi dallo schermo.",
    signIn: "Accedi al mio account",
    auth: "La sessione è terminata o non hai ancora effettuato l’accesso. Accedi e riprendi questa richiesta.",
    invalid:
      "Il codice o la richiesta non è disponibile. Controlla il codice ricevuto. Potrebbe essere scaduto oppure l’invito potrebbe essere stato revocato. Se necessario, richiedi un altro codice o un nuovo invito all’organizzazione.",
    policy:
      "Le regole di ammissione sono cambiate. Richiedi un altro codice per verificare le regole attuali.",
    conflict:
      "Questa richiesta è già completata o è in conflitto con il tuo accesso attuale. Torna alle tue organizzazioni e verifica l’accesso prima di avviare un’altra richiesta.",
    suspended:
      "Il tuo accesso a questa organizzazione è sospeso. Chiedi all’organizzazione di riesaminarlo.",
    typeConflict:
      "Il tuo account ha già un accesso ospite. Chiedi all’organizzazione di riesaminarlo; questo invito non cambia il tuo tipo di membro.",
    unavailable:
      "L’ammissione non è temporaneamente disponibile. Riprova più tardi. Se continua, contatta l’organizzazione.",
    blocked:
      "L’organizzazione o l’ingresso non è disponibile per questo account. Controlla l’account utilizzato o chiedi un invito all’organizzazione.",
    rate: "Troppi tentativi. Attendi prima di riprovare.",
    session:
      "La sessione deve essere aggiornata. Accedi nuovamente e riprendi la richiesta.",
    generic: "Impossibile completare la richiesta. Riprova.",
    missingLink:
      "Questo invito non è più disponibile su questa pagina. Riapri il link ricevuto dall’organizzazione.",
    joined: "Il tuo ingresso è confermato.",
    existing: "Il tuo account fa già parte di questa organizzazione.",
    open: "Apri organizzazione",
    openFailure:
      "Il tuo accesso è confermato, ma non è stato possibile aprire l’organizzazione. Prova ad aprirla nuovamente.",
  },
  "ja-JP": {
    title: "組織に参加",
    namedTitle: "{organization} に参加",
    publicIntro:
      "OrgMap アカウントで参加を申請します。組織がアカウントの参加条件を確認します。",
    linkIntro: "この招待を使って OrgMap アカウントで参加を申請します。",
    email: "アカウント：{email}",
    proofNote:
      "アカウントのメールアドレスに届いたコードを確認した後に、参加が確定します。",
    start: "メールでコードを申請",
    starting: "コードを申請中…",
    pendingTitle: "メールアドレスを確認",
    pending:
      "この申請用のコードを使用してください。配信に少し時間がかかる場合があります。迷惑メールも確認してください。",
    code: "確認コード",
    codeHelp:
      "メールのコード全体を貼り付けてください。コードは申請から30分で期限切れになります。",
    invalidInput: "メールで受け取った64文字のコード全体を貼り付けてください。",
    confirm: "確認して参加",
    confirming: "参加を確認中…",
    newCode: "別のコードを申請",
    newCodeHelp:
      "新しい申請を作成します。このページで最後に行った申請のコードを使用してください。",
    resumeHelp:
      "別のコードを申請するには、組織の公開参加ページまたは受け取った招待リンクをもう一度開いてください。",
    retry: "再試行",
    cancel: "キャンセル",
    cancelled:
      "このページでの申請を終了しました。画面からコードを削除しました。",
    signIn: "自分のアカウントにログイン",
    auth: "セッションが終了したか、まだログインしていません。ログインして申請を再開してください。",
    invalid:
      "コードまたは申請を利用できません。受け取ったコードを確認してください。コードの期限切れ、または招待の取り消しの可能性があります。必要に応じて別のコードを申請するか、組織に新しい招待を依頼してください。",
    policy:
      "参加条件が変更されました。別のコードを申請して現在の条件を確認してください。",
    conflict:
      "この申請は完了しているか、現在のアクセス権と競合しています。新しい申請を行う前に、組織一覧に戻ってアクセス権を確認してください。",
    suspended:
      "この組織へのアクセスは停止されています。組織にアクセス権の確認を依頼してください。",
    typeConflict:
      "このアカウントにはすでにゲストアクセス権があります。組織に確認を依頼してください。この招待ではメンバー種別は変更されません。",
    unavailable:
      "現在、参加申請を利用できません。後でもう一度お試しください。問題が続く場合は組織に連絡してください。",
    blocked:
      "このアカウントでは組織または参加申請を利用できません。使用中のアカウントを確認するか、組織に招待を依頼してください。",
    rate: "試行回数が多すぎます。しばらく待ってからお試しください。",
    session:
      "セッションを更新する必要があります。再度ログインして申請を再開してください。",
    generic: "申請を完了できませんでした。もう一度お試しください。",
    missingLink:
      "このページでは招待を利用できなくなりました。組織から受け取ったリンクをもう一度開いてください。",
    joined: "組織への参加が確定しました。",
    existing: "このアカウントはすでに組織のメンバーです。",
    open: "組織を開く",
    openFailure:
      "アクセス権は確認されましたが、組織を開けませんでした。もう一度お試しください。",
  },
  "nl-NL": {
    title: "Lid worden van organisatie",
    namedTitle: "Lid worden van {organization}",
    publicIntro:
      "Vraag toegang aan met je OrgMap-account. De organisatie controleert of je account aan de toelatingsregels voldoet.",
    linkIntro:
      "Gebruik deze uitnodiging om met je OrgMap-account toegang aan te vragen.",
    email: "Account: {email}",
    proofNote:
      "Je lidmaatschap wordt pas bevestigd nadat de code naar je account-e-mailadres is gecontroleerd.",
    start: "Code per e-mail aanvragen",
    starting: "Code aanvragen…",
    pendingTitle: "Bevestig je e-mailadres",
    pending:
      "Gebruik de code voor deze aanvraag. Bezorging kan even duren; controleer ook je spammap.",
    code: "Verificatiecode",
    codeHelp:
      "Plak de volledige code uit de e-mail. Deze verloopt 30 minuten na de aanvraag.",
    invalidInput:
      "Plak de volledige code van 64 tekens die je per e-mail hebt ontvangen.",
    confirm: "Bevestigen en lid worden",
    confirming: "Lidmaatschap bevestigen…",
    newCode: "Andere code aanvragen",
    newCodeHelp:
      "Dit maakt een nieuwe aanvraag. Gebruik de code voor de meest recente aanvraag op deze pagina.",
    resumeHelp:
      "Om een andere code aan te vragen, open je de openbare toelatingspagina van de organisatie of de ontvangen uitnodigingslink opnieuw.",
    retry: "Opnieuw proberen",
    cancel: "Annuleren",
    cancelled:
      "De aanvraag is op deze pagina afgesloten. De codes zijn van het scherm verwijderd.",
    signIn: "Inloggen op mijn account",
    auth: "Je sessie is verlopen of je bent nog niet ingelogd. Log in en hervat deze aanvraag.",
    invalid:
      "De code of aanvraag is niet beschikbaar. Controleer de ontvangen code. Deze kan verlopen zijn of de uitnodiging kan zijn ingetrokken. Vraag zo nodig een andere code of een nieuwe uitnodiging aan de organisatie.",
    policy:
      "De toelatingsregels zijn gewijzigd. Vraag een andere code aan om de huidige regels te controleren.",
    conflict:
      "Deze aanvraag is al voltooid of conflicteert met je huidige toegang. Ga terug naar je organisaties en controleer je toegang voordat je een nieuwe aanvraag start.",
    suspended:
      "Je toegang tot deze organisatie is opgeschort. Vraag de organisatie om je toegang te beoordelen.",
    typeConflict:
      "Je account heeft al gasttoegang. Vraag de organisatie om dit te beoordelen; deze uitnodiging wijzigt je lidtype niet.",
    unavailable:
      "Toelating is tijdelijk niet beschikbaar. Probeer het later opnieuw. Neem contact op met de organisatie als het probleem blijft bestaan.",
    blocked:
      "De organisatie of toelating is niet beschikbaar voor dit account. Controleer het gebruikte account of vraag de organisatie om een uitnodiging.",
    rate: "Te veel pogingen. Wacht voordat je het opnieuw probeert.",
    session:
      "Je sessie moet worden vernieuwd. Log opnieuw in en hervat de aanvraag.",
    generic: "De aanvraag kon niet worden voltooid. Probeer het opnieuw.",
    missingLink:
      "Deze uitnodiging is niet meer beschikbaar op deze pagina. Open de link die je van de organisatie hebt ontvangen opnieuw.",
    joined: "Je lidmaatschap is bevestigd.",
    existing: "Je account is al lid van deze organisatie.",
    open: "Organisatie openen",
    openFailure:
      "Je toegang is bevestigd, maar de organisatie kon niet worden geopend. Probeer deze opnieuw te openen.",
  },
};
export const admissionMessages = (locale: string) =>
  createMessageTranslator(locale, dictionaries);

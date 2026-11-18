import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { request, RequestError, errorMessage } from "../api";
import { Button, Notice } from "../ui";
import {
  createMessageTranslator,
  formatError,
  resolveLocale,
  useLocalization,
  type Locale,
} from "../localization";
import "./mfa-settings.css";

const pt = {
  title: "Autenticação em duas etapas",
  intro:
    "Use um aplicativo autenticador para gerar os códigos TOTP da sua conta.",
  loading: "Consultando a autenticação em duas etapas…",
  enabled: "Ativada",
  disabled: "Desativada",
  refresh: "Consultar estado",
  enable: "Configurar autenticador",
  disable: "Desativar autenticação em duas etapas",
  cancel: "Cancelar",
  close: "Fechar",
  pending: "Aguarde…",
  startTitle: "Configurar autenticador",
  startHelp:
    "Confirme seu acesso para gerar uma chave. Ela só será exibida nesta configuração, que expira em 10 minutos.",
  password: "Senha atual",
  federatedHelp:
    "Sua conta não usa senha local. É necessário ter entrado pelo provedor de identidade nos últimos 5 minutos. Se necessário, saia, entre novamente pelo provedor e volte aqui.",
  start: "Gerar chave",
  replaces:
    "Gerar outra chave invalida a anterior. Use apenas a chave mais recente no aplicativo.",
  enrollTitle: "Adicionar a chave ao autenticador",
  manualHelp:
    "No aplicativo autenticador, adicione uma conta por inserção manual. Identifique-a como sua conta OrgMap, use a chave abaixo e selecione códigos baseados em tempo (TOTP).",
  secret: "Chave de configuração",
  secretHelp:
    "Guarde esta chave apenas no autenticador. Fechar ou cancelar remove a chave desta tela. A configuração só é concluída após a confirmação do código.",
  parameters:
    "Emissor: {issuer}. Algoritmo: {algorithm}. {digits} dígitos, a cada {period} segundos.",
  code: "Código do autenticador",
  codeHint: "Digite os 6 dígitos atuais do aplicativo.",
  confirm: "Confirmar e ativar",
  newSecret: "Gerar outra chave",
  disableTitle: "Desativar autenticação em duas etapas",
  disableHelp: "Confirme seu acesso para remover o autenticador da conta.",
  optionalCode:
    "O código pode ficar vazio se esta sessão já confirmou o autenticador nos últimos 5 minutos. O servidor verificará se é necessário.",
  requiredCode: "Informe um código atual do autenticador para continuar.",
  activated: "Autenticação em duas etapas ativada.",
  deactivated: "Autenticação em duas etapas desativada.",
  invalidCode: "Digite exatamente 6 dígitos.",
  configurationError:
    "A autenticação em duas etapas está indisponível por uma configuração do servidor (MFA_CONFIGURATION_REQUIRED). Peça à pessoa responsável pelo OrgMap para verificar a configuração e tente novamente.",
  verificationError:
    "O código não foi aceito. Confira a hora do aparelho e tente um código novo. Se esta configuração passou de 10 minutos, gere outra chave.",
  disableVerificationError:
    "É necessário um código atual e ainda não utilizado do autenticador.",
  passwordError: "Confirme sua senha atual para continuar.",
  federatedError:
    "Entre novamente pelo provedor de identidade e retorne aqui dentro de 5 minutos.",
  rateError: "Muitas tentativas. Aguarde um minuto antes de tentar novamente.",
  alreadyEnabled:
    "O autenticador já está ativado. Consulte o estado para atualizar esta tela.",
  notEnabled:
    "O autenticador já está desativado. Consulte o estado para atualizar esta tela.",
  genericError: "Não foi possível concluir a ação. Tente novamente.",
};
type Message = keyof typeof pt;
const messages: Record<Locale, Record<Message, string>> = {
  "pt-BR": pt,
  "en-US": {
    title: "Two-step authentication",
    intro: "Use an authenticator app to generate TOTP codes for your account.",
    loading: "Checking two-step authentication…",
    enabled: "Enabled",
    disabled: "Disabled",
    refresh: "Check status",
    enable: "Set up authenticator",
    disable: "Disable two-step authentication",
    cancel: "Cancel",
    close: "Close",
    pending: "Please wait…",
    startTitle: "Set up authenticator",
    startHelp:
      "Confirm your access to generate a key. It is shown only during this setup, which expires in 10 minutes.",
    password: "Current password",
    federatedHelp:
      "Your account has no local password. You must have signed in through your identity provider within the last 5 minutes. If needed, sign out, sign in again through the provider, and return here.",
    start: "Generate key",
    replaces:
      "Generating another key invalidates the previous one. Use only the latest key in your app.",
    enrollTitle: "Add the key to your authenticator",
    manualHelp:
      "In your authenticator app, add an account using manual entry. Label it as your OrgMap account, enter the key below, and choose time-based codes (TOTP).",
    secret: "Setup key",
    secretHelp:
      "Keep this key only in your authenticator. Closing or cancelling removes it from this screen. Setup is completed only after you confirm the code.",
    parameters:
      "Issuer: {issuer}. Algorithm: {algorithm}. {digits} digits, every {period} seconds.",
    code: "Authenticator code",
    codeHint: "Enter the current 6 digits from the app.",
    confirm: "Confirm and enable",
    newSecret: "Generate another key",
    disableTitle: "Disable two-step authentication",
    disableHelp:
      "Confirm your access to remove the authenticator from your account.",
    optionalCode:
      "You may leave the code empty if this session verified the authenticator within the last 5 minutes. The server will check whether it is required.",
    requiredCode: "Enter a current authenticator code to continue.",
    activated: "Two-step authentication enabled.",
    deactivated: "Two-step authentication disabled.",
    invalidCode: "Enter exactly 6 digits.",
    configurationError:
      "Two-step authentication is unavailable because of a server configuration (MFA_CONFIGURATION_REQUIRED). Ask the person responsible for OrgMap to check the configuration, then try again.",
    verificationError:
      "The code was not accepted. Check your device clock and try a new code. If this setup is over 10 minutes old, generate another key.",
    disableVerificationError:
      "A current, unused authenticator code is required.",
    passwordError: "Confirm your current password to continue.",
    federatedError:
      "Sign in again through your identity provider and return here within 5 minutes.",
    rateError: "Too many attempts. Wait one minute before trying again.",
    alreadyEnabled:
      "The authenticator is already enabled. Check the status to update this screen.",
    notEnabled:
      "The authenticator is already disabled. Check the status to update this screen.",
    genericError: "Unable to complete this action. Try again.",
  },
  "es-ES": {
    title: "Autenticación en dos pasos",
    intro:
      "Usa una aplicación de autenticación para generar códigos TOTP para tu cuenta.",
    loading: "Consultando la autenticación en dos pasos…",
    enabled: "Activada",
    disabled: "Desactivada",
    refresh: "Consultar estado",
    enable: "Configurar autenticador",
    disable: "Desactivar autenticación en dos pasos",
    cancel: "Cancelar",
    close: "Cerrar",
    pending: "Espera…",
    startTitle: "Configurar autenticador",
    startHelp:
      "Confirma tu acceso para generar una clave. Solo se mostrará durante esta configuración, que caduca en 10 minutos.",
    password: "Contraseña actual",
    federatedHelp:
      "Tu cuenta no tiene contraseña local. Debes haber iniciado sesión con tu proveedor de identidad en los últimos 5 minutos. Si es necesario, cierra la sesión, vuelve a entrar con el proveedor y regresa aquí.",
    start: "Generar clave",
    replaces:
      "Generar otra clave invalida la anterior. Usa solo la clave más reciente en la aplicación.",
    enrollTitle: "Añadir la clave al autenticador",
    manualHelp:
      "En la aplicación de autenticación, añade una cuenta mediante entrada manual. Identifícala como tu cuenta de OrgMap, introduce la clave siguiente y elige códigos basados en tiempo (TOTP).",
    secret: "Clave de configuración",
    secretHelp:
      "Guarda esta clave solo en el autenticador. Cerrar o cancelar la elimina de esta pantalla. La configuración solo se completa al confirmar el código.",
    parameters:
      "Emisor: {issuer}. Algoritmo: {algorithm}. {digits} dígitos, cada {period} segundos.",
    code: "Código del autenticador",
    codeHint: "Introduce los 6 dígitos actuales de la aplicación.",
    confirm: "Confirmar y activar",
    newSecret: "Generar otra clave",
    disableTitle: "Desactivar autenticación en dos pasos",
    disableHelp:
      "Confirma tu acceso para eliminar el autenticador de tu cuenta.",
    optionalCode:
      "Puedes dejar el código vacío si esta sesión verificó el autenticador en los últimos 5 minutos. El servidor comprobará si es necesario.",
    requiredCode: "Introduce un código actual del autenticador para continuar.",
    activated: "Autenticación en dos pasos activada.",
    deactivated: "Autenticación en dos pasos desactivada.",
    invalidCode: "Introduce exactamente 6 dígitos.",
    configurationError:
      "La autenticación en dos pasos no está disponible por la configuración del servidor (MFA_CONFIGURATION_REQUIRED). Pide a la persona responsable de OrgMap que la revise e inténtalo de nuevo.",
    verificationError:
      "El código no se ha aceptado. Comprueba la hora del dispositivo e introduce un código nuevo. Si han pasado 10 minutos desde esta configuración, genera otra clave.",
    disableVerificationError:
      "Se necesita un código actual del autenticador que aún no se haya utilizado.",
    passwordError: "Confirma tu contraseña actual para continuar.",
    federatedError:
      "Vuelve a iniciar sesión con tu proveedor de identidad y regresa aquí antes de 5 minutos.",
    rateError:
      "Demasiados intentos. Espera un minuto antes de volver a intentarlo.",
    alreadyEnabled:
      "El autenticador ya está activado. Consulta el estado para actualizar esta pantalla.",
    notEnabled:
      "El autenticador ya está desactivado. Consulta el estado para actualizar esta pantalla.",
    genericError: "No se pudo completar la acción. Inténtalo de nuevo.",
  },
  "fr-FR": {
    title: "Authentification en deux étapes",
    intro:
      "Utilisez une application d’authentification pour générer les codes TOTP de votre compte.",
    loading: "Vérification de l’authentification en deux étapes…",
    enabled: "Activée",
    disabled: "Désactivée",
    refresh: "Vérifier l’état",
    enable: "Configurer l’authentificateur",
    disable: "Désactiver l’authentification en deux étapes",
    cancel: "Annuler",
    close: "Fermer",
    pending: "Veuillez patienter…",
    startTitle: "Configurer l’authentificateur",
    startHelp:
      "Confirmez votre accès pour générer une clé. Elle ne sera affichée que pendant cette configuration, qui expire dans 10 minutes.",
    password: "Mot de passe actuel",
    federatedHelp:
      "Votre compte n’a pas de mot de passe local. Vous devez vous être connecté via votre fournisseur d’identité dans les 5 dernières minutes. Au besoin, déconnectez-vous, reconnectez-vous via ce fournisseur et revenez ici.",
    start: "Générer la clé",
    replaces:
      "Générer une autre clé invalide la précédente. Utilisez uniquement la dernière clé dans l’application.",
    enrollTitle: "Ajouter la clé à l’authentificateur",
    manualHelp:
      "Dans votre application d’authentification, ajoutez un compte par saisie manuelle. Nommez-le comme votre compte OrgMap, saisissez la clé ci-dessous et choisissez les codes temporels (TOTP).",
    secret: "Clé de configuration",
    secretHelp:
      "Conservez cette clé uniquement dans l’authentificateur. Fermer ou annuler la retire de cet écran. La configuration n’est terminée qu’après confirmation du code.",
    parameters:
      "Émetteur : {issuer}. Algorithme : {algorithm}. {digits} chiffres, toutes les {period} secondes.",
    code: "Code de l’authentificateur",
    codeHint: "Saisissez les 6 chiffres actuels de l’application.",
    confirm: "Confirmer et activer",
    newSecret: "Générer une autre clé",
    disableTitle: "Désactiver l’authentification en deux étapes",
    disableHelp:
      "Confirmez votre accès pour retirer l’authentificateur de votre compte.",
    optionalCode:
      "Vous pouvez laisser le code vide si cette session a vérifié l’authentificateur dans les 5 dernières minutes. Le serveur vérifiera s’il est nécessaire.",
    requiredCode:
      "Saisissez un code actuel de l’authentificateur pour continuer.",
    activated: "Authentification en deux étapes activée.",
    deactivated: "Authentification en deux étapes désactivée.",
    invalidCode: "Saisissez exactement 6 chiffres.",
    configurationError:
      "L’authentification en deux étapes est indisponible en raison de la configuration du serveur (MFA_CONFIGURATION_REQUIRED). Demandez à la personne responsable d’OrgMap de la vérifier, puis réessayez.",
    verificationError:
      "Le code n’a pas été accepté. Vérifiez l’heure de l’appareil et essayez un nouveau code. Si cette configuration date de plus de 10 minutes, générez une autre clé.",
    disableVerificationError:
      "Un code actuel et non encore utilisé de l’authentificateur est nécessaire.",
    passwordError: "Confirmez votre mot de passe actuel pour continuer.",
    federatedError:
      "Reconnectez-vous via votre fournisseur d’identité et revenez ici dans les 5 minutes.",
    rateError: "Trop de tentatives. Patientez une minute avant de réessayer.",
    alreadyEnabled:
      "L’authentificateur est déjà activé. Vérifiez l’état pour actualiser cet écran.",
    notEnabled:
      "L’authentificateur est déjà désactivé. Vérifiez l’état pour actualiser cet écran.",
    genericError: "Impossible de terminer cette action. Réessayez.",
  },
  "de-DE": {
    title: "Authentifizierung in zwei Schritten",
    intro: "Erzeugen Sie mit einer Authenticator-App TOTP-Codes für Ihr Konto.",
    loading: "Authentifizierung in zwei Schritten wird geprüft…",
    enabled: "Aktiviert",
    disabled: "Deaktiviert",
    refresh: "Status prüfen",
    enable: "Authenticator einrichten",
    disable: "Authentifizierung in zwei Schritten deaktivieren",
    cancel: "Abbrechen",
    close: "Schließen",
    pending: "Bitte warten…",
    startTitle: "Authenticator einrichten",
    startHelp:
      "Bestätigen Sie Ihren Zugang, um einen Schlüssel zu erzeugen. Er wird nur während dieser Einrichtung angezeigt. Sie läuft nach 10 Minuten ab.",
    password: "Aktuelles Passwort",
    federatedHelp:
      "Ihr Konto hat kein lokales Passwort. Sie müssen sich innerhalb der letzten 5 Minuten über Ihren Identitätsanbieter angemeldet haben. Melden Sie sich bei Bedarf ab, erneut über den Anbieter an und kehren Sie hierher zurück.",
    start: "Schlüssel erzeugen",
    replaces:
      "Ein neuer Schlüssel macht den vorherigen ungültig. Verwenden Sie nur den neuesten Schlüssel in der App.",
    enrollTitle: "Schlüssel zum Authenticator hinzufügen",
    manualHelp:
      "Fügen Sie in Ihrer Authenticator-App ein Konto durch manuelle Eingabe hinzu. Benennen Sie es als Ihr OrgMap-Konto, geben Sie den folgenden Schlüssel ein und wählen Sie zeitbasierte Codes (TOTP).",
    secret: "Einrichtungsschlüssel",
    secretHelp:
      "Bewahren Sie diesen Schlüssel nur im Authenticator auf. Schließen oder Abbrechen entfernt ihn aus dieser Ansicht. Erst die Bestätigung des Codes schließt die Einrichtung ab.",
    parameters:
      "Aussteller: {issuer}. Algorithmus: {algorithm}. {digits} Ziffern, alle {period} Sekunden.",
    code: "Authenticator-Code",
    codeHint: "Geben Sie die aktuellen 6 Ziffern aus der App ein.",
    confirm: "Bestätigen und aktivieren",
    newSecret: "Neuen Schlüssel erzeugen",
    disableTitle: "Authentifizierung in zwei Schritten deaktivieren",
    disableHelp:
      "Bestätigen Sie Ihren Zugang, um den Authenticator aus Ihrem Konto zu entfernen.",
    optionalCode:
      "Sie können den Code leer lassen, wenn diese Sitzung den Authenticator innerhalb der letzten 5 Minuten bestätigt hat. Der Server prüft, ob er erforderlich ist.",
    requiredCode:
      "Geben Sie einen aktuellen Authenticator-Code ein, um fortzufahren.",
    activated: "Authentifizierung in zwei Schritten aktiviert.",
    deactivated: "Authentifizierung in zwei Schritten deaktiviert.",
    invalidCode: "Geben Sie genau 6 Ziffern ein.",
    configurationError:
      "Die Authentifizierung in zwei Schritten ist wegen einer Serverkonfiguration nicht verfügbar (MFA_CONFIGURATION_REQUIRED). Bitten Sie die für OrgMap zuständige Person, die Konfiguration zu prüfen, und versuchen Sie es erneut.",
    verificationError:
      "Der Code wurde nicht akzeptiert. Prüfen Sie die Gerätezeit und versuchen Sie einen neuen Code. Erzeugen Sie einen neuen Schlüssel, wenn die Einrichtung älter als 10 Minuten ist.",
    disableVerificationError:
      "Ein aktueller, noch nicht verwendeter Authenticator-Code ist erforderlich.",
    passwordError: "Bestätigen Sie Ihr aktuelles Passwort, um fortzufahren.",
    federatedError:
      "Melden Sie sich erneut über Ihren Identitätsanbieter an und kehren Sie innerhalb von 5 Minuten hierher zurück.",
    rateError:
      "Zu viele Versuche. Warten Sie eine Minute vor dem nächsten Versuch.",
    alreadyEnabled:
      "Der Authenticator ist bereits aktiviert. Prüfen Sie den Status, um diese Ansicht zu aktualisieren.",
    notEnabled:
      "Der Authenticator ist bereits deaktiviert. Prüfen Sie den Status, um diese Ansicht zu aktualisieren.",
    genericError:
      "Die Aktion konnte nicht abgeschlossen werden. Versuchen Sie es erneut.",
  },
  "it-IT": {
    title: "Autenticazione in due passaggi",
    intro:
      "Usa un’app di autenticazione per generare i codici TOTP del tuo account.",
    loading: "Verifica dell’autenticazione in due passaggi…",
    enabled: "Attivata",
    disabled: "Disattivata",
    refresh: "Verifica stato",
    enable: "Configura autenticatore",
    disable: "Disattiva autenticazione in due passaggi",
    cancel: "Annulla",
    close: "Chiudi",
    pending: "Attendi…",
    startTitle: "Configura autenticatore",
    startHelp:
      "Conferma l’accesso per generare una chiave. Verrà mostrata solo durante questa configurazione, che scade tra 10 minuti.",
    password: "Password attuale",
    federatedHelp:
      "Il tuo account non ha una password locale. Devi aver effettuato l’accesso tramite il provider di identità negli ultimi 5 minuti. Se necessario, esci, accedi di nuovo tramite il provider e torna qui.",
    start: "Genera chiave",
    replaces:
      "Generare un’altra chiave invalida la precedente. Usa solo la chiave più recente nell’app.",
    enrollTitle: "Aggiungi la chiave all’autenticatore",
    manualHelp:
      "Nell’app di autenticazione, aggiungi un account con inserimento manuale. Identificalo come il tuo account OrgMap, inserisci la chiave qui sotto e scegli i codici basati sul tempo (TOTP).",
    secret: "Chiave di configurazione",
    secretHelp:
      "Conserva questa chiave solo nell’autenticatore. Chiudere o annullare la rimuove da questa schermata. La configurazione si completa solo dopo la conferma del codice.",
    parameters:
      "Emittente: {issuer}. Algoritmo: {algorithm}. {digits} cifre, ogni {period} secondi.",
    code: "Codice dell’autenticatore",
    codeHint: "Inserisci le 6 cifre attuali dell’app.",
    confirm: "Conferma e attiva",
    newSecret: "Genera un’altra chiave",
    disableTitle: "Disattiva autenticazione in due passaggi",
    disableHelp:
      "Conferma l’accesso per rimuovere l’autenticatore dal tuo account.",
    optionalCode:
      "Puoi lasciare il codice vuoto se questa sessione ha verificato l’autenticatore negli ultimi 5 minuti. Il server verificherà se è necessario.",
    requiredCode:
      "Inserisci un codice attuale dell’autenticatore per continuare.",
    activated: "Autenticazione in due passaggi attivata.",
    deactivated: "Autenticazione in due passaggi disattivata.",
    invalidCode: "Inserisci esattamente 6 cifre.",
    configurationError:
      "L’autenticazione in due passaggi non è disponibile per una configurazione del server (MFA_CONFIGURATION_REQUIRED). Chiedi alla persona responsabile di OrgMap di verificarla, poi riprova.",
    verificationError:
      "Il codice non è stato accettato. Verifica l’ora del dispositivo e prova un nuovo codice. Se sono passati più di 10 minuti dalla configurazione, genera un’altra chiave.",
    disableVerificationError:
      "È necessario un codice attuale dell’autenticatore non ancora utilizzato.",
    passwordError: "Conferma la password attuale per continuare.",
    federatedError:
      "Accedi di nuovo tramite il provider di identità e torna qui entro 5 minuti.",
    rateError: "Troppi tentativi. Attendi un minuto prima di riprovare.",
    alreadyEnabled:
      "L’autenticatore è già attivato. Verifica lo stato per aggiornare questa schermata.",
    notEnabled:
      "L’autenticatore è già disattivato. Verifica lo stato per aggiornare questa schermata.",
    genericError: "Impossibile completare l’azione. Riprova.",
  },
  "ja-JP": {
    title: "2段階認証",
    intro: "認証アプリでアカウントのTOTPコードを生成します。",
    loading: "2段階認証の状態を確認中…",
    enabled: "有効",
    disabled: "無効",
    refresh: "状態を確認",
    enable: "認証アプリを設定",
    disable: "2段階認証を無効にする",
    cancel: "キャンセル",
    close: "閉じる",
    pending: "お待ちください…",
    startTitle: "認証アプリを設定",
    startHelp:
      "アクセスを確認してキーを生成します。キーはこの設定中に一度だけ表示され、設定は10分で期限切れになります。",
    password: "現在のパスワード",
    federatedHelp:
      "このアカウントにローカルパスワードはありません。過去5分以内にIDプロバイダー経由でログインしている必要があります。必要に応じてログアウトし、プロバイダー経由で再度ログインしてから戻ってください。",
    start: "キーを生成",
    replaces:
      "別のキーを生成すると前のキーは無効になります。アプリでは最新のキーだけを使用してください。",
    enrollTitle: "認証アプリにキーを追加",
    manualHelp:
      "認証アプリで手動入力によりアカウントを追加します。自分のOrgMapアカウントと分かる名前を付け、以下のキーを入力し、時間ベースのコード（TOTP）を選択してください。",
    secret: "設定キー",
    secretHelp:
      "このキーは認証アプリだけに保存してください。閉じるかキャンセルすると、この画面からキーが消えます。コードを確認するまで設定は完了しません。",
    parameters:
      "発行者: {issuer}。アルゴリズム: {algorithm}。{digits}桁、{period}秒ごと。",
    code: "認証アプリのコード",
    codeHint: "アプリに表示される現在の6桁を入力してください。",
    confirm: "確認して有効にする",
    newSecret: "別のキーを生成",
    disableTitle: "2段階認証を無効にする",
    disableHelp: "アクセスを確認し、アカウントから認証アプリを削除します。",
    optionalCode:
      "このセッションで過去5分以内に認証アプリを確認した場合、コードを空欄にできます。必要かどうかはサーバーが確認します。",
    requiredCode: "続行するには認証アプリの現在のコードを入力してください。",
    activated: "2段階認証を有効にしました。",
    deactivated: "2段階認証を無効にしました。",
    invalidCode: "6桁の数字を入力してください。",
    configurationError:
      "サーバーの設定により2段階認証を利用できません（MFA_CONFIGURATION_REQUIRED）。OrgMapの担当者に設定の確認を依頼し、再試行してください。",
    verificationError:
      "コードを確認できませんでした。端末の時刻を確認し、新しいコードで再試行してください。設定開始から10分以上経過した場合は別のキーを生成してください。",
    disableVerificationError:
      "現在有効で未使用の認証アプリのコードが必要です。",
    passwordError: "続行するには現在のパスワードを確認してください。",
    federatedError:
      "IDプロバイダー経由で再度ログインし、5分以内に戻ってください。",
    rateError: "試行回数が多すぎます。1分待ってから再試行してください。",
    alreadyEnabled:
      "認証アプリはすでに有効です。状態を確認して画面を更新してください。",
    notEnabled:
      "認証アプリはすでに無効です。状態を確認して画面を更新してください。",
    genericError: "操作を完了できませんでした。再試行してください。",
  },
  "nl-NL": {
    title: "Authenticatie in twee stappen",
    intro:
      "Gebruik een authenticator-app om TOTP-codes voor uw account te genereren.",
    loading: "Authenticatie in twee stappen controleren…",
    enabled: "Ingeschakeld",
    disabled: "Uitgeschakeld",
    refresh: "Status controleren",
    enable: "Authenticator instellen",
    disable: "Authenticatie in twee stappen uitschakelen",
    cancel: "Annuleren",
    close: "Sluiten",
    pending: "Even geduld…",
    startTitle: "Authenticator instellen",
    startHelp:
      "Bevestig uw toegang om een sleutel te genereren. Deze wordt alleen tijdens deze instelling getoond. De instelling verloopt na 10 minuten.",
    password: "Huidig wachtwoord",
    federatedHelp:
      "Uw account heeft geen lokaal wachtwoord. U moet in de afgelopen 5 minuten via uw identiteitsprovider zijn aangemeld. Meld u indien nodig af, meld u opnieuw aan via de provider en keer hier terug.",
    start: "Sleutel genereren",
    replaces:
      "Een nieuwe sleutel maakt de vorige ongeldig. Gebruik alleen de nieuwste sleutel in de app.",
    enrollTitle: "Sleutel aan uw authenticator toevoegen",
    manualHelp:
      "Voeg in uw authenticator-app een account toe via handmatige invoer. Geef het de naam van uw OrgMap-account, voer de onderstaande sleutel in en kies tijdgebaseerde codes (TOTP).",
    secret: "Instelsleutel",
    secretHelp:
      "Bewaar deze sleutel alleen in de authenticator. Sluiten of annuleren verwijdert de sleutel van dit scherm. De instelling is pas voltooid na bevestiging van de code.",
    parameters:
      "Uitgever: {issuer}. Algoritme: {algorithm}. {digits} cijfers, elke {period} seconden.",
    code: "Authenticatorcode",
    codeHint: "Voer de huidige 6 cijfers uit de app in.",
    confirm: "Bevestigen en inschakelen",
    newSecret: "Andere sleutel genereren",
    disableTitle: "Authenticatie in twee stappen uitschakelen",
    disableHelp:
      "Bevestig uw toegang om de authenticator uit uw account te verwijderen.",
    optionalCode:
      "U mag de code leeg laten als deze sessie de authenticator in de afgelopen 5 minuten heeft bevestigd. De server controleert of de code nodig is.",
    requiredCode: "Voer een huidige authenticatorcode in om door te gaan.",
    activated: "Authenticatie in twee stappen ingeschakeld.",
    deactivated: "Authenticatie in twee stappen uitgeschakeld.",
    invalidCode: "Voer precies 6 cijfers in.",
    configurationError:
      "Authenticatie in twee stappen is niet beschikbaar door een serverconfiguratie (MFA_CONFIGURATION_REQUIRED). Vraag de verantwoordelijke voor OrgMap om de configuratie te controleren en probeer opnieuw.",
    verificationError:
      "De code is niet geaccepteerd. Controleer de klok van uw apparaat en probeer een nieuwe code. Genereer een andere sleutel als deze instelling ouder is dan 10 minuten.",
    disableVerificationError:
      "Een huidige, nog niet gebruikte authenticatorcode is vereist.",
    passwordError: "Bevestig uw huidige wachtwoord om door te gaan.",
    federatedError:
      "Meld u opnieuw aan via uw identiteitsprovider en keer binnen 5 minuten hier terug.",
    rateError:
      "Te veel pogingen. Wacht een minuut voordat u het opnieuw probeert.",
    alreadyEnabled:
      "De authenticator is al ingeschakeld. Controleer de status om dit scherm bij te werken.",
    notEnabled:
      "De authenticator is al uitgeschakeld. Controleer de status om dit scherm bij te werken.",
    genericError: "De actie kon niet worden voltooid. Probeer opnieuw.",
  },
};

type MfaStatus = { enabled: boolean; factorRevision: number };
type Enrollment = {
  secret: string;
  issuer: string;
  algorithm: string;
  digits: number;
  period: number;
};
type Flow = "start" | "enroll" | "disable" | null;
const sharedErrorCodes = [
  "NETWORK_ERROR",
  "INVALID_RESPONSE",
  "UNAUTHENTICATED",
  "CSRF_INVALID",
  "INVALID_REQUEST",
  "INTERNAL_ERROR",
] as const;
type Feedback =
  | { key: Message; params?: Record<string, string | number> }
  | { code: (typeof sharedErrorCodes)[number] };

// Keep only semantic, allowlisted feedback in state. In particular, never retain raw server text.
function feedbackForError(
  cause: unknown,
  flow: Flow,
  passwordEnabled: boolean,
): Feedback {
  const code = cause instanceof RequestError ? cause.code : "";
  if (code === "MFA_CONFIGURATION_REQUIRED")
    return { key: "configurationError" };
  if (code === "MFA_VERIFICATION_REQUIRED")
    return {
      key:
        flow === "disable" ? "disableVerificationError" : "verificationError",
    };
  if (code === "REAUTHENTICATION_REQUIRED")
    return { key: passwordEnabled ? "passwordError" : "federatedError" };
  if (code === "RATE_LIMITED") return { key: "rateError" };
  if (code === "MFA_ALREADY_ENABLED") return { key: "alreadyEnabled" };
  if (code === "MFA_NOT_ENABLED") return { key: "notEnabled" };
  const sharedCode = sharedErrorCodes.find((known) => known === code);
  return sharedCode ? { code: sharedCode } : { key: "genericError" };
}

function MfaDialog({
  title,
  closeLabel,
  pending,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current
      ?.querySelector<HTMLElement>("input, button[type=submit]")
      ?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <dialog
      className="mfa-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <Button disabled={pending} onClick={onClose}>
          {closeLabel}
        </Button>
      </div>
      {children}
    </dialog>
  );
}

/** Mount in /account/security after the account is loaded. Remount (key by account id) if the signed-in account changes. */
export function MfaSettings({
  passwordEnabled,
  locale: localeOverride,
}: {
  passwordEnabled: boolean;
  /** Defaults to the shared account localization. */ locale?: string;
}) {
  const localization = useLocalization(),
    locale = resolveLocale(localeOverride ?? localization.locale),
    t = createMessageTranslator(locale, messages);
  const [status, setStatus] = useState<MfaStatus | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<Feedback | null>(null);
  const [flow, setFlow] = useState<Flow>(null),
    [pending, setPending] = useState(false),
    [formError, setFormError] = useState<Feedback | null>(null);
  const [announcement, setAnnouncement] = useState<Feedback | null>(null),
    [codeRequired, setCodeRequired] = useState(false),
    [codeInvalid, setCodeInvalid] = useState(false);
  // Secret-bearing data is deliberately absent from storage, URLs, events, notifications and exports.
  const enrollment = useRef<Enrollment | null>(null),
    mounted = useRef(false),
    mutation = useRef<AbortController | null>(null),
    read = useRef<AbortController | null>(null),
    locked = useRef(false);
  const form = useRef<HTMLFormElement>(null),
    code = useRef<HTMLInputElement>(null),
    success = useRef<HTMLParagraphElement>(null),
    id = useId();
  const clearEnrollment = () => {
    if (enrollment.current) enrollment.current.secret = "";
    enrollment.current = null;
  };
  const feedbackText = (feedback: Feedback) => {
    if ("key" in feedback) return t(feedback.key, feedback.params);
    const cause = new RequestError(feedback.code, feedback.code);
    // These API codes have fixed shared wording; network errors use the safe localized category.
    return locale === "pt-BR" &&
      feedback.code !== "NETWORK_ERROR" &&
      feedback.code !== "INVALID_RESPONSE"
      ? errorMessage(cause)
      : formatError(cause, locale);
  };
  async function loadStatus() {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setStatus(null);
    setError(null);
    try {
      const result = await request<MfaStatus>("/account/mfa", {
        signal: controller.signal,
      });
      if (mounted.current && !controller.signal.aborted) setStatus(result.data);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(feedbackForError(cause, null, passwordEnabled));
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void loadStatus();
    return () => {
      mounted.current = false;
      mutation.current?.abort();
      read.current?.abort();
      clearEnrollment();
      form.current?.reset();
    };
  }, []);
  useEffect(() => {
    if (flow === "enroll") code.current?.focus();
    else if (flow)
      form.current
        ?.querySelector<HTMLElement>("input, button[type=submit]")
        ?.focus();
  }, [flow]);
  useEffect(() => {
    if (announcement && !flow) success.current?.focus();
  }, [announcement, flow]);
  useEffect(() => {
    code.current?.setCustomValidity(codeInvalid ? t("invalidCode") : "");
  }, [codeInvalid, locale]);
  function close() {
    if (locked.current) return;
    clearEnrollment();
    form.current?.reset();
    setFormError(null);
    setCodeRequired(false);
    setCodeInvalid(false);
    setFlow(null);
  }
  function open(next: "start" | "disable") {
    clearEnrollment();
    setFormError(null);
    setAnnouncement(null);
    setCodeRequired(false);
    setCodeInvalid(false);
    setFlow(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || !flow) return;
    const activeFlow = flow,
      data = new FormData(event.currentTarget),
      value = String(data.get("code") ?? "");
    if (
      (activeFlow === "enroll" ||
        (activeFlow === "disable" && (codeRequired || value))) &&
      !/^\d{6}$/.test(value)
    ) {
      code.current?.setCustomValidity(t("invalidCode"));
      setCodeInvalid(true);
      code.current?.reportValidity();
      code.current?.focus();
      return;
    }
    const controller = new AbortController();
    mutation.current = controller;
    locked.current = true;
    setPending(true);
    setFormError(null);
    try {
      if (activeFlow === "start") {
        clearEnrollment();
        const result = await request<Enrollment>(
          "/account/mfa/enrollment/start",
          {
            method: "POST",
            body: passwordEnabled
              ? { currentPassword: String(data.get("currentPassword") ?? "") }
              : {},
            signal: controller.signal,
          },
        );
        if (!mounted.current || controller.signal.aborted) return;
        enrollment.current = result.data;
        form.current?.reset();
        setFlow("enroll");
      } else {
        await request<MfaStatus>(
          activeFlow === "enroll"
            ? "/account/mfa/enrollment/confirm"
            : "/account/mfa/disable",
          {
            method: "POST",
            body:
              activeFlow === "enroll"
                ? { code: value }
                : {
                    ...(passwordEnabled
                      ? {
                          currentPassword: String(
                            data.get("currentPassword") ?? "",
                          ),
                        }
                      : {}),
                    ...(value ? { code: value } : {}),
                  },
            signal: controller.signal,
          },
        );
        if (!mounted.current || controller.signal.aborted) return;
        clearEnrollment();
        form.current?.reset();
        setFlow(null);
        setCodeRequired(false);
        setAnnouncement({
          key: activeFlow === "enroll" ? "activated" : "deactivated",
        });
        await loadStatus();
      }
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      setFormError(feedbackForError(cause, activeFlow, passwordEnabled));
      if (
        cause instanceof RequestError &&
        cause.code === "MFA_VERIFICATION_REQUIRED"
      ) {
        if (activeFlow === "disable") setCodeRequired(true);
        code.current?.focus();
      }
      if (
        cause instanceof RequestError &&
        cause.code === "REAUTHENTICATION_REQUIRED"
      )
        form.current
          ?.querySelector<HTMLInputElement>("input[name=currentPassword]")
          ?.focus();
    } finally {
      locked.current = false;
      if (mounted.current && !controller.signal.aborted) setPending(false);
    }
  }
  const seed = enrollment.current;
  return (
    <section
      className="mfa-settings"
      lang={locale}
      aria-labelledby={id + "-title"}
    >
      <h3 id={id + "-title"}>{t("title")}</h3>
      <p>{t("intro")}</p>
      {announcement && (
        <p className="mfa-status" role="status" ref={success} tabIndex={-1}>
          {feedbackText(announcement)}
        </p>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : error ? (
        <Notice>
          {feedbackText(error)}
          <Button onClick={() => void loadStatus()}>{t("refresh")}</Button>
        </Notice>
      ) : (
        status && (
          <>
            <p className="mfa-status">
              {status.enabled ? t("enabled") : t("disabled")}
            </p>
            <div className="mfa-actions">
              <Button
                disabled={pending || !!flow}
                onClick={() => open(status.enabled ? "disable" : "start")}
              >
                {t(status.enabled ? "disable" : "enable")}
              </Button>
              <Button
                disabled={pending || !!flow}
                onClick={() => void loadStatus()}
              >
                {t("refresh")}
              </Button>
            </div>
          </>
        )
      )}
      {flow && (
        <MfaDialog
          title={t(
            flow === "start"
              ? "startTitle"
              : flow === "enroll"
                ? "enrollTitle"
                : "disableTitle",
          )}
          closeLabel={t("close")}
          pending={pending}
          onClose={close}
        >
          <form
            ref={form}
            className="edit-form mfa-form"
            onSubmit={submit}
            aria-busy={pending}
          >
            {formError && (
              <Notice>
                {feedbackText(formError)}
                <Button
                  disabled={pending}
                  onClick={() => {
                    close();
                    void loadStatus();
                  }}
                >
                  {t("refresh")}
                </Button>
              </Notice>
            )}
            {flow === "enroll" && seed ? (
              <>
                <p>{t("manualHelp")}</p>
                <label className="field">
                  {t("secret")}
                  <textarea
                    className="mfa-secret"
                    value={seed.secret}
                    readOnly
                    rows={2}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={id + "-secret-help"}
                  />
                </label>
                <p className="muted" id={id + "-secret-help"}>
                  {t("secretHelp")}
                </p>
                <p className="muted">
                  {t("parameters", {
                    issuer: seed.issuer,
                    algorithm: seed.algorithm,
                    digits: seed.digits,
                    period: seed.period,
                  })}
                </p>
                <p className="muted">{t("replaces")}</p>
              </>
            ) : (
              <>
                <p>{t(flow === "start" ? "startHelp" : "disableHelp")}</p>
                {passwordEnabled ? (
                  <label className="field">
                    {t("password")}
                    <input
                      key={flow}
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      maxLength={1024}
                      required
                      readOnly={pending}
                    />
                  </label>
                ) : (
                  <p className="muted">{t("federatedHelp")}</p>
                )}
                {flow === "start" && <p className="muted">{t("replaces")}</p>}
              </>
            )}
            {flow !== "start" && (
              <label className="field">
                {t("code")}
                <input
                  key={flow}
                  ref={code}
                  name="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required={flow === "enroll" || codeRequired}
                  readOnly={pending}
                  aria-describedby={id + "-code-help"}
                  onInput={(event) => {
                    event.currentTarget.setCustomValidity("");
                    setCodeInvalid(false);
                  }}
                />
                <small id={id + "-code-help"}>
                  {t(
                    flow === "enroll"
                      ? "codeHint"
                      : codeRequired
                        ? "requiredCode"
                        : "optionalCode",
                  )}
                </small>
              </label>
            )}
            <div className="form-actions mfa-actions">
              <Button disabled={pending} onClick={close}>
                {t("cancel")}
              </Button>
              {flow === "enroll" && (
                <Button
                  disabled={pending}
                  onClick={() => {
                    clearEnrollment();
                    form.current?.reset();
                    setFormError(null);
                    setCodeInvalid(false);
                    setFlow("start");
                  }}
                >
                  {t("newSecret")}
                </Button>
              )}
              <button className="primary" type="submit" disabled={pending}>
                {t(
                  pending
                    ? "pending"
                    : flow === "start"
                      ? "start"
                      : flow === "enroll"
                        ? "confirm"
                        : "disable",
                )}
              </button>
            </div>
          </form>
        </MfaDialog>
      )}
    </section>
  );
}

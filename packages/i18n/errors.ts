import type {Locale} from './index.js';
type Category='authentication'|'denied'|'invalid'|'conflict'|'network'|'generic';
const categories:Category[]=['authentication','denied','invalid','conflict','network','generic'];
const messages:Record<Locale,string[]>={
 'pt-BR':['Entre novamente para continuar.','Você não tem permissão para esta ação.','Revise os campos preenchidos e tente novamente.','Os dados ou o estado foram alterados. Atualize e revise antes de tentar novamente.','Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.','Não foi possível concluir a ação. Tente novamente.'],
 'en-US':['Sign in again to continue.','You do not have permission for this action.','Review the completed fields and try again.','The data or state changed. Refresh and review before trying again.','Unable to connect to the server. Check your connection and try again.','Unable to complete this action. Try again.'],
 'es-ES':['Vuelve a iniciar sesión para continuar.','No tienes permiso para esta acción.','Revisa los campos completados y reintenta.','Los datos o el estado cambiaron. Actualiza y revisa antes de reintentar.','No se pudo conectar al servidor. Comprueba la conexión y reintenta.','No se pudo completar la acción. Reintenta.'],
 'fr-FR':['Reconnectez-vous pour continuer.','Vous n’avez pas l’autorisation pour cette action.','Vérifiez les champs remplis et réessayez.','Les données ou l’état ont changé. Actualisez et vérifiez avant de réessayer.','Connexion au serveur impossible. Vérifiez votre connexion et réessayez.','Impossible de terminer cette action. Réessayez.'],
 'de-DE':['Melden Sie sich erneut an, um fortzufahren.','Sie haben keine Berechtigung für diese Aktion.','Prüfen Sie die ausgefüllten Felder und versuchen Sie es erneut.','Daten oder Zustand wurden geändert. Aktualisieren und prüfen Sie sie vor einem neuen Versuch.','Keine Verbindung zum Server. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.','Die Aktion konnte nicht abgeschlossen werden. Versuchen Sie es erneut.'],
 'it-IT':['Accedi di nuovo per continuare.','Non hai il permesso per questa azione.','Verifica i campi compilati e riprova.','I dati o lo stato sono cambiati. Aggiorna e verifica prima di riprovare.','Impossibile connettersi al server. Verifica la connessione e riprova.','Impossibile completare l’azione. Riprova.'],
 'ja-JP':['続行するには再度ログインしてください。','この操作を行う権限がありません。','入力内容を確認して再試行してください。','データや状態が変更されました。更新して内容を確認してから再試行してください。','サーバーに接続できません。接続を確認して再試行してください。','操作を完了できませんでした。再試行してください。'],
 'nl-NL':['Meld u opnieuw aan om door te gaan.','U hebt geen toestemming voor deze actie.','Controleer de ingevulde velden en probeer opnieuw.','Gegevens of status zijn gewijzigd. Vernieuw en controleer ze voordat u opnieuw probeert.','Geen verbinding met de server. Controleer uw verbinding en probeer opnieuw.','De actie kon niet worden voltooid. Probeer opnieuw.'],
};
const codes:Record<string,Category>={UNAUTHENTICATED:'authentication',CSRF_INVALID:'authentication',REAUTHENTICATION_REQUIRED:'authentication',ACTION_DENIED:'denied',MODULE_DISABLED:'denied',INVALID_REQUEST:'invalid',INVALID_PASSWORD:'invalid',PASSWORD_TOO_SHORT:'invalid',VERSION_CONFLICT:'conflict',PRECONDITION_REQUIRED:'conflict',STATE_CONFLICT:'conflict',IDEMPOTENCY_CONFLICT:'conflict',NETWORK_ERROR:'network',INVALID_RESPONSE:'network'};
export function translatedError(error:unknown,locale:Locale):string{
 const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'?error.code:'';
 return messages[locale][categories.indexOf(codes[code]??'generic')];
}

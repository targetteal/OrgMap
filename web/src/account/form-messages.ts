import { createMessageTranslator, SUPPORTED_LOCALES, type Locale } from '../../../packages/i18n/index.js';

const rows = {
  personalInformation: ['Informações pessoais','Personal information','Información personal','Informations personnelles','Persönliche Angaben','Informazioni personali','個人情報','Persoonlijke gegevens'],
  name: ['Nome','Name','Nombre','Nom','Name','Nome','名前','Naam'],
  email: ['E-mail','Email','Correo electrónico','Adresse e-mail','E-Mail','Email','メールアドレス','E-mail'],
  emailChangeHelp: ['Para alterar, confirme o novo endereço abaixo.','To change it, confirm the new address below.','Para cambiarlo, confirma la nueva dirección abajo.','Pour la modifier, confirmez la nouvelle adresse ci-dessous.','Bestätigen Sie unten die neue Adresse, um sie zu ändern.','Per modificarla, conferma il nuovo indirizzo qui sotto.','変更するには、以下で新しいアドレスを確認してください。','Bevestig hieronder het nieuwe adres om dit te wijzigen.'],
  saving: ['Salvando…','Saving…','Guardando…','Enregistrement…','Wird gespeichert…','Salvataggio…','保存中…','Opslaan…'],
  save: ['Salvar','Save','Guardar','Enregistrer','Speichern','Salva','保存','Opslaan'],
  profileUpdated: ['Nome atualizado.','Name updated.','Nombre actualizado.','Nom mis à jour.','Name aktualisiert.','Nome aggiornato.','名前を更新しました。','Naam bijgewerkt.'],
  sessionsTitle: ['Sessões da conta','Account sessions','Sesiones de la cuenta','Sessions du compte','Kontositzungen','Sessioni dell’account','アカウントのセッション','Accountsessies'],
  sessionsHelp: ['Encerre o acesso em dispositivos que você não usa mais.','End access on devices you no longer use.','Cierra el acceso en dispositivos que ya no usas.','Mettez fin à l’accès sur les appareils que vous n’utilisez plus.','Beenden Sie den Zugriff auf Geräten, die Sie nicht mehr verwenden.','Termina l’accesso sui dispositivi che non usi più.','使用しなくなった端末のアクセスを終了してください。','Beëindig de toegang op apparaten die je niet meer gebruikt.'],
  currentSession: ['Sessão atual','Current session','Sesión actual','Session actuelle','Aktuelle Sitzung','Sessione attuale','現在のセッション','Huidige sessie'],
  otherSession: ['Outra sessão','Other session','Otra sesión','Autre session','Andere Sitzung','Altra sessione','別のセッション','Andere sessie'],
  startedAt: ['Iniciada em','Started on','Iniciada el','Commencée le','Begonnen am','Iniziata il','開始日時','Begonnen op'],
  expiresAt: ['Expira em','Expires on','Caduca el','Expire le','Läuft ab am','Scade il','有効期限','Verloopt op'],
  signOutCurrent: ['Sair desta sessão','Sign out of this session','Cerrar esta sesión','Se déconnecter de cette session','Diese Sitzung abmelden','Esci da questa sessione','このセッションからログアウト','Deze sessie afmelden'],
  revokeSession: ['Encerrar sessão','End session','Cerrar sesión','Terminer la session','Sitzung beenden','Termina sessione','セッションを終了','Sessie beëindigen'],
  sessionEnded: ['Sessão encerrada.','Session ended.','Sesión cerrada.','Session terminée.','Sitzung beendet.','Sessione terminata.','セッションを終了しました。','Sessie beëindigd.'],
  methodsTitle: ['Métodos de autenticação','Authentication methods','Métodos de autenticación','Méthodes d’authentification','Authentifizierungsmethoden','Metodi di autenticazione','認証方法','Authenticatiemethoden'],
  password: ['Senha','Password','Contraseña','Mot de passe','Passwort','Password','パスワード','Wachtwoord'],
  verifiedActive: ['Verificado e ativo','Verified and active','Verificado y activo','Vérifié et actif','Verifiziert und aktiv','Verificato e attivo','確認済み・有効','Geverifieerd en actief'],
  awaitingVerification: ['Aguardando verificação','Awaiting verification','Pendiente de verificación','En attente de vérification','Wartet auf Verifizierung','In attesa di verifica','確認待ち','Wacht op verificatie'],
  inactive: ['Inativo','Inactive','Inactivo','Inactif','Inaktiv','Inattivo','無効','Inactief'],
  passwordEnabled: ['Sua conta pode entrar com senha.','You can sign in to your account with a password.','Puedes acceder a tu cuenta con contraseña.','Vous pouvez accéder à votre compte avec un mot de passe.','Sie können sich mit einem Passwort bei Ihrem Konto anmelden.','Puoi accedere al tuo account con una password.','パスワードでアカウントにログインできます。','Je kunt je met een wachtwoord aanmelden bij je account.'],
  passwordDisabled: ['A entrada por senha está desabilitada.','Password sign-in is disabled.','El acceso con contraseña está desactivado.','La connexion par mot de passe est désactivée.','Die Anmeldung per Passwort ist deaktiviert.','L’accesso con password è disattivato.','パスワードでのログインは無効です。','Aanmelden met een wachtwoord is uitgeschakeld.'],
  changePassword: ['Alterar senha','Change password','Cambiar contraseña','Changer le mot de passe','Passwort ändern','Cambia password','パスワードを変更','Wachtwoord wijzigen'],
  disablePassword: ['Desabilitar senha','Disable password','Desactivar contraseña','Désactiver le mot de passe','Passwort deaktivieren','Disattiva password','パスワードを無効化','Wachtwoord uitschakelen'],
  disableLocalPassword: ['Desabilitar senha local','Disable local password','Desactivar contraseña local','Désactiver le mot de passe local','Lokales Passwort deaktivieren','Disattiva password locale','ローカルパスワードを無効化','Lokaal wachtwoord uitschakelen'],
  alternateMethodRequired: ['É necessário outro método de autenticação verificado e operacional.','Another verified, working authentication method is required.','Se necesita otro método de autenticación verificado y operativo.','Une autre méthode d’authentification vérifiée et fonctionnelle est nécessaire.','Eine andere verifizierte und funktionierende Anmeldemethode ist erforderlich.','È necessario un altro metodo di autenticazione verificato e funzionante.','確認済みで利用可能な別の認証方法が必要です。','Een andere geverifieerde en werkende authenticatiemethode is vereist.'],
  keepPassword: ['Mantenha a senha enquanto ela for seu único método verificado de entrada.','Keep your password while it is your only verified sign-in method.','Conserva la contraseña mientras sea tu único método de acceso verificado.','Conservez votre mot de passe tant qu’il s’agit de votre seule méthode de connexion vérifiée.','Behalten Sie Ihr Passwort, solange es Ihre einzige verifizierte Anmeldemethode ist.','Mantieni la password finché è l’unico metodo di accesso verificato.','確認済みのログイン方法がパスワードだけの場合は、パスワードを保持してください。','Behoud je wachtwoord zolang dit je enige geverifieerde aanmeldmethode is.'],
  currentPassword: ['Senha atual','Current password','Contraseña actual','Mot de passe actuel','Aktuelles Passwort','Password attuale','現在のパスワード','Huidig wachtwoord'],
  newPassword: ['Nova senha','New password','Nueva contraseña','Nouveau mot de passe','Neues Passwort','Nuova password','新しいパスワード','Nieuw wachtwoord'],
  passwordLength: ['Use pelo menos 12 caracteres.','Use at least 12 characters.','Usa al menos 12 caracteres.','Utilisez au moins 12 caractères.','Verwenden Sie mindestens 12 Zeichen.','Usa almeno 12 caratteri.','12文字以上にしてください。','Gebruik ten minste 12 tekens.'],
  cancel: ['Cancelar','Cancel','Cancelar','Annuler','Abbrechen','Annulla','キャンセル','Annuleren'],
  close: ['Fechar','Close','Cerrar','Fermer','Schließen','Chiudi','閉じる','Sluiten'],
  passwordChanged: ['Senha alterada e outras sessões encerradas.','Password changed and other sessions ended.','Contraseña cambiada y otras sesiones cerradas.','Mot de passe modifié et autres sessions terminées.','Passwort geändert und andere Sitzungen beendet.','Password cambiata e altre sessioni terminate.','パスワードを変更し、他のセッションを終了しました。','Wachtwoord gewijzigd en andere sessies beëindigd.'],
  localPasswordDisabled: ['Senha local desabilitada.','Local password disabled.','Contraseña local desactivada.','Mot de passe local désactivé.','Lokales Passwort deaktiviert.','Password locale disattivata.','ローカルパスワードを無効にしました。','Lokaal wachtwoord uitgeschakeld.'],
} as const satisfies Record<string, readonly [string,string,string,string,string,string,string,string]>;

export type AccountFormMessage = keyof typeof rows;
export const accountFormMessages = Object.fromEntries(SUPPORTED_LOCALES.map((locale,index) => [
  locale, Object.fromEntries(Object.entries(rows).map(([key,values]) => [key,values[index]])),
])) as Record<Locale,Record<AccountFormMessage,string>>;
export const accountFormTranslator = (locale:string) => createMessageTranslator(locale,accountFormMessages);

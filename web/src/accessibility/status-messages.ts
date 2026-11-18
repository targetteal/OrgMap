import type {Locale} from '../../../packages/i18n';
type Key='enabled'|'enabledFeminine'|'disabled'|'disabledFeminine'|'resetHeading'|'resetHelper';
export const accessibilityStatusMessages:Record<Locale,Record<Key,string>>={
 'pt-BR':{enabled:'Ativado',enabledFeminine:'Ativada',disabled:'Desativado',disabledFeminine:'Desativada',resetHeading:'Redefinir',resetHelper:'Restaurar as preferências de acessibilidade padrão para este navegador.'},
 'en-US':{enabled:'Enabled',enabledFeminine:'Enabled',disabled:'Disabled',disabledFeminine:'Disabled',resetHeading:'Reset',resetHelper:'Restore default accessibility preferences for this browser.'},
 'es-ES':{enabled:'Activado',enabledFeminine:'Activada',disabled:'Desactivado',disabledFeminine:'Desactivada',resetHeading:'Restablecer',resetHelper:'Restaurar las preferencias de accesibilidad predeterminadas para este navegador.'},
 'fr-FR':{enabled:'Activé',enabledFeminine:'Activée',disabled:'Désactivé',disabledFeminine:'Désactivée',resetHeading:'Réinitialiser',resetHelper:'Rétablir les préférences d’accessibilité par défaut pour ce navigateur.'},
 'de-DE':{enabled:'Aktiviert',enabledFeminine:'Aktiviert',disabled:'Deaktiviert',disabledFeminine:'Deaktiviert',resetHeading:'Zurücksetzen',resetHelper:'Die Standardeinstellungen zur Barrierefreiheit für diesen Browser wiederherstellen.'},
 'it-IT':{enabled:'Attivato',enabledFeminine:'Attivata',disabled:'Disattivato',disabledFeminine:'Disattivata',resetHeading:'Ripristina',resetHelper:'Ripristinare le preferenze di accessibilità predefinite per questo browser.'},
 'ja-JP':{enabled:'有効',enabledFeminine:'有効',disabled:'無効',disabledFeminine:'無効',resetHeading:'リセット',resetHelper:'このブラウザーのアクセシビリティ設定を標準に戻します。'},
 'nl-NL':{enabled:'Ingeschakeld',enabledFeminine:'Ingeschakeld',disabled:'Uitgeschakeld',disabledFeminine:'Uitgeschakeld',resetHeading:'Herstellen',resetHelper:'De standaardvoorkeuren voor toegankelijkheid voor deze browser herstellen.'},
};

import { createMessageTranslator, type Locale } from '../../../../packages/i18n';

const messages: Record<Locale, Record<'claim' | 'explain' | 'confirm', string>> = {
  'pt-BR': { claim: 'Assumir secretaria', explain: 'Confirme que você está presente, que a secretaria está ausente e que as pessoas presentes combinaram sua substituição nesta reunião. Sua presença será registrada.', confirm: 'Confirmar e assumir' },
  'en-US': { claim: 'Take the secretary role', explain: 'Confirm that you are present, the secretary is absent and those present agreed to your taking the role. Your attendance will be recorded.', confirm: 'Confirm and take role' },
  'es-ES': { claim: 'Asumir la secretaría', explain: 'Confirma que la secretaría está ausente y que las personas presentes acordaron tu sustitución en esta reunión.', confirm: 'Confirmar y asumir' },
  'fr-FR': { claim: 'Assumer le secrétariat', explain: 'Confirmez que la personne secrétaire est absente et que les personnes présentes ont convenu de votre remplacement pour cette réunion.', confirm: 'Confirmer et assumer' },
  'de-DE': { claim: 'Sekretariat übernehmen', explain: 'Bestätigen Sie, dass die sekretariatsführende Person abwesend ist und die Anwesenden Ihrer Vertretung zugestimmt haben.', confirm: 'Bestätigen und übernehmen' },
  'it-IT': { claim: 'Assumere la segreteria', explain: 'Conferma che la persona segretaria è assente e che i presenti hanno concordato la tua sostituzione per questa riunione.', confirm: 'Conferma e assumi' },
  'ja-JP': { claim: '書記を引き受ける', explain: '書記が不在で、出席者がこの会議であなたが代行することに同意したことを確認してください。', confirm: '確認して引き受ける' },
  'nl-NL': { claim: 'Secretarisrol opnemen', explain: 'Bevestig dat de secretaris afwezig is en de aanwezigen uw vervanging voor deze vergadering hebben afgesproken.', confirm: 'Bevestigen en opnemen' },
};
export const secretaryClaimTranslator = (locale: string) => createMessageTranslator(locale, messages);
const facilitatorMessages:Record<Locale,Record<'name'|'assign',string>>={
 'pt-BR':{name:'Facilitador',assign:'Definir facilitador'},'en-US':{name:'Facilitator',assign:'Set facilitator'},
 'es-ES':{name:'Facilitador',assign:'Definir facilitador'},'fr-FR':{name:'Facilitateur',assign:'Définir le facilitateur'},
 'de-DE':{name:'Moderation',assign:'Moderation festlegen'},'it-IT':{name:'Facilitatore',assign:'Imposta facilitatore'},
 'ja-JP':{name:'ファシリテーター',assign:'ファシリテーターを設定'},'nl-NL':{name:'Facilitator',assign:'Facilitator instellen'},
};
export const facilitatorTranslator=(locale:string)=>createMessageTranslator(locale,facilitatorMessages);

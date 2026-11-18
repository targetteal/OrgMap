import {formatNumber,pluralKey,resolveLocale,type Locale} from '../../../../packages/i18n';
export type GovernanceCountKind='proposals'|'documents'|'tensions'|'records'|'evolutions'|'participants';
const messages:Record<Locale,Record<GovernanceCountKind,readonly[string,string]>>={
 'pt-BR':{proposals:['{count} proposta','{count} propostas'],documents:['{count} acordo','{count} acordos'],tensions:['{count} tensão','{count} tensões'],records:['{count} registro','{count} registros'],evolutions:['{count} alteração','{count} alterações'],participants:['{count} participante','{count} participantes']},
 'en-US':{proposals:['{count} proposal','{count} proposals'],documents:['{count} agreement','{count} agreements'],tensions:['{count} tension','{count} tensions'],records:['{count} record','{count} records'],evolutions:['{count} change','{count} changes'],participants:['{count} participant','{count} participants']},
 'es-ES':{proposals:['{count} propuesta','{count} propuestas'],documents:['{count} acuerdo','{count} acuerdos'],tensions:['{count} tensión','{count} tensiones'],records:['{count} registro','{count} registros'],evolutions:['{count} cambio','{count} cambios'],participants:['{count} participante','{count} participantes']},
 'fr-FR':{proposals:['{count} proposition','{count} propositions'],documents:['{count} accord','{count} accords'],tensions:['{count} tension','{count} tensions'],records:['{count} entrée','{count} entrées'],evolutions:['{count} modification','{count} modifications'],participants:['{count} participant','{count} participants']},
 'de-DE':{proposals:['{count} Vorschlag','{count} Vorschläge'],documents:['{count} Vereinbarung','{count} Vereinbarungen'],tensions:['{count} Spannung','{count} Spannungen'],records:['{count} Eintrag','{count} Einträge'],evolutions:['{count} Änderung','{count} Änderungen'],participants:['{count} teilnehmende Person','{count} teilnehmende Personen']},
 'it-IT':{proposals:['{count} proposta','{count} proposte'],documents:['{count} accordo','{count} accordi'],tensions:['{count} tensione','{count} tensioni'],records:['{count} voce','{count} voci'],evolutions:['{count} modifica','{count} modifiche'],participants:['{count} partecipante','{count} partecipanti']},
 'ja-JP':{proposals:['提案{count}件','提案{count}件'],documents:['合意{count}件','合意{count}件'],tensions:['テンション{count}件','テンション{count}件'],records:['記録{count}件','記録{count}件'],evolutions:['変更{count}件','変更{count}件'],participants:['参加者{count}人','参加者{count}人']},
 'nl-NL':{proposals:['{count} voorstel','{count} voorstellen'],documents:['{count} afspraak','{count} afspraken'],tensions:['{count} spanning','{count} spanningen'],records:['{count} vermelding','{count} vermeldingen'],evolutions:['{count} wijziging','{count} wijzigingen'],participants:['{count} deelnemer','{count} deelnemers']},
};
export function formatGovernanceCount(value:number,kind:GovernanceCountKind,locale:string){
 const resolved=resolveLocale(locale);
 const singular=value!==0 && pluralKey(value,resolved)==='one';
 return messages[resolved][kind][singular?0:1].replace('{count}',formatNumber(value,{locale:resolved}));
}

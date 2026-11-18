/** Fixed synthetic examples for QA. Product focus reading is restricted to approved translation keys below. */
export const SPEECH_EXAMPLES: Record<string,string> = {
 'pt-BR':'Este é um exemplo de leitura do OrgMap.', 'en-US':'This is an OrgMap reading example.',
 'es-ES':'Este es un ejemplo de lectura de OrgMap.', 'fr-FR':'Ceci est un exemple de lecture d’OrgMap.',
 'de-DE':'Dies ist ein Lesebeispiel von OrgMap.', 'it-IT':'Questo è un esempio di lettura di OrgMap.',
 'ja-JP':'これはOrgMapの読み上げサンプルです。', 'nl-NL':'Dit is een leesvoorbeeld van OrgMap.',
};
/** Only published translation keys can be read on focus; never inspect textContent, input values or selection. */
export function safeSpeechKey(element:Element,keys:ReadonlySet<string>):string|null{
 if(element.closest('[data-sensitive],[data-private],[aria-hidden="true"],[hidden],[contenteditable=true]'))return null;
 if(element.matches('input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]'))return null;
 const key=element.getAttribute('data-orgmap-speech-key');return key&&keys.has(key)?key:null;
}
export function selectSpeechVoice(voices:SpeechSynthesisVoice[],locale:string):SpeechSynthesisVoice|undefined {
  return voices.find(v=>v.lang.toLowerCase()===locale.toLowerCase()) ?? voices.find(v=>v.lang.split('-')[0].toLowerCase()===locale.split('-')[0].toLowerCase());
}
export function speechCapability(host:{speechSynthesis:Pick<SpeechSynthesis,'getVoices'>;SpeechSynthesisUtterance:unknown}|undefined,locale:string) {
  if(!host || !('speechSynthesis' in host) || !('SpeechSynthesisUtterance' in host)) return {available:false,voice:undefined};
  const voice=selectSpeechVoice(host.speechSynthesis.getVoices(),locale);
  return {available:!!voice,voice};
}

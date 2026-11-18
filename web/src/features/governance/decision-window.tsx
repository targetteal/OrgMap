import {useEffect,useState} from 'react';

const locales=['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL'];
const waiting=['Aguardando o prazo de consentimento até {date}.','Waiting for the consent deadline until {date}.','Esperando el plazo de consentimiento hasta {date}.','En attente de la fin du délai de consentement : {date}.','Die Zustimmungsfrist läuft bis {date}.','In attesa della scadenza del consenso: {date}.','同意の期限（{date}）を待っています。','Wachten tot de instemmingstermijn op {date}.'];
const unavailable=['Prazo indisponível. Atualize para verificar.','Deadline unavailable. Refresh to check.','Plazo no disponible. Actualiza para comprobarlo.','Délai indisponible. Actualisez pour vérifier.','Frist nicht verfügbar. Zum Prüfen aktualisieren.','Scadenza non disponibile. Aggiorna per verificare.','期限を確認できません。更新してください。','Termijn niet beschikbaar. Vernieuw om te controleren.'];
export function DecisionWindow({method,deadline,clock,locale,formatInstant,disabled,onDecide,label}:{method:string;deadline?:string|null;clock:{asOf:string;receivedAt:number}|null;locale:string;formatInstant:(value:string)=>string;disabled:boolean;onDecide:()=>void;label:string}){
 const [,tick]=useState(0);
 const end=deadline?Date.parse(deadline):NaN,base=clock?Date.parse(clock.asOf):NaN;
 const remaining=Number.isFinite(end)&&Number.isFinite(base)&&clock?end-base-(performance.now()-clock.receivedAt):NaN;
 const pending=method==='CONSENT_WINDOW'&&(!Number.isFinite(remaining)||remaining>0);
 useEffect(()=>{if(method!=='CONSENT_WINDOW'||!Number.isFinite(remaining)||remaining<=0)return;const timer=setTimeout(()=>tick(v=>v+1),Math.min(Math.max(1,Math.ceil(remaining)),2147483647));return()=>clearTimeout(timer);},[method,deadline,clock,remaining]);
 const language=Math.max(0,locales.indexOf(locale));
 return <>{pending&&<p role="status">{Number.isFinite(remaining)&&deadline?waiting[language].replace('{date}',formatInstant(deadline)):unavailable[language]}</p>}<button type="button" className={!disabled&&!pending?'primary':undefined} disabled={disabled||pending} onClick={onDecide}>{label}</button></>;
}

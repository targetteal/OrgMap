import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LocalizationProvider} from '../localization';
import {GlobalAccessibilityProvider,AccessibilitySettings,useAccessibility} from './index';
import '../styles.css';
import './verification.css';
const sample=new URL('./assets/pointer.svg',import.meta.url).href;
function Samples(){
 const {effectiveReducedMotion}=useAccessibility();
 const moving=useRef<HTMLDivElement>(null),frame=useRef(0);
 useEffect(()=>{
  if(effectiveReducedMotion)return;
  let id=0;const tick=()=>{frame.current++;if(moving.current){moving.current.style.transform=`translateX(${frame.current%180}px)`;moving.current.dataset.frame=String(frame.current);}id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
 },[effectiveReducedMotion]);
 return <section className="a11y-verification-samples" aria-labelledby="samples-title">
  <h2 id="samples-title">Amostras sintéticas de teste</h2>
  <p>Esta fixture verifica capacidades isoladas. Não é uma tela de produto nem aceite dos módulos ou de WCAG.</p>
  <div className="a11y-verification-images"><figure><img id="ordinary-sample" src={sample} alt="Seta sintética comum" width="40" height="48"/><figcaption>Imagem comum</figcaption></figure><figure><img id="essential-sample" data-a11y-essential src={sample} alt="Seta sintética essencial" width="40" height="48"/><figcaption>Imagem essencial</figcaption></figure></div>
  <p id="motion-status">Movimento JS: {effectiveReducedMotion?'pausado':'ativo'}</p><div className="a11y-verification-track"><div id="moving-sample" ref={moving} className="a11y-verification-block" aria-hidden="true"/></div>
  <p><a href="#samples-title">Link de leitura sintético</a></p>
  <label>Campo sintético privado, excluído de TTS<input type="password" data-private defaultValue="synthetic-only-do-not-read" readOnly/></label>
 </section>;
}
function Verification(){
 const [locale,setLocale]=useState('pt-BR');
 return <LocalizationProvider accountId="synthetic-capability-qa" preferences={{locale}}><GlobalAccessibilityProvider accountId="synthetic-capability-qa" organizationId="fixture"><main className="a11y-verification"><header><h1>Fixture sintética — não é aceite integrado</h1><label>Idioma da fixture<select value={locale} onChange={e=>setLocale(e.target.value)}><option value="pt-BR">Português</option><option value="en-US">English</option><option value="de-DE">Deutsch</option><option value="ja-JP">日本語</option></select></label></header><Samples/><AccessibilitySettings/></main></GlobalAccessibilityProvider></LocalizationProvider>;
}
createRoot(document.getElementById('root')!).render(<Verification/>);

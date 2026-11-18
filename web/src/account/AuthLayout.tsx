import {useId,useState,type ReactNode} from 'react';
import {AlertCircle,CheckCircle2,Eye,EyeOff,LoaderCircle} from 'lucide-react';
import type {Locale} from '../../../packages/i18n/index.js';
import {OrgMapBrand} from '../OrgMapBrand';
import {PublicLanguageSelector} from './PublicLanguageSelector';
import {publicAuthTranslator} from './public-auth-messages';

/**
 * Public entry composition: product identity with a static, illustrative circle map
 * beside the form on wide screens; one clean column on narrow screens.
 * The map is decorative and never carries organization data.
 */
export function AuthLayout({locale,onLocaleChange,children,background,onBackgroundError,embedded=false}:{
 locale:Locale;
 /** Omit when the embedded page renders its own language control. */
 onLocaleChange?:(locale:Locale)=>void;
 children:ReactNode;
 /** Public organization entry image, shown in place of the illustrative map. */
 background?:string|null;
 onBackgroundError?:()=>void;
 /** The child renders its own <main>; the layout must not add another landmark. */
 embedded?:boolean;
}){
 const a=publicAuthTranslator(locale);
 const Root=embedded?'div':'main';
 return <Root className={'auth-page auth-split'+(background?' auth-page-branded':'')+(embedded?' auth-split-embedded':'')}>
  <div className="auth-identity">
   <OrgMapBrand className="auth-brand"/>
   {background
    ? <img className="auth-background" src={background} alt="" onError={onBackgroundError}/>
    : <AuthMap/>}
   <p className="auth-identity-line">{a('identityLine')}</p>
  </div>
  <div className="auth-main">
   {!embedded && <div className="auth-main-head">
    <OrgMapBrand className="auth-brand auth-brand-compact"/>
    {onLocaleChange && <PublicLanguageSelector locale={locale} onChange={onLocaleChange}/>}
   </div>}
   <div className="auth-panel">{children}</div>
  </div>
 </Root>;
}

/** Static illustration in the language of the map: nested circles, white roles, one selected role. */
function AuthMap(){
 const roles:[number,number,number][]=[[120,150,12],[152,172,12],[215,230,16],[225,150,16],[150,265,16],[310,290,16],[335,355,16],[320,130,14],[352,152,14],[128,342,12],[155,360,12]];
 return <svg className="auth-map" viewBox="0 0 480 480" aria-hidden="true" focusable="false">
  <circle className="auth-map-l1" cx="240" cy="240" r="220"/>
  <circle className="auth-map-l2" cx="170" cy="190" r="110"/>
  <circle className="auth-map-l3" cx="135" cy="160" r="45"/>
  <circle className="auth-map-l2" cx="340" cy="315" r="88"/>
  <circle className="auth-map-l2" cx="335" cy="140" r="55"/>
  <circle className="auth-map-l2" cx="140" cy="350" r="45"/>
  {roles.map(([cx,cy,r])=><circle key={cx+'-'+cy} className="auth-map-role" cx={cx} cy={cy} r={r}/>)}
  <circle className="auth-map-selected" cx="370" cy="300" r="16"/>
 </svg>;
}

export function AuthNotice({children,tone='error',id}:{children:ReactNode;tone?:'error'|'success';id?:string}){
 const Icon=tone==='error'?AlertCircle:CheckCircle2;
 return <div id={id} className={'auth-notice auth-notice-'+tone} role={tone==='error'?'alert':undefined}>
  <Icon size={18} aria-hidden="true"/>
  <div>{children}</div>
 </div>;
}

/** Primary submit with the label preserved while waiting; progress is announced politely. */
export function AuthSubmit({busy,label,waitLabel}:{busy:boolean;label:string;waitLabel:string}){
 return <>
  <button className="primary auth-submit" disabled={busy} aria-busy={busy||undefined}>
   {busy && <LoaderCircle className="auth-spinner" size={18} aria-hidden="true"/>}
   <span>{label}</span>
  </button>
  <span className="auth-visually-hidden" aria-live="polite">{busy?waitLabel:''}</span>
 </>;
}

export function AuthPasswordField({label,showLabel,name,autoComplete,minLength,maxLength,help,invalid,describedBy}:{
 label:string;showLabel:string;name:string;autoComplete:string;minLength?:number;maxLength?:number;help?:string;invalid?:boolean;describedBy?:string;
}){
 const id=useId(),helpId=useId();
 const [visible,setVisible]=useState(false);
 const described=[help?helpId:'',describedBy??''].filter(Boolean).join(' ')||undefined;
 return <div className={'field auth-field'+(invalid?' auth-field-invalid':'')}>
  <label htmlFor={id}>{label}</label>
  <div className="auth-password">
   <input id={id} name={name} type={visible?'text':'password'} aria-label={label} required minLength={minLength} maxLength={maxLength}
    aria-describedby={described} aria-invalid={invalid||undefined} autoComplete={autoComplete} spellCheck={false} autoCapitalize="none"/>
   <button type="button" className="auth-reveal" aria-label={showLabel} aria-pressed={visible} onClick={()=>setVisible(value=>!value)}>
    {visible?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}
   </button>
  </div>
  {help && <small id={helpId}>{help}</small>}
 </div>;
}

export function AuthTextField({label,name,type='text',autoComplete,maxLength,invalid,describedBy,inputMode}:{
 label:string;name:string;type?:string;autoComplete?:string;maxLength?:number;invalid?:boolean;describedBy?:string;inputMode?:'email'|'text';
}){
 const id=useId();
 return <div className={'field auth-field'+(invalid?' auth-field-invalid':'')}>
  <label htmlFor={id}>{label}</label>
  <input id={id} name={name} type={type} required maxLength={maxLength} autoComplete={autoComplete} inputMode={inputMode}
   aria-invalid={invalid||undefined} aria-describedby={describedBy} spellCheck={type==='email'?false:undefined} autoCapitalize={type==='email'?'none':undefined}/>
 </div>;
}

import {Languages} from 'lucide-react';
import {LOCALE_LABELS,SUPPORTED_LOCALES,type Locale} from '../../../packages/i18n/index.js';
import {publicAuthTranslator} from './public-auth-messages';

/** Compact language control for public pages; the visible icon is decorative and the label stays accessible. */
export function PublicLanguageSelector({locale,onChange}:{locale:Locale;onChange:(locale:Locale)=>void}){
 const t=publicAuthTranslator(locale);
 return <label className="auth-language">
  <span className="auth-visually-hidden">{t('language')}</span>
  <Languages size={16} aria-hidden="true"/>
  <select value={locale} onChange={event=>onChange(event.target.value as Locale)}>
   {SUPPORTED_LOCALES.map(option=><option value={option} key={option}>{LOCALE_LABELS[option]}</option>)}
  </select>
 </label>;
}

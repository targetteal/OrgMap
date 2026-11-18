import { catalogs, type MessageKey } from './messages.js';
import {translatedError} from './errors.js';
export { catalogs, type MessageKey } from './messages.js';

export const SUPPORTED_LOCALES = ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'ja-JP', 'nl-NL'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];
export function formatError(error:unknown,locale?:string):string{return translatedError(error,resolveLocale(locale));}
export const LOCALE_LABELS: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)', 'en-US': 'English', 'es-ES': 'Español', 'fr-FR': 'Français',
  'de-DE': 'Deutsch', 'it-IT': 'Italiano', 'ja-JP': '日本語', 'nl-NL': 'Nederlands',
};
export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type RegionalPreferences = { locale: string; timeZone: string; dateFormat: string; reducedMotion?: boolean };
export const DEFAULT_PREFERENCES: Readonly<RegionalPreferences> = Object.freeze({locale: 'pt-BR', timeZone: 'America/Sao_Paulo', dateFormat: 'DD/MM/YYYY', reducedMotion: false});

/** Product fallback: supported language maps to its canonical locale; unknown maps to pt-BR. */
export function resolveLocale(value?: string | null): Locale {
  try {
    const canonical = Intl.getCanonicalLocales(value ?? '')[0];
    return SUPPORTED_LOCALES.find(l => l === canonical) ?? SUPPORTED_LOCALES.find(l => l.split('-')[0] === canonical?.split('-')[0]) ?? 'pt-BR';
  } catch { return 'pt-BR'; }
}
export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return true; } catch { return false; }
}
export function normalizePreferences(value?: Partial<RegionalPreferences> | null): RegionalPreferences & {locale: Locale; dateFormat: DateFormat} {
  return {
    locale: resolveLocale(value?.locale),
    timeZone: value?.timeZone && validTimeZone(value.timeZone) ? value.timeZone : DEFAULT_PREFERENCES.timeZone,
    dateFormat: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(value?.dateFormat ?? '') ? value!.dateFormat as DateFormat : 'DD/MM/YYYY',
    reducedMotion: value?.reducedMotion === true,
  };
}
export type Catalog = Partial<Record<MessageKey, string>>;
function ownMessage(dictionary:object|undefined,key:string):string|undefined {
  if(!dictionary||!Object.hasOwn(dictionary,key))return undefined;
  const value=(dictionary as Record<string,unknown>)[key];
  return typeof value==='string'&&value.length>0?value:undefined;
}
/** Feature owners keep their own keys/catalogs. Missing locale entries fall back to pt-BR, then the key. */
export function createMessageTranslator<K extends string>(locale:string,dictionaries:{'pt-BR':Record<K,string>} & Partial<Record<Locale,Partial<Record<K,string>>>>) {
  const resolved=resolveLocale(locale);
  return (key:K,params:Record<string,string|number>={})=>{
    const message=ownMessage(dictionaries[resolved],key)??ownMessage(dictionaries['pt-BR'],key)??key;
    return message.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]):token);
  };
}
export function createTranslator(locale: string, overrides?: Catalog) {
  const resolved = resolveLocale(locale);
  const message = (key: MessageKey) => ownMessage(overrides,key)??ownMessage(catalogs[resolved],key)??ownMessage(catalogs['pt-BR'],key)??key;
  return {
    locale: resolved,
    t(key: MessageKey, params: Record<string, string | number> = {}): string {
      return message(key).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
    },
  };
}
const missing = '—';
const pad = (n: number) => String(n).padStart(2, '0');
function orderedDate(year: string, month: string, day: string, format: string): string {
  return format === 'YYYY-MM-DD' ? `${year}-${month}-${day}` : format === 'MM/DD/YYYY' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}
/** A civil date never passes through the device timezone. Reject rollover and timestamps. */
export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y,m,d] = value.split('-').map(Number);
  const date = new Date(0); date.setUTCHours(12,0,0,0); date.setUTCFullYear(y,m-1,d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d ? date : null;
}
export function formatDate(value: string | null | undefined, preferences?: Partial<RegionalPreferences>, options?: Intl.DateTimeFormatOptions): string {
  const date = value ? parseDateOnly(value) : null;
  if (!date) return missing;
  const p = normalizePreferences(preferences);
  if (options) return new Intl.DateTimeFormat(p.locale, {...options, timeZone:'UTC', calendar:'gregory'}).format(date);
  return orderedDate(String(date.getUTCFullYear()).padStart(4,'0'), pad(date.getUTCMonth()+1),pad(date.getUTCDate()),p.dateFormat);
}
/** Only ISO timestamps with explicit offset/Z or Date instances are instants. */
export function parseInstant(value: string | Date | null | undefined): Date | null {
  if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return null;
  if (typeof value === 'string' && !parseDateOnly(value.slice(0,10))) return null;
  if (typeof value === 'string') {
    const time=value.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/)!;
    if(Number(time[1])>23||Number(time[2])>59||Number(time[3]??0)>59)return null;
  }
  const date = new Date(value as string | Date); return Number.isFinite(date.getTime()) ? date : null;
}
export function formatInstant(value: string | Date | null | undefined, preferences?: Partial<RegionalPreferences>, includeTime = true, options?: Intl.DateTimeFormatOptions): string {
  const date = parseInstant(value); if (!date) return missing;
  const p = normalizePreferences(preferences);
  if (options) return new Intl.DateTimeFormat(p.locale,{...options,timeZone:p.timeZone,calendar:'gregory'}).format(date);
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:p.timeZone,calendar:'gregory'}).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const result = orderedDate(part('year'),part('month'),part('day'),p.dateFormat);
  return includeTime ? `${result} ${new Intl.DateTimeFormat(p.locale,{hour:'2-digit',minute:'2-digit',timeZone:p.timeZone}).format(date)}` : result;
}
export function formatNumber(value: number | null | undefined, preferences?: Partial<RegionalPreferences>, options?: Intl.NumberFormatOptions): string {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat(resolveLocale(preferences?.locale), options).format(value) : missing;
}
export function compareText(a: string, b: string, locale?: string): number { return new Intl.Collator(resolveLocale(locale), {numeric:true, sensitivity:'base'}).compare(a,b); }
/** Canonical civil key for calendars/filters. Never parse a localized display string back into a date. */
export function dateAtInstant(value:string|Date,preferences?:Partial<RegionalPreferences>):string|null {
  return parseInstant(value)?formatInstant(value,{...preferences,dateFormat:'YYYY-MM-DD'},false):null;
}
export function pluralKey(count: number, locale: string): Intl.LDMLPluralRule { return new Intl.PluralRules(resolveLocale(locale)).select(count); }

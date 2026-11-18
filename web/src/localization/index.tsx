import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { request } from '../api';
import { createTranslator, normalizePreferences, formatDate, formatInstant, formatNumber, compareText, formatError, dateAtInstant, type RegionalPreferences } from '../../../packages/i18n';
export * from '../../../packages/i18n';

export function localizationValue(preferences?: Partial<RegionalPreferences> | null) {
  const prefs = normalizePreferences(preferences);
  return {
    prefs, ...createTranslator(prefs.locale),
    formatDate: (value: string | null | undefined, options?: Intl.DateTimeFormatOptions) => formatDate(value,prefs,options),
    formatInstant: (value: string | Date | null | undefined, includeTime = true, options?: Intl.DateTimeFormatOptions) => formatInstant(value,prefs,includeTime,options),
    formatNumber: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => formatNumber(value,prefs,options),
    compareText: (a: string,b: string) => compareText(a,b,prefs.locale),
    formatError: (error:unknown) => formatError(error,prefs.locale),
    dateAtInstant:(value:string|Date)=>dateAtInstant(value,prefs),
  };
}
const LocalizationContext = createContext({...localizationValue(), loading:false, error:'', refresh:()=>{}});
export function useLocalization() { return useContext(LocalizationContext); }
/** Mount once around authenticated shell; accountId invalidates requests and all previous preferences. */
export function LocalizationProvider({accountId,preferences,children}: {accountId?: string | null; preferences?: Partial<RegionalPreferences> | null; children:ReactNode}) {
  const [revision,setRevision] = useState(0);
  const [state,setState] = useState<{accountId:string; preferences?: RegionalPreferences; loading:boolean; error:unknown}>({accountId:'',loading:false,error:''});
  const controlled = preferences !== undefined;
  useEffect(()=> {
    const update = () => setRevision(v=>v+1);
    window.addEventListener('orgmap:preferences-changed',update);
    return ()=>window.removeEventListener('orgmap:preferences-changed',update);
  },[]);
  useEffect(()=> {
    if (controlled || !accountId) return;
    const ctrl = new AbortController();
    setState(previous=>({accountId,preferences:previous.accountId === accountId ? previous.preferences : undefined,loading:true,error:''}));
    request<{preferences:RegionalPreferences}>('/account/preferences',{signal:ctrl.signal})
      .then(result=>{ if(!ctrl.signal.aborted) setState({accountId,preferences:result.data.preferences,loading:false,error:''}); })
      .catch(error=>{ if(!ctrl.signal.aborted) setState(previous=>({...previous,accountId,loading:false,error})); });
    return ()=>ctrl.abort();
  },[accountId,revision,controlled]);
  const current = controlled ? preferences : state.accountId === accountId ? state.preferences : undefined;
  const value = useMemo(()=>({...localizationValue(current), loading: !controlled && !!accountId && (state.accountId !== accountId || state.loading), error:!controlled && state.accountId === accountId && state.error ? formatError(state.error,current?.locale) : '',refresh:()=>setRevision(v=>v+1)}),[current,controlled,accountId,state]);
  useEffect(()=> {
    const root = document.documentElement, before = root.lang;
    root.lang = value.locale;
    return ()=>{ root.lang = before; };
  },[value.locale]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

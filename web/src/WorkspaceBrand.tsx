import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { request } from './api';
import './workspace-brand.css';

type Brand = {
  asset: { origin: 'NONE' | 'UPLOADED' | 'LEGACY_EXTERNAL'; revision: number; readUrl: string | null; legacyUrl?: string | null };
  appearance: { color: string; showOrganizationName: boolean; colorTheme?: "mare" | "cobalto" | "argila" | "grafite" };
};
const BrandContext = createContext<{ scope: string; brand: Brand | null } | null>(null);
const themeChoices=['mare','cobalto','argila','grafite'];
export function previewOrganizationTheme(organizationId:string,accountId:string,theme:string|null){
  window.dispatchEvent(new window.CustomEvent('orgmap:theme-preview',{detail:{organizationId,accountId,theme}}));
}
function useBrandProjection(organizationId: string | null, accountId: string, enabled = true) {
  const scope = `${accountId}:${organizationId ?? ''}`;
  const [result, setResult] = useState<{ scope: string; brand: Brand } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const changed = () => setAttempt(value => value + 1);
    window.addEventListener('orgmap:branding-changed', changed);
    return () => window.removeEventListener('orgmap:branding-changed', changed);
  }, [enabled]);
  useEffect(() => {
    const controller = new AbortController();
    if (enabled && organizationId) request<Brand>(`/organizations/${organizationId}/branding/workspace`, { signal: controller.signal }).then(response => {
      if (!controller.signal.aborted) setResult({ scope, brand: response.data });
    }).catch(() => { if (!controller.signal.aborted) setResult(null); });
    else setResult(null);
    return () => controller.abort();
  }, [scope, attempt, organizationId, enabled]);
  return { scope, brand: result?.scope === scope ? result.brand : null };
}
const validColor = (brand: Brand | null) => /^#[a-f0-9]{6}$/i.test(brand?.appearance.color ?? '') ? brand!.appearance.color : '#a84622';
/** Choose black/white from real luminance, so even a light organization color keeps readable controls. */
export function organizationAccentForeground(color: string) {
  if (!/^#[a-f0-9]{6}$/i.test(color)) return '#ffffff';
  const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  return luminance > .179 ? '#000000' : '#ffffff';
}
/** Theme authority is scoped to this rendered shell, never document-global or left behind after account changes. */
export function WorkspaceBrandingShell({ organizationId, accountId, className = '', children }: { organizationId: string | null; accountId: string; className?: string; children: ReactNode }) {
  const projection = useBrandProjection(organizationId, accountId);
  const [preview,setPreview]=useState<{scope:string;theme:string}|null>(null);
  useEffect(()=>{
    const changed=(event:Event)=>{
      const detail=(event as CustomEvent).detail;
      if(detail?.organizationId!==organizationId||detail?.accountId!==accountId)return;
      setPreview(detail.theme===null?null:themeChoices.includes(detail.theme)?{scope:projection.scope,theme:detail.theme}:null);
    };
    window.addEventListener('orgmap:theme-preview',changed);
    return()=>window.removeEventListener('orgmap:theme-preview',changed);
  },[organizationId,accountId,projection.scope]);
  const requested = projection.brand?.appearance.colorTheme;
  const theme = preview?.scope===projection.scope ? preview.theme : requested && themeChoices.includes(requested) ? requested : 'mare';
  return <BrandContext.Provider value={projection}><div className={className + ' workspace-branded'} data-org-theme={theme}>{children}</div></BrandContext.Provider>;
}
/** Scope the projection during render as well as aborting its request on account/org changes. */
export function WorkspaceBrand({ organizationId, accountId, name }: { organizationId: string | null; accountId: string; name: string }) {
  const [broken, setBroken] = useState('');
  const shared = useContext(BrandContext), own = useBrandProjection(organizationId, accountId, !shared);
  const projection = shared ?? own;
  const brand = projection.scope === `${accountId}:${organizationId ?? ''}` ? projection.brand : null;
  const asset = brand?.asset;
  let src: string | null = null;
  if (asset?.origin === 'UPLOADED' && asset.readUrl === `/api/v1/organizations/${organizationId}/branding/workspace-logo`)
    src = asset.readUrl + '?revision=' + asset.revision;
  if (asset?.origin === 'LEGACY_EXTERNAL' && /^https:\/\//.test(asset.legacyUrl ?? '')) src = asset!.legacyUrl!;
  const color = validColor(brand);
  const image = src && broken !== src;
  return <span className="workspace-brand">
    {image ? <img src={src!} alt="" referrerPolicy="no-referrer" onError={() => setBroken(src!)}/> : <span className="workspace-brand-mark" style={{ backgroundColor: color }} aria-hidden="true"/>}
    {brand?.appearance.showOrganizationName !== false && <span className="identity-org-name">{name}</span>}
  </span>;
}

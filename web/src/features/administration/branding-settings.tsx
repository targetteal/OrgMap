import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { RequestError } from "../../api";
import "./branding-settings.css";
import {brandingCopy} from "./branding-messages";

export type BrandingPurpose = "WORKSPACE_LOGO" | "EMAIL_LOGO" | "LOGIN_BACKGROUND";
export type BrandingAsset = { purpose: BrandingPurpose; revision: number; origin: "NONE" | "UPLOADED" | "LEGACY_EXTERNAL"; state: "READY" | "EMPTY"; width: number | null; height: number | null; mime: string | null; updatedAt: string | null; readUrl: string | null; legacyUrl?: string | null };
/** Implementations must use the authenticated client, CSRF, If-Match and the supplied idempotency key. */
export interface BrandingTransport {
  list(signal: AbortSignal): Promise<{ assets: BrandingAsset[]; ready: boolean }>;
  upload(purpose: BrandingPurpose, file: File, revision: number, publish: boolean, key: string, signal: AbortSignal): Promise<BrandingAsset>;
  remove(purpose: BrandingPurpose, revision: number, key: string, signal: AbortSignal): Promise<BrandingAsset>;
  /** Authenticated workspace reader and current public background only. Never infer an email reader. */
  read(purpose: "WORKSPACE_LOGO" | "LOGIN_BACKGROUND", asset: BrandingAsset, signal: AbortSignal): Promise<Blob>;
}
const purposes: BrandingPurpose[] = ["WORKSPACE_LOGO", "EMAIL_LOGO", "LOGIN_BACKGROUND"];
const texts = {
  "pt-BR": { title:"Identidade visual", intro:"Escolha imagens para os espaços da organização.", workspace:"Logotipo do espaço de trabalho", email:"Logotipo dos e-mails", background:"Fundo de acesso", workspaceHelp:"Exibido no espaço de trabalho. Use um logotipo legível em até 180 px de largura.", emailHelp:"Imagem para e-mails enviados em nome da organização. Ao salvar, ela será ajustada proporcionalmente a até 360 × 180 pixels e 512 KiB.", backgroundHelp:"Será visível publicamente nas páginas de entrada e cadastro vinculadas à organização. Pessoas podem guardar cópias da imagem.", limits:"PNG, JPEG ou WebP estático, até 5 MiB.", dimensions:"O fundo deve ter pelo menos 2000 × 1500 pixels.", empty:"Nenhuma imagem enviada.", legacy:"Esta organização usa um endereço de logotipo anterior.", saved:"Imagem salva", savedNoPreview:"Imagem salva; prévia indisponível aqui.", preview:"Prévia do arquivo selecionado", previewNote:"Prévia do arquivo original; o servidor ajustará as dimensões ao salvar.", choose:"Selecionar imagem", selected:"Arquivo selecionado", publish:"Entendo que esta imagem ficará visível publicamente.", upload:"Salvar imagem", replace:"Substituir imagem", remove:"Remover imagem", saving:"Salvando…", removing:"Removendo…", loading:"Carregando imagens…", unavailable:"O serviço de imagens está indisponível. Tente novamente mais tarde.", loadError:"Não foi possível carregar as imagens. Tente novamente.", retry:"Tentar novamente", invalid:"Selecione um PNG, JPEG ou WebP de até 5 MiB.", badImage:"Não foi possível abrir esta imagem. Escolha outro arquivo.", badDimensions:"O fundo precisa ter pelo menos 2000 × 1500 pixels.", readError:"Não foi possível carregar a prévia salva.", failed:"Não foi possível salvar a alteração. Confira a conexão e tente novamente.", conflict:"Esta imagem foi alterada em outra sessão. Atualize a versão antes de tentar novamente; seu arquivo continua selecionado.", refresh:"Atualizar versão", savedMessage:"Imagem salva.", removedMessage:"Imagem removida.", revision:"Versão", noFile:"Nenhum arquivo selecionado.", signInLink:"Link de entrada da organização" },
  "en-US": { title:"Visual identity", intro:"Choose images for your organization.", workspace:"Workspace logo", email:"Email logo", background:"Sign-in background", workspaceHelp:"Shown in the workspace. Use a logo that is legible at up to 180 px wide.", emailHelp:"Image for emails sent on behalf of the organization. When saved, it will be proportionally resized to at most 360 × 180 pixels and 512 KiB.", backgroundHelp:"This will be publicly visible on the organization’s sign-in and registration pages. People can keep copies of the image.", limits:"Static PNG, JPEG or WebP, up to 5 MiB.", dimensions:"The background must be at least 2000 × 1500 pixels.", empty:"No image uploaded.", legacy:"This organization uses an earlier logo address.", saved:"Saved image", savedNoPreview:"Image saved; preview unavailable here.", preview:"Selected file preview", previewNote:"Original file preview; the server will resize it when saved.", choose:"Choose image", selected:"Selected file", publish:"I understand this image will be publicly visible.", upload:"Save image", replace:"Replace image", remove:"Remove image", saving:"Saving…", removing:"Removing…", loading:"Loading images…", unavailable:"The image service is unavailable. Try again later.", loadError:"Could not load images. Try again.", retry:"Try again", invalid:"Choose a PNG, JPEG or WebP up to 5 MiB.", badImage:"Could not open this image. Choose another file.", badDimensions:"The background must be at least 2000 × 1500 pixels.", readError:"Could not load the saved preview.", failed:"Could not save the change. Check your connection and try again.", conflict:"This image changed in another session. Refresh the version and try again; your file is still selected.", refresh:"Refresh version", savedMessage:"Image saved.", removedMessage:"Image removed.", revision:"Version", noFile:"No file selected.", signInLink:"Organization sign-in link" },
} as const;
type Copy = { [K in keyof typeof texts["pt-BR"]]: string };
function isConflict(error: unknown) { return error instanceof RequestError && ["VERSION_CONFLICT", "BRANDING_REPLAY_STALE"].includes(error.code); }
async function imageDimensions(file: File): Promise<{width:number;height:number}> {
  if (typeof createImageBitmap === "function") { const bitmap=await createImageBitmap(file,{imageOrientation:"from-image"}); try { return {width:bitmap.width,height:bitmap.height}; } finally { bitmap.close(); } }
  const url=URL.createObjectURL(file);
  try { return await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(Error("INVALID_IMAGE"));img.src=url;}); }
  finally { URL.revokeObjectURL(url); }
}
function useObjectUrl(blob: Blob | null) {
  const [url,setUrl]=useState<string | null>(null);
  useEffect(()=>{ if(!blob){setUrl(null);return;} const next=URL.createObjectURL(blob); setUrl(next); return ()=>URL.revokeObjectURL(next); },[blob]);
  return url;
}
function AssetEditor({asset, ready, transport, copy:t, onChange, onRefresh}: {asset:BrandingAsset;ready:boolean;transport:BrandingTransport;copy:Copy;onChange:(v:BrandingAsset)=>void;onRefresh:()=>Promise<void>}) {
  const id=useId(), [file,setFile]=useState<File|null>(null), [saved,setSaved]=useState<Blob|null>(null), [error,setError]=useState<keyof Copy | "">(""), [previewError,setPreviewError]=useState(false), [publicConsent,setPublicConsent]=useState(false), [stale,setStale]=useState(false), [busy,setBusy]=useState<"upload"|"remove"|"refresh"|null>(null), [notice,setNotice]=useState<keyof Copy | "">("");
  const uploadKey=useRef<string | null>(null), removeKey=useRef<string | null>(null), pending=useRef(false), validation=useRef(0), live=useRef(true), controllers=useRef(new Set<AbortController>());
  const draftUrl=useObjectUrl(file), savedUrl=useObjectUrl(saved);
  useEffect(()=>{live.current=true; return ()=>{live.current=false; for(const ctrl of controllers.current) ctrl.abort();};},[]);
  useEffect(()=>{ setSaved(null); setPreviewError(false); if(asset.origin!=="UPLOADED" || asset.purpose==="EMAIL_LOGO") return; const ctrl=new AbortController(); transport.read(asset.purpose,asset,ctrl.signal).then(blob=>{if(!ctrl.signal.aborted)setSaved(blob);}).catch(()=>{if(!ctrl.signal.aborted)setPreviewError(true);}); return ()=>ctrl.abort(); },[transport,asset.purpose,asset.revision,asset.origin]);
  const choose=async(e:ChangeEvent<HTMLInputElement>)=>{
    const chosen=e.target.files?.[0] ?? null; e.target.value=""; const seq=++validation.current;
    setFile(null); setPublicConsent(false); setError(""); setNotice(""); uploadKey.current=null;
    if(!chosen)return;
    if(!["image/png","image/jpeg","image/webp"].includes(chosen.type) || !chosen.size || chosen.size>5*1024*1024){setError('invalid');return;}
    try { const {width:w,height:h}=await imageDimensions(chosen); if(!live.current || seq!==validation.current)return; if(asset.purpose==="LOGIN_BACKGROUND" && (w<2000 || h<1500)){setError('badDimensions');return;} setFile(chosen); uploadKey.current=crypto.randomUUID(); }
    catch {if(live.current && seq===validation.current)setError('badImage');}
  };
  const invoke=async(operation:"upload"|"remove"|"refresh")=>{
    if(pending.current || busy || (operation==="upload" && (!file || (asset.purpose==="LOGIN_BACKGROUND" && !publicConsent)))) return;
    pending.current=true;setBusy(operation);setError("");setNotice(""); const ctrl=new AbortController();controllers.current.add(ctrl);
    try {
      if(operation==="refresh") { await onRefresh(); if(live.current){setStale(false);uploadKey.current=crypto.randomUUID();removeKey.current=null;} }
      else { const k=operation==="upload" ? (uploadKey.current ??= crypto.randomUUID()) : (removeKey.current ??= crypto.randomUUID());
        const next=operation==="upload" ? await transport.upload(asset.purpose,file!,asset.revision,asset.purpose==="LOGIN_BACKGROUND",k,ctrl.signal) : await transport.remove(asset.purpose,asset.revision,k,ctrl.signal);
        if(live.current){onChange(next);setFile(null);setPublicConsent(false);uploadKey.current=null;removeKey.current=null;setStale(false);setNotice(operation==="upload"?'savedMessage':'removedMessage');}
      }
    } catch(e) { if(live.current && !ctrl.signal.aborted){ if(isConflict(e)){setStale(true);setError('conflict');}else setError(operation==="refresh"?'loadError':'failed'); } }
    finally { controllers.current.delete(ctrl);pending.current=false;if(live.current)setBusy(null); }
  };
  const title=asset.purpose==="WORKSPACE_LOGO"?t.workspace:asset.purpose==="EMAIL_LOGO"?t.email:t.background;
  const help=asset.purpose==="WORKSPACE_LOGO"?t.workspaceHelp:asset.purpose==="EMAIL_LOGO"?t.emailHelp:t.backgroundHelp;
  return <section className="branding-asset" data-purpose={asset.purpose} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{title}</h3><p>{help}</p><p>{t.limits} {asset.purpose==="LOGIN_BACKGROUND" && t.dimensions}</p>
    <div className="branding-preview" aria-live="polite">
      {draftUrl ? <><img src={draftUrl} alt={t.preview}/><p>{t.previewNote}</p></> : savedUrl ? <img src={savedUrl} alt={t.saved}/> : <p>{asset.origin==="LEGACY_EXTERNAL"?t.legacy:asset.origin==="UPLOADED"?t.savedNoPreview:t.empty}</p>}
      {previewError && !draftUrl && <p>{t.readError}</p>}
    </div>
    <p>{t.revision} {asset.revision}</p>
    <label htmlFor={`${id}-file`}>{t.choose}</label><input id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp" disabled={!ready||!!busy||stale} onChange={choose} aria-describedby={`${id}-hint`}/>
    <p id={`${id}-hint`} className="branding-filename">{file ? `${t.selected}: ${file.name}` : t.noFile}</p>
    {asset.purpose === 'LOGIN_BACKGROUND' && asset.origin === 'UPLOADED' && /^\/api\/v1\/public\/branding\/[a-f0-9-]{36}$/.test(asset.readUrl ?? '') && <p><a href={'/login?branding=' + asset.readUrl!.split('/').at(-1)} target="_blank" rel="noopener noreferrer">{t.signInLink}</a></p>}
    {file && asset.purpose==="LOGIN_BACKGROUND" && <label className="branding-confirm"><input type="checkbox" checked={publicConsent} disabled={!!busy||stale} onChange={e=>setPublicConsent(e.target.checked)}/>{t.publish}</label>}
    {error && <p role="alert" className="branding-error">{t[error]}</p>}{notice && <p role="status">{t[notice]}</p>}
    <div className="branding-actions">
      <button type="button" className="primary" disabled={!ready||!!busy||stale||!file||(asset.purpose==="LOGIN_BACKGROUND"&&!publicConsent)} onClick={()=>void invoke("upload")}>{busy==="upload"?t.saving:asset.origin==="UPLOADED"?t.replace:t.upload}</button>
      {asset.origin!=="NONE" && <button type="button" disabled={!ready||!!busy||stale} onClick={()=>void invoke("remove")}>{busy==="remove"?t.removing:t.remove}</button>}
      {stale && <button type="button" disabled={!!busy} onClick={()=>void invoke("refresh")}>{t.refresh}</button>}
    </div>
  </section>;
}
type BrandingSettingsProps = {organizationId:string;transport:BrandingTransport;locale?:string};
export function BrandingSettings(props: BrandingSettingsProps) { return <BrandingSettingsBody key={props.organizationId} {...props} />; }
function BrandingSettingsBody({organizationId, transport, locale="pt-BR"}: BrandingSettingsProps) {
  const t:Copy=brandingCopy(locale,texts);
  const [assets,setAssets]=useState<BrandingAsset[]|null>(null),[ready,setReady]=useState(false),[error,setError]=useState<keyof Copy | "">(""),[attempt,setAttempt]=useState(0);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>{ const ctrl=new AbortController();active.current=ctrl;setAssets(null);setError("");setReady(false);transport.list(ctrl.signal).then(result=>{if(!ctrl.signal.aborted){setAssets(result.assets);setReady(result.ready);}}).catch(()=>{if(!ctrl.signal.aborted)setError('loadError');});return ()=>ctrl.abort(); },[organizationId,transport,attempt]);
  const refresh=async()=>{const ctrl=active.current;if(!ctrl || ctrl.signal.aborted)throw Error("unmounted");const result=await transport.list(ctrl.signal);if(!ctrl.signal.aborted){setAssets(result.assets);setReady(result.ready);}};
  return <section className="admin-settings admin-security branding-settings" aria-labelledby="branding-title"><h2 id="branding-title">{t.title}</h2><p>{t.intro}</p>{error ? <><p role="alert">{t[error]}</p><button type="button" onClick={()=>setAttempt(v=>v+1)}>{t.retry}</button></> : !assets ? <p role="status">{t.loading}</p> : <>{!ready && <p role="status">{t.unavailable}</p>}{purposes.map(p=>{const asset=assets.find(a=>a.purpose===p);return asset?<AssetEditor key={`${organizationId}:${p}`} asset={asset} ready={ready} transport={transport} copy={t} onChange={next=>setAssets(previous=>previous?.map(a=>a.purpose===p?next:a)??null)} onRefresh={refresh}/>:null;})}</>}</section>;
}

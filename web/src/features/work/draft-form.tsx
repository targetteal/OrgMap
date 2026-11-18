import React, { useEffect, useRef, useState, type ComponentProps } from "react";
import { clearDraft, readDraft, writeDraft } from "./drafts";
type Snapshot = { name:string; type:string; value:string; checked?:boolean }[];
export function clearFormDraft(key:string) { for (const suffix of [":fields",":startsAt",":endsAt",":startsAtChoice",":endsAtChoice"]) clearDraft(key+suffix); }
/** Restores uncontrolled inputs by name and occurrence; controlled rich text and dates persist separately. */
export function DraftForm({draftKey,children,...props}:ComponentProps<"form"> & {draftKey:string}) {
  const ref=useRef<HTMLFormElement>(null);
  const [storageUnavailable,setStorageUnavailable]=useState(false);
  useEffect(()=>{
    const raw=readDraft(draftKey+":fields"); if(!raw || !ref.current) return;
    try {
      const saved=JSON.parse(raw) as Snapshot;
      const elements=Array.from(ref.current.elements).filter((el):el is HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement).filter((el)=>el.name && el.type!=="hidden" && el.type!=="datetime-local");
      const used=new Set<number>(), pending=new Map<HTMLSelectElement,string>();
      elements.forEach((el)=>{const index=saved.findIndex((item,i)=>!used.has(i) && item.name===el.name && item.type===el.type && ((el instanceof HTMLInputElement && (el.type==="checkbox" || el.type==="radio")) ? item.value===el.value : true));if(index<0)return;used.add(index);const item=saved[index];if(el instanceof HTMLInputElement && (el.type==="checkbox" || el.type==="radio")) el.checked=!!item.checked; else if(el instanceof HTMLSelectElement && !Array.from(el.options).some((option)=>option.value===item.value)) pending.set(el,item.value); else el.value=item.value;});
      if (pending.size) {
        const observer=new MutationObserver(()=>{for(const [select,value] of pending) if(Array.from(select.options).some((option)=>option.value===value)){select.value=value;pending.delete(select);} if(!pending.size)observer.disconnect();});
        observer.observe(ref.current,{childList:true,subtree:true});
        return ()=>observer.disconnect();
      }
    } catch { /* Ignore malformed or outdated device drafts. */ }
  },[draftKey]);
  const save=()=>{
    if(!ref.current) return;
    const entries:Snapshot=Array.from(ref.current.elements).filter((el):el is HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement).filter((el)=>el.name && el.type!=="hidden" && el.type!=="datetime-local").map((el)=>({name:el.name,type:el.type,value:el.value,...(el instanceof HTMLInputElement && (el.type==="checkbox" || el.type==="radio") ? {checked:el.checked}: {})}));
    setStorageUnavailable(!writeDraft(draftKey+":fields",JSON.stringify(entries)));
  };
  return <form {...props} ref={ref} onChange={(event)=>{save();props.onChange?.(event);}} onInput={(event)=>{save();props.onInput?.(event);}}>{storageUnavailable && <p role="status">Não foi possível guardar o rascunho neste dispositivo. Mantenha o formulário aberto até salvar.</p>}{children}</form>;
}

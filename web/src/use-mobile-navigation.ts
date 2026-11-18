import {useEffect,useRef,useState} from 'react';
/** Closed off-canvas navigation is inert; the open mobile menu is a focus boundary. */
export function useMobileNavigation(open:boolean,onClose:()=>void){
 const [narrow,setNarrow]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(max-width:767px)').matches);
 const sidebarRef=useRef<HTMLElement>(null),openerRef=useRef<HTMLElement|null>(null),closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{const query=window.matchMedia('(max-width:767px)');const changed=()=>setNarrow(query.matches);changed();query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed);},[]);
 useEffect(()=>{
  if(!narrow||!open)return;
  const panel=sidebarRef.current;if(!panel)return;
  const prior=openerRef.current??document.activeElement as HTMLElement|null;
  const controls=()=>[...panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],summary,[tabindex="0"]')].filter(element=>element.getClientRects().length>0&&!element.closest('[inert]'));
  controls()[0]?.focus();
  const keydown=(event:KeyboardEvent)=>{
   if(event.defaultPrevented)return;
   if(event.key==='Escape'){event.preventDefault();closeRef.current();return;}
   if(event.key!=='Tab')return;
   const items=controls(),first=items[0],last=items.at(-1);if(!first||!last)return;
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  panel.addEventListener('keydown',keydown);
  return()=>{panel.removeEventListener('keydown',keydown);queueMicrotask(()=>{if(prior?.isConnected&&!prior.closest('[inert]'))prior.focus({preventScroll:true});});};
 },[narrow,open]);
 return {narrow,modalOpen:narrow&&open,sidebarRef,openerRef};
}

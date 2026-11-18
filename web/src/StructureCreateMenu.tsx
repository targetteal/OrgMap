import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Circle, FileText, Plus } from "lucide-react";
import { StructureIcon } from "./StructureIcon";
import "./structure-create-menu.css";

export type ProposalEntryType = "role" | "circle" | "restriction";
export function StructureCreateMenu({ navigate, circleId }: { navigate: (path:string)=>void; circleId?:string }) {
  const [open,setOpen]=useState(false), root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null), id=useId();
  useEffect(()=>{
    if(!open)return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);};
    document.addEventListener("pointerdown",outside);
    return()=>document.removeEventListener("pointerdown",outside);
  },[open]);
  const close=()=>{setOpen(false);trigger.current?.focus();};
  return <div className="structure-create-menu" ref={root} onKeyDown={(event)=>{
    if(!open)return;
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}
    if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){
      event.preventDefault();const items=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')??[]), current=items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key==="Home"?0:event.key==="End"?items.length-1:(current+(event.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();
    }
    if(event.key==="Tab")setOpen(false);
  }}>
    <button type="button" ref={trigger} className="primary mare-map-new" aria-label="Nova proposta" aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}><Plus size={17}/><span>Nova proposta</span><ChevronDown size={14}/></button>
    {open&&<div id={id} className="structure-create-options" role="menu" aria-label="Tipo da nova proposta">
      {([{type:"role",label:"Papel",description:"Definir uma atuação",icon:<Circle size={19}/>},{type:"circle",label:"Círculo",description:"Organizar papéis e subcírculos",icon:<StructureIcon size={19}/>},{type:"restriction",label:"Restrição",description:"Estabelecer um acordo",icon:<FileText size={19}/>} ] as const).map(item=><button key={item.type} type="button" role="menuitem" onClick={()=>{close();const query=new URLSearchParams({new:"1",proposalType:item.type});if(circleId)query.set("circleId",circleId);navigate("/structure/proposals?"+query.toString());}}>{item.icon}<span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
    </div>}
  </div>;
}

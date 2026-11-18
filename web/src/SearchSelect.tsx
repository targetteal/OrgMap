import {useEffect,useId,useRef,useState} from "react";
import {Check,ChevronDown,Search} from "lucide-react";
import "./search-select.css";
export function SearchSelect({value,options,onChange,label,disabled=false}:{value:string;options:{value:string;label:string}[];onChange:(value:string)=>void;label:string;disabled?:boolean}){
 const id=useId(),root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
 const selected=options.find(option=>option.value===value)?.label??"";
 const [open,setOpen]=useState(false),[query,setQuery]=useState(selected),[active,setActive]=useState(0);
 useEffect(()=>setQuery(selected),[selected]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 const results=options.filter(option=>!query||query===selected||option.label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().includes(query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase()));
 const choose=(option:{value:string;label:string})=>{onChange(option.value);setQuery(option.label);setOpen(false);input.current?.focus();};
 return <div className="search-select" ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node)){setOpen(false);setQuery(selected);}}}>
  <div className="search-select-control"><Search size={16}/><input ref={input} role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-activedescendant={open&&results[active]?id+'-'+active:undefined} disabled={disabled} value={query} placeholder="Selecionar círculo…" onFocus={event=>{event.currentTarget.select();setOpen(true);setActive(0);}} onChange={event=>{setQuery(event.target.value);setOpen(true);setActive(0);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);setQuery(selected);}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(old=>Math.max(0,Math.min(results.length-1,old+(event.key==='ArrowDown'?1:-1))));}else if(event.key==='Enter'&&open){event.preventDefault();if(results[active])choose(results[active]);}}}/><button type="button" tabIndex={-1} aria-label="Mostrar círculos" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(open)setOpen(false);else{input.current?.focus();setOpen(true);}}}><ChevronDown size={16}/></button></div>
  {open&&!disabled&&<div id={id} role="listbox" className="search-select-options" aria-label={label}>{results.length?results.map((option,index)=><button type="button" tabIndex={-1} role="option" aria-selected={option.value===value} id={id+'-'+index} className={index===active?'is-active':''} key={option.value} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(option)}><span>{option.label}</span>{option.value===value&&<Check size={15}/>}</button>):<p>Nenhum círculo encontrado.</p>}</div>}
 </div>;
}

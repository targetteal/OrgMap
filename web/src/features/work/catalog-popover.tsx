import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { X } from "lucide-react";

/** Nonmodal controls remain in the collection's keyboard and document flow. */
export function CatalogPopover({ label, shortLabel, title, children, icon, count = 0 }: {
  /** Full accessible name; `shortLabel` is only the visible text when the surrounding toolbar already gives context. */
  label: string; shortLabel?: string; title: string; children: ReactNode; icon: ReactNode; count?: number;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [position,setPosition]=useState<CSSProperties>({});
  const id = useId();
  useLayoutEffect(()=>{
    if(!open)return;
    const locate=()=>{const box=trigger.current?.getBoundingClientRect();if(!box)return;const width=window.innerWidth<=850?window.innerWidth-32:Math.min(320,window.innerWidth-32),height=Math.min(panel.current?.scrollHeight ?? 0,window.innerHeight*.7);setPosition({position:"fixed",left:Math.max(16,Math.min(box.left,window.innerWidth-width-16)),right:"auto",top:Math.max(16,Math.min(box.bottom+8,window.innerHeight-height-16)),width});};
    locate();window.addEventListener("resize",locate);document.addEventListener("scroll",locate,true);return()=>{window.removeEventListener("resize",locate);document.removeEventListener("scroll",locate,true);};
  },[open]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOutside);
    root.current?.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeOutside); root.current?.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="mare-catalog-pop-root" ref={root}>
    <button ref={trigger} className={"mare-catalog-pop-trigger " + (count ? "has-filters" : "")} aria-label={shortLabel && shortLabel !== label ? (count > 0 ? `${label} (${count})` : label) : undefined} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{icon}<span>{shortLabel ?? label}</span>{count > 0 && <b>{count}</b>}</button>
    {open && <section ref={panel} style={position} id={id} className="mare-catalog-popover" aria-label={title}>
      <header><h3>{title}</h3><button type="button" className="mare-icon-button" aria-label={`Fechar ${label.toLocaleLowerCase("pt-BR")}`} onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={18}/></button></header>
      {children}
    </section>}
  </div>;
}

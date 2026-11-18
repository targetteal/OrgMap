import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export function ProjectActionMenu({ items }: { items: { label: string; icon: ReactNode; action: () => void; disabled?: boolean; destructive?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className="mare-project-action-menu" ref={root} onKeyDown={(event) => {
    if (!open) return;
    if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(); }
    const controls = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      controls[event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length]?.focus();
    }
    if (event.key === "Tab") setOpen(false);
  }}>
    <button type="button" ref={trigger} className="mare-icon-button" aria-label="Mais ações do projeto" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><MoreHorizontal size={19}/></button>
    {open && <div id={id} role="menu" aria-label="Ações do projeto" className="mare-project-action-list">
      {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled} className={item.destructive ? "is-destructive" : undefined} onClick={() => { close(); item.action(); }}>{item.icon}<span>{item.label}</span></button>)}
    </div>}
  </div>;
}

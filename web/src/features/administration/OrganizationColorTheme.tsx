import { Check } from "lucide-react";
import "./organization-color-theme.css";

const themes = [
  { id: "mare", name: "Maré", color: "#0B7077", surface: "#E5F1F1", description: "Teal claro, preciso e acolhedor." },
  { id: "cobalto", name: "Cobalto", color: "#2D54B8", surface: "#E8EEFC", description: "Azul nítido para organizar o trabalho." },
  { id: "argila", name: "Argila", color: "#9E432C", surface: "#F2E6D9", description: "Tons terrosos e presença calorosa." },
  { id: "grafite", name: "Grafite", color: "#D7EA6A", ink: "#252B30", surface: "#E9EDE6", description: "Grafite e acento cítrico, conteúdo em destaque." },
];
export function OrganizationColorTheme({value="mare",disabled,onChange,preview=false,onCancelPreview}:{value?:string;disabled:boolean;onChange:(value:string)=>void;preview?:boolean;onCancelPreview?:()=>void}){
  return <fieldset className="organization-color-theme" disabled={disabled}><legend>Paleta da organização</legend><p>A mesma paleta para todas as pessoas, mantendo a tipografia e os componentes do Maré.</p><div className="organization-color-theme-options">{themes.map(t=><label key={t.id} className={value===t.id?'selected':''}><input type="radio" name="organizationColorTheme" value={t.id} checked={value===t.id} onChange={()=>onChange(t.id)}/><span className="organization-color-theme-sample" style={{background:t.surface}} aria-hidden="true"><span style={{background:t.color}}/><span style={{color:t.ink??t.color}}>Aa</span><i style={{background:t.color}}/></span><span><strong>{t.name}{value===t.id&&<Check size={15}/>}</strong><small>{t.description}</small></span></label>)}</div>{preview&&<div className="organization-theme-preview-notice"><p role="status">Prévia do tema. Salve para aplicar à organização.</p><button type="button" onClick={onCancelPreview}>Cancelar prévia</button></div>}{disabled&&<small>Somente o owner da organização pode alterar a paleta.</small>}</fieldset>;
}

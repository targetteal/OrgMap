import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import "./structure-definition.css";
import {RichTextEditor,RichTextView,type RichDocument} from "./editor";
import {toPlainText} from "../../packages/content";
import {resolveLocale,type Locale} from "../../packages/i18n";

export type DefinitionItem = { id: string; text: string; richText?:RichDocument };
export type EntityDefinition = { responsibilities?: DefinitionItem[]; artifacts?: DefinitionItem[] };
type Kind = "responsibilities" | "artifacts";
const copy={
 "pt-BR":{
  responsibilities:"Responsabilidades",artifacts:"Artefatos",responsibilitiesHelp:"Atividades contínuas esperadas deste papel ou círculo.",artifactsHelp:"Ativos ou âmbitos sob controle deste papel ou círculo.",
  remove:"Remover item",empty:"Nenhum item definido.",roleAuthority:"Artefatos são âmbitos de autoridade exclusiva do papel.",
  circleAuthority:"Na O2, integrantes deste círculo e de seus círculos internos podem impactar seus artefatos, respeitando as restrições. Um artefato delegado passa a ser exclusivo do destinatário até desfazer a delegação.",
  required:"Descreva o item ou remova-o da lista.",responsibility:"Responsabilidade",artifact:"Artefato",addResponsibility:"Adicionar responsabilidade",addArtifact:"Adicionar artefato",
 },
 "en-US":{
  responsibilities:"Responsibilities",artifacts:"Artifacts",responsibilitiesHelp:"Ongoing activities expected of this role or circle.",artifactsHelp:"Assets or areas controlled by this role or circle.",
  remove:"Remove item",empty:"No items defined.",roleAuthority:"Artifacts define areas of exclusive authority for this role.",
  circleAuthority:"In O2, members of this circle and its inner circles may impact its artifacts, subject to restrictions. A delegated artifact becomes exclusive to its recipient until the delegation is revoked.",
  required:"Describe the item or remove it from the list.",responsibility:"Responsibility",artifact:"Artifact",addResponsibility:"Add responsibility",addArtifact:"Add artifact",
 },
 "es-ES":{
  responsibilities:"Responsabilidades",artifacts:"Artefactos",responsibilitiesHelp:"Actividades continuas esperadas de este rol o círculo.",artifactsHelp:"Activos o ámbitos bajo el control de este rol o círculo.",
  remove:"Eliminar elemento",empty:"No hay elementos definidos.",roleAuthority:"Los artefactos definen ámbitos de autoridad exclusiva del rol.",
  circleAuthority:"En O2, las personas de este círculo y de sus círculos internos pueden intervenir en sus artefactos, respetando las restricciones. Un artefacto delegado es exclusivo de quien lo recibe hasta revocar la delegación.",
  required:"Describe el elemento o elimínalo de la lista.",responsibility:"Responsabilidad",artifact:"Artefacto",addResponsibility:"Añadir responsabilidad",addArtifact:"Añadir artefacto",
 },
 "fr-FR":{
  responsibilities:"Responsabilités",artifacts:"Artefacts",responsibilitiesHelp:"Activités continues attendues de ce rôle ou de ce cercle.",artifactsHelp:"Actifs ou domaines contrôlés par ce rôle ou ce cercle.",
  remove:"Supprimer l’élément",empty:"Aucun élément défini.",roleAuthority:"Les artefacts définissent les domaines d’autorité exclusive du rôle.",
  circleAuthority:"Dans O2, les membres de ce cercle et de ses cercles internes peuvent agir sur ses artefacts, sous réserve des restrictions. Un artefact délégué devient exclusif à son destinataire jusqu’à la révocation de la délégation.",
  required:"Décrivez l’élément ou retirez-le de la liste.",responsibility:"Responsabilité",artifact:"Artefact",addResponsibility:"Ajouter une responsabilité",addArtifact:"Ajouter un artefact",
 },
 "de-DE":{
  responsibilities:"Verantwortlichkeiten",artifacts:"Artefakte",responsibilitiesHelp:"Fortlaufende Aufgaben dieser Rolle oder dieses Kreises.",artifactsHelp:"Vermögenswerte oder Bereiche unter Kontrolle dieser Rolle oder dieses Kreises.",
  remove:"Eintrag entfernen",empty:"Keine Einträge definiert.",roleAuthority:"Artefakte definieren Bereiche mit ausschließlicher Zuständigkeit dieser Rolle.",
  circleAuthority:"In O2 dürfen Mitglieder dieses Kreises und seiner inneren Kreise seine Artefakte unter Beachtung der Einschränkungen beeinflussen. Ein delegiertes Artefakt gehört bis zum Widerruf der Delegation ausschließlich dem Empfänger.",
  required:"Beschreiben Sie den Eintrag oder entfernen Sie ihn.",responsibility:"Verantwortlichkeit",artifact:"Artefakt",addResponsibility:"Verantwortlichkeit hinzufügen",addArtifact:"Artefakt hinzufügen",
 },
 "it-IT":{
  responsibilities:"Responsabilità",artifacts:"Artefatti",responsibilitiesHelp:"Attività continuative previste per questo ruolo o cerchio.",artifactsHelp:"Risorse o ambiti controllati da questo ruolo o cerchio.",
  remove:"Rimuovi elemento",empty:"Nessun elemento definito.",roleAuthority:"Gli artefatti definiscono ambiti di autorità esclusiva del ruolo.",
  circleAuthority:"In O2, i membri di questo cerchio e dei cerchi interni possono intervenire sui suoi artefatti nel rispetto delle restrizioni. Un artefatto delegato diventa esclusivo del destinatario fino alla revoca della delega.",
  required:"Descrivi l’elemento o rimuovilo dall’elenco.",responsibility:"Responsabilità",artifact:"Artefatto",addResponsibility:"Aggiungi responsabilità",addArtifact:"Aggiungi artefatto",
 },
 "ja-JP":{
  responsibilities:"責務",artifacts:"成果物・管理対象",responsibilitiesHelp:"このロールまたはサークルに期待される継続的な活動です。",artifactsHelp:"このロールまたはサークルが管理する資産や領域です。",
  remove:"項目を削除",empty:"項目はまだありません。",roleAuthority:"成果物・管理対象は、このロールが専属で権限を持つ領域を定めます。",
  circleAuthority:"O2では、制約の範囲内で、このサークルと内部サークルのメンバーが管理対象に関与できます。委任された対象は、委任を取り消すまで受領者の専属になります。",
  required:"項目を説明するか、一覧から削除してください。",responsibility:"責務",artifact:"成果物・管理対象",addResponsibility:"責務を追加",addArtifact:"成果物・管理対象を追加",
 },
 "nl-NL":{
  responsibilities:"Verantwoordelijkheden",artifacts:"Artefacten",responsibilitiesHelp:"Doorlopende activiteiten die van deze rol of kring worden verwacht.",artifactsHelp:"Middelen of domeinen onder beheer van deze rol of kring.",
  remove:"Item verwijderen",empty:"Geen items gedefinieerd.",roleAuthority:"Artefacten bepalen de gebieden waarover deze rol exclusieve zeggenschap heeft.",
  circleAuthority:"In O2 mogen leden van deze kring en de onderliggende kringen de artefacten beïnvloeden binnen de beperkingen. Een gedelegeerd artefact is exclusief voor de ontvanger totdat de delegatie wordt ingetrokken.",
  required:"Beschrijf het item of verwijder het uit de lijst.",responsibility:"Verantwoordelijkheid",artifact:"Artefact",addResponsibility:"Verantwoordelijkheid toevoegen",addArtifact:"Artefact toevoegen",
 },
} satisfies Record<Locale,Record<string,string>>;
export const words=(locale:string)=>copy[resolveLocale(locale)];

export function DefinitionListEditor({ kind, items, onChange, disabled = false, locale = "pt-BR" }: {
  kind: Kind; items: DefinitionItem[]; onChange: (items: DefinitionItem[]) => void; disabled?: boolean; locale?: string;
}) {
  const uid = useId();
  const [touched,setTouched]=useState<Set<string>>(()=>new Set());
  const t = words(locale);
  return <fieldset className="definition-editor" disabled={disabled} aria-describedby={uid + "-help"}>
    <legend>{t[kind]}</legend>
    <p id={uid + "-help"} className="muted">{t[kind === "responsibilities" ? "responsibilitiesHelp" : "artifactsHelp"]}</p>
    {items.length === 0 && <p className="muted">{t.empty}</p>}
    <ol className="definition-items">
      {items.map((item, index) => <li key={item.id}>
        <div className="field" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setTouched(previous=>new Set(previous).add(item.id));}}>
          <RichTextEditor id={uid+item.id} label={(kind === "responsibilities" ? t.responsibility : t.artifact)+' '+(index+1)} compact toolbar={false} maxLength={10000}
            value={item.richText??item.text} required readOnly={disabled}
            error={touched.has(item.id)&&!item.text.trim()?t.required:undefined}
            onChange={richText=>onChange(items.map(current=>current.id===item.id?{...current,text:toPlainText(richText),richText}:current))}/>
        </div>
        <button type="button" className="definition-remove" title={t.remove} aria-label={t.remove + " " + (index + 1)} onClick={() => onChange(items.filter(current => current.id !== item.id))}><X size={16}/></button>
      </li>)}
    </ol>
    <button type="button" className="definition-add" disabled={disabled || items.length >= 100}
      onClick={() => onChange([...items, {id: crypto.randomUUID(), text: ""}])}><Plus size={16}/>{kind === "responsibilities" ? t.addResponsibility : t.addArtifact}</button>
  </fieldset>;
}

export function DefinitionList({ kind, items = [], locale = "pt-BR", badges }: { kind: Kind; items?: DefinitionItem[]; locale?: string; badges?: Record<string, {label:string;className?:string}> }) {
  const t = words(locale);
  return <section className="definition-section">
    <h3>{t[kind]}</h3>
    {items.length ? <ul>{items.map(item => <li key={item.id} className={badges?.[item.id]?.className}><RichTextView value={item.richText??item.text}/>{badges?.[item.id]?.label && <em className="proposal-diff-badge">{badges[item.id].label}</em>}</li>)}</ul> : <p className="muted">{t.empty}</p>}
  </section>;
}

export function ArtifactAuthority({ kind, locale = "pt-BR" }: { kind: "ROLE" | "CIRCLE"; locale?: string }) {
  const t = words(locale);
  return <div className="definition-authority muted"><p>{kind === "CIRCLE" ? t.circleAuthority : t.roleAuthority}</p></div>;
}

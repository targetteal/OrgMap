import { useEffect, useState } from "react";
import type { FeatureContext } from "../../feature-contract";
import { errorMessage } from "../../api";
import { Fragment } from "react";

export type CustomFieldValue = string | number | null;
export type FieldDefinition = {id:string;name:string;type:"TEXT"|"NUMBER"|"SELECT"|"DATE";options:string[]};
const uuidKey=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseLegacy(value:FormDataEntryValue|null):Record<string,string> {
  const fields:Record<string,string>=Object.create(null);
  for(const line of String(value ?? "").split("\n")) {
    if(!line.trim())continue;
    const at=line.indexOf(":"),name=line.slice(0,at).trim();
    if(at<1 || !name || Object.hasOwn(fields,name))throw Error("Use um campo por linha no formato Nome: valor, sem nomes repetidos.");
    fields[name]=line.slice(at+1).trim();
  }
  return fields;
}
export function customFieldsPayload(form:FormData):Record<string,CustomFieldValue> {
  // Preserve typed values while the schema is loading, never serializing them into legacy text values.
  const snapshot=JSON.parse(String(form.get("customFieldsSnapshot") ?? "{}")) as Record<string,CustomFieldValue>;
  const result:Record<string,CustomFieldValue>={...snapshot,...parseLegacy(form.get("customFields"))};
  for(const [name,value] of form.entries())if(name.startsWith("typedField:")) {
    const id=name.slice(11),raw=String(value),type=String(form.get("typedFieldType:"+id));
    if(uuidKey.test(id)) {if(raw==="")delete result[id];else result[id]=type==="NUMBER" ? Number(raw) : raw;}
  }
  return result;
}
export function CustomFieldInputs({context:c,value={}}:{context:FeatureContext;value?:Record<string,CustomFieldValue>}) {
  const [definitions,setDefinitions]=useState<FieldDefinition[]|null>(null),[error,setError]=useState(""),[revision,setRevision]=useState(0);
  useEffect(()=>{const abort=new AbortController();setDefinitions(null);setError("");c.api<{definitions:FieldDefinition[]}>(`/organizations/${c.organizationId}/work/field-definitions`,{signal:abort.signal}).then((result)=>{if(!abort.signal.aborted)setDefinitions(result.data.definitions);}).catch((error)=>{if(!abort.signal.aborted)setError(errorMessage(error));});return()=>abort.abort();},[c.api,c.organizationId,revision]);
  return <fieldset className="mare-custom-fields"><legend>Campos personalizados</legend>
    <input type="hidden" name="customFieldsSnapshot" value={JSON.stringify(Object.fromEntries(Object.entries(value).filter(([name])=>uuidKey.test(name))))}/>
    {error && <p role="status">Não foi possível carregar os campos configurados. Os valores atuais serão preservados.<button type="button" onClick={()=>setRevision((v)=>v+1)}>Tentar novamente</button></p>}
    {!error && !definitions && <p role="status">Carregando campos…</p>}
    {definitions?.map((definition)=><label className="field" key={definition.id}><span>{definition.name}</span><input type="hidden" name={"typedFieldType:"+definition.id} value={definition.type}/>{definition.type==="SELECT" ? <select name={"typedField:"+definition.id} defaultValue={String(value[definition.id] ?? "")}><option value="">Não definido</option>{definition.options.map((option)=><option key={option}>{option}</option>)}</select> : <input name={"typedField:"+definition.id} type={definition.type==="NUMBER"?"number":definition.type==="DATE"?"date":"text"} step={definition.type==="NUMBER"?"any":undefined} defaultValue={value[definition.id] ?? ""}/>}</label>)}
    <details><summary>Campos de texto existentes</summary><label className="field"><span>Campos simples · Nome: valor</span><textarea name="customFields" rows={3} defaultValue={Object.entries(value).filter(([name])=>!uuidKey.test(name)).map(([name,value])=>`${name}: ${value ?? ""}`).join("\n")} onChange={(event)=>{try{parseLegacy(event.currentTarget.value);event.currentTarget.setCustomValidity("");}catch(error){event.currentTarget.setCustomValidity(error instanceof Error?error.message:"Campo inválido");}}}/><small>Preserva os campos textuais anteriores. Os campos configurados acima têm tipos e IDs próprios.</small></label></details>
  </fieldset>;
}
export function FieldDefinitionsView({context:c}:{context:FeatureContext}) {
  const [definitions,setDefinitions]=useState<FieldDefinition[]>([]),[version,setVersion]=useState(0),[manage,setManage]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const endpoint=`/organizations/${c.organizationId}/work/field-definitions`;
  useEffect(()=>{const abort=new AbortController();c.api<{definitions:FieldDefinition[];version:number;canManage:boolean}>(endpoint,{signal:abort.signal}).then((result)=>{if(abort.signal.aborted)return;setDefinitions(result.data.definitions);setVersion(result.data.version);setManage(result.data.canManage);setLoading(false);}).catch((error)=>{if(!abort.signal.aborted){setError(errorMessage(error));setLoading(false);}});return()=>abort.abort();},[c.api,endpoint]);
  if(loading)return <p role="status">Carregando campos da organização…</p>;
  return <section className="work-global-form mare-field-definitions"><h3>Campos personalizados da organização</h3><p>O mesmo campo pode ser usado em projetos e tarefas. O tipo valida os valores; o acesso a cada trabalho continua independente.</p>{error&&<p className="notice" role="alert">{error}</p>}<form className="edit-form" onSubmit={async(event)=>{event.preventDefault();setBusy(true);setError("");try{const result=await c.api<{definitions:FieldDefinition[];version:number}>(endpoint,{method:"POST",body:{definitions},version});setDefinitions(result.data.definitions);setVersion(result.data.version);c.notify("Campos da organização salvos.");}catch(error){setError(errorMessage(error));}finally{setBusy(false);}}}>
    {definitions.map((definition)=><fieldset className="mare-field-definition" key={definition.id}><legend>{definition.name || "Novo campo"}</legend><label className="field">Nome<input required maxLength={80} disabled={!manage||busy} value={definition.name} onChange={(event)=>setDefinitions((current)=>current.map((item)=>item.id===definition.id?{...item,name:event.target.value}:item))}/></label><label className="field">Tipo<select disabled={!manage||busy} value={definition.type} onChange={(event)=>setDefinitions((current)=>current.map((item)=>item.id===definition.id?{...item,type:event.target.value as FieldDefinition["type"],options:[]}:item))}>{[["TEXT","Texto"],["NUMBER","Número"],["SELECT","Seleção"],["DATE","Data"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{definition.type==="SELECT" && <label className="field">Opções · uma por linha<textarea disabled={!manage||busy} required value={definition.options.join("\n")} onChange={(event)=>setDefinitions((current)=>current.map((item)=>item.id===definition.id?{...item,options:event.target.value.split("\n")}:item))}/></label>}{manage&&<button type="button" disabled={busy} onClick={()=>setDefinitions((current)=>current.filter((item)=>item.id!==definition.id))}>Remover campo</button>}</fieldset>)}
    {!definitions.length&&<p>Nenhum campo configurado.</p>}{manage&&<div className="form-actions"><button type="button" disabled={busy||definitions.length>=20} onClick={()=>setDefinitions((current)=>[...current,{id:crypto.randomUUID(),name:"",type:"TEXT",options:[]}])}>Adicionar campo</button><button className="primary" disabled={busy}>Salvar campos</button></div>}
  </form><p className="muted">Um campo em uso não pode ser removido nem mudar de tipo. Alterações são confirmadas pelo servidor e valem para esta organização.</p></section>;
}
export function CustomFieldValues({context:c,value={},rows=false}:{context:FeatureContext;value?:Record<string,CustomFieldValue>;rows?:boolean}) {
  const [definitions,setDefinitions]=useState<FieldDefinition[]>([]);
  const present=Object.keys(value).length>0;
  useEffect(()=>{if(!present)return;const abort=new AbortController();c.api<{definitions:FieldDefinition[]}>(`/organizations/${c.organizationId}/work/field-definitions`,{signal:abort.signal}).then((result)=>{if(!abort.signal.aborted)setDefinitions(result.data.definitions);}).catch(()=>{});return()=>abort.abort();},[c.api,c.organizationId,present]);
  if(!present)return null;
  const values=Object.entries(value).map(([id,value])=><div key={id}><dt>{definitions.find((field)=>field.id===id)?.name ?? (uuidKey.test(id)?"Campo configurado":id)}</dt><dd>{value ?? "Não definido"}</dd></div>);
  return rows ? <Fragment>{values}</Fragment> : <dl className="mare-custom-field-values">{values}</dl>;
}

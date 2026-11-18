import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {SUPPORTED_LOCALES,createMessageTranslator} from '../../packages/i18n/index';

// Explicit exports prevent treating arbitrary module data as translated UI.
const targets=[
 ['common','packages/i18n/messages.ts','catalogs'],
 ['accessibility','web/src/accessibility/messages.ts','accessibilityMessages'],
 ['accessibility-status','web/src/accessibility/status-messages.ts','accessibilityStatusMessages'],
 ['goals','web/src/features/goals/messages.ts','goalMessages'],
 ['governance-list','web/src/features/governance/list-messages.ts','listMessages'],
 ['governance-state','web/src/features/governance/state-messages.ts','stateMessages'],
 ['administration','web/src/features/administration/messages.ts','administrationMessages'],
 ['platform','web/src/features/platform/messages.ts','platformMessages'],
 ['interoperability','web/src/features/interoperability/messages.ts','featureMessages'],
 ['structure-advanced','web/src/features/structure-advanced/messages.ts','valueEditorMessages'],
] as const;
const featureNames=['goals','work','governance','meetings','administration','platform','interoperability','structure-advanced'];
async function tree(directory:string):Promise<string[]>{
 const files:string[]=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory()&&entry.name!=='evidence')files.push(...await tree(file));
  else if(entry.isFile()&&/\.(ts|tsx)$/.test(file))files.push(file);
 }
 return files;
}
async function sourceList(){return [...(await tree('packages/i18n')),...(await tree('web/src/localization')),...(await tree('web/src/accessibility')),...(await Promise.all(featureNames.map(f=>tree('web/src/features/'+f)))).flat()].sort();}
async function snapshot(){return Object.fromEntries(await Promise.all((await sourceList()).map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));}
const before=await snapshot();
const sourceFiles=Object.keys(before);
const placeholders=(text:string)=>[...new Set([...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(m=>m[1]))].sort();
const checks=[];
for(const [id,file,exportName]of targets){
 const module=await import(pathToFileURL(path.resolve(file)).href);
 const dictionaries=module[exportName] as Record<string,Record<string,string>>|undefined;
 if(!dictionaries?.['pt-BR'])throw Error('Catalog export missing: '+file+'#'+exportName);
 const base=dictionaries['pt-BR'],keys=Object.keys(base).sort();
 const locales=SUPPORTED_LOCALES.map(locale=>{
  const catalog=dictionaries[locale]??{};
  const missing=keys.filter(key=>!Object.hasOwn(catalog,key)||typeof catalog[key]!=='string'||!catalog[key].trim());
  const extra=Object.keys(catalog).filter(key=>!Object.hasOwn(base,key));
  const parameterMismatch=keys.filter(key=>typeof catalog[key]==='string'&&JSON.stringify(placeholders(catalog[key]))!==JSON.stringify(placeholders(base[key]))).map(key=>({key,expected:placeholders(base[key]),actual:placeholders(catalog[key])}));
  const sameAsPortuguese=locale==='pt-BR'?[]:keys.filter(key=>catalog[key]===base[key]);
  const translate=createMessageTranslator<string>(locale,dictionaries as {'pt-BR':Record<string,string>});
  const unresolvedAfterInterpolation=keys.filter(key=>{
   const parameters=Object.fromEntries(placeholders(base[key]).map(name=>[name,'QA_'+name]));
   return placeholders(translate(key,parameters)).length>0;
  });
  return {locale,keys:Object.keys(catalog).length,missing,extra,parameterMismatch,unresolvedAfterInterpolation,sameAsPortugueseReviewOnly:sameAsPortuguese};
 });
 checks.push({id,file,exportName,baseKeys:keys.length,locales,structuralPass:locales.every(l=>!l.missing.length&&!l.extra.length&&!l.parameterMismatch.length&&!l.unresolvedAfterInterpolation.length)});
}
const features=[];
for(const feature of featureNames){
 const files=sourceFiles.filter(file=>file.startsWith('web/src/features/'+feature+'/')&&!/(test|preview)/.test(file));
 const text=(await Promise.all(files.map(file=>readFile(file,'utf8')))).join('\n');
 features.push({feature,catalogExports:checks.filter(c=>c.file.startsWith('web/src/features/'+feature+'/')).map(c=>c.id),usesLocalization:/useLocalization/.test(text),usesFormats:/\bformat(Date|Instant|Number)\(/.test(text),usesMotionHook:/effectiveReducedMotion/.test(text),scope:'Source signals only; neither complete translation nor runtime adoption proof'});
}
const after=await snapshot();
const changedDuringAudit=[...new Set([...sourceFiles,...Object.keys(after)])].filter(file=>before[file]!==after[file]);
const report={checkedAt:new Date().toISOString(),completion:false,scope:'Exported catalog structural audit, not semantic translation quality or complete module/flow coverage',sourceStable:changedDuringAudit.length===0,changedDuringAudit,checks,features,sourceHashes:before,limitations:['Identical strings across languages are review candidates, not errors.','Catalog key parity does not prove all UI copy uses the catalog.','No runtime/visual/reader/motion adoption claim from imports or source signals.','Governance count formatter has a separate existing owner test; it is not a string catalog export.']};
await writeFile('tests/localization/evidence/catalog-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({catalogs:checks.length,structuralPass:checks.filter(c=>c.structuralPass).length,sourceStable:report.sourceStable,issues:checks.flatMap(c=>c.locales.filter(l=>l.missing.length||l.extra.length||l.parameterMismatch.length||l.unresolvedAfterInterpolation.length).map(l=>({catalog:c.id,locale:l.locale,missing:l.missing.length,extra:l.extra.length,parameterMismatch:l.parameterMismatch,unresolved:l.unresolvedAfterInterpolation}))),featuresWithoutCatalog:features.filter(f=>!f.catalogExports.length).map(f=>f.feature),completion:false}));
if(changedDuringAudit.length||checks.some(c=>!c.structuralPass))process.exitCode=1;

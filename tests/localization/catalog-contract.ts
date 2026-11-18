import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {SUPPORTED_LOCALES,createMessageTranslator} from '../../packages/i18n/index';
export type Dictionaries=Record<string,Record<string,string>>;
const parameters=(text:string)=>[...new Set([...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(m=>m[1]))].sort();
export function inspectCatalog(dictionaries:Dictionaries){
 const base=dictionaries['pt-BR'];if(!base)throw Error('Missing pt-BR base');
 const keys=Object.keys(base).sort();
 const locales=SUPPORTED_LOCALES.map(locale=>{
  const catalog=dictionaries[locale]??{};
  const missing=keys.filter(key=>!Object.hasOwn(catalog,key)||typeof catalog[key]!=='string'||!catalog[key].trim());
  const extra=Object.keys(catalog).filter(key=>!Object.hasOwn(base,key));
  const parameterMismatch=keys.filter(key=>typeof catalog[key]==='string'&&JSON.stringify(parameters(catalog[key]))!==JSON.stringify(parameters(base[key]))).map(key=>({key,expected:parameters(base[key]),actual:parameters(catalog[key])}));
  const t=createMessageTranslator<string>(locale,dictionaries as {'pt-BR':Record<string,string>});
  const unresolvedAfterInterpolation=keys.filter(key=>parameters(t(key,Object.fromEntries(parameters(base[key]).map(name=>[name,'QA_'+name])))).length>0);
  return{locale,keys:Object.keys(catalog).length,missing,extra,parameterMismatch,unresolvedAfterInterpolation};
 });
 const fallback=createMessageTranslator<string>('unknown-locale',dictionaries as {'pt-BR':Record<string,string>});
 const fallbackFailures=keys.filter(key=>fallback(key)!==base[key]);
 return{baseKeys:keys.length,locales,fallbackFailures,structuralPass:!fallbackFailures.length&&locales.every(l=>!l.missing.length&&!l.extra.length&&!l.parameterMismatch.length&&!l.unresolvedAfterInterpolation.length)};
}
/** Read only string/object literals and aliases; never execute a UI module to inspect private catalog constants. */
export async function readLiteralCatalog(file:string,variable:string):Promise<Dictionaries>{
 const text=await readFile(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const declarations=new Map<string,ts.Expression>();
 for(const statement of source.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.initializer)declarations.set(declaration.name.text,declaration.initializer);
 function literal(node:ts.Expression,seen=new Set<string>()):unknown{
  if(ts.isStringLiteralLike(node))return node.text;
  if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isTypeAssertionExpression(node))return literal(node.expression,seen);
  if(ts.isIdentifier(node)){if(seen.has(node.text)||!declarations.has(node.text))throw Error('Nonliteral alias '+node.text);return literal(declarations.get(node.text)!,new Set([...seen,node.text]));}
  if(ts.isObjectLiteralExpression(node)){const result=Object.create(null);for(const property of node.properties){if(!ts.isPropertyAssignment(property)||!property.name||(!ts.isIdentifier(property.name)&&!ts.isStringLiteralLike(property.name)))throw Error('Unsupported catalog property');result[property.name.text]=literal(property.initializer,seen);}return result;}
  throw Error('Catalog requires static literal: '+ts.SyntaxKind[node.kind]);
 }
 const declaration=declarations.get(variable);if(!declaration)throw Error('Missing '+variable+' in '+file);
 return literal(declaration)as Dictionaries;
}

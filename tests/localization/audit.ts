import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {catalogs,SUPPORTED_LOCALES} from '../../packages/i18n/index';
const root=process.cwd();
const features=['goals','work','governance','meetings','administration','platform','interoperability','structure-advanced'];
async function sources(directory:string):Promise<string[]>{
 const result:string[]=[];for(const file of await readdir(directory,{withFileTypes:true})){
  const absolute=path.join(directory,file.name);if(file.isDirectory()&&file.name!=='evidence')result.push(...await sources(absolute));else if(file.isFile()&&/\.(ts|tsx)$/.test(file.name)&&!/(test|preview)/.test(file.name))result.push(absolute);
 }return result;
}
const files=['web/src/App.tsx','web/src/account/index.tsx',...(await Promise.all(features.map(feature=>sources(path.join(root,'web/src/features',feature))))).flat().map(file=>path.relative(root,file))];
const findings=[];
for(const file of files){
 const text=await readFile(file,'utf8');const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const literals:{line:number;text:string;kind:string}[]=[];
 function visit(node:ts.Node){
  if(ts.isJsxText(node)&&node.getText().trim())literals.push({line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,text:node.getText().trim().replace(/\s+/g,' ').slice(0,180),kind:'jsx-text-review'});
  if(ts.isCallExpression(node)&&/toLocale|localeCompare|DateTimeFormat|NumberFormat|Collator/.test(node.expression.getText(source))&&node.arguments.some(argument=>ts.isStringLiteral(argument)&&/^(pt-BR|en-US|en-CA)$/.test(argument.text)))literals.push({line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,text:node.getText().slice(0,180),kind:'hardcoded-region-review'});
  ts.forEachChild(node,visit);
 }visit(source);
 findings.push({file,sha256:createHash('sha256').update(text).digest('hex'),usesLocalization:/useLocalization/.test(text),findings:literals});
}
const report={generatedAt:new Date().toISOString(),scope:'Static candidate inventory; findings require owner review, not proof of incomplete/complete translation',catalogs:SUPPORTED_LOCALES.map(locale=>({locale,keys:Object.keys(catalogs[locale]).length})),files:findings};
await mkdir('tests/localization/evidence',{recursive:true});await writeFile('tests/localization/evidence/string-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({files:findings.length,jsxText:findings.reduce((n,f)=>n+f.findings.filter(x=>x.kind==='jsx-text-review').length,0),regional:findings.reduce((n,f)=>n+f.findings.filter(x=>x.kind==='hardcoded-region-review').length,0),output:'tests/localization/evidence/string-audit.json'}));

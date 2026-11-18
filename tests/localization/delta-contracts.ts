import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {inspectCatalog,readLiteralCatalog,type Dictionaries} from './catalog-contract';
const targets=[
 {id:'meetings',file:'web/src/features/meetings/messages.ts',variable:'meetingMessages',exported:true,consumers:['web/src/features/meetings/index.tsx','web/src/features/meetings/collaboration.tsx'],translator:'t'},
 {id:'work',file:'web/src/features/work/messages.ts',variable:'workMessages',exported:true,consumers:['web/src/features/work/index.tsx','web/src/features/work/statistics-view.tsx'],translator:'text'},
 {id:'mfa',file:'web/src/account/MfaSettings.tsx',variable:'messages',exported:false,consumers:['web/src/account/MfaSettings.tsx'],translator:'t'},
 {id:'admission',file:'web/src/admission/messages.ts',variable:'dictionaries',exported:false,consumers:['web/src/admission/OrgAdmission.tsx'],translator:'t'},
];
const files=[...new Set([...targets.flatMap(t=>[t.file,...t.consumers]),...['en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL'].map(locale=>'web/src/features/meetings/messages/'+locale+'.ts'),'web/src/features/meetings/use-localization.ts','web/src/App.tsx','web/src/account/index.tsx','web/src/localization/index.tsx','packages/i18n/index.ts'])];
async function snapshot(){return Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));}
const before=await snapshot(),checks=[];
for(const target of targets){
 const dictionaries:Dictionaries=target.exported?(await import('../../'+target.file))[target.variable]:await readLiteralCatalog(target.file,target.variable);
 const catalog=inspectCatalog(dictionaries),consumers=[];
 for(const file of target.consumers){
  const text=await readFile(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const missingKeys:{line:number;key:string}[]=[],missingParams:{line:number;key:string;missing:string[]}[]=[],remainingText:{line:number;text:string}[]=[],remainingAttributes:{line:number;attribute:string;text:string}[]=[],regionalCalls:{line:number;text:string}[]=[];
  let staticCalls=0,dynamicCalls=0;
  function visit(node:ts.Node){
   const line=source.getLineAndCharacterOfPosition(node.getStart()).line+1;
   if(ts.isJsxText(node)&&/[A-Za-zÀ-ÿ]{2}/.test(node.getText().trim()))remainingText.push({line,text:node.getText().trim().replace(/\s+/g,' ').slice(0,180)});
   if(ts.isJsxAttribute(node)&&['label','aria-label','title','placeholder','alt'].includes(node.name.getText(source))&&node.initializer&&ts.isStringLiteralLike(node.initializer)&&/[A-Za-zÀ-ÿ]{2}/.test(node.initializer.text))remainingAttributes.push({line,attribute:node.name.getText(source),text:node.initializer.text});
   if(ts.isCallExpression(node)&&/\.(toLocaleString|toLocaleDateString|toLocaleTimeString)$/.test(node.expression.getText(source))&&(!node.arguments[0]||ts.isStringLiteralLike(node.arguments[0])))regionalCalls.push({line,text:node.getText(source).slice(0,180)});
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===target.translator){
    const key=node.arguments[0];
    if(key&&ts.isStringLiteralLike(key)){
     staticCalls++;
     if(!Object.hasOwn(dictionaries['pt-BR'],key.text))missingKeys.push({line,key:key.text});
     const template=dictionaries['pt-BR'][key.text]??key.text;
     const expected=[...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(m=>m[1]);
     const params=node.arguments[1];
     if(expected.length&&(!params||ts.isObjectLiteralExpression(params))){
      const actual=params?.properties.flatMap(p=>p.name&&(ts.isIdentifier(p.name)||ts.isStringLiteralLike(p.name))?[p.name.text]:[])??[];
      const missing=expected.filter(name=>!actual.includes(name));if(missing.length)missingParams.push({line,key:key.text,missing});
     }
    }else dynamicCalls++;
   }
   ts.forEachChild(node,visit);
  }visit(source);
  consumers.push({file,staticCalls,dynamicCalls,missingKeys,missingParams,remainingJsxTextReviewOnly:remainingText,remainingVisibleAttributesReviewOnly:remainingAttributes,regionalCallsReviewOnly:regionalCalls});
 }
 checks.push({id:target.id,file:target.file,variable:target.variable,readMode:target.exported?'import-pure-catalog':'AST-literals-no-execution',...catalog,consumers,contractPass:catalog.structuralPass&&consumers.every(c=>!c.missingKeys.length&&!c.missingParams.length)});
}
const after=await snapshot(),changedDuringAudit=files.filter(f=>before[f]!==after[f]);
const app=await readFile('web/src/App.tsx','utf8');
const report={checkedAt:new Date().toISOString(),completion:false,scope:'Only delivered Meetings/Work/MFA/admission deltas; structural and static consumer contract, not global coverage or runtime proof',sourceStable:!changedDuringAudit.length,changedDuringAudit,checks,app:{localizationProviderInstances:(app.match(/<LocalizationProvider\b/g)??[]).length,accessibilityProviderInstances:(app.match(/<GlobalAccessibilityProvider\b/g)??[]).length,admissionComponentReferenced:/\bOrgAdmission\b/.test(app),scope:'Static signals only; exact provider branches reviewed separately'},sourceHashes:before,limitations:['Dynamic keys and dynamically assembled parameter objects require owner review.','JSX text candidates exclude string expressions, attributes, arrays and generated labels; this is not exhaustive copy coverage.','Catalog quality and actual App/browser/physical assistive technology require separate proof.']};
await writeFile('tests/localization/evidence/delta-contracts.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:'four delivered deltas',sourceStable:report.sourceStable,checks:checks.map(c=>({id:c.id,keys:c.baseKeys,pass:c.contractPass,catalogIssues:c.locales.filter(l=>l.missing.length||l.extra.length||l.parameterMismatch.length||l.unresolvedAfterInterpolation.length),consumerIssues:c.consumers.flatMap(s=>s.missingKeys.length||s.missingParams.length?[{file:s.file,missingKeys:s.missingKeys,missingParams:s.missingParams}]:[]),jsxReview:c.consumers.reduce((n,s)=>n+s.remainingJsxTextReviewOnly.length,0)})),admissionInApp:report.app.admissionComponentReferenced,completion:false}));
if(changedDuringAudit.length||checks.some(c=>!c.contractPass))process.exitCode=1;

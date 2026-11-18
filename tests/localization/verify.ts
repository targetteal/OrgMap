import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
mkdirSync('tests/localization/evidence',{recursive:true});
const commands=[
 ['typecheck',[ 'node_modules/typescript/bin/tsc','-p','tests/localization/tsconfig.json']],
 ['unit-dom',['--import','tsx','--import','./tests/localization/register.mjs','--test','tests/localization/dom.test.tsx','tests/localization/i18n.test.ts','tests/localization/accessibility.test.ts','tests/localization/fallback.test.ts']],
 ['provider-consumers',['--import','tsx','--test','tests/localization/provider-consumers.test.tsx']],
 ['app-provider',['--import','tsx','--test','tests/localization/app-provider.test.tsx']],
] as const;
const results=[];
for(const [name,args] of commands){
 const result=spawnSync(process.execPath,[...args],{encoding:'utf8',env:{...process.env,TSX_TSCONFIG_PATH:'tests/localization/tsconfig.json'}});
 writeFileSync(`tests/localization/evidence/${name}.log`,result.stdout+result.stderr);
 results.push({name,status:result.status,output:`tests/localization/evidence/${name}.log`});
 if(result.status!==0){console.error(result.stdout+result.stderr);process.exitCode=1;break;}
}
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()&&!['evidence','.vite-cache'].includes(entry.name)?files(path.join(dir,entry.name)):entry.isFile()&&/\.(ts|tsx|css|woff|svg|txt)$/.test(entry.name)?[path.join(dir,entry.name)]:[]);}
const owned=['packages/i18n','web/src/localization','web/src/accessibility','tests/localization'].flatMap(files);
writeFileSync('tests/localization/evidence/verification.json',JSON.stringify({checkedAt:new Date().toISOString(),node:process.version,results,scope:'Scoped typecheck and unit/jsdom; excludes layout/audio/browser/API/PG (separate evidence)',sourceFiles:owned.map(file=>({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}))},null,2)+'\n');
console.log(JSON.stringify(results));

import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const label=process.argv[2];if(!/^[a-z0-9-]+$/.test(label??''))throw Error('SNAPSHOT_LABEL_REQUIRED');
async function files(dir:string):Promise<string[]>{const result:string[]=[];for(const file of await readdir(dir,{withFileTypes:true})){if(file.name==='evidence'||file.name.startsWith('.'))continue;const p=path.join(dir,file.name);if(file.isDirectory())result.push(...await files(p));else if(/\.(ts|tsx|css|json)$/.test(file.name))result.push(p);}return result;}
const sources=[...(await files('web/src')),...(await files('packages')),'package.json','package-lock.json','web/package.json'];
const result=[];for(const file of sources.sort()){const bytes=await readFile(file);result.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(`tests/localization/evidence/source-${label}.json`,JSON.stringify({capturedAt:new Date().toISOString(),files:result},null,2)+'\n');console.log(JSON.stringify({label,files:result.length}));

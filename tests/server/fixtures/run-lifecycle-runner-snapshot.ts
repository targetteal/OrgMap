import {cp,mkdtemp,readdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
const root=process.cwd(),dir=await mkdtemp(join(tmpdir(),'orgmap-runner-snapshot-'));
async function scan(d:string,p=''):Promise<string[]>{const a:string[]=[];for(const e of (await readdir(d,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const n=p?p+'/'+e.name:e.name;if(e.isDirectory())a.push(...await scan(join(d,e.name),n));else if(e.isFile())a.push(createHash('sha256').update(await readFile(join(d,e.name))).digest('hex')+'  '+n);else throw Error('UNEXPECTED_ENTRY');}return a;}
try{
 for(const p of ['server','tests','packages','scripts','package.json','package-lock.json','tsconfig.json'])await cp(join(root,p),join(dir,p),{recursive:true,filter:p=>!p.split('/').some(x=>x==='node_modules'||x==='dist'||x==='.DS_Store')});
 const manifest=(await scan(dir)).join('\n')+'\n',hash=createHash('sha256').update(manifest).digest('hex');await writeFile(join(dir,'MANIFEST.sha256'),manifest);await symlink(join(root,'node_modules'),join(dir,'node_modules'),'dir');console.log('runner-snapshot',hash,'node_modules=shared');
 const child=spawn(process.execPath,['--import','tsx','--test','tests/server/organization-deletion-runner.test.ts'],{cwd:dir,stdio:'inherit',env:process.env});const code=await new Promise<number|null>((ok,fail)=>{child.once('error',fail);child.once('exit',ok)});
 await rm(join(dir,'MANIFEST.sha256'));await rm(join(dir,'node_modules'));if((await scan(dir)).join('\n')+'\n'!==manifest)throw Error('SNAPSHOT_DRIFT');console.log('runner-snapshot-verified',hash);if(code!==0)throw Error('RUNNER_PROOF_FAILED');
} finally {await rm(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import pg from 'pg';

// Explicit acceptance probe: only this newly spawned launcher may be signalled.
// Run against a clean frozen candidate; the launcher owns its database and roles.
const root=resolve(process.argv[2]??'.');
const head=execFileSync('rtk',['proxy','git','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.match(head,/^[a-f0-9]{40}$/);
assert.equal(execFileSync('rtk',['proxy','git','status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
const source=process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(source).hostname));
const admin=new pg.Pool({connectionString:source});
const directory=join(root,'.orgmap/candidates');
const before=new Set(await readdir(directory).catch(()=>[]));
let output='',exited=false;
const child=spawn(process.execPath,['--import','tsx','server/integration/candidate.ts','--expected-ref='+head,'--api-port=3358','--web-port=5258','--hostname=qa.orgmap.localhost'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',d=>{output+=d.toString();});child.stderr.on('data',d=>{output+=d.toString();});
const completion=new Promise<number|null>((ok,no)=>{child.once('error',no);child.once('close',code=>{exited=true;ok(code);});});
const delay=()=>new Promise(r=>setTimeout(r,30));
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return false;throw e;}};
try{
 let path='',manifest:any;
 const deadline=Date.now()+60000;
 while(Date.now()<deadline&&!exited){
  const dirs=(await readdir(directory).catch(()=>[])).filter(x=>!before.has(x));
  assert.ok(dirs.length<=1,'Unexpected concurrent candidate launcher');
  if(dirs[0]){
   path=join(directory,dirs[0],'manifest.json');
   try{manifest=JSON.parse(await readFile(path,'utf8'));}catch{await delay();continue;}
   assert.equal(manifest.head,head);
   if((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[manifest.acceptanceRole])).rowCount)break;
  }
  await delay();
 }
 assert.ok(path&&manifest&&!exited,'Launcher did not reach private-role startup: '+output.slice(-1000));
 assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[manifest.acceptanceRole])).rowCount,1);
 const rows=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(x=>x.trim().split(/\s+/).map(Number));
 const owned=new Set([child.pid!]);
 for(let changed=true;changed;){changed=false;for(const[pid,ppid]of rows)if(owned.has(ppid)&&!owned.has(pid)){owned.add(pid);changed=true;}}
 child.kill('SIGTERM');
 let timer:ReturnType<typeof setTimeout>|undefined;
 const code=await Promise.race([completion,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(Error('CANDIDATE_INTERRUPTION_TIMEOUT')),20000);})]).finally(()=>clearTimeout(timer));
 const final=JSON.parse(await readFile(path,'utf8'));
 assert.ok(['STOPPED','FAILED'].includes(final.status));assert.equal(final.createdRolesAbsentVerified,true);
 assert.equal(final.acceptanceRoleRemoved,true);assert.equal(final.databaseRemoved,true);
 assert.match(final.database,/^orgmap_fresh_[a-f0-9]{32}$/);
 assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[final.database])).rowCount,0);
 const roles=[final.acceptanceRole,final.dispatcherRole,final.iamMailRole];
 assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])',[roles])).rowCount,0);
 const end=Date.now()+3000;while([...owned].some(alive)&&Date.now()<end)await delay();
 assert.deepEqual([...owned].filter(alive),[],'Owned launcher descendant remains alive');
 console.log(JSON.stringify({head,signal:'SIGTERM',phase:'private-acceptance-role',exitCode:code,database:final.database,roles,databaseRemoved:true,rolesRemoved:true,ownedProcessesAbsent:true}));
}finally{
 if(!exited){child.kill('SIGTERM');await completion;}
 await admin.end();
}

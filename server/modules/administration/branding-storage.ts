import { constants } from 'node:fs';
import { mkdir,open,lstat,link,unlink } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';

export interface ReservedBrandingStore {
  /** The caller must have committed the key/digest reservation before invoking. */
  putReserved(key:string,bytes:Uint8Array):Promise<{key:string;sha256:string;size:number}>;
  /** Missing garbage is idempotent; existing unexpected bytes are held. */
  removeChecked(ref:{key:string;sha256:string;size:number}):Promise<void>;
  inspectReserved(ref:{key:string;sha256:string;size:number}):Promise<'ABSENT'|'COMPLETE'|'MISMATCH'>;
  read(ref:{key:string;sha256:string}):Promise<Uint8Array>;
}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Dedicated private namespace. Both final and crash temporary names derive from
 * the already recorded key; no random unowned byte file is created.
 */
export function createReservedBrandingStore(directory:string):ReservedBrandingStore {
  const root=resolve(directory);
  const path=(key:string)=>{if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(key))throw Error('INVALID_BRANDING_STORAGE_KEY');return join(root,key);};
  async function ready(){await mkdir(root,{recursive:true,mode:0o700});const st=await lstat(root);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077))throw Error('BRANDING_STORAGE_DIRECTORY_UNSAFE');}
  async function sync(){const f=await open(root,constants.O_RDONLY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
  async function putReserved(key:string,bytes:Uint8Array){
    const target=path(key);if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>5242880)throw Error('BRANDING_STORAGE_SIZE_INVALID');
    await ready();const staged=target+'.staged';
    const f=await open(staged,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
    // link is no-overwrite. An existing final/staged file requires reconciliation.
    await link(staged,target);await sync();await unlink(staged);await sync();
    return {key,sha256:digest(bytes),size:bytes.byteLength};
  }
  async function inspectReserved(ref:{key:string;sha256:string;size:number}):Promise<'ABSENT'|'COMPLETE'|'MISMATCH'>{
    const p=path(ref.key);if(!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.size)||ref.size<1||ref.size>5242880)throw Error('BRANDING_STORAGE_REFERENCE_INVALID');
    await ready();let found=false;
    for(const name of [p,p+'.staged']){
      let f;try{f=await open(name,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e:any){if(e.code==='ENOENT')continue;throw e;}
      found=true;try{const st=await f.stat();if(!st.isFile()||st.size!==ref.size||(st.mode&0o077))return 'MISMATCH';if(digest(await f.readFile())!==ref.sha256)return 'MISMATCH';}finally{await f.close();}
    }
    return found?'COMPLETE':'ABSENT';
  }
  async function removeChecked(ref:{key:string;sha256:string;size:number}){
    const p=path(ref.key);
    // Validate both names before touching either. A collision or partial write
    // is never silently treated as this garbage object's complete bytes.
    if(await inspectReserved(ref)==='MISMATCH')throw Error('BRANDING_STORAGE_GARBAGE_MISMATCH');
    for(const name of [p,p+'.staged'])await unlink(name).catch((e:any)=>{if(e.code!=='ENOENT')throw e;});await sync();
  }
  return {
    putReserved,
    removeChecked,
    inspectReserved,
    async read(ref){const p=path(ref.key);await ready();const f=await open(p,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await f.stat();if(!st.isFile()||st.size>5242880||(st.mode&0o077))throw Error('BRANDING_STORAGE_FILE_UNSAFE');const bytes=await f.readFile();if(digest(bytes)!==ref.sha256)throw Error('BRANDING_STORAGE_INTEGRITY_FAILED');return bytes;}finally{await f.close();}},
  };
}

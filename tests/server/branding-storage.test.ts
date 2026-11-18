import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm,symlink,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { createReservedBrandingStore } from '../../server/modules/administration/branding-storage.js';

test('reserved branding bytes use the precommitted key, private permissions and verified digest',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orgmap-reserved-branding-'));
  try{
    const store=createReservedBrandingStore(root),key=randomUUID(),bytes=Buffer.from('normalized raster fixture');
    const result=await store.putReserved(key,bytes);
    assert.deepEqual(result,{key,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    assert.deepEqual(await store.read(result),bytes);
    assert.equal((await stat(join(root,key))).mode&0o077,0);
    await assert.rejects(store.read({key,sha256:'0'.repeat(64)}),/INTEGRITY/);
    await assert.rejects(store.putReserved('../outside',bytes),/STORAGE_KEY/);
    await store.removeChecked(result);await store.removeChecked(result);
    await assert.rejects(readFile(join(root,key)),/ENOENT/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a conflicting publication keeps both bytes under the reserved key and never overwrites the existing final file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orgmap-reserved-branding-'));
  try{
    const store=createReservedBrandingStore(root),key=randomUUID();
    await writeFile(join(root,key),'existing',{mode:0o600});
    await assert.rejects(store.putReserved(key,Buffer.from('new staged bytes')),/EEXIST/);
    assert.equal(await readFile(join(root,key),'utf8'),'existing');
    assert.equal(await readFile(join(root,key)+'.staged','utf8'),'new staged bytes');
    // A retry cannot silently take over a possibly interrupted writer.
    await assert.rejects(store.putReserved(key,Buffer.from('retry')),/EEXIST/);
    assert.equal(await readFile(join(root,key)+'.staged','utf8'),'new staged bytes');
    await assert.rejects(store.removeChecked({key,sha256:createHash('sha256').update('new staged bytes').digest('hex'),size:16}),/GARBAGE_MISMATCH/);
    assert.equal(await readFile(join(root,key),'utf8'),'existing');
    assert.equal(await readFile(join(root,key)+'.staged','utf8'),'new staged bytes');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('reserved storage rejects a symlink as either namespace or byte file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orgmap-reserved-branding-'));
  try{
    const real=join(root,'real'),alias=join(root,'alias'),target=join(root,'outside');
    const {mkdir}=await import('node:fs/promises');await mkdir(real,{mode:0o700});await symlink(real,alias);await writeFile(target,'preserved',{mode:0o600});
    await assert.rejects(createReservedBrandingStore(alias).putReserved(randomUUID(),Buffer.from('bytes')),/DIRECTORY_UNSAFE/);
    const key=randomUUID();await symlink(target,join(real,key));
    await assert.rejects(createReservedBrandingStore(real).read({key,sha256:'0'.repeat(64)}));
    assert.equal(await readFile(target,'utf8'),'preserved');
  }finally{await rm(root,{recursive:true,force:true});}
});

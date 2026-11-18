import test from 'node:test';
import assert from 'node:assert/strict';
import {assertManagedWriter} from '../../server/src/managed-writer.js';

function client(managed: boolean, identity = managed) {
 return { async query(sql: string) {
  if(sql.includes("to_regclass('public.organization_runtime_mode')")) return {rows:[{name:'organization_runtime_mode'}]};
  if(sql.includes("to_regclass('public.organization_runtime_identity')")) return {rows:[{name:'organization_runtime_identity'}]};
  if(sql.includes('SELECT managed FROM')) return {rows:[{managed}]};
  if(sql.includes('SELECT authority_id')) return {rows:identity ? [{authority_id:'a',instance_id:'b',epoch:'1'}] : []};
  if(sql.includes('current_database()')) return {rows:[{database:'db',host:'127.0.0.1',port:5432}]};
  throw Error(`unexpected query ${sql}`);
 } } as any;
}
test('unmanaged database needs no process join', async()=>assert.doesNotReject(assertManagedWriter(client(false))));
test('a managed identity without a joined process is rejected', async()=>assert.rejects(assertManagedWriter(client(true)),/HOST_WRITER_REGISTRATION_REQUIRED/));
test('inconsistent database mode or missing managed identity fails closed', async()=>{
 await assert.rejects(assertManagedWriter(client(false,true)),/HOST_DATABASE_BINDING_MISMATCH/);
 await assert.rejects(assertManagedWriter(client(true,false)),/HOST_DATABASE_BINDING_MISMATCH/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {diffText}=await vite.ssrLoadModule('/src/text-diff.tsx');
test.after(()=>vite.close());

test('word changes preserve the complete old and proposed wording',()=>{
  const before='Revisar os acordos do círculo.';
  const after='Revisar e publicar os acordos do círculo.';
  const parts=diffText(before,after);
  assert.equal(parts.filter((part:any)=>part.type!=='added').map((part:any)=>part.text).join(''),before);
  assert.equal(parts.filter((part:any)=>part.type!=='removed').map((part:any)=>part.text).join(''),after);
  assert.ok(parts.some((part:any)=>part.type==='added'&&part.text.includes('publicar')));
});

test('large multiline documents retain both texts without an unbounded diff matrix',()=>{
  const before='A\n'.repeat(20000),after='B\n'.repeat(20000);
  const parts=diffText(before,after);
  assert.equal(parts.filter((part:any)=>part.type!=='added').map((part:any)=>part.text).join(''),before);
  assert.equal(parts.filter((part:any)=>part.type!=='removed').map((part:any)=>part.text).join(''),after);
});

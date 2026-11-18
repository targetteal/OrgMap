/** Run once per isolated schema profile supplied by readiness-isolated harness. */
import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const candidate=process.env.ORGMAP_QA_CANDIDATE??process.cwd();
const {buildApp}=await import(pathToFileURL(resolve(candidate,'server/src/app.ts')).href);
const {pool}=await import(pathToFileURL(resolve(candidate,'server/src/db.ts')).href);
const app=await buildApp();after(async()=>{await app.close();await pool.end();});
const profile=process.env.ORGMAP_QA_SCHEMA_PROFILE??'valid_foundation';
test('Liveness remains distinct from schema readiness ('+profile+')',async()=>{
 const live=await app.inject({method:'GET',url:'/api/live'});
 assert.equal(live.statusCode,200,'Database process is available for every schema profile');
});
test('Readiness checks migrations and checksums ('+profile+')',async()=>{
 const endpoint=['/api/ready','/api/readiness','/readyz'].find(url=>app.hasRoute({method:'GET',url}));
 assert.ok(endpoint,'No distinct schema-aware readiness endpoint is registered');
 const ready=await app.inject({method:'GET',url:endpoint});
 assert.equal(ready.statusCode,profile==='valid_foundation'?200:503,'Schema profile must affect readiness');
});

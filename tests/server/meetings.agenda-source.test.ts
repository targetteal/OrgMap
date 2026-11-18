import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readAgendaSource} from '../../server/modules/meetings/agenda-source.js';
test('agenda provenance delegates source authorization without falling back to a title or meeting access',async()=>{
 const ctx={} as any,calls:unknown[]=[];
 const trace={tension:async(c:any,id:string)=>{assert.equal(c,ctx);calls.push(['tension',id]);return null;},destination:async(c:any,kind:string,id:string)=>{assert.equal(c,ctx);calls.push([kind,id]);return kind==='PROPOSAL'?{id}:null;}} as any;
 assert.equal(await readAgendaSource(ctx,'TENSION','private-tension',trace),null);
 assert.deepEqual(await readAgendaSource(ctx,'PROPOSAL','visible-proposal',trace),{id:'visible-proposal'});
 for(const kind of ['PROJECT','TASK','GOAL'])assert.equal(await readAgendaSource(ctx,kind,'private',trace),null);
 for(const kind of ['MANUAL','LEGACY_UNKNOWN','INVALID'])assert.equal(await readAgendaSource(ctx,kind,'known-id',trace),null);
 assert.equal(await readAgendaSource(ctx,'PROPOSAL',null,trace),null);
 assert.equal(await readAgendaSource(ctx,'PROPOSAL','known-id'),null);
 assert.equal(calls.length,5);
});

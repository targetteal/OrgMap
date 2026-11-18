import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageTranslator} from '../../packages/i18n/index';

test('unknown domain keys do not resolve inherited properties while explicit prototype-named keys still translate',()=>{
 const t=createMessageTranslator<string>('en-US',{'pt-BR':{save:'Salvar'},'en-US':{save:'Save'}});
 for(const key of ['toString','constructor','hasOwnProperty','__proto__'])assert.equal(t(key),key);
 const dictionary=Object.fromEntries([['toString','Representação'],['__proto__','Protótipo']]);
 const explicit=createMessageTranslator<string>('fr-FR',{'pt-BR':dictionary,'fr-FR':Object.fromEntries([['toString','Représentation']])});
 assert.equal(explicit('toString'),'Représentation');
 assert.equal(explicit('__proto__'),'Protótipo');
});

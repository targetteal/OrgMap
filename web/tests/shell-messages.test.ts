import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_LOCALES} from '../../packages/i18n/index.js';
import {shellMessages,shellTranslator} from '../src/shell-messages.js';

test('shell navigation names are present in all eight locales',()=>{
 const keys=Object.keys(shellMessages['pt-BR']).sort();
 for(const locale of SUPPORTED_LOCALES){
  const messages=shellMessages[locale];
  assert.deepEqual(Object.keys(messages).sort(),keys,locale);
  for(const key of keys)assert.ok(messages[key as keyof typeof messages]?.trim(),`${locale}: ${key}`);
 }
 assert.equal(shellTranslator('es-ES')('proposals'),'Propuestas');
 assert.equal(shellTranslator('ja-JP')('mainNavigation'),'メインナビゲーション');
});

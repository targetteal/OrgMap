import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_LOCALES} from '../../packages/i18n/index.js';
import {proposalComposerMessages,proposalComposerTranslator} from '../src/features/governance/proposal-composer-copy.js';

test('proposal composer has complete, nonempty copy in every supported locale',()=>{
 const keys=Object.keys(proposalComposerMessages['pt-BR']).sort();
 for(const locale of SUPPORTED_LOCALES){
  const messages=proposalComposerMessages[locale];
  assert.deepEqual(Object.keys(messages).sort(),keys,locale);
  for(const key of keys)assert.ok(messages[key as keyof typeof messages]?.trim(),`${locale}: ${key}`);
  assert.equal(proposalComposerTranslator(locale)('source'),messages.source);
 }
});

test('source completion and asynchronous period are localized and interpolate safely',()=>{
 assert.equal(proposalComposerTranslator('es-ES')('tensionDescription'),'Descripción de la tensión');
 assert.equal(proposalComposerTranslator('ja-JP')('sourceDescriptionRequired'),'続ける前にテンションを説明してください。');
 for(const locale of SUPPORTED_LOCALES){
  const t=proposalComposerTranslator(locale);
  const message=t('asyncNote',{count:'7',unit:t('days')});
  assert.ok(message.includes('7'),locale);
  assert.ok(!/\{(?:count|unit)\}/.test(message),locale);
 }
});

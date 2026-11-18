import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_LOCALES} from '../../packages/i18n/index.js';
import {richTextMessages,richTextTranslator} from '../src/editor/rich-text-messages.js';
import {mentionLabel} from '../src/editor/role-mentions.js';

test('shared rich editor has complete, nonempty copy in every supported locale',()=>{
 const keys=Object.keys(richTextMessages['pt-BR']).sort();
 for(const locale of SUPPORTED_LOCALES){
  const messages=richTextMessages[locale];
  assert.deepEqual(Object.keys(messages).sort(),keys,locale);
  for(const key of keys)assert.ok(messages[key as keyof typeof messages]?.trim(),`${locale}: ${key}`);
  assert.equal(richTextTranslator(locale)('insertLink'),messages.insertLink);
  const toolbar=richTextTranslator(locale)('toolbar',{label:'Tensión'});
  assert.ok(toolbar.includes('Tensión'),locale);
  assert.ok(!toolbar.includes('{label}'),locale);
 }
});

test('role mention labels follow locale and preserve role identity',()=>{
 const role={id:'role-1',name:'Facilitador',archived:true};
 assert.equal(mentionLabel(role,'es-ES'),'@Facilitador (archivado)');
 assert.equal(mentionLabel(role,'ja-JP'),'@Facilitador（アーカイブ済み）');
 assert.equal(mentionLabel(undefined,'ja-JP'),'@利用できないロール');
});

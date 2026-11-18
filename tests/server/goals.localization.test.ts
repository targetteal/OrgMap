import {test} from 'node:test';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {goalMessages,goalTranslator} from '../../web/src/features/goals/messages.js';
test('Goal action/state catalogs support eight locales with explicit Portuguese fallback',()=>{
  const locales=['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL'];
  const expected=Object.keys(goalMessages['pt-BR']).sort();
  assert.ok(expected.length>=210);
  for(const locale of locales){
    const catalog=goalMessages[locale as keyof typeof goalMessages];
    assert.deepEqual(Object.keys(catalog??{}).sort(),expected);
    for(const key of expected){
      const translated=goalTranslator(locale)(key);
      assert.equal(typeof translated,'string');
      assert.ok(translated.length>0,locale+': '+key);
      const placeholders=(value:string)=>[...value.matchAll(/\{([a-zA-Z]+)\}/g)].map(match=>match[1]).sort();
      assert.deepEqual(placeholders(translated),placeholders(catalog![key]),locale+': placeholders in '+key);
    }
  }
  assert.equal(goalTranslator('en-US')('Adicionar objetivo'),'Add goal');
  assert.equal(goalTranslator('en-US')('goalCountOther',{count:2}),'2 goals');
  assert.equal(goalTranslator('ja-JP')('Salvar'),'保存');
  assert.equal(goalTranslator('fr-FR')('Em risco'),'À risque');
  assert.equal(goalTranslator('not-a-locale')('Adicionar objetivo'),'Adicionar objetivo');
  assert.equal(goalTranslator('en-US')('Nome criado pela pessoa'),'Nome criado pela pessoa');
});

test('Goal-owned UI messages have catalog entries and no untranslated JSX prose',async()=>{
 const catalog=goalMessages['pt-BR'];
 for(const path of ['../../web/src/features/goals/index.tsx','../../web/src/features/goals/rich-text.tsx']){
  const contents=await readFile(new URL(path,import.meta.url),'utf8');
  const source=ts.createSourceFile(path,contents,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function inspect(node:ts.Node){
   if(ts.isJsxText(node))assert.ok(!/[A-Za-zÀ-ú]/.test(node.text.trim()),'Untranslated JSX prose: '+node.text.trim());
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))assert.ok(Object.hasOwn(catalog,node.arguments[0].text),'Missing key: '+node.arguments[0].text);
   if(ts.isJsxAttribute(node)&&node.name.getText(source)==='label'&&ts.isStringLiteral(node.initializer!)&&node.parent.parent.tagName.getText(source)==='Field'){
    const base=node.initializer!.text.replace(/ obrigatóri[oa]s?$/,'');
    assert.ok(Object.hasOwn(catalog,base),'Missing field: '+base);
   }
   ts.forEachChild(node,inspect);
  }
  inspect(source);
 }
});

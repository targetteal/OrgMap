import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fromPlainText,readContent,validateRichDocument,renderHTML,toPlainText} from '../../packages/content/index.js';
test('Goal rich descriptions use shared pure schema, literal legacy text and safe HTML',()=>{
 const rich=validateRichDocument({format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Prioridade 🌿 <script>',marks:[{type:'bold'}]},{type:'text',text:'fonte',marks:[{type:'link',attrs:{href:'https://example.com'}}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Ação'}]}]}]}]}});
 assert.match(renderHTML(rich),/<strong>Prioridade 🌿 &lt;script&gt;<\/strong>/);
 assert.match(renderHTML(rich),/<ul><li><p>Ação<\/p><\/li><\/ul>/);
 assert.match(toPlainText(rich),/Ação/);
 assert.deepEqual(readContent('**literal** <b>'),fromPlainText('**literal** <b>'));
 const unsafe=structuredClone(rich);(unsafe.doc.content[0] as any).content[1].marks[0].attrs.href='javascript:alert(1)';
 assert.throws(()=>validateRichDocument(unsafe));
 assert.throws(()=>validateRichDocument({...rich,version:2}));
});

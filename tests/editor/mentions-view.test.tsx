import {test} from "node:test";
import assert from "node:assert/strict";
import {renderToStaticMarkup} from "react-dom/server";
import {RoleMentionProvider} from "../../web/src/editor/role-mentions.tsx";
import {RichTextView} from "../../web/src/editor/RichTextView.tsx";
import {validateRichDocument} from "../../packages/content/index.ts";
const roleId='11111111-1111-4111-8111-111111111111';
const rich=validateRichDocument({format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'roleMention',attrs:{roleId,label:'Nome ao escrever'}}]}]}});
test('read view resolves current identity, keeps route through rename and hides names outside readable scope',()=>{
 const render=(roles:any[])=>renderToStaticMarkup(<RoleMentionProvider value={{organizationId:'org-a',roles}}><RichTextView value={rich}/></RoleMentionProvider>);
 const named=render([{id:roleId,name:'Nome atual'}]);assert.match(named,new RegExp('href="/roles/'+roleId+'"'));assert.match(named,/@Nome atual/);assert.doesNotMatch(named,/Nome ao escrever/);
 const renamed=render([{id:roleId,name:'Novo nome'}]);assert.match(renamed,new RegExp('href="/roles/'+roleId+'"'));assert.match(renamed,/@Novo nome/);
 const archived=render([{id:roleId,name:'Nome atual',archived:true}]);assert.match(archived,/arquivado/);assert.doesNotMatch(archived,/href=/);
 const unavailable=render([]);assert.match(unavailable,/Papel indisponível/);assert.doesNotMatch(unavailable,/Nome ao escrever|Nome atual|href=/);
});

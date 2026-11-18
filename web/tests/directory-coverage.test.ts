import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("empty partial directory does not claim exhaustive absence", async () => {
  const vite = await createServer({root:new URL("../",import.meta.url).pathname, configFile:false, logLevel:"error", server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:"custom"});
  try {
    const { StructureDirectory, authorizedDirectoryViewNodes } = await vite.ssrLoadModule("/src/StructureDirectory.tsx");
    const nodes=[{nodeId:'n-c',entityId:'c',kind:'CIRCLE',name:'Circle',parentNodeId:null,version:1},{nodeId:'n-r',entityId:'r',kind:'ROLE',name:'Role',parentNodeId:'n-c',version:1},{nodeId:'n-redacted',entityId:'redacted',kind:'ROLE',name:'Redacted',parentNodeId:'n-c',pathRedacted:true,version:1}];
    const graph=(ids:string[])=>({entities:ids.map(id=>({id,kind:id==='c'?'CIRCLE':'ROLE',name:id,version:2})),coverage:{complete:false,depthLimited:false}});
    assert.equal(authorizedDirectoryViewNodes(graph(['c','r']),nodes).find((n:any)=>n.entityId==='r').parentNodeId,'n-c');
    assert.equal(authorizedDirectoryViewNodes(graph(['r']),nodes)[0].parentNodeId,null);
    assert.equal(authorizedDirectoryViewNodes(graph(['c','redacted']),nodes).find((n:any)=>n.entityId==='redacted').parentNodeId,null);
    assert.equal(authorizedDirectoryViewNodes(graph(['hidden']),nodes).length,0);
    const context = {path:"/structure/directory",organizationId:"synthetic",bootstrap:{rootCircleId:null,modules:{},membership:{memberType:"MEMBER"}},structure:{nodes:[],coverage:{complete:false,depthLimited:true,degradedReasons:[]}},navigate:()=>{}};
    const partial = renderToStaticMarkup(createElement(StructureDirectory,{context}));
    assert.match(partial,/Diretório parcial/);
    assert.match(partial,/Nenhum resultado nos dados disponíveis/);
    assert.doesNotMatch(partial,/Nenhum círculo ou papel encontrado/);
    const complete = renderToStaticMarkup(createElement(StructureDirectory,{context:{...context,structure:{...context.structure,coverage:{complete:true,depthLimited:false,degradedReasons:[]}}}}));
    assert.match(complete,/Nenhum círculo ou papel encontrado/);
    assert.doesNotMatch(complete,/Diretório parcial/);
  } finally { await vite.close(); }
});

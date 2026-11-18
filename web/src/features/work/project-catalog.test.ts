import test from "node:test";
import assert from "node:assert/strict";
import { groupProjects, projectOrderIds, moveProjectOrder, type ProjectGrouping } from "./project-catalog";

test("catalog grouping keeps projects unique, respects primary circles and uses descriptive links without occupancy inference", () => {
  const a={id:"a",creatorId:"creator",circleId:"primary",tags:["research","extra"],projectStateId:"doing",contextLinks:[{kind:"CIRCLE",targetId:"second"},{kind:"PARTICIPANT",targetId:"person"},{kind:"PARTICIPANT",targetId:"other"},{kind:"ROLE",targetId:"role"},{kind:"ROLE",targetId:"another"}]};
  const b={id:"b",creatorId:"creator",tags:[],contextLinks:[{kind:"CIRCLE",targetId:"second"}]};
  const c={id:"c",creatorId:"creator",tags:[],contextLinks:[]};
  const names={entity:(id:string)=>id,member:(id:string)=>id,state:(id:string)=>id};
  for(const grouping of ["NONE","STATE","CIRCLE","PERSON","ROLE","TAG"] as ProjectGrouping[]) {
    const groups=groupProjects([a,b,c],grouping,names);
    assert.equal(groups.reduce((sum,group)=>sum+group.projects.length,0),3);
    assert.equal(new Set(groups.flatMap((group)=>group.projects.map((project)=>project.id))).size,3);
  }
  assert.deepEqual(groupProjects([a,b,c],"CIRCLE",names).map((group)=>group.id),["primary","second",""]);
  assert.deepEqual(groupProjects([a,b,c],"PERSON",names).map((group)=>[group.id,group.projects.map((project)=>project.id)]),[["person",["a"]],["creator",["b","c"]]]);
  assert.deepEqual(groupProjects([a,b,c],"ROLE",names).map((group)=>group.id),["role",""]);
  assert.deepEqual(groupProjects([a,b,c],"TAG",names).map((group)=>group.id),["research",""]);
  assert.equal(groupProjects([a],"ROLE",{...names,entity:()=>undefined})[0].name,"Papel indisponível");
});

test("personal order drops unavailable references, appends new projects and moves only the selected identity",()=>{
  const items=[{id:"a",title:"A"},{id:"b",title:"B"},{id:"c",title:"C"}];
  const order=projectOrderIds(items,["b","gone","b"],(a,b)=>a.localeCompare(b));
  assert.deepEqual(order,["b","a","c"]);
  assert.deepEqual(moveProjectOrder(order,"c","b","before"),["c","b","a"]);
  assert.deepEqual(moveProjectOrder(order,"b","c","after"),["a","c","b"]);
  assert.deepEqual(moveProjectOrder(order,"gone","c","after"),order);
  assert.deepEqual(order,["b","a","c"]);
});

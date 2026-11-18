import { test } from "node:test";
import assert from "node:assert/strict";
import { resourceDestination } from "../src/features/platform/resource-route.ts";

const id = "49fa1518-8a41-4744-84c2-0101d4d18ef7";
const member = { membership: { memberType: "MEMBER" } } as any;
const guest = {
  membership: { memberType: "GUEST" },
  modules: {
    structure: false,
    work: false,
    goals: false,
    governance: false,
    meetings: false,
  },
  sharedResources: [],
} as any;

test("invitation notices open their organization tracking view and do not grant Guest navigation",()=>{
  const organizationId='11111111-1111-4111-8111-111111111111';
  const route=new URL(resourceDestination({...member,organization:{id:organizationId}},'invitation',id),'https://orgmap.invalid');
  assert.equal(route.pathname,'/organization-invitations');assert.equal(route.searchParams.get('organizationId'),organizationId);assert.equal(route.searchParams.get('invitationId'),id);
  assert.equal(resourceDestination(guest,'invitation',id),`/platform/resource/invitation/${id}`);
});

test("search results open the canonical page of each resource type", () => {
  for (const [type, path] of [
    ["circle", `/circles/${id}`],
    ["role", `/roles/${id}`],
    ["member", `/members/${id}`],
    ["project", `/projects/${id}`],
    ["task", `/projects/tasks/${id}`],
    ["goal", `/goals/${id}`],
    ["key-result", `/goals/key-results/${id}`],
    ["meeting", `/meetings/${id}`],
    ["proposal", `/structure/proposals/${id}`],
    ["tension", `/structure/tensions?tensionId=${id}`],
    ["agreement", `/structure/working-agreements/${id}`],
  ] as const)
    assert.equal(resourceDestination(member, type, id), path, type);
});

test("types without a dedicated page keep the resource panel; invalid ids use a neutral route", () => {
  for (const type of ["report", "agenda-item", "public-page", "meeting-export"])
    assert.equal(
      resourceDestination(member, type, id),
      `/platform/resource/${type}/${id}`,
      type,
    );
  assert.equal(
    resourceDestination(member, "role", "not-an-id"),
    "/platform/search",
  );
});

test("guests open the canonical page only when the route is shared with them", () => {
  assert.equal(
    resourceDestination(guest, "role", id),
    `/platform/resource/role/${id}`,
  );
  assert.equal(resourceDestination(guest, "member", id), `/members/${id}`);
  const shared = {
    ...guest,
    modules: { ...guest.modules, structure: true, meetings: true },
  };
  assert.equal(resourceDestination(shared, "role", id), `/roles/${id}`);
  assert.equal(resourceDestination(shared, "meeting", id), `/meetings/${id}`);
});


test("canonical search and favorite routes preserve a safe return query and original result focus", async () => {
  const {resourceDestination:canonical,resourcePanelDestination}=await import("../src/features/platform/resource-destination.ts");
  for (const from of ["/platform/search?q=Mesmo+nome&type=role", "/platform/favorites"]) {
    const destination=canonical("role",id,from,member)!;
    const source=new URLSearchParams(destination.split("?")[1]).get("from")!;
    const returned=new URL(source,"https://orgmap.invalid");
    assert.equal(returned.pathname,from.split("?")[0]);
    assert.equal(returned.searchParams.get("focus"),"resource-entry-role-"+id);
    if(from.startsWith("/platform/search")){assert.equal(returned.searchParams.get("q"),"Mesmo nome");assert.equal(returned.searchParams.get("type"),"role");}
  }
  assert.equal(canonical("role",id,"https://elsewhere.test/platform/search"),"/roles/"+id);
  assert.equal(canonical("role","../secret"),null);
  assert.equal(resourcePanelDestination("../role",id),null);
  assert.equal(canonical("role",id,"/platform/search?q=x",guest),"/platform/resource/role/"+id);
});

test("notification presentation accepts only app destinations and handles absent dates safely",async()=>{
 const {safeNotificationDestination,notificationTime,notificationWorkspacePath}=await import('../src/features/platform/notification-presentation.ts');
 const destination='/roles/'+id+'?organizationId='+id;
 assert.equal(safeNotificationDestination(destination),destination);
 for(const invalid of ['https://elsewhere.test/roles/'+id,'//elsewhere.test/roles/'+id,'/\\elsewhere.test/roles/'+id,'javascript:alert(1)','/login','/platform/preferences\n'])assert.equal(safeNotificationDestination(invalid),null,invalid);
 assert.equal(notificationWorkspacePath('/platform/preferences?event=RoleAssigned',id),'/platform/preferences?event=RoleAssigned&organizationId='+id);
 assert.equal(notificationTime('invalid','es-ES'),null);assert.equal(notificationTime(undefined,'es-ES'),null);
});

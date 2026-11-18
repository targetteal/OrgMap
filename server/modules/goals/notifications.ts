import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { uuid } from "../../src/core.js";
import type { NotificationContext } from "../../../packages/contracts/notifications.js";

type Snapshot = {goal?: any; keyResults?: any[]; assignments?: any[]};
const assignmentKey = (a: any) => JSON.stringify([a.memberId,a.keyResultId ?? null,a.functionalRole,a.viaRoleId ?? null]);
function meaningful(value: any): any {
  const stable=(item:any):any=>Array.isArray(item)?item.map(stable):item&&typeof item==="object"?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,stable(v)])):item;
  const row=(item:any)=>item&&typeof item==="object"?stable(Object.fromEntries(Object.entries(item).filter(([key])=>!["id","organizationId","goalId","version"].includes(key)))):item;
  if(value?.goal)return {goal:row(value.goal),keyResults:(value.keyResults??[]).map(row).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),assignments:(value.assignments??[]).map(row).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
  if (value && typeof value === "object") return row(value);
  return value;
}
const equivalent = (a: unknown,b: unknown) => JSON.stringify(meaningful(a))===JSON.stringify(meaningful(b));

/** Goal commands, nested KR edits and assignment replacement share the same durable snapshot. */
export async function publishGoalNotifications(core: Pick<ModuleRuntime,"publishNotification">, ctx: Ctx, action: string, eventId: string, previous: Snapshot | null, current: Snapshot) {
  const goal=current.goal;
  if (!goal || equivalent(previous,current)) return;
  const context: NotificationContext = {resourceTitle:goal.title,excerpt:goal.description?.slice(0,500),details:[{key:"status",value:goal.lifecycle}]};
  const previousAssignments = new Set((previous?.assignments ?? []).map(assignmentKey));
  const assigned = (current.assignments ?? []).filter(a=>!previousAssignments.has(assignmentKey(a)));
  const goalMembers = new Set<string>(assigned.filter(a=>!a.keyResultId).map(a=>a.memberId));
  if (goal.ownerType === "MEMBER" && goal.ownerId && (!previous || previous.goal?.ownerType!=="MEMBER" || previous.goal?.ownerId!==goal.ownerId)) goalMembers.add(goal.ownerId);
  if (goalMembers.size) await core.publishNotification(ctx,{eventId,event:"GoalAssigned",ref:{type:"goal",id:goal.id},recipients:[...goalMembers].map(memberId=>({memberId,nominal:true})),context});
  const krMembers = new Map<string,Set<string>>();
  for(const assignment of assigned) if(assignment.keyResultId){
    const members=krMembers.get(assignment.keyResultId) ?? new Set<string>();members.add(assignment.memberId);krMembers.set(assignment.keyResultId,members);
  }
  for(const [keyResultId,members] of krMembers){
    const kr=current.keyResults?.find(k=>k.id===keyResultId);if(!kr || kr.archived)continue;
    await core.publishNotification(ctx,{eventId:uuid(),event:"KRAssigned",ref:{type:"key-result",id:keyResultId},recipients:[...members].map(memberId=>({memberId,nominal:true})),context:{resourceTitle:kr.title,excerpt:kr.description?.slice(0,500),details:[{key:"status",value:kr.health}]}});
  }
  if (action!=="goal.created") await core.publishNotification(ctx,{eventId,event:"GoalUpdated",ref:{type:"goal",id:goal.id},recipients:[],followers:true,context});
  if (previous) for(const kr of current.keyResults ?? []) {
    const old=previous.keyResults?.find(k=>k.id===kr.id);
    if(old && !equivalent(old,kr)) await core.publishNotification(ctx,{eventId:uuid(),event:"GoalUpdated",ref:{type:"key-result",id:kr.id},recipients:[],followers:true,context:{resourceTitle:kr.title,excerpt:kr.description?.slice(0,500),details:[{key:"status",value:kr.health}]}});
  }
}

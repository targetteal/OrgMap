import { createHash } from 'node:crypto';
import type { ModuleRuntime, Ctx } from '../../src/runtime.js';
import { event, fail, Failure, id, text, uuid } from '../../src/core.js';
import type { MeetingOutcomeInput, MeetingOutcomePort } from '../meetings/outcomes.js';
import type { RoleCapacityPort } from '../structure/profile-capacity-contract.js';
import { authorizedProject, authorizedTask, mayCreateWork, validateProjectContextLinks, type ProjectContextLink } from './index.js';
import { readableMembers, requireRoleCapacity, storeTaskPrincipals, validateTaskPrincipals, type TaskPrincipal } from './assignments.js';
import { canAssignProject, requireProjectConfigurationMutable } from './policy.js';
import { createProjectDefinition } from './templates.js';
import { workActor } from './statistics.js';

/** Meeting owns the source and replay key; Work owns the destination ACL. */
export function createWorkMeetingOutcomePort(core: Pick<ModuleRuntime,'get'> & Partial<Pick<ModuleRuntime,'publishNotification'>>, roleCapacity?: RoleCapacityPort): MeetingOutcomePort {
 async function currentRole(ctx:Ctx,roleId:string) {
  const capacity = await requireRoleCapacity(ctx, roleId, roleCapacity);
  const memberIds = capacity.occupants.map(person => person.memberId).sort();
  const snapshot = createHash('sha256').update(JSON.stringify([ctx.org.id, roleId, memberIds])).digest('hex');
  return { memberIds, snapshot };
 }
 async function prepare(ctx:Ctx,input:MeetingOutcomeInput,creating = false) {
  if(!['TASK','PROJECT'].includes(input.kind) || !mayCreateWork(ctx) || !['write','authorization_write'].includes(ctx.mode)) fail(403,'ACTION_DENIED');
  await core.get(ctx.c,ctx.org.id,id(input.circleId),'CIRCLE');
  await workActor(ctx);
  const projectId=input.kind==='TASK' && input.projectId!=null ? id(input.projectId) : null;
  const project=projectId ? await authorizedProject(ctx,projectId,true) : null;
  if(input.kind==='PROJECT' && input.visibility!==undefined && !['PRIVATE','PUBLIC'].includes(input.visibility)) fail(400,'INVALID_REQUEST');
  // New project writes require a responsible; historical command replays keep their original input contract.
  if(creating && input.kind==='PROJECT' && input.roleId==null && input.leadMemberId==null) fail(400,'INVALID_REQUEST');
  const contextLinks: ProjectContextLink[] = [];
  const principals: TaskPrincipal[] = [];
  const link = input.workLink;
  const selection = link?.kind === 'ROLE' ? link.selection : undefined;
  const selectedMembers = Array.isArray(selection?.people) ? selection.people : undefined;
  // A completed command may be replayed after the roster changes. Compare the snapshot only for a new write.
  if (creating && selection && link) {
   const roster = await currentRole(ctx, link.targetId);
   if (roster.snapshot !== selection.snapshot) fail(409, 'ROLE_OCCUPANTS_CHANGED');
   if (selectedMembers?.some(memberId => !roster.memberIds.includes(memberId))) fail(422, 'ROLE_OCCUPANT_REQUIRED');
  }
  if (link && input.kind === 'PROJECT') {
   await requireProjectConfigurationMutable(ctx);
   contextLinks.push({ kind: link.kind === 'MEMBER' ? 'PARTICIPANT' : 'ROLE', targetId: link.targetId });
   for (const memberId of selectedMembers ?? []) contextLinks.push({ kind:'PARTICIPANT', targetId:memberId });
   await validateProjectContextLinks(ctx, core, selection && !creating ? contextLinks.slice(0,1) : contextLinks);
  }
  if (link && input.kind === 'TASK') {
   if (project && !canAssignProject(ctx, project)) fail(403, 'ASSIGNMENT_DENIED');
   if (selectedMembers) {
    if (project?.assignment_mode === 'SINGLE' && selectedMembers.length > 1) fail(422, 'ASSIGNMENT_LIMIT');
    await core.get(ctx.c, ctx.org.id, link.targetId, 'ROLE');
    principals.push(...selectedMembers.map(memberId => ({ kind:'MEMBER' as const, memberId })));
   } else principals.push(link.kind === 'MEMBER' ? { kind: 'MEMBER', memberId: link.targetId } : { kind: 'ROLE', roleId: link.targetId });
   if (creating || !selectedMembers) await validateTaskPrincipals(ctx, { project_id: projectId, creator_id: ctx.member.id }, principals, roleCapacity);
  }
  if(input.kind==='PROJECT' && (input.roleId!=null || input.leadMemberId!=null)) {
   if(input.roleId!=null) {
    if(!(await ctx.c.query("SELECT 1 FROM entities WHERE organization_id=$1 AND id=$2 AND kind='ROLE' AND parent_id=$3 AND NOT archived",[ctx.org.id,id(input.roleId),id(input.circleId)])).rowCount) fail(404,'RESOURCE_NOT_FOUND');
    if(input.leadMemberId!=null && !(await ctx.c.query(`SELECT 1 FROM members m WHERE m.organization_id=$1 AND m.id=$2 AND m.status='ACTIVE' AND m.member_type<>'GUEST' AND EXISTS(SELECT 1 FROM (SELECT organization_id,member_id,role_id,starts_at,ends_at,NULL::timestamptz ended_at FROM occupancies UNION ALL SELECT organization_id,member_id,role_id,starts_at,ends_at,ended_at FROM structure_mandates) o WHERE o.organization_id=m.organization_id AND o.member_id=m.id AND o.role_id=$3 AND o.starts_at<=clock_timestamp() AND (o.ends_at IS NULL OR o.ends_at>clock_timestamp()) AND (o.ended_at IS NULL OR o.ended_at>clock_timestamp()))`,[ctx.org.id,id(input.leadMemberId),id(input.roleId)])).rowCount) fail(404,'RESOURCE_NOT_FOUND');
   } else if(input.leadMemberId!=null && !(await ctx.c.query(`SELECT 1 FROM members m WHERE m.organization_id=$1 AND m.id=$2 AND m.status='ACTIVE' AND m.member_type<>'GUEST' AND (EXISTS(SELECT 1 FROM circle_memberships cm WHERE cm.organization_id=m.organization_id AND cm.member_id=m.id AND cm.circle_id=$3 AND cm.starts_at<=clock_timestamp() AND (cm.ends_at IS NULL OR cm.ends_at>clock_timestamp())) OR EXISTS(SELECT 1 FROM (SELECT organization_id,member_id,role_id,starts_at,ends_at,NULL::timestamptz ended_at FROM occupancies UNION ALL SELECT organization_id,member_id,role_id,starts_at,ends_at,ended_at FROM structure_mandates) o JOIN entities e ON e.organization_id=o.organization_id AND e.id=o.role_id WHERE o.organization_id=m.organization_id AND o.member_id=m.id AND e.parent_id=$3 AND NOT e.archived AND o.starts_at<=clock_timestamp() AND (o.ends_at IS NULL OR o.ends_at>clock_timestamp()) AND (o.ended_at IS NULL OR o.ended_at>clock_timestamp())))`,[ctx.org.id,id(input.leadMemberId),id(input.circleId)])).rowCount) fail(404,'RESOURCE_NOT_FOUND');
   if(input.roleId!=null && !contextLinks.some(l=>l.kind==='ROLE'&&l.targetId===id(input.roleId))) contextLinks.push({kind:'ROLE',targetId:id(input.roleId)});
  }
  return { projectId, contextLinks, principals };
 }
 return {
  async roleOccupants(ctx, {kind, roleId, projectId}) {
   if (!mayCreateWork(ctx)) fail(403, 'ACTION_DENIED');
   await workActor(ctx);
   const project = projectId ? await authorizedProject(ctx,projectId,true) : null;
   if (project && !canAssignProject(ctx, project)) fail(403, 'ASSIGNMENT_DENIED');
   const { memberIds, snapshot } = await currentRole(ctx, roleId);
   const assignable = kind === 'TASK' ? await readableMembers(ctx, {project_id:projectId ?? null,creator_id:ctx.member.id}, memberIds) : new Set(memberIds);
   // This is the same internal directory scope as Structure and Members. Guests cannot call it.
   const { rows } = await ctx.c.query<{id:string;display_name:string}>(
    `SELECT m.id,a.display_name FROM members m JOIN accounts a ON a.id=m.account_id
      WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND m.status='ACTIVE' AND m.member_type='MEMBER'
      ORDER BY a.display_name,m.id`, [ctx.org.id, memberIds]);
   return { snapshot, people:rows.map(row => ({id:row.id,name:row.display_name,assignable:assignable.has(row.id)})) };
  },
  async authorize(ctx,input){ await prepare(ctx,input); },
  async create(ctx,input){
   if(ctx.mode!=='write') fail(403,'READ_ONLY_TRANSACTION');
   const { projectId, contextLinks, principals } = await prepare(ctx,input,true);
   const title=text(input.title);
   if(input.kind==='PROJECT') {
    const project=await createProjectDefinition(ctx,{title,description:input.description,circleId:id(input.circleId),visibility:input.visibility??'PRIVATE'});
    if (contextLinks.length||input.leadMemberId!=null) await ctx.c.query('UPDATE work_projects SET lead_member_id=$3,context_links=$4::jsonb WHERE organization_id=$1 AND id=$2',[ctx.org.id,project.id,input.leadMemberId==null?null:id(input.leadMemberId),JSON.stringify(contextLinks)]);
    await ctx.c.query('UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1',[ctx.org.id]);
    await event(ctx.c,ctx.org.id,ctx.account.id,project.id,'ProjectCreated',uuid());
    return {kind:'PROJECT',id:project.id,title};
   }
   const taskId=uuid();
   await ctx.c.query('INSERT INTO work_tasks(organization_id,id,creator_id,title,circle_id,project_id) VALUES($1,$2,$3,$4,$5,$6)',[ctx.org.id,taskId,ctx.member.id,title,id(input.circleId),projectId]);
   if (principals.length) await storeTaskPrincipals(ctx, taskId, principals, core.publishNotification, roleCapacity);
   await ctx.c.query('UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1',[ctx.org.id]);
   await event(ctx.c,ctx.org.id,ctx.account.id,taskId,'TaskCreated',uuid());
   return {kind:'TASK',id:taskId,title};
  },
  async read(ctx,input){
   if(ctx.member.member_type==='GUEST' || !['TASK','PROJECT'].includes(input.kind))return null;
   try {const row=input.kind==='TASK'?await authorizedTask(ctx,id(input.id)):await authorizedProject(ctx,id(input.id));return {kind:input.kind,id:row.id,title:row.title};}
   catch(e){if(e instanceof Failure && [403,404].includes(e.status))return null;throw e;}
  },
 };
}

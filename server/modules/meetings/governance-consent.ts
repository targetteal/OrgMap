import type { Ctx, ModuleRuntime } from '../../src/runtime.js';
import { id } from '../../src/core.js';
import { access, type MeetingReadPolicy } from './service.js';

/** Rechecks current meeting ACL and acting secretary in the caller's transaction. */
export function createMeetingGovernanceConsentPort(core: ModuleRuntime, policy?: MeetingReadPolicy) {
  return async (ctx: Ctx, input: { proposalId: string; circleId: string; revision:number }) => {
    if (ctx.member.member_type !== 'MEMBER' || ctx.member.status !== 'ACTIVE') return null;
    const links = (await ctx.c.query(
      "SELECT meeting_id,agenda_id FROM meeting_actions WHERE organization_id=$1 AND target_kind='PROPOSAL' AND target_id=$2",
      [ctx.org.id, id(input.proposalId)],
    )).rows;
    if (links.length !== 1) return null;
    try {
      await core.assertResourceAvailable(ctx, 'meeting');
      const { m, p, supervised } = await access(ctx, links[0].meeting_id, 'read', policy);
      if (m.circle_id !== input.circleId || m.method !== 'HOLACRACY' || m.state !== 'RUNNING' ||
          supervised || m.notetaker_id !== ctx.member.id || p.attendance !== 'PRESENT') return null;
      const modeled=await core.governanceModel()?.participates(ctx,m.circle_id);
      if(modeled !== null && modeled !== undefined) {
        if(!modeled)return null;
      }
      const requiresIntegrativeProcess = modeled === true && links[0].agenda_id !== null;
      const ready = !requiresIntegrativeProcess || !!(await ctx.c.query(
        `SELECT 1 FROM meeting_o2_processes WHERE organization_id=$1 AND meeting_id=$2
         AND proposal_id=$3 AND revision=$4 AND stage='APPROVED'`, [ctx.org.id,m.id,input.proposalId,input.revision],
      )).rowCount;
      return { meetingId: m.id as string, meetingVersion: m.version as number, ready };
    } catch (e: any) {
      if ([403, 404].includes(e?.status)) return null;
      throw e;
    }
  };
}

/** Boolean only: Governance already authorized the proposal; no meeting details leave this port. */
export function createHolacracyProposalOriginPort() {
  return async (ctx:Ctx, input:{proposalId:string;circleId:string;runningOnly?:boolean}) => !!(await ctx.c.query(
    `SELECT 1 FROM meeting_actions a JOIN meeting_occurrences m ON m.organization_id=a.organization_id AND m.id=a.meeting_id
     WHERE a.organization_id=$1 AND a.target_kind='PROPOSAL' AND a.target_id=$2 AND m.circle_id=$3 AND m.method='HOLACRACY'
       AND (NOT $4::boolean OR m.state='RUNNING') LIMIT 1`,
    [ctx.org.id,id(input.proposalId),id(input.circleId),input.runningOnly===true],
  )).rowCount;
}

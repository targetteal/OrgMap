import type { FastifyRequest } from 'fastify';
import type { ModuleRuntime } from '../../src/runtime.js';
import { uuid } from '../../src/core.js';
import { Governance, type GovernancePorts } from './service.js';

/** Scoped to the member who submitted each round; every run reacquires tenant IAM. */
export function createGovernanceConsentWorker(core:ModuleRuntime, ports:GovernancePorts) {
  return {
    async runDelivery(organizationId:string, memberId:string) {
      await core.withWorkerContext(organizationId,memberId,async ctx => {
        await core.assertModuleAvailable(ctx,'governance');
        const rounds = (await ctx.c.query(
          `SELECT p.id AS proposal_id,h.id AS event_id
           FROM gov_proposals p JOIN gov_rounds r ON r.organization_id=p.organization_id AND r.proposal_id=p.id AND r.revision=p.revision
           JOIN gov_history h ON h.organization_id=p.organization_id AND h.resource_id=p.id AND h.action='ProposalSubmitted' AND h.snapshot->'round'->>'id'=r.id::text
           WHERE p.organization_id=$1 AND h.actor_id=$2 AND p.state='REVIEW' AND p.kind IN ('GOVERNANCE','DOCUMENT') AND r.state='OPEN'
             AND r.policy->>'decisionProcess'='HOLACRACY_O2' AND r.policy->>'method'='CONSENT_WINDOW'
             AND (r.deadline IS NULL OR r.deadline<=clock_timestamp()) ORDER BY p.id`,
          [ctx.org.id,ctx.member.id],
        )).rows;
        const request = {id:uuid(),headers:{}} as FastifyRequest;
        const governance = new Governance(ctx,request,ports);
        for (const round of rounds) {
          if (await governance.processAsyncConsent(round.proposal_id,round.event_id))
            await core.changed(ctx,request,round.proposal_id,'Governance.async-consent');
        }
      });
      return false;
    },
  };
}

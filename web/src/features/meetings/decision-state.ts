type ProposalState = { state?: string; verdict?: string | null; applyState?: string };

/** Approval of the conversation and application of the decision are distinct. */
export function meetingDecisionState(proposal: ProposalState | null | undefined, stage: string) {
  if (!proposal) return 'none';
  const decided = proposal.state === 'DECIDED' && proposal.verdict === 'ADOPT';
  if (decided && proposal.applyState === 'APPLIED') return 'applied';
  if (decided && proposal.applyState === 'APPLY_CONFLICT') return 'conflict';
  if (proposal.state === 'DRAFT' && proposal.applyState === 'PENDING' && stage === 'APPROVED') return 'awaiting-scribe';
  if (decided && proposal.applyState === 'PENDING') return 'awaiting-application';
  return 'in-progress';
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {meetingDecisionState} from '../src/features/meetings/decision-state';

test('meeting approval is distinct from application and application conflict', () => {
  assert.equal(meetingDecisionState({state:'DRAFT',applyState:'PENDING'}, 'APPROVED'), 'awaiting-scribe');
  assert.equal(meetingDecisionState({state:'DECIDED',verdict:'ADOPT',applyState:'PENDING'}, 'APPROVED'), 'awaiting-application');
  assert.equal(meetingDecisionState({state:'DECIDED',verdict:'ADOPT',applyState:'APPLIED'}, 'APPROVED'), 'applied');
  assert.equal(meetingDecisionState({state:'DECIDED',verdict:'ADOPT',applyState:'APPLY_CONFLICT'}, 'APPROVED'), 'conflict');
  assert.equal(meetingDecisionState({state:'DRAFT',applyState:'APPLIED'}, 'APPROVED'), 'in-progress');
  assert.equal(meetingDecisionState({state:'DECIDED',verdict:'REJECT',applyState:'APPLIED'}, 'APPROVED'), 'in-progress');
});

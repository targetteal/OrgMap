import {installDialogLifecycle} from './helpers/dialog';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', { url: 'http://qa.localhost/structure/proposals/11111111-1111-4111-8111-111111111111' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'FormData']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : (dom.window as any)[key], configurable: true });
}
installDialogLifecycle(dom.window as any);
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root: new URL('../', import.meta.url).pathname, configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
const { feature } = await vite.ssrLoadModule('/src/features/governance/index.tsx');
const { LocalizationProvider } = await vite.ssrLoadModule('/src/localization/index.tsx');
const Component = feature.Component;
const proposalId = '11111111-1111-4111-8111-111111111111';
test.after(async () => { await vite.close(); dom.window.close(); });

test('closed and historical objections retain their text without offering an impossible review command', async () => {
  const detail = {
    proposal: { id: proposalId, title: 'Proposal revision 2', version: 5, revision: 2, state: 'REVIEW', kind: 'GOVERNANCE', canEdit: false, canVote: false },
    revisions: [{ number: 2, payload: { changes: [] } }],
    rounds: [
      { id: 'old-round', revision: 1, state: 'CLOSED', step: 'DECIDE', policy: {}, electorate: [] },
      { id: 'current-round', revision: 2, state: 'OPEN', step: 'PRESENT', policy: { workflowSteps: ['PRESENT', 'DECIDE'] }, electorate: [] },
    ],
    objections: [
      { id: 'old', roundId: 'old-round', authorId: 'member', state: 'VALID', rationale: 'Historical objection', version: 2 },
      { id: 'current', roundId: 'current-round', authorId: 'member', state: 'RAISED', rationale: 'Current objection', version: 1 },
    ],
    ballots: [], commits: [], nominations: [], history: [],
  };
  const context = {
    organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', path: `/structure/proposals/${proposalId}`,
    session: { account: { id: 'account' } }, bootstrap: { organization:{id:"org",name:"Organização",version:1,vocabulary:{}}, membership: { memberType: 'MEMBER', id: 'member' }, capabilities: { 'structure.direct': true }, modules: {} },
    structure: { nodes: [], memberships: [], occupancies: [] }, members: [], accountPreferences: { locale: 'pt-BR' },
    navigate() {}, refresh() {}, notify() {},
    api: async (path: string) => ({ data: path.endsWith('/origin') ? { origin: null } : path.endsWith(`/proposals/${proposalId}`) ? detail : { items: [], page: { nextCursor: null } } }),
  };
  const container = dom.window.document.querySelector('main')!;
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LocalizationProvider preferences={{ locale: 'pt-BR' }}><Component context={context} /></LocalizationProvider>));
    const objections = [...container.querySelectorAll('.gov-objection')];
    assert.equal(objections.length, 2);
    assert.match(objections[0].textContent!, /Historical objection/);
    assert.match(objections[0].textContent!, /Revisão 1/, 'historical objection identifies its proposal revision');
    assert.equal(objections[0].querySelector('form'), null, 'closed prior round cannot be reviewed');
    assert.ok(objections[1].querySelector('form'), 'current open round still offers review');
  } finally { await act(async () => root.unmount()); }
});

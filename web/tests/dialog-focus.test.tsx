import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import React, { act, useState } from 'react';

const dom = new JSDOM('<!doctype html><main></main>', { url: 'http://test.localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : (dom.window as any)[key], configurable: true });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root: new URL('../', import.meta.url).pathname, configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
const { Dialog } = await vite.ssrLoadModule('/src/ui.tsx');
test.after(async () => { await vite.close(); dom.window.close(); });

test('native dialog releases modal state before restoring focus to its opener', async () => {
  let opened: HTMLDialogElement | null = null;
  const proto = dom.window.HTMLDialogElement.prototype;
  Object.defineProperty(proto, 'showModal', { configurable: true, value(this: HTMLDialogElement) {
    opened = this; this.open = true; this.querySelector<HTMLElement>('button')?.focus();
  } });
  Object.defineProperty(proto, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
  function Harness() {
    const [show, setShow] = useState(false);
    return <><button onClick={() => setShow(true)}>Editar círculo</button>{show && <Dialog title="Editar círculo" onClose={() => setShow(false)}><input aria-label="Nome" /></Dialog>}</>;
  }
  const root = createRoot(document.querySelector('main')!);
  await act(async () => root.render(<Harness />));
  const opener = document.querySelector('button')!;
  opener.focus();
  await act(async () => opener.click());
  const dialog = document.querySelector('dialog')!;
  assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent, 'Editar círculo');
  assert.equal(dialog.querySelector('button')?.getAttribute('aria-label'), 'Fechar');
  const originalFocus = opener.focus.bind(opener);
  let restoredWhileModal: boolean | undefined;
  opener.focus = (options) => { restoredWhileModal = opened?.open; if (!opened?.open) originalFocus(options); };
  await act(async () => dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(restoredWhileModal, false, 'focus outside a native modal is ignored until it closes');
  assert.equal(document.activeElement, opener);
  await act(async () => root.unmount());
});

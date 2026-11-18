import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAccountTheme } from '../src/account/theme';

test('system theme follows device changes and removes its listener on cleanup', () => {
  const previousWindow = globalThis.window;
  const listeners = new Set<() => void>();
  let dark = false;
  const media = {
    get matches() { return dark; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => media },
  });
  const root = { dataset: {} as Record<string, string> } as HTMLElement;
  try {
    const cleanup = applyAccountTheme('system', root);
    assert.equal(root.dataset.accountTheme, 'light');
    assert.equal(listeners.size, 1);
    dark = true;
    for (const listener of listeners) listener();
    assert.equal(root.dataset.accountTheme, 'dark');
    cleanup();
    assert.equal(listeners.size, 0);
    assert.equal(root.dataset.accountTheme, undefined);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

test('explicit theme overrides device preference and clears between accounts', () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  });
  const root = { dataset: {} as Record<string, string> } as HTMLElement;
  try {
    const clearLight = applyAccountTheme('light', root);
    assert.equal(root.dataset.accountTheme, 'light');
    clearLight();
    assert.equal(root.dataset.accountTheme, undefined);
    const clearDark = applyAccountTheme('dark', root);
    assert.equal(root.dataset.accountTheme, 'dark');
    clearDark();
    assert.equal(root.dataset.accountTheme, undefined);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

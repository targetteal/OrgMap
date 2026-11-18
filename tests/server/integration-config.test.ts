import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadIntegrationOptions } from '../../server/integration/config.js';

test('operator SAML AMR mapping is optional and validates trusted method limits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orgmap-config-amr-'));
  const path = join(directory, 'host.json');
  const key = `${randomUUID()}:${randomUUID()}`;
  const provider = { entryPoint: 'https://idp.example.test/sso', issuer: 'https://orgmap.example.test/sp', idpIssuer: 'https://idp.example.test', callbackUrl: 'https://orgmap.example.test/callback', idpCert: 'synthetic-config-only' };
  const load = async (value: object) => {
    await writeFile(path, JSON.stringify({ saml: { [key]: value } }), { mode: 0o600 });
    return loadIntegrationOptions(path);
  };
  try {
    const absent = await load(provider);
    assert.equal(absent.saml?.[key].authnContextAmr, undefined);
    const mapping = { 'urn:orgmap:test:verified-factor': ['mfa', 'otp'] };
    assert.deepEqual((await load({ ...provider, authnContextAmr: mapping })).saml?.[key].authnContextAmr, mapping);
    for (const invalid of [
      { context: 'mfa' }, { context: [''] }, { context: ['x'.repeat(101)] },
      { context: Array.from({ length: 33 }, () => 'otp') }, { context: [true] },
    ]) await assert.rejects(load({ ...provider, authnContextAmr: invalid }), /INTEGRATION_CONFIG_INVALID/);
    await assert.rejects(load({ ...provider, untrustedAmr: ['mfa'] }), /INTEGRATION_CONFIG_INVALID/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

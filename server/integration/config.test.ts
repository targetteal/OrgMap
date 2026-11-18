import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadIntegrationOptions } from './config.js';

test('operator config is strict, private and shared without executable ports or secret diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orgmap-config-'));
  const path = join(directory, 'integration.json');
  const key = `${randomUUID()}:${randomUUID()}`;
  try {
    await writeFile(path, JSON.stringify({ smtp: { port: 1025 }, deliveries: { [key]: { endpoint: 'http://127.0.0.1:9911', secret: 'synthetic-test-secret', allowLocalHttp: true } }, webhookSecrets: { [key]: 'synthetic-webhook-secret' } }), { mode: 0o600 });
    const options = await loadIntegrationOptions(path);
    assert.equal(options.smtp?.port, 1025);
    assert.equal(options.deliveries?.[key].secret, 'synthetic-test-secret');
    assert.deepEqual(options.webhooks?.ports, {});
    await chmod(path, 0o644);
    await assert.rejects(loadIntegrationOptions(path), { message: 'INTEGRATION_CONFIG_INVALID' });
    await chmod(path, 0o600);
    for (const invalid of [{ unknown: 'synthetic-secret' }, { smtp: { port: 0 } }, { webhooks: { ports: {} } }, { oidc: { [key]: { issuer: 'missing-fields' } } }, { deliveries: { [key]: { endpoint: 'missing-secret' } } }, { enrollment: { [key]: { issuer: 'https://idp.example.test', claim: 'email', mappingRevision: 1, externalIdToValue: {} } } }]) {
      await writeFile(path, JSON.stringify(invalid));
      await assert.rejects(loadIntegrationOptions(path), { message: 'INTEGRATION_CONFIG_INVALID' });
    }
    await writeFile(path, JSON.stringify({ enrollment: { [key]: { issuer: 'https://idp.example.test', claim: 'sub', mappingRevision: 1, externalIdToValue: { 'opaque-scim-id': 'signed-idp-subject' }, ssoRequired: true } } }));
    assert.equal((await loadIntegrationOptions(path)).enrollment?.[key].claim, 'sub');
    const enrollment = { issuer: 'https://idp.example.test', claim: 'sub', mappingRevision: 1, externalIdToValue: {}, requestedMemberType: 'GUEST' };
    await writeFile(path, JSON.stringify({ enrollment: { [key]: enrollment } }), { mode: 0o600 });
    assert.equal((await loadIntegrationOptions(path)).enrollment?.[key].requestedMemberType, 'GUEST');
    await writeFile(path, JSON.stringify({ enrollment: { [key]: { ...enrollment, requestedMemberType: 'OWNER' } } }), { mode: 0o600 });
    await assert.rejects(loadIntegrationOptions(path), { message: 'INTEGRATION_CONFIG_INVALID' });
    await writeFile(path, 'invalid-json synthetic-secret');
    await assert.rejects(loadIntegrationOptions(path), { message: 'INTEGRATION_CONFIG_INVALID' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { readDeletionReceiptOperators } from '../../server/ops/organization-deletion-operator-receipt.js';
import { configureOrganizationDeletionHttp } from '../../server/ops/organization-deletion-http-configuration.js';

test('operator host authorization is private, current and independent of tenant ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orgmap-receipt-access-'));
  const file = join(directory, 'operators.json'), link = join(directory, 'link.json'), accountId = randomUUID();
  const save = (accountIds: string[]) => writeFile(file, JSON.stringify({ schemaVersion: 1, accountIds }), { mode: 0o600 });
  try {
    await save([accountId]);
    assert.ok((await readDeletionReceiptOperators(file)).has(accountId));
    await save([]);
    assert.equal((await readDeletionReceiptOperators(file)).size, 0);
    await save([accountId]);
    await chmod(file, 0o644);
    await assert.rejects(readDeletionReceiptOperators(file), /DELETION_OPERATOR_FILE_UNSAFE/);
    await chmod(file, 0o600);
    await symlink(file, link);
    await assert.rejects(readDeletionReceiptOperators(link));
    for (const value of [{ schemaVersion: 1, accountIds: [accountId, accountId] }, { schemaVersion: 1, accountIds: ['OWNER'] }, { schemaVersion: 1, accountIds: [], allowAll: true }]) {
      await writeFile(file, JSON.stringify(value));
      await assert.rejects(readDeletionReceiptOperators(file), /DELETION_OPERATOR_FILE_INVALID/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('operator configuration rejects partial, nonlocal and different-database readers before connecting', async () => {
  const application = new pg.Pool({ connectionString: 'postgres://app:synthetic@127.0.0.1:55432/fixture' });
  try {
    assert.equal(await configureOrganizationDeletionHttp(application, {}), undefined);
    await assert.rejects(configureOrganizationDeletionHttp(application, { ORGMAP_LIFECYCLE_RECEIPT_OPERATORS_FILE: '/not-read' }), /CONFIGURATION_INCOMPLETE/);
    await assert.rejects(configureOrganizationDeletionHttp(application, { ORGMAP_LIFECYCLE_RECEIPT_OPERATORS_FILE: '/not-read', ORGMAP_LIFECYCLE_RECEIPT_DATABASE_URL: 'postgres://reader:synthetic@example.invalid/fixture' }), /LOCAL_DATABASE_REQUIRED/);
    await assert.rejects(configureOrganizationDeletionHttp(application, { ORGMAP_LIFECYCLE_RECEIPT_OPERATORS_FILE: '/not-read', ORGMAP_LIFECYCLE_RECEIPT_DATABASE_URL: 'postgres://reader:synthetic@127.0.0.1:55432/another' }), /DATABASE_MISMATCH/);
    assert.equal(application.totalCount, 0);
  } finally { await application.end(); }
});

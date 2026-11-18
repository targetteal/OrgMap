import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OrganizationLedger } from '../../server/ops/organization-ledger.js';

test('external ledger publishes exact durable tombstones, survives reopen, and rejects stale authority/baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orgmap-ledger-'));
  try {
    const ledger = await OrganizationLedger.initialize(join(root, 'authority')), empty = await ledger.snapshot();
    const A = { organizationId: randomUUID(), jobId: randomUUID(), fence: '2', acceptedAt: new Date().toISOString() };
    await Promise.all([ledger.confirm(A), ledger.confirm(A)]);
    const B = { ...A, organizationId: randomUUID(), jobId: randomUUID() };
    const baseline = await ledger.snapshot();
    await ledger.confirm(B);
    const reopened = await OrganizationLedger.open(ledger.directory, ledger.authorityId);
    assert.equal((await reopened.requireSuperset(empty)).entries.length, 2);
    assert.equal((await reopened.requireSuperset(baseline)).entries.length, 2);
    await assert.rejects(ledger.confirm({ ...A, jobId: randomUUID() }), /TOMBSTONE_CONFLICT/);
    const other = await OrganizationLedger.initialize(join(root, 'other'));
    await assert.rejects(other.requireSuperset(baseline), /AUTHORITY_MISMATCH/);
    await assert.rejects(OrganizationLedger.open(ledger.directory, randomUUID()), /AUTHORITY_MISMATCH/);
    await assert.rejects(OrganizationLedger.open(join(root, 'lost')), /ENOENT/);
    const missing = { ...baseline, entries: [B] };
    await assert.rejects(ledger.requireSuperset(missing), /BASELINE_INVALID/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ledger fails closed for unsafe permissions, malformed and linked records without rewriting authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orgmap-ledger-'));
  try {
    const ledger = await OrganizationLedger.initialize(join(root, 'authority'));
    const id = randomUUID(), record = join(ledger.directory, `${id}.json`);
    await writeFile(record, '{broken', { mode: 0o600 });
    await assert.rejects(ledger.snapshot());
    await rm(record);
    const external = join(root, 'external');
    await writeFile(external, '{}', { mode: 0o600 });
    await symlink(external, record);
    await assert.rejects(ledger.snapshot(), /ELOOP/);
    await rm(record);
    await chmod(ledger.directory, 0o755);
    await assert.rejects(OrganizationLedger.open(ledger.directory), /DIRECTORY_UNSAFE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('restore reconciliation serializes confirmation and never ages out a crash lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orgmap-ledger-'));
  try {
    const ledger = await OrganizationLedger.initialize(join(root, 'authority'));
    const entry = { organizationId: randomUUID(), jobId: randomUUID(), fence: '2', acceptedAt: new Date().toISOString() };
    let release!: () => void, entered!: () => void;
    const inside = new Promise<void>(done => { entered = done; }), barrier = new Promise<void>(done => { release = done; });
    let saved: import('../../server/ops/organization-ledger.js').LockedOrganizationLedger | undefined;
    const reconciliation = ledger.withExclusive(async locked => { saved = locked; entered(); await barrier; assert.equal((await locked.snapshot()).entries.length, 0); });
    await inside;
    let confirmed = false;
    const confirmation = ledger.confirm(entry).then(() => { confirmed = true; });
    await assert.rejects(ledger.withExclusive(async () => {}, 0), /BUSY_OR_RECOVERY_REQUIRED/);
    assert.equal(confirmed, false);
    release(); await reconciliation; await confirmation;
    assert.equal((await ledger.snapshot()).entries.length, 1);
    await assert.rejects(saved!.snapshot(), /LOCK_EXPIRED/);
    await mkdir(join(ledger.directory, '.operation-lock'), { mode: 0o700 });
    await assert.rejects(ledger.withExclusive(async () => {}, 0), /BUSY_OR_RECOVERY_REQUIRED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

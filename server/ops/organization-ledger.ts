/** Durable operator-owned tombstones live outside every database dump/bundle.
 * Opening an authority never initializes it implicitly during restore.
 */
import { constants } from 'node:fs';
import { mkdir, open, link, unlink, readdir, lstat, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const format = 'orgmap-organization-ledger-v1';
export type OrganizationTombstone = {
  organizationId: string;
  jobId: string;
  fence: string;
  acceptedAt: string;
};
export type OrganizationLedgerSnapshot = {
  format: typeof format;
  authorityId: string;
  entries: OrganizationTombstone[];
  sha256: string;
};
export interface LockedOrganizationLedger {
  snapshot(): Promise<OrganizationLedgerSnapshot>;
  confirm(entry: OrganizationTombstone): Promise<void>;
  requireSuperset(baseline: OrganizationLedgerSnapshot): Promise<OrganizationLedgerSnapshot>;
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw Error('LIFECYCLE_LEDGER_INVALID');
}
export function validateTombstone(value: unknown): OrganizationTombstone {
  exact(value, ['organizationId', 'jobId', 'fence', 'acceptedAt']);
  if (!uuid.test(String(value.organizationId)) || !uuid.test(String(value.jobId)) || typeof value.fence !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value.fence) || BigInt(value.fence) < 2n ||
      typeof value.acceptedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.acceptedAt) || new Date(value.acceptedAt).toISOString() !== value.acceptedAt) throw Error('LIFECYCLE_LEDGER_INVALID');
  return { organizationId: String(value.organizationId), jobId: String(value.jobId), fence: value.fence, acceptedAt: value.acceptedAt };
}
export const canonicalTombstone = (entry: OrganizationTombstone): string => JSON.stringify(validateTombstone(entry));
/** Hash the canonical record without the file's trailing newline. */
export const tombstoneSha256 = (entry: OrganizationTombstone): string => createHash('sha256').update(canonicalTombstone(entry),'utf8').digest('hex');
const canonical = canonicalTombstone;
async function readJson(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077)) throw Error('LIFECYCLE_LEDGER_FILE_UNSAFE');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function syncDirectory(directory: string) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function publishExclusive(directory: string, name: string, contents: string) {
  const temporary = join(directory, `.pending-${randomUUID()}`), target = join(directory, name);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(contents + '\n'); await handle.sync(); } finally { await handle.close(); }
  let published = false;
  try {
    // Hard-link publication is atomic and refuses to replace a previous record.
    await link(temporary, target);
    published = true;
    await syncDirectory(directory);
  } finally {
    await unlink(temporary).catch(() => {});
    if (published) await syncDirectory(directory);
  }
}
async function safeDirectory(directory: string) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw Error('LIFECYCLE_LEDGER_DIRECTORY_UNSAFE');
}
export class OrganizationLedger {
  private constructor(readonly directory: string, readonly authorityId: string) {}
  /** Explicit installation action, never called as a fallback for a lost authority. */
  static async initialize(directory: string): Promise<OrganizationLedger> {
    const root = resolve(directory);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await safeDirectory(root);
    try { await publishExclusive(root, 'authority.json', JSON.stringify({ format, authorityId: randomUUID() })); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return OrganizationLedger.open(root);
  }
  static async open(directory: string, expectedAuthorityId?: string): Promise<OrganizationLedger> {
    const root = resolve(directory);
    await safeDirectory(root);
    const metadata = await readJson(join(root, 'authority.json'));
    exact(metadata, ['format', 'authorityId']);
    if (metadata.format !== format || typeof metadata.authorityId !== 'string' || !uuid.test(metadata.authorityId) || (expectedAuthorityId && expectedAuthorityId !== metadata.authorityId)) throw Error('LIFECYCLE_LEDGER_AUTHORITY_MISMATCH');
    return new OrganizationLedger(root, metadata.authorityId);
  }
  /** Every append and restore reconciliation shares this lock. A crash leaves
   * the authority blocked for explicit operator recovery, never auto-unlocked
   * based on age or a possibly reused PID. All callback operations must be awaited.
   */
  async withExclusive<T>(fn: (locked: LockedOrganizationLedger) => Promise<T>, timeoutMs = 5000): Promise<T> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 10_000) throw Error('LIFECYCLE_LEDGER_LOCK_TIMEOUT_INVALID');
    await OrganizationLedger.open(this.directory, this.authorityId);
    const lock = join(this.directory, '.operation-lock'), token = randomUUID(), deadline = Date.now() + timeoutMs;
    for (;;) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw Error('LIFECYCLE_LEDGER_BUSY_OR_RECOVERY_REQUIRED');
        await delay(20);
      }
    }
    let active = true;
    try {
      const handle = await open(join(lock, 'owner.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: hostname(), startedAt: new Date().toISOString() })); await handle.sync(); }
      finally { await handle.close(); }
      await syncDirectory(lock); await syncDirectory(this.directory);
      const ensure = () => { if (!active) throw Error('LIFECYCLE_LEDGER_LOCK_EXPIRED'); };
      const locked: LockedOrganizationLedger = Object.freeze({
        snapshot: async () => { ensure(); return this.snapshotUnlocked(); },
        confirm: async (entry: OrganizationTombstone) => { ensure(); return this.confirmUnlocked(entry); },
        requireSuperset: async (baseline: OrganizationLedgerSnapshot) => { ensure(); return this.requireSupersetUnlocked(baseline); },
      });
      return await fn(locked);
    } finally {
      active = false;
      const owner = await readJson(join(lock, 'owner.json'));
      if (owner?.token !== token) throw Error('LIFECYCLE_LEDGER_LOCK_OWNER_CHANGED');
      await unlink(join(lock, 'owner.json')); await rmdir(lock); await syncDirectory(this.directory);
    }
  }
  /** Retry is exact; a different job/fence for an already closed org fails closed. */
  async confirm(input: OrganizationTombstone): Promise<void> {
    return this.withExclusive(locked => locked.confirm(input));
  }
  private async confirmUnlocked(input: OrganizationTombstone): Promise<void> {
    await OrganizationLedger.open(this.directory, this.authorityId);
    const entry = validateTombstone(input), name = `${entry.organizationId}.json`;
    try { await publishExclusive(this.directory, name, canonical(entry)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stored = validateTombstone(await readJson(join(this.directory, name)));
    if (canonical(stored) !== canonical(entry)) throw Error('LIFECYCLE_LEDGER_TOMBSTONE_CONFLICT');
  }
  async snapshot(): Promise<OrganizationLedgerSnapshot> {
    return this.withExclusive(locked => locked.snapshot());
  }
  private async snapshotUnlocked(): Promise<OrganizationLedgerSnapshot> {
    await OrganizationLedger.open(this.directory, this.authorityId);
    const names = await readdir(this.directory), entries: OrganizationTombstone[] = [];
    if (names.length > 100_000) throw Error('LIFECYCLE_LEDGER_TOO_LARGE');
    for (const name of names.sort()) {
      if (name === 'authority.json' || name === '.operation-lock' || name === '.host-lease' || name === '.runtime-bindings' || name === '.storage-bindings' || /^\.pending-[a-f0-9-]{36}$/.test(name)) continue;
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw Error('LIFECYCLE_LEDGER_UNEXPECTED_FILE');
      const entry = validateTombstone(await readJson(join(this.directory, name)));
      if (name !== `${entry.organizationId}.json`) throw Error('LIFECYCLE_LEDGER_INVALID');
      entries.push(entry);
    }
    const projection = JSON.stringify({ format, authorityId: this.authorityId, entries });
    return { format, authorityId: this.authorityId, entries, sha256: createHash('sha256').update(projection).digest('hex') };
  }
  /** A backup can require a baseline, but cannot replace the live authority. */
  async requireSuperset(baseline: OrganizationLedgerSnapshot): Promise<OrganizationLedgerSnapshot> {
    return this.withExclusive(locked => locked.requireSuperset(baseline));
  }
  private async requireSupersetUnlocked(baseline: OrganizationLedgerSnapshot): Promise<OrganizationLedgerSnapshot> {
    if (baseline.format !== format || baseline.authorityId !== this.authorityId) throw Error('LIFECYCLE_LEDGER_AUTHORITY_MISMATCH');
    const expectedDigest = createHash('sha256').update(JSON.stringify({ format, authorityId: baseline.authorityId, entries: baseline.entries.map(validateTombstone) })).digest('hex');
    if (expectedDigest !== baseline.sha256) throw Error('LIFECYCLE_LEDGER_BASELINE_INVALID');
    const current = await this.snapshotUnlocked(), byId = new Map(current.entries.map(entry => [entry.organizationId, canonical(entry)]));
    if (baseline.entries.some(entry => byId.get(entry.organizationId) !== canonical(entry))) throw Error('LIFECYCLE_LEDGER_STALE');
    return current;
  }
}

/** Explicit local recovery of a crashed holder. Never infer death from age and
 * never remove an old-format/remote lock, live or reused PID, or unknown file. */
export async function recoverAbandonedLedgerLock(ledger:OrganizationLedger,expectedToken:string,expectedPid:number):Promise<void>{
 if(!uuid.test(expectedToken)||!Number.isInteger(expectedPid)||expectedPid<1)throw Error('LIFECYCLE_LEDGER_RECOVERY_INVALID');
 await OrganizationLedger.open(ledger.directory,ledger.authorityId);
 const dir=join(ledger.directory,'.operation-lock');await safeDirectory(dir);
 const names=await readdir(dir);if(names.length!==1||names[0]!=='owner.json')throw Error('LIFECYCLE_LEDGER_RECOVERY_UNVERIFIED');
 const owner=await readJson(join(dir,'owner.json'));
 if(owner.token!==expectedToken||owner.pid!==expectedPid||owner.host!==hostname())throw Error('LIFECYCLE_LEDGER_RECOVERY_UNVERIFIED');
 try{process.kill(expectedPid,0);throw Error('LIFECYCLE_LEDGER_HOLDER_ALIVE');}catch(e:any){if(e.code!=='ESRCH')throw e;}
 await unlink(join(dir,'owner.json'));await rmdir(dir);await syncDirectory(ledger.directory);
}

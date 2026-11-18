import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Each invocation owns its snapshot and its test runner owns its database/roles.
const suite = process.argv[2];
const suites: Record<string, string[]> = {
  teardown: ['server/integration/test-runner.ts', '--test-file=tests/server/administration-platform-teardown.test.ts'],
  foundation: ['server/integration/test-runner.ts', '--test-file=tests/server/foundation-teardown.test.ts'],
  'tenant-command-real': ['server/integration/test-runner.ts', '--test-file=tests/server/tenant-command-real.test.ts'],
  composition: ['--test', 'tests/server/organization-deletion-composition.test.ts'],
  'organization-deletion-http': ['--test', 'tests/server/organization-deletion-http.test.ts'],
  'organization-deletion-operator-receipt': ['--test', 'tests/server/organization-deletion-operator-receipt.test.ts'],
  'organization-deletion-runner': ['--test', 'tests/server/organization-deletion-runner.test.ts'],
  'organization-deletion-transitions': ['--test', 'tests/server/organization-deletion-transitions.test.ts'],
  'organization-blob-removal': ['--test', 'tests/server/organization-blob-removal.test.ts'],
  'organization-lifecycle': ['scripts/test-lifecycle-db.ts', 'organization-lifecycle'],
  'lifecycle-dispatch-fences': ['scripts/test-lifecycle-db.ts', 'lifecycle-dispatch-fences'],
  'lifecycle-iam-effects': ['scripts/test-lifecycle-db.ts', 'lifecycle-iam-effects'],
  'organization-deletion-barrier': ['--test', 'tests/server/organization-deletion-barrier.test.ts'],
  'interoperability-deletion-outcomes': ['--test', 'tests/server/interoperability-deletion-outcomes.test.ts'],
  'organization-deletion-jobs': ['--test', 'tests/server/organization-deletion-jobs.test.ts'],
  'organization-deletion-footprint-extra': ['--test', 'tests/server/organization-deletion-footprint-extra.test.ts'],
  'organization-deletion-readiness': ['--test', 'tests/server/organization-deletion-readiness.test.ts'],
  'organization-deletion-reviewed-baseline': ['--test', 'tests/server/organization-deletion-reviewed-baseline.test.ts'],
  'existing-database-upgrade-clone': ['--test', 'tests/server/existing-database-upgrade-clone.test.ts'],
  'ops-backup': ['scripts/test-ops-backup.ts'],
  'interoperability-dispatcher': ['server/integration/test-runner.ts', '--test-file=tests/server/interoperability-dispatcher.test.ts'],
  'organization-ledger-confirmation': ['--test', 'tests/server/organization-ledger-confirmation.test.ts'],
  'organization-host-ops': ['--test', 'tests/server/organization-host-ops.test.ts'],
};
if (!suite || !Object.hasOwn(suites, suite)) throw Error('UNKNOWN_LIFECYCLE_SNAPSHOT_SUITE');
const source = resolve('.');
const snapshot = await mkdtemp(join(tmpdir(), 'orgmap-lifecycle-snapshot-'));
const entries = ['server', 'tests', 'packages', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'compose.yaml'];
async function manifest(dir: string, prefix = ''): Promise<string[]> {
  const lines: string[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) lines.push(...await manifest(join(dir, entry.name), rel));
    else if (entry.isFile()) lines.push(`${createHash('sha256').update(await readFile(join(dir,entry.name))).digest('hex')}  ${rel}`);
    else throw Error(`UNEXPECTED_SNAPSHOT_ENTRY:${rel}`);
  }
  return lines;
}
try {
  for (const entry of entries) await cp(join(source, entry), join(snapshot, entry), {recursive:true, filter: p => !p.split('/').some(x => x === 'node_modules' || x === 'dist' || x === '.DS_Store')});
  const before = (await manifest(snapshot)).join('\n') + '\n';
  const digest = createHash('sha256').update(before).digest('hex');
  await writeFile(join(snapshot, 'MANIFEST.sha256'), before);
  await symlink(join(source, 'node_modules'), join(snapshot, 'node_modules'), 'dir');
  console.log(`Lifecycle snapshot ${suite}: ${digest} (node_modules shared)`);
  await new Promise<void>((ok, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...suites[suite]], {cwd:snapshot, env:{...process.env,...(['ops-backup','organization-host-ops'].includes(suite)?{COMPOSE_PROJECT_NAME:process.env.COMPOSE_PROJECT_NAME??'orgmap'}:{})}, stdio:'inherit'});
    child.on('error', fail); child.on('exit', code => code === 0 ? ok() : fail(Error(`LIFECYCLE_SUITE_FAILED:${code}`)));
  });
  await rm(join(snapshot,'MANIFEST.sha256')); await rm(join(snapshot,'node_modules'));
  if ((await manifest(snapshot)).join('\n') + '\n' !== before) throw Error('LIFECYCLE_SNAPSHOT_DRIFT');
  console.log(`Lifecycle snapshot verified: ${digest}`);
} finally { await rm(snapshot, {recursive:true, force:true}); }

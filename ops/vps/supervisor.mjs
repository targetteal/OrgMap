import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { OrganizationLedger } from '../../server/ops/organization-ledger.js';
import { acquireOrganizationHostLease, reapStoppedHostWriters } from '../../server/ops/organization-host-lease.js';

const apiPort = Number(process.env.PORT);
if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) throw Error('ORGMAP_PORT_REQUIRED');
if (!process.env.DATABASE_URL || !process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY || !process.env.ORGMAP_INTEGRATION_CONFIG) {
  throw Error('ORGMAP_RUNTIME_CONFIGURATION_REQUIRED');
}

const ledger = await OrganizationLedger.open(process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY);
const lease = await acquireOrganizationHostLease(ledger);
const children = [];
let stopping = false;
let stopPromise;

function start(name, args) {
  const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ORGMAP_HOST_LEASE_TOKEN: lease.token },
    stdio: 'inherit',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    void stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${name} exited unexpectedly (${code ?? signal})`);
      void stop(1);
    }
  });
  return child;
}

async function stop(exitCode = 0) {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    for (const child of [...children].reverse()) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(10_000).then(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }),
      ]);
      if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once('exit', resolve));
    }));
    await reapStoppedHostWriters(ledger, lease, children.flatMap((child) => child.pid ? [child.pid] : []));
    await lease.release();
    process.exitCode = exitCode;
  })();
  return stopPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });

try {
  const api = start('api', ['server/src/main.ts']);
  let ready = false;
  for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
    if (api.exitCode !== null || api.signalCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* startup in progress */ }
    await delay(200);
  }
  if (!ready) throw Error('ORGMAP_API_NOT_READY');
  if (!stopping) start('platform-worker', ['server/modules/platform/worker-cli.ts', 'server/modules/platform/composition.ts']);
  if (!stopping && process.env.ORGMAP_ENABLE_IAM_MAIL === 'true') start('iam-mail', ['scripts/iam-mail.ts']);
  console.log('OrgMap runtime ready on loopback');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await stop(1);
}

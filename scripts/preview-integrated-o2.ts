/** One disposable full-schema QA runtime. Never uses a retained user database. */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const execute = promisify(execFile);
const directory = resolve(".orgmap/integration-qa-20261102");
await mkdir(directory, { recursive: true, mode: 0o700 });
const source = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/");
if (!["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)) throw Error("LOCAL_DATABASE_REQUIRED");
const database = "orgmap_integration_qa_" + randomUUID().replaceAll("-", "");
const migration = new URL(source), runtime = new URL(source);
migration.pathname = runtime.pathname = "/" + database;
runtime.username = "orgmap_app"; runtime.password = "orgmap_app_local_only";
const apiPort = 3068, webPort = 5218;
const hosts = ["o2-escriba.localhost", "o2-facilitadora.localhost", "o2-convidada.localhost", "o2-owner.localhost"];
const origins = hosts.map(host => `http://${host}:${webPort}`), origin = origins[0];
const admin = new pg.Pool({ connectionString: source.href });
const blobs = await mkdtemp(join(tmpdir(), "orgmap-integration-qa-"));
let app: import("fastify").FastifyInstance | undefined, vite: import("vite").ViteDevServer | undefined, pool: pg.Pool | undefined;
let created = false, closing = false;
async function close() {
  if (closing) return; closing = true;
  await vite?.close(); await app?.close(); await pool?.end();
  if (created) await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end(); await rm(blobs, { recursive: true, force: true });
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void close().then(() => process.exit(0)));
try {
  await admin.query(`CREATE DATABASE "${database}"`); created = true;
  const env: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: migration.href };
  delete env.MIGRATION_SCOPE; delete env.MIGRATION_MAX_PREFIX;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "server/src/migrate.ts"], { env, stdio: "inherit" });
    child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(Error("QA_NORMAL_MIGRATION_FAILED")));
  });
  process.env.DATABASE_URL = runtime.href; process.env.ALLOWED_ORIGINS = origins.join(",");
  const { buildApp } = await import("../server/src/app.js");
  const db = await import("../server/src/db.js"); pool = db.pool;
  const { createOrgMapIntegration } = await import("../server/integration/index.js");
  app = await buildApp([createOrgMapIntegration({ blobsDirectory: blobs })], { migrationScope: "all" });
  const { seedO2Panel } = await import("../server/modules/meetings/o2-fixture.js");
  const fixture = await seedO2Panel(app, origin);
  await fixture.call(fixture.owner, "POST", fixture.base + "/governance-model/start", {}, 1);
  const plain = await fixture.call(fixture.owner, "POST", "/organizations", { name: "INTEGRAÇÃO QA · edição geral" });
  const base = "/organizations/" + plain.organization.id;
  const role = (await fixture.call(fixture.owner, "POST", base + "/roles", {
    mode: "DIRECT", circleId: plain.rootCircle.id, name: "Cuidar dos acordos", purpose: "Dar clareza ao trabalho",
    responsibilities: [{ id: randomUUID(), text: "Revisar acordos com as pessoas" }],
    artifacts: [{ id: randomUUID(), text: "Vocabulário compartilhado" }],
  })).role;
  const metadata = {
    synthetic: true, database, migrationScope: "all", normalBootstrap: true, head: (await execute("rtk", ["proxy", "git", "rev-parse", "HEAD"])).stdout.trim(),
    origins, apiPort, webPort, meetingId: fixture.meeting, organizationId: fixture.base.split("/").at(-1),
    plainOrganizationId: plain.organization.id, plainRoleId: role.id, panelPhase: "OPERATING",
    accounts: (["owner", "scribe", "facilitator", "guest"] as const).map(kind => ({ kind, email: fixture[kind].email, password: fixture[kind].password, memberId: fixture[kind].memberId })),
    namespace: "synthetic QA organizations only; no real messages/invitations or external effects", workersStarted: false,
  };
  await writeFile(join(directory, "fixture.json"), JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 });
  const { createServer } = await import("vite");
  vite = await createServer({ root: "web", configFile: false, cacheDir: resolve('.orgmap/integration-qa-20261102/vite-cache'), server: { host: "127.0.0.1", port: webPort, strictPort: true, proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, ws: true } } } });
  await app.listen({ host: "127.0.0.1", port: apiPort }); await vite.listen();
  console.log(JSON.stringify({ ready: true, origins, head: metadata.head, fixture: join(directory, "fixture.json"), meetingId: fixture.meeting, mainDatabaseTouched: false }));
} catch (error) { console.error(error); await close(); process.exitCode = 1; }

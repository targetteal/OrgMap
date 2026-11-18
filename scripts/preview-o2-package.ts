import pg from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const evidence = resolve(".orgmap/qa/o2-package");
await mkdir(evidence, { recursive: true });
const apiPort = 3064, webPort = 5214, origin = `http://o2-base.localhost:${webPort}`;
// Fail before creating a database if either exclusively reserved preview port is busy.
await Promise.all([apiPort, webPort].map(port => new Promise<void>((resolve, reject) => {
  const probe = createNetServer(); probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
})));
const migrationSource = process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const runtimeSource = process.env.DATABASE_URL ??
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap";
const migration = new URL(migrationSource), runtime = new URL(runtimeSource);
for (const source of [migration, runtime]) {
  if (!["postgres:", "postgresql:"].includes(source.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)) throw Error("LOCAL_DATABASE_REQUIRED");
}
if (migration.host !== runtime.host || migration.pathname !== runtime.pathname)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");
const database = "orgmap_o2preview_" + randomBytes(8).toString("hex");
migration.pathname = runtime.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: migrationSource });
const blobs = await mkdtemp(join(tmpdir(), "orgmap-o2-package-preview-"));
let app: import("fastify").FastifyInstance | undefined;
let vite: import("vite").ViteDevServer | undefined;
let runtimePool: pg.Pool | undefined;
let created = false, closing = false;
async function close(exitCode = 0) {
  if (closing) return; closing = true;
  try {
    await vite?.close(); await app?.close(); await runtimePool?.end();
    await rm(blobs, { recursive: true, force: true });
    if (created) await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await writeFile(join(evidence, "preview-cleanup.json"), JSON.stringify({ database, removed: created,
      workersStarted: false, mainDatabaseTouched: false, externalInvitationsSent: false }, null, 2));
  } finally { await admin.end(); process.exit(exitCode); }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void close());
try {
  await admin.query(`CREATE DATABASE "${database}"`); created = true;
  await new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: migration.href,
      DATABASE_URL: runtime.href, MIGRATION_MAX_PREFIX: "899" };
    delete env.MIGRATION_SCOPE;
    const child = spawn(process.execPath, ["--import", "tsx", "server/src/migrate.ts"], { stdio: "inherit", env });
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(Error("O2_PREVIEW_MIGRATION_FAILED")));
  });
  process.env.DATABASE_URL = runtime.href;
  process.env.ALLOWED_ORIGINS = origin;
  const { buildApp } = await import("../server/src/app.js");
  const { pool } = await import("../server/src/db.js"); runtimePool = pool;
  const { createOrgMapIntegration } = await import("../server/integration/index.js");
  app = await buildApp([createOrgMapIntegration({ blobsDirectory: blobs })], { migrationMaxPrefix: 899 });
  const apiLog: { method: string; path: string; status: number }[] = [];
  const password = "Synthetic-O2-package-preview-2026";
  async function account(label: string) {
    const email = "o2-preview-" + randomUUID() + "@example.test";
    const response = await app!.inject({ method: "POST", url: "/api/v1/auth/register", headers: { origin },
      payload: { email, password, displayName: label } });
    if (response.statusCode !== 201) throw Error(response.body);
    const data = response.json().data;
    const cookie = response.cookies.find(item => item.name === "orgmap_session");
    if (!cookie) throw Error("SYNTHETIC_SESSION_MISSING");
    return { label, email, password, accountId: data.account.id as string, memberId: "",
      cookie: "orgmap_session=" + cookie.value, csrf: data.csrfToken as string };
  }
  const owner = await account("Rita · implantação"), guide = await account("Lia · guia"),
    participant = await account("Noa · integrante"), newcomer = await account("Caio · sem papel");
  async function call(method: string, path: string, body?: object, version?: number, actor = owner) {
    const response = await app!.inject({ method: method as any, url: "/api/v1" + path, payload: body,
      headers: { origin, cookie: actor.cookie, "x-csrf-token": actor.csrf, "idempotency-key": randomUUID(),
        ...(version === undefined ? {} : { "if-match": `"${version}"` }) } });
    apiLog.push({ method, path, status: response.statusCode });
    if (response.statusCode >= 300) throw Error(response.body);
    return response.json().data;
  }
  const org = await call("POST", "/organizations", { name: "Aurora · base O2" });
  owner.memberId = org.membership.id;
  const base = "/organizations/" + org.organization.id, rootId = org.rootCircle.id;
  for (const actor of [guide, participant, newcomer])
    actor.memberId = (await call("POST", base + "/members", { accountId: actor.accountId })).membership.id;
  await call("POST", base + "/governance-model/install", { packageId: "targetteal.o2" });
  const circle = (await call("POST", base + "/circles", { mode: "DIRECT", parentCircleId: rootId, name: "Cuidado e Cultura", purpose: "Sustentar relações que dão espaço ao trabalho" })).circle;
  const rich = { format: "orgmap-richtext", version: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Dar clareza aos acordos do trabalho", marks: [{ type: "bold" }] }] }] } };
  const role = (await call("POST", base + "/roles", { mode: "DIRECT", circleId: rootId, name: "Guardião dos Acordos", purposeRich: rich,
    responsibilities: [{ id: randomUUID(), text: "Revisar acordos a partir das tensões percebidas" }],
    artifacts: [{ id: randomUUID(), text: "Vocabulário dos acordos da organização" }] })).role;
  const localRole = (await call("POST", base + "/roles", { mode: "DIRECT", circleId: circle.id, name: "Anfitrião de Comunidade", purpose: "Dar boas-vindas e apoiar os encontros" })).role;
  const model = await call("GET", base + "/governance-model");
  const structure = await call("GET", base + "/structure");
  const rootGuide = model.bindings.find((binding: any) => binding.functionCode === "GUIDE" && structure.roles.some((entity: any) => entity.id === binding.roleId && entity.parentId === rootId));
  if (!rootGuide) throw Error("O2_GUIDE_NOT_SEEDED");
  await call("POST", base + "/governance-model/roles/" + rootGuide.roleId + "/occupancies", { memberId: guide.memberId, startsAt: "2026-01-01T00:00:00Z" });
  await call("POST", base + "/governance-model/roles/" + role.id + "/occupancies", { memberId: participant.memberId, startsAt: "2026-01-01T00:00:00Z" });
  const seededModel = await call("GET", base + "/governance-model");
  const blank = await call("POST", "/organizations", { name: "Aurora · espaço para instalar O2" });
  const fixture = { synthetic: true, database, origin, apiOrigin: `http://127.0.0.1:${apiPort}`,
    organizationId: org.organization.id, rootId, circleId: circle.id, roleId: role.id, localRoleId: localRole.id,
    blankOrganizationId: blank.organization.id, blankRootId: blank.rootCircle.id, blankOrganizationName: blank.organization.name,
    phase: "PREPARATION", modelRevision: seededModel.revision, packageVersion: seededModel.package.version, workersStarted: false,
    accounts: [owner, guide, participant, newcomer].map(({ label, email, password, accountId, memberId }) => ({ label, email, password, accountId, memberId })) };
  await writeFile(join(evidence, "preview-fixture.json"), JSON.stringify(fixture, null, 2), { mode: 0o600 });
  await writeFile(join(evidence, "preview-seed-api-log.json"), JSON.stringify(apiLog, null, 2));
  const paths = ["server/integration/index.ts", "server/src/app.ts", "server/src/runtime.ts", "server/modules/structure/service.ts",
    "server/modules/structure/applier.ts", "server/modules/governance/service.ts", "server/modules/o2/package.ts",
    "server/modules/o2/contract.ts", "server/modules/o2/service.ts", "server/modules/o2/plugin.ts",
    "server/migrations/034_governance_model.sql", "server/migrations/050_o2_meeting_panel.sql",
    "web/src/features/registry.ts", "web/src/features/o2/index.tsx", "web/src/features/o2/types.ts", "web/src/features/o2/o2.css"];
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    try { hashes[path] = createHash("sha256").update(await readFile(path)).digest("hex"); }
    catch (e: any) { if (e.code !== "ENOENT") throw e; }
  }
  await writeFile(join(evidence, "preview-source-hashes-start.json"), JSON.stringify(hashes, null, 2));
  const { createServer } = await import("vite");
  vite = await createServer({ root: "web", configFile: "web/vite.o2-package.config.ts" });
  await app.listen({ host: "127.0.0.1", port: apiPort }); await vite.listen();
  console.log(JSON.stringify({ previewReady: true, origin, apiPort, database, organizationId: org.organization.id,
    fixture: join(evidence, "preview-fixture.json"), phase: "PREPARATION", workersStarted: false }));
} catch (error) { console.error(error); await close(1); }

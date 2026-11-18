import pg from "pg";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const name = "orgmap_admin_preview_" + randomUUID().replaceAll("-", "");
const migration = new URL(
  process.env.MIGRATION_DATABASE_URL ??
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap",
);
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
const admin = new pg.Pool({ connectionString: migration.href });
await admin.query('CREATE DATABASE "' + name + '"');
migration.pathname = "/" + name;
runtime.pathname = "/" + name;
const db = new pg.Pool({ connectionString: migration.href });
try {
  for (const file of (await readdir("server/migrations"))
    .filter((f) => /^(00\d|01\d|4[01]\d|42[0-4]|50\d|51\d)_.*\.sql$/.test(f))
    .sort())
    await db.query(await readFile("server/migrations/" + file, "utf8"));
} finally {
  await db.end();
}
process.env.DATABASE_URL = runtime.href;
process.env.ALLOWED_ORIGINS = "http://administration.localhost:5187";
const { createAdministration, readCredentialPolicy, readAdmissionPolicy } =
  await import("./index.js");
const { buildApp } = await import("../../src/app.js");
const { pool } = await import("../../src/db.js");
const app = await buildApp([
  async (app, core) => {
    core.registerCredentialPolicyResolver(readCredentialPolicy);
    core.registerAdmissionPolicyProvider({ resolve: readAdmissionPolicy });
    await createAdministration({
      credentialPolicyReadiness: (ctx, policy) =>
        core.credentialPolicyReadiness(ctx, policy),
    })(app, core);
  },
]);
try {
  await app.listen({
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 31787),
  });
} catch (e) {
  await app.close();
  await pool.end();
  await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)');
  await admin.end();
  throw e;
}
if (process.argv.includes("--seed")) {
  const origin = "http://administration.localhost:5187";
  const registered = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin },
    payload: {
      email: "aurora-admin-qa@example.test",
      displayName: "Pessoa Aurora QA",
      password: "orgmap-local-synthetic-2026",
    },
  });
  if (registered.statusCode !== 201)
    throw Error("Synthetic seed registration failed");
  const cookie = registered.cookies[0].name + "=" + registered.cookies[0].value;
  const csrf = registered.json().data.csrfToken;
  const organizationIds: string[] = [];
  for (const organizationName of [
    "Aurora — Organização de aprendizagem",
    "Horizonte — Pesquisa cooperativa",
  ]) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: {
        origin,
        cookie,
        "x-csrf-token": csrf,
        "idempotency-key": randomUUID(),
      },
      payload: { name: organizationName },
    });
    if (created.statusCode !== 201)
      throw Error("Synthetic organization creation failed");
    organizationIds.push(created.json().data.organization.id);
  }
  const regular = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin },
    payload: {
      email: "member-indicator-qa@example.test",
      displayName: "Pessoa Membro QA",
      password: "orgmap-local-synthetic-2026",
    },
  });
  if (regular.statusCode !== 201)
    throw Error("Synthetic member account failed");
  const added = await app.inject({
    method: "POST",
    url: "/api/v1/organizations/" + organizationIds[0] + "/members",
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    payload: {
      accountId: regular.json().data.account.id,
      memberType: "MEMBER",
    },
  });
  if (added.statusCode !== 200 && added.statusCode !== 201)
    throw Error("Synthetic member association failed");
  console.log("Two synthetic organizations created through foundation APIs.");
}
console.log(
  "Administration isolated local preview: administration.localhost:5187",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)');
    await admin.end();
    process.exit(0);
  });

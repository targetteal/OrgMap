import { isFoundationMigration } from "../../src/migration-selection.js";
/** Local visual QA only. Isolated disposable DB; not imported by workModule. */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const name = "orgmap_work_preview_" + randomUUID().replaceAll("-", "");
await admin.query(`CREATE DATABASE "${name}"`);
const url = new URL(adminUrl);
url.pathname = "/" + name;
const migrator = new pg.Pool({ connectionString: url.href });
for (const f of (await readdir("server/migrations"))
  .filter(
    (n) =>
      isFoundationMigration(n) ||
      /^(2[0-4]\d|42[5-9]|43\d|44\d)_.*\.sql$/.test(n),
  )
  .sort())
  await migrator.query(await readFile("server/migrations/" + f, "utf8"));
await migrator.end();
const runtime = new URL(
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
process.env.DATABASE_URL = runtime.href;
process.env.ALLOWED_ORIGINS = "http://work.localhost:5174";
const { buildApp } = await import("../../src/app.js");
const { createWorkGuestAccessAdapter } = await import("./index.js");
const { mountWorkTestHarness } = await import("./test-harness.js");
const { pool } = await import("../../src/db.js");
let previewCookie: any;
let guestCookie: any;
let sharedTaskId: string | null = null;
let serving = false;
let previewOrg: string;
let previewProject: string | null = null;
const app = await buildApp([
  async (app, core) => {
    core.registerOrganizationSettings(async (ctx) => ({
      version: 1,
      settings: {
        name: ctx.org.name,
        locale: ctx.org.locale,
        timezone: ctx.org.time_zone,
        modules: { structure: true, work: true },
      },
    }));
    core.registerGuestAccessAdapter(createWorkGuestAccessAdapter(core));
    await mountWorkTestHarness(app, core);
    app.addHook("preHandler", async (request) => {
      if (
        serving &&
        process.env.WORK_PREVIEW_PENDING === "1" &&
        request.method !== "GET" &&
        request.url.includes("/work/")
      )
        await new Promise((resolve) => setTimeout(resolve, 2500));
    });
  },
  async (app) => {
    app.get("/api/v1/preview/session", async (r, reply) => {
      const asGuest = (r.query as any).role === "GUEST" && guestCookie;
      reply.header("Set-Cookie", asGuest ? guestCookie : previewCookie);
      return {
        organizationId: previewOrg,
        projectId: asGuest ? null : previewProject,
      };
    });
  },
]);
const registration = await app.inject({
  method: "POST",
  url: "/api/v1/auth/register",
  headers: { origin: "http://work.localhost:5174" },
  payload: {
    email: randomUUID() + "@example.test",
    password: randomUUID() + "test-only",
    displayName: "Pessoa de teste visual",
  },
});
if (registration.statusCode >= 300) throw Error(registration.body);
const session = registration.json().data;
const cookie =
  registration.cookies[0].name + "=" + registration.cookies[0].value;
const headers = {
  origin: "http://work.localhost:5174",
  cookie,
  "x-csrf-token": session.csrfToken,
  "idempotency-key": randomUUID(),
};
const organization = await app.inject({
  method: "POST",
  url: "/api/v1/organizations",
  headers,
  payload: { name: "Ateliê Aurora — organização sintética" },
});
if (organization.statusCode >= 300) throw Error(organization.body);
const org = organization.json().data.organization.id;
if (process.env.WORK_PREVIEW_FIXTURES === "1") {
  const call = async (path: string, payload: unknown) => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${org}/work${path}`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: payload as any,
    });
    if (response.statusCode >= 300) throw Error(response.body);
    return response.json().data;
  };
  previewProject = (
    await call("/projects", {
      title: "Laboratório Vento — projeto sintético de QA",
      description:
        "Fixture explícita de teste local; não vem da organização de referência.",
      visibility: "PUBLIC",
    })
  ).project.id;
  sharedTaskId = (
    await call("/tasks", {
      title:
        "Mapear conversas e responsabilidades com um título extenso para testar quebra de linha",
      description: "Fixture sintética de QA sem datas.",
      projectId: previewProject,
    })
  ).task.id;
  await call("/tasks", {
    title: "Preparar oficina — datas sintéticas",
    projectId: previewProject,
    startsAt: "2026-10-18T12:00:00.000Z",
    endsAt: "2026-10-18T14:00:00.000Z",
    dateProvenance: "SYNTHETIC_TEST",
  });
  await call("/tasks", {
    title: "Revisar resultados — datas sintéticas",
    projectId: previewProject,
    startsAt: "2026-10-19T12:00:00.000Z",
    endsAt: "2026-10-19T15:00:00.000Z",
    dateProvenance: "SYNTHETIC_TEST",
  });
}
if (process.env.WORK_PREVIEW_GUEST === "1" && previewProject && sharedTaskId) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin: "http://work.localhost:5174" },
    payload: {
      email: randomUUID() + "@example.test",
      password: randomUUID() + "test-only",
      displayName: "Pessoa convidada de QA",
    },
  });
  if (response.statusCode >= 300) throw Error(response.body);
  const guest = response.json().data;
  const added = await app.inject({
    method: "POST",
    url: `/api/v1/organizations/${org}/members`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {
      accountId: guest.account.id,
      memberType: "GUEST",
      accessPlan: [
        {
          resource: { context: "work", kind: "project", id: previewProject },
          actions: ["read"],
        },
        {
          resource: { context: "work", kind: "task", id: sharedTaskId },
          actions: ["read"],
        },
      ],
    },
  });
  if (added.statusCode >= 300) throw Error(added.body);
  guestCookie = response.headers["set-cookie"];
}
previewCookie = registration.headers["set-cookie"];
previewOrg = org;
serving = true;
await app.listen({ port: 3004, host: "127.0.0.1" });
console.log(
  "WORK_PREVIEW_READY http://work.localhost:5174/src/features/work/preview.html",
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);

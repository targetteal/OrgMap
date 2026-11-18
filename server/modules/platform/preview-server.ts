// Explicit evidence harness, only started in an ephemeral DB by test-runner --preview.
import { buildApp } from "../../src/app.js";
import { createRuntime } from "../../src/runtime.js";
import { pool } from "../../src/db.js";
import { ResourceRegistry, type ResourceAccessPort } from "./ports.js";
import { FilesystemBlobStore } from "./blob.js";
import { createPlatform } from "./plugin.js";
import { PlatformWorker, type WorkerContextPort } from "./worker.js";
import { PlatformDispatcher, PostgresScopeDispatch } from "./dispatcher.js";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOrgMapIntegration,
  createIntegratedDispatcher,
} from "../../integration/index.js";
const integrated = process.argv.includes("--integrated");
process.env.ALLOWED_ORIGINS = "http://platform.localhost:5177";
const registry = new ResourceRegistry(),
  core = createRuntime(),
  root = await mkdtemp(join(tmpdir(), "orgmap-platform-preview-")),
  blobs = new FilesystemBlobStore(root);
let resourceId = "";
const previewAdapter: ResourceAccessPort = {
  async authorize(ctx, id, action) {
    try {
      await core.get(ctx.c, ctx.org.id, id, "CIRCLE");
      return (
        action === "read" ||
        action === "follow" ||
        ctx.member.org_role === "OWNER"
      );
    } catch {
      return false;
    }
  },
  async search(ctx, q) {
    const entity = await core.get(ctx.c, ctx.org.id, resourceId, "CIRCLE");
    return entity.name.toLowerCase().includes(q.toLowerCase())
      ? [{ type: "circle", id: entity.id, title: entity.name }]
      : [];
  },
  async export(ctx, ids) {
    const records = [];
    for (const id of ids) {
      const e = await core.get(ctx.c, ctx.org.id, id, "CIRCLE");
      records.push({ id: e.id, name: e.name, version: e.version });
    }
    return { records, coverage: "explicit-circle-selection", estimated: false };
  },
};
registry.registerResourceAdapter("circle", previewAdapter);
// Synthetic policy fixture for the explicit-intent UI only. Not a real domain adapter.
registry.registerResourceAdapter("preview-private", {
  ...previewAdapter,
  supportsPrivateExport: true,
  async export(ctx, ids, _kind, options) {
    const result = await previewAdapter.export!(ctx, ids, "STRUCTURE");
    return {
      ...result,
      records: result.records.map((record) => ({
        ...(record as object),
        privateFixture: options?.includePrivate === true,
      })),
      coverage: "synthetic-private-intent-fixture",
    };
  },
});
const app = await buildApp(
  integrated
    ? [createOrgMapIntegration({ blobsDirectory: root })]
    : [
        createPlatform({
          registry,
          blobs,
          uploadPolicyProvider: {
            resolve: async () => ({
              schemaVersion: 1,
              policyId: null,
              revision: 0,
              mode: "ANY",
              allowedKinds: [],
            }),
          },
        }),
      ],
  { migrationMaxPrefix: integrated ? 999 : 19 },
);
let failedCommentOnce = false;
if (process.env.PLATFORM_PREVIEW_COMMENT_FAIL_ONCE === "1") {
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST" || !request.url.endsWith("/comments")) return;
    console.log(
      JSON.stringify({
        event: "preview.comment.command",
        key: request.headers["idempotency-key"],
        injectedFailure: !failedCommentOnce,
      }),
    );
    if (!failedCommentOnce) {
      failedCommentOnce = true;
      return reply.code(503).send({
        error: {
          code: "PREVIEW_TRANSIENT_FAILURE",
          message: "Falha transitória sintética. Tente novamente.",
        },
      });
    }
  });
}
if (integrated && process.env.PLATFORM_PREVIEW_GUEST === "1")
  app.addHook("onResponse", async (request, reply) => {
    if (request.url.includes("/platform/"))
      console.log(
        JSON.stringify({
          event: "preview.platform.request",
          method: request.method,
          path: request.url,
          status: reply.statusCode,
        }),
      );
  });
const registered = await app.inject({
  method: "POST",
  url: "/api/v1/auth/register",
  headers: { origin: "http://platform.localhost:5177" },
  payload: {
    email: "platform-preview@example.test",
    password: "platform-preview-password-123",
    displayName: "Pessoa Aurora",
  },
});
const auth = registered.json().data,
  cookie = registered.cookies[0].name + "=" + registered.cookies[0].value;
if (process.env.PLATFORM_PREVIEW_LOCALE) {
  const preferences = (
    await app.inject({
      method: "GET",
      url: "/api/v1/account/preferences",
      headers: { cookie },
    })
  ).json().data.preferences;
  const saved = await app.inject({
    method: "PATCH",
    url: "/api/v1/account/preferences",
    headers: {
      origin: "http://platform.localhost:5177",
      cookie,
      "x-csrf-token": auth.csrfToken,
      "idempotency-key": randomUUID(),
      "if-match": '"' + preferences.version + '"',
    },
    payload: { locale: process.env.PLATFORM_PREVIEW_LOCALE },
  });
  if (saved.statusCode !== 200)
    throw Error("Preview locale preference rejected");
}
const created = await app.inject({
  method: "POST",
  url: "/api/v1/organizations",
  headers: {
    origin: "http://platform.localhost:5177",
    cookie,
    "x-csrf-token": auth.csrfToken,
    "idempotency-key": randomUUID(),
  },
  payload: { name: "Organização Aurora" },
});
const org = created.json().data;
resourceId = org.rootCircle.id;
const bootstrap = await app.inject({
  method: "GET",
  url: "/api/v1/organizations/" + org.organization.id + "/bootstrap",
  headers: { cookie },
});
const member = bootstrap.json().data.membership.id;
if (integrated && process.env.PLATFORM_PREVIEW_GUEST === "1") {
  const guestAccount = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin: "http://platform.localhost:5177" },
    payload: {
      email: "platform-guest-preview@example.test",
      password: "platform-preview-password-123",
      displayName: "Guest da busca sintética",
    },
  });
  const headers = {
    origin: "http://platform.localhost:5177",
    cookie,
    "x-csrf-token": auth.csrfToken,
    "idempotency-key": randomUUID(),
  };
  const circle = await app.inject({
    method: "POST",
    url: "/api/v1/organizations/" + org.organization.id + "/circles",
    headers,
    payload: {
      name: "Círculo compartilhado Aurora",
      parentCircleId: resourceId,
      mode: "DIRECT",
    },
  });
  if (circle.statusCode !== 201) throw Error("Guest preview circle failed");
  const granted = await app.inject({
    method: "POST",
    url: "/api/v1/organizations/" + org.organization.id + "/members",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {
      accountId: guestAccount.json().data.account.id,
      memberType: "GUEST",
      accessPlan: [
        {
          resource: {
            context: "structure",
            kind: "circle",
            id: circle.json().data.circle.id,
          },
          actions: ["read"],
        },
      ],
    },
  });
  if (granted.statusCode !== 201) throw Error("Guest preview grant failed");
}
if (process.env.PLATFORM_PREVIEW_COMMENT_HISTORY === "1")
  await core.withWorkerContext(org.organization.id, member, async (ctx) => {
    for (let i = 1; i <= 105; i++)
      await ctx.c.query(
        "INSERT INTO platform_comments(organization_id,id,resource_type,resource_id,author_id,content,created_at) VALUES($1,$2,'circle',$3,$4,$5,'2026-10-18T12:00:00Z'::timestamptz+$6::int*interval '1 microsecond')",
        [
          org.organization.id,
          randomUUID(),
          resourceId,
          member,
          "Comentário histórico " + i,
          i,
        ],
      );
  });
if (integrated) {
  const seeded = await app.inject({
    method: "POST",
    url: "/api/v1/organizations/" + org.organization.id + "/work/projects",
    headers: {
      origin: "http://platform.localhost:5177",
      cookie,
      "x-csrf-token": auth.csrfToken,
      "idempotency-key": randomUUID(),
    },
    payload: {
      title: "Projeto Aurora · contexto de importação",
      visibility: "PUBLIC",
    },
  });
  if (seeded.statusCode < 200 || seeded.statusCode >= 300)
    throw Error("Integrated preview project seed failed");
}
const withContext: WorkerContextPort = core.withWorkerContext;
const worker = new PlatformWorker({ withContext, registry, blobs });
const dispatchPool = new pg.Pool({
  connectionString: process.env.PLATFORM_DISPATCH_DATABASE_URL,
});
const scopes = new PostgresScopeDispatch(dispatchPool);
const dispatcher = integrated
  ? createIntegratedDispatcher(scopes, { blobsDirectory: root })
  : new PlatformDispatcher(scopes, worker);
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await dispatcher.runOnce();
  } catch {
  } finally {
    running = false;
  }
}, 1000);
await app.listen({ host: "127.0.0.1", port: 3017 });
console.log(
  "Platform preview API 3017, isolated DB; root resource " + resourceId,
);
console.log(
  "Preview process PID " +
    process.pid +
    "; stop this child with SIGTERM so the runner can clean its DB/role.",
);
await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
clearInterval(timer);
await app.close();
await dispatchPool.end();
await pool.end();
await rm(root, { recursive: true, force: true });

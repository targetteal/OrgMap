import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { createRuntime, type Ctx } from "../../server/src/runtime.js";
import { Failure } from "../../server/src/core.js";
import pg from "pg";
import {
  PostgresScopeDispatch,
  PlatformDispatcher,
} from "../../server/modules/platform/dispatcher.js";
import {
  ResourceRegistry,
  type ResourceRef,
  type ResourceAction,
} from "../../server/modules/platform/ports.js";
import {
  FilesystemBlobStore,
  inspectUpload,
} from "../../server/modules/platform/blob.js";
import { createCommentThreadPort } from "../../server/modules/platform/comments.js";
import { createCommentCursor } from "../../server/modules/platform/comment-cursor.js";
import { createPlatform } from "../../server/modules/platform/plugin.js";
import {
  PlatformWorker,
  type WorkerContextPort,
} from "../../server/modules/platform/worker.js";
import { SmtpDeliveryError } from "../../server/src/smtp.js";
import { LocalSmtpTransport } from "../../server/modules/platform/smtp.js";
import { createIncomingUploadService } from "../../server/modules/platform/upload-policy.js";
import { createExportJobPort } from "../../server/modules/platform/export-jobs.js";
import { createPlatformGuestAccessAdapter } from "../../server/modules/platform/guest.js";
import { ScopedDeliveryWorker } from "../../server/modules/platform/scoped-delivery.js";
import { createDeliveryMetadataPort } from "../../server/modules/platform/delivery-metadata.js";
import {
  validateRichDocument,
  toPlainText,
} from "../../packages/content/index.js";
import {
  listPlatformBackupReferences,
  readPlatformBackupBlob,
} from "../../server/modules/platform/backup.js";
import {
  enqueueNotification,
  effectivePreference,
} from "../../server/modules/platform/notifications.js";
import {
  encodeTransfer,
  decodeTransfer,
  type TransferDocument,
} from "../../server/modules/platform/transfer.js";
const root = await mkdtemp(join(tmpdir(), "orgmap-platform-"));
let guestAccess:
  | ((ctx: Ctx, ref: ResourceRef, action: ResourceAction) => Promise<boolean>)
  | undefined;
const blobs = new FilesystemBlobStore(root),
  registry = new ResourceRegistry({
    guestAccess: async (...args) => (await guestAccess?.(...args)) === true,
    guestResourceIds: async (ctx, type, action) =>
      type === "test-resource"
        ? platformCore.guestResourceIds(ctx, {
            context: "platform-fixture-domain",
            kind: "resource",
            action,
          })
        : [],
    guestSearch: async (ctx, type, query, limit) => {
      if (type !== "test-resource") return [];
      const ids = new Set(
        await platformCore.guestResourceIds(ctx, {
          context: "platform-fixture-domain",
          kind: "resource",
          action: "read",
        }),
      );
      return [...records]
        .filter(
          ([id, row]) =>
            ids.has(id) &&
            row.org === ctx.org.id &&
            row.readers.has(ctx.member.id) &&
            row.title.includes(query),
        )
        .slice(0, limit)
        .map(([id, row]) => ({ type, id, title: row.title }));
    },
  });
// Test-owned domain adapter: the test defines records/ACL, never production platform SQL into a foreign module.
const records = new Map<
  string,
  { org: string; title: string; readers: Set<string> }
>();
let failExport = false,
  failImport = false,
  changeImportPlan = false;
let exportFailure: Failure | undefined;
let guestBroadSearches = 0;
const lookupCalls: string[] = [];
registry.registerResourceAdapter("test-resource", {
  async authorize(ctx, rid) {
    const row = records.get(rid);
    return Boolean(
      row && row.org === ctx.org.id && row.readers.has(ctx.member.id),
    );
  },
  async lookup(ctx, rid) {
    lookupCalls.push(rid);
    const row = records.get(rid);
    return row && row.org === ctx.org.id && row.readers.has(ctx.member.id)
      ? { id: rid, title: row.title } : null;
  },
  async search(ctx, q) {
    if (ctx.member.member_type === "GUEST") guestBroadSearches++;
    return [...records]
      .filter(([, v]) => v.org === ctx.org.id && v.title.includes(q))
      .map(([id, v]) => ({ type: "test-resource", id, title: v.title }));
  },
  async export(ctx, ids, kind) {
    if (exportFailure) throw exportFailure;
    if (failExport) throw Error("injected crash");
    return {
      records: ids.map((id) => ({ id, title: records.get(id)!.title })),
      coverage: "test-domain",
      estimated: false,
      ...(kind === "TABULAR"
        ? {
            workbook: {
              sheets: [
                {
                  name: "Tarefas",
                  columns: ["Título", "Pontos", "Feita"],
                  rows: ids.map((id) => [records.get(id)!.title, 3, true]),
                },
                {
                  name: "Projetos",
                  columns: ["Nome", "Total"],
                  rows: [["Projeto Ç", ids.length]],
                },
              ],
            },
          }
        : {}),
    };
  },
  async validateImport(ctx, items) {
    for (const item of items as any[]) {
      if (
        !item ||
        Object.keys(item).some((k) => !["id", "title"].includes(k)) ||
        typeof item.title !== "string"
      )
        throw Error("unknown record field");
    }
    return {
      plan: changeImportPlan
        ? (items as any[]).map((item) => ({
            ...item,
            title: item.title + " changed by current domain policy",
          }))
        : items,
      warnings: [],
    };
  },
  async applyImport(ctx, items) {
    await ctx.c.query(
      "INSERT INTO platform_views(organization_id,id,owner_id,name,resource_type,config) VALUES($1,$2,$3,$4,$5,$6)",
      [
        ctx.org.id,
        randomUUID(),
        ctx.member.id,
        "Imported",
        "test-resource",
        {},
      ],
    );
    if (failImport) throw Error("rollback after write");
    return {
      idMap: Object.fromEntries((items as any[]).map((x) => [x.id, x.id])),
    };
  },
});
let failCommentCommit = false,
  failAttachmentCommit = false;
const fixtureUploadPolicies = new Map<
  string,
  import("../../server/modules/platform/upload-policy.js").UploadPolicy
>();
const fixtureUploadPolicyProvider = {
  resolve: async (input: { organizationId: string }) =>
    fixtureUploadPolicies.get(input.organizationId) ?? {
      schemaVersion: 1 as const,
      policyId: null,
      revision: 0,
      mode: "ANY" as const,
      allowedKinds: [],
    },
};

let privatePolicy = true;
registry.registerResourceAdapter("test-private", {
  supportsPrivateExport: true,
  async authorize(ctx, rid, action) {
    const row = records.get(rid);
    return Boolean(
      row &&
      row.org === ctx.org.id &&
      row.readers.has(ctx.member.id) &&
      (action !== "export-private" || privatePolicy),
    );
  },
  async export(_ctx, ids, _kind, options) {
    return {
      records: ids.map((id) => ({
        id,
        private: options?.includePrivate === true,
      })),
      coverage: "selected-test-ids",
      estimated: false,
    };
  },
});
let platformCore: ReturnType<typeof createRuntime>;
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    platformCore = core;
    // Test-owned original domain. These grants never use a production platform namespace.
    guestAccess = async (ctx, ref, action) => {
      if (ref.type !== "test-resource") return false;
      try {
        await core.requireGuestResource(
          ctx,
          { context: "platform-fixture-domain", kind: "resource", id: ref.id },
          action,
        );
        return true;
      } catch (error) {
        if (error instanceof Failure && [403, 404].includes(error.status))
          return false;
        throw error;
      }
    };
    core.registerGuestAccessAdapter({
      context: "platform-fixture-domain",
      routes: [],
      async validateSharePlan(ctx, plan) {
        return (
          ctx.member.member_type !== "GUEST" &&
          plan.every(
            (item) =>
              item.resource.context === "platform-fixture-domain" &&
              item.resource.kind === "resource" &&
              records.get(item.resource.id)?.org === ctx.org.id &&
              records.get(item.resource.id)?.readers.has(ctx.member.id) ===
                true &&
              item.actions.every((action) =>
                ["read", "comment"].includes(action),
              ),
          )
        );
      },
    });
    core.registerGuestAccessAdapter(
      createPlatformGuestAccessAdapter(core, {
        resolveOriginalResource: async (_ctx, ref) =>
          ref.type === "test-resource"
            ? {
                context: "platform-fixture-domain",
                kind: "resource",
                id: ref.id,
              }
            : undefined,
      }),
    );
    return createPlatform({
      registry,
      blobs,
      uploadPolicyProvider: fixtureUploadPolicyProvider,
    })(app, {
      ...core,
      changed: async (...args: Parameters<typeof core.changed>) => {
        await core.changed(...args);
        if (failAttachmentCommit && args[3] === "AttachmentReady")
          throw Error("injected attachment transaction failure");
        if (failCommentCommit && args[3] === "CommentAdded")
          throw Error("injected comment transaction failure");
      },
    });
  },
]);
after(async () => {
  await app.close();
  await pool.end();
  await rm(root, { recursive: true, force: true });
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  b: any = undefined,
  u?: User,
  headers: any = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload: b,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...headers,
    },
  });
}
function ok(r: any, status = 200) {
  assert.equal(r.statusCode, status, r.body);
  return r.json().data;
}
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "secure-password-123456",
    displayName: "Platform tester",
  });
  const d = ok(r, 201);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
    id: d.account.id,
    email: d.account.email,
  };
}
const runtime = createRuntime();
// Worker uses IAM's current authorization guard and membership, independent of browser sessions.
const withContext: WorkerContextPort = runtime.withWorkerContext;
/** Global runner supplies migration/runtime URLs. Never let pg silently fall back to localhost:5432. */
async function dispatchTestPool() {
  if (process.env.PLATFORM_DISPATCH_DATABASE_URL) {
    const pool = new pg.Pool({
      connectionString: process.env.PLATFORM_DISPATCH_DATABASE_URL,
    });
    return { pool, close: () => pool.end() };
  }
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl)
    throw Error("Ephemeral migration URL required for dispatch fixture");
  const url = new URL(migrationUrl);
  if (!/^\/orgmap_(test|platform)_[a-f0-9]+$/.test(url.pathname))
    throw Error("Dispatch fixture requires isolated test DB");
  const admin = new pg.Pool({ connectionString: migrationUrl }),
    role = "platform_fixture_" + randomUUID().replaceAll("-", ""),
    password = randomUUID().replaceAll("-", "");
  await admin.query(
    'CREATE ROLE "' +
      role +
      '" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ' +
      "'" +
      password +
      "'",
  );
  try {
    await admin.query('GRANT orgmap_platform_dispatcher TO "' + role + '"');
    url.username = role;
    url.password = password;
    const pool = new pg.Pool({ connectionString: url.href });
    return {
      pool,
      close: async () => {
        await pool.end();
        await admin.query('DROP ROLE "' + role + '"');
        await admin.end();
      },
    };
  } catch (error) {
    await admin.query('DROP ROLE "' + role + '"');
    await admin.end();
    throw error;
  }
}
test("platform real PostgreSQL: typed ACL, files, preferences, jobs, roundtrip and revocation", async () => {
  const a = await user(),
    b = await user(),
    A = ok(await call("POST", "/organizations", { name: "Aurora" }, a), 201),
    B = ok(await call("POST", "/organizations", { name: "Horizonte" }, b), 201);
  const org = A.organization.id,
    member = ok(
      await call("GET", "/organizations/" + org + "/bootstrap", undefined, a),
    ).membership.id;
  const p = "/organizations/" + org + "/platform",
    rid = randomUUID(),
    hidden = randomUUID();
  records.set(rid, {
    org,
    title: "Visible resource",
    readers: new Set([member]),
  });
  records.set(hidden, { org, title: "Secret resource", readers: new Set() });
  const resource = p + "/resources/test-resource/" + rid;
  const exportPort = createExportJobPort(registry);
  const exportInput = {
    resourceType: "test-resource",
    resourceIds: [rid],
    exportKind: "RESOURCES",
    format: "JSON" as const,
    requestId: randomUUID(),
  };
  const beforePort = await withContext(org, member, async (ctx) =>
    Number(
      (
        await ctx.c.query(
          "SELECT count(*) FROM platform_jobs WHERE organization_id=$1",
          [org],
        )
      ).rows[0].count,
    ),
  );
  await assert.rejects(
    withContext(org, member, async (ctx) => {
      const job = await exportPort.enqueue(ctx, exportInput);
      assert.equal(job.state, "PENDING");
      assert.equal(job.version, 1);
      throw Error("producer rollback");
    }),
    /producer rollback/,
  );
  await withContext(org, member, async (ctx) => {
    assert.equal(
      Number(
        (
          await ctx.c.query(
            "SELECT count(*) FROM platform_jobs WHERE organization_id=$1",
            [org],
          )
        ).rows[0].count,
      ),
      beforePort,
    );
    await assert.rejects(
      exportPort.enqueue(ctx, { ...exportInput, resourceIds: [hidden] }),
    );
    await assert.rejects(
      exportPort.enqueue({ ...ctx, mode: "read" }, exportInput),
    );
    await assert.rejects(
      exportPort.enqueue(ctx, { ...exportInput, unknown: true } as any),
    );
    await assert.rejects(
      exportPort.enqueue(ctx, { ...exportInput, requestId: "unsafe\nrequest" }),
    );
    const guestContext = {
      ...ctx,
      member: { ...ctx.member, member_type: "GUEST" as const },
    };
    assert.equal(
      await registry.allowed(
        guestContext,
        { type: "test-resource", id: rid },
        "read",
      ),
      false,
    );
    await assert.rejects(exportPort.enqueue(guestContext, exportInput));
    privatePolicy = false;
    try {
      await assert.rejects(
        exportPort.enqueue(ctx, {
          ...exportInput,
          resourceType: "test-private",
          includePrivate: true,
        }),
      );
    } finally {
      privatePolicy = true;
    }
  });
  assert.deepEqual(
    ok(await call("GET", p + "/search?q=", undefined, a)).items,
    [],
  );
  assert.equal(
    (
      await call(
        "GET",
        "/organizations/" + B.organization.id + "/platform/search?q=",
        undefined,
        a,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/resources/unregistered/" + rid + "/comments",
        { content: "bad" },
        a,
      )
    ).statusCode,
    403,
  );
  const key = randomUUID(),
    comment = ok(
      await call(
        "POST",
        resource + "/comments",
        { content: "Hello <b>plain text</b>" },
        a,
        { "idempotency-key": key },
      ),
      201,
    );
  assert.equal(
    ok(
      await call(
        "POST",
        resource + "/comments",
        { content: "Hello <b>plain text</b>" },
        a,
        { "idempotency-key": key },
      ),
      201,
    ).id,
    comment.id,
  );
  assert.equal(
    ok(await call("GET", resource + "/comments", undefined, a)).items.length,
    1,
  );
  const richComment = validateRichDocument({
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Ação 🌱",
              marks: [
                { type: "bold" },
                { type: "link", attrs: { href: "https://example.test/fonte" } },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Próximo passo",
                      marks: [{ type: "italic" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const richCommentKey = randomUUID();
  const richCreated = ok(
    await call(
      "POST",
      resource + "/comments",
      { contentRich: richComment },
      a,
      { "idempotency-key": richCommentKey },
    ),
    201,
  );
  assert.deepEqual(richCreated.contentRich, richComment);
  assert.equal(richCreated.content, toPlainText(richComment));
  assert.equal(
    ok(
      await call(
        "POST",
        resource + "/comments",
        { contentRich: richComment },
        a,
        { "idempotency-key": richCommentKey },
      ),
      201,
    ).id,
    richCreated.id,
  );
  const richLoaded = ok(
    await call("GET", resource + "/comments", undefined, a),
  ).items.find((item: any) => item.id === richCreated.id);
  assert.deepEqual(richLoaded.contentRich, richComment);
  for (const invalid of [
    { ...richComment, version: 2 },
    { ...richComment, unknown: true },
    {
      format: "orgmap-richtext",
      version: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "bad",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      },
    },
  ])
    assert.equal(
      (await call("POST", resource + "/comments", { contentRich: invalid }, a))
        .statusCode,
      422,
    );
  assert.equal(
    (
      await call(
        "POST",
        resource + "/comments",
        { contentRich: richComment },
        b,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    ok(await call("GET", p + "/search?q=resource", undefined, a)).items.length,
    1,
  );
  assert.equal(
    (
      await call(
        "POST",
        resource + "/uploads",
        { name: "../evil", mime: "text/plain", base64: "eA==" },
        a,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        resource + "/uploads",
        {
          name: "evil.txt",
          mime: "text/plain",
          base64: Buffer.from("<script>x</script>").toString("base64"),
        },
        a,
      )
    ).statusCode,
    201,
  );
  const file = ok(
    await call(
      "POST",
      resource + "/uploads",
      {
        name: "notes.txt",
        mime: "text/plain",
        base64: Buffer.from("safe notes").toString("base64"),
      },
      a,
    ),
    201,
  );
  assert.equal(
    Buffer.from(
      ok(await call("GET", p + "/files/" + file.id + "/download", undefined, a))
        .base64,
      "base64",
    ).toString(),
    "safe notes",
  );
  assert.equal(
    ok(await call("GET", resource + "/files", undefined, a)).items.length,
    2,
  );
  await call("POST", resource + "/favorite", { enabled: true }, a);
  await call("POST", resource + "/follow", { enabled: true }, a);
  const resourceState = ok(
    await call("GET", resource + "/capabilities", undefined, a),
  );
  assert.equal(resourceState.favorite, true);
  assert.equal(resourceState.following, true);
  const memberFavorites = ok(await call("GET", p + "/favorites", undefined, a)).items;
  assert.equal(memberFavorites.length, 1);
  assert.equal(memberFavorites[0].resourceTitle, "Visible resource");
  records.get(rid)!.title = "Renamed resource";
  assert.equal(ok(await call("GET", p + "/favorites", undefined, a)).items[0].resourceTitle, "Renamed resource");
  records.get(rid)!.title = "Visible resource";
  const prefs = ok(await call("GET", p + "/preferences", undefined, a));
  const concurrent = await Promise.all(
    [true, false].map((enabled) =>
      call(
        "POST",
        p + "/preferences",
        { event: "KRAssigned", channel: "IN_APP", enabled },
        a,
        { "if-match": '"' + prefs.version + '"' },
      ),
    ),
  );
  assert.deepEqual(concurrent.map((x) => x.statusCode).sort(), [200, 409]);
  assert.equal(
    (await call("POST", p + "/preferences/reset", {}, a, { "if-match": '"1"' }))
      .statusCode,
    409,
  );
  ok(
    await call(
      "POST",
      p + "/notification-policy",
      {
        event: "KRAssigned",
        channel: "IN_APP",
        moduleEnabled: true,
        masterEnabled: true,
        defaultEnabled: false,
        locked: true,
      },
      a,
      { "if-match": '"1"' },
    ),
  );
  await withContext(org, member, async (ctx) => {
    assert.deepEqual(
      await effectivePreference(ctx, member, "KRAssigned", "IN_APP", registry),
      { enabled: false, origin: "LOCK" },
    );
  });
  assert.equal(
    (
      await call(
        "POST",
        p + "/exports",
        { resourceType: "test-resource", resourceIds: [rid], format: "JSON" },
        a,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/exports",
        {
          resourceType: "test-resource",
          resourceIds: [hidden],
          kind: "RESOURCES",
          format: "JSON",
        },
        a,
      )
    ).statusCode,
    403,
  );
  const worker = new PlatformWorker({ withContext, registry, blobs });
  const privateInput = {
    resourceType: "test-private",
    resourceIds: [rid],
    kind: "RESOURCES",
    format: "JSON",
    includePrivate: true,
  };
  privatePolicy = false;
  const { includePrivate: _intent, ...ordinaryInput } = privateInput;
  const ordinaryJob = ok(
    await call("POST", p + "/exports", ordinaryInput, a),
    202,
  );
  await worker.runJob(org, member);
  const ordinaryState = ok(
    await call("GET", p + "/jobs/" + ordinaryJob.id, undefined, a),
  );
  assert.equal(ordinaryState.includePrivate, false);
  const ordinaryArtifact = ok(
    await call(
      "GET",
      p + "/artifacts/" + ordinaryState.result.artifactId + "/download",
      undefined,
      a,
    ),
  );
  assert.equal(
    JSON.parse(Buffer.from(ordinaryArtifact.base64, "base64").toString())
      .records[0].private,
    false,
  );
  privatePolicy = true;
  assert.equal(
    (
      await call(
        "POST",
        p + "/exports",
        { ...privateInput, resourceType: "test-resource" },
        a,
      )
    ).statusCode,
    403,
  );
  const privateKey = randomUUID();
  const privateJob = ok(
    await call("POST", p + "/exports", privateInput, a, {
      "idempotency-key": privateKey,
    }),
    202,
  );
  await worker.runJob(org, member);
  const privateState = ok(
    await call("GET", p + "/jobs/" + privateJob.id, undefined, a),
  );
  assert.equal(privateState.includePrivate, true);
  assert.equal(privateState.state, "COMPLETED");
  const privateDownload =
    p + "/artifacts/" + privateState.result.artifactId + "/download";
  const privateArtifact = ok(await call("GET", privateDownload, undefined, a));
  assert.equal(
    JSON.parse(Buffer.from(privateArtifact.base64, "base64").toString())
      .records[0].private,
    true,
  );
  privatePolicy = false;
  for (const path of [
    p + "/jobs/" + privateJob.id,
    p + "/jobs/" + privateJob.id + "/attempts",
    privateDownload,
  ])
    assert.equal((await call("GET", path, undefined, a)).statusCode, 404);
  assert.ok(
    !ok(await call("GET", p + "/jobs", undefined, a)).items.some(
      (j: any) => j.id === privateJob.id,
    ),
  );
  assert.equal(
    (
      await call("POST", p + "/exports", privateInput, a, {
        "idempotency-key": privateKey,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call("POST", p + "/jobs/" + privateJob.id + "/retry", {}, a, {
        "if-match": '"1"',
      })
    ).statusCode,
    404,
  );
  privatePolicy = true;
  const revokedPrivateJob = ok(
    await call("POST", p + "/exports", privateInput, a),
    202,
  );
  privatePolicy = false;
  await worker.runJob(org, member);
  await withContext(org, member, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT state FROM platform_jobs WHERE organization_id=$1 AND id=$2",
          [org, revokedPrivateJob.id],
        )
      ).rows[0].state,
      "FAILED",
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*)::int AS n FROM platform_artifacts WHERE organization_id=$1 AND job_id=$2",
          [org, revokedPrivateJob.id],
        )
      ).rows[0].n,
      0,
    );
  });
  privatePolicy = true;
  exportFailure = new Failure(422, "EXPORT_KIND_REQUIRED");
  const incompatible = ok(
    await call(
      "POST",
      p + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [rid],
        kind: "WRONG_KIND",
        format: "JSON",
      },
      a,
    ),
    202,
  );
  await worker.runJob(org, member);
  exportFailure = undefined;
  const incompatibleState = ok(
    await call("GET", p + "/jobs/" + incompatible.id, undefined, a),
  );
  assert.equal(incompatibleState.state, "FAILED");
  assert.equal(incompatibleState.errorCode, "EXPORT_KIND_REQUIRED");
  const failureTrace = ok(
    await call(
      "GET",
      p + "/jobs/" + incompatible.id + "/attempts",
      undefined,
      a,
    ),
  ).items[0];
  assert.equal(failureTrace.stage, "EXPORT_ADAPTER");
  assert.equal(failureTrace.requestId, incompatibleState.requestId);
  assert.equal(failureTrace.retryable, false);
  assert.match(failureTrace.traceId, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(failureTrace).includes("Visible resource"));
  const job = ok(
    await call(
      "POST",
      p + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [rid],
        kind: "RESOURCES",
        format: "JSON",
      },
      a,
    ),
    202,
  );
  await worker.runJob(org, member);
  const completed = ok(await call("GET", p + "/jobs/" + job.id, undefined, a));
  assert.equal(completed.state, "COMPLETED");
  const artifact = ok(
    await call(
      "GET",
      p + "/artifacts/" + completed.result.artifactId + "/download",
      undefined,
      a,
    ),
  );
  const doc = JSON.parse(Buffer.from(artifact.base64, "base64").toString());
  assert.equal(doc.records[0].title, "Visible resource");
  const tabularJob = ok(
    await call(
      "POST",
      p + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [rid],
        kind: "TABULAR",
        format: "XLSX",
      },
      a,
    ),
    202,
  );
  assert.equal(await worker.runJob(org, member), true);
  const tabularState = ok(
    await call("GET", p + "/jobs/" + tabularJob.id, undefined, a),
  );
  assert.equal(tabularState.state, "COMPLETED");
  const tabularArtifact = ok(
    await call(
      "GET",
      p + "/artifacts/" + tabularState.result.artifactId + "/download",
      undefined,
      a,
    ),
  );
  const tabularBytes = Buffer.from(tabularArtifact.base64, "base64");
  assert.ok(tabularBytes.toString().includes('name="Tarefas"'));
  assert.ok(tabularBytes.toString().includes('name="Projetos"'));
  assert.ok(tabularBytes.toString().includes('<c r="B2"><v>3</v></c>'));
  if (process.env.PLATFORM_TABULAR_PROOF_PATH)
    await writeFile(process.env.PLATFORM_TABULAR_PROOF_PATH, tabularBytes);
  for (const format of ["JSON", "CSV", "XLSX"]) {
    const input =
      format === "JSON"
        ? { document: doc }
        : { format, base64: encodeTransfer(doc, format).toString("base64") };
    const targets = ok(
      await call("POST", p + "/imports/targets", { ...input, query: "" }, a),
    );
    assert.equal(targets.supported, true);
    assert.deepEqual(targets.items, [
      {
        id: rid,
        type: "test-resource",
        title: "Visible resource",
        canImport: true,
      },
    ]);
  }
  assert.equal(
    ok(
      await call(
        "POST",
        p + "/imports/targets",
        { document: { ...doc, resourceType: "test-private" } },
        a,
      ),
    ).supported,
    false,
  );
  assert.equal(
    (await call("POST", p + "/imports/targets", { document: doc }, b))
      .statusCode,
    404,
  );
  for (const format of ["JSON", "CSV", "XLSX"])
    assert.deepEqual(decodeTransfer(encodeTransfer(doc, format), format), doc);
  const preview = ok(
    await call(
      "POST",
      p + "/imports/preview",
      { document: doc, resourceId: rid },
      a,
    ),
  );
  const imported = ok(
    await call(
      "POST",
      p + "/imports",
      { document: doc, resourceId: rid, planHash: preview.planHash },
      a,
    ),
    202,
  );
  await worker.runJob(org, member);
  assert.equal(
    ok(await call("GET", p + "/jobs/" + imported.id, undefined, a)).state,
    "COMPLETED",
  );
  const currentPreview = ok(
    await call(
      "POST",
      p + "/imports/preview",
      { document: doc, resourceId: rid },
      a,
    ),
  );
  const changedPlanJob = ok(
    await call(
      "POST",
      p + "/imports",
      { document: doc, resourceId: rid, planHash: currentPreview.planHash },
      a,
    ),
    202,
  );
  changeImportPlan = true;
  await worker.runJob(org, member);
  changeImportPlan = false;
  const changedPlanState = ok(
    await call("GET", p + "/jobs/" + changedPlanJob.id, undefined, a),
  );
  assert.equal(changedPlanState.state, "FAILED");
  assert.equal(changedPlanState.errorCode, "IMPORT_PLAN_CHANGED");
  // Rollback adapter write and job completion together; retry does not leak a partial import.
  const count = await withContext(
    org,
    member,
    async (ctx) =>
      (await ctx.c.query("SELECT count(*) FROM platform_views")).rows[0].count,
  );
  const preview2 = ok(
    await call(
      "POST",
      p + "/imports/preview",
      { document: doc, resourceId: rid },
      a,
    ),
  );
  const rollback = ok(
    await call(
      "POST",
      p + "/imports",
      { document: doc, resourceId: rid, planHash: preview2.planHash },
      a,
    ),
    202,
  );
  failImport = true;
  await worker.runJob(org, member);
  failImport = false;
  assert.equal(
    await withContext(
      org,
      member,
      async (ctx) =>
        (await ctx.c.query("SELECT count(*) FROM platform_views")).rows[0]
          .count,
    ),
    count,
  );
  await withContext(org, member, async (ctx) => {
    await ctx.c.query(
      "UPDATE platform_jobs SET available_at=now() WHERE id=$1",
      [rollback.id],
    );
  });
  await worker.runJob(org, member);
  assert.equal(
    ok(await call("GET", p + "/jobs/" + rollback.id, undefined, a)).state,
    "COMPLETED",
  );
  // Simulate crashed lease and concurrent workers: only one artifact for the job.
  const crashed = ok(
    await call(
      "POST",
      p + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [rid],
        kind: "TASKS",
        format: "CSV",
      },
      a,
    ),
    202,
  );
  await withContext(org, member, async (ctx) => {
    await ctx.c.query(
      "UPDATE platform_jobs SET state='RUNNING',attempts=1,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1",
      [crashed.id, randomUUID()],
    );
  });
  await Promise.all([worker.runJob(org, member), worker.runJob(org, member)]);
  assert.equal(
    ok(await call("GET", p + "/jobs/" + crashed.id, undefined, a)).state,
    "COMPLETED",
  );
  assert.equal(
    await withContext(
      org,
      member,
      async (ctx) =>
        (
          await ctx.c.query(
            "SELECT count(*) FROM platform_artifacts WHERE job_id=$1",
            [crashed.id],
          )
        ).rows[0].count,
    ),
    "1",
  );
  // Outbox producer rollback and recipient/channel dedup.
  const notification = {
    eventId: randomUUID(),
    event: "TaskAssigned",
    ref: { type: "test-resource", id: rid },
    recipients: [{ memberId: member, nominal: true }],
  };
  await assert.rejects(
    withContext(org, member, async (ctx) => {
      await enqueueNotification(
        { ...ctx, member: { ...ctx.member, id: randomUUID() } },
        registry,
        notification,
      );
      throw Error("rollback");
    }),
  );
  assert.equal(
    await withContext(
      org,
      member,
      async (ctx) =>
        (await ctx.c.query("SELECT count(*) FROM platform_deliveries")).rows[0]
          .count,
    ),
    "0",
  );
  await withContext(org, member, async (ctx) => {
    const producer = { ...ctx, member: { ...ctx.member, id: randomUUID() } };
    await enqueueNotification(producer, registry, notification);
    await enqueueNotification(producer, registry, notification);
  });
  await call("POST", resource + "/follow", { enabled: false }, a); // nominal survives follow-off
  await worker.runDelivery(org, member); // may claim EMAIL first; explicitly drain IN_APP below
  await worker.runDelivery(org, member);
  assert.equal(
    ok(await call("GET", p + "/notifications", undefined, a)).items.length,
    1,
  );
  const indirect = {
    ...notification,
    eventId: randomUUID(),
    recipients: [{ memberId: member, nominal: false }],
  };
  await call("POST", resource + "/follow", { enabled: true }, a);
  await withContext(org, member, async (ctx) => {
    await enqueueNotification(
      { ...ctx, member: { ...ctx.member, id: randomUUID() } },
      registry,
      indirect,
    );
  });
  await call("POST", resource + "/follow", { enabled: false }, a);
  for (let i = 0; i < 4; i++) await worker.runDelivery(org, member);
  await withContext(org, member, async (ctx) => {
    const rows = (
      await ctx.c.query(
        "SELECT state FROM platform_deliveries WHERE organization_id=$1 AND event_id=$2",
        [org, indirect.eventId],
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.state === "SUPPRESSED"));
  });
  // Terminal crash and explicit retry; cancellation invalidates an old lease.
  const dispatchFixture = await dispatchTestPool(),
    dispatchPool = dispatchFixture.pool;
  try {
    const scopes = new PostgresScopeDispatch(dispatchPool);
    await assert.rejects(
      new PostgresScopeDispatch(pool).claim(),
      /DEDICATED_DISPATCH_CREDENTIAL_REQUIRED/,
    );
    await assert.rejects(dispatchPool.query("SELECT * FROM platform_jobs"));
    const automatic = ok(
      await call(
        "POST",
        p + "/exports",
        {
          resourceType: "test-resource",
          resourceIds: [rid],
          kind: "RESOURCES",
          format: "JSON",
        },
        a,
      ),
      202,
    );
    // A crash leaves only a durable scope lease. A new dispatcher recovers it without browser context.
    const lost = await scopes.claim();
    assert.ok(lost);
    assert.deepEqual(Object.keys(lost).sort(), [
      "memberId",
      "organizationId",
      "participants",
      "token",
    ]);
    assert.equal(
      await scopes.release({ ...lost, token: randomUUID() }, false),
      false,
    );
    await withContext(org, member, async (ctx) => {
      await ctx.c.query(
        "UPDATE platform_worker_scopes SET lease_until=now()-interval '1 second' WHERE organization_id=$1 AND member_id=$2",
        [org, member],
      );
    });
    const restarted = new PlatformDispatcher(
      new PostgresScopeDispatch(dispatchPool),
      worker,
    );
    await restarted.runOnce();
    assert.equal(
      ok(await call("GET", p + "/jobs/" + automatic.id, undefined, a)).state,
      "COMPLETED",
    );
  } finally {
    await dispatchFixture.close();
  }
  const terminal = ok(
    await call(
      "POST",
      p + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [rid],
        kind: "RESOURCES",
        format: "XLSX",
      },
      a,
    ),
    202,
  );
  await withContext(org, member, async (ctx) => {
    await ctx.c.query(
      "UPDATE platform_jobs SET state='RUNNING',attempts=5,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1",
      [terminal.id, randomUUID()],
    );
  });
  await worker.runJob(org, member);
  const failed = ok(
    await call("GET", p + "/jobs/" + terminal.id, undefined, a),
  );
  assert.equal(failed.state, "FAILED");
  ok(
    await call("POST", p + "/jobs/" + terminal.id + "/retry", {}, a, {
      "if-match": '"' + failed.version + '"',
    }),
  );
  await worker.runJob(org, member);
  const retried = ok(
    await call("GET", p + "/jobs/" + terminal.id, undefined, a),
  );
  assert.equal(retried.state, "COMPLETED");
  const xlsxArtifact = ok(
    await call(
      "GET",
      p + "/artifacts/" + retried.result.artifactId + "/download",
      undefined,
      a,
    ),
  );
  assert.equal(
    decodeTransfer(Buffer.from(xlsxArtifact.base64, "base64"), "XLSX").records
      .length,
    1,
  );
  const cancelled = ok(
    await call(
      "POST",
      p + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [rid],
        kind: "RESOURCES",
        format: "JSON",
      },
      a,
    ),
    202,
  );
  ok(
    await call("POST", p + "/jobs/" + cancelled.id + "/cancel", {}, a, {
      "if-match": '"1"',
    }),
  );
  await worker.runJob(org, member);
  assert.equal(
    ok(await call("GET", p + "/jobs/" + cancelled.id, undefined, a)).state,
    "CANCELLED",
  );
  // Real membership suspension denies old file access and idempotent replay, independently of adapter ACL.
  const memberB = ok(
    await call(
      "POST",
      "/organizations/" + org + "/members",
      { accountId: b.id },
      a,
    ),
    201,
  ).membership;
  records.get(rid)!.readers.add(memberB.id);
  assert.equal(
    (await call("POST", p + "/exports", privateInput, b)).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", p + "/files/" + file.id + "/download", undefined, b))
      .statusCode,
    200,
  );
  const bKey = randomUUID();
  await call("POST", resource + "/follow", { enabled: true }, a);
  await call("POST", resource + "/follow", { enabled: true }, b);
  const notificationRevision = ok(
    await call("GET", p + "/preferences", undefined, a),
  ).version;
  ok(
    await call(
      "POST",
      p + "/preferences",
      { event: "CommentAdded", channel: "EMAIL", enabled: false },
      a,
      { "if-match": '"' + notificationRevision + '"' },
    ),
  );
  const commentSnapshot = await withContext(org, member, async (ctx) => ({
    comments: (
      await ctx.c.query(
        "SELECT count(*) FROM platform_comments WHERE organization_id=$1 AND resource_id=$2",
        [org, rid],
      )
    ).rows[0].count,
    deliveries: (
      await ctx.c.query(
        "SELECT count(*) FROM platform_deliveries WHERE organization_id=$1 AND resource_id=$2 AND event='CommentAdded'",
        [org, rid],
      )
    ).rows[0].count,
  }));
  failCommentCommit = true;
  try {
    assert.equal(
      (
        await call(
          "POST",
          resource + "/comments",
          { content: "rolled back comment" },
          b,
        )
      ).statusCode,
      500,
    );
  } finally {
    failCommentCommit = false;
  }
  await withContext(org, member, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*) FROM platform_comments WHERE organization_id=$1 AND resource_id=$2",
          [org, rid],
        )
      ).rows[0].count,
      commentSnapshot.comments,
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*) FROM platform_deliveries WHERE organization_id=$1 AND resource_id=$2 AND event='CommentAdded'",
          [org, rid],
        )
      ).rows[0].count,
      commentSnapshot.deliveries,
    );
  });
  const revokedJob = ok(
    await call(
      "POST",
      p + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [rid],
        kind: "RESOURCES",
        format: "JSON",
      },
      b,
    ),
    202,
  );
  const followedComment = ok(
    await call(
      "POST",
      resource + "/comments",
      { content: "Before suspension" },
      b,
      { "idempotency-key": bKey },
    ),
    201,
  );
  assert.equal(
    ok(
      await call(
        "POST",
        resource + "/comments",
        { content: "Before suspension" },
        b,
        { "idempotency-key": bKey },
      ),
      201,
    ).id,
    followedComment.id,
  );
  await withContext(org, member, async (ctx) => {
    const queued = (
      await ctx.c.query(
        "SELECT recipient_id,channel FROM platform_deliveries WHERE organization_id=$1 AND event_id=$2",
        [org, followedComment.id],
      )
    ).rows;
    assert.equal(queued.length, 1);
    assert.equal(queued[0].recipient_id, member);
    assert.equal(queued[0].channel, "IN_APP");
  });
  for (let i = 0; i < 4; i++) await worker.runDelivery(org, member);
  assert.ok(
    ok(await call("GET", p + "/notifications", undefined, a)).items.some(
      (item: any) => item.event === "CommentAdded" && item.resourceId === rid,
    ),
  );
  ok(
    await call(
      "PATCH",
      "/organizations/" + org + "/members/" + memberB.id,
      { status: "SUSPENDED" },
      a,
      { "if-match": '"1"' },
    ),
  );
  assert.equal(
    (await call("GET", p + "/files/" + file.id + "/download", undefined, b))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        resource + "/comments",
        { content: "Before suspension" },
        b,
        { "idempotency-key": bKey },
      )
    ).statusCode,
    404,
  );
  await assert.rejects(worker.runJob(org, memberB.id));
  const revokedDispatchFixture = await dispatchTestPool(),
    revokedDispatchPool = revokedDispatchFixture.pool;
  try {
    await new PlatformDispatcher(
      new PostgresScopeDispatch(revokedDispatchPool),
      worker,
    ).runOnce();
    await withContext(org, member, async (ctx) => {
      const state = (
        await ctx.c.query(
          "SELECT state FROM platform_jobs WHERE organization_id=$1 AND id=$2",
          [org, revokedJob.id],
        )
      ).rows[0];
      assert.equal(state.state, "PENDING");
      assert.equal(
        (
          await ctx.c.query(
            "SELECT id FROM platform_artifacts WHERE organization_id=$1 AND job_id=$2",
            [org, revokedJob.id],
          )
        ).rows.length,
        0,
      );
      const scope = (
        await ctx.c.query(
          "SELECT lease_token,available_at>now() AS delayed FROM platform_worker_scopes WHERE organization_id=$1 AND member_id=$2",
          [org, memberB.id],
        )
      ).rows[0];
      assert.equal(scope.lease_token, null);
      assert.equal(scope.delayed, true);
    });
  } finally {
    await revokedDispatchFixture.close();
  }
  // Revoking domain ACL hides existing comments/search/favorites/files/jobs/artifact and replay.
  records.get(rid)!.readers.clear();
  lookupCalls.length = 0;
  assert.equal(
    ok(await call("GET", p + "/search?q=resource", undefined, a)).items.length,
    0,
  );
  assert.equal(
    ok(await call("GET", p + "/favorites", undefined, a)).items.length,
    0,
  );
  assert.equal(lookupCalls.includes(rid), false, "revoked title is not looked up");
  for (const path of [
    p + "/files/" + file.id + "/download",
    p + "/jobs/" + job.id,
    p + "/artifacts/" + completed.result.artifactId + "/download",
  ])
    assert.equal((await call("GET", path, undefined, a)).statusCode, 404);
  assert.equal(
    (
      await call(
        "POST",
        resource + "/comments",
        { content: "Hello <b>plain text</b>" },
        a,
        { "idempotency-key": key },
      )
    ).statusCode,
    403,
  );
  // RLS denies absent context, even for known IDs.
  await transaction(async (c) => {
    assert.equal(
      (await c.query("SELECT * FROM platform_files")).rows.length,
      0,
    );
  });
});
test("platform Guest wrapper intersects original explicit grant and current domain ACL with real cookies", async () => {
  const owner = await user(),
    guest = await user();
  const organization = ok(
    await call(
      "POST",
      "/organizations",
      { name: "Guest wrapper fixture" },
      owner,
    ),
    201,
  );
  const org = organization.organization.id;
  const ownerMember = ok(
    await call("GET", "/organizations/" + org + "/bootstrap", undefined, owner),
  ).membership.id;
  const shared = randomUUID(),
    hidden = randomUUID();
  records.set(shared, {
    org,
    title: "Explicit shared resource",
    readers: new Set([ownerMember]),
  });
  records.set(hidden, {
    org,
    title: "Private resource not shared",
    readers: new Set([ownerMember]),
  });
  const resource = {
    context: "platform-fixture-domain",
    kind: "resource",
    id: shared,
  };
  const membership = ok(
    await call(
      "POST",
      "/organizations/" + org + "/members",
      {
        accountId: guest.id,
        memberType: "GUEST",
        accessPlan: [{ resource, actions: ["read", "comment"] }],
      },
      owner,
    ),
    201,
  ).membership;
  records.get(shared)!.readers.add(membership.id);
  const base = "/organizations/" + org + "/platform";
  const path = base + "/resources/test-resource/" + shared;
  const visibleDelivery = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  // Historical rows from before a membership downgrade: trusted fixture setup,
  // not a Guest command and not a substitute for a functioning delivery worker.
  await platformCore.withWorkerContext(org, ownerMember, async (ctx) => {
    await ctx.c.query(
      "INSERT INTO platform_favorites(organization_id,id,owner_id,resource_type,resource_id) VALUES($1,$2,$3,'test-resource',$4)",
      [org, randomUUID(), membership.id, hidden],
    );
    await ctx.c.query(
      "INSERT INTO platform_deliveries(organization_id,id,event_id,recipient_id,channel,resource_type,resource_id,event,state) SELECT $1,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,gen_random_uuid(),$2,'IN_APP','test-resource',$3,'PrivateHistory','DELIVERED' FROM generate_series(1,105) AS n",
      [org, membership.id, hidden],
    );
    await ctx.c.query(
      "INSERT INTO platform_deliveries(organization_id,id,event_id,recipient_id,channel,resource_type,resource_id,event,state) VALUES($1,$2,$3,$4,'IN_APP','test-resource',$5,'CommentAdded','DELIVERED')",
      [org, visibleDelivery, randomUUID(), membership.id, shared],
    );
  });
  ok(await call("POST", path + "/favorite", { enabled: true }, guest));
  lookupCalls.length = 0;
  const favorites = ok(
    await call("GET", base + "/favorites", undefined, guest),
  ).items;
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].resourceId, shared);
  assert.equal(favorites[0].resourceTitle, "Explicit shared resource");
  assert.equal(lookupCalls.includes(hidden), false, "hidden Guest title is not looked up");
  const delivered = ok(
    await call("GET", base + "/notifications", undefined, guest),
  ).items;
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].id, visibleDelivery);
  assert.ok(!JSON.stringify(delivered).includes("PrivateHistory"));
  ok(
    await call(
      "POST",
      base + "/notifications/" + visibleDelivery + "/read",
      {},
      guest,
    ),
  );
  assert.ok(
    ok(await call("GET", base + "/notifications", undefined, guest)).items[0]
      .readAt,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/notifications/00000000-0000-4000-8000-000000000001/read",
        {},
        guest,
      )
    ).statusCode,
    404,
  );
  const file = ok(
    await call(
      "POST",
      path + "/uploads",
      {
        name: "shared-note.txt",
        mime: "text/plain",
        base64: Buffer.from("shared bytes").toString("base64"),
      },
      owner,
    ),
    201,
  );
  const hiddenFile = ok(
    await call(
      "POST",
      base + "/resources/test-resource/" + hidden + "/uploads",
      {
        name: "private-note.txt",
        mime: "text/plain",
        base64: Buffer.from("private bytes").toString("base64"),
      },
      owner,
    ),
    201,
  );
  assert.equal(
    ok(await call("GET", path + "/files", undefined, guest)).items.length,
    1,
  );
  assert.equal(
    Buffer.from(
      ok(
        await call(
          "GET",
          base + "/files/" + file.id + "/download",
          undefined,
          guest,
        ),
      ).base64,
      "base64",
    ).toString(),
    "shared bytes",
  );
  const deniedDownload = await call(
    "GET",
    base + "/files/" + hiddenFile.id + "/download",
    undefined,
    guest,
  );
  assert.equal(deniedDownload.statusCode, 404);
  assert.ok(!deniedDownload.body.includes("private-note"));
  assert.equal(
    (
      await call(
        "POST",
        "/organizations/" +
          org +
          "/members/" +
          membership.id +
          "/access-grants",
        {
          accessPlan: [
            {
              resource: {
                context: "platform-wrapper",
                kind: "resource",
                id: shared,
              },
              actions: ["read"],
            },
          ],
        },
        owner,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", path + "/capabilities", undefined, guest)).statusCode,
    200,
  );
  const denied = await call(
    "GET",
    base + "/resources/test-resource/" + hidden + "/comments",
    undefined,
    guest,
  );
  assert.equal(denied.statusCode, 404);
  assert.ok(!denied.body.includes("Private resource"));
  const scopedSearch = ok(
    await call("GET", base + "/search?q=shared", undefined, guest),
  );
  assert.deepEqual(scopedSearch.items, [
    { type: "test-resource", id: shared, title: "Explicit shared resource" },
  ]);
  assert.deepEqual(
    ok(await call("GET", base + "/search?q=Private", undefined, guest)).items,
    [],
  );
  assert.equal(guestBroadSearches, 0);
  assert.equal(
    (await call("GET", base + "/jobs", undefined, guest)).statusCode,
    404,
  );
  const key = randomUUID();
  const comment = ok(
    await call(
      "POST",
      path + "/comments",
      { content: "Guest shared comment" },
      guest,
      { "idempotency-key": key },
    ),
    201,
  );
  assert.equal(
    ok(await call("GET", path + "/comments", undefined, guest)).items[0].id,
    comment.id,
  );
  await assert.rejects(
    platformCore.withWorkerContext(
      org,
      membership.id,
      async () => "broad worker must not run",
    ),
  );
  let trustedRan = false;
  await platformCore.withResourceWorkerContext(
    org,
    membership.id,
    [{ resource, action: "read" }],
    async (ctx) => {
      await registry.require(
        ctx,
        { type: "test-resource", id: shared },
        "read",
      );
      const noSearchPort = new ResourceRegistry({
        guestAccess: async () => true,
      });
      noSearchPort.registerResourceAdapter(
        "test-resource",
        registry.get("test-resource")!,
      );
      assert.deepEqual(
        await noSearchPort.search(ctx, "test-resource", "shared", 100),
        [],
      );
      assert.deepEqual(await noSearchPort.collectionScope(ctx, "read"), []);
      assert.equal(guestBroadSearches, 0);
      trustedRan = true;
    },
  );
  assert.equal(trustedRan, true);
  records.get(shared)!.readers.delete(membership.id);
  assert.equal(
    (await call("GET", path + "/capabilities", undefined, guest)).statusCode,
    403,
  );
  records.get(shared)!.readers.add(membership.id);
  records.get(shared)!.readers.delete(ownerMember);
  assert.deepEqual(
    ok(await call("GET", base + "/favorites", undefined, guest)).items,
    [],
  );
  assert.deepEqual(
    ok(await call("GET", base + "/notifications", undefined, guest)).items,
    [],
  );
  assert.equal(
    (await call("GET", path + "/comments", undefined, guest)).statusCode,
    404,
  );
  assert.deepEqual(
    ok(await call("GET", base + "/search?q=shared", undefined, guest)).items,
    [],
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/files/" + file.id + "/download",
        undefined,
        guest,
      )
    ).statusCode,
    404,
  );
  records.get(shared)!.readers.add(ownerMember);
  const grants = ok(
    await call(
      "GET",
      "/organizations/" + org + "/members/" + membership.id + "/access-grants",
      undefined,
      owner,
    ),
  ).items;
  ok(
    await call(
      "POST",
      "/organizations/" +
        org +
        "/members/" +
        membership.id +
        "/access-grants/" +
        grants[0].id +
        "/revoke",
      {},
      owner,
      { "if-match": '"' + grants[0].version + '"' },
    ),
  );
  assert.equal(
    (await call("GET", path + "/comments", undefined, guest)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/comments",
        { content: "Guest shared comment" },
        guest,
        { "idempotency-key": key },
      )
    ).statusCode,
    404,
  );
  trustedRan = false;
  await assert.rejects(
    platformCore.withResourceWorkerContext(
      org,
      membership.id,
      [{ resource, action: "read" }],
      async () => {
        trustedRan = true;
      },
    ),
  );
  assert.equal(trustedRan, false);
});
test("platform upload policy is byte-classified before replay/storage and preserves existing READY downloads", async () => {
  const actor = await user(),
    orgData = ok(
      await call(
        "POST",
        "/organizations",
        { name: "Upload policy fixture" },
        actor,
      ),
      201,
    ),
    org = orgData.organization.id,
    member = orgData.membership.id,
    rid = randomUUID();
  records.set(rid, { org, title: "Upload target", readers: new Set([member]) });
  const path =
      "/organizations/" + org + "/platform/resources/test-resource/" + rid,
    base = "/organizations/" + org + "/platform";
  const payload = {
      name: "unknown.bin",
      mime: "application/octet-stream",
      base64: Buffer.from([0, 255, 128, 1, 42]).toString("base64"),
    },
    key = randomUUID();
  const created = ok(
    await call("POST", path + "/uploads", payload, actor, {
      "idempotency-key": key,
    }),
    201,
  );
  const downloaded = await call(
      "GET",
      base + "/files/" + created.id + "/download",
      undefined,
      actor,
    ),
    dto = ok(downloaded);
  assert.equal(dto.downloadMime, "application/octet-stream");
  assert.equal(dto.preview, false);
  assert.equal(dto.disposition, "attachment");
  assert.equal(downloaded.headers["x-content-type-options"], "nosniff");
  assert.equal(dto.base64, payload.base64);
  await platformCore.withWorkerContext(org, member, async (ctx) => {
    const row = (
      await ctx.c.query(
        "SELECT classified_kind,upload_policy_revision,classifier_version FROM platform_files WHERE organization_id=$1 AND id=$2",
        [org, created.id],
      )
    ).rows[0];
    assert.equal(row.classified_kind, "OPAQUE");
    assert.equal(row.upload_policy_revision, 0);
    assert.ok(row.classifier_version);
  });
  const before = (await readdir(root)).sort();
  fixtureUploadPolicies.set(org, {
    schemaVersion: 1,
    policyId: randomUUID(),
    revision: 1,
    mode: "DISABLED",
    allowedKinds: [],
  });
  assert.equal(
    (
      await call("POST", path + "/uploads", payload, actor, {
        "idempotency-key": key,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("POST", path + "/uploads", payload, actor)).statusCode,
    403,
  );
  assert.deepEqual((await readdir(root)).sort(), before);
  assert.equal(
    ok(
      await call(
        "GET",
        base + "/files/" + created.id + "/download",
        undefined,
        actor,
      ),
    ).base64,
    payload.base64,
  );
  assert.equal(
    ok(await call("GET", path + "/capabilities", undefined, actor)).actions
      .attach,
    false,
  );
  const generated = ok(
    await call(
      "POST",
      base + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [rid],
        kind: "RESOURCES",
        format: "JSON",
      },
      actor,
    ),
    202,
  );
  assert.equal(
    await new PlatformWorker({ withContext, registry, blobs }).runJob(
      org,
      member,
    ),
    true,
  );
  assert.equal(
    ok(await call("GET", base + "/jobs/" + generated.id, undefined, actor))
      .state,
    "COMPLETED",
  );
  fixtureUploadPolicies.set(org, {
    schemaVersion: 1,
    policyId: randomUUID(),
    revision: 2,
    mode: "ALLOWLIST",
    allowedKinds: ["JSON"],
  });
  assert.equal(
    (await call("POST", path + "/uploads", payload, actor)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/uploads",
        { ...payload, name: "fake.png", mime: "image/png" },
        actor,
      )
    ).statusCode,
    422,
  );
  const json = ok(
    await call(
      "POST",
      path + "/uploads",
      {
        name: "data.bin",
        mime: "application/octet-stream",
        base64: Buffer.from('{"ok":true}').toString("base64"),
      },
      actor,
    ),
    201,
  );
  assert.equal(json.mime, "application/json");
  assert.equal(
    (
      await call(
        "POST",
        path + "/uploads",
        { ...payload, purpose: "GENERATED_EXPORT" },
        actor,
      )
    ).statusCode,
    400,
  );
  fixtureUploadPolicies.set(org, {
    schemaVersion: 1,
    policyId: null,
    revision: 3,
    mode: "ANY",
    allowedKinds: [],
  });
  const beforeFailure = (await readdir(root)).sort();
  failAttachmentCommit = true;
  try {
    assert.equal(
      (
        await call(
          "POST",
          path + "/uploads",
          { ...payload, name: "rolled-back.bin" },
          actor,
        )
      ).statusCode,
      500,
    );
  } finally {
    failAttachmentCommit = false;
  }
  assert.deepEqual((await readdir(root)).sort(), beforeFailure);
  await platformCore.withWorkerContext(org, member, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*)::int AS n FROM platform_files WHERE organization_id=$1 AND name='rolled-back.bin'",
          [org],
        )
      ).rows[0].n,
      0,
    );
  });
  const unbound = await buildApp([
    foundationDefaultAdmissionPolicy,
    createPlatform({ registry, blobs }),
  ]);
  const beforeUnbound = (await readdir(root)).sort();
  try {
    const response = await unbound.inject({
      method: "POST",
      url: "/api/v1" + path + "/uploads",
      headers: {
        origin: "http://localhost:5173",
        cookie: actor.cookie,
        "x-csrf-token": actor.csrf,
        "idempotency-key": randomUUID(),
      },
      payload,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, "UPLOAD_POLICY_PROVIDER_UNBOUND");
  } finally {
    await unbound.close();
  }
  assert.deepEqual((await readdir(root)).sort(), beforeUnbound);
  const sharedUploads = createIncomingUploadService({
    core: platformCore,
    registry,
    blobs,
    policyProvider: fixtureUploadPolicyProvider,
  });
  await platformCore.withWorkerContext(org, member, (ctx) =>
    sharedUploads.validateChange(ctx, {
      previous: {
        schemaVersion: 1,
        policyId: null,
        revision: 0,
        mode: "ANY",
        allowedKinds: [],
      },
      next: {
        schemaVersion: 1,
        policyId: null,
        revision: 1,
        mode: "ALLOWLIST",
        allowedKinds: ["PNG"],
      },
    }),
  );
  const sharedApp = await buildApp([
    foundationDefaultAdmissionPolicy,
    createPlatform({ registry, blobs, uploads: sharedUploads }),
  ]);
  try {
    const response = await sharedApp.inject({
      method: "POST",
      url: "/api/v1" + path + "/uploads",
      headers: {
        origin: "http://localhost:5173",
        cookie: actor.cookie,
        "x-csrf-token": actor.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: { ...payload, name: "shared-service.bin" },
    });
    assert.equal(response.statusCode, 201, response.body);
  } finally {
    await sharedApp.close();
  }
  const brokenApp = await buildApp([
    foundationDefaultAdmissionPolicy,
    createPlatform({
      registry,
      blobs,
      uploadPolicyProvider: {
        resolve: async () => {
          throw Error("resolver unavailable fixture");
        },
      },
    }),
  ]);
  const beforeBroken = (await readdir(root)).sort();
  try {
    const response = await brokenApp.inject({
      method: "POST",
      url: "/api/v1" + path + "/uploads",
      headers: {
        origin: "http://localhost:5173",
        cookie: actor.cookie,
        "x-csrf-token": actor.csrf,
        "idempotency-key": randomUUID(),
      },
      payload,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(
      response.json().error.code,
      "UPLOAD_POLICY_PROVIDER_UNAVAILABLE",
    );
  } finally {
    await brokenApp.close();
  }
  assert.deepEqual((await readdir(root)).sort(), beforeBroken);
  await platformCore.withWorkerContext(org, member, async (ctx) => {
    for (const format of ["PDF", "ZIP"] as const)
      await assert.rejects(
        createExportJobPort(registry).enqueue(ctx, {
          resourceType: "test-resource",
          resourceIds: [rid],
          exportKind: "RESOURCES",
          format,
          requestId: randomUUID(),
        }),
        (error) =>
          error instanceof Failure &&
          error.status === 503 &&
          error.code === "FORMAT_CONFIGURATION_REQUIRED",
      );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*)::int AS n FROM platform_jobs WHERE organization_id=$1 AND format IN('PDF','ZIP')",
          [org],
        )
      ).rows[0].n,
      0,
    );
  });
  fixtureUploadPolicies.delete(org);
});
test("platform comment merge preserves microseconds, colliding IDs and complete stable pagination", async () => {
  const actor = await user(),
    organization = ok(
      await call(
        "POST",
        "/organizations",
        { name: "Thread merge fixture" },
        actor,
      ),
      201,
    );
  const org = organization.organization.id,
    member = organization.membership.id,
    rid = randomUUID();
  const local = new ResourceRegistry();
  local.registerResourceAdapter("task", { authorize: async () => true });
  assert.throws(
    () => createCommentThreadPort({ core: platformCore, registry: local }),
    /COMMENT_THREAD_UNAVAILABLE/,
  );
  const legacy = Array.from({ length: 105 }, (_, i) => ({
    id: randomUUID(),
    authorId: member,
    content: "<b>literal " + i + "</b>",
    createdAt: "2026-10-19T12:00:00." + String(i).padStart(6, "0") + "Z",
  }));
  let calls = 0;
  const service = createCommentThreadPort({
    core: platformCore,
    registry: local,
    legacyTaskComments: {
      list: async (_ctx, { after, take }) => {
        calls++;
        return legacy
          .filter(
            (r) =>
              !after ||
              r.createdAt > after.createdAt ||
              (r.createdAt === after.createdAt && r.id > after.id),
          )
          .slice(0, take);
      },
    },
  });
  await platformCore.withWorkerContext(org, member, async (ctx) => {
    for (const row of legacy)
      await ctx.c.query(
        "INSERT INTO platform_comments(organization_id,id,resource_type,resource_id,author_id,content,created_at) VALUES($1,$2,'task',$3,$4,$5,$6)",
        [org, row.id, rid, member, "new " + row.content, row.createdAt],
      );
    const seen = [];
    let after:
      | import("../../server/modules/platform/comments-contract.js").CommentPosition
      | undefined;
    do {
      const page = await service.list(ctx, {
        ref: { type: "task", id: rid },
        limit: 17,
        after,
      });
      seen.push(...page.items);
      after = page.page.hasMore ? page.page.after! : undefined;
    } while (after);
    assert.equal(seen.length, 210);
    assert.equal(new Set(seen.map((r) => r.key)).size, 210);
    for (let i = 0; i < 105; i++) {
      assert.equal(seen[i * 2].source, "WORK_LEGACY");
      assert.equal(seen[i * 2 + 1].source, "PLATFORM");
      assert.equal(seen[i * 2].id, seen[i * 2 + 1].id);
      assert.equal(seen[i * 2].createdAt, legacy[i].createdAt);
      assert.equal(seen[i * 2].version, null);
    }
    assert.equal(calls, 13);
    const cursor = createCommentCursor("x".repeat(32)),
      binding = {
        organizationId: org,
        memberId: member,
        type: "task",
        id: rid,
        limit: 17,
      },
      position = {
        createdAt: legacy[0].createdAt,
        id: legacy[0].id,
        source: "WORK_LEGACY" as const,
      };
    const token = cursor.encode(binding, position);
    assert.deepEqual(cursor.decode(token, binding), position);
    assert.throws(() => cursor.decode(token, { ...binding, id: randomUUID() }));
    assert.throws(() => cursor.decode(token + "x", binding));
  });
});
test("platform HTTP comment cursors bind actor/resource/limit and revalidate ACL; append rollback is atomic", async () => {
  const actor = await user(),
    other = await user(),
    organization = ok(
      await call(
        "POST",
        "/organizations",
        { name: "HTTP thread fixture" },
        actor,
      ),
      201,
    );
  const org = organization.organization.id,
    member = organization.membership.id,
    rid = randomUUID();
  const otherMember = ok(
    await call(
      "POST",
      "/organizations/" + org + "/members",
      { accountId: other.id },
      actor,
    ),
    201,
  ).membership.id;
  records.set(rid, {
    org,
    title: "HTTP thread resource",
    readers: new Set([member, otherMember]),
  });
  const path =
    "/organizations/" +
    org +
    "/platform/resources/test-resource/" +
    rid +
    "/comments";
  await platformCore.withWorkerContext(org, member, async (ctx) => {
    for (let i = 0; i < 105; i++)
      await ctx.c.query(
        "INSERT INTO platform_comments(organization_id,id,resource_type,resource_id,author_id,content,created_at) VALUES($1,$2,'test-resource',$3,$4,$5,'2026-10-19T10:00:00Z'::timestamptz+$6::int*interval '1 microsecond')",
        [org, randomUUID(), rid, member, "literal " + i, i],
      );
  });
  const first = ok(await call("GET", path + "?limit=17", undefined, actor));
  assert.equal(first.items.length, 17);
  assert.equal(first.page.hasMore, true);
  assert.ok(first.page.nextCursor);
  assert.match(first.items[1].createdAt, /\.000001Z$/);
  const cursor = encodeURIComponent(first.page.nextCursor);
  assert.equal(
    (await call("GET", path + "?limit=18&cursor=" + cursor, undefined, actor))
      .statusCode,
    400,
  );
  assert.equal(
    (await call("GET", path + "?limit=17&cursor=" + cursor, undefined, other))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "GET",
        path + "?limit=17&cursor=" + cursor + "x",
        undefined,
        actor,
      )
    ).statusCode,
    400,
  );
  let page = first;
  const seen = [...first.items];
  while (page.page.hasMore) {
    page = ok(
      await call(
        "GET",
        path + "?limit=17&cursor=" + encodeURIComponent(page.page.nextCursor),
        undefined,
        actor,
      ),
    );
    seen.push(...page.items);
  }
  assert.equal(seen.length, 105);
  assert.equal(new Set(seen.map((r) => r.key)).size, 105);
  const service = createCommentThreadPort({ core: platformCore, registry });
  await assert.rejects(
    platformCore.withWorkerContext(org, member, async (ctx) => {
      await service.append(ctx, {
        ref: { type: "test-resource", id: rid },
        body: { content: "must roll back" },
      });
      throw Error("after append rollback");
    }),
    /after append rollback/,
  );
  await platformCore.withWorkerContext(org, member, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*)::int AS n FROM platform_comments WHERE organization_id=$1 AND resource_id=$2",
          [org, rid],
        )
      ).rows[0].n,
      105,
    );
    await assert.rejects(
      service.append(
        { ...ctx, mode: "read" },
        {
          ref: { type: "test-resource", id: rid },
          body: { content: "deny read" },
        },
      ),
    );
  });
  records.get(rid)!.readers.delete(member);
  assert.equal(
    (await call("GET", path + "?limit=17&cursor=" + cursor, undefined, actor))
      .statusCode,
    403,
  );
});
test("platform scoped Guest delivery worker claims metadata before original-resource guard", async () => {
  if (process.env.PLATFORM_GUEST_DELIVERY_ISOLATED !== "1") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "server/modules/platform/test-runner.ts",
          "--guest-delivery-only",
        ],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk.toString()));
      child.stderr.on("data", (chunk) => (output += chunk.toString()));
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(Error("Isolated Guest delivery proof failed: " + output)),
      );
    });
    return;
  }
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/orgmap_platform_[a-f0-9]+$/,
  );
  const owner = await user(),
    guest = await user();
  const organization = ok(
    await call(
      "POST",
      "/organizations",
      { name: "Scoped Guest delivery fixture" },
      owner,
    ),
    201,
  );
  const org = organization.organization.id;
  const ownerMember = ok(
    await call("GET", "/organizations/" + org + "/bootstrap", undefined, owner),
  ).membership.id;
  const shared = randomUUID(),
    hidden = randomUUID();
  records.set(shared, {
    org,
    title: "Shared delivery resource",
    readers: new Set([ownerMember]),
  });
  records.set(hidden, {
    org,
    title: "Never read private delivery body",
    readers: new Set([ownerMember]),
  });
  const resource = {
    context: "platform-fixture-domain",
    kind: "resource",
    id: shared,
  };
  const membership = ok(
    await call(
      "POST",
      "/organizations/" + org + "/members",
      {
        accountId: guest.id,
        memberType: "GUEST",
        accessPlan: [{ resource, actions: ["read"] }],
      },
      owner,
    ),
    201,
  ).membership;
  records.get(shared)!.readers.add(membership.id);
  const base = "/organizations/" + org + "/platform";
  ok(
    await call(
      "POST",
      base + "/notification-policy",
      {
        event: "CommentAdded",
        channel: "EMAIL",
        moduleEnabled: true,
        masterEnabled: true,
        defaultEnabled: false,
        locked: true,
      },
      owner,
      { "if-match": '"1"' },
    ),
  );
  const enqueue = async (resourceId = shared, email = false) =>
    platformCore.withWorkerContext(org, ownerMember, async (ctx) => {
      assert.equal(
        await platformCore.validateActiveMembers(ctx, [membership.id]),
        true,
      );
      const eventId = randomUUID();
      await enqueueNotification(ctx, registry, {
        eventId,
        event: "CommentAdded",
        ref: { type: "test-resource", id: resourceId },
        recipients: [{ memberId: membership.id, nominal: true }],
      });
      const rows = (
        await ctx.c.query(
          "SELECT id,channel FROM platform_deliveries WHERE organization_id=$1 AND event_id=$2",
          [org, eventId],
        )
      ).rows;
      assert.equal(rows.length, email ? 2 : 1);
      return rows.find((row) => row.channel === (email ? "EMAIL" : "IN_APP"))!
        .id as string;
    });
  const state = async (deliveryId: string) =>
    platformCore.withWorkerContext(
      org,
      ownerMember,
      async (ctx) =>
        (
          await ctx.c.query(
            "SELECT state,attempts,available_at>clock_timestamp() AS future FROM platform_deliveries WHERE organization_id=$1 AND id=$2",
            [org, deliveryId],
          )
        ).rows[0],
    );
  const fixture = await dispatchTestPool();
  const scopes = new PostgresScopeDispatch(fixture.pool),
    metadata = scopes.deliveryMetadata();
  let broadCalls = 0,
    businessCallbacks = 0;
  const guarded: import("../../server/modules/platform/scoped-delivery.js").ReadResourceWorkerContextPort =
    (organizationId, memberId, ref, fn) =>
      platformCore.withResourceWorkerContext(
        organizationId,
        memberId,
        [
          {
            resource: {
              context: "platform-fixture-domain",
              kind: "resource",
              id: ref.id,
            },
            action: "read",
          },
        ],
        async (ctx) => {
          businessCallbacks++;
          return fn(ctx);
        },
      );
  const makeWorker = (port = metadata) =>
    new PlatformWorker({
      registry,
      blobs,
      withContext: async (...args) => {
        broadCalls++;
        return platformCore.withWorkerContext(...args);
      },
      scopedDeliveries: new ScopedDeliveryWorker({
        metadata: port,
        registry,
        withReadResourceContext: guarded,
      }),
    });
  try {
    const firstId = await enqueue();
    const scope = await scopes.claim();
    assert.ok(scope);
    assert.equal(scope.memberId, membership.id);
    assert.equal(await metadata.hasDueJobs(scope), false);
    await assert.rejects(
      createDeliveryMetadataPort(pool).claim(scope),
      /DEDICATED_DISPATCH_CREDENTIAL_REQUIRED/,
    );
    await assert.rejects(
      fixture.pool.query("SELECT * FROM platform_deliveries"),
    );
    assert.equal(await metadata.claim({ ...scope, token: randomUUID() }), null);
    assert.equal(
      await metadata.claim({ ...scope, organizationId: randomUUID() }),
      null,
    );
    const claims = await Promise.all([
      metadata.claim(scope),
      metadata.claim(scope),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const claim = claims.find(Boolean)!;
    assert.deepEqual(Object.keys(claim).sort(), [
      "id",
      "resource",
      "scope",
      "token",
    ]);
    assert.equal(claim.id, firstId);
    assert.equal(
      await metadata.finish({ ...claim, token: randomUUID() }, "DELIVERED"),
      false,
    );
    await platformCore.withWorkerContext(org, ownerMember, (ctx) =>
      ctx.c.query(
        "UPDATE platform_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [org, firstId],
      ),
    );
    await scopes.release(scope, false);
    const restarted = new PlatformDispatcher(scopes, makeWorker());
    assert.equal(await restarted.runOnce(), true);
    assert.equal((await state(firstId)).state, "DELIVERED");
    assert.equal(
      broadCalls,
      0,
      "An empty job branch must not enter broad Guest context",
    );
    assert.equal(
      ok(await call("GET", base + "/notifications", undefined, guest)).items[0]
        .id,
      firstId,
    );
    assert.equal(await metadata.finish(claim, "DELIVERED"), false);
    const privateId = await enqueue(hidden);
    businessCallbacks = 0;
    await restarted.runOnce();
    assert.equal((await state(privateId)).state, "SUPPRESSED");
    assert.equal(businessCallbacks, 0);
    // Enable EMAIL through the real policy API while the original Guest grant remains active.
    ok(
      await call(
        "POST",
        base + "/notification-policy",
        {
          event: "CommentAdded",
          channel: "EMAIL",
          moduleEnabled: true,
          masterEnabled: true,
          defaultEnabled: true,
          locked: true,
        },
        owner,
        { "if-match": '"2"' },
      ),
    );
    let smtpBody = "",
      sends = 0;
    const sink = createServer((socket) => {
      socket.write("220 guest sink\r\n");
      let buffer = "",
        data = false;
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes("\r\n")) {
          const end = buffer.indexOf("\r\n"),
            line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (data) {
            if (line === ".") {
              data = false;
              socket.write("250 accepted\r\n");
            } else smtpBody += line + "\n";
          } else if (line === "DATA") {
            data = true;
            socket.write("354 data\r\n");
          } else socket.write(line === "QUIT" ? "221 bye\r\n" : "250 OK\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    try {
      const emailId = await enqueue(shared, true);
      const emailScope = await scopes.claim();
      assert.ok(emailScope);
      const smtp = new LocalSmtpTransport((sink.address() as any).port);
      const emailWorker = new ScopedDeliveryWorker({
        metadata,
        registry,
        withReadResourceContext: guarded,
        transport: {
          send: async (input) => {
            sends++;
            if (sends === 1) throw new SmtpDeliveryError("NOT_SENT", "transient fixture");
            await smtp.send(input);
          },
        },
      });
      for (let i = 0; i < 2; i++) await emailWorker.run(emailScope);
      assert.equal((await state(emailId)).state, "PENDING");
      assert.equal((await state(emailId)).future, true);
      assert.equal(smtpBody, "");
      await platformCore.withWorkerContext(org, ownerMember, (ctx) =>
        ctx.c.query(
          "UPDATE platform_deliveries SET available_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
          [org, emailId],
        ),
      );
      assert.equal(await emailWorker.run(emailScope), true);
      assert.equal((await state(emailId)).state, "DELIVERED");
      assert.equal(sends, 2);
      assert.ok(smtpBody.includes("To: <" + guest.email + ">"));
      assert.ok(
        smtpBody.includes("Message-ID: <" + emailId + "@orgmap.local>"),
      );
      assert.ok(!smtpBody.includes("Shared delivery resource"));
      await scopes.release(emailScope, false);
    } finally {
      await new Promise<void>((resolve) => sink.close(() => resolve()));
    }
    ok(
      await call(
        "POST",
        base + "/notification-policy",
        {
          event: "CommentAdded",
          channel: "EMAIL",
          moduleEnabled: true,
          masterEnabled: true,
          defaultEnabled: false,
          locked: true,
        },
        owner,
        { "if-match": '"3"' },
      ),
    );
    const revokedId = await enqueue();
    businessCallbacks = 0;
    const grants = ok(
      await call(
        "GET",
        "/organizations/" +
          org +
          "/members/" +
          membership.id +
          "/access-grants",
        undefined,
        owner,
      ),
    ).items;
    const revoking = {
      ...metadata,
      claim: async (
        s: import("../../server/modules/platform/delivery-metadata.js").DeliveryScope,
      ) => {
        const picked = await metadata.claim(s);
        if (picked)
          ok(
            await call(
              "POST",
              "/organizations/" +
                org +
                "/members/" +
                membership.id +
                "/access-grants/" +
                grants[0].id +
                "/revoke",
              {},
              owner,
              { "if-match": '"' + grants[0].version + '"' },
            ),
          );
        return picked;
      },
    };
    await new PlatformDispatcher(scopes, makeWorker(revoking)).runOnce();
    assert.equal((await state(revokedId)).state, "SUPPRESSED");
    assert.equal(businessCallbacks, 0);
    assert.deepEqual(
      ok(await call("GET", base + "/notifications", undefined, guest)).items,
      [],
    );
    const retryId = await enqueue();
    const retryScope = await scopes.claim();
    assert.ok(retryScope);
    const retryClaim = await metadata.claim(retryScope);
    assert.ok(retryClaim);
    assert.equal(await metadata.finish(retryClaim, "RETRY"), true);
    assert.equal((await state(retryId)).state, "PENDING");
    assert.equal((await state(retryId)).future, true);
    await scopes.release(retryScope, false);
    await platformCore.withWorkerContext(org, ownerMember, (ctx) =>
      ctx.c.query(
        "UPDATE platform_deliveries SET attempts=5,available_at=clock_timestamp()-interval '1 second',lease_token=$3,lease_until=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [org, retryId, randomUUID()],
      ),
    );
    await restarted.runOnce();
    assert.equal((await state(retryId)).state, "FAILED");
  } finally {
    await fixture.close();
  }
});
test("operator backup port requires a complete readonly snapshot and validates every referenced blob", async () => {
  // A global fixture DB contains references owned by other tests' blob roots.
  // Production enumeration must remain complete, so isolate this proof instead of filtering its manifest.
  if (process.env.PLATFORM_BACKUP_ISOLATED !== "1") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "server/modules/platform/test-runner.ts",
          "--backup-only",
        ],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(Error("Isolated backup proof failed: " + output)),
      );
    });
    return;
  }
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/orgmap_platform_[a-f0-9]+$/,
  );
  const actor = await user();
  const organization = ok(
    await call(
      "POST",
      "/organizations",
      { name: "Isolated backup fixture" },
      actor,
    ),
    201,
  );
  const org = organization.organization.id;
  const member = ok(
    await call("GET", "/organizations/" + org + "/bootstrap", undefined, actor),
  ).membership.id;
  const resourceId = randomUUID();
  records.set(resourceId, {
    org,
    title: "Backup resource",
    readers: new Set([member]),
  });
  const base = "/organizations/" + org + "/platform";
  ok(
    await call(
      "POST",
      base + "/resources/test-resource/" + resourceId + "/uploads",
      {
        name: "backup.txt",
        mime: "text/plain",
        base64: Buffer.from("confirmed backup bytes").toString("base64"),
      },
      actor,
    ),
    201,
  );
  const exportJob = ok(
    await call(
      "POST",
      base + "/exports",
      {
        resourceType: "test-resource",
        resourceIds: [resourceId],
        kind: "RESOURCES",
        format: "JSON",
      },
      actor,
    ),
    202,
  );
  await new PlatformWorker({
    withContext: createRuntime().withWorkerContext,
    registry,
    blobs,
  }).runJob(org, member);
  assert.equal(
    ok(await call("GET", base + "/jobs/" + exportJob.id, undefined, actor))
      .state,
    "COMPLETED",
  );
  const operator = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const snapshot = await operator.connect(),
    tenant = await pool.connect();
  const lateIds: string[] = [randomUUID(), randomUUID()];
  try {
    await assert.rejects(
      listPlatformBackupReferences(snapshot),
      /SNAPSHOT_REQUIRED/,
    );
    await tenant.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await assert.rejects(
      listPlatformBackupReferences(tenant),
      /OPERATOR_REQUIRED/,
    );
    await tenant.query("ROLLBACK");
    await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const refs = await listPlatformBackupReferences(snapshot);
    assert.ok(refs.some((r) => r.kind === "FILE"));
    assert.ok(refs.some((r) => r.kind === "ARTIFACT"));
    const count = (
      await snapshot.query(
        "SELECT (SELECT count(*) FROM platform_files)+(SELECT count(*) FROM platform_artifacts) AS n",
      )
    ).rows[0].n;
    assert.equal(refs.length, Number(count));
    for (const ref of refs)
      assert.equal((await readPlatformBackupBlob(blobs, ref)).length, ref.size);
    await assert.rejects(
      readPlatformBackupBlob(blobs, { ...refs[0], key: randomUUID() }),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readPlatformBackupBlob(blobs, { ...refs[0], sha256: "0".repeat(64) }),
    );
    await assert.rejects(
      readPlatformBackupBlob(blobs, { ...refs[0], size: refs[0].size + 1 }),
      /SIZE_MISMATCH/,
    );
    // A concurrent committed producer belongs only to a later database snapshot.
    for (let i = 0; i < lateIds.length; i++)
      await operator.query(
        "INSERT INTO platform_files(organization_id,id,resource_type,resource_id,owner_id,name,mime,size,sha256,state,blob_key) SELECT organization_id,$1,resource_type,resource_id,owner_id,name,mime,size,sha256,$2,blob_key FROM platform_files LIMIT 1",
        [lateIds[i], i === 0 ? "STAGED" : "REJECTED"],
      );
    assert.ok(
      !(await listPlatformBackupReferences(snapshot)).some((r) =>
        lateIds.includes(r.id),
      ),
    );
    await snapshot.query("ROLLBACK");
    await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const next = await listPlatformBackupReferences(snapshot);
    assert.equal(next.filter((r) => lateIds.includes(r.id)).length, 2);
  } finally {
    await snapshot.query("ROLLBACK");
    await tenant.query("ROLLBACK");
    await operator.query(
      "DELETE FROM platform_files WHERE id=ANY($1::uuid[])",
      [lateIds],
    );
    snapshot.release();
    tenant.release();
    await operator.end();
  }
});
test("real local SMTP sink acknowledges DATA; invalid uploads and typed CSV preserve content", async () => {
  let delivered = "";
  const server = createServer((socket) => {
    socket.write("220 local test sink\r\n");
    let buffer = "",
      data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            data = false;
            socket.write("250 accepted\r\n");
          } else delivered += line + "\n";
        } else if (line === "DATA") {
          data = true;
          socket.write("354 send data\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
        } else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  try {
    await new LocalSmtpTransport(port).send({
      id: randomUUID(),
      email: "tester@example.test",
      event: "TaskAssigned",
    });
    assert.match(delivered, /Message-ID:/);
    assert.match(delivered, /available in your OrgMap inbox/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.throws(() => inspectUpload("x.png", "image/png", "eA=="));
  assert.throws(() => inspectUpload("x.svg", "image/svg+xml", "eA=="));
  const doc: TransferDocument = {
    schemaVersion: "orgmap-transfer-v1",
    resourceType: "test-resource",
    kind: "RESOURCES",
    records: [{ title: 'Line\n"quoted", value', n: 3 }],
    manifest: { coverage: "full", estimated: false, recordCount: 1 },
  };
  assert.deepEqual(decodeTransfer(encodeTransfer(doc, "CSV"), "CSV"), doc);
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { buildApp } from "../../server/src/app.js";
import { createRuntime } from "../../server/src/runtime.js";
import { pool } from "../../server/src/db.js";
import {
  createWorkModule,
  createWorkResourceAdapters,
  createWorkLegacyCommentSource,
  createWorkGuestAccessAdapter,
} from "../../server/modules/work/index.js";
import {
  ResourceRegistry,
  createExportJobPort,
  createPlatform,
  PlatformWorker,
  FilesystemBlobStore,
  createCommentThreadPort,
  createPlatformGuestAccessAdapter,
} from "../../server/modules/platform/index.js";

test("platform real Work composition exports two-sheet artifacts and shares canonical rich comments with compatibility replay", async () => {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/orgmap_platform_[a-f0-9]+$/,
  );
  const root = await mkdtemp(join(tmpdir(), "platform-work-tabular-"));
  const core = createRuntime();
  const mapping = {
    resolveOriginalResource: async (
      _ctx: import("../../server/src/runtime.js").Ctx,
      ref: { type: string; id: string },
    ) =>
      ["task", "project"].includes(ref.type)
        ? { context: "work", kind: ref.type, id: ref.id }
        : undefined,
  };
  const bindGuest = (runtime: ReturnType<typeof createRuntime>) => {
    runtime.registerOrganizationSettings(async (ctx) => ({
      version: 1,
      settings: {
        name: ctx.org.name,
        locale: ctx.org.locale,
        timezone: ctx.org.time_zone,
        modules: { structure: true, work: true },
      },
    }));
    runtime.registerGuestAccessAdapter(createWorkGuestAccessAdapter(runtime));
    runtime.registerGuestAccessAdapter(
      createPlatformGuestAccessAdapter(runtime, mapping),
    );
  };
  bindGuest(core);
  const registry = new ResourceRegistry({
      guestAccess: async (ctx, ref, action) => {
        const original = await mapping.resolveOriginalResource(ctx, ref);
        if (!original) return false;
        try {
          await core.requireGuestResource(ctx, original, action);
          return true;
        } catch {
          return false;
        }
      },
    }),
    blobs = new FilesystemBlobStore(root);
  for (const [type, adapter] of Object.entries(
    createWorkResourceAdapters({ guest: core }),
  ))
    registry.registerResourceAdapter(type, adapter);
  const comments = createCommentThreadPort({
    core,
    registry,
    legacyTaskComments: createWorkLegacyCommentSource({ guest: core }),
  });
  // Fixture-only composition opt-in; does not modify root feature flags.
  const app = await buildApp([
    foundationDefaultAdmissionPolicy,
    async (_app, httpCore) => {
      bindGuest(httpCore);
    },
    createWorkModule({
      exportJobs: createExportJobPort(registry),
      tabularExports: true,
      comments,
      guest: core,
    }),
    createPlatform({ registry, blobs, comments }),
  ]);
  const worker = new PlatformWorker({
    registry,
    blobs,
    withContext: (org, member, fn) => core.withWorkerContext(org, member, fn),
  });
  let session: { cookie: string; csrf: string } | undefined;
  const request = async (
    method: string,
    path: string,
    payload?: any,
    extra: Record<string, string> = {},
  ) => {
    const r = await app.inject({
      method: method as any,
      url: "/api/v1" + path,
      payload,
      headers: {
        origin: "http://localhost:5173",
        "idempotency-key": randomUUID(),
        ...extra,
        ...(session
          ? { cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
      },
    });
    assert.ok(r.statusCode >= 200 && r.statusCode < 300, r.body);
    return { r, data: r.json().data };
  };
  try {
    const registration = await request("POST", "/auth/register", {
      email: randomUUID() + "@example.test",
      password: "platform-work-tabular-123",
      displayName: "Tabular fixture",
    });
    session = {
      cookie:
        registration.r.cookies[0].name + "=" + registration.r.cookies[0].value,
      csrf: registration.data.csrfToken,
    };
    const organization = (
      await request("POST", "/organizations", {
        name: "Platform real Work workbook fixture",
      })
    ).data;
    const org = organization.organization.id,
      member = organization.membership.id,
      base = "/organizations/" + org;
    const project = (
      await request("POST", base + "/work/projects", { title: "Projeto Ç" })
    ).data.project;
    await request("POST", base + "/work/projects", { title: "Projeto vazio" });
    const task = (
      await request("POST", base + "/work/tasks", {
        title: "Ação ü =1+1",
        projectId: project.id,
      })
    ).data.task;
    const queued = (
      await request("POST", base + "/work/exports", {
        kind: "TASKS",
        format: "XLSX",
      })
    ).data;
    assert.equal(queued.selection.projects, 2);
    assert.equal(await worker.runJob(org, member), true);
    const job = (await request("GET", base + "/platform/jobs/" + queued.job.id))
      .data;
    assert.equal(job.state, "COMPLETED", JSON.stringify(job));
    const artifact = (
      await request(
        "GET",
        base + "/platform/artifacts/" + job.result.artifactId + "/download",
      )
    ).data;
    const bytes = Buffer.from(artifact.base64, "base64"),
      source = bytes.toString();
    assert.ok(source.includes('name="Tarefas"'));
    assert.ok(source.includes('name="Projetos"'));
    assert.ok(source.includes(task.id));
    assert.ok(source.includes("Ação ü =1+1"));
    assert.ok(source.includes("Projeto vazio"));
    assert.ok(!source.includes("record_json"));
    const threadPath =
      base + "/platform/resources/task/" + task.id + "/comments";
    const rich = {
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
                text: "Discussão ü 漢字",
                marks: [{ type: "bold" }],
              },
            ],
          },
        ],
      },
    };
    const createdComment = (
      await request("POST", threadPath, { contentRich: rich })
    ).data;
    assert.equal(createdComment.source, "PLATFORM");
    const beforeLegacy = (await request("GET", base + "/work/tasks/" + task.id))
      .data;
    assert.equal(beforeLegacy.comments.length, 1);
    assert.equal(beforeLegacy.comments[0].id, createdComment.id);
    assert.deepEqual(
      beforeLegacy.comments[0].contentRich,
      createdComment.contentRich,
    );
    const replayKey = randomUUID(),
      legacyBody = { content: "Compatibilidade plain literal **texto**" };
    const legacyHeaders = {
      "if-match": '"' + beforeLegacy.task.version + '"',
      "idempotency-key": replayKey,
    };
    const legacy = (
      await request(
        "POST",
        base + "/work/tasks/" + task.id + "/comments",
        legacyBody,
        legacyHeaders,
      )
    ).data.task;
    assert.equal(legacy.version, beforeLegacy.task.version + 1);
    const replay = (
      await request(
        "POST",
        base + "/work/tasks/" + task.id + "/comments",
        legacyBody,
        legacyHeaders,
      )
    ).data.task;
    assert.equal(replay.version, legacy.version);
    const listed = (await request("GET", threadPath)).data.items;
    assert.equal(listed.length, 2);
    assert.ok(listed.every((c: any) => c.source === "PLATFORM"));
    assert.equal(listed[1].content, legacyBody.content);
    const finalDetail = (await request("GET", base + "/work/tasks/" + task.id))
      .data;
    assert.equal(finalDetail.commentsComplete, true);
    assert.equal(finalDetail.comments.length, 2);
    assert.deepEqual(
      finalDetail.comments.map((c: any) => c.id),
      listed.map((c: any) => c.id),
    );
    await core.withWorkerContext(org, member, async (ctx) => {
      assert.equal(
        (
          await ctx.c.query(
            "SELECT count(*)::int AS n FROM platform_comments WHERE organization_id=$1 AND resource_type='task' AND resource_id=$2",
            [org, task.id],
          )
        ).rows[0].n,
        2,
      );
    });
    const ownerSession = session;
    session = undefined;
    const guestRegistration = await request("POST", "/auth/register", {
      email: randomUUID() + "@example.test",
      password: "platform-work-guest-123",
      displayName: "Guest thread fixture",
    });
    const guestSession = {
      cookie:
        guestRegistration.r.cookies[0].name +
        "=" +
        guestRegistration.r.cookies[0].value,
      csrf: guestRegistration.data.csrfToken,
    };
    session = ownerSession;
    const guestMember = (
      await request("POST", base + "/members", {
        accountId: guestRegistration.data.account.id,
        memberType: "GUEST",
        accessPlan: [
          {
            resource: { context: "work", kind: "task", id: task.id },
            actions: ["read"],
          },
        ],
      })
    ).data.membership;
    session = guestSession;
    const guestList = (await request("GET", threadPath)).data;
    assert.equal(guestList.items.length, 2);
    assert.ok(guestList.items.every((c: any) => c.authorId === null));
    const guestDetail = (await request("GET", base + "/work/tasks/" + task.id))
      .data;
    assert.equal(guestDetail.comments.length, 2);
    assert.ok(guestDetail.comments.every((c: any) => c.authorId === null));
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1" + threadPath,
      headers: {
        origin: "http://localhost:5173",
        cookie: guestSession.cookie,
        "x-csrf-token": guestSession.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: { content: "Guest must not write" },
    });
    assert.ok([403, 404].includes(denied.statusCode));
    session = ownerSession;
    const grants = (
      await request(
        "GET",
        base + "/members/" + guestMember.id + "/access-grants",
      )
    ).data.items;
    await request(
      "POST",
      base +
        "/members/" +
        guestMember.id +
        "/access-grants/" +
        grants[0].id +
        "/revoke",
      {},
      { "if-match": '"' + grants[0].version + '"' },
    );
    for (const path of [threadPath, base + "/work/tasks/" + task.id]) {
      const revoked = await app.inject({
        method: "GET",
        url: "/api/v1" + path,
        headers: { cookie: guestSession.cookie },
      });
      assert.ok([403, 404].includes(revoked.statusCode), revoked.body);
    }
    await core.withWorkerContext(org, member, async (ctx) => {
      const authors = (
        await ctx.c.query(
          "SELECT author_id FROM platform_comments WHERE organization_id=$1 AND resource_id=$2",
          [org, task.id],
        )
      ).rows;
      assert.ok(authors.every((row) => row.author_id === member));
    });
    if (process.env.PLATFORM_WORK_TABULAR_PROOF_PATH)
      await writeFile(process.env.PLATFORM_WORK_TABULAR_PROOF_PATH, bytes);
  } finally {
    await app.close();
    await pool.end();
    await rm(root, { recursive: true, force: true });
  }
});

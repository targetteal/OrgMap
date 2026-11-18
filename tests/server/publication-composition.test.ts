import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, HTTPMethods } from "fastify";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import {
  createOrgMapIntegration,
  createPlatformWorker,
} from "../../server/integration/index.js";
import { fromPlainText } from "../../packages/content/index.js";
const origin = "http://integration.localhost:5273";
process.env.ALLOWED_ORIGINS = origin;
if (
  !/^\/orgmap_(?:test|integration)_[a-z0-9]+$/.test(
    new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname,
  )
)
  throw Error("EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED");
after(async () => pool.end());
type Session = { cookie: string; csrf: string; accountId: string };
async function account(app: FastifyInstance, label: string): Promise<Session> {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin },
    payload: {
      email: `publication-${randomUUID()}@example.test`,
      password: `Synthetic-${randomUUID()}`,
      displayName: label,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const c = r.cookies.find((x) => x.name === "orgmap_session");
  assert.ok(c);
  return {
    cookie: `orgmap_session=${c.value}`,
    csrf: r.json().data.csrfToken,
    accountId: r.json().data.account.id,
  };
}
async function request(
  app: FastifyInstance,
  u: Session,
  method: HTTPMethods,
  url: string,
  payload?: object,
  version?: number,
  key = randomUUID(),
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      origin,
      cookie: u.cookie,
      "x-csrf-token": u.csrf,
      "idempotency-key": key,
      ...(version === undefined ? {} : { "if-match": `"${version}"` }),
    },
  });
}
function ok(
  r: { statusCode: number; body: string; json: () => any },
  status: number,
) {
  assert.equal(r.statusCode, status, r.body);
  return r.json().data;
}
test("publications real source, job, ZIP and current authorization compose end to end", async () => {
  const blobs = await mkdtemp(
      join(tmpdir(), "orgmap-publication-composition-"),
    ),
    app = await buildApp([createOrgMapIntegration({ blobsDirectory: blobs })], {
      migrationMaxPrefix: 999,
    });
  try {
    await app.ready();
    const owner = await account(app, "Owner"),
      peer = await account(app, "Colega"),
      guest = await account(app, "Guest"),
      foreign = await account(app, "Outro tenant");
    const org = ok(
        await request(app, owner, "POST", "/api/v1/organizations", {
          name: "Publicações A",
        }),
        201,
      ),
      other = ok(
        await request(app, foreign, "POST", "/api/v1/organizations", {
          name: "Publicações B",
        }),
        201,
      ),
      base = `/api/v1/organizations/${org.organization.id}`,
      otherBase = `/api/v1/organizations/${other.organization.id}`,
      admin = base + "/administration",
      feed = base + "/publications";
    const peerMember = ok(
      await request(app, owner, "POST", base + "/members", {
        accountId: peer.accountId,
      }),
      201,
    ).membership;
    const guestMember = ok(
      await request(app, owner, "POST", base + "/members", {
        accountId: guest.accountId,
        memberType: "GUEST",
        accessPlan: [],
      }),
      201,
    ).membership;
    const group = ok(
      await request(app, owner, "POST", admin + "/groups", {
        value: {
          name: "Visível",
          parentId: null,
          memberIds: [org.membership.id, guestMember.id],
        },
      }),
      201,
    );
    const hidden = ok(
      await request(app, owner, "POST", admin + "/groups", {
        value: {
          name: "Grupo privado secreto",
          parentId: null,
          memberIds: [peerMember.id],
        },
      }),
      201,
    );
    const draft = ok(
      await request(app, owner, "POST", feed + `/groups/${group.id}/posts`, {
        title: "Versão antiga",
        bodyRichDocument: fromPlainText("Ação 🌿"),
      }),
      200,
    ).post;
    const published = ok(
      await request(
        app,
        owner,
        "POST",
        feed + `/posts/${draft.id}/publish`,
        {},
        draft.version,
      ),
      200,
    ).post;
    const secret = ok(
      await request(app, peer, "POST", feed + `/groups/${hidden.id}/posts`, {
        title: "Publicação secreta",
        bodyRichDocument: fromPlainText("privado"),
      }),
      200,
    ).post;
    ok(
      await request(
        app,
        peer,
        "POST",
        feed + `/posts/${secret.id}/publish`,
        {},
        secret.version,
      ),
      200,
    );
    assert.equal(
      (await request(app, guest, "GET", feed + `/groups/${group.id}/posts`))
        .statusCode,
      404,
    );
    assert.equal(
      (await request(app, owner, "GET", feed + `/posts/${secret.id}`))
        .statusCode,
      404,
    );
    assert.equal(
      (await request(app, foreign, "GET", feed + `/posts/${draft.id}`))
        .statusCode,
      404,
    );
    const revision = async () =>
      (await request(app, owner, "GET", admin + "/settings")).json().meta
        .authorizationRevision;
    const key = randomUUID(),
      rev = await revision(),
      queued = ok(
        await request(
          app,
          owner,
          "POST",
          admin + "/publication-exports",
          {},
          rev,
          key,
        ),
        200,
      );
    assert.equal(queued.selection.groupCount, 1);
    assert.equal(queued.selection.publicationCount, 1);
    assert.equal(queued.job.state, "PENDING");
    assert.equal(
      ok(
        await request(
          app,
          owner,
          "POST",
          admin + "/publication-exports",
          {},
          rev,
          key,
        ),
        200,
      ).job.id,
      queued.job.id,
    );
    assert.equal(
      (
        await request(
          app,
          peer,
          "POST",
          admin + "/publication-exports",
          {},
          rev,
        )
      ).statusCode,
      403,
    );
    const edited = ok(
      await request(
        app,
        owner,
        "PATCH",
        feed + `/posts/${draft.id}`,
        { title: "Versão nova", bodyRichDocument: fromPlainText("revisado") },
        published.version,
      ),
      200,
    ).post;
    const republished = ok(
      await request(
        app,
        owner,
        "POST",
        feed + `/posts/${draft.id}/publish`,
        {},
        edited.version,
      ),
      200,
    ).post;
    const worker = await createPlatformWorker({ blobsDirectory: blobs });
    assert.equal(
      await worker.runJob(org.organization.id, org.membership.id),
      true,
    );
    const job = ok(
      await request(
        app,
        owner,
        "GET",
        base + `/platform/jobs/${queued.job.id}`,
      ),
      200,
    );
    assert.equal(job.state, "COMPLETED");
    assert.equal(
      (
        await request(
          app,
          peer,
          "GET",
          base + `/platform/jobs/${queued.job.id}`,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          app,
          guest,
          "GET",
          base + `/platform/jobs/${queued.job.id}`,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          app,
          foreign,
          "GET",
          otherBase + `/platform/jobs/${queued.job.id}`,
        )
      ).statusCode,
      404,
    );
    const path = base + `/platform/artifacts/${job.result.artifactId}/download`,
      artifact = ok(await request(app, owner, "GET", path), 200),
      bytes = Buffer.from(artifact.base64, "base64");
    const z = spawnSync(
      "python3",
      [
        "-c",
        `import sys,zipfile,io,json,hashlib
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); m=json.loads(z.read("manifest.json")); f=m["files"][0]; b=z.read(f["path"])
print(json.dumps({"names":z.namelist(),"manifest":m,"group":json.loads(b),"sha":hashlib.sha256(b).hexdigest(),"size":len(b)}))`,
      ],
      { input: bytes, encoding: "utf8" },
    );
    assert.equal(z.status, 0, z.stderr);
    const contents = JSON.parse(z.stdout);
    assert.deepEqual(contents.names, [
      "manifest.json",
      `groups/${group.id}.json`,
    ]);
    assert.equal(contents.manifest.groupCount, 1);
    assert.equal(contents.manifest.publicationCount, 1);
    assert.equal(contents.manifest.files[0].sha256, contents.sha);
    assert.equal(contents.manifest.files[0].size, contents.size);
    assert.equal(contents.group.posts[0].title, "Versão antiga");
    assert.equal(contents.group.posts[0].bodyPlain, "Ação 🌿");
    assert.ok(!JSON.stringify(contents).includes("secreto"));
    assert.equal((await request(app, peer, "GET", path)).statusCode, 404);
    assert.equal((await request(app, guest, "GET", path)).statusCode, 404);
    assert.equal(
      (
        await request(
          app,
          foreign,
          "GET",
          otherBase + `/platform/artifacts/${job.result.artifactId}/download`,
        )
      ).statusCode,
      404,
    );
    const pending = ok(
      await request(
        app,
        owner,
        "POST",
        admin + "/publication-exports",
        {},
        await revision(),
      ),
      200,
    );
    const changedGroup = ok(
      await request(
        app,
        owner,
        "PUT",
        admin + `/groups/${group.id}`,
        { value: { ...group.value, memberIds: [] } },
        group.version,
      ),
      200,
    );
    assert.equal((await request(app, owner, "GET", path)).statusCode, 404);
    assert.equal(
      (
        await request(
          app,
          owner,
          "GET",
          base + `/platform/jobs/${pending.job.id}`,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await request(
          app,
          owner,
          "POST",
          admin + "/publication-exports",
          {},
          rev,
          key,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      await worker.runJob(org.organization.id, org.membership.id),
      true,
    );
    ok(
      await request(
        app,
        owner,
        "PUT",
        admin + `/groups/${group.id}`,
        { value: group.value },
        changedGroup.version,
      ),
      200,
    );
    const denied = ok(
      await request(
        app,
        owner,
        "GET",
        base + `/platform/jobs/${pending.job.id}`,
      ),
      200,
    );
    assert.equal(denied.state, "FAILED");
    assert.equal(denied.result, null);
    const thirdDraft = ok(
      await request(
        app,
        owner,
        "PATCH",
        feed + `/posts/${draft.id}`,
        {
          title: "Terceira versão",
          bodyRichDocument: fromPlainText("terceira"),
        },
        republished.version,
      ),
      200,
    ).post;
    const third = ok(
      await request(
        app,
        owner,
        "POST",
        feed + `/posts/${draft.id}/publish`,
        {},
        thirdDraft.version,
      ),
      200,
    ).post;
    ok(
      await request(
        app,
        owner,
        "POST",
        base + `/platform/jobs/${pending.job.id}/retry`,
        {},
        denied.version,
      ),
      200,
    );
    assert.equal(
      await worker.runJob(org.organization.id, org.membership.id),
      true,
    );
    const retryJob = ok(
      await request(
        app,
        owner,
        "GET",
        base + `/platform/jobs/${pending.job.id}`,
      ),
      200,
    );
    assert.equal(retryJob.state, "COMPLETED");
    const retryPath =
      base + `/platform/artifacts/${retryJob.result.artifactId}/download`;
    const retryBytes = Buffer.from(
      ok(await request(app, owner, "GET", retryPath), 200).base64,
      "base64",
    );
    const retryRead = spawnSync(
      "python3",
      [
        "-c",
        `import sys,zipfile,io,json
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); m=json.loads(z.read("manifest.json")); print(json.loads(z.read(m["files"][0]["path"]))["posts"][0]["title"])`,
      ],
      { input: retryBytes, encoding: "utf8" },
    );
    assert.equal(retryRead.status, 0, retryRead.stderr);
    assert.equal(retryRead.stdout.trim(), "Versão nova");
    ok(
      await request(
        app,
        owner,
        "POST",
        feed + `/posts/${draft.id}/archive`,
        {},
        third.version,
      ),
      200,
    );
    assert.equal((await request(app, owner, "GET", retryPath)).statusCode, 404);
    assert.equal((await request(app, owner, "GET", path)).statusCode, 404);
  } finally {
    await app.close();
    await rm(blobs, { recursive: true, force: true });
  }
});

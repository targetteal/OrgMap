import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import {
  createAdministration,
  readAdmissionPolicy,
} from "../../server/modules/administration/index.js";
import { registerAdministrationFeed } from "../../server/modules/administration/feed.js";
import {
  projectPublicationDocument,
  type PublicationExportSource,
} from "../../server/modules/administration/feed-source.js";
import { fromPlainText, toPlainText } from "../../packages/content/index.js";
import { fail } from "../../server/src/core.js";
const testDb = process.env.ORGMAP_FEED_TEST_DATABASE;
if (
  !testDb ||
  !/^orgmap_feed_test_[0-9a-f]{32}$/.test(testDb) ||
  new URL(process.env.DATABASE_URL ?? "postgres://localhost/").pathname !==
    "/" + testDb
)
  throw Error("Feed test requires its dedicated runner and database");
let source: PublicationExportSource;
let rejectEnqueue = false,
  lifecycle = true;
const app = await buildApp([
  async (app, core) => {
    core.registerAdmissionPolicyProvider({ resolve: readAdmissionPolicy });
    await createAdministration()(app, core);
    source = registerAdministrationFeed(app, core, {
      gate: async () => {
        if (!lifecycle) fail(403, "ORGANIZATION_CLOSED");
      },
      enqueue: {
        async enqueue(ctx, input) {
          if (rejectEnqueue) {
            await ctx.c.query(
              "INSERT INTO domain_events(organization_id,id,action,resource_id,at) VALUES($1,$2,$3,$4,now())",
              [
                ctx.org.id,
                randomUUID(),
                "FeedEnqueueRollbackProbe",
                input.selectionId,
              ],
            );
            fail(503, "QUEUE_UNAVAILABLE");
          }
          await ctx.c.query("SELECT 1");
          return { id: input.selectionId };
        },
      },
    });
    app.get(
      "/api/v1/organizations/:organizationId/feed-test-selection/:id",
      (r) =>
        core.tenant(r, false, async (ctx) =>
          source.materialize(ctx, { selectionId: (r.params as any).id }),
        ),
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
const call = async (
  method: string,
  path: string,
  payload?: any,
  user?: any,
  ver?: number,
  headers: any = {},
) =>
  await app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:5173",
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(ver === undefined ? {} : { "if-match": `"${ver}"` }),
      ...headers,
    },
    payload,
  });
const data = (r: any) => {
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return r.json().data;
};
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "a-secure-password-123",
    displayName: "Teste",
  });
  const d = data(r);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
    id: d.account.id,
  };
}
test("publication source preserves revisions, direct ACL, rollback and frozen snapshot", async () => {
  const u = await user(),
    guest = await user(),
    outsider = await user(),
    o = data(await call("POST", "/organizations", { name: "Feed" }, u));
  const org = o.organization.id,
    root = "/organizations/" + org,
    admin = root + "/administration",
    feed = root + "/publications";
  const guestMember = data(
    await call(
      "POST",
      root + "/members",
      { accountId: guest.id, memberType: "GUEST", accessPlan: [] },
      u,
    ),
  ).membership.id;
  assert.equal(
    (await call("GET", feed + "/groups", undefined, guest)).statusCode,
    404,
  );
  assert.equal(
    (await call("GET", feed + "/groups", undefined, outsider)).statusCode,
    404,
  );
  const member = o.membership.id;
  const group = data(
    await call(
      "POST",
      admin + "/groups",
      {
        value: {
          name: "Aberto",
          parentId: null,
          memberIds: [member, guestMember],
        },
      },
      u,
    ),
  );
  const hidden = data(
    await call(
      "POST",
      admin + "/groups",
      { value: { name: "Filho", parentId: group.id, memberIds: [] } },
      u,
    ),
  );
  assert.equal(
    (await call("GET", feed + "/groups/" + hidden.id + "/posts", undefined, u))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "GET",
        feed + "/groups/" + group.id + "/posts",
        undefined,
        guest,
      )
    ).statusCode,
    404,
  );
  const created = data(
    await call(
      "POST",
      feed + "/groups/" + group.id + "/posts",
      { title: "Olá", bodyRichDocument: fromPlainText("ação 🌿") },
      u,
    ),
  ).post;
  assert.equal(created.version, 1);
  assert.equal(
    data(
      await call("GET", feed + "/groups/" + group.id + "/posts", undefined, u),
    ).posts.length,
    0,
  );
  const pub = data(
    await call("POST", feed + "/posts/" + created.id + "/publish", {}, u, 1),
  ).post;
  assert.equal(
    data(await call("GET", feed + "/posts/" + created.id, undefined, u)).post
      .title,
    "Olá",
  );
  const idem = randomUUID(),
    patch = { title: "Revisão", bodyRichDocument: fromPlainText("novo") };
  const changed = data(
    await call("PATCH", feed + "/posts/" + created.id, patch, u, pub.version, {
      "idempotency-key": idem,
    }),
  ).post;
  assert.deepEqual(
    data(
      await call(
        "PATCH",
        feed + "/posts/" + created.id,
        patch,
        u,
        pub.version,
        { "idempotency-key": idem },
      ),
    ).post,
    changed,
  );
  assert.equal(
    (await call("PATCH", feed + "/posts/" + created.id, patch, u, pub.version))
      .statusCode,
    409,
  );
  assert.equal(
    data(await call("GET", feed + "/posts/" + created.id, undefined, u)).post
      .title,
    "Olá",
  );
  const rev = (await call("GET", admin + "/settings", undefined, u)).json().meta
    .authorizationRevision;
  rejectEnqueue = true;
  assert.equal(
    (await call("POST", admin + "/publication-exports", {}, u, rev)).statusCode,
    503,
  );
  rejectEnqueue = false;
  const count = await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
    return (
      await c.query(
        "SELECT count(*)::int AS n FROM administration_feed_selections WHERE organization_id=$1",
        [org],
      )
    ).rows[0].n;
  });
  assert.equal(count, 0);
  const events = await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
    return (
      await c.query(
        "SELECT count(*)::int AS n FROM domain_events WHERE organization_id=$1 AND action=$2",
        [org, "FeedEnqueueRollbackProbe"],
      )
    ).rows[0].n;
  });
  assert.equal(events, 0);
  assert.equal(
    (
      await call(
        "POST",
        admin + "/publication-exports",
        { groupIds: [hidden.id] },
        u,
        rev,
      )
    ).statusCode,
    404,
  );
  const exportKey = randomUUID();
  const exportResult = data(
    await call("POST", admin + "/publication-exports", {}, u, rev, {
      "idempotency-key": exportKey,
    }),
  );
  assert.equal(exportResult.selection.publicationCount, 1);
  const sel = exportResult.selection.selectionId;
  assert.equal(
    data(await call("GET", root + "/feed-test-selection/" + sel, undefined, u))
      .groups[0].posts[0].title,
    "Olá",
  );
  data(
    await call(
      "PUT",
      admin + "/groups/" + group.id,
      { value: { ...group.value, memberIds: [] } },
      u,
      group.version,
    ),
  );
  assert.equal(
    (await call("GET", root + "/feed-test-selection/" + sel, undefined, u))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call("POST", admin + "/publication-exports", {}, u, rev, {
        "idempotency-key": exportKey,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        feed + "/posts/" + created.id,
        patch,
        u,
        pub.version,
        { "idempotency-key": idem },
      )
    ).statusCode,
    404,
  );
  data(
    await call(
      "PUT",
      admin + "/groups/" + group.id,
      { value: group.value },
      u,
      group.version + 1,
    ),
  );
  const next = data(
    await call(
      "POST",
      feed + "/posts/" + created.id + "/publish",
      {},
      u,
      changed.version,
    ),
  ).post;
  assert.equal(
    data(await call("GET", root + "/feed-test-selection/" + sel, undefined, u))
      .groups[0].posts[0].title,
    "Olá",
  );
  data(
    await call(
      "POST",
      feed + "/posts/" + created.id + "/archive",
      {},
      u,
      next.version,
    ),
  );
  assert.equal(
    (await call("GET", root + "/feed-test-selection/" + sel, undefined, u))
      .statusCode,
    403,
  );
  lifecycle = false;
  assert.equal(
    (await call("GET", feed + "/groups", undefined, u)).statusCode,
    403,
  );
  lifecycle = true;
});
test("projection removes recognizable attachment links before plain text", () => {
  const doc = fromPlainText("ação");
  (doc.doc.content[0] as any).content.push({
    type: "text",
    text: "documento",
    marks: [
      {
        type: "link",
        attrs: { href: "https://example.test/files/123?token=secret" },
      },
    ],
  });
  const p = projectPublicationDocument(doc);
  assert.equal(p.omittedAttachmentCount, 1);
  assert.equal(toPlainText(p.bodyRichDocument), "ação[Anexo omitido]");
  assert.ok(!JSON.stringify(p).includes("secret"));
});

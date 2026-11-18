import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { registerContext } from "../../server/modules/structure/plugin.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import {
  viewConfig,
  initialView,
} from "../../server/modules/structure/domain.js";
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    core.registerFoundationStructure(createStructurePorts(core));
    await registerContext(app, core);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  payload?: any,
  u?: User,
  version?: number,
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...(version !== undefined ? { "if-match": '"' + version + '"' } : {}),
    },
  });
}
function data(r: any, status = 200) {
  assert.equal(r.statusCode, status, r.body);
  return r.json().data;
}
async function user() {
  const r = await call("POST", "/auth/register", {
      email: randomUUID() + "@example.test",
      password: "structure-view-test-password",
      displayName: "View tester",
    }),
    d = data(r, 201);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
    id: d.account.id,
  };
}
const presentation = {
  quick: "my-roles",
  highlight: "vacant",
  labels: false,
  avatars: true,
  minimap: false,
};
test("structure view contract preserves PACK and strictly validates optional presentation", () => {
  assert.equal(
    viewConfig({ ...initialView, view: "PACK", presentation }).view,
    "PACK",
  );
  assert.deepEqual(viewConfig(initialView), initialView);
  for (const p of [
    null,
    [],
    { ...presentation, quick: "admin" },
    { ...presentation, highlight: "all" },
    { ...presentation, labels: "false" },
    { ...presentation, avatars: 0 },
    { ...presentation, authority: "OWNER" },
  ])
    assert.throws(() => viewConfig({ ...initialView, presentation: p }));
  assert.throws(() => viewConfig({ ...initialView, view: "pack" }));
});
test("PG private views: persisted PACK/presentation, GET/list, If-Match DELETE/update, tenant/ref isolation and current filter validation", async () => {
  const a = await user(),
    b = await user(),
    m = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Aurora saved views" }, a),
      201,
    ),
    B = data(
      await call(
        "POST",
        "/organizations",
        { name: "Horizonte saved views" },
        b,
      ),
      201,
    );
  const p = "/organizations/" + A.organization.id,
    q = "/organizations/" + B.organization.id,
    base = p + "/structure-advanced";
  const mid = data(
    await call("POST", p + "/members", { accountId: m.id }, a),
    201,
  ).membership.id;
  const rootA = data(
      await call("GET", p + "/bootstrap", undefined, a),
    ).rootCircleId,
    rootB = data(
      await call("GET", q + "/bootstrap", undefined, b),
    ).rootCircleId;
  const empty = data(await call("GET", base + "/views", undefined, a));
  assert.equal(empty.items.length, 0);
  assert.ok(empty.contract.viewModes.includes("PACK"));
  const config = {
    ...initialView,
    view: "PACK",
    query: "",
    rootId: rootA,
    memberId: mid,
    presentation,
  };
  const v = data(
    await call("POST", base + "/views", { name: "My packed view", config }, m),
    201,
  );
  assert.equal(v.version, 1);
  assert.deepEqual(v.config, config);
  assert.deepEqual(
    data(await call("GET", base + "/views/" + v.id, undefined, m)).config,
    config,
  );
  assert.equal(
    data(await call("GET", base + "/graph?viewId=" + v.id, undefined, m)).view,
    "PACK",
  );
  assert.deepEqual(
    data(await call("GET", base + "/graph?viewId=" + v.id, undefined, m))
      .presentation,
    presentation,
  );
  assert.equal(
    data(await call("GET", base + "/views", undefined, a)).items.length,
    0,
  );
  assert.equal(
    (await call("GET", base + "/views/" + v.id, undefined, a)).statusCode,
    404,
  );
  assert.equal(
    (await call("DELETE", base + "/views/" + v.id, undefined, a, 1)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/views/" + v.id,
        { name: "Steal", config },
        a,
        1,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("GET", q + "/structure-advanced/views/" + v.id, undefined, b))
      .statusCode,
    404,
  );
  assert.equal(
    (await call("GET", base + "/views", undefined, b)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/views",
        { name: "Cross circle", config: { ...config, rootId: rootB } },
        m,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/views",
        {
          name: "Cross member",
          config: { ...config, memberId: B.membership?.id ?? randomUUID() },
        },
        m,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        base + "/views",
        {
          name: "Authority",
          config: {
            ...config,
            presentation: { ...presentation, actorId: a.id },
          },
        },
        m,
      )
    ).statusCode,
    400,
  );
  const race = await Promise.all([
    call(
      "PATCH",
      base + "/views/" + v.id,
      { name: "Updated one", config: { ...config, view: "NETWORK" } },
      m,
      1,
    ),
    call(
      "PATCH",
      base + "/views/" + v.id,
      { name: "Updated two", config: { ...config, view: "TREE" } },
      m,
      1,
    ),
  ]);
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    data(await call("GET", base + "/views/" + v.id, undefined, m)).version,
    2,
  );
  assert.equal(
    (await call("DELETE", base + "/views/" + v.id, undefined, m, 1)).statusCode,
    409,
  );
  assert.equal(
    data(await call("DELETE", base + "/views/" + v.id, undefined, m, 2))
      .version,
    3,
  );
  assert.equal(
    data(await call("GET", base + "/views", undefined, m)).items.length,
    0,
  );
  assert.equal(
    (await call("GET", base + "/graph?viewId=" + v.id, undefined, m))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/views/" + v.id,
        { name: "Restore by patch", config },
        m,
        3,
      )
    ).statusCode,
    404,
  );
  const retained = data(
    await call(
      "POST",
      base + "/views",
      { name: "Filter revoked later", config },
      a,
    ),
    201,
  );
  assert.equal(
    (await call("DELETE", base + "/views/" + retained.id, undefined, a))
      .statusCode,
    428,
  );
  const second = data(
    await call(
      "POST",
      base + "/views",
      { name: "Second", config: { ...initialView, view: "DIRECTORY" } },
      a,
    ),
    201,
  );
  const page = data(await call("GET", base + "/views?limit=1", undefined, a));
  assert.equal(page.items.length, 1);
  assert.equal(page.page.hasMore, true);
  assert.equal(
    data(
      await call(
        "GET",
        base + "/views?limit=1&cursor=" + page.page.nextCursor,
        undefined,
        a,
      ),
    ).items.length,
    1,
  );
  assert.equal(
    (await call("GET", base + "/views?limit=101", undefined, a)).statusCode,
    400,
  );
  assert.equal(
    (await call("GET", base + "/views?cursor=" + second.id, undefined, m))
      .statusCode,
    404,
  );
  data(
    await call("PATCH", p + "/members/" + mid, { status: "SUSPENDED" }, a, 1),
  );
  assert.deepEqual(
    data(await call("GET", base + "/views/" + retained.id, undefined, a))
      .config,
    config,
  );
  assert.equal(
    (await call("GET", base + "/graph?viewId=" + retained.id, undefined, a))
      .statusCode,
    422,
  );
  assert.equal(
    (await call("GET", base + "/views", undefined, m)).statusCode,
    404,
  );
  assert.equal((await pool.query("SELECT * FROM structure_views")).rowCount, 0);
});

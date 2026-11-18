import {foundationDefaultAdmissionPolicy} from "../../server/src/admission.js";
import { isDeepStrictEqual } from "node:util";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { createStructureModule } from "../../server/modules/structure/plugin.js";
import {
  validateRichDocument,
  toPlainText,
} from "../../packages/content/index.js";

const app = await buildApp([foundationDefaultAdmissionPolicy,
  async (app, core) => {
    core.registerFoundationStructure(createStructurePorts(core));
    await createStructureModule()(app, core);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
test("Foundation direct circle/role purpose: AST, one version, history, stale, rollback and governed alias", async () => {
  const origin = "http://localhost:5173";
  const registered = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin },
    payload: {
      email: randomUUID() + "@example.test",
      password: "synthetic-purpose-direct-password",
      displayName: "Purpose direct QA",
    },
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const auth = registered.json().data;
  const headers = {
    origin,
    cookie: registered.cookies[0].name + "=" + registered.cookies[0].value,
    "x-csrf-token": auth.csrfToken,
  };
  async function call(
    method: string,
    path: string,
    payload?: object,
    version?: number,
  ) {
    return app.inject({
      method: method as any,
      url: "/api/v1" + path,
      payload,
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        ...(version === undefined ? {} : { "if-match": '"' + version + '"' }),
      },
    });
  }
  function data(response: any, status = 200) {
    assert.equal(response.statusCode, status, response.body);
    return response.json().data;
  }
  const org = data(
    await call("POST", "/organizations", { name: "Direct rich purpose" }),
    201,
  );
  const base = "/organizations/" + org.organization.id,
    root = org.rootCircle.id;
  const rich = validateRichDocument({
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Cuidar 日本語", marks: [{ type: "bold" }] },
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
                  content: [{ type: "text", text: "Ouvir" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const edited = structuredClone(rich);
  (edited.doc.content[0] as any).content[0].text = "Aprender 🌿";
  const circle = data(
    await call("POST", base + "/circles", {
      mode: "DIRECT",
      parentCircleId: root,
      name: "Circle rich",
      purposeRich: rich,
    }),
    201,
  ).circle;
  assert.deepEqual(circle.purposeRich, rich);
  assert.equal(circle.purpose, toPlainText(rich));
  assert.equal(circle.version, 1);
  const role = data(
    await call("POST", base + "/roles", {
      mode: "DIRECT",
      circleId: circle.id,
      name: "Role rich",
      purposeRich: rich,
    }),
    201,
  ).role;
  for (const [route, created] of [
    ["circles", circle],
    ["roles", role],
  ] as const) {
    const path = base + "/" + route + "/" + created.id;
    const updated = data(
      await call("PATCH", path, { mode: "DIRECT", purposeRich: edited }, 1),
    );
    const entity = updated.entity;
    assert.equal(entity.version, 2);
    assert.deepEqual(entity.purposeRich, edited);
    assert.equal(entity.purpose, toPlainText(edited));
    assert.equal(
      (await call("PATCH", path, { mode: "DIRECT", purposeRich: null }, 1))
        .statusCode,
      409,
    );
    const invalid = { ...edited, version: 99 };
    assert.equal(
      (
        await call(
          "PATCH",
          path,
          { mode: "DIRECT", name: "Must roll back", purposeRich: invalid },
          2,
        )
      ).statusCode,
      422,
    );
    const persisted = data(await call("GET", path)).entity;
    assert.equal(persisted.name, created.name);
    assert.equal(persisted.version, 2);
    assert.deepEqual(persisted.purposeRich, edited);
    const renamed = data(
      await call(
        "PATCH",
        path,
        { mode: "DIRECT", name: created.name + " renamed" },
        2,
      ),
    ).entity;
    assert.equal(renamed.version, 3);
    assert.deepEqual(renamed.purposeRich, edited);
    const literal = '<b>literal</b> {"doc":{}}';
    const plain = data(
      await call("PATCH", path, { mode: "DIRECT", purpose: literal }, 3),
    ).entity;
    assert.equal(plain.version, 4);
    assert.equal(plain.purpose, literal);
    assert.equal(plain.purposeRich, null);
    const clear = data(
      await call("PATCH", path, { mode: "DIRECT", purposeRich: null }, 4),
    ).entity;
    assert.equal(clear.version, 5);
    assert.equal(clear.purpose, "");
    assert.equal(clear.purposeRich, null);
    const history = data(
      await call(
        "GET",
        base + "/structure-advanced/entities/" + created.id + "/history",
      ),
    );
    assert.ok(
      history.items.some((h: any) =>
        isDeepStrictEqual(h.afterValue?.purpose_rich, edited),
      ),
    );
  }
  data(
    await call(
      "PUT",
      base + "/structure-advanced/circles/" + circle.id + "/policy",
      { governedFields: ["purpose"] },
      0,
    ),
  );
  assert.equal(
    (
      await call(
        "PATCH",
        base + "/roles/" + role.id,
        { mode: "DIRECT", purposeRich: rich },
        5,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    data(await call("GET", base + "/roles/" + role.id)).entity.version,
    5,
  );
});

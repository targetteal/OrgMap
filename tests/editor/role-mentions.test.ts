import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRoleMentions } from "../../server/content/role-mentions.ts";
import { Failure } from "../../server/src/core.ts";
import type { Ctx } from "../../server/src/runtime.ts";

const org = "11111111-1111-4111-8111-111111111111";
const role = "22222222-2222-4222-8222-222222222222";
const archived = "33333333-3333-4333-8333-333333333333";
const foreign = "44444444-4444-4444-8444-444444444444";
const circle = "55555555-5555-4555-8555-555555555555";
const missing = "66666666-6666-4666-8666-666666666666";
const rich = (...ids: string[]) => ({
  format: "orgmap-richtext",
  version: 1,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: ids.map((roleId) => ({
          type: "roleMention",
          attrs: { roleId, label: "Historical name" },
        })),
      },
    ],
  },
});

function context() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const entities = [
    { id: role, organization_id: org, kind: "ROLE", archived: false },
    { id: archived, organization_id: org, kind: "ROLE", archived: true },
    {
      id: foreign,
      organization_id: "other-org",
      kind: "ROLE",
      archived: false,
    },
    { id: circle, organization_id: org, kind: "CIRCLE", archived: false },
  ];
  const ctx = {
    org: { id: org },
    account: { id: "account" },
    member: {
      organization_id: org,
      account_id: "account",
      member_type: "MEMBER",
      status: "ACTIVE",
    },
    mode: "write",
    c: {
      async query(sql: string, params: unknown[]) {
        calls.push({ sql, params });
        assert.match(sql, /organization_id=\$1/);
        assert.match(sql, /kind='ROLE'/);
        assert.match(sql, /id=ANY\(\$2::uuid\[\]\)/);
        const ids = params[1] as string[];
        return {
          rows: entities
            .filter(
              (entity) =>
                entity.organization_id === params[0] &&
                entity.kind === "ROLE" &&
                ids.includes(entity.id),
            )
            .map(({ id }) => ({ id })),
        };
      },
    },
  } as unknown as Ctx;
  return { ctx, calls };
}
const invalidMention = (error: unknown) =>
  error instanceof Failure &&
  error.status === 422 &&
  error.code === "INVALID_ROLE_MENTION";

test("nested explicit rich content validates deduplicated role identities in the current tenant, including archived references", async () => {
  const { ctx, calls } = context();
  await validateRoleMentions(ctx, {
    payload: {
      changes: [
        { purposeRich: rich(role, archived, role) },
        { responsibilities: [{ id: "item", richText: rich(archived) }] },
      ],
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [org, [role, archived]]);
  assert.doesNotMatch(calls[0].sql, /NOT archived|name/);
});

test("foreign, missing and circle IDs fail identically and structural IDs or literal @ text are not mentions", async () => {
  for (const id of [foreign, missing, circle]) {
    const { ctx, calls } = context();
    await assert.rejects(
      validateRoleMentions(ctx, { richContent: rich(role, id) }),
      invalidMention,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params[0], org);
  }
  const { ctx, calls } = context();
  await validateRoleMentions(ctx, {
    entityId: foreign,
    roleId: foreign,
    content: JSON.stringify(rich(foreign)),
    description: "@Unknown role",
    payload: {
      type: "roleMention",
      attrs: { roleId: foreign, label: "not rich content" },
    },
  });
  assert.equal(calls.length, 0);
});

test("guest, inactive, foreign membership and mismatched account cannot validate identity references", async () => {
  for (const patch of [
    { member_type: "GUEST" },
    { status: "SUSPENDED" },
    { organization_id: "other-org" },
    { account_id: "another-account" },
  ]) {
    const { ctx, calls } = context();
    ctx.member = { ...ctx.member, ...patch };
    await assert.rejects(validateRoleMentions(ctx, rich(role)), invalidMention);
    assert.equal(calls.length, 0);
  }
});

test("malformed rich content fails before querying identities and never gets silently stripped", async () => {
  const { ctx, calls } = context();
  const bad = rich(role);
  (bad.doc.content[0].content[0].attrs as any).href = "javascript:alert(1)";
  await assert.rejects(
    validateRoleMentions(ctx, { richContent: bad }),
    (error) =>
      error instanceof Failure &&
      error.status === 422 &&
      error.code === "INVALID_RICH_DOCUMENT",
  );
  assert.equal(calls.length, 0);
});

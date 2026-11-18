import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import {
  createMfaServices,
  totpAt,
  matchTotpStep,
  encryptMfaSecret,
} from "../../server/src/mfa.js";
const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const operator = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
);
if (
  !/^\/orgmap_mfa_[a-f0-9]{16}$/.test(runtime.pathname) ||
  runtime.pathname !== operator.pathname ||
  runtime.host !== operator.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(runtime.hostname)
)
  throw Error("EXCLUSIVE_MFA_DATABASE_REQUIRED");
const dir = await mkdtemp(join(tmpdir(), "orgmap-mfa-"));
process.env.ORGMAP_MFA_KEY_FILE = join(dir, "mfa.key");
await writeFile(
  process.env.ORGMAP_MFA_KEY_FILE,
  randomBytes(32).toString("hex"),
  { mode: 0o600 },
);
let services: ReturnType<typeof createMfaServices>;
const app = await buildApp([
  async (app, core) => {
    services = createMfaServices(core);
    if (!app.hasRoute({ method: "GET", url: "/api/v1/account/mfa" }))
      await services.registerMfaRoutes(app);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});
const password = "a-secure-password-123";
async function request(
  method: any,
  path: string,
  payload: any,
  user?: any,
  headers: any = {},
) {
  return app.inject({
    method,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...headers,
    },
  });
}
function data(r: any) {
  assert.equal(r.statusCode, 200, r.body);
  return r.json().data;
}
async function user() {
  const r = await request("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    displayName: "MFA test",
    password,
  });
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return {
    id: r.json().data.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: r.json().data.csrfToken,
  };
}
function decode(value: string) {
  let bits = 0,
    acc = 0;
  const bytes = [];
  for (const char of value) {
    acc = (acc << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
test("RFC6238 SHA1 vectors, window and monotonic counter", () => {
  const secret = Buffer.from("12345678901234567890");
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totpAt(secret, Math.floor(seconds / 30), 8), expected);
  const now = new Date(1234567890000),
    step = Math.floor(now.getTime() / 30000);
  assert.equal(matchTotpStep(secret, totpAt(secret, step), now, step), null);
  assert.equal(
    matchTotpStep(secret, totpAt(secret, step + 1), now, step),
    step + 1,
  );
  assert.equal(matchTotpStep(secret, totpAt(secret, step + 2), now, -1), null);
});
test("private key required and ciphertext randomized and bound to account", async () => {
  const seed = randomBytes(20),
    a = randomUUID();
  const first = await encryptMfaSecret(seed, a),
    second = await encryptMfaSecret(seed, a);
  assert.notEqual(first, second);
  assert.ok(!first.includes(seed.toString("hex")));
  await chmod(process.env.ORGMAP_MFA_KEY_FILE!, 0o644);
  assert.equal(await services!.mfaReadiness(), false);
  await assert.rejects(
    encryptMfaSecret(seed, a),
    (e: any) => e.code === "MFA_CONFIGURATION_REQUIRED",
  );
  await chmod(process.env.ORGMAP_MFA_KEY_FILE!, 0o600);
});
test("own enrollment confirms, consumes replay, stamps session, disables without revoking global session", async () => {
  const a = await user(),
    other = await user();
  assert.equal(
    (
      await request(
        "POST",
        "/account/mfa/enrollment/start",
        { currentPassword: "wrong" },
        a,
      )
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/account/mfa/enrollment/start",
        { currentPassword: password, accountId: other.id },
        a,
      )
    ).statusCode,
    400,
  );
  const start = data(
    await request(
      "POST",
      "/account/mfa/enrollment/start",
      { currentPassword: password },
      a,
    ),
  );
  const seed = decode(start.secret),
    step = Math.floor(Date.now() / 30000),
    code = totpAt(seed, step);
  const stored = (
    await pool.query(
      "SELECT encrypted_secret FROM account_mfa_factors WHERE account_id=$1",
      [a.id],
    )
  ).rows[0];
  assert.ok(!JSON.stringify(stored).includes(start.secret));
  assert.equal(
    data(await request("GET", "/account/mfa", undefined, other)).enabled,
    false,
  );
  const confirm = await request(
    "POST",
    "/account/mfa/enrollment/confirm",
    { code },
    a,
  );
  data(confirm);
  assert.equal(confirm.headers["cache-control"], "no-store");
  assert.equal(
    data(await request("GET", "/account/mfa", undefined, a)).enabled,
    true,
  );
  assert.equal(
    (await request("POST", "/account/mfa/enrollment/confirm", { code }, a))
      .statusCode,
    401,
  );
  await assert.rejects(
    transaction(async (c) => {
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [a.id]);
      return services!.verifyOwnTotp(c, a.id, code);
    }),
    (e: any) => e.code === "MFA_VERIFICATION_REQUIRED",
  );
  const sessionsBefore = (
    await pool.query("SELECT count(*) FROM sessions WHERE account_id=$1", [
      a.id,
    ])
  ).rows[0].count;
  await pool.query(
    "UPDATE sessions SET mfa_verified_at=clock_timestamp()-interval '6 minutes' WHERE account_id=$1",
    [a.id],
  );
  assert.equal(
    (
      await request(
        "POST",
        "/account/mfa/disable",
        { currentPassword: password, code },
        a,
      )
    ).statusCode,
    401,
  );
  const freshCode = totpAt(seed, step + 1);
  data(
    await request(
      "POST",
      "/account/mfa/disable",
      { currentPassword: password, code: freshCode },
      a,
    ),
  );
  assert.equal(
    data(await request("GET", "/account/mfa", undefined, a)).enabled,
    false,
  );
  assert.equal(
    (
      await pool.query("SELECT count(*) FROM sessions WHERE account_id=$1", [
        a.id,
      ])
    ).rows[0].count,
    sessionsBefore,
  );
  assert.equal(
    (await request("GET", "/account", undefined, a)).statusCode,
    200,
  );
});

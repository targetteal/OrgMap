import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import {
  ACCOUNT_MEDIA_GC_LOCK,
  createAccountMediaServices,
} from "../../server/src/account-media.js";
import { createLocalAccountMediaProvider } from "../../server/modules/platform/account-image.js";

const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const operator = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
);
if (
  !/^\/orgmap_account_media_[a-f0-9]{16}$/.test(runtime.pathname) ||
  runtime.pathname !== operator.pathname ||
  runtime.host !== operator.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(runtime.hostname)
)
  throw Error("EXCLUSIVE_ACCOUNT_MEDIA_DATABASE_REQUIRED");

const directory = await mkdtemp(join(tmpdir(), "orgmap-account-media-"));
const concrete = createLocalAccountMediaProvider({ directory });
const operatorPool = new pg.Pool({ connectionString: operator.href });
let failRemove = false;
let decoderBarrier: (() => Promise<void>) | undefined;
const removed: string[] = [];
let services!: ReturnType<typeof createAccountMediaServices>;
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (_app, core) => {
    services = core;
    core.registerAccountMediaProvider({
      ...concrete,
      decoder: {
        decodeAndNormalize: async (...args) => {
          const image = await concrete.decoder.decodeAndNormalize(...args);
          await decoderBarrier?.();
          return image;
        },
      },
      store: {
        ...concrete.store,
        // Failure injection wraps the real private filesystem store.
        remove: async (key) => {
          if (failRemove) throw Error("INJECTED_REMOVE_FAILURE");
          await concrete.store.remove(key);
          removed.push(key);
        },
      },
    });
  },
]);
const unavailable = await buildApp();
const address = await app.listen({ host: "127.0.0.1", port: 0 });
const unavailableAddress = await unavailable.listen({
  host: "127.0.0.1",
  port: 0,
});
after(async () => {
  await app.close();
  await unavailable.close();
  await operatorPool.end();
  await pool.end();
  await rm(directory, { recursive: true, force: true });
});

type User = { id: string; cookie: string; csrf: string };
async function call(
  method: string,
  path: string,
  payload?: any,
  user?: User,
  extra: Record<string, string> = {},
  origin = address,
) {
  const response = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...extra,
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  const rawPayload = Buffer.from(await response.arrayBuffer()),
    body = rawPayload.toString("utf8");
  return {
    statusCode: response.status,
    headers: response.headers,
    rawPayload,
    body,
    cookies: response.headers.getSetCookie(),
    json: () => JSON.parse(body),
  };
}
function data(response: Awaited<ReturnType<typeof call>>) {
  assert.ok([200, 201].includes(response.statusCode), response.body);
  return response.json().data;
}
async function user(origin = address): Promise<User> {
  const response = await call(
    "POST",
    "/auth/register",
    {
      email: randomUUID() + "@example.test",
      displayName: "Account media test",
      password: "a-secure-password-123",
    },
    undefined,
    {},
    origin,
  );
  const result = data(response);
  return {
    id: result.account.id,
    cookie: response.cookies[0].split(";")[0],
    csrf: result.csrfToken,
  };
}
const payload = (bytes: Uint8Array, crop?: any) => ({
  base64: Buffer.from(bytes).toString("base64"),
  ...(crop === undefined ? {} : { crop }),
});
const match = (v: number) => ({ "if-match": `"${v}"` });
async function ref(account: User, kind = "PHOTO") {
  return (
    await pool.query(
      "SELECT * FROM account_media WHERE account_id=$1 AND kind=$2",
      [account.id, kind],
    )
  ).rows[0];
}
function crc32(bytes: Buffer) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type: string, bytes: Buffer) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([size, name, bytes, checksum]);
}
/** True PNG fixtures; grayscale keeps the over-24MP fixture's test memory small. */
function png(width: number, height: number, noisy = false, gray = false) {
  const channels = gray ? 1 : 4,
    stride = width * channels + 1;
  const pixels = noisy
    ? randomBytes(stride * height)
    : Buffer.alloc(stride * height, 120);
  for (let y = 0; y < height; y++) pixels[y * stride] = 0;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = gray ? 0 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlKKKK+vPlQooooA//2Q==",
  "base64",
);
const webp = Buffer.from(
  "UklGRkQAAABXRUJQVlA4IDgAAAAwAwCdASogABAAPm0skUWkIqGYBABABsSgC1FoB+AACEUAAP7vmsf/M0THMfyZ//KVeCxu0+8gAA==",
  "base64",
);
const animatedWebp = Buffer.from(
  "UklGRsoAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAMAAAMAADIAAAJWUDggMgAAADABAJ0BKgQABAABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRkwAAAAAAAAAAAADAAADAAAyAAAAVlA4IDQAAAA0AQCdASoEAAQAAAAmJaAAA3AA/ukiH//3nz//ufP/+58/6M///yn7//I4//8jj/5QIAAA",
  "base64",
);
function orientedJpeg() {
  const exif = Buffer.from(
    "45786966000049492a0008000000010012010300010000000600000000000000",
    "hex",
  );
  const length = Buffer.alloc(2);
  length.writeUInt16BE(exif.length + 2);
  const comment = Buffer.from("LF11_PRIVATE_METADATA"),
    commentLength = Buffer.alloc(2);
  commentLength.writeUInt16BE(comment.length + 2);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    Buffer.from([255, 225]),
    length,
    exif,
    Buffer.from([255, 254]),
    commentLength,
    comment,
    jpeg.subarray(2),
  ]);
}

test("provider absence is explicit; self auth, CSRF, body identity and preconditions are enforced", async () => {
  const a = await user();
  const summary = data(
    await call("GET", "/account/media", undefined, a, {}, unavailableAddress),
  );
  assert.equal(summary.ready, false);
  assert.equal(summary.photo.version, 0);
  assert.equal(
    (
      await call(
        "POST",
        "/account/media/photo",
        payload(png(2, 2)),
        a,
        match(0),
        unavailableAddress,
      )
    ).statusCode,
    503,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/account/media/photo",
        undefined,
        a,
        {},
        unavailableAddress,
      )
    ).statusCode,
    503,
  );
  assert.equal((await call("GET", "/account/media")).statusCode, 401);
  assert.equal(
    (
      await call("POST", "/account/media/photo", payload(png(2, 2)), a, {
        ...match(0),
        "x-csrf-token": "wrong",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/account/media/photo",
        { ...payload(png(2, 2)), accountId: randomUUID() },
        a,
        match(0),
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await call("POST", "/account/media/photo", payload(png(2, 2)), a))
      .statusCode,
    428,
  );
  assert.equal(
    (
      await call("POST", "/account/media/photo", payload(png(2, 2)), a, {
        ...match(0),
        "idempotency-key": "",
      })
    ).statusCode,
    428,
  );
});

test("real PNG/JPEG/WebP decode, orientation/metadata removal, aspect ratio, crop and HTTP body limit", async () => {
  const a = await user();
  for (const [input, expected] of [
    [png(800, 400), [512, 256]],
    [jpeg, [32, 16]],
    [webp, [32, 16]],
    [orientedJpeg(), [16, 32]],
  ] as const) {
    const before = (await ref(a))?.version ?? 0;
    const result = data(
      await call(
        "POST",
        "/account/media/photo",
        payload(input),
        a,
        match(before),
      ),
    ).media;
    assert.equal(result.mime, "image/png");
    assert.deepEqual([result.width, result.height], expected);
    const stored = await ref(a),
      raw = await call("GET", "/account/media/photo", undefined, a);
    assert.equal(raw.statusCode, 200);
    assert.match(raw.headers.get("cache-control")!, /no-store/);
    assert.equal(raw.headers.get("x-content-type-options"), "nosniff");
    assert.equal(raw.headers.get("content-type"), "image/png");
    assert.ok(!raw.rawPayload.includes(Buffer.from("LF11_PRIVATE_METADATA")));
    assert.equal(raw.rawPayload.length, stored.size);
    assert.ok(!JSON.stringify(result).includes(stored.blob_key));
    assert.ok(!JSON.stringify(result).includes(a.id));
  }
  const noisy = png(180, 180, true);
  assert.ok(noisy.length > 65_536);
  const version = (await ref(a)).version;
  assert.equal(
    (
      await call(
        "POST",
        "/account/media/photo",
        payload(noisy),
        a,
        match(version),
      )
    ).statusCode,
    200,
  );
  const cover = data(
    await call(
      "POST",
      "/account/media/cover",
      payload(png(1600, 800)),
      a,
      match(0),
    ),
  ).media;
  assert.deepEqual([cover.width, cover.height], [960, 480]);
  const crop = data(
    await call(
      "POST",
      "/account/media/cover",
      payload(png(100, 50), { x: 5, y: 5, width: 20, height: 30 }),
      a,
      match(cover.version),
    ),
  ).media;
  assert.deepEqual([crop.width, crop.height], [20, 30]);
  const orientedCrop = data(
    await call(
      "POST",
      "/account/media/cover",
      payload(orientedJpeg(), { x: 0, y: 16, width: 16, height: 16 }),
      a,
      match(crop.version),
    ),
  ).media;
  assert.deepEqual([orientedCrop.width, orientedCrop.height], [16, 16]);
  assert.equal(
    (
      await call(
        "POST",
        "/account/media/cover",
        payload(orientedJpeg(), { x: 16, y: 0, width: 16, height: 16 }),
        a,
        match(orientedCrop.version),
      )
    ).statusCode,
    422,
  );
  const summary = data(await call("GET", "/account/media", undefined, a));
  assert.equal(summary.ready, true);
  assert.equal(summary.cover.version, orientedCrop.version);
});

test("opaque, HTML/SVG, malformed raster, animation, bombs and invalid crops never publish", async () => {
  const a = await user(),
    beforeFiles = (await readdir(directory)).length;
  for (const input of [
    Buffer.from("opaque"),
    Buffer.from("<html>photo</html>"),
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    png(4, 4).subarray(0, 30),
    animatedWebp,
  ]) {
    assert.ok(
      (await call("POST", "/account/media/photo", payload(input), a, match(0)))
        .statusCode >= 400,
    );
  }
  assert.equal(
    (
      await call(
        "POST",
        "/account/media/photo",
        payload(png(6000, 4001, false, true)),
        a,
        match(0),
      )
    ).statusCode,
    413,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/account/media/photo",
        payload(Buffer.alloc(2 * 1024 * 1024 + 1)),
        a,
        match(0),
      )
    ).statusCode,
    413,
  );
  for (const crop of [
    { x: 0, y: 0, width: 5, height: 4 },
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 1, height: 1, extra: 1 },
  ])
    assert.ok(
      (
        await call(
          "POST",
          "/account/media/photo",
          payload(png(4, 4), crop),
          a,
          match(0),
        )
      ).statusCode >= 400,
    );
  assert.equal(await ref(a), undefined);
  assert.equal((await readdir(directory)).length, beforeFiles);
});

test("idempotency, current replay, replace/delete tombstone and racing versions preserve epochs", async () => {
  const a = await user(),
    b = await user();
  const epochs = async () =>
    (
      await pool.query(
        "SELECT to_jsonb(a)->>'credential_revision' AS credential,to_jsonb(a)->>'email_revision' AS email,to_jsonb(a)->>'credential_policy_input_revision' AS policy,to_jsonb(a)->>'credential_changed_at' AS changed FROM accounts a WHERE id=$1",
        [a.id],
      )
    ).rows[0];
  const beforeEpochs = await epochs(),
    input = payload(png(32, 16)),
    command = randomUUID();
  const first = data(
    await call("POST", "/account/media/photo", input, a, {
      ...match(0),
      "idempotency-key": command,
    }),
  ).media;
  const firstRef = await ref(a);
  assert.equal(
    (await call("GET", "/account/media/photo", undefined, b)).statusCode,
    404,
  );
  assert.equal(
    (
      await call("POST", "/account/media/photo", payload(png(8, 8)), a, {
        ...match(0),
        "idempotency-key": command,
      })
    ).statusCode,
    409,
  );
  const races = await Promise.all([
    call(
      "POST",
      "/account/media/photo",
      payload(png(20, 10)),
      a,
      match(first.version),
    ),
    call(
      "POST",
      "/account/media/photo",
      payload(png(10, 20)),
      a,
      match(first.version),
    ),
  ]);
  assert.deepEqual(races.map((r) => r.statusCode).sort(), [200, 409]);
  const current = await ref(a);
  assert.equal(current.version, first.version + 1);
  const replay = data(
    await call("POST", "/account/media/photo", input, a, {
      ...match(0),
      "idempotency-key": command,
    }),
  ).media;
  assert.equal(replay.assetId, current.asset_id);
  assert.equal(replay.version, current.version);
  const deleted = data(
    await call("DELETE", "/account/media/photo", {}, a, match(current.version)),
  ).media;
  assert.equal(deleted.state, "DELETED");
  assert.equal(deleted.version, current.version + 1);
  assert.equal(
    (await call("GET", "/account/media/photo", undefined, a)).statusCode,
    404,
  );
  assert.equal(
    (await call("POST", "/account/media/photo", input, a, match(0))).statusCode,
    409,
  );
  const recreated = data(
    await call(
      "POST",
      "/account/media/photo",
      input,
      a,
      match(deleted.version),
    ),
  ).media;
  assert.equal(recreated.version, deleted.version + 1);
  assert.notEqual(recreated.assetId, firstRef.asset_id);
  assert.deepEqual(await epochs(), beforeEpochs);
});

test("SQL rollback preserves live pointer and failed cleanup persists for safe retry", async () => {
  const a = await user(),
    foreign = await user();
  data(
    await call("POST", "/account/media/photo", payload(png(8, 8)), a, match(0)),
  );
  data(
    await call(
      "POST",
      "/account/media/photo",
      payload(png(9, 9)),
      foreign,
      match(0),
    ),
  );
  const original = await ref(a),
    foreignRef = await ref(foreign);
  await operatorPool.query(
    "CREATE TABLE account_media_test_failures(account_id uuid PRIMARY KEY); CREATE FUNCTION account_media_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM account_media_test_failures WHERE account_id=NEW.account_id) THEN RAISE EXCEPTION 'injected media metadata rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER account_media_test_fail BEFORE INSERT ON account_events FOR EACH ROW EXECUTE FUNCTION account_media_test_fail(); GRANT SELECT ON account_media_test_failures TO orgmap_app",
  );
  await operatorPool.query(
    "INSERT INTO account_media_test_failures VALUES($1)",
    [a.id],
  );
  failRemove = true;
  try {
    assert.equal(
      (
        await call(
          "POST",
          "/account/media/photo",
          payload(png(12, 12)),
          a,
          match(1),
        )
      ).statusCode,
      500,
    );
  } finally {
    failRemove = false;
    await operatorPool.query(
      "DROP TRIGGER account_media_test_fail ON account_events; DROP FUNCTION account_media_test_fail(); DROP TABLE account_media_test_failures",
    );
  }
  assert.deepEqual(await ref(a), original);
  const pending = (
    await pool.query(
      "SELECT * FROM account_media_gc WHERE account_id=$1 AND reason='UNPUBLISHED'",
      [a.id],
    )
  ).rows;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attempts, 1);
  assert.notEqual(pending[0].blob_key, original.blob_key);
  assert.notEqual(pending[0].blob_key, foreignRef.blob_key);
  await pool.query(
    "UPDATE account_media_gc SET available_at=clock_timestamp() WHERE id=$1",
    [pending[0].id],
  );
  await services.runAccountMediaGc();
  assert.equal(
    (
      await pool.query("SELECT 1 FROM account_media_gc WHERE id=$1", [
        pending[0].id,
      ])
    ).rowCount,
    0,
  );
  assert.ok(removed.includes(pending[0].blob_key));
  assert.ok(!removed.includes(original.blob_key));
  assert.ok(!removed.includes(foreignRef.blob_key));
  assert.equal(
    (await call("GET", "/account/media/photo", undefined, a)).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/account/media/photo", undefined, foreign)).statusCode,
    200,
  );
});

test("GC protects live refs, held snapshots, namespaces and narrow keys; raw read fails closed after tamper", async () => {
  const a = await user();
  data(
    await call(
      "POST",
      "/account/media/photo",
      payload(png(10, 10)),
      a,
      match(0),
    ),
  );
  const first = await ref(a);
  const client = await pool.connect(),
    second = await pool.connect();
  try {
    await client.query("BEGIN");
    const snapshot = await services.readAccountMediaBackupReferences(client);
    assert.ok(
      snapshot.some(
        (r) =>
          r.accountId === a.id &&
          r.key === first.blob_key &&
          r.owner === "ACCOUNT",
      ),
    );
    await second.query("BEGIN");
    assert.equal(
      (
        await second.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [
          ACCOUNT_MEDIA_GC_LOCK,
        ])
      ).rows[0].acquired,
      false,
    );
    await second.query("ROLLBACK");
    await client.query("COMMIT");
  } finally {
    client.release();
    second.release();
  }
  data(
    await call(
      "POST",
      "/account/media/photo",
      payload(png(11, 11)),
      a,
      match(1),
    ),
  );
  const held = await services.runAccountMediaGc({
    isReferenceHeld: async (r) => r.assetId === first.asset_id,
  });
  assert.ok(held.deferred >= 1);
  assert.ok(!removed.includes(first.blob_key));
  const current = await ref(a);
  const foreignNamespaceJob = randomUUID();
  const foreignNamespaceKey = randomUUID();
  await pool.query(
    "INSERT INTO account_media_gc(id,account_id,kind,storage_namespace,blob_key,sha256,size,reason) VALUES($1,$2,'PHOTO','OTHER_STORE',$3,$4,$5,'UNPUBLISHED')",
    [
      foreignNamespaceJob,
      a.id,
      foreignNamespaceKey,
      current.sha256,
      current.size,
    ],
  );
  await pool.query(
    "INSERT INTO account_media_gc(id,account_id,kind,storage_namespace,blob_key,sha256,size,reason) VALUES($1,$2,'PHOTO',$3,$4,$5,$6,'UNPUBLISHED')",
    [
      current.asset_id,
      a.id,
      current.storage_namespace,
      current.blob_key,
      current.sha256,
      current.size,
    ],
  );
  await services.runAccountMediaGc();
  assert.ok(removed.includes(first.blob_key));
  assert.ok(!removed.includes(current.blob_key));
  assert.ok(!removed.includes(foreignNamespaceKey));
  assert.equal(
    (
      await pool.query("SELECT 1 FROM account_media_gc WHERE id=$1", [
        foreignNamespaceJob,
      ])
    ).rowCount,
    1,
  );
  await writeFile(join(directory, current.blob_key), Buffer.from("tampered"));
  const corrupt = await call("GET", "/account/media/photo", undefined, a);
  assert.equal(corrupt.statusCode, 503);
  assert.ok(!corrupt.body.includes(directory));
});

test("organization member avatar uses current same-org directory visibility and only photo", async () => {
  const owner = await user(),
    member = await user(),
    guest = await user(),
    outsider = await user();
  data(
    await call(
      "POST",
      "/account/media/photo",
      payload(png(14, 7)),
      member,
      match(0),
    ),
  );
  data(
    await call(
      "POST",
      "/account/media/cover",
      payload(png(15, 8)),
      member,
      match(0),
    ),
  );
  const a = data(
    await call("POST", "/organizations", { name: "Media A" }, owner),
  ).organization;
  const b = data(
    await call("POST", "/organizations", { name: "Media B" }, owner),
  ).organization;
  const target = data(
    await call(
      "POST",
      `/organizations/${a.id}/members`,
      { accountId: member.id },
      owner,
    ),
  ).membership;
  const viewer = data(
    await call(
      "POST",
      `/organizations/${a.id}/members`,
      { accountId: guest.id, memberType: "GUEST", accessPlan: [] },
      owner,
    ),
  ).membership;
  const path = `/organizations/${a.id}/members/${target.id}/avatar`;
  assert.equal((await call("GET", path, undefined, owner)).statusCode, 200);
  assert.equal((await call("GET", path, undefined, guest)).statusCode, 404);
  assert.equal((await call("GET", path, undefined, outsider)).statusCode, 404);
  assert.equal(
    (
      await call(
        "GET",
        `/organizations/${b.id}/members/${target.id}/avatar`,
        undefined,
        owner,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("GET", path + "/cover", undefined, owner)).statusCode,
    404,
  );
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      a.id,
    ]);
    await c.query(
      "UPDATE members SET member_type='MEMBER' WHERE organization_id=$1 AND id=$2",
      [a.id, viewer.id],
    );
  });
  assert.equal((await call("GET", path, undefined, guest)).statusCode, 200);
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      a.id,
    ]);
    await c.query(
      "UPDATE members SET member_type='GUEST' WHERE organization_id=$1 AND id=$2",
      [a.id, viewer.id],
    );
  });
  assert.equal((await call("GET", path, undefined, guest)).statusCode, 404);
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      a.id,
    ]);
    await c.query(
      "UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND id=$2",
      [a.id, target.id],
    );
  });
  assert.equal((await call("GET", path, undefined, owner)).statusCode, 404);
});

test(
  "independent staging can progress when ten concurrent Account transactions fill the runtime pool",
  { timeout: 15000 },
  async () => {
    const owners: User[] = [];
    // A second real app issuer keeps fixture registration within each app's
    // existing per-IP budget; all sessions use the same isolated database.
    for (let i = 0; i < 10; i++) owners.push(await user(unavailableAddress));
    let arrived = 0,
      release!: () => void;
    const allDecoded = new Promise<void>((resolve) => {
      release = resolve;
    });
    decoderBarrier = async () => {
      if (++arrived === 10) release();
      await allDecoded;
    };
    try {
      const results = await Promise.all(
        owners.map((owner) =>
          call(
            "POST",
            "/account/media/photo",
            payload(png(6, 6)),
            owner,
            match(0),
          ),
        ),
      );
      assert.equal(arrived, 10);
      for (const response of results)
        assert.equal(response.statusCode, 200, response.body);
    } finally {
      decoderBarrier = undefined;
      release();
    }
  },
);

test("ACTIVE metadata rejects every missing private reference field while DELETED remains a valid tombstone", async () => {
  const a = await user();
  const fields = [
    "asset_id",
    "storage_namespace",
    "blob_key",
    "sha256",
    "size",
    "mime",
    "width",
    "height",
  ];
  const complete: (string | number | null | undefined)[] = [
    randomUUID(),
    concrete.storageNamespace,
    randomUUID(),
    "a".repeat(64),
    1,
    "image/png",
    1,
    1,
  ];
  for (let index = 0; index < fields.length; index++) {
    const values = [...complete];
    values[index] = null;
    await assert.rejects(
      pool.query(
        "INSERT INTO account_media(account_id,kind,version,state,asset_id,storage_namespace,blob_key,sha256,size,mime,width,height) VALUES($1,'PHOTO',1,'ACTIVE',$2,$3,$4,$5,$6,$7,$8,$9)",
        [a.id, ...values],
      ),
      (error: any) => error.code === "23514",
      fields[index],
    );
    assert.equal(await ref(a), undefined);
  }
  const empty = data(await call("GET", "/account/media", undefined, a));
  assert.equal(empty.photo.state, "EMPTY");
  assert.equal(
    (await call("GET", "/account/media/photo", undefined, a)).statusCode,
    404,
  );
  await pool.query(
    "INSERT INTO account_media(account_id,kind,version,state) VALUES($1,'PHOTO',1,'DELETED')",
    [a.id],
  );
  const deleted = data(await call("GET", "/account/media", undefined, a));
  assert.equal(deleted.photo.state, "DELETED");
  assert.equal(deleted.photo.version, 1);
  assert.equal(
    (await call("GET", "/account/media/photo", undefined, a)).statusCode,
    404,
  );
});

import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import pg, { type PoolClient } from "pg";
import { pool, transaction } from "./db.js";
import { body, commandHash, fail, id, key, uuid, version } from "./core.js";
import type { Ctx, TenantOptions } from "./runtime.js";
import type {
  AccountMediaBackupReference,
  AccountMediaKind,
  AccountMediaProvider,
  AccountMediaView,
  PixelRect,
} from "./account-media-contract.js";
export type * from "./account-media-contract.js";

export const ACCOUNT_MEDIA_INPUT_LIMIT = 2 * 1024 * 1024;
export const ACCOUNT_MEDIA_BODY_LIMIT =
  4 * Math.ceil(ACCOUNT_MEDIA_INPUT_LIMIT / 3) + 1024;
/** OPS takes a session lock before BEGIN of its snapshot, through copying bytes. */
export const ACCOUNT_MEDIA_GC_LOCK = 730502;
const OUTPUT_LIMIT = 8 * 1024 * 1024;
export interface AccountMediaCore {
  auth(
    r: FastifyRequest,
    c?: PoolClient,
  ): Promise<{ id: string; [key: string]: any }>;
  envelope(
    r: FastifyRequest,
    data: any,
    org?: any,
    version?: number | null,
  ): any;
  tenant(
    r: FastifyRequest,
    options: boolean | TenantOptions,
    fn: (ctx: Ctx) => Promise<any>,
  ): Promise<any>;
  isGuest(ctx: Ctx): boolean;
  visibleMemberIds(
    ctx: Ctx,
    input: { purpose: "DIRECTORY" },
  ): Promise<readonly string[]>;
}
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const stamp = (value: Date | string | null) =>
  value instanceof Date ? value.toISOString() : value;
const kindPath = (kind: AccountMediaKind) => kind.toLowerCase();

function cropRect(value: unknown): PixelRect | undefined {
  if (value === undefined) return;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "height,width,x,y"
  )
    fail(400, "INVALID_IMAGE_CROP");
  const c = value as PixelRect;
  if (
    ![c.x, c.y, c.width, c.height].every(Number.isSafeInteger) ||
    c.x < 0 ||
    c.y < 0 ||
    c.width <= 0 ||
    c.height <= 0
  )
    fail(400, "INVALID_IMAGE_CROP");
  return c;
}

function imageInput(r: FastifyRequest) {
  const b = body(r, ["base64", "crop"]);
  if (
    typeof b.base64 !== "string" ||
    !b.base64.length ||
    b.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64)
  )
    fail(400, "INVALID_IMAGE_INPUT");
  if (b.base64.length > 4 * Math.ceil(ACCOUNT_MEDIA_INPUT_LIMIT / 3))
    fail(413, "IMAGE_INPUT_TOO_LARGE");
  const bytes = Buffer.from(b.base64, "base64");
  if (!bytes.length || bytes.length > ACCOUNT_MEDIA_INPUT_LIMIT)
    fail(413, "IMAGE_INPUT_TOO_LARGE");
  if (bytes.toString("base64") !== b.base64) fail(400, "INVALID_IMAGE_INPUT");
  return { bytes, crop: cropRect(b.crop) };
}

function safe(row: any, kind: AccountMediaKind): AccountMediaView {
  const active = row?.state === "ACTIVE";
  return {
    kind,
    state: row?.state ?? "EMPTY",
    version: row?.version ?? 0,
    assetId: active ? row.asset_id : null,
    mime: active ? row.mime : null,
    width: active ? row.width : null,
    height: active ? row.height : null,
    size: active ? row.size : null,
    updatedAt: stamp(row?.updated_at ?? null),
    readUrl: active ? `/api/v1/account/media/${kindPath(kind)}` : null,
  };
}

export function createAccountMediaServices(core: AccountMediaCore) {
  let provider:
    (AccountMediaProvider & { storageNamespace: string }) | undefined;
  let stagingPool: pg.Pool | undefined;
  const stagingConnection = () =>
    (stagingPool ??= new pg.Pool({
      connectionString: pool.options.connectionString,
      max: 2,
      connectionTimeoutMillis: 5000,
    }));
  function registerAccountMediaProvider(value: AccountMediaProvider) {
    if (provider) throw Error("Account media provider already registered");
    const namespace = value.storageNamespace ?? "account-media";
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(namespace) ||
      typeof value.store?.put !== "function" ||
      typeof value.store?.read !== "function" ||
      typeof value.store?.remove !== "function" ||
      typeof value.decoder?.decodeAndNormalize !== "function"
    )
      throw Error("Invalid Account media provider");
    provider = { ...value, storageNamespace: namespace };
  }
  function ready() {
    if (!provider) fail(503, "ACCOUNT_MEDIA_UNAVAILABLE");
    return provider!;
  }
  async function row(c: PoolClient, accountId: string, kind: AccountMediaKind) {
    return (
      await c.query(
        "SELECT * FROM account_media WHERE account_id=$1 AND kind=$2",
        [accountId, kind],
      )
    ).rows[0];
  }
  async function readAccountMediaSummary(c: PoolClient, accountId: string) {
    const rows = (
      await c.query(
        "SELECT * FROM account_media WHERE account_id=$1 ORDER BY kind",
        [id(accountId)],
      )
    ).rows;
    return {
      ready: !!provider,
      photo: safe(
        rows.find((r) => r.kind === "PHOTO"),
        "PHOTO",
      ),
      cover: safe(
        rows.find((r) => r.kind === "COVER"),
        "COVER",
      ),
    };
  }
  async function own<T>(
    r: FastifyRequest,
    fn: (c: PoolClient, account: any) => Promise<T>,
  ) {
    const initial = await core.auth(r);
    return transaction(async (c) => {
      const a = (
        await c.query(
          "SELECT id,version FROM accounts WHERE id=$1 FOR UPDATE",
          [initial.id],
        )
      ).rows[0];
      const current = await core.auth(r, c);
      if (!a || current.id !== a.id) fail(401, "UNAUTHENTICATED");
      return fn(c, a);
    });
  }
  async function readBytes(c: PoolClient, media: any) {
    const p = ready();
    if (!media || media.state !== "ACTIVE") fail(404, "RESOURCE_NOT_FOUND");
    if (media.storage_namespace !== p.storageNamespace)
      fail(503, "ACCOUNT_MEDIA_UNAVAILABLE");
    // Prevent GC from removing a retired pointer between SELECT and its byte read.
    await c.query("SELECT pg_advisory_xact_lock($1)", [ACCOUNT_MEDIA_GC_LOCK]);
    let bytes: Uint8Array;
    try {
      bytes = await p.store.read({ key: media.blob_key, sha256: media.sha256 });
    } catch {
      fail(503, "ACCOUNT_MEDIA_READ_FAILED");
    }
    if (bytes!.byteLength !== media.size || sha(bytes!) !== media.sha256)
      fail(503, "ACCOUNT_MEDIA_INTEGRITY_FAILED");
    return {
      bytes: bytes!,
      mime: media.mime as "image/png" | "image/jpeg" | "image/webp",
    };
  }
  async function readAuthorizedMemberAvatar(ctx: Ctx, memberId: string) {
    const target = id(memberId);
    const visible = await core.visibleMemberIds(ctx, { purpose: "DIRECTORY" });
    if (!visible.includes(target)) fail(404, "RESOURCE_NOT_FOUND");
    const member = (
      await ctx.c.query(
        "SELECT account_id FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
        [ctx.org.id, target],
      )
    ).rows[0];
    if (!member) fail(404, "RESOURCE_NOT_FOUND");
    await ctx.c.query("SELECT pg_advisory_xact_lock($1)", [
      ACCOUNT_MEDIA_GC_LOCK,
    ]);
    return readBytes(ctx.c, await row(ctx.c, member.account_id, "PHOTO"));
  }
  async function queue(
    c: Pick<PoolClient, "query">,
    media: any,
    reason: "UNPUBLISHED" | "REPLACED" | "DELETED",
  ) {
    await c.query(
      "INSERT INTO account_media_gc(id,account_id,kind,storage_namespace,blob_key,sha256,size,reason,available_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+($9::integer * interval '1 second')) ON CONFLICT(id) DO NOTHING",
      [
        media.asset_id,
        media.account_id,
        media.kind,
        media.storage_namespace,
        media.blob_key,
        media.sha256,
        media.size,
        reason,
        reason === "UNPUBLISHED" ? 600 : 0,
      ],
    );
  }
  async function collectOne(
    gcId: string,
    held?: (ref: AccountMediaBackupReference) => Promise<boolean>,
    immediate = false,
  ) {
    const p = ready();
    return transaction(async (c) => {
      // A staged replacement cannot be collected while its publishing Account UoW is alive.
      const owner = (
        await c.query("SELECT account_id FROM account_media_gc WHERE id=$1", [
          gcId,
        ])
      ).rows[0];
      if (!owner) return "absent";
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        owner.account_id,
      ]);
      await c.query("SELECT pg_advisory_xact_lock($1)", [
        ACCOUNT_MEDIA_GC_LOCK,
      ]);
      const gc = (
        await c.query(
          "SELECT * FROM account_media_gc WHERE id=$1 AND storage_namespace=$2 AND ($3 OR available_at<=clock_timestamp()) FOR UPDATE",
          [gcId, p.storageNamespace, immediate],
        )
      ).rows[0];
      if (!gc) return "deferred";
      if (
        (
          await c.query(
            "SELECT 1 FROM account_media WHERE storage_namespace=$1 AND blob_key=$2 AND state='ACTIVE'",
            [gc.storage_namespace, gc.blob_key],
          )
        ).rowCount
      )
        return "live";
      const ref: AccountMediaBackupReference = {
        owner: "ACCOUNT",
        accountId: gc.account_id,
        storageNamespace: gc.storage_namespace,
        kind: gc.kind,
        assetId: gc.id,
        key: gc.blob_key,
        sha256: gc.sha256,
        size: gc.size,
      };
      if (held && (await held(ref))) return "held";
      try {
        await p.store.remove(gc.blob_key);
      } catch {
        await c.query(
          "UPDATE account_media_gc SET attempts=attempts+1,last_error='REMOVE_FAILED',available_at=clock_timestamp()+interval '1 minute' WHERE id=$1",
          [gc.id],
        );
        return "failed";
      }
      await c.query("DELETE FROM account_media_gc WHERE id=$1", [gc.id]);
      return "removed";
    });
  }
  async function runAccountMediaGc(
    options: {
      limit?: number;
      isReferenceHeld?: (ref: AccountMediaBackupReference) => Promise<boolean>;
    } = {},
  ) {
    if (!provider) return { ready: false, removed: 0, deferred: 0, failed: 0 };
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw Error("Invalid Account media GC limit");
    const jobs = (
      await pool.query(
        "SELECT id FROM account_media_gc WHERE storage_namespace=$1 AND available_at<=clock_timestamp() ORDER BY available_at,id LIMIT $2",
        [provider.storageNamespace, limit],
      )
    ).rows;
    const result = { ready: true, removed: 0, deferred: 0, failed: 0 };
    for (const job of jobs) {
      const state = await collectOne(job.id, options.isReferenceHeld);
      if (state === "removed") result.removed++;
      else if (state === "failed") result.failed++;
      else result.deferred++;
    }
    return result;
  }
  async function readAccountMediaBackupReferences(
    c: PoolClient,
  ): Promise<AccountMediaBackupReference[]> {
    // OPS must already hold the session-level lock before BEGIN REPEATABLE READ:
    // waiting for a lock inside a first SELECT can establish a stale RR snapshot.
    await c.query("SELECT pg_advisory_xact_lock($1)", [ACCOUNT_MEDIA_GC_LOCK]);
    return (
      await c.query(
        "SELECT account_id,kind,asset_id,storage_namespace,blob_key,sha256,size FROM account_media WHERE state='ACTIVE' ORDER BY account_id,kind",
      )
    ).rows.map((r) => ({
      owner: "ACCOUNT",
      accountId: r.account_id,
      storageNamespace: r.storage_namespace,
      kind: r.kind,
      assetId: r.asset_id,
      key: r.blob_key,
      sha256: r.sha256,
      size: r.size,
    }));
  }
  async function mutate(
    r: FastifyRequest,
    kind: AccountMediaKind,
    remove: boolean,
  ) {
    let staged: string | undefined;
    let unpublished: any;
    try {
      return await own(r, async (c, a) => {
        const commandKey =
            "account-media:" + r.method + ":" + kind + ":" + key(r),
          hash = commandHash(r);
        const prior = (
          await c.query(
            "SELECT hash FROM account_commands WHERE account_id=$1 AND key=$2",
            [a.id, commandKey],
          )
        ).rows[0];
        const before = await row(c, a.id, kind);
        ready();
        if (prior) {
          if (prior.hash !== hash) fail(409, "IDEMPOTENCY_CONFLICT");
          return core.envelope(
            r,
            { media: safe(before, kind) },
            null,
            before?.version ?? 0,
          );
        }
        version(r, before?.version ?? 0);
        let media: any;
        if (remove) {
          if (r.body !== undefined && r.body !== null) body(r, []);
          media = (
            await c.query(
              "INSERT INTO account_media(account_id,kind,version,state) VALUES($1,$2,1,'DELETED') ON CONFLICT(account_id,kind) DO UPDATE SET version=account_media.version+1,state='DELETED',asset_id=NULL,storage_namespace=NULL,blob_key=NULL,sha256=NULL,size=NULL,mime=NULL,width=NULL,height=NULL,updated_at=clock_timestamp() RETURNING *",
              [a.id, kind],
            )
          ).rows[0];
        } else {
          const input = imageInput(r),
            p = ready();
          const image = await p.decoder.decodeAndNormalize(
            input.bytes,
            kind,
            input.crop,
          );
          const max = kind === "PHOTO" ? [512, 512] : [1040, 480];
          if (
            !(image.bytes instanceof Uint8Array) ||
            !image.bytes.length ||
            image.bytes.length > OUTPUT_LIMIT ||
            !["image/png", "image/jpeg", "image/webp"].includes(image.mime) ||
            !Number.isSafeInteger(image.width) ||
            !Number.isSafeInteger(image.height) ||
            image.width <= 0 ||
            image.height <= 0 ||
            image.width > max[0] ||
            image.height > max[1]
          )
            fail(503, "ACCOUNT_IMAGE_DECODER_INVALID");
          const blob = await p.store.put(image.bytes);
          id(blob.key);
          if (
            blob.sha256 !== sha(image.bytes) ||
            blob.size !== image.bytes.byteLength
          )
            fail(503, "ACCOUNT_MEDIA_STORE_INVALID");
          // A reused key cannot be cleaned up as if it were a new object owned by this command.
          if (
            (
              await c.query(
                "SELECT 1 FROM account_media WHERE storage_namespace=$1 AND blob_key=$2 UNION ALL SELECT 1 FROM account_media_gc WHERE storage_namespace=$1 AND blob_key=$2",
                [p.storageNamespace, blob.key],
              )
            ).rowCount
          )
            fail(503, "ACCOUNT_MEDIA_STORE_KEY_REUSED");
          const next = {
            account_id: a.id,
            kind,
            asset_id: uuid(),
            storage_namespace: p.storageNamespace,
            blob_key: blob.key,
            sha256: blob.sha256,
            size: blob.size,
          };
          unpublished = next;
          // Independent durable intent survives a later metadata transaction rollback.
          await queue(stagingConnection(), next, "UNPUBLISHED");
          staged = next.asset_id;
          media = (
            await c.query(
              "INSERT INTO account_media(account_id,kind,version,state,asset_id,storage_namespace,blob_key,sha256,size,mime,width,height) VALUES($1,$2,1,'ACTIVE',$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(account_id,kind) DO UPDATE SET version=account_media.version+1,state='ACTIVE',asset_id=excluded.asset_id,storage_namespace=excluded.storage_namespace,blob_key=excluded.blob_key,sha256=excluded.sha256,size=excluded.size,mime=excluded.mime,width=excluded.width,height=excluded.height,updated_at=clock_timestamp() RETURNING *",
              [
                a.id,
                kind,
                next.asset_id,
                p.storageNamespace,
                blob.key,
                blob.sha256,
                blob.size,
                image.mime,
                image.width,
                image.height,
              ],
            )
          ).rows[0];
          await c.query("DELETE FROM account_media_gc WHERE id=$1", [staged]);
        }
        if (before?.state === "ACTIVE")
          await queue(c, before, remove ? "DELETED" : "REPLACED");
        await c.query("UPDATE accounts SET version=version+1 WHERE id=$1", [
          a.id,
        ]);
        await c.query(
          "INSERT INTO account_events(id,account_id,action,resource_id,request_id) VALUES($1,$2,$3,$4,$5)",
          [
            uuid(),
            a.id,
            remove ? "AccountMediaDeleted" : "AccountMediaUpdated",
            media.asset_id ?? a.id,
            r.id,
          ],
        );
        const result = { media: safe(media, kind) };
        await c.query(
          "INSERT INTO account_commands(account_id,key,hash,result) VALUES($1,$2,$3,$4)",
          [a.id, commandKey, hash, result],
        );
        return core.envelope(r, result, null, media.version);
      });
    } catch (error) {
      // This runs after rollback. Failed removal stays in the committed retry table.
      if (staged)
        try {
          await collectOne(staged, undefined, true);
        } catch {
          /* durable queue remains */
        }
      else if (unpublished) {
        // The queue INSERT itself can fail after put. Remove only this fresh,
        // ownership-checked key; retain a retry if the store is temporarily down.
        try {
          await ready().store.remove(unpublished.blob_key);
        } catch {
          try {
            await queue(stagingConnection(), unpublished, "UNPUBLISHED");
          } catch {
            // A simultaneous database and filesystem outage cannot be made ACID.
            // The command still fails and never publishes the pointer.
          }
        }
      }
      throw error;
    }
  }
  async function registerAccountMediaRoutes(app: FastifyInstance) {
    app.addHook("onClose", async () => {
      await stagingPool?.end();
    });
    app.get("/api/v1/account/media", (r) =>
      own(r, async (c, a) =>
        core.envelope(r, await readAccountMediaSummary(c, a.id)),
      ),
    );
    for (const kind of ["PHOTO", "COVER"] as const) {
      const path = "/api/v1/account/media/" + kindPath(kind);
      app.get(path, async (r, reply) => {
        const media = await own(r, async (c, a) =>
          readBytes(c, await row(c, a.id, kind)),
        );
        return reply
          .header("Cache-Control", "private, no-store")
          .header("X-Content-Type-Options", "nosniff")
          .type(media.mime)
          .send(Buffer.from(media.bytes));
      });
      app.post(path, { bodyLimit: ACCOUNT_MEDIA_BODY_LIMIT }, (r) =>
        mutate(r, kind, false),
      );
      app.delete(path, (r) => mutate(r, kind, true));
    }
    app.get(
      "/api/v1/organizations/:organizationId/members/:memberId/avatar",
      async (r, reply) => {
        const result = await core.tenant(r, { mode: "read" }, (ctx) =>
          readAuthorizedMemberAvatar(ctx, (r.params as any).memberId),
        );
        const media = result.data;
        return reply
          .header("Cache-Control", "private, no-store")
          .header("X-Content-Type-Options", "nosniff")
          .type(media.mime)
          .send(Buffer.from(media.bytes));
      },
    );
  }
  return {
    registerAccountMediaProvider,
    registerAccountMediaRoutes,
    readAccountMediaSummary,
    readAuthorizedMemberAvatar,
    runAccountMediaGc,
    readAccountMediaBackupReferences,
  };
}

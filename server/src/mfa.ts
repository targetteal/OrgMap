import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { transaction } from "./db.js";
import { body, fail, key, uuid } from "./core.js";
import { verifyPassword } from "./password.js";

export const mfaKeyPath = () =>
  resolve(process.env.ORGMAP_MFA_KEY_FILE ?? ".orgmap/mfa.key");
async function encryptionKey() {
  try {
    const file = await open(
      mfaKeyPath(),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.uid !== process.getuid?.()
      )
        throw Error();
      const raw = (await file.readFile("utf8")).trim();
      if (!/^[a-f0-9]{64}$/.test(raw)) throw Error();
      return Buffer.from(raw, "hex");
    } finally {
      await file.close();
    }
  } catch {
    return fail(503, "MFA_CONFIGURATION_REQUIRED");
  }
}
export async function encryptMfaSecret(secret: Buffer, accountId: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  cipher.setAAD(Buffer.from(accountId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}
async function decryptMfaSecret(value: string, accountId: string) {
  const key = await encryptionKey();
  try {
    const [v, iv, tag, ciphertext] = value.split(":");
    if (
      v !== "v1" ||
      !/^[a-f0-9]{24}$/.test(iv) ||
      !/^[a-f0-9]{32}$/.test(tag) ||
      !/^[a-f0-9]{40}$/.test(ciphertext)
    )
      throw Error();
    const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
    cipher.setAAD(Buffer.from(accountId));
    cipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([
      cipher.update(Buffer.from(ciphertext, "hex")),
      cipher.final(),
    ]);
  } catch {
    return fail(503, "MFA_CONFIGURATION_REQUIRED");
  }
}
export function totpAt(secret: Buffer, step: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest(),
    offset = mac[19] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits)
    .toString()
    .padStart(digits, "0");
}
export function matchTotpStep(
  secret: Buffer,
  code: unknown,
  now: Date,
  lastUsedStep: number,
) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now.getTime() / 30000);
  let matched: number | null = null;
  for (const candidate of [step - 1, step, step + 1]) {
    if (candidate < 0) continue;
    const equal = timingSafeEqual(
      Buffer.from(totpAt(secret, candidate)),
      Buffer.from(code),
    );
    if (equal && candidate > lastUsedStep) matched = candidate;
  }
  return matched;
}
function base32(value: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    acc = 0,
    result = "";
  for (const byte of value) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(acc >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(acc << (5 - bits)) & 31];
  return result;
}
type Core = {
  auth: (r: FastifyRequest, c?: PoolClient) => Promise<any>;
  envelope: (r: FastifyRequest, data: any, ...rest: any[]) => any;
};
export function createMfaServices(core: Core) {
  // Bounded per-process online guessing protection; deployment ingress should
  // additionally rate limit across processes. No submitted codes are retained.
  const attempts = new Map<string, { until: number; count: number }>();
  async function mfaReadiness() {
    try {
      await encryptionKey();
      return true;
    } catch {
      return false;
    }
  }
  async function consume(
    c: PoolClient,
    accountId: string,
    code: unknown,
    state: "ACTIVE" | "PENDING",
  ) {
    const now = Date.now();
    for (const [id, attempt] of attempts)
      if (attempt.until <= now) attempts.delete(id);
    const attempt = attempts.get(accountId);
    if ((attempt && attempt.count >= 8) || (!attempt && attempts.size >= 10000))
      fail(429, "RATE_LIMITED");
    attempts.set(accountId, {
      until: attempt?.until ?? now + 60000,
      count: (attempt?.count ?? 0) + 1,
    });
    const factor = (
      await c.query(
        "SELECT *,clock_timestamp() AS db_now FROM account_mfa_factors WHERE account_id=$1 FOR UPDATE",
        [accountId],
      )
    ).rows[0];
    if (
      !factor ||
      factor.state !== state ||
      (state === "PENDING" &&
        new Date(factor.pending_expires_at) <= factor.db_now)
    )
      fail(401, "MFA_VERIFICATION_REQUIRED");
    const step = matchTotpStep(
      await decryptMfaSecret(factor.encrypted_secret, accountId),
      code,
      factor.db_now,
      Number(factor.last_used_step),
    );
    if (step === null) fail(401, "MFA_VERIFICATION_REQUIRED");
    await c.query(
      "UPDATE account_mfa_factors SET last_used_step=$2 WHERE account_id=$1",
      [accountId, step],
    );
    return factor.db_now as Date;
  }
  async function verifyOwnTotp(
    c: PoolClient,
    accountId: string,
    code: unknown,
  ) {
    const verifiedAt = await consume(c, accountId, code, "ACTIVE");
    const a = (
      await c.query("SELECT mfa_revision FROM accounts WHERE id=$1", [
        accountId,
      ])
    ).rows[0];
    return { factorRevision: Number(a.mfa_revision), verifiedAt };
  }
  async function own(
    r: FastifyRequest,
    fn: (c: PoolClient, a: any, s: any) => Promise<any>,
  ) {
    const initial = await core.auth(r);
    return transaction(async (c) => {
      const a = (
        await c.query(
          "SELECT *,clock_timestamp() AS db_now FROM accounts WHERE id=$1 FOR UPDATE",
          [initial.id],
        )
      ).rows[0];
      const s = await core.auth(r, c);
      return core.envelope(r, await fn(c, a, s));
    });
  }
  async function reauthenticate(
    c: PoolClient,
    a: any,
    s: any,
    password: unknown,
  ) {
    if (a.password_enabled) {
      if (
        typeof password !== "string" ||
        password.length > 1024 ||
        !(await verifyPassword(password, a.password_hash))
      )
        fail(401, "REAUTHENTICATION_REQUIRED");
    } else {
      const provenance = (
        await c.query(
          "SELECT auth_method,auth_verified_at,clock_timestamp() AS db_now FROM sessions WHERE id=$1 AND account_id=$2 FOR UPDATE",
          [s.session_id, a.id],
        )
      ).rows[0];
      if (
        !provenance ||
        provenance.auth_method !== "FEDERATED" ||
        new Date(provenance.db_now).getTime() -
          new Date(provenance.auth_verified_at).getTime() >
          300000 ||
        new Date(provenance.auth_verified_at) > provenance.db_now
      )
        fail(401, "REAUTHENTICATION_REQUIRED");
    }
  }
  async function audit(
    c: PoolClient,
    a: string,
    r: FastifyRequest,
    action: string,
  ) {
    await c.query(
      "INSERT INTO account_events(id,account_id,action,resource_id,request_id) VALUES($1,$2,$3,$2,$4)",
      [uuid(), a, action, r.id],
    );
  }
  async function registerMfaRoutes(app: FastifyInstance) {
    app.addHook("onSend", async (r, reply, payload) => {
      if (r.url.startsWith("/api/v1/account/mfa"))
        reply.header("cache-control", "no-store");
      return payload;
    });
    app.get("/api/v1/account/mfa", (r) =>
      own(r, async (c, a) => ({
        enabled: !!(
          await c.query(
            "SELECT 1 FROM account_mfa_factors WHERE account_id=$1 AND state='ACTIVE'",
            [a.id],
          )
        ).rowCount,
        factorRevision: Number(a.mfa_revision),
      })),
    );
    app.post("/api/v1/account/mfa/enrollment/start", (r) =>
      own(r, async (c, a, s) => {
        const b = body(r, ["currentPassword"]);
        key(r);
        await reauthenticate(c, a, s, b.currentPassword);
        if (
          (
            await c.query(
              "SELECT 1 FROM account_mfa_factors WHERE account_id=$1 AND state='ACTIVE'",
              [a.id],
            )
          ).rowCount
        )
          fail(409, "MFA_ALREADY_ENABLED");
        const seed = randomBytes(20),
          encrypted = await encryptMfaSecret(seed, a.id);
        await c.query(
          "INSERT INTO account_mfa_factors(account_id,encrypted_secret,state,pending_expires_at) VALUES($1,$2,'PENDING',clock_timestamp()+interval '10 minutes') ON CONFLICT(account_id) DO UPDATE SET encrypted_secret=$2,state='PENDING',pending_expires_at=clock_timestamp()+interval '10 minutes',last_used_step=-1",
          [a.id, encrypted],
        );
        await audit(c, a.id, r, "MfaEnrollmentStarted");
        return {
          secret: base32(seed),
          issuer: "OrgMap",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
        };
      }),
    );
    app.post("/api/v1/account/mfa/enrollment/confirm", (r) =>
      own(r, async (c, a, s) => {
        const b = body(r, ["code"]);
        key(r);
        const verifiedAt = await consume(c, a.id, b.code, "PENDING");
        await c.query(
          "UPDATE account_mfa_factors SET state='ACTIVE',pending_expires_at=NULL WHERE account_id=$1",
          [a.id],
        );
        const updated = (
          await c.query(
            "UPDATE accounts SET mfa_revision=mfa_revision+1 WHERE id=$1 RETURNING mfa_revision",
            [a.id],
          )
        ).rows[0];
        await c.query(
          "UPDATE sessions SET mfa_verified_at=$3,mfa_factor_revision=$4 WHERE id=$1 AND account_id=$2",
          [s.session_id, a.id, verifiedAt, updated.mfa_revision],
        );
        await audit(c, a.id, r, "MfaEnabled");
        return { enabled: true, factorRevision: Number(updated.mfa_revision) };
      }),
    );
    app.post("/api/v1/account/mfa/disable", (r) =>
      own(r, async (c, a, s) => {
        const b = body(r, ["currentPassword", "code"]);
        key(r);
        await encryptionKey();
        await reauthenticate(c, a, s, b.currentPassword);
        const factor = (
          await c.query(
            "SELECT state FROM account_mfa_factors WHERE account_id=$1 FOR UPDATE",
            [a.id],
          )
        ).rows[0];
        if (factor?.state !== "ACTIVE") fail(409, "MFA_NOT_ENABLED");
        const stamp = (
          await c.query(
            "SELECT mfa_verified_at,mfa_factor_revision,clock_timestamp() AS db_now FROM sessions WHERE id=$1 AND account_id=$2 FOR UPDATE",
            [s.session_id, a.id],
          )
        ).rows[0];
        const recent =
          stamp?.mfa_verified_at &&
          Number(stamp.mfa_factor_revision) === Number(a.mfa_revision) &&
          new Date(stamp.db_now).getTime() -
            new Date(stamp.mfa_verified_at).getTime() <=
            300000 &&
          new Date(stamp.mfa_verified_at) <= stamp.db_now;
        if (!recent) await verifyOwnTotp(c, a.id, b.code);
        await c.query("DELETE FROM account_mfa_factors WHERE account_id=$1", [
          a.id,
        ]);
        await c.query(
          "UPDATE accounts SET mfa_revision=mfa_revision+1 WHERE id=$1",
          [a.id],
        );
        await audit(c, a.id, r, "MfaDisabled");
        return { enabled: false };
      }),
    );
  }
  return { registerMfaRoutes, verifyOwnTotp, mfaReadiness };
}

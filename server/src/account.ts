import { createSessionRecord } from "./sessions.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleRuntime } from "./runtime.js";
import { transaction, pool } from "./db.js";
import {
  body,
  camel,
  commandHash,
  digest,
  fail,
  id,
  key,
  secret,
  text,
  uuid,
  version,
} from "./core.js";
import { hashPassword, verifyPassword } from "./password.js";
const defaults = {
  locale: "pt-BR",
  timeZone: "America/Sao_Paulo",
  dateFormat: "DD/MM/YYYY",
  theme: "system",
  reducedMotion: false,
  version: 1,
};
const safe = (a: any) => ({
  id: a.id,
  email: a.email,
  displayName: a.display_name,
  version: a.version,
  passwordEnabled: a.password_enabled,
});
async function audit(
  c: PoolClient,
  a: string,
  r: FastifyRequest,
  action: string,
  resource = a,
) {
  await c.query(
    "INSERT INTO account_events(id,account_id,action,resource_id,request_id) VALUES($1,$2,$3,$4,$5)",
    [uuid(), a, action, resource, r.id],
  );
}
function password(v: unknown) {
  if (typeof v !== "string" || v.length < 12 || v.length > 1024)
    fail(400, "INVALID_PASSWORD");
  return v as string;
}
export async function registerAccountRoutes(
  app: FastifyInstance,
  core: ModuleRuntime,
) {
  async function account(
    r: FastifyRequest,
    fn: (c: PoolClient, a: any, session: any) => Promise<any>,
  ) {
    const authenticated = await core.auth(r);
    return transaction(async (c) => {
      const a = (
        await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
          authenticated.id,
        ])
      ).rows[0];
      const session = await core.auth(r, c);
      return fn(c, a, session);
    });
  }
  async function mutate(
    r: FastifyRequest,
    fn: (c: PoolClient, a: any) => Promise<any>,
  ) {
    return account(r, async (c, a) => {
      const k =
          "account:" + r.method + ":" + r.url.split("?")[0] + ":" + key(r),
        hash = commandHash(r);
      const prior = (
        await c.query(
          "SELECT * FROM account_commands WHERE account_id=$1 AND key=$2",
          [a.id, k],
        )
      ).rows[0];
      if (prior) {
        if (prior.hash !== hash) fail(409, "IDEMPOTENCY_CONFLICT");
        return core.envelope(
          r,
          prior.result,
          null,
          prior.result.account?.version ??
            prior.result.preferences?.version ??
            null,
        );
      }
      const data = await fn(c, a);
      await c.query("INSERT INTO account_commands VALUES($1,$2,$3,$4)", [
        a.id,
        k,
        hash,
        data,
      ]);
      return core.envelope(
        r,
        data,
        null,
        data.account?.version ?? data.preferences?.version ?? null,
      );
    });
  }
  app.get("/api/v1/account", (r) =>
    account(r, async (c, a) =>
      core.envelope(
        r,
        {
          account: safe(a),
          media: await core.readAccountMediaSummary(c, a.id),
          authMethods: await core.accountAuthMethods(
            c,
            a.id,
            a.password_enabled,
          ),
        },
        null,
        a.version,
      ),
    ),
  );
  app.patch("/api/v1/account", (r) =>
    mutate(r, async (c, a) => {
      const b = body(r, ["displayName"]);
      version(r, a.version);
      const updated = (
        await c.query(
          "UPDATE accounts SET display_name=$2,version=version+1 WHERE id=$1 RETURNING *",
          [a.id, text(b.displayName)],
        )
      ).rows[0];
      await audit(c, a.id, r, "AccountProfileUpdated");
      return { account: safe(updated) };
    }),
  );
  app.get("/api/v1/account/preferences", (r) =>
    account(r, async (c, a) => {
      const row = (
        await c.query("SELECT * FROM account_preferences WHERE account_id=$1", [
          a.id,
        ])
      ).rows[0];
      return core.envelope(
        r,
        { preferences: row ? camel(row) : defaults },
        null,
        row?.version ?? 1,
      );
    }),
  );
  app.patch("/api/v1/account/preferences", (r) =>
    mutate(r, async (c, a) => {
      const b = body(r, [
        "locale",
        "timeZone",
        "dateFormat",
        "theme",
        "reducedMotion",
      ]);
      const before = (
        await c.query("SELECT * FROM account_preferences WHERE account_id=$1", [
          a.id,
        ])
      ).rows[0];
      const p = { ...(before ? camel(before) : defaults), ...b };
      version(r, p.version);
      text(p.locale, 35);
      try {
        Intl.getCanonicalLocales(p.locale);
        new Intl.DateTimeFormat(p.locale, { timeZone: p.timeZone });
      } catch {
        fail(400, "INVALID_REQUEST");
      }
      if (
        !["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(p.dateFormat) ||
        !["system", "dark", "light"].includes(p.theme) ||
        typeof p.reducedMotion !== "boolean"
      )
        fail(400, "INVALID_REQUEST");
      const row = (
        await c.query(
          "INSERT INTO account_preferences(account_id,locale,time_zone,date_format,theme,reduced_motion,version) VALUES($1,$2,$3,$4,$5,$6,2) ON CONFLICT(account_id) DO UPDATE SET locale=excluded.locale,time_zone=excluded.time_zone,date_format=excluded.date_format,theme=excluded.theme,reduced_motion=excluded.reduced_motion,version=account_preferences.version+1 RETURNING *",
          [a.id, p.locale, p.timeZone, p.dateFormat, p.theme, p.reducedMotion],
        )
      ).rows[0];
      await audit(c, a.id, r, "AccountPreferencesUpdated");
      return { preferences: camel(row) };
    }),
  );
  app.get("/api/v1/auth/sessions", (r) =>
    account(r, async (c, a) => {
      const rows = (
        await c.query(
          "SELECT id,created_at,expires_at,token_hash=$2 AS current FROM sessions WHERE account_id=$1 AND expires_at>now() ORDER BY created_at,id",
          [a.id, digest(r.cookies.orgmap_session!)],
        )
      ).rows;
      return core.envelope(r, {
        items: rows.map((row) => ({ ...camel(row), version: 1 })),
      });
    }),
  );
  app.post("/api/v1/auth/sessions/:sessionId/revoke", (r) =>
    mutate(r, async (c, a) => {
      body(r, []);
      const sessionId = id((r.params as any).sessionId);
      version(r, 1);
      const target = (
        await c.query(
          "DELETE FROM sessions WHERE account_id=$1 AND id=$2 RETURNING id",
          [a.id, sessionId],
        )
      ).rows[0];
      if (!target) fail(404, "RESOURCE_NOT_FOUND");
      await audit(c, a.id, r, "SessionRevoked", sessionId);
      return { revoked: true };
    }),
  );
  app.post("/api/v1/auth/password", async (r, reply) => {
    await core.auth(r);
    const b = body(r, ["currentPassword", "newPassword"]);
    const hash = await hashPassword(password(b.newPassword));
    let fresh: { token: string; csrf: string } | undefined;
    const response = await mutate(r, async (c, a) => {
      version(r, a.version);
      if (
        !a.password_enabled ||
        typeof b.currentPassword !== "string" ||
        !(await verifyPassword(b.currentPassword, a.password_hash))
      )
        fail(401, "REAUTHENTICATION_REQUIRED");
      if (await verifyPassword(b.newPassword, a.password_hash))
        fail(422, "PASSWORD_UNCHANGED");
      await c.query(
        "UPDATE accounts SET password_hash=$2,version=version+1 WHERE id=$1",
        [a.id, hash],
      );
      await c.query("DELETE FROM sessions WHERE account_id=$1", [a.id]);
      fresh = { token: secret(), csrf: secret() };
      await createSessionRecord(c, a.id, { method: "PASSWORD" }, fresh);
      await audit(c, a.id, r, "PasswordChanged");
      return {
        passwordChanged: true,
        account: { ...safe(a), version: a.version + 1 },
      };
    });
    if (fresh) {
      reply.setCookie("orgmap_session", fresh.token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.COOKIE_SECURE === "true",
        maxAge: 604800,
      });
      (response.data as any).csrfToken = fresh.csrf;
    }
    return response;
  });
  app.post("/api/v1/auth/password/disable", (r) =>
    mutate(r, async (c, a) => {
      const b = body(r, ["currentPassword"]);
      version(r, a.version);
      if (
        !a.password_enabled ||
        typeof b.currentPassword !== "string" ||
        !(await verifyPassword(b.currentPassword, a.password_hash))
      )
        fail(401, "REAUTHENTICATION_REQUIRED");
      await core.assertLoginMethodRemovalAllowed(c, a.id, "local-password");
      await c.query(
        "UPDATE accounts SET password_enabled=false,version=version+1 WHERE id=$1",
        [a.id],
      );
      await audit(c, a.id, r, "LocalPasswordDisabled");
      return {
        account: { ...safe(a), passwordEnabled: false, version: a.version + 1 },
      };
    }),
  );
  const attempts = new Map<string, { until: number; count: number }>();
  function throttle(r: FastifyRequest) {
    for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
    const k = r.ip,
      old = attempts.get(k);
    if ((old && old.count >= 8) || (attempts.size > 10000 && !old))
      fail(429, "RATE_LIMITED");
    attempts.set(k, {
      until: old?.until ?? Date.now() + 60000,
      count: (old?.count ?? 0) + 1,
    });
  }
  app.post("/api/v1/auth/recovery/request", async (r) => {
    throttle(r);
    const b = body(r, ["email"]);
    key(r);
    const email = text(b.email, 254).toLowerCase();
    await transaction(async (c) => {
      const a = (
        await c.query(
          "SELECT id,email_revision FROM accounts WHERE email=$1 AND password_enabled FOR UPDATE",
          [email],
        )
      ).rows[0];
      if (!a) return;
      const token = secret(),
        rid = uuid();
      await c.query(
        "INSERT INTO password_recovery(id,account_id,token_hash,expires_at,email_revision) VALUES($1,$2,$3,now()+interval '30 minutes',$4)",
        [rid, a.id, digest(token), a.email_revision],
      );
      await c.query(
        "INSERT INTO account_mail(id,account_id,recovery_id,email,token) VALUES($1,$2,$3,$4,$5)",
        [uuid(), a.id, rid, email, token],
      );
      await audit(c, a.id, r, "PasswordRecoveryRequested", rid);
    });
    return core.envelope(r, { accepted: true });
  });
  app.post("/api/v1/auth/recovery/complete", async (r) => {
    throttle(r);
    const b = body(r, ["token", "newPassword"]),
      tokenHash = digest(text(b.token, 200)),
      k = key(r),
      command = commandHash(r),
      hash = await hashPassword(password(b.newPassword));
    return transaction(async (c) => {
      const row = (
        await c.query(
          "SELECT account_id FROM password_recovery WHERE token_hash=$1",
          [tokenHash],
        )
      ).rows[0];
      if (!row) fail(401, "RECOVERY_INVALID");
      const a = (
        await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
          row.account_id,
        ])
      ).rows[0];
      const recovery = (
        await c.query(
          "SELECT * FROM password_recovery WHERE token_hash=$1 FOR UPDATE",
          [tokenHash],
        )
      ).rows[0];
      if (
        !recovery ||
        !a.password_enabled ||
        String(recovery.email_revision) !== String(a.email_revision) ||
        new Date(recovery.expires_at) <= new Date()
      )
        fail(401, "RECOVERY_INVALID");
      if (recovery.used_at) {
        if (recovery.command_key !== k || recovery.command_hash !== command)
          fail(401, "RECOVERY_INVALID");
        return core.envelope(r, { passwordReset: true });
      }
      if (await verifyPassword(b.newPassword, a.password_hash))
        fail(422, "PASSWORD_UNCHANGED");
      await c.query(
        "UPDATE accounts SET password_hash=$2,version=version+1 WHERE id=$1",
        [a.id, hash],
      );
      await c.query(
        "UPDATE password_recovery SET used_at=now(),command_key=$2,command_hash=$3 WHERE id=$1",
        [recovery.id, k, command],
      );
      await c.query("DELETE FROM sessions WHERE account_id=$1", [a.id]);
      await audit(c, a.id, r, "PasswordRecovered", recovery.id);
      return core.envelope(r, { passwordReset: true });
    });
  });
}

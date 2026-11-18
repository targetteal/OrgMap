// Disposable, isolated UI/API preview. No shared database or global cookies.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleRuntime } from "../../src/runtime.js";
import type { FederationConfiguration } from "./federation.js";
import type { EnrollmentConfiguration } from "./enrollment-ports.js";
const name = "orgmap_interop_preview_" + randomBytes(6).toString("hex");
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl }),
  migration = new URL(adminUrl),
  runtime = new URL(
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
  );
migration.pathname = "/" + name;
runtime.pathname = "/" + name;
await admin.query('CREATE DATABASE "' + name + '"');
process.env.DATABASE_URL = runtime.href;
process.env.MIGRATION_DATABASE_URL = migration.href;
process.env.ALLOWED_ORIGINS = "http://interoperability.localhost:5197";
try {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "server/src/migrate.ts"],
      { stdio: "inherit", env: process.env },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("migration exit " + code)),
    );
  });
  const { buildApp } = await import("../../src/app.js"),
    { createInteroperability } = await import("./index.js"),
    { pool } = await import("../../src/db.js"),
    { createServer } = await import("vite");
  const oidc: FederationConfiguration = {},
    enrollment: EnrollmentConfiguration = {};
  let core!: ModuleRuntime;
  const localPreview = process.env.INTEROP_ENROLLMENT_PREVIEW === "1";
  const provider = localPreview
    ? await (await import("./preview-idp.js")).startPreviewIdp()
    : null;
  const mailbox = localPreview
    ? await mkdtemp(join(tmpdir(), "orgmap-interop-cua-mail-"))
    : null;
  const smtp = mailbox
    ? await (
        await import("../../src/smtp.js")
      ).startSmtpSink({ port: 0, directory: mailbox })
    : null;
  const { foundationDefaultAdmissionPolicy } = await import("../../src/admission.js");
  const app = await buildApp([
    foundationDefaultAdmissionPolicy,
    createInteroperability(oidc, undefined, {}, {}, undefined, enrollment),
    async (_app, runtime) => {
      core = runtime;
    },
  ]);
  if (provider && smtp && mailbox) {
    async function call(
      method: string,
      path: string,
      payload: any,
      user?: { cookie: string; csrf: string },
    ) {
      const result = await app.inject({
        method: method as any,
        url: "/api/v1" + path,
        headers: {
          origin: "http://interoperability.localhost:5197",
          "idempotency-key": crypto.randomUUID(),
          ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
        },
        payload,
      });
      if (result.statusCode >= 400)
        throw Error("Preview setup rejected " + result.statusCode);
      return result;
    }
    const registered = await call("POST", "/auth/register", {
        email: "interop-operator@example.test",
        password: "synthetic-preview-pass-123",
        displayName: "Interop QA",
      }),
      user = {
        cookie: registered.cookies[0].name + "=" + registered.cookies[0].value,
        csrf: registered.json().data.csrfToken,
      };
    const org = await call(
        "POST",
        "/organizations",
        { name: "Aurora Interoperabilidade" },
        user,
      ),
      orgId = org.json().data.organization.id,
      p = "/organizations/" + orgId + "/interoperability",
      connection = await call(
        "POST",
        p + "/connections",
        { provider: "OIDC", label: "IdP local sintético de aceitação" },
        user,
      ),
      connectionId = connection.json().data.connection.id,
      key = orgId + ":" + connectionId;
    oidc[key] = {
      issuer: provider.base,
      clientId: "orgmap-cua",
      authorizationEndpoint: provider.base + "/authorize",
      tokenEndpoint: provider.base + "/token",
      jwksUri: provider.base + "/jwks",
      redirectUri:
        "http://interoperability.localhost:5197/api/v1" +
        p +
        "/connections/" +
        connectionId +
        "/oidc/callback",
      allowLocalHttp: true,
    };
    enrollment[key] = {
      issuer: provider.base,
      claim: "sub",
      mappingRevision: 1,
      externalIdToValue: { "opaque-cua-enrollee": "immutable-cua-enrollee" },
    };
    const credential = await call(
      "POST",
      p + "/credentials",
      {
        label: "SCIM local sintético",
        kind: "SCIM",
        connectionId,
        scopes: ["members.provision"],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      user,
    );
    const pending = await app.inject({
      method: "POST",
      url: "/api/v1" + p + "/scim/v2/Users",
      headers: {
        origin: "http://interoperability.localhost:5197",
        "idempotency-key": crypto.randomUUID(),
        authorization: "Bearer " + credential.json().data.secret,
      },
      payload: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "opaque-cua-enrollee",
        userName: "cua-enrollee",
        emails: [{ value: "interop-enrollee@example.test", primary: true }],
        active: true,
      },
    });
    if (pending.statusCode !== 201)
      throw Error("Preview enrollment setup rejected " + pending.statusCode);
    const { sendLocalMail } = await import("../../src/smtp.js");
    await core.deliverProvisionedEnrollmentMail(orgId, (mail) =>
      sendLocalMail(mail, (smtp.address() as any).port),
    );
    await writeFile(
      join(mailbox, "preview-info.json"),
      JSON.stringify({
        organizationId: orgId,
        connectionId,
        mailboxDirectory: mailbox,
        provider: provider.base,
        source: "synthetic local acceptance only",
      }),
      { mode: 0o600 },
    );
    console.log("Synthetic enrollment SMTP mailbox directory: " + mailbox);
  }
  await app.listen({ host: "127.0.0.1", port: 3317 });
  const vite = await createServer({
    root: resolve("web"),
    configFile: false,
    server: {
      host: "127.0.0.1",
      port: 5197,
      strictPort: true,
      hmr: false,
      watch: {
        ignored: ["**/.preview-dist/**", "**/.candidate/**", "**/evidence*/**"],
      },
      allowedHosts: ["interoperability.localhost"],
      proxy: {
        "/api": { target: "http://127.0.0.1:3317", changeOrigin: false },
      },
    },
  });
  await vite.listen();
  console.log(
    "Interop preview http://interoperability.localhost:5197 — disposable DB " +
      name,
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await vite.close();
      await app.close();
      if (provider)
        await new Promise<void>((resolve, reject) =>
          provider.server.close((e) => (e ? reject(e) : resolve())),
        );
      if (smtp)
        await new Promise<void>((resolve, reject) =>
          smtp.close((e) => (e ? reject(e) : resolve())),
        );
      if (mailbox) await rm(mailbox, { recursive: true, force: true });
      await pool.end();
      await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
      await admin.end();
      process.exit(0);
    });
} catch (error) {
  await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
  throw error;
}

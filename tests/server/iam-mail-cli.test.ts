import { createServer, type Socket } from "node:net";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { digest, secret } from "../../server/src/core.js";
import { startSmtpSink } from "../../server/src/smtp.js";
import { configureIamMail } from "../../server/iam-mail/config.js";
import { createOrgMapIntegration } from "../../server/integration/index.js";
import { loadIntegrationOptions } from "../../server/integration/config.js";
const fixtureRuntime = new URL(
    process.env.DATABASE_URL ?? "postgres://invalid/",
  ),
  fixtureAdmin = new URL(
    process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
  );
if (
  !/^\/orgmap_mail_cli_test_[a-f0-9]{16}$/.test(fixtureRuntime.pathname) ||
  fixtureAdmin.pathname !== fixtureRuntime.pathname ||
  fixtureAdmin.host !== fixtureRuntime.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(fixtureRuntime.hostname)
)
  throw Error("EXCLUSIVE_IAM_MAIL_CLI_DATABASE_REQUIRED");
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
after(async () => {
  await pool.end();
  await admin.end();
});
async function until(check: () => Promise<boolean>, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("WAIT_TIMEOUT");
}
async function stop(p: ChildProcess) {
  if (p.exitCode !== null) return;
  const exited = new Promise<number | null>((r) => p.once("exit", r));
  p.kill("SIGTERM");
  const timer = setTimeout(() => p.kill("SIGKILL"), 12000);
  try {
    assert.equal(await exited, 0);
  } finally {
    clearTimeout(timer);
  }
}
test("real CLI private full configuration delivers all IAM queues, graceful restart reclaims expired leases without secret logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "iam-mail-cli-"));
  const smtpDir = join(dir, "smtp");
  const sink = await startSmtpSink({ port: 0, directory: smtpDir });
  const smtpPort = (sink.address() as any).port;
  const org = randomUUID(),
    account = randomUUID(),
    member = randomUUID(),
    connection = randomUUID(),
    credential = randomUUID(),
    external = randomUUID(),
    scimToken = secret();
  const role =
    "orgmap_iam_mail_local_" + randomUUID().replaceAll("-", "").slice(0, 16);
  let child: ChildProcess | undefined;
  const hungSockets = new Set<Socket>();
  const hungSmtp = createServer((socket) => {
    hungSockets.add(socket);
    socket.on("close", () => hungSockets.delete(socket));
  });
  let hungListening = false;
  let logs = "";
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let dispatcher: pg.Pool | undefined;
  try {
    await admin.query(
      "INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'CLI fixture','pt-BR','UTC')",
      [org],
    );
    await admin.query(
      "INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,'recovery@cli.local','CLI fixture','unused')",
      [account],
    );
    await admin.query(
      "INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')",
      [org, member, account],
    );
    await admin.query(
      "INSERT INTO interop_connections(organization_id,id,provider,label,state) VALUES($1,$2,'OIDC','Local configured fixture','CONFIGURED')",
      [org, connection],
    );
    await admin.query(
      "INSERT INTO interop_credentials(organization_id,id,member_id,label,kind,token_hash,scopes,expires_at,connection_id) VALUES($1,$2,$3,'CLI SCIM','SCIM',$4,ARRAY['members.provision'],clock_timestamp()+interval '1 hour',$5)",
      [org, credential, member, digest(scimToken), connection],
    );
    const key = org + ":" + connection,
      issuer = "http://127.0.0.1:18081/fixture-idp";
    const config = {
      blobsDirectory: join(dir, "blobs"),
      smtp: { host: "127.0.0.1", port: smtpPort },
      oidc: {
        [key]: {
          issuer,
          clientId: "fixture",
          clientSecret: "CONFIG-SECRET-NEVER-LOG",
          authorizationEndpoint: issuer + "/authorize",
          tokenEndpoint: issuer + "/token",
          jwksUri: issuer + "/jwks",
          redirectUri: "http://localhost:3001/api/v1/callback",
          allowLocalHttp: true,
        },
      },
      enrollment: {
        [key]: {
          issuer,
          claim: "sub",
          mappingRevision: 1,
          externalIdToValue: { [external]: "immutable-fixture" },
        },
      },
    };
    const configFile = join(dir, "integration.json");
    await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    assert.equal((await stat(configFile)).mode & 0o077, 0);
    app = await buildApp(
      [createOrgMapIntegration(await loadIntegrationOptions(configFile))],
      { migrationMaxPrefix: 999 },
    );
    await app.ready();
    const scim = await app.inject({
      method: "POST",
      url: "/api/v1/organizations/" + org + "/interoperability/scim/v2/Users",
      headers: {
        authorization: "Bearer " + scimToken,
        "idempotency-key": randomUUID(),
      },
      payload: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: external,
        userName: "cli-enrollment",
        emails: [{ value: "enrollment@cli.local", primary: true }],
        active: true,
      },
    });
    assert.equal(scim.statusCode, 201, scim.body);
    const recovery = randomUUID(),
      mail = randomUUID(),
      recoveryToken = secret();
    await admin.query(
      "INSERT INTO password_recovery(id,account_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '30 minutes')",
      [recovery, account, digest(recoveryToken)],
    );
    await admin.query(
      "INSERT INTO account_mail(id,account_id,recovery_id,email,token) VALUES($1,$2,$3,'recovery@cli.local',$4)",
      [mail, account, recovery, recoveryToken],
    );
    const invitation = randomUUID(),
      invitationToken = secret();
    await admin.query(
      "INSERT INTO invitations(organization_id,id,email,token_hash,expires_at,invited_by_member_id) VALUES($1,$2,'invitation@cli.local',$3,clock_timestamp()+interval '1 hour',$4)",
      [org, invitation, digest(invitationToken), member],
    );
    await admin.query(
      "INSERT INTO invitation_delivery(organization_id,id,invitation_id,token) VALUES($1,$2,$3,$4)",
      [org, randomUUID(), invitation, invitationToken],
    );
    const sensitiveTokens = (
      await admin.query(
        "SELECT token FROM account_mail UNION ALL SELECT token FROM invitation_delivery UNION ALL SELECT token FROM provisioned_enrollment_mail",
      )
    ).rows.map((r) => r.token as string);
    const envFile = join(dir, "dispatcher.env");
    await configureIamMail({
      adminUrl: process.env.MIGRATION_DATABASE_URL,
      file: envFile,
      role,
    });
    const privateEnv = await readFile(envFile, "utf8");
    const dispatchUrl = privateEnv
      .trim()
      .replace(/^IAM_MAIL_DISPATCH_DATABASE_URL=/, "");
    dispatcher = new pg.Pool({ connectionString: dispatchUrl });
    await assert.rejects(
      dispatcher.query("SELECT token FROM provisioned_enrollment_mail"),
      /permission denied/,
    );
    const start = () => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        IAM_MAIL_ENV_FILE: envFile,
        ORGMAP_INTEGRATION_CONFIG: configFile,
      };
      delete env.SMTP_PORT;
      delete env.IAM_MAIL_DISPATCH_DATABASE_URL;
      const p = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/iam-mail.ts"],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      p.stdout?.on("data", (x) => {
        logs += x.toString();
      });
      p.stderr?.on("data", (x) => {
        logs += x.toString();
      });
      return p;
    };
    child = start();
    await until(async () => {
      assert.equal(child!.exitCode, null, logs);
      return (
        (await readdir(smtpDir)).filter((x) => x.endsWith(".eml")).length === 3
      );
    });
    await stop(child);
    child = undefined;
    const states = (
      await admin.query(
        "SELECT state FROM account_mail UNION ALL SELECT state FROM invitation_delivery UNION ALL SELECT state FROM provisioned_enrollment_mail",
      )
    ).rows;
    assert.ok(states.every((r) => r.state === "DELIVERED"));
    assert.equal(
      (
        await admin.query(
          "SELECT 1 FROM accounts WHERE email='enrollment@cli.local'",
        )
      ).rowCount,
      0,
    );
    // Kill a real predecessor while SMTP is waiting; the claim transaction has committed.
    const retryMail = randomUUID();
    await admin.query(
      "INSERT INTO account_mail(id,account_id,recovery_id,email,token) VALUES($1,$2,$3,'recovery@cli.local',$4)",
      [retryMail, account, recovery, recoveryToken],
    );
    await new Promise<void>((r) => hungSmtp.listen(0, "127.0.0.1", r));
    hungListening = true;
    await writeFile(
      configFile,
      JSON.stringify({
        ...config,
        smtp: { host: "127.0.0.1", port: (hungSmtp.address() as any).port },
      }),
      { mode: 0o600 },
    );
    child = start();
    await until(
      async () =>
        (
          await admin.query("SELECT state FROM account_mail WHERE id=$1", [
            retryMail,
          ])
        ).rows[0].state === "PROCESSING",
    );
    const killed = new Promise<void>((r) => child!.once("exit", () => r()));
    child.kill("SIGKILL");
    await killed;
    child = undefined;
    for (const socket of hungSockets) socket.destroy();
    await new Promise<void>((r) => hungSmtp.close(() => r()));
    hungListening = false;
    await admin.query(
      "UPDATE account_mail SET lease_until=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [retryMail],
    );
    await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    await admin.query(
      "INSERT INTO iam_mail_scope_leases(kind,organization_id,lease_token,lease_until) VALUES('ACCOUNT','00000000-0000-0000-0000-000000000000',$1,clock_timestamp()-interval '1 minute') ON CONFLICT(kind,organization_id) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until",
      [randomUUID()],
    );
    child = start();
    await until(async () => {
      assert.equal(child!.exitCode, null, logs);
      return (
        (
          await admin.query("SELECT state FROM account_mail WHERE id=$1", [
            retryMail,
          ])
        ).rows[0].state === "DELIVERED"
      );
    });
    await stop(child);
    child = undefined;
    assert.equal(
      (await readdir(smtpDir)).filter((x) => x.endsWith(".eml")).length,
      4,
    );
    assert.equal(
      (await admin.query("SELECT 1 FROM iam_mail_scope_leases")).rowCount,
      0,
    );
    for (const secretValue of [
      scimToken,
      recoveryToken,
      "CONFIG-SECRET-NEVER-LOG",
      new URL(dispatchUrl).password,
      ...sensitiveTokens,
    ])
      assert.ok(!logs.includes(secretValue), "secret in log");
    assert.equal(logs, "");
  } finally {
    if (child) await stop(child);
    for (const socket of hungSockets) socket.destroy();
    if (hungListening)
      await new Promise<void>((r) => hungSmtp.close(() => r()));
    await app?.close();
    await dispatcher?.end();
    await admin.query("DROP OWNED BY " + role).catch(() => {});
    await admin.query("DROP ROLE IF EXISTS " + role);
    await new Promise<void>((r) => sink.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

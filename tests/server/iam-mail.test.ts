import { test, after } from "node:test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "../../server/src/db.js";
import { deliverInvitationsSmtp } from "../../server/src/mail.js";
import { deliverAccountMail } from "../../server/src/account-mail.js";
import { startSmtpSink, sendLocalMail } from "../../server/src/smtp.js";
import { configureIamMail } from "../../server/iam-mail/config.js";
import { createIamMailDaemon } from "../../server/iam-mail/daemon.js";
after(() => pool.end());
// The daemon discovers every due tenant scope. Its fixture must own a complete
// database, including when this file is part of the shared integration runner.
if (process.env.IAM_MAIL_PROOF_CHILD !== "1")
  test("IAM mail daemon owns an isolated database", async () => {
    const adminUrl = new URL(
      process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
    );
    const parentRuntime = new URL(
      process.env.DATABASE_URL ?? "postgres://invalid/",
    );
    if (
      !/^\/orgmap_(?:test_[a-f0-9]{16,32}|iam_mail_[a-f0-9]{32})$/.test(
        adminUrl.pathname,
      ) ||
      parentRuntime.pathname !== adminUrl.pathname ||
      parentRuntime.host !== adminUrl.host
    )
      throw Error("EXCLUSIVE_IAM_MAIL_PARENT_DATABASE_REQUIRED");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname))
      throw Error("LOCAL_DATABASE_REQUIRED");
    const operator = new pg.Pool({ connectionString: adminUrl.href });
    const name = "orgmap_iam_mail_" + randomUUID().replaceAll("-", "");
    const migration = new URL(adminUrl);
    migration.pathname = "/" + name;
    const runtime = new URL(
      process.env.DATABASE_URL ??
        "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
    );
    runtime.pathname = "/" + name;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MIGRATION_DATABASE_URL: migration.href,
      DATABASE_URL: runtime.href,
      MIGRATION_MAX_PREFIX: "999",
      IAM_MAIL_PROOF_CHILD: "1",
    };
    // node:test marks children as its own worker; a nested runner must start fresh.
    delete env.NODE_TEST_CONTEXT;
    const run = async (args: string[]) =>
      new Promise<void>((yes, no) => {
        const child = spawn(process.execPath, ["--import", "tsx", ...args], {
          env,
          stdio: "inherit",
        });
        child.on("error", no);
        child.on("exit", (code) =>
          code === 0 ? yes() : no(Error("IAM_MAIL_ISOLATED_FAILED:" + code)),
        );
      });
    let created = false;
    try {
      await operator.query('CREATE DATABASE "' + name + '"');
      created = true;
      await run(["server/src/migrate.ts"]);
      await run(["--test", "tests/server/iam-mail.test.ts"]);
    } finally {
      try {
        if (created)
          await operator.query(
            'DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)',
          );
      } finally {
        await operator.end();
      }
    }
  });
else
  test("automatic IAM recovery SMTP, cancellation, retry/backoff, metadata-only credential and stale fences", async () => {
    if (
      !/^\/orgmap_iam_mail_[a-f0-9]{32}$/.test(
        new URL(process.env.DATABASE_URL!).pathname,
      )
    )
      throw Error("EXCLUSIVE_IAM_MAIL_DATABASE_REQUIRED");
    const childRuntime = new URL(process.env.DATABASE_URL!);
    const childAdmin = new URL(
      process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
    );
    if (
      childAdmin.pathname !== childRuntime.pathname ||
      childAdmin.host !== childRuntime.host ||
      !["127.0.0.1", "localhost", "[::1]"].includes(childRuntime.hostname)
    )
      throw Error("EXCLUSIVE_IAM_MAIL_DATABASE_REQUIRED");
    const directory = await mkdtemp(join(tmpdir(), "iam-mail-"));
    const sink = await startSmtpSink({ port: 0, directory });
    const port = (sink.address() as any).port;
    const account = randomUUID(),
      recovery = randomUUID(),
      job = randomUUID();
    const admin = new pg.Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const role =
      "orgmap_iam_mail_local_" + randomUUID().replaceAll("-", "").slice(0, 16);
    let dispatch: pg.Pool | undefined;
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash,display_name) VALUES($1,$2,'unused','Mail test')",
        [account, account + "@local.test"],
      );
      await pool.query(
        "INSERT INTO password_recovery(id,account_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '30 minutes')",
        [recovery, account, randomUUID()],
      );
      await pool.query(
        "INSERT INTO account_mail(id,account_id,recovery_id,email,token) VALUES($1,$2,$3,$4,'secret-test')",
        [job, account, recovery, account + "@local.test"],
      );
      await deliverAccountMail(async () => {
        throw Error("offline");
      });
      assert.equal(
        (await pool.query("SELECT state FROM account_mail WHERE id=$1", [job]))
          .rows[0].state,
        "FAILED",
      );
      assert.equal(
        await deliverAccountMail(async () => {
          throw Error("must back off");
        }),
        0,
      );
      await pool.query(
        "UPDATE account_mail SET next_attempt_at=clock_timestamp()",
      );
      const config = await configureIamMail({
        adminUrl: process.env.MIGRATION_DATABASE_URL,
        file: join(directory, "dispatch.env"),
        role,
      });
      const { readFile } = await import("node:fs/promises");
      const url = (await readFile(config.file, "utf8")).trim().split("=")[1];
      dispatch = new pg.Pool({ connectionString: url });
      await assert.rejects(
        dispatch.query("SELECT token FROM account_mail"),
        /permission denied/,
      );
      const daemon = createIamMailDaemon(dispatch, {
        account: () => deliverAccountMail((m) => sendLocalMail(m, port)),
        invitation: (org) =>
          deliverInvitationsSmtp(org, (m) => sendLocalMail(m, port), async (c, organizationId, delivery) => {
            // This daemon test owns a synthetic invitation; admission policy is
            // exercised separately by the real invitation integration suite.
            const result = await c.query(
              "SELECT email FROM invitations WHERE organization_id=$1 AND id=$2 AND status='PENDING' AND expires_at>clock_timestamp()",
              [organizationId, delivery.invitation_id],
            );
            return result.rows[0] ?? null;
          }),
        enrollment: async () => {
          throw Error("unexpected");
        },
      });
      await daemon.tick();
      assert.equal(
        (await readdir(directory)).filter((x) => x.endsWith(".eml")).length,
        1,
      );
      assert.equal(
        (
          await pool.query("SELECT state,token FROM account_mail WHERE id=$1", [
            job,
          ])
        ).rows[0].token,
        null,
      );
      const obsoleteLease = randomUUID();
      await pool.query(
        "UPDATE account_mail SET state='PROCESSING',token='cancel',lease_token=$2,lease_until=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp() WHERE id=$1",
        [job, obsoleteLease],
      );
      await pool.query(
        "UPDATE password_recovery SET used_at=clock_timestamp() WHERE id=$1",
        [recovery],
      );
      await daemon.tick();
      assert.equal(
        (await pool.query("SELECT state FROM account_mail WHERE id=$1", [job]))
          .rows[0].state,
        "CANCELLED",
      );
      assert.equal(
        (
          await pool.query(
            "UPDATE account_mail SET state='DELIVERED' WHERE id=$1 AND lease_token=$2",
            [job, obsoleteLease],
          )
        ).rowCount,
        0,
      );
      const org = randomUUID(),
        invite = randomUUID(),
        delivery = randomUUID();
      await admin.query(
        "INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Mail org','pt-BR','UTC')",
        [org],
      );
      await admin.query(
        "INSERT INTO invitations(organization_id,id,email,token_hash,expires_at) VALUES($1,$2,'invite@local.test',$3,clock_timestamp()+interval '1 hour')",
        [org, invite, randomUUID()],
      );
      await admin.query(
        "INSERT INTO invitation_delivery(organization_id,id,invitation_id,token) VALUES($1,$2,$3,'invite-token')",
        [org, delivery, invite],
      );
      await daemon.tick();
      assert.equal(
        (
          await admin.query(
            "SELECT state FROM invitation_delivery WHERE id=$1",
            [delivery],
          )
        ).rows[0].state,
        "DELIVERED",
      );
      await admin.query(
        "UPDATE invitation_delivery SET state='PENDING',token='revoked',next_attempt_at=clock_timestamp() WHERE id=$1",
        [delivery],
      );
      await admin.query("UPDATE invitations SET status='REVOKED' WHERE id=$1", [
        invite,
      ]);
      await daemon.tick();
      assert.equal(
        (
          await admin.query(
            "SELECT state FROM invitation_delivery WHERE id=$1",
            [delivery],
          )
        ).rows[0].state,
        "CANCELLED",
      );
      assert.equal(
        (
          await dispatch.query(
            "SELECT iam_mail_release('ACCOUNT','00000000-0000-0000-0000-000000000000',$1) AS ok",
            [randomUUID()],
          )
        ).rows[0].ok,
        false,
      );
    } finally {
      await dispatch?.end();
      await admin.query("DROP OWNED BY " + role).catch(() => {});
      await admin.query("DROP ROLE IF EXISTS " + role);
      await admin.end();
      await new Promise<void>((r) => sink.close(() => r()));
      await rm(directory, { recursive: true, force: true });
    }
  });

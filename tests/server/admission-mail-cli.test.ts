import { createServer, type AddressInfo, type Socket } from "node:net";
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
import {
  startSmtpSink,
  sendLocalMail,
  SmtpDeliveryError,
  type LocalMail,
} from "../../server/src/smtp.js";
import { configureIamMail } from "../../server/iam-mail/config.js";
import { createOrgMapIntegration } from "../../server/integration/index.js";
import { loadIntegrationOptions } from "../../server/integration/config.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import { mailText, proofToken } from "./mail-fixture.js";

const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/"),
  operator = new URL(
    process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
  );
if (
  !/^\/orgmap_admission_mail_[a-f0-9]{16}$/.test(runtime.pathname) ||
  runtime.pathname !== operator.pathname ||
  runtime.host !== operator.host ||
  ![runtime, operator].every(
    (url) =>
      url.protocol === "postgres:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
  )
)
  throw Error("EXCLUSIVE_ADMISSION_MAIL_DATABASE_REQUIRED");
process.env.ORGMAP_PUBLIC_URL = "http://localhost:5173";
const admin = new pg.Pool({ connectionString: operator.href });
after(async () => {
  await pool.end();
  await admin.end();
});

type User = { id: string; email: string; cookie: string; csrf: string };
type App = Awaited<ReturnType<typeof buildApp>>;
let requestAddress = 0;
async function call(
  app: App,
  method: any,
  path: string,
  payload?: any,
  user?: User,
  headers: any = {},
) {
  return app.inject({
    method,
    url: "/api/v1" + path,
    payload,
    remoteAddress: "192.0.2." + ((++requestAddress % 250) + 1),
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...headers,
    },
  });
}
function data(response: any, statuses = [200, 201]) {
  assert.ok(statuses.includes(response.statusCode), response.body);
  return response.json().data;
}
async function user(app: App): Promise<User> {
  const email = randomUUID() + "@example.test";
  const response = await call(app, "POST", "/auth/register", {
    email,
    password: "Admission-mail-synthetic-739!",
    displayName: "Global name preserved",
  });
  const result = data(response);
  return {
    id: result.account.id,
    email,
    cookie: response.cookies[0].name + "=" + response.cookies[0].value,
    csrf: result.csrfToken,
  };
}
async function organization(app: App, owner: User) {
  const result = data(
    await call(
      app,
      "POST",
      "/organizations",
      { name: "Synthetic mail isolation" },
      owner,
    ),
  );
  return {
    id: result.organization.id as string,
    base: "/organizations/" + result.organization.id,
  };
}
const configuration = (patch: any = {}) => ({
  registrationMode: "OPEN",
  allowedDomains: ["example.test"],
  membersMayInvite: true,
  limitMemberInvitesToDomains: false,
  invitationLinkEnabled: true,
  ...patch,
});
async function policy(
  app: App,
  org: ReturnType<typeof organization> extends Promise<infer O> ? O : never,
  owner: User,
  patch: any = {},
) {
  const path = org.base + "/administration/admission-policy";
  const before = data(await call(app, "GET", path, undefined, owner)).policy;
  return data(
    await call(app, "PUT", path, configuration(patch), owner, {
      "if-match": '"' + before.revision + '"',
    }),
  ).policy;
}
async function until(check: () => Promise<boolean>, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("WAIT_TIMEOUT");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
  try {
    assert.equal(await exited, 0, "CLI must stop gracefully");
  } finally {
    clearTimeout(timer);
  }
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "orgmap-admission-mail-"));
  const smtpDirectory = join(directory, "smtp");
  const sink = await startSmtpSink({ port: 0, directory: smtpDirectory });
  const port = (sink.address() as AddressInfo).port;
  const config = {
    blobsDirectory: join(directory, "blobs"),
    smtp: { host: "127.0.0.1", port },
  };
  const configFile = join(directory, "integration.json");
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  let core!: ModuleRuntime;
  const app = await buildApp(
    [
      createOrgMapIntegration(await loadIntegrationOptions(configFile)),
      async (_app, runtime) => {
        core = runtime;
      },
    ],
    { migrationMaxPrefix: 999 },
  );
  await app.ready();
  return {
    app,
    core,
    directory,
    smtpDirectory,
    port,
    config,
    configFile,
    async close() {
      await app.close();
      await new Promise<void>((resolve) => sink.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function messages(directory: string) {
  return Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith(".eml"))
      .map((name) => readFile(join(directory, name), "utf8")),
  );
}
function token(mail: string) {
  return proofToken(mail);
}
function messageId(mail: string) {
  return /^Message-ID: (.+)$/m.exec(mail)?.[1].trim();
}
async function job(
  table: "admission_mail" | "invitation_delivery",
  id: string,
) {
  return (await admin.query("SELECT * FROM " + table + " WHERE id=$1", [id]))
    .rows[0];
}

test(
  "MAIL01: real private-config CLI delivers HTTP-issued admission, survives SIGKILL and preserves membership/quota/B",
  { timeout: 90000 },
  async () => {
    const f = await fixture();
    const role =
      "orgmap_iam_mail_local_" + randomUUID().replaceAll("-", "").slice(0, 16);
    console.log("admission-mail-fixture-role", role);
    let child: ChildProcess | undefined, dispatcher: pg.Pool | undefined;
    let noTransport: App | undefined,
      logs = "",
      stalledMail: string | undefined;
    const sockets = new Set<Socket>();
    const stalledSmtp = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.setEncoding("utf8");
      socket.write("220 fixture.local ESMTP\r\n");
      let buffer = "",
        inData = false,
        lines: string[] = [];
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (inData) {
            if (line === ".") {
              stalledMail = lines.join("\r\n") + "\r\n";
              inData = false;
            } else lines.push(line.startsWith("..") ? line.slice(1) : line);
          } else if (line === "DATA") {
            inData = true;
            socket.write("354 send data\r\n");
          } else socket.write("250 OK\r\n");
        }
      });
    });
    let listening = false;
    const protectedValues: string[] = [];
    try {
      assert.equal((await stat(f.configFile)).mode & 0o077, 0);
      const owner = await user(f.app),
        target = await user(f.app),
        linkTarget = await user(f.app);
      const A = await organization(f.app, owner),
        B = await organization(f.app, target);
      const bBefore = (
        await admin.query(
          "SELECT id,account_id,status,member_type,org_role,version FROM members WHERE organization_id=$1",
          [B.id],
        )
      ).rows;
      const globalBefore = (
        await admin.query(
          "SELECT email,display_name,password_hash,password_enabled FROM accounts WHERE id=$1",
          [target.id],
        )
      ).rows[0];
      const path = A.base + "/administration/admission-policy";
      const initial = data(
        await call(f.app, "GET", path, undefined, owner),
      ).policy;
      assert.equal(initial.registrationMode, "DISABLED");
      assert.equal(initial.revision, 0);
      assert.equal(
        (await call(f.app, "POST", A.base + "/admission/requests", {}, target))
          .statusCode,
        404,
      );
      // Default DISABLED still allows the existing explicit OWNER nominal flow.
      const nominalEmail = randomUUID() + "@outside.test";
      const personalMessage =
        "<script>literal body</script>\r\nBcc: body text only";
      const nominal = data(
        await call(
          f.app,
          "POST",
          A.base + "/invitations",
          {
            email: nominalEmail,
            firstName: "<Ana & Bia>",
            lastName: "Nominal",
            personalMessage,
          },
          owner,
        ),
      );
      noTransport = await buildApp(
        [
          createOrgMapIntegration({
            blobsDirectory: join(f.directory, "no-transport"),
          }),
        ],
        { migrationMaxPrefix: 999 },
      );
      await noTransport.ready();
      const unavailable = await call(
        noTransport,
        "PUT",
        path,
        configuration(),
        owner,
        { "if-match": '"0"' },
      );
      assert.equal(unavailable.statusCode, 503, unavailable.body);
      assert.equal(
        data(await call(noTransport, "GET", path, undefined, owner)).policy
          .revision,
        0,
      );
      await noTransport.close();
      noTransport = undefined;
      const active = await policy(f.app, A, owner);
      assert.equal(active.registrationMode, "OPEN");
      assert.equal(active.revision, 1);
      const batchEmail = randomUUID() + "@outside.test";
      const batch = data(
        await call(
          f.app,
          "POST",
          A.base + "/invitations/batch",
          {
            items: [
              {
                clientRef: "one",
                email: batchEmail,
                firstName: "<Batch>",
                lastName: "Literal",
              },
            ],
            personalMessage,
          },
          owner,
        ),
      );
      assert.equal(batch.results[0].status, "QUEUED");
      const pending = data(
        await call(f.app, "POST", A.base + "/admission/requests", {}, target),
        [202],
      );
      assert.equal(
        (
          await admin.query(
            "SELECT 1 FROM members WHERE organization_id=$1 AND account_id=$2",
            [A.id, target.id],
          )
        ).rowCount,
        0,
      );
      const admissionJob = (
        await admin.query("SELECT id FROM admission_mail WHERE request_id=$1", [
          pending.requestId,
        ])
      ).rows[0].id;
      const envFile = join(f.directory, "dispatcher.env");
      await configureIamMail({ adminUrl: operator.href, file: envFile, role });
      assert.equal((await stat(envFile)).mode & 0o077, 0);
      const dispatchUrl = (await readFile(envFile, "utf8"))
        .trim()
        .replace(/^IAM_MAIL_DISPATCH_DATABASE_URL=/, "");
      protectedValues.push(
        new URL(dispatchUrl).password,
        target.email,
        linkTarget.email,
        nominalEmail,
        batchEmail,
      );
      dispatcher = new pg.Pool({ connectionString: dispatchUrl });
      for (const sql of [
        "SELECT token FROM admission_mail",
        "SELECT email FROM admission_requests",
        "SELECT token FROM invitation_delivery",
        "SELECT email FROM accounts",
      ])
        await assert.rejects(dispatcher.query(sql), /permission denied/);
      const scopes = (await dispatcher.query("SELECT * FROM iam_mail_claim()"))
        .rows;
      assert.ok(
        scopes.some(
          (scope) =>
            scope.kind === "ADMISSION" && scope.organization_id === A.id,
        ),
      );
      for (const scope of scopes) {
        assert.deepEqual(Object.keys(scope).sort(), [
          "kind",
          "lease_token",
          "organization_id",
        ]);
        await dispatcher.query("SELECT iam_mail_release($1,$2,$3)", [
          scope.kind,
          scope.organization_id,
          scope.lease_token,
        ]);
      }
      const start = () => {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          IAM_MAIL_ENV_FILE: envFile,
          ORGMAP_INTEGRATION_CONFIG: f.configFile,
        };
        delete env.SMTP_PORT;
        delete env.IAM_MAIL_DISPATCH_DATABASE_URL;
        delete env.NODE_TEST_CONTEXT;
        const processChild = spawn(
          process.execPath,
          ["--import", "tsx", "scripts/iam-mail.ts"],
          { env, stdio: ["ignore", "pipe", "pipe"] },
        );
        processChild.stdout?.on("data", (value) => {
          logs += value.toString();
        });
        processChild.stderr?.on("data", (value) => {
          logs += value.toString();
        });
        return processChild;
      };
      child = start();
      await until(async () => {
        assert.equal(child!.exitCode, null, "CLI exited unexpectedly");
        return (
          (await job("admission_mail", admissionJob)).state === "DELIVERED" &&
          (await job("invitation_delivery", nominal.deliveryJobId)).state ===
            "DELIVERED" &&
          (await job("invitation_delivery", batch.results[0].deliveryJobId))
            .state === "DELIVERED"
        );
      });
      await stop(child);
      assert.equal(child.exitCode, 0);
      child = undefined;
      const firstMessages = await messages(f.smtpDirectory);
      assert.equal(firstMessages.length, 3);
      for (const [email, name] of [
        [nominalEmail, "<Ana & Bia> Nominal"],
        [batchEmail, "<Batch> Literal"],
      ]) {
        const mail = firstMessages.find((message) =>
          message.includes("To: <" + email + ">"),
        )!;
        assert.ok(mail);
        const [headers, ...parts] = mail.split("\r\n\r\n");
        assert.match(headers, /Content-Type: multipart\/alternative/);
        assert.ok(!headers.includes("Bcc:"));
        assert.ok(mailText(mail).includes(name));
        assert.ok(mailText(mail).includes(personalMessage));
        protectedValues.push(token(mail));
      }
      const delivered = firstMessages.find((message) =>
        message.includes("To: <" + target.email + ">"),
      )!;
      assert.equal(messageId(delivered), "<" + admissionJob + "@orgmap.local>");
      const mailboxToken = token(delivered);
      protectedValues.push(mailboxToken);
      const completionKey = randomUUID();
      const completePath =
        A.base + "/admission/requests/" + pending.requestId + "/complete";
      assert.equal(
        data(
          await call(f.app, "POST", completePath, { mailboxToken }, target, {
            "idempotency-key": completionKey,
          }),
        ).state,
        "JOINED",
      );
      data(
        await call(f.app, "POST", completePath, { mailboxToken }, target, {
          "idempotency-key": completionKey,
        }),
      );

      const issuedLink = data(
        await call(f.app, "POST", A.base + "/invitation-links", {}, owner, {
          "if-match": '"0"',
        }),
      );
      protectedValues.push(issuedLink.linkToken);
      const linkPending = data(
        await call(
          f.app,
          "POST",
          A.base + "/admission/link-requests",
          { linkToken: issuedLink.linkToken },
          linkTarget,
        ),
        [202],
      );
      const retryJob = (
        await admin.query("SELECT id FROM admission_mail WHERE request_id=$1", [
          linkPending.requestId,
        ])
      ).rows[0].id;
      await new Promise<void>((resolve) =>
        stalledSmtp.listen(0, "127.0.0.1", resolve),
      );
      listening = true;
      await writeFile(
        f.configFile,
        JSON.stringify({
          ...f.config,
          smtp: {
            host: "127.0.0.1",
            port: (stalledSmtp.address() as AddressInfo).port,
          },
        }),
        { mode: 0o600 },
      );
      child = start();
      await until(
        async () =>
          (await job("admission_mail", retryJob)).state === "PROCESSING" &&
          !!stalledMail,
      );
      const processing = await job("admission_mail", retryJob);
      const scope = (
        await admin.query(
          "SELECT lease_token FROM iam_mail_scope_leases WHERE kind='ADMISSION' AND organization_id=$1",
          [A.id],
        )
      ).rows[0];
      // DATA is stalled after validation. Neither the organization nor the job is locked by SMTP.
      const probe = await admin.connect();
      try {
        await probe.query("BEGIN");
        await probe.query(
          "SELECT id FROM organizations WHERE id=$1 FOR UPDATE NOWAIT",
          [A.id],
        );
        await probe.query(
          "SELECT id FROM admission_mail WHERE id=$1 FOR UPDATE NOWAIT",
          [retryJob],
        );
        await probe.query("ROLLBACK");
      } finally {
        probe.release();
      }
      const exited = new Promise<void>((resolve) =>
        child!.once("exit", () => resolve()),
      );
      child.kill("SIGKILL");
      await exited;
      assert.equal(child.signalCode, "SIGKILL");
      child = undefined;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => stalledSmtp.close(() => resolve()));
      listening = false;
      assert.equal((await job("admission_mail", retryJob)).state, "PROCESSING");
      // Only this fixture's leases are expired, using the PostgreSQL clock.
      await admin.query(
        "UPDATE admission_mail SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1 AND lease_token=$2",
        [retryJob, processing.lease_token],
      );
      await admin.query(
        "UPDATE iam_mail_scope_leases SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='ADMISSION' AND organization_id=$1 AND lease_token=$2",
        [A.id, scope.lease_token],
      );
      await writeFile(f.configFile, JSON.stringify(f.config), { mode: 0o600 });
      child = start();
      await until(async () => {
        assert.equal(child!.exitCode, null, "CLI exited unexpectedly");
        return (await job("admission_mail", retryJob)).state === "OUTCOME_UNKNOWN";
      });
      await stop(child);
      assert.equal(child.exitCode, 0);
      child = undefined;
      const recovered = await job("admission_mail", retryJob);
      assert.equal(recovered.attempts, 2);
      assert.ok(recovered.token);
      assert.equal(recovered.last_error, "EFFECT_OUTCOME_UNRESOLVED");
      assert.equal(
        (
          await admin.query(
            "UPDATE admission_mail SET state='FAILED' WHERE id=$1 AND lease_token=$2 RETURNING id",
            [retryJob, processing.lease_token],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await dispatcher.query(
            "SELECT iam_mail_heartbeat('ADMISSION',$1,$2) AS alive",
            [A.id, scope.lease_token],
          )
        ).rows[0].alive,
        false,
      );
      assert.equal(
        (
          await dispatcher.query(
            "SELECT iam_mail_release('ADMISSION',$1,$2) AS released",
            [A.id, scope.lease_token],
          )
        ).rows[0].released,
        false,
      );
      const allMessages = await messages(f.smtpDirectory);
      assert.equal(allMessages.length, 3);
      assert.equal(allMessages.some(message => message.includes("To: <" + linkTarget.email + ">")), false, "ambiguous DATA must not be resent");
      assert.ok(stalledMail);
      assert.equal(messageId(stalledMail), "<" + retryJob + "@orgmap.local>");
      // This token was observed by the synthetic SMTP peer during DATA; the
      // delivery outcome remains unknown even though the payload was visible.
      const linkToken = token(stalledMail);
      protectedValues.push(linkToken);
      const linkComplete =
          A.base + "/admission/requests/" + linkPending.requestId + "/complete",
        replayKey = randomUUID();
      data(
        await call(
          f.app,
          "POST",
          linkComplete,
          { mailboxToken: linkToken },
          linkTarget,
          { "idempotency-key": replayKey },
        ),
      );
      data(
        await call(
          f.app,
          "POST",
          linkComplete,
          { mailboxToken: linkToken },
          linkTarget,
          { "idempotency-key": replayKey },
        ),
      );
      for (const person of [target, linkTarget]) {
        const memberships = (
          await admin.query(
            "SELECT org_role,member_type,status FROM members WHERE organization_id=$1 AND account_id=$2",
            [A.id, person.id],
          )
        ).rows;
        assert.deepEqual(memberships, [
          { org_role: "MEMBER", member_type: "MEMBER", status: "ACTIVE" },
        ]);
      }
      assert.equal(
        (
          await admin.query(
            "SELECT acceptance_count FROM admission_links WHERE organization_id=$1",
            [A.id],
          )
        ).rows[0].acceptance_count,
        1,
      );
      await policy(f.app, A, owner, {
        registrationMode: "DISABLED",
        membersMayInvite: false,
        invitationLinkEnabled: false,
      });
      assert.equal(
        data(
          await call(f.app, "POST", "/auth/recovery/request", {
            email: target.email,
          }),
        ).accepted,
        true,
      );
      const recoveryJob = (
        await admin.query("SELECT id FROM account_mail WHERE account_id=$1", [
          target.id,
        ])
      ).rows[0].id;
      child = start();
      await until(async () => {
        assert.equal(child!.exitCode, null, "CLI exited unexpectedly");
        return (
          (
            await admin.query("SELECT state FROM account_mail WHERE id=$1", [
              recoveryJob,
            ])
          ).rows[0].state === "DELIVERED"
        );
      });
      await stop(child);
      assert.equal(child.exitCode, 0);
      child = undefined;
      const recoveryMail = (await messages(f.smtpDirectory)).find((mail) =>
        mail.includes("Subject: OrgMap local password recovery"),
      )!;
      assert.ok(recoveryMail.includes("To: <" + target.email + ">"));
      protectedValues.push(token(recoveryMail));
      assert.equal((await messages(f.smtpDirectory)).length, 4);
      assert.deepEqual(
        (
          await admin.query(
            "SELECT id,account_id,status,member_type,org_role,version FROM members WHERE organization_id=$1",
            [B.id],
          )
        ).rows,
        bBefore,
      );
      assert.deepEqual(
        (
          await admin.query(
            "SELECT email,display_name,password_hash,password_enabled FROM accounts WHERE id=$1",
            [target.id],
          )
        ).rows[0],
        globalBefore,
      );
      assert.equal(
        (await admin.query("SELECT 1 FROM iam_mail_scope_leases")).rowCount,
        0,
      );
      for (const value of protectedValues)
        assert.ok(!logs.includes(value), "sensitive data in CLI output");
      assert.ok(logs.length === 0, "CLI output must remain empty");
    } finally {
      if (child) await stop(child);
      for (const socket of sockets) socket.destroy();
      if (listening)
        await new Promise<void>((resolve) =>
          stalledSmtp.close(() => resolve()),
        );
      await noTransport?.close();
      await dispatcher?.end();
      if (
        (await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
          .rowCount
      ) {
        await admin.query("DROP OWNED BY " + role);
        await admin.query("DROP ROLE " + role);
        assert.equal(
          (await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
            .rowCount,
          0,
        );
      }
      assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount, 0);
      console.log("admission-mail-fixture-role-removed", role);
      await f.close();
    }
  },
);

test(
  "MAIL02: integrated invitation retry rechecks current flags, domains, grantor and old sender cannot finalize a rotated intent",
  { timeout: 60000 },
  async () => {
    const f = await fixture();
    try {
      const owner = await user(f.app),
        inviter = await user(f.app),
        target = await user(f.app),
        A = await organization(f.app, owner);
      let inviterMembership = data(
        await call(
          f.app,
          "POST",
          A.base + "/members",
          { accountId: inviter.id },
          owner,
        ),
      ).membership;
      await policy(f.app, A, owner);
      async function failedInvitation(email: string) {
        const issued = data(
          await call(
            f.app,
            "POST",
            A.base + "/invitations",
            { email },
            inviter,
          ),
        );
        assert.equal(
          await f.core.deliverInvitationMail(A.id, async () => {
            throw new SmtpDeliveryError("NOT_SENT", "synthetic failure before transport");
          }),
          0,
        );
        const failed = await job("invitation_delivery", issued.deliveryJobId);
        assert.equal(failed.state, "FAILED");
        assert.ok(failed.token);
        await admin.query(
          "UPDATE invitation_delivery SET next_attempt_at=clock_timestamp() WHERE id=$1",
          [issued.deliveryJobId],
        );
        return issued;
      }
      async function cancelledWithoutIo(id: string) {
        let sends = 0;
        assert.equal(
          await f.core.deliverInvitationMail(A.id, async () => {
            sends++;
          }),
          0,
        );
        assert.equal(sends, 0);
        const cancelled = await job("invitation_delivery", id);
        assert.equal(cancelled.state, "CANCELLED");
        assert.equal(cancelled.token, null);
      }
      const flag = await failedInvitation(randomUUID() + "@example.test");
      await policy(f.app, A, owner, { membersMayInvite: false });
      await cancelledWithoutIo(flag.deliveryJobId);
      await policy(f.app, A, owner);
      const domain = await failedInvitation(randomUUID() + "@outside.test");
      await policy(f.app, A, owner, { limitMemberInvitesToDomains: true });
      await cancelledWithoutIo(domain.deliveryJobId);
      await policy(f.app, A, owner);
      const grantor = await failedInvitation(randomUUID() + "@example.test");
      inviterMembership = data(
        await call(
          f.app,
          "PATCH",
          A.base + "/members/" + inviterMembership.id,
          { status: "SUSPENDED" },
          owner,
          { "if-match": '"' + inviterMembership.version + '"' },
        ),
      ).membership;
      await cancelledWithoutIo(grantor.deliveryJobId);
      // Restore through the explicit versioned membership command; policy does not reactivate it.
      data(
        await call(
          f.app,
          "PATCH",
          A.base + "/members/" + inviterMembership.id,
          { status: "ACTIVE" },
          owner,
          { "if-match": '"' + inviterMembership.version + '"' },
        ),
      );

      const issued = data(
        await call(
          f.app,
          "POST",
          A.base + "/invitations",
          { email: target.email },
          inviter,
        ),
      );
      let release!: () => void,
        oldMail: LocalMail | undefined,
        workerError: unknown;
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      const oldWorker = f.core
        .deliverInvitationMail(A.id, async (mail) => {
          oldMail = mail;
          await resume;
          await sendLocalMail(mail, f.port);
        })
        .catch((error) => {
          workerError = error;
          return -1;
        });
      let oldLease: string | undefined,
        rotated: any,
        oldResult: number | undefined;
      try {
        await until(async () => {
          if (workerError) throw workerError;
          return !!oldMail;
        });
        oldLease = (await job("invitation_delivery", issued.deliveryJobId))
          .lease_token;
        const probe = await admin.connect();
        try {
          await probe.query("BEGIN");
          await probe.query(
            "SELECT id FROM organizations WHERE id=$1 FOR UPDATE NOWAIT",
            [A.id],
          );
          await probe.query(
            "SELECT id FROM invitation_delivery WHERE id=$1 FOR UPDATE NOWAIT",
            [issued.deliveryJobId],
          );
          await probe.query("ROLLBACK");
        } finally {
          probe.release();
        }
        // Rotation is a real command that revokes the old token and its in-flight job.
        rotated = data(
          await call(
            f.app,
            "POST",
            A.base +
              "/invitations/" +
              issued.invitation.id +
              "/actions/change-access",
            { personalMessage: "New current intent" },
            inviter,
            { "if-match": '"' + issued.invitation.version + '"' },
          ),
        );
        const oldAcceptance = await call(
          f.app,
          "POST",
          "/invitations/accept",
          { token: proofToken(oldMail!.text) },
          target,
        );
        assert.equal(oldAcceptance.statusCode, 404, oldAcceptance.body);
      } finally {
        release();
        oldResult = await oldWorker;
      }
      assert.equal(oldResult, 0);
      const fenced = await job("invitation_delivery", issued.deliveryJobId);
      assert.equal(fenced.state, "CANCELLED");
      assert.equal(fenced.token, null);
      assert.notEqual(
        (await job("invitation_delivery", rotated.deliveryJobId)).lease_token,
        oldLease,
      );
      assert.equal(
        await f.core.deliverInvitationMail(A.id, (mail) =>
          sendLocalMail(mail, f.port),
        ),
        1,
      );
      const mails = await messages(f.smtpDirectory);
      assert.equal(mails.length, 2); // Already-started remote mail cannot be undone.
      const current = mails.find((mail) =>
        mail.includes("New current intent"),
      )!;
      data(
        await call(
          f.app,
          "POST",
          "/invitations/accept",
          { token: token(current) },
          target,
        ),
      );
      assert.equal(
        (
          await admin.query(
            "SELECT 1 FROM members WHERE organization_id=$1 AND account_id=$2",
            [A.id, target.id],
          )
        ).rowCount,
        1,
      );
    } finally {
      await f.close();
    }
  },
);

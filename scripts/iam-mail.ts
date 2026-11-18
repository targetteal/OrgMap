import pg from "pg";
import { readFile, stat } from "node:fs/promises";
import { buildApp } from "../server/src/app.js";
import { pool } from "../server/src/db.js";
import { createOrgMapIntegration } from "../server/integration/index.js";
import { loadIntegrationOptions } from "../server/integration/config.js";
import { deliverAccountMail } from "../server/src/account-mail.js";
import { createIamMailDaemon } from "../server/iam-mail/daemon.js";
import { sendLocalMail } from "../server/src/smtp.js";
import { sendBrevoMail } from "../server/src/brevo.js";
import { configureIamMail } from "../server/iam-mail/config.js";
import { enterManagedWriter } from "../server/src/managed-writer.js";
if (process.argv.includes("--configure")) {
  console.log(await configureIamMail());
} else {
  let registration: Awaited<ReturnType<typeof enterManagedWriter>>;
  try { registration=await enterManagedWriter(); } catch(error) { await pool.end(); throw error; }
  let dispatch:pg.Pool|undefined;
  let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  try {
  let dispatchUrl = process.env.IAM_MAIL_DISPATCH_DATABASE_URL;
  if (!dispatchUrl) {
    const file = process.env.IAM_MAIL_ENV_FILE ?? ".orgmap/iam-mail.env";
    if (((await stat(file)).mode & 0o077) !== 0)
      throw Error("PRIVATE_CONFIG_REQUIRED");
    dispatchUrl = (await readFile(file, "utf8"))
      .trim()
      .replace(/^IAM_MAIL_DISPATCH_DATABASE_URL=/, "");
  }
  dispatch = new pg.Pool({ connectionString: dispatchUrl, max: 2 });
  let enrollment: ((org: string) => Promise<unknown>) | undefined;
  let invitation: ((org: string) => Promise<unknown>) | undefined;
  let admission: ((org: string) => Promise<unknown>) | undefined;
  let accountEmailChange: (() => Promise<unknown>) | undefined;
  const options = await loadIntegrationOptions();
  if (
    !process.env.BREVO_API_KEY &&
    options.smtp?.host &&
    !["localhost", "127.0.0.1", "::1"].includes(options.smtp.host)
  )
    throw Error("LOCAL_SMTP_REQUIRED");
  const sender = (message: Parameters<typeof sendLocalMail>[0]) =>
    process.env.BREVO_API_KEY
      ? sendBrevoMail(message)
      : sendLocalMail(message, options.smtp?.port);
  app = await buildApp(
    [
      createOrgMapIntegration(options),
      async (_app, core) => {
        enrollment = (org) =>
          core.deliverProvisionedEnrollmentMail(org, sender);
        invitation = (org) => core.deliverInvitationMail(org, sender);
        admission = (org) => core.deliverAdmissionMail(org, sender);
        accountEmailChange = () => core.deliverAccountEmailChangeMail(sender);
      },
    ],
    { migrationMaxPrefix: 999 },
  );
  await app.ready();
  if (!enrollment || !invitation || !admission || !accountEmailChange)
    throw Error("IAM_MAIL_HANDLERS_REQUIRED");
  const daemon = createIamMailDaemon(dispatch!, {
    account: async () => {
      await deliverAccountMail(sender);
      await accountEmailChange!();
    },
    invitation,
    admission,
    enrollment,
  });
  let stopped = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopped = true;
    });
  try {
    while (!stopped) {
      try {
        await daemon.tick();
      } catch {
        console.error("IAM_MAIL_TICK_FAILED");
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally { /* cleanup is shared with startup failure below */ }
  } finally { await app?.close(); await dispatch?.end(); await pool.end(); await registration?.release(); }
}

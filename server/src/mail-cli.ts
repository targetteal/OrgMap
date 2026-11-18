import { pool } from "./db.js";
import { buildApp } from "./app.js";
import { createOrgMapIntegration } from "../integration/index.js";
import { loadIntegrationOptions } from "../integration/config.js";
import { sendLocalMail } from "./smtp.js";
const id = process.argv[2];
if (!id) throw Error("Usage: npm run mail:deliver -- organizationUUID");
const options = await loadIntegrationOptions();
if (
  options.smtp?.host &&
  !["localhost", "127.0.0.1", "::1"].includes(options.smtp.host)
)
  throw Error("LOCAL_SMTP_REQUIRED");
let deliver: ((organizationId: string) => Promise<unknown>) | undefined;
const app = await buildApp(
  [
    createOrgMapIntegration(options),
    async (_app, core) => {
      deliver = (org) =>
        core.deliverInvitationMail(org, (message) =>
          sendLocalMail(message, options.smtp?.port),
        );
    },
  ],
  { migrationMaxPrefix: 999 },
);
try {
  if (!deliver) throw Error("INVITATION_HANDLER_REQUIRED");
  console.log({ delivered: await deliver(id) });
} finally {
  await app.close();
  await pool.end();
}

import { sendLocalMail, type LocalMail } from "./smtp.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deliverQueue } from "../iam-mail/queue.js";
import type { InvitationDeliveryValidator, InvitationDeliveryReporter } from "../iam-mail/queue.js";
export async function deliverLocalInvitations(
  organizationId: string,
  mailDir = resolve(".orgmap/mail"),
  sender?: (message: LocalMail) => Promise<void>,
  validator?: InvitationDeliveryValidator,
  reporter?: InvitationDeliveryReporter,
) {
  return deliverQueue(
    "invitation",
    organizationId,
    sender ??
      (async (message) => {
        const token = /#token=([a-f0-9]{64})(?:\s|$)/i.exec(message.text)?.[1];
        if (!token) throw Error("INVITATION_LINK_MISSING");
        await mkdir(mailDir, { recursive: true, mode: 0o700 });
        await writeFile(
          resolve(mailDir, message.id + ".json"),
          JSON.stringify({
            ...message,
            token,
          }),
          { mode: 0o600 },
        );
      }),
    validator,
    reporter,
  );
}
export async function deliverInvitationsSmtp(
  organizationId: string,
  sender: (message: LocalMail) => Promise<void> = sendLocalMail,
  validator?: InvitationDeliveryValidator,
  reporter?: InvitationDeliveryReporter,
) {
  return deliverQueue("invitation", organizationId, sender, validator, reporter);
}

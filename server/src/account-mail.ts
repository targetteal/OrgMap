import { sendLocalMail, type LocalMail } from "./smtp.js";
import { deliverQueue } from "../iam-mail/queue.js";
export async function deliverAccountMail(
  sender: (mail: LocalMail) => Promise<void> = sendLocalMail,
) {
  return deliverQueue("account", undefined, sender);
}

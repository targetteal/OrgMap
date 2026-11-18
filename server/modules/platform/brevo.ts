import { sendBrevoMail } from "../../src/brevo.js";
import type { NotificationTransport } from "./worker.js";

export class BrevoNotificationTransport implements NotificationTransport {
  async send(input: Parameters<NotificationTransport["send"]>[0]): Promise<void> {
    await sendBrevoMail({
      id: input.id,
      to: input.email,
      ...(input.content ?? {
        subject: "OrgMap notification",
        text: `An event is available in your OrgMap inbox.\n\n${input.event}`,
      }),
    });
  }
}

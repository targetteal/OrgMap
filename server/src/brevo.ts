import { SmtpDeliveryError, type LocalMail } from "./smtp.js";

const validAddress = (value: string) => /^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(value);
type HttpClient = (url: string, init: RequestInit) => Promise<Response>;

export async function sendBrevoMail(
  message: LocalMail,
  options: { apiKey?: string; from?: string; http?: HttpClient } = {},
): Promise<void> {
  const apiKey = options.apiKey ?? process.env.BREVO_API_KEY;
  const from = options.from ?? process.env.ORGMAP_MAIL_FROM;
  if (!apiKey || !from)
    throw new SmtpDeliveryError("NOT_SENT", "Brevo configuration required");
  if (!validAddress(from) || !validAddress(message.to) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(message.id) ||
      /[\r\n]/.test(message.subject) || !message.subject.trim() || !message.text.trim())
    throw new SmtpDeliveryError("NOT_SENT", "Invalid Brevo mail");

  let response: Response;
  try {
    response = await (options.http ?? fetch)("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "OrgMap", email: from },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html !== undefined ? { htmlContent: message.html } : {}),
        headers: { "X-Orgmap-Message-Id": message.id },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new SmtpDeliveryError("OUTCOME_UNKNOWN", "Brevo request outcome unknown", { cause: error });
  }
  if (response.status === 201) {
    let body: unknown;
    try { body = await response.json(); }
    catch (error) { throw new SmtpDeliveryError("OUTCOME_UNKNOWN", "Brevo response unreadable", { cause: error }); }
    if (body && typeof body === "object" && typeof (body as { messageId?: unknown }).messageId === "string") return;
    throw new SmtpDeliveryError("OUTCOME_UNKNOWN", "Brevo acceptance response incomplete");
  }
  if ([401, 403, 429].includes(response.status))
    throw new SmtpDeliveryError("NOT_SENT", `Brevo access unavailable (${response.status})`);
  if (response.status >= 400 && response.status < 500)
    throw new SmtpDeliveryError("REJECTED", `Brevo rejected mail (${response.status})`);
  throw new SmtpDeliveryError("OUTCOME_UNKNOWN", `Brevo mail outcome unknown (${response.status})`);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { sendBrevoMail } from "../../server/src/brevo.js";
import { SmtpDeliveryError } from "../../server/src/smtp.js";

const mail = { id: "message-123", to: "person@example.test", subject: "Welcome", text: "Your OrgMap invitation" };
const config = { apiKey: "test-key", from: "noreply@orgmap.work" };

test("Brevo mail sends one text message and accepts only a confirmed message ID", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  await sendBrevoMail(mail, {
    ...config,
    http: async (url, init) => {
      seen = { url, init };
      return Response.json({ messageId: "<accepted@brevo.test>" }, { status: 201 });
    },
  });
  assert.equal(seen?.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal((seen?.init.headers as Record<string, string>)["api-key"], "test-key");
  assert.deepEqual(JSON.parse(seen?.init.body as string), {
    sender: { name: "OrgMap", email: "noreply@orgmap.work" },
    to: [{ email: "person@example.test" }],
    subject: "Welcome",
    textContent: "Your OrgMap invitation",
    headers: { "X-Orgmap-Message-Id": "message-123" },
  });
});

test("Brevo mail reports rejection, rate limits, and unknown outcomes distinctly", async () => {
  const cases: [number, SmtpDeliveryError["disposition"]][] = [
    [400, "REJECTED"], [401, "NOT_SENT"], [403, "NOT_SENT"], [429, "NOT_SENT"], [500, "OUTCOME_UNKNOWN"],
  ];
  for (const [status, disposition] of cases) {
    await assert.rejects(
      sendBrevoMail(mail, { ...config, http: async () => new Response(null, { status }) }),
      (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === disposition,
    );
  }
  await assert.rejects(
    sendBrevoMail(mail, { ...config, http: async () => { throw Error("lost response"); } }),
    (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === "OUTCOME_UNKNOWN",
  );
  await assert.rejects(
    sendBrevoMail(mail, { ...config, http: async () => new Response(null, { status: 201 }) }),
    (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === "OUTCOME_UNKNOWN",
  );
});

test("Brevo mail refuses missing configuration and invalid input before HTTP", async () => {
  await assert.rejects(
    sendBrevoMail(mail, { apiKey: "", from: "" }),
    (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === "NOT_SENT",
  );
  await assert.rejects(
    sendBrevoMail({ ...mail, subject: "bad\r\nheader" }, { ...config, http: async () => { throw Error("should not call HTTP"); } }),
    (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === "NOT_SENT",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "../../packages/i18n/index.js";
import { invitationOrigin, renderInvitationMail, type InvitationMailContext } from "../../server/iam-mail/invitation-template.js";
import { sendLocalMail, startSmtpSink } from "../../server/src/smtp.js";
import { sendBrevoMail } from "../../server/src/brevo.js";

const token = "a1".repeat(32);
const origin = "https://orgmap.example.test";
const context: InvitationMailContext = {
  organizationName: "Bosque", locale: "es-ES", inviterName: "Marina",
  expiresAt: "2026-11-24T12:00:00.000Z", email: "person@example.test",
  firstName: "Ana", lastName: "", personalMessage: "Vamos trabalhar juntos!",
};

test("invitation template uses workspace locale and gives a contextual acceptance link", () => {
  const mail = renderInvitationMail(context, token, origin);
  assert.equal(mail.subject, "Marina te ha invitado a Bosque");
  assert.ok(mail.text.includes("Aceptar invitación"));
  assert.ok(mail.html.includes('<html lang="es-ES">'));
  assert.ok(mail.html.includes(">Aceptar invitación</a>"));
  assert.ok(mail.text.includes(context.email));
  assert.ok(mail.text.includes("2026") && mail.text.includes("UTC"));
  assert.ok(mail.text.includes(context.personalMessage));
  const link = new URL(origin + "/invitations/accept#token=" + token);
  assert.ok(mail.text.includes(link.href) && mail.html.includes(link.href));
  assert.equal(link.search, "");
  assert.ok(!mail.text.includes("Local token") && !mail.subject.includes("local"));
});

test("all supported invitation languages have complete localized content", () => {
  const labels = ["Aceitar convite", "Accept invitation", "Aceptar invitación", "Accepter l’invitation",
    "Einladung annehmen", "Accetta l’invito", "招待を受ける", "Uitnodiging accepteren"];
  SUPPORTED_LOCALES.forEach((locale, index) => {
    const mail = renderInvitationMail({ ...context, locale }, token, origin);
    assert.ok(mail.text.includes(labels[index]), locale);
    assert.ok(mail.html.includes('lang="' + locale + '"'), locale);
    assert.doesNotMatch(mail.text, /\{(?:name|organization|inviter|email|date)\}/);
    assert.doesNotMatch(mail.html, /\{(?:name|organization|inviter|email|date)\}/);
  });
});

test("invitation HTML escapes literal names and messages and subject cannot inject headers", () => {
  const personalMessage = '<img src=x onerror="alert(1)">\r\nBcc: literal@example.test\n& obrigado';
  const mail = renderInvitationMail({ ...context, organizationName: '<Equipe & "Parceiros">',
    inviterName: "Marina\r\nBcc: malicious@example.test", firstName: "<Ana & Bia>", personalMessage }, token, origin);
  assert.ok(mail.text.includes(personalMessage));
  assert.ok(mail.html.includes("&lt;Ana &amp; Bia&gt;"));
  assert.ok(mail.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(mail.html.includes("&lt;Equipe &amp; &quot;Parceiros&quot;&gt;"));
  assert.ok(!mail.html.includes("<img") && !mail.html.includes("<script"));
  assert.doesNotMatch(mail.subject, /[\r\n]/);
});

test("invitation origin comes only from a safe configured origin", () => {
  assert.equal(invitationOrigin({ ORGMAP_PUBLIC_URL: origin + "/", ALLOWED_ORIGINS: "https://other.test" }), origin);
  assert.equal(invitationOrigin({ ALLOWED_ORIGINS: origin + ",https://other.test" }), origin);
  assert.equal(invitationOrigin({ ALLOWED_ORIGINS: "http://orgmap.localhost:5230" }), "http://orgmap.localhost:5230");
  for (const value of ["http://public.example.test", "javascript:alert(1)", "https://u:p@example.test",
    "https://example.test/path", "https://example.test/?token=x", "https://example.test/#token=x", ""]) {
    assert.throws(() => invitationOrigin({ ORGMAP_PUBLIC_URL: value }), /INVITATION_ORIGIN/);
  }
  assert.throws(() => invitationOrigin({}), /INVITATION_ORIGIN_REQUIRED/);
  assert.throws(() => renderInvitationMail(context, "bad", origin), /INVALID_INVITATION_TOKEN/);
});

test("Brevo keeps both localized HTML and text alternatives", async () => {
  const rendered = renderInvitationMail(context, token, origin);
  let body: Record<string, unknown> | undefined;
  await sendBrevoMail({ id: "invitation-test", to: context.email, ...rendered }, {
    apiKey: "mock-key", from: "hello@example.test", http: async (_url, init) => {
      body = JSON.parse(init.body as string);
      return Response.json({ messageId: "<accepted@example.test>" }, { status: 201 });
    },
  });
  assert.equal(body?.textContent, rendered.text);
  assert.equal(body?.htmlContent, rendered.html);
  assert.equal(body?.subject, rendered.subject);
});

test("local SMTP preserves invitation alternatives and Unicode subject through MIME", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orgmap-invitation-mail-"));
  const sink = await startSmtpSink({ port: 0, directory });
  try {
    const address = sink.address();
    assert.ok(address && typeof address !== "string");
    const rendered = renderInvitationMail({ ...context, locale: "pt-BR", inviterName: "João" }, token, origin);
    await sendLocalMail({ id: "smtp-invitation-test", to: context.email, ...rendered }, address.port);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const raw = await readFile(join(directory, files[0]), "utf8");
    assert.match(raw, /MIME-Version: 1\.0/);
    assert.match(raw, /Content-Type: multipart\/alternative/);
    const subject = raw.match(/Subject: ([\s\S]*?)\r\nMIME-Version:/)![1];
    const decodedSubject = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
      .map(match => Buffer.from(match[1], "base64").toString("utf8")).join("");
    assert.equal(decodedSubject, rendered.subject);
    const alternatives = [...raw.matchAll(/Content-Type: text\/(plain|html); charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--orgmap-/g)];
    assert.equal(alternatives.length, 2);
    assert.equal(Buffer.from(alternatives[0][2], "base64").toString("utf8"), rendered.text.replace(/\r?\n/g, "\r\n"));
    assert.equal(Buffer.from(alternatives[1][2], "base64").toString("utf8"), rendered.html);
  } finally {
    await new Promise<void>((resolve, reject) => sink.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

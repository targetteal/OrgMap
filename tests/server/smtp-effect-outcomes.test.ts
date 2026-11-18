import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { LocalSmtpTransport } from "../../server/modules/platform/smtp.js";
import { randomUUID } from "node:crypto";
import { sendLocalMail, SmtpDeliveryError } from "../../server/src/smtp.js";

async function sink(mode: "reject" | "drop-data" | "accept-drop-quit", observed?: string[]) {
  const server = createServer((socket) => {
    socket.setEncoding("utf8"); socket.write("220 local test\r\n");
    let buffer = "", data = false;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0,end); buffer = buffer.slice(end+2);
        observed?.push(line);
        if (data) {
          if (line === ".") {
            data = false;
            if (mode === "reject") socket.write("550 rejected\r\n");
            else if (mode === "drop-data") socket.destroy();
            else socket.write("250 accepted\r\n");
          }
        } else if (line.startsWith("EHLO") || line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) socket.write("250 ok\r\n");
        else if (line === "DATA") { data = true; socket.write("354 send\r\n"); }
        else if (line === "QUIT") socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolve); });
  return server;
}
async function close(server: Server) { await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve())); }
const message = { id: "test-effect", to: "recipient@example.test", subject:"Test", text:"Test" };

test("SMTP uses the configured production sender in envelope and headers", async () => {
  const before = process.env.ORGMAP_MAIL_FROM;
  const observed: string[] = [];
  const server = await sink("accept-drop-quit", observed);
  try {
    process.env.ORGMAP_MAIL_FROM = "account@orgmap.work";
    await sendLocalMail(message, (server.address() as {port:number}).port);
    assert.ok(observed.includes("MAIL FROM:<account@orgmap.work>"));
    assert.ok(observed.includes("From: OrgMap <account@orgmap.work>"));
    assert.ok(observed.includes("Message-ID: <test-effect@orgmap.work>"));
    process.env.ORGMAP_MAIL_FROM = "bad\r\nBcc:someone@example.test";
    await assert.rejects(sendLocalMail(message, 1), (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === "NOT_SENT");
  } finally {
    if (before === undefined) delete process.env.ORGMAP_MAIL_FROM;
    else process.env.ORGMAP_MAIL_FROM = before;
    await close(server);
  }
});

test("SMTP distinguishes explicit rejection, ambiguous DATA, accepted then QUIT failure, and preconnect", async () => {
  for (const [mode, expected] of [["reject","REJECTED"],["drop-data","OUTCOME_UNKNOWN"]] as const) {
    const server = await sink(mode);
    try {
      const port = (server.address() as {port:number}).port;
      await assert.rejects(sendLocalMail(message,port), (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === expected);
    } finally { await close(server); }
  }
  const accepted = await sink("accept-drop-quit");
  const port = (accepted.address() as {port:number}).port;
  try { await sendLocalMail(message,port); } finally { await close(accepted); }
  await assert.rejects(sendLocalMail(message,port), (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === "NOT_SENT");
});

test("Platform SMTP uses the same acceptance and uncertainty boundaries", async () => {
  const input = {id:randomUUID(),email:"recipient@example.test",event:"Fixture"};
  for (const [mode, expected] of [["reject","REJECTED"],["drop-data","OUTCOME_UNKNOWN"]] as const) {
    const server = await sink(mode);
    try { await assert.rejects(new LocalSmtpTransport((server.address() as {port:number}).port).send(input),
      (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === expected); }
    finally { await close(server); }
  }
  const accepted = await sink("accept-drop-quit"), port=(accepted.address() as {port:number}).port;
  try { await new LocalSmtpTransport(port).send(input); } finally { await close(accepted); }
  await assert.rejects(new LocalSmtpTransport(port).send(input),
    (error: unknown) => error instanceof SmtpDeliveryError && error.disposition === "NOT_SENT");
});

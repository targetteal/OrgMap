import { createServer, createConnection, type Server } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
export type LocalMail = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  inlineBrand?: {content:Uint8Array;contentType:'image/png';cid:string};
};
export class SmtpDeliveryError extends Error {
  constructor(readonly disposition: "NOT_SENT" | "REJECTED" | "OUTCOME_UNKNOWN", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SmtpDeliveryError";
  }
}
class SmtpResponseError extends Error {
  constructor(readonly responseCode: number) { super("SMTP rejected"); }
}
const validAddress = (v: string) => /^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(v);

/** RFC 2047 encoded words preserve Unicode without requiring SMTPUTF8 headers. */
function mailSubject(value: string): string {
  if (/^[\x20-\x7e]{1,74}$/.test(value)) return value;
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (Buffer.byteLength(chunk + character, "utf8") > 40 && chunk) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(part => "=?UTF-8?B?" + Buffer.from(part, "utf8").toString("base64") + "?=").join("\r\n ");
}

const base64Body = (value: string) => Buffer.from(value.replace(/\r?\n/g, "\r\n"), "utf8")
  .toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";

function mailContent(message: LocalMail): string {
  if(message.inlineBrand){
    const brand=message.inlineBrand,boundary='orgmap-related-'+createHash('sha256').update(message.id).digest('hex').slice(0,24);
    const inner=mailContent({...message,inlineBrand:undefined}).replace(/^MIME-Version: 1\.0\r\n/,'');
    const image=Buffer.from(brand.content).toString('base64').match(/.{1,76}/g)?.join('\r\n')??'';
    return `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${boundary}"\r\n\r\n--${boundary}\r\n${inner}\r\n--${boundary}\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${brand.cid}>\r\nContent-Disposition: inline; filename="logo.png"\r\n\r\n${image}\r\n--${boundary}--`;
  }
  if (message.html === undefined) return "Content-Type: text/plain; charset=utf-8\r\n\r\n" + message.text;
  const boundary = "orgmap-" + createHash("sha256").update(message.id).digest("hex").slice(0, 32);
  const part = (kind: string, value: string) => "--" + boundary + "\r\nContent-Type: text/" + kind +
    "; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64Body(value) + "\r\n";
  return "MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n" +
    part("plain", message.text) + part("html", message.html) + "--" + boundary + "--";
}
export async function sendLocalMail(
  message: LocalMail,
  port = Number(process.env.SMTP_PORT ?? 1025),
  host = "127.0.0.1",
) {
  const from = process.env.ORGMAP_MAIL_FROM ?? "account@orgmap.local";
  const messageIdDomain = from.slice(from.lastIndexOf("@") + 1);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(host) ||
    !validAddress(message.to) ||
    !validAddress(from) ||
    !validAddress(message.id + "@" + messageIdDomain) ||
    /[\r\n]/.test(message.subject)
    || (message.inlineBrand && (!(message.inlineBrand.content instanceof Uint8Array)||!message.inlineBrand.content.byteLength||message.inlineBrand.content.byteLength>5*1024*1024||message.inlineBrand.contentType!=='image/png'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/.test(message.inlineBrand.cid)||!Buffer.from(message.inlineBrand.content).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))
  )
    throw new SmtpDeliveryError("NOT_SENT", "Invalid mail");
  let socket: ReturnType<typeof createConnection>;
  try { socket = createConnection({ host, port }); }
  catch (error) { throw new SmtpDeliveryError("NOT_SENT", "SMTP connection failed", { cause: error }); }
  socket.setTimeout(10000);
  let contentWritten = false, accepted = false;
  let buffer = "",
    queue: number[] = [],
    wake: (() => void) | undefined,
    error: Error | undefined;
  socket.on("data", (data) => {
    buffer += data.toString();
    let end;
    while ((end = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line)) {
        queue.push(Number(line.slice(0, 3)));
        wake?.();
      }
    }
  });
  socket.on("error", (e) => {
    error = e;
    wake?.();
  });
  socket.on("timeout", () => socket.destroy(Error("SMTP timeout")));
  socket.on("close", () => {
    error ??= Error("SMTP closed");
    wake?.();
  });
  async function expect(code: number) {
    while (!queue.length) {
      if (error) throw error;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
    const received = queue.shift()!;
    if (received !== code) throw new SmtpResponseError(received);
  }
  async function command(line: string, code: number) {
    socket.write(line + "\r\n");
    await expect(code);
  }
  try {
    await expect(220);
    await command("EHLO orgmap.local", 250);
    await command("MAIL FROM:<" + from + ">", 250);
    await command("RCPT TO:<" + message.to + ">", 250);
    await command("DATA", 354);
    const content = mailContent(message)
      .replace(/\r?\n/g, "\r\n")
      .replace(/^\./gm, "..");
    contentWritten = true;
    await command(
      "From: OrgMap <" + from + ">\r\nTo: <" +
        message.to +
        ">\r\nMessage-ID: <" +
        message.id +
        "@" + messageIdDomain + ">\r\nSubject: " +
        mailSubject(message.subject) +
        "\r\n" +
        content +
        "\r\n.",
      250,
    );
    accepted = true; // DATA 250 is the SMTP acceptance boundary; QUIT is cleanup only.
    try { await command("QUIT", 221); } catch { /* already accepted */ }
  } catch (error) {
    if (accepted) return;
    const disposition = !contentWritten ? "NOT_SENT" :
      error instanceof SmtpResponseError && error.responseCode >= 400 && error.responseCode <= 599
        ? "REJECTED" : "OUTCOME_UNKNOWN";
    throw new SmtpDeliveryError(disposition, "SMTP delivery failed", { cause: error });
  } finally {
    socket.destroy();
  }
}
export async function startSmtpSink(
  options: { port?: number; directory?: string } = {},
) {
  const directory = resolve(options.directory ?? ".orgmap/smtp");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const server = createServer((socket) => {
    socket.setTimeout(15000, () => socket.destroy());
    socket.setEncoding("utf8");
    socket.write("220 orgmap.local ESMTP local-only\r\n");
    let buffer = "",
      dataMode = false,
      lines: string[] = [],
      from = false,
      to = false,
      pumping = false,
      bytes = 0;
    async function line(line: string) {
      if (dataMode) {
        if (line !== ".") {
          lines.push(line.startsWith("..") ? line.slice(1) : line);
          return;
        }
        const mail = lines.join("\r\n") + "\r\n";
        const digest = createHash("sha256").update(mail).digest("hex");
        const filename = resolve(directory, digest + ".eml");
        try {
          await writeFile(filename, mail, { mode: 0o600, flag: "wx" });
        } catch (e: any) {
          if (e.code !== "EEXIST") throw e;
          if ((await readFile(filename, "utf8")) !== mail)
            throw Error("Mail collision");
        }
        dataMode = false;
        lines = [];
        from = false;
        to = false;
        socket.write("250 stored locally\r\n");
        return;
      }
      if (/^EHLO |^HELO /i.test(line)) socket.write("250 orgmap.local\r\n");
      else if (/^MAIL FROM:<[^<>\r\n]+>$/i.test(line)) {
        from = true;
        to = false;
        socket.write("250 OK\r\n");
      } else if (/^RCPT TO:<[^<>\r\n]+>$/i.test(line) && from) {
        to = true;
        socket.write("250 OK\r\n");
      } else if (line === "DATA" && from && to) {
        dataMode = true;
        lines = [];
        socket.write("354 End with dot\r\n");
      } else if (line === "QUIT") {
        socket.end("221 Bye\r\n");
      } else if (line === "RSET") {
        dataMode = false;
        from = false;
        to = false;
        lines = [];
        socket.write("250 OK\r\n");
      } else if (line === "NOOP") socket.write("250 OK\r\n");
      else socket.write("503 Bad command sequence\r\n");
    }
    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        let end;
        while ((end = buffer.indexOf("\r\n")) >= 0) {
          const current = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          await line(current);
        }
      } catch {
        socket.end("451 Local write failed\r\n");
      } finally {
        pumping = false;
      }
    }
    socket.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1048576) {
        socket.end("552 Message too large\r\n");
        return;
      }
      buffer += chunk;
      void pump();
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      options.port ?? Number(process.env.SMTP_PORT ?? 1025),
      "127.0.0.1",
      () => {
        server.off("error", reject);
        resolve();
      },
    );
  });
  return server;
}

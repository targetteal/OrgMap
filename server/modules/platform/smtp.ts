import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { SmtpDeliveryError, sendLocalMail } from "../../src/smtp.js";
class SmtpResponseError extends Error { constructor(readonly responseCode: number) { super("SMTP rejected"); } }
import type { NotificationTransport } from "./worker.js";
/** Explicitly local SMTP sink. Real TCP/SMTP acknowledgement; never reports Google/Slack delivery. */
export class LocalSmtpTransport implements NotificationTransport {
  constructor(
    private port = 1025,
    private host = "127.0.0.1",
  ) {
    if (!["127.0.0.1", "localhost", "::1"].includes(host))
      throw Error("Local SMTP host required");
  }
  async send(input: Parameters<NotificationTransport['send']>[0]) {
    if (
      !/^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(input.email) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id) ||
      /[\r\n]/.test(input.event)
    )
      throw new SmtpDeliveryError("NOT_SENT", "Invalid SMTP input");
    if (input.content) {
      const brand=input.inlineBrand;
      const html=brand&&input.content.html?input.content.html.replace(/(<body\b[^>]*>)/i,`$1<img src="cid:${brand.cid}" alt="OrgMap" style="display:block;max-width:140px;max-height:64px;margin:24px auto 0">`):input.content.html;
      return sendLocalMail({ id: input.id, to: input.email, ...input.content,html,...(brand?{inlineBrand:brand}:{}) }, this.port, this.host);
    }
    const brand = input.inlineBrand;
    if (brand && (!(brand.content instanceof Uint8Array) || !brand.content.byteLength || brand.content.byteLength > 5 * 1024 * 1024 || brand.contentType !== "image/png" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/.test(brand.cid) || !Buffer.from(brand.content).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) throw new SmtpDeliveryError("NOT_SENT", "Invalid inline brand");
    const boundary = "orgmap-" + randomUUID(), alternative = "orgmap-alt-" + randomUUID();
    const plain = "An event is available in your OrgMap inbox.";
    const contents = brand ? [
      `MIME-Version: 1.0`, `Content-Type: multipart/related; boundary="${boundary}"`, "",
      `--${boundary}`, `Content-Type: multipart/alternative; boundary="${alternative}"`, "",
      `--${alternative}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 7bit", "", plain,
      `--${alternative}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 7bit", "",
      `<!doctype html><html><body><img src="cid:${brand.cid}" alt="Organization logo"><p>${plain}</p></body></html>`,
      `--${alternative}--`, `--${boundary}`, "Content-Type: image/png", "Content-Transfer-Encoding: base64", `Content-ID: <${brand.cid}>`, 'Content-Disposition: inline; filename="logo.png"', "",
      Buffer.from(brand.content).toString("base64").match(/.{1,76}/g)!.join("\r\n"), `--${boundary}--`, ""
    ].join("\r\n") : "Content-Type: text/plain; charset=utf-8\r\n\r\n" + plain + "\r\n";
    let socket: ReturnType<typeof createConnection>;
    try { socket = createConnection({ host: this.host, port: this.port }); }
    catch (error) { throw new SmtpDeliveryError("NOT_SENT", "SMTP connection failed", { cause: error }); }
    socket.setTimeout(10000);
    let contentWritten = false, accepted = false;
    let buffer = "",
      responses: { code: number; text: string }[] = [],
      wake: (() => void) | undefined,
      error: Error | undefined;
    socket.on("data", (data) => {
      buffer += data.toString();
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3} /.test(line)) {
          responses.push({ code: Number(line.slice(0, 3)), text: line });
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
    const expect = async (codes: number[]) => {
      while (!responses.length) {
        if (error) throw error;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
      const response = responses.shift()!;
      if (!codes.includes(response.code)) throw new SmtpResponseError(response.code);
    };
    const command = async (line: string, codes: number[]) => {
      socket.write(line + "\r\n");
      await expect(codes);
    };
    try {
      await expect([220]);
      await command("EHLO orgmap.local", [250]);
      await command("MAIL FROM:<notifications@orgmap.local>", [250]);
      await command("RCPT TO:<" + input.email + ">", [250, 251]);
      await command("DATA", [354]);
      contentWritten = true;
      await command(
        "From: OrgMap <notifications@orgmap.local>\r\nTo: <" +
          input.email +
          ">\r\nMessage-ID: <" +
          input.id +
          "@orgmap.local>\r\nSubject: OrgMap notification\r\n" + contents + ".",
        [250],
      );
      accepted = true;
      try { await command("QUIT", [221]); } catch { /* DATA was already accepted */ }
    } catch (error) {
      if (accepted) return;
      const disposition = !contentWritten ? "NOT_SENT" : error instanceof SmtpResponseError && error.responseCode >= 400 && error.responseCode <= 599 ? "REJECTED" : "OUTCOME_UNKNOWN";
      throw new SmtpDeliveryError(disposition, "SMTP delivery failed", { cause: error });
    } finally {
      socket.destroy();
    }
  }
}

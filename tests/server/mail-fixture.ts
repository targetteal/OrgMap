/** Read the text alternative of synthetic SMTP mail without depending on its presentation. */
export function mailText(mail: string): string {
  const encoded = /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/.exec(mail);
  return encoded ? Buffer.from(encoded[1].replace(/\s/g, ""), "base64").toString("utf8") : mail;
}

export function proofToken(mail: string): string {
  const text = mailText(mail);
  return /#token=([a-f0-9]{64})/i.exec(text)?.[1] ?? text.trim().split(/\r?\n/).at(-1)!;
}

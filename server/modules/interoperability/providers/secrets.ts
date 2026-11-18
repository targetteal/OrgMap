import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
export type ProviderSecretScope = {
  organizationId: string;
  grantId: string;
  memberId: string;
  provider: "TRELLO";
};
export type ProviderSecretField = "ACCESS_TOKEN" | "REFRESH_TOKEN" | "PKCE_VERIFIER";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function aad(scope: ProviderSecretScope, field: ProviderSecretField) {
  if (![scope.organizationId, scope.grantId, scope.memberId].every(value => typeof value === "string" && uuid.test(value)) || scope.provider !== "TRELLO" || !["ACCESS_TOKEN", "REFRESH_TOKEN", "PKCE_VERIFIER"].includes(field)) throw Error();
  return Buffer.from(JSON.stringify(["orgmap-provider-token-v1", scope.organizationId, scope.grantId, scope.memberId, scope.provider, field]));
}
/** Explicit private operator key. No generated/default key and no plaintext fallback. */
export async function readProviderEncryptionKey(path: string): Promise<Buffer> {
  let handle;
  try {
    if (!isAbsolute(path)) throw Error();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 128 || (process.getuid && stat.uid !== process.getuid())) throw Error();
    const value = (await handle.readFile("utf8")).trim();
    if (!/^[a-f0-9]{64}$/i.test(value)) throw Error();
    return Buffer.from(value, "hex");
  } catch { throw Error("PROVIDER_ENCRYPTION_CONFIGURATION_REQUIRED"); }
  finally { await handle?.close(); }
}
function keyValid(key: Buffer) { if (!Buffer.isBuffer(key) || key.byteLength !== 32) throw Error(); }
export function sealProviderToken(key: Buffer, scope: ProviderSecretScope, field: ProviderSecretField, token: string): string {
  let clear: Buffer | undefined;
  try {
    keyValid(key);
    if (typeof token !== "string" || !token || token.length > 8192 || !/^[\x21-\x7e]+$/.test(token)) throw Error();
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad(scope, field));
    clear = Buffer.from(token);
    const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
    return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  } catch { throw Error("PROVIDER_SECRET_UNAVAILABLE"); }
  finally { clear?.fill(0); }
}
export function openProviderToken(key: Buffer, scope: ProviderSecretScope, field: ProviderSecretField, envelope: string): string {
  let clear: Buffer | undefined;
  try {
    keyValid(key);
    if (typeof envelope !== "string" || envelope.length > 12000) throw Error();
    const [version, ...parts] = envelope.split(".");
    if (version !== "v1" || parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw Error();
    const [nonce, tag, ciphertext] = parts.map(part => {
      const value = Buffer.from(part, "base64url");
      if (value.toString("base64url") !== part) throw Error();
      return value;
    });
    if (nonce.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength < 1 || ciphertext.byteLength > 8192) throw Error();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad(scope, field)); decipher.setAuthTag(tag);
    clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const token = clear.toString("utf8");
    if (!/^[\x21-\x7e]+$/.test(token)) throw Error();
    return token;
  } catch { throw Error("PROVIDER_SECRET_UNAVAILABLE"); }
  finally { clear?.fill(0); }
}

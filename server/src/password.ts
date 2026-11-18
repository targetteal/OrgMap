import { scrypt, timingSafeEqual } from "node:crypto";
import { secret, fail } from "./core.js";
let active = 0;
async function derive(password: string, salt: string, N = 131072) {
  if (active >= 2) fail(429, "RATE_LIMITED");
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        64,
        { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (e, key) => (e ? reject(e) : resolve(key)),
      ),
    );
  } finally {
    active--;
  }
}
export async function hashPassword(password: string) {
  const salt = secret(),
    hash = (await derive(password, salt)).toString("hex");
  return `scrypt:131072:8:1:${salt}:${hash}`;
}
export async function verifyPassword(password: string, stored?: string) {
  const parts = (
    stored ?? "scrypt:131072:8:1:" + "0".repeat(64) + ":" + "0".repeat(128)
  ).split(":");
  const legacy = parts.length === 3;
  const salt = parts[legacy ? 1 : 4],
    hash = parts[legacy ? 2 : 5];
  if (
    !salt ||
    !hash ||
    (!legacy && parts.slice(0, 4).join(":") !== "scrypt:131072:8:1")
  )
    return false;
  const actual = await derive(password, salt, legacy ? 16384 : 131072);
  const expected = Buffer.from(hash, "hex");
  return (
    !!stored &&
    expected.length === actual.length &&
    timingSafeEqual(actual, expected)
  );
}

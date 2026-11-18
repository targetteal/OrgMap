import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { mfaKeyPath } from "../server/src/mfa.js";
const path = mfaKeyPath();
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
const file = await open(path, "wx", 0o600);
try {
  await file.writeFile(randomBytes(32).toString("hex") + "\n");
  await file.sync();
} finally {
  await file.close();
}
console.log("MFA key configured");

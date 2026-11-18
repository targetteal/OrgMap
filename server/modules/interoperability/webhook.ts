import { createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "../../src/core.js";
// Provider adapter must hand us the exact received bytes, never reserialized JSON.
export function signWebhook(
  secret: string,
  eventId: string,
  timestamp: number,
  bytes: Buffer,
) {
  return createHmac("sha256", secret)
    .update(`${eventId}.${timestamp}.`)
    .update(bytes)
    .digest("hex");
}
export function verifyWebhook(
  secret: string,
  eventId: string,
  timestamp: number,
  bytes: Buffer,
  signature: string,
  now = Date.now(),
) {
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now / 1000 - timestamp) > 300 ||
    !eventId ||
    eventId.length > 200 ||
    !/^\w[\w.:-]*$/.test(eventId) ||
    bytes.length > 65536 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    fail(401, "WEBHOOK_SIGNATURE_INVALID");
  const expected = Buffer.from(
    signWebhook(secret, eventId, timestamp, bytes),
    "hex",
  );
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    fail(401, "WEBHOOK_SIGNATURE_INVALID");
}

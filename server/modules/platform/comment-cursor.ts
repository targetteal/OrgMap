import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fail } from "../../src/core.js";
import type { CommentPosition } from "./comments-contract.js";
import { validateCommentPosition } from "./comments.js";
type Binding = {
  organizationId: string;
  memberId: string;
  type: string;
  id: string;
  limit: number;
};
export function createCommentCursor(
  secret = process.env.ORGMAP_CURSOR_SECRET ?? randomBytes(32).toString("hex"),
) {
  if (Buffer.byteLength(secret) < 32)
    throw Error("COMMENT_CURSOR_SECRET_TOO_SHORT");
  const sign = (s: string) =>
    createHmac("sha256", secret)
      .update("platform-comments-v1\0" + s)
      .digest();
  return {
    encode(binding: Binding, position: CommentPosition) {
      const payload = Buffer.from(
        JSON.stringify({ v: 1, ...binding, position }),
      ).toString("base64url");
      return payload + "." + sign(payload).toString("base64url");
    },
    decode(value: unknown, binding: Binding): CommentPosition {
      if (
        typeof value !== "string" ||
        value.length > 2048 ||
        !/^[-\w]+\.[-\w]+$/.test(value)
      )
        fail(400, "INVALID_COMMENT_CURSOR");
      const [payload, signature] = (value as string).split("."),
        actual = Buffer.from(signature, "base64url"),
        expected = sign(payload);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        fail(400, "INVALID_COMMENT_CURSOR");
      let decoded: any;
      try {
        decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
      } catch {
        fail(400, "INVALID_COMMENT_CURSOR");
      }
      if (
        decoded.v !== 1 ||
        Object.keys(binding).some(
          (k) => decoded[k] !== binding[k as keyof Binding],
        )
      )
        fail(400, "INVALID_COMMENT_CURSOR");
      return validateCommentPosition(decoded.position);
    },
  };
}

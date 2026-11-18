import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectIncomingFile,
  incomingFileBytes,
  UPLOAD_MAX_BYTES,
} from "../../server/modules/platform/incoming-file.js";
test("platform classifier accepts opaque and textual data without execution and rejects malformed claimed formats", () => {
  const inspect = (name: string, mime: string, bytes: Buffer | string) =>
    inspectIncomingFile(name, mime, Buffer.from(bytes).toString("base64"));
  const opaque = inspect(
    "payload.bin",
    "application/octet-stream",
    Buffer.from([0, 255, 128]),
  );
  assert.equal(opaque.kind, "OPAQUE");
  assert.equal(opaque.mediaType, "application/octet-stream");
  assert.equal(opaque.validationLevel, "OPAQUE");
  const html = inspect(
    "page.html",
    "text/html",
    "<html><script>alert('literal')</script></html>",
  );
  assert.equal(html.kind, "UTF8_TEXT");
  assert.equal(html.mediaType, "text/plain");
  assert.equal(
    inspect(
      "data.bin",
      "application/octet-stream",
      '{"nested":{"purposeRich":{"literal":"<svg>"}}}',
    ).kind,
    "JSON",
  );
  const png = inspect(
    "photo.bin",
    "application/octet-stream",
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  assert.equal(png.kind, "PNG");
  assert.equal(png.validationLevel, "SIGNATURE");
  assert.throws(() => inspect("false.png", "image/png", "arbitrary"));
  assert.throws(() => inspect("false.pdf", "application/pdf", "arbitrary"));
  assert.throws(() => inspect("false.json", "application/json", "not JSON"));
  assert.throws(() =>
    inspect("active.pdf", "application/pdf", "%PDF-1.7 /JavaScript unsafe"),
  );
  assert.throws(() => inspect("../path", "application/octet-stream", "x"));
  assert.throws(() =>
    inspect("large.bin", "", Buffer.alloc(UPLOAD_MAX_BYTES + 1)),
  );
  assert.throws(() => incomingFileBytes({ ...opaque }));
  const copy = incomingFileBytes(opaque);
  copy[0] = 9;
  assert.equal(incomingFileBytes(opaque)[0], 0);
});

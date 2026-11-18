import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAccountImageDecoder,
  createAccountMediaStore,
  ACCOUNT_IMAGE_LIMITS,
} from "../../server/modules/platform/account-image.js";
import { Failure } from "../../server/src/core.js";
test("platform Account raster decoder applies orientation/crop and strips metadata with actual PNG/JPEG/WebP pixels", async () => {
  const decoder = createAccountImageDecoder();
  const photo = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
  for (const encoded of [
    photo,
    await sharp(photo).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    await sharp(photo).webp().toBuffer(),
  ]) {
    const output = await decoder.decodeAndNormalize(encoded, "PHOTO"),
      metadata = await sharp(output.bytes).metadata();
    assert.equal(output.mime, "image/png");
    assert.equal(metadata.format, "png");
    assert.ok(output.width <= 512 && output.height <= 512);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.icc, undefined);
    await sharp(output.bytes).raw().toBuffer(); // actual output pixel decode, not header-only proof
  }
  const rotated = await decoder.decodeAndNormalize(
    await sharp(photo).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    "PHOTO",
  );
  assert.deepEqual([rotated.width, rotated.height], [256, 512]);
  const explicit = await decoder.decodeAndNormalize(
    await sharp(photo).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    "COVER",
    { x: 100, y: 200, width: 300, height: 800 },
  );
  assert.deepEqual([explicit.width, explicit.height], [180, 480]);
  const colors = Buffer.from([
    255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0,
    255, 255, 255, 0, 255,
  ]);
  const grid = await sharp(colors, {
    raw: { width: 4, height: 2, channels: 3 },
  })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const cropped = await decoder.decodeAndNormalize(grid, "PHOTO", {
    x: 1,
    y: 1,
    width: 1,
    height: 1,
  });
  const pixel = await sharp(cropped.bytes).raw().toBuffer();
  assert.ok(
    pixel[0] < 30 && pixel[1] > 220 && pixel[2] < 30,
    "crop uses oriented green pixel, not pre-orientation yellow",
  );
  const cover = await decoder.decodeAndNormalize(photo, "COVER");
  assert.deepEqual([cover.width, cover.height], [960, 480]);
  await assert.rejects(
    decoder.decodeAndNormalize(photo, "PHOTO", {
      x: 1100,
      y: 0,
      width: 200,
      height: 10,
    }),
  );
  await assert.rejects(
    decoder.decodeAndNormalize(
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      "PHOTO",
    ),
  );
  await assert.rejects(
    decoder.decodeAndNormalize(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "PHOTO",
    ),
  );
  await assert.rejects(
    decoder.decodeAndNormalize(
      Buffer.alloc(ACCOUNT_IMAGE_LIMITS.inputBytes + 1),
      "PHOTO",
    ),
  );
  const other = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer(),
    frame = await sharp(other).negate().png().toBuffer();
  const animated = await sharp([frame, other], { join: { animated: true } })
    .webp({ delay: [100, 100], loop: 0 })
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(
    decoder.decodeAndNormalize(animated, "PHOTO"),
    (e) =>
      e instanceof Failure && e.code === "ACCOUNT_IMAGE_ANIMATION_UNSUPPORTED",
  );
  const overPixels = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  assert.ok(overPixels.length < ACCOUNT_IMAGE_LIMITS.inputBytes);
  await assert.rejects(
    decoder.decodeAndNormalize(overPixels, "PHOTO"),
    (e) => e instanceof Failure && e.code === "ACCOUNT_IMAGE_PIXEL_LIMIT",
  );
});
test("platform Account private store is independent of tenant context and verifies digest and owned removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orgmap-account-store-"));
  try {
    const store = createAccountMediaStore(directory),
      bytes = Uint8Array.from([1, 2, 3, 4]);
    const saved = await store.put(bytes);
    assert.deepEqual(await store.read(saved), Buffer.from(bytes));
    assert.equal((await stat(join(directory, saved.key))).mode & 0o777, 0o600);
    await assert.rejects(store.read({ ...saved, sha256: "0".repeat(64) }));
    await assert.rejects(store.read({ ...saved, key: "../escape" }));
    await store.remove(saved.key);
    await assert.rejects(store.read(saved));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

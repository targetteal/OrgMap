import { createRequire } from "node:module";
import { fail, Failure } from "../../src/core.js";
import type {
  AccountImageDecoder,
  AccountMediaStore,
  AccountMediaProvider,
  PixelRect,
} from "../../src/account-media-contract.js";
import { FilesystemBlobStore } from "./blob.js";
const require = createRequire(import.meta.url);
export const ACCOUNT_IMAGE_LIMITS = Object.freeze({
  inputBytes: 2 * 1024 * 1024,
  inputPixels: 24_000_000,
  photo: { width: 512, height: 512 },
  cover: { width: 1040, height: 480 },
  outputBytes: 2 * 1024 * 1024,
});
/** Account-only raster pipeline. No org Ctx, attachment policy, arbitrary URL or SVG parser. */
export function createAccountImageDecoder(): AccountImageDecoder {
  let sharp: any;
  try {
    sharp = require("sharp");
  } catch {
    return fail(503, "ACCOUNT_IMAGE_DECODER_UNAVAILABLE");
  }
  return {
    async decodeAndNormalize(input, kind, crop?: PixelRect) {
      if (
        !(input instanceof Uint8Array) ||
        !input.byteLength ||
        input.byteLength > ACCOUNT_IMAGE_LIMITS.inputBytes
      )
        fail(413, "ACCOUNT_IMAGE_SIZE_LIMIT");
      if (kind !== "PHOTO" && kind !== "COVER")
        fail(400, "INVALID_ACCOUNT_MEDIA_KIND");
      const data = Buffer.from(input);
      const png = data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255,
        webp =
          data.subarray(0, 4).toString() === "RIFF" &&
          data.subarray(8, 12).toString() === "WEBP";
      if (!png && !jpeg && !webp) fail(422, "ACCOUNT_IMAGE_FORMAT_UNSUPPORTED");
      const options = {
        limitInputPixels: ACCOUNT_IMAGE_LIMITS.inputPixels,
        limitInputChannels: 5,
        failOn: "warning",
        unlimited: false,
      };
      try {
        const metadata = await sharp(data, options).metadata();
        if (
          !["png", "jpeg", "webp"].includes(metadata.format) ||
          !metadata.width ||
          !metadata.height
        )
          fail(422, "ACCOUNT_IMAGE_FORMAT_UNSUPPORTED");
        if ((metadata.pages ?? 1) !== 1)
          fail(422, "ACCOUNT_IMAGE_ANIMATION_UNSUPPORTED");
        if (metadata.width * metadata.height > ACCOUNT_IMAGE_LIMITS.inputPixels)
          fail(413, "ACCOUNT_IMAGE_PIXEL_LIMIT");
        const swapped = [5, 6, 7, 8].includes(metadata.orientation),
          width = swapped ? metadata.height : metadata.width,
          height = swapped ? metadata.width : metadata.height;
        if (crop) {
          if (
            Object.keys(crop).some(
              (k) => !["x", "y", "width", "height"].includes(k),
            ) ||
            ![crop.x, crop.y, crop.width, crop.height].every(
              Number.isSafeInteger,
            ) ||
            crop.x < 0 ||
            crop.y < 0 ||
            crop.width < 1 ||
            crop.height < 1 ||
            crop.x + crop.width > width ||
            crop.y + crop.height > height
          )
            fail(422, "INVALID_ACCOUNT_IMAGE_CROP");
        }
        const bounds =
          kind === "PHOTO"
            ? ACCOUNT_IMAGE_LIMITS.photo
            : ACCOUNT_IMAGE_LIMITS.cover;
        let pipeline = sharp(data, options).rotate();
        if (crop)
          pipeline = pipeline.extract({
            left: crop.x,
            top: crop.y,
            width: crop.width,
            height: crop.height,
          });
        const result = await pipeline
          .resize({
            width: bounds.width,
            height: bounds.height,
            fit: "inside",
            withoutEnlargement: true,
          })
          .toColourspace("srgb")
          .png({ compressionLevel: 9 })
          .toBuffer({ resolveWithObject: true });
        if (
          result.data.length > ACCOUNT_IMAGE_LIMITS.outputBytes ||
          result.info.width > bounds.width ||
          result.info.height > bounds.height
        )
          fail(413, "ACCOUNT_IMAGE_SIZE_LIMIT");
        return {
          bytes: new Uint8Array(result.data),
          mime: "image/png",
          width: result.info.width,
          height: result.info.height,
        };
      } catch (error) {
        if (error instanceof Failure) throw error;
        if (error instanceof Error && /pixel limit/i.test(error.message))
          fail(413, "ACCOUNT_IMAGE_PIXEL_LIMIT");
        return fail(422, "INVALID_ACCOUNT_IMAGE");
      }
    },
  };
}
/** Private global namespace. IAM owns refs/authorization/UoW/GC; no fake organization is accepted. */
export function createAccountMediaStore(directory: string): AccountMediaStore {
  const store = new FilesystemBlobStore(directory);
  return {
    put: (bytes) => store.put(Buffer.from(bytes)),
    read: (ref) => store.read(ref.key, ref.sha256),
    remove: (key) => store.remove(key),
  };
}
export function createLocalAccountMediaProvider(options: {
  directory: string;
}): AccountMediaProvider {
  return {
    store: createAccountMediaStore(options.directory),
    decoder: createAccountImageDecoder(),
    storageNamespace: "ACCOUNT_ASSETS",
  };
}

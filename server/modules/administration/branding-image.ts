import { createRequire } from "node:module";
import { fail, Failure } from "../../src/core.js";
import { createReservedBrandingStore, type ReservedBrandingStore } from './branding-storage.js';

export const BRANDING_PURPOSES = ["WORKSPACE_LOGO", "EMAIL_LOGO", "LOGIN_BACKGROUND"] as const;
export type BrandingPurpose = typeof BRANDING_PURPOSES[number];
export type BrandingImage = { bytes: Uint8Array; mime: "image/png"; width: number; height: number };
export interface BrandingDecoder { decodeAndNormalize(input: Uint8Array, purpose: BrandingPurpose): Promise<BrandingImage> }
export interface BrandingStorage { store: ReservedBrandingStore; storageNamespace: "ORG_BRANDING" }
export const BRANDING_INPUT_BYTES = 5 * 1024 * 1024;
export const BRANDING_PIXELS = 24_000_000;
export const BRANDING_EMAIL_OUTPUT_BYTES = 512 * 1024;

/** Call with a dedicated private directory, never the Account or attachment root. */
export function createBrandingStorage(directory: string): BrandingStorage {
  return { store: createReservedBrandingStore(directory), storageNamespace: "ORG_BRANDING" };
}

/** Real decoder; input and output are bounded and the output has no source metadata. */
export function createBrandingDecoder(): BrandingDecoder {
  let sharp: any;
  try { sharp = createRequire(import.meta.url)("sharp"); }
  catch { return fail(503, "BRANDING_DECODER_UNAVAILABLE"); }
  return {
    async decodeAndNormalize(input, purpose) {
      if (!BRANDING_PURPOSES.includes(purpose)) fail(400, "INVALID_BRANDING_PURPOSE");
      if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > BRANDING_INPUT_BYTES)
        fail(413, "BRANDING_IMAGE_SIZE_LIMIT");
      const data = Buffer.from(input);
      const signature = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
        (data[0] === 255 && data[1] === 216 && data[2] === 255) ||
        (data.subarray(0,4).toString() === "RIFF" && data.subarray(8,12).toString() === "WEBP");
      if (!signature) fail(422, "BRANDING_IMAGE_FORMAT_UNSUPPORTED");
      const options = { limitInputPixels: BRANDING_PIXELS, limitInputChannels: 5, failOn: "warning", unlimited: false };
      try {
        const meta = await sharp(data, options).metadata();
        if (!['png','jpeg','webp'].includes(meta.format) || !meta.width || !meta.height)
          fail(422, "BRANDING_IMAGE_FORMAT_UNSUPPORTED");
        if ((meta.pages ?? 1) !== 1) fail(422, "BRANDING_IMAGE_ANIMATION_UNSUPPORTED");
        if (meta.width * meta.height > BRANDING_PIXELS) fail(413, "BRANDING_IMAGE_PIXEL_LIMIT");
        const swapped = [5,6,7,8].includes(meta.orientation);
        const width = swapped ? meta.height : meta.width, height = swapped ? meta.width : meta.height;
        if (purpose === "LOGIN_BACKGROUND" && (width < 2000 || height < 1500))
          fail(422, "BRANDING_BACKGROUND_DIMENSIONS");
        const bounds = purpose === "LOGIN_BACKGROUND" ? { width: 2560, height: 1920 } : purpose === "EMAIL_LOGO" ? { width: 360, height: 180 } : { width: 720, height: 720 };
        const output = await sharp(data, options).rotate().resize({ ...bounds, fit: "inside", withoutEnlargement: true })
          .toColourspace("srgb").png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
        if (output.data.length > (purpose === "EMAIL_LOGO" ? BRANDING_EMAIL_OUTPUT_BYTES : BRANDING_INPUT_BYTES)) fail(413, "BRANDING_IMAGE_SIZE_LIMIT");
        return { bytes: new Uint8Array(output.data), mime: "image/png", width: output.info.width, height: output.info.height };
      } catch (error) {
        if (error instanceof Failure) throw error;
        if (error instanceof Error && /pixel limit/i.test(error.message)) fail(413, "BRANDING_IMAGE_PIXEL_LIMIT");
        return fail(422, "INVALID_BRANDING_IMAGE");
      }
    },
  };
}

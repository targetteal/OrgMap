export type AccountMediaKind = "PHOTO" | "COVER";
export type AccountImageMime = "image/png" | "image/jpeg" | "image/webp";
/** Pixel coordinates in the raster after its orientation has been applied. */
export type PixelRect = { x: number; y: number; width: number; height: number };

export interface AccountMediaStore {
  put(
    bytes: Uint8Array,
  ): Promise<{ key: string; sha256: string; size: number }>;
  read(ref: { key: string; sha256: string }): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

/** A real raster decoder, never the attachment signature scanner. */
export interface AccountImageDecoder {
  decodeAndNormalize(
    input: Uint8Array,
    kind: AccountMediaKind,
    crop?: PixelRect,
  ): Promise<{
    bytes: Uint8Array;
    mime: AccountImageMime;
    width: number;
    height: number;
  }>;
}

export type AccountMediaProvider = {
  store: AccountMediaStore;
  decoder: AccountImageDecoder;
  storageNamespace?: string;
};

/** Internal OPS reference. This must never be returned by an HTTP DTO. */
export type AccountMediaBackupReference = {
  owner: "ACCOUNT";
  accountId: string;
  storageNamespace: string;
  kind: AccountMediaKind;
  assetId: string;
  key: string;
  sha256: string;
  size: number;
};

export type AccountMediaView = {
  kind: AccountMediaKind;
  state: "EMPTY" | "ACTIVE" | "DELETED";
  version: number;
  assetId: string | null;
  mime: AccountImageMime | null;
  width: number | null;
  height: number | null;
  size: number | null;
  updatedAt: string | null;
  readUrl: string | null;
};

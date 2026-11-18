import type { PoolClient } from "pg";
import type { Ctx } from "../../src/runtime.js";
import type { BrandingPurpose, BrandingImage } from "./branding-image.js";

/** Lifecycle authority must be implemented by LF04; fail closed if not wired. */
export interface BrandingLifecycleGate {
  assertTenantReadable(ctx: Ctx): Promise<void>;
  assertTenantWritable(ctx: Ctx): Promise<void>;
  /** This transaction must lock/check the real organization and reject closed/deleting states. */
  assertPublicReadable(c: PoolClient, organizationId: string): Promise<void>;
}
export type BrandingOrigin = "LEGACY_EXTERNAL" | "UPLOADED" | "NONE";
export type BrandingView = { purpose: BrandingPurpose; revision: number; origin: BrandingOrigin; width: number | null; height: number | null; mime: string | null; updatedAt: string | null; readUrl: string | null };
/** Server-only: the caller supplies the actual org context, never derives it from account email. */
export interface BrandingConsumers {
  workspace(ctx: Ctx): Promise<BrandingView>;
  workspaceBytes(ctx: Ctx): Promise<BrandingImage | null>;
  /** Caller installs these bytes as a MIME inline part with the returned CID. */
  emailInline(ctx: Ctx): Promise<{ content: Uint8Array; contentType: string; cid: string } | null>;
  publicBackground(ref: string): Promise<BrandingImage | null>;
}
/** Internal OPS only; these references must never be returned by a browser endpoint. */
export type BrandingBackupReference = { owner: "ORGANIZATION"; state?: "ACTIVE" | "READY"; organizationId: string; storageNamespace: "ORG_BRANDING"; purpose: BrandingPurpose; assetId: string; key: string; sha256: string; size: number };

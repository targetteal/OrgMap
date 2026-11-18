import { createHash } from "node:crypto";
import { fail } from "../../src/core.js";
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_CLASSIFIER_VERSION = "platform-file-v1";
export const UPLOAD_ALLOWLIST_KINDS = [
  "PNG",
  "PDF",
  "JSON",
  "UTF8_TEXT",
] as const;
export type AllowlistedFileKind = (typeof UPLOAD_ALLOWLIST_KINDS)[number];
export type ClassifiedFileKind = AllowlistedFileKind | "OPAQUE";
export type ValidatedIncomingFile = Readonly<{
  name: string;
  kind: ClassifiedFileKind;
  mediaType: string;
  size: number;
  digest: string;
  classifierVersion: string;
  validationLevel: "OPAQUE" | "SIGNATURE" | "STRUCTURAL" | "TEXT";
}>;
const bytes = new WeakMap<ValidatedIncomingFile, Buffer>();
export function incomingFileBytes(file: ValidatedIncomingFile) {
  const data = bytes.get(file);
  if (!data) throw Error("INSPECTED_FILE_REQUIRED");
  return Buffer.from(data);
}
/** Byte-derived classification. User hints never authorize a kind. No execution or remote inspection. */
export function inspectIncomingFile(
  name: unknown,
  mime: unknown,
  base64: unknown,
): ValidatedIncomingFile {
  if (
    typeof name !== "string" ||
    !name.length ||
    name.length > 200 ||
    /[\x00-\x1f/\\]/.test(name) ||
    name.includes("..")
  )
    fail(400, "INVALID_FILENAME");
  if (typeof mime !== "string" || mime.length > 200 || /[\x00-\x1f]/.test(mime))
    fail(400, "INVALID_FILE");
  if (
    typeof base64 !== "string" ||
    base64.length > 7_000_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    fail(400, "INVALID_FILE");
  const data = Buffer.from(base64 as string, "base64");
  if (data.length > UPLOAD_MAX_BYTES) fail(413, "FILE_TOO_LARGE");
  const hint = (mime as string).split(";")[0].trim().toLowerCase(),
    extension = (name as string).split(".").at(-1)?.toLowerCase();
  const png = data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    pdf = data.subarray(0, 5).toString() === "%PDF-";
  if ((hint === "application/json" || extension === "json") && (png || pdf))
    fail(422, "MIME_MISMATCH");
  if (
    ((hint === "image/png" || extension === "png") && !png) ||
    ((hint === "application/pdf" || extension === "pdf") && !pdf)
  )
    fail(422, "MIME_MISMATCH");
  let kind: ClassifiedFileKind = "OPAQUE",
    mediaType = "application/octet-stream",
    validationLevel: ValidatedIncomingFile["validationLevel"] = "OPAQUE";
  if (png) {
    kind = "PNG";
    mediaType = "image/png";
    validationLevel = "SIGNATURE";
  } else if (pdf) {
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(data.toString("latin1")))
      fail(422, "UNSAFE_CONTENT");
    kind = "PDF";
    mediaType = "application/pdf";
    validationLevel = "SIGNATURE";
  } else {
    let source: string | undefined;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {}
    const jsonExpected = hint === "application/json" || extension === "json";
    if (source !== undefined && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source)) {
      let json = false;
      try {
        JSON.parse(source);
        json = true;
      } catch {}
      if (json) {
        kind = "JSON";
        mediaType = "application/json";
        validationLevel = "STRUCTURAL";
      } else if (jsonExpected) fail(422, "INVALID_JSON");
      else {
        kind = "UTF8_TEXT";
        mediaType = "text/plain";
        validationLevel = "TEXT";
      }
    } else if (jsonExpected) fail(422, "INVALID_JSON");
  }
  const file = Object.freeze({
    name: name as string,
    kind,
    mediaType,
    size: data.length,
    digest: createHash("sha256").update(data).digest("hex"),
    classifierVersion: UPLOAD_CLASSIFIER_VERSION,
    validationLevel,
  });
  bytes.set(file, data);
  return file;
}

import { fail } from "../../src/core.js";
import { BRANDING_INPUT_BYTES } from "./branding-image.js";
/** Hard bound includes part headers and optional explicit publication field. */
export const BRANDING_MULTIPART_LIMIT = BRANDING_INPUT_BYTES + 16 * 1024;

/** Strict single-file multipart subset. No paths, nested multipart, encodings or unknown fields. */
export function parseBrandingMultipart(contentType: string, data: Buffer): { base64: string; publish?: true } {
  if (!Buffer.isBuffer(data) || data.length > BRANDING_MULTIPART_LIMIT) fail(413,"BRANDING_IMAGE_SIZE_LIMIT");
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([A-Za-z0-9'()+_,.\/:=?-]{1,70})"|([A-Za-z0-9'()+_,.\/:=?-]{1,70}))\s*$/i.exec(contentType);
  if (!match) fail(400,"INVALID_MULTIPART");
  const boundary=match![1] ?? match![2];
  const start=Buffer.from(`--${boundary}\r\n`), separator=Buffer.from(`\r\n--${boundary}`);
  if (!data.subarray(0,start.length).equals(start)) fail(400,"INVALID_MULTIPART");
  let pos=start.length, file: Buffer | undefined, publish=false, ended=false, count=0;
  while (pos < data.length) {
    if (++count>2) fail(400,"INVALID_MULTIPART");
    const headerEnd=data.indexOf(Buffer.from("\r\n\r\n"),pos);
    if (headerEnd<0 || headerEnd-pos>8192) fail(400,"INVALID_MULTIPART");
    const raw=data.subarray(pos,headerEnd).toString("latin1");
    // Browsers send UTF-8 file names in this header. The name is ignored for
    // storage; reject controls, while allowing these bytes inside the bounded part.
    if (/[\x00-\x1f\x7f]/.test(raw.replaceAll('\r\n', ''))) fail(400,"INVALID_MULTIPART");
    const lines=raw.split("\r\n");
    if (lines.length<1 || lines.length>2) fail(400,"INVALID_MULTIPART");
    const disposition=/^content-disposition:\s*form-data;\s*name="(file|publish)"(?:;\s*filename="([^"\r\n]{1,200})")?$/i.exec(lines[0]);
    if (!disposition || (lines[1] && !/^content-type:\s*[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/i.test(lines[1]))) fail(400,"INVALID_MULTIPART");
    const next=data.indexOf(separator,headerEnd+4);
    if (next<0) fail(400,"INVALID_MULTIPART");
    const part=data.subarray(headerEnd+4,next), name=disposition![1].toLowerCase(), filename=disposition![2];
    if(name==='file') { if(file || !filename || /[\x00-\x1f/\\]/.test(filename) || !part.length || part.length>BRANDING_INPUT_BYTES) fail(400,"INVALID_MULTIPART"); file=part; }
    else { if(publish || filename || lines.length!==1 || part.toString('ascii')!=='true') fail(400,"INVALID_MULTIPART"); publish=true; }
    pos=next+separator.length;
    if(data.subarray(pos,pos+4).equals(Buffer.from('--\r\n'))) { pos+=4; ended=true; break; }
    if(!data.subarray(pos,pos+2).equals(Buffer.from('\r\n'))) fail(400,"INVALID_MULTIPART");
    pos+=2;
  }
  if(!ended || pos!==data.length || !file) fail(400,"INVALID_MULTIPART");
  return {base64:file!.toString('base64'),...(publish?{publish:true as const}:{})};
}

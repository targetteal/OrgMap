import { mkdir, writeFile, rename, readFile, unlink, open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fail } from "../../src/core.js";
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export class FilesystemBlobStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw Error("Invalid blob key");
    return join(this.root, key);
  }
  async put(data: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = randomUUID(),
      staged = this.path(key) + ".staged";
    await writeFile(staged, data, { flag: "wx", mode: 0o600 });
    await rename(staged, this.path(key));
    return { key, size: data.length, sha256: hash(data) };
  }
  async read(key: string, sha256: string) {
    const data = await readFile(this.path(key));
    if (hash(data) !== sha256) fail(409, "BLOB_INTEGRITY_FAILED");
    return data;
  }
  /** Caller must hold the real storage/backup guard and stop all writers.
   * Inspect both names before unlinking; no storage lock is acquired here. */
  async inspectChecked(ref: {key:string;sha256:string;size:number}): Promise<'ABSENT'|'COMPLETE'|'MISMATCH'> {
    if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(ref.key) || !/^[0-9a-f]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.size) || ref.size<0) throw Error('PLATFORM_STORAGE_REFERENCE_INVALID');
    const root=await lstat(this.root);
    if(!root.isDirectory() || root.isSymbolicLink() || (root.mode&0o077))throw Error('PLATFORM_STORAGE_DIRECTORY_UNSAFE');
    let found=false;
    for(const name of [this.path(ref.key),this.path(ref.key)+'.staged']) {
      let file;try{file=await open(name,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e:any){if(e.code==='ENOENT')continue;throw e;}
      found=true;
      try {
        const st=await file.stat();if(!st.isFile() || st.size!==ref.size || (st.mode&0o077))return 'MISMATCH';
        const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let position=0;
        for(;;){const {bytesRead}=await file.read(buffer,0,buffer.length,position);if(!bytesRead)break;digest.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
        if(position!==ref.size || digest.digest('hex')!==ref.sha256)return 'MISMATCH';
      } finally {await file.close();}
    }
    return found?'COMPLETE':'ABSENT';
  }
  async removeChecked(ref: {key:string;sha256:string;size:number}):Promise<void> {
    if(await this.inspectChecked(ref)==='MISMATCH')throw Error('PLATFORM_STORAGE_GARBAGE_MISMATCH');
    for(const path of [this.path(ref.key),this.path(ref.key)+'.staged'])await unlink(path).catch((e:any)=>{if(e.code!=='ENOENT')throw e;});
    const dir=await open(this.root,constants.O_RDONLY|constants.O_NOFOLLOW);try{await dir.sync();}finally{await dir.close();}
  }
  async remove(key: string) {
    await unlink(this.path(key)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
/** Local allowlist scanner: plain UTF-8, CSV, JSON, PDF and PNG. HTML/SVG/script and binary mismatches rejected. */
export function inspectUpload(name: unknown, mime: unknown, base64: unknown) {
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 200 ||
    /[\x00-\x1f/\\]/.test(name) ||
    name.includes("..")
  )
    fail(400, "INVALID_FILENAME");
  if (
    typeof base64 !== "string" ||
    base64.length > 7_000_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    fail(400, "INVALID_FILE");
  const data = Buffer.from(base64 as string, "base64");
  if (data.length > 5 * 1024 * 1024) fail(413, "FILE_TOO_LARGE");
  const allowed = [
    "text/plain",
    "text/csv",
    "application/json",
    "application/pdf",
    "image/png",
  ];
  if (typeof mime !== "string" || !allowed.includes(mime))
    fail(422, "UNSUPPORTED_MIME");
  const m = mime as string;
  if (
    m === "image/png" &&
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    fail(422, "MIME_MISMATCH");
  if (m === "application/pdf" && data.subarray(0, 5).toString() !== "%PDF-")
    fail(422, "MIME_MISMATCH");
  if (m.startsWith("text/") || m === "application/json") {
    let source = "";
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      fail(422, "INVALID_UTF8");
    }
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source) ||
      /<\s*(script|iframe|object|html|svg)\b/i.test(source)
    )
      fail(422, "UNSAFE_CONTENT");
    if (m === "application/json")
      try {
        JSON.parse(source);
      } catch {
        fail(422, "INVALID_JSON");
      }
  }
  if (
    m === "application/pdf" &&
    /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(data.toString("latin1"))
  )
    fail(422, "UNSAFE_CONTENT");
  return { name: name as string, mime: m, data };
}

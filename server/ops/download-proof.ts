/** Runs only against the disposable restored database supplied by the OPS proof. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db.js";
import { createOrgMapIntegration } from "../integration/index.js";
if (
  !/^\/orgmap_restore_[a-f0-9]{32}$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("EXCLUSIVE_RESTORE_REQUIRED");
const fixture = JSON.parse(
  await readFile(process.env.OPS_DOWNLOAD_FIXTURE!, "utf8"),
);
const app = await buildApp(
  [
    createOrgMapIntegration({
      blobsDirectory: process.env.OPS_RESTORED_BLOBS!,
    }),
  ],
  { migrationMaxPrefix: 999 },
);
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as any).port;
  const get = async (path: string, cookie?: string) =>
    fetch("http://127.0.0.1:" + port + "/api/v1" + path, {
      headers: cookie ? { cookie } : {},
    });
  for (const check of fixture.downloads) {
    const response = await get(check.path, fixture.cookie);
    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.equal(body.data.base64, check.base64);
    assert.ok(!JSON.stringify(body).includes(process.env.OPS_RESTORED_BLOBS!));
    const denied = await get(check.path);
    assert.equal(denied.status, 401);
    const other = await get(check.path, fixture.outsiderCookie);
    assert.equal(other.status, 404);
  }
  const late = await get(fixture.latePath, fixture.cookie);
  assert.equal(late.status, 404);
  console.log(
    JSON.stringify({
      restoredHttpDownloads: fixture.downloads.length,
      bytesExact: true,
      anonymousDenied: true,
      foreignTenantDenied: true,
      lateCommitExcluded: true,
    }),
  );
} finally {
  await app.close();
  await pool.end();
}

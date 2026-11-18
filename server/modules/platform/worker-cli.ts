import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { enterManagedWriter } from "../../src/managed-writer.js";
import { pool } from "../../src/db.js";
/** Normal: composition.ts [--once]. Diagnostic: composition.ts ORG MEMBER [--once]. */
const [composition, organizationId, memberId] = process.argv
  .slice(2)
  .filter((x) => x !== "--once");
if (!composition) throw Error("Expected composition module");
let registration: Awaited<ReturnType<typeof enterManagedWriter>>;
try { registration=await enterManagedWriter(); } catch(error) { await pool.end(); throw error; }
let mod: any;
try { mod = await import(pathToFileURL(resolve(composition)).href); }
catch (error) { await registration?.release(); await pool.end(); throw error; }
let worker:any, dispatcher:any;
try { worker=organizationId && memberId ? await mod.createPlatformWorker() : null; dispatcher=worker ? null : await mod.createPlatformDispatcher(); }
catch(error) { await mod.closePlatformWorker?.(); await registration?.release(); await pool.end(); throw error; }
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
try {
  do {
    if (worker) {
      await worker.runJob(organizationId, memberId);
      await worker.runDelivery(organizationId, memberId);
      await worker.runGovernanceConsent?.(organizationId, memberId);
    } else await dispatcher.runOnce();
    if (!process.argv.includes("--once"))
      await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopped && !process.argv.includes("--once"));
} finally {
  await mod.closePlatformWorker?.();
  await registration?.release();
}

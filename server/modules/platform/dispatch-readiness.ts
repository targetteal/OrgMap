import { readiness } from "../../src/readiness.js";

// Every platform dispatch path requires the complete composed schema, including
// LF04's privileged-function fences. Failed checks are never cached as success.
let ready = false;
export async function assertPlatformDispatchReady(): Promise<void> {
  if (ready) return;
  const state = await readiness({ scope: "all" });
  if (state.status !== "ok") throw Error("PLATFORM_DISPATCH_MIGRATIONS_REQUIRED:" + state.code);
  ready = true;
}

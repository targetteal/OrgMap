import { spawn } from "node:child_process";

// Exercise the validated integrated migration plan in the canonical local,
// disposable database harness. The former selective list omitted migrations
// introduced after the governance module, including checkpoint 938.
await new Promise<void>((resolve, reject) => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/test-traceability-journey.ts", "--suite=governance"],
    { stdio: "inherit", env: process.env },
  );
  child.once("error", reject);
  child.once("exit", (code, signal) =>
    code === 0 ? resolve() : reject(Error(`GOVERNANCE_TEST_FAILED:${code}:${signal}`)),
  );
});

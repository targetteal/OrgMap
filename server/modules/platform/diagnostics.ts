import { Failure } from "../../src/core.js";
export type WorkerDiagnostic = {
  event: "platform.job.failure";
  organizationId: string;
  jobId: string;
  requestId: string | null;
  traceId: string;
  attempt: number;
  stage: string;
  code: string;
  retryable: boolean;
};
export function classifyWorkerError(error: unknown) {
  if (error instanceof Failure && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code))
    return {
      code: error.code,
      retryable: error.status >= 500 || error.status === 429,
    };
  const code = (error as { code?: string })?.code;
  return {
    code:
      code &&
      [
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOTFOUND",
        "40001",
        "40P01",
      ].includes(code)
        ? code
        : "UNEXPECTED_WORKER_ERROR",
    retryable: true,
  };
}
export function emitWorkerDiagnostic(
  value: WorkerDiagnostic,
  logger?: (value: WorkerDiagnostic) => void,
) {
  try {
    if (logger) logger(value);
    else console.warn(JSON.stringify(value));
  } catch {
    /* Diagnostics must not change committed state. */
  }
}

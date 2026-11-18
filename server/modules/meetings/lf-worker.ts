// Explicit local verification worker, pinned to the synthetic preview principal.
import {
  createPlatformWorker,
  closePlatformWorker,
} from "../../integration/index.js";
const organizationId = process.env.MEETINGS_PREVIEW_ORGANIZATION_ID!;
const memberId = process.env.MEETINGS_PREVIEW_MEMBER_ID!;
if (
  !/^\/orgmap_meetings_lf_preview_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("Disposable Meetings preview required");
const worker = await createPlatformWorker({
  blobsDirectory: process.env.PLATFORM_BLOBS_DIRECTORY!,
});
let active = Promise.resolve(),
  busy = false,
  stopped = false;
const timer = setInterval(() => {
  if (busy || stopped) return;
  busy = true;
  active = worker
    .runJob(organizationId, memberId)
    .then(
      () => {},
      (e) => {
        console.error(e);
      },
    )
    .finally(() => {
      busy = false;
    });
}, 500);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    stopped = true;
    clearInterval(timer);
    await active;
    await closePlatformWorker();
    process.exit(0);
  });
console.log("Meetings isolated worker ready; PID " + process.pid);

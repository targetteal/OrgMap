import { createLocalReportPdfRenderer } from "./report-pdf.js";
import { createReportPackageSerializer } from "./report-package.js";
import type { PdfBundlePayload } from "../meetings/export-contract.js";

export interface ReportPackageSerializer {
  assertAvailable(): Promise<void>;
  serialize(payload: PdfBundlePayload, format: "PDF" | "ZIP"): Promise<Buffer>;
}

/** Context-free renderer binding shared by HTTP enqueue and the independent worker. */
export function createLocalReportPackageSerializer(): ReportPackageSerializer {
  let ready:
    Promise<ReturnType<typeof createReportPackageSerializer>> | undefined;
  const load = () => {
    if (!ready)
      ready = createLocalReportPdfRenderer()
        .then(createReportPackageSerializer)
        .catch((error) => {
          ready = undefined;
          throw error;
        });
    return ready;
  };
  return {
    async assertAvailable() {
      await load();
    },
    async serialize(payload, format) {
      return (await load()).serialize(payload, format);
    },
  };
}

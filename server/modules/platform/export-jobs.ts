import type { Ctx } from "../../src/runtime.js";
import { fail, id, uuid } from "../../src/core.js";
import { ResourceRegistry } from "./ports.js";
import type { ReportPackageSerializer } from "./report-runtime.js";
import { formatsByKind } from "../meetings/export-contract.js";
import { isTransferKind } from "./transfer.js";
export type ExportJobRequest = {
  resourceType: string;
  resourceIds: string[];
  exportKind: string;
  /** PDF/ZIP are known contracts but require an installed renderer; enqueue otherwise503. */
  format: "JSON" | "CSV" | "XLSX" | "PDF" | "ZIP";
  includePrivate?: boolean;
  requestId: string;
};
export interface ExportJobPort {
  /** Same producer transaction. Caller owns command audit/idempotency, not an HTTP bridge. */
  enqueue(
    ctx: Ctx,
    input: ExportJobRequest,
  ): Promise<{ id: string; state: "PENDING"; version: 1 }>;
}
export function createExportJobPort(
  registry: ResourceRegistry,
  options: { reportPackages?: ReportPackageSerializer } = {},
): ExportJobPort {
  return {
    async enqueue(ctx, input) {
      if (ctx.mode === "read") fail(403, "WRITE_CONTEXT_REQUIRED");
      if (
        !input ||
        Object.keys(input).some(
          (key) =>
            ![
              "resourceType",
              "resourceIds",
              "exportKind",
              "format",
              "includePrivate",
              "requestId",
            ].includes(key),
        ) ||
        typeof input.resourceType !== "string" ||
        !/^[a-z][a-z0-9-]{0,49}$/.test(input.resourceType) ||
        !Array.isArray(input.resourceIds) ||
        input.resourceIds.length < 1 ||
        input.resourceIds.length > 1000 ||
        (input.includePrivate !== undefined &&
          typeof input.includePrivate !== "boolean") ||
        typeof input.requestId !== "string" ||
        !input.requestId.length ||
        input.requestId.length > 200 ||
        /[\x00-\x1f\x7f]/.test(input.requestId) ||
        !isTransferKind(input.exportKind) ||
        !["JSON", "CSV", "XLSX", "PDF", "ZIP"].includes(input.format) ||
        (input.resourceType === "task" &&
          !registry.exportKinds("task").includes(input.exportKind)) ||
        !registry.get(input.resourceType)?.export
      )
        fail(422, "INVALID_EXPORT");
      const ids = input.resourceIds.map((value) => id(value));
      if (input.resourceType === "publication-export" &&
          (input.exportKind !== "PUBLICATIONS" || input.format !== "ZIP" || ids.length !== 1 || input.includePrivate === true))
        fail(422, "INVALID_PUBLICATION_EXPORT");
      for (const resourceId of ids)
        await registry.require(
          ctx,
          { type: input.resourceType, id: resourceId },
          input.includePrivate === true ? "export-private" : "export",
        );
      if (
        input.resourceType === "meeting-export" &&
        !(formatsByKind as Record<string, readonly string[]>)[
          input.exportKind
        ]?.includes(input.format)
      )
        fail(422, "INVALID_EXPORT");
      if ((input.format === "PDF" || input.format === "ZIP") && input.resourceType !== "publication-export") {
        if (!options.reportPackages) fail(503, "FORMAT_CONFIGURATION_REQUIRED");
        if (input.resourceType !== "meeting-export")
          fail(422, "INVALID_EXPORT");
        await options.reportPackages!.assertAvailable();
      }
      const jobId = uuid();
      await ctx.c.query(
        "INSERT INTO platform_jobs(organization_id,id,owner_id,kind,resource_type,resource_ids,export_kind,format,request_id,include_private) VALUES($1,$2,$3,'EXPORT',$4,$5,$6,$7,$8,$9)",
        [
          ctx.org.id,
          jobId,
          ctx.member.id,
          input.resourceType,
          ids,
          input.exportKind,
          input.format,
          input.requestId,
          input.includePrivate === true,
        ],
      );
      return { id: jobId, state: "PENDING", version: 1 };
    },
  };
}

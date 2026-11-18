import type { FastifyInstance } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import { body, id, text, version, fail } from "../../src/core.js";
import {
  access,
  detail,
  saveReportVersion,
  type MeetingReadPolicy,
} from "./service.js";
import {
  archiveEpoch,
  migrateSnapshot,
  LEGACY_PROTOCOL,
  RICH_TEXT_PROTOCOL,
} from "./documents.js";
export async function registerDocumentMigration(
  app: FastifyInstance,
  core: ModuleRuntime,
  policy?: MeetingReadPolicy,
) {
  app.get(
    "/api/v1/organizations/:organizationId/meetings/:meetingId/collaboration/epochs",
    (r) =>
      core.tenant(r, { mode: "read" }, async (ctx) => {
        await core.assertResourceAvailable(ctx, "meeting");
        const mid = id((r.params as any).meetingId);
        await access(ctx, mid, "read", policy);
        const q = r.query as any;
        if (Object.keys(q).some((k) => k !== "sectionId"))
          fail(400, "INVALID_REQUEST");
        const section =
          q.sectionId === undefined ? null : text(q.sectionId, 60);
        const rows = (
          await ctx.c.query(
            "SELECT * FROM meeting_document_epochs WHERE organization_id=$1 AND meeting_id=$2 AND ($3::text IS NULL OR section_id=$3) ORDER BY section_id,epoch DESC LIMIT 1001",
            [ctx.org.id, mid, section],
          )
        ).rows;
        const hasMore = rows.length > 1000;
        if (hasMore) rows.pop();
        return {
          items: rows.map((d) => ({
            sectionId: d.section_id,
            epoch: d.epoch,
            protocol: d.protocol,
            schemaVersion: d.schema_version,
            sequence: d.sequence,
            sha256: d.sha256,
            snapshot: d.snapshot.toString("base64"),
            reason: d.reason,
            actorId: d.actor_id,
            createdAt: d.created_at,
          })),
          coverage: { limit: 1000, hasMore },
        };
      }),
  );
  app.post(
    "/api/v1/organizations/:organizationId/meetings/:meetingId/collaboration/actions/migrate",
    (r) => {
      const mid = id((r.params as any).meetingId);
      return core.tenant(
        r,
        {
          mode: "write",
          authorize: async (ctx) => {
            await core.assertResourceAvailable(ctx, "meeting");
            await access(ctx, mid, "manage", policy);
            await access(ctx, mid, "notes", policy);
            return true;
          },
        },
        async (ctx) => {
          const { m, report } = await access(ctx, mid, "manage", policy),
            b = body(r, ["protocol", "documents", "reason"]);
          version(r, m.version);
          if (b.protocol !== RICH_TEXT_PROTOCOL)
            fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
          const reason = text(b.reason, 1000);
          if (
            !Array.isArray(b.documents) ||
            !b.documents.length ||
            b.documents.length > 30
          )
            fail(400, "INVALID_REQUEST");
          for (const d of b.documents)
            if (
              !d ||
              typeof d !== "object" ||
              Array.isArray(d) ||
              Object.keys(d).some(
                (k) => !["sectionId", "epoch", "sequence"].includes(k),
              ) ||
              typeof d.sectionId !== "string" ||
              !Number.isInteger(d.epoch) ||
              d.epoch < 1 ||
              !Number.isInteger(d.sequence) ||
              d.sequence < 0
            )
              fail(400, "INVALID_REQUEST");
          if (
            new Set(b.documents.map((d: any) => d.sectionId)).size !==
            b.documents.length
          )
            fail(400, "INVALID_REQUEST");
          const docs = (
            await ctx.c.query(
              "SELECT * FROM meeting_documents WHERE organization_id=$1 AND meeting_id=$2 ORDER BY section_id FOR UPDATE",
              [ctx.org.id, mid],
            )
          ).rows;
          if (
            docs.length !== b.documents.length ||
            docs.some(
              (d) =>
                !b.documents.some(
                  (e: any) =>
                    e.sectionId === d.section_id &&
                    e.epoch === d.epoch &&
                    e.sequence === d.sequence,
                ),
            )
          )
            fail(409, "MIGRATION_BARRIER_CONFLICT");
          if (
            docs.some(
              (d) => d.protocol !== LEGACY_PROTOCOL || d.schema_version !== 1,
            )
          )
            fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
          // Convert all sections before any write; pending structs/deletes and nonplain legacy are refused.
          const converted = docs.map((d) => ({
            before: d,
            after: migrateSnapshot(d.snapshot),
          }));
          for (const { before, after } of converted) {
            if (!Buffer.from(after.originalSnapshot).equals(before.snapshot))
              fail(500, "MIGRATION_SOURCE_CHANGED");
            await archiveEpoch(ctx, before, reason);
            await ctx.c.query(
              "UPDATE meeting_documents SET epoch=epoch+1,sequence=0,protocol=$4,schema_version=1,snapshot=$5 WHERE organization_id=$1 AND meeting_id=$2 AND section_id=$3",
              [
                ctx.org.id,
                mid,
                before.section_id,
                RICH_TEXT_PROTOCOL,
                Buffer.from(after.snapshot),
              ],
            );
          }
          await ctx.c.query(
            "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, mid],
          );
          if (report) {
            const next = (
              await ctx.c.query(
                "UPDATE meeting_reports SET epoch=epoch+1,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
                [ctx.org.id, report.id],
              )
            ).rows[0];
            await saveReportVersion(ctx, next, reason);
          }
          await core.changed(ctx, r, mid, "MeetingDocumentProtocolMigrated");
          return detail(ctx, mid, policy);
        },
      );
    },
  );
}

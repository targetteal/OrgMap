import type { FastifyRequest } from "fastify";
import type { Ctx } from "../../src/runtime.js";
import type { ResourceAccessPort, ResourceAction } from "../platform/ports.js";
import {
  fail,
  id,
  text,
  optionalText,
  camel,
  event,
  uuid,
} from "../../src/core.js";
import { Governance, type GovernancePorts } from "./service.js";
import { agreementContent,tensionDescription } from "./content.js";
export type GovernanceResourceType = "proposal" | "tension" | "agreement";
const tables = {
  proposal: "gov_proposals",
  tension: "gov_tensions",
  agreement: "gov_documents",
} as const;
const service = (ctx: Ctx, ports: GovernancePorts) =>
  new Governance(ctx, { headers: {} } as FastifyRequest, ports);
/** All calls use the caller's authorized tenant transaction. No independent pool or SQL from the platform. */
export function createGovernanceResourceAdapters(
  ports: GovernancePorts = {},
): Record<GovernanceResourceType, ResourceAccessPort> {
  const make = (type: GovernanceResourceType): ResourceAccessPort => {
    async function read(ctx: Ctx, rid: string) {
      id(rid);
      const g = service(ctx, ports);
      if (g.isGuest() && !(await g.hasGuestResource(type,rid))) return null;
      const member = (
        await ctx.c.query(
          "SELECT id FROM members WHERE organization_id=$1 AND id=$2 AND account_id=$3 AND status='ACTIVE'",
          [ctx.org.id, ctx.member.id, ctx.account.id],
        )
      ).rows[0];
      if (!member) return null;
      const row = (
        await ctx.c.query(
          `SELECT * FROM ${tables[type]} WHERE organization_id=$1 AND id=$2`,
          [ctx.org.id, rid],
        )
      ).rows[0];
      if (!row) return null;
      if (type === "agreement")
        return row.visibility === "AUTHOR" && row.author_id !== g.actor
          ? null
          : row;
      if (
        type === "proposal" &&
        await g.isDraftHidden(row)
      )
        return null;
      return row;
    }
    async function authorize(ctx: Ctx, rid: string, action: ResourceAction) {
      const row = await read(ctx, rid);
      if (!row) return false;
      const g=service(ctx,ports);
      if(g.isGuest() && (!['read','comment','follow'].includes(action) || (action!=='read' && !(await g.hasGuestResource(type,rid,action)))))return false;
      if (action === "read" || action === "follow") return true;
      if (action === "export" || action === "import")
        return (
          ctx.member.org_role === "OWNER" ||
          (action === "export" && row.author_id === ctx.member.id)
        );
      if (action === "comment") {
        if (row.archived || row.state === "CLOSED" || row.state === "WITHDRAWN") return false;
        if (g.isGuest() || row.author_id === g.actor) return true;
        // Agreements belong to a circle or a role; role participation is scoped
        // to its containing circle, just as for agreement creation.
        if (type === "agreement") {
          const owner = await g.entity(row.owner_id);
          return await g.participates(owner.kind === "CIRCLE" ? owner.id : owner.parent_id);
        }
        return await g.participates(row.circle_id);
      }
      if (action === "attach")
        return (
          !row.archived &&
          (ctx.member.org_role === "OWNER" || row.author_id === ctx.member.id)
        );
      return false;
    }
    async function validateImport(ctx: Ctx, records: unknown[], kind: string) {
      if (
        kind !== type ||
        !Array.isArray(records) ||
        !records.length ||
        records.length > 100
      )
        fail(400, "INVALID_REQUEST");
      if (ctx.member.org_role !== "OWNER") fail(403, "ACTION_DENIED");
      const g = service(ctx, ports);
      const entries = [];
      for (const raw of records) {
        const record = raw as any;
        if (
          !record ||
          typeof record !== "object" ||
          Array.isArray(record) ||
          Object.keys(record).some(
            (k) => !["schemaVersion", "kind", "sourceId", "data"].includes(k),
          ) ||
          record.schemaVersion !== 1 ||
          record.kind !== type ||
          !record.data ||
          typeof record.data !== "object" ||
          Array.isArray(record.data)
        )
          fail(400, "INVALID_REQUEST");
        id(record.sourceId);
        const data = record.data;
        const allowed =
          type === "proposal"
            ? ["title", "circleId", "proposalKind", "payload"]
            : type === "tension"
              ? ["title", "circleId", "description", "descriptionRich"]
              : ["title", "ownerId", "workflow", "visibility", "content", "richContent"];
        if (Object.keys(data).some((k) => !allowed.includes(k)))
          fail(400, "INVALID_REQUEST");
        text(data.title);
        if (type === "agreement") {
          await g.entity(data.ownerId);
          if (
            !["DIRECT", "GOVERNANCE"].includes(data.workflow) ||
            !["ORGANIZATION", "AUTHOR"].includes(data.visibility)
          )
            fail(400, "INVALID_REQUEST");
          agreementContent(data);
        } else {
          await g.entity(data.circleId, "CIRCLE");
          if (type === "proposal")
            await g.payload(data.proposalKind, data.payload, data.circleId);
          else tensionDescription(data);
        }
        entries.push({
          sourceId: record.sourceId,
          data: structuredClone(data),
        });
      }
      if (new Set(entries.map((e) => e.sourceId)).size !== entries.length)
        fail(422, "DUPLICATE_SOURCE_ID");
      return {
        plan: { schemaVersion: 1, kind: type, entries },
        warnings: [
          "Importação cria novos rascunhos; decisões, rodadas, votos, publicação e aplicações históricas permanecem somente no arquivo de origem.",
        ],
      };
    }
    return {
      authorize,
      ...(type === "proposal" ? {notificationEligible: async (ctx: Ctx, rid: string) => {
        const row = await read(ctx, rid);
        if (!row) return false;
        const g = service(ctx, ports);
        return g.isGuest()
          ? await g.hasGuestResource("proposal", rid, "read")
          : row.author_id === g.actor || await g.participates(row.circle_id);
      }} : {}),
      async lookup(ctx,rid) {
        const row=await read(ctx,rid);
        return row?{type,id:row.id,title:row.title}:null;
      },
      async search(ctx, query, limit) {
        text(query, 200);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          fail(400, "INVALID_REQUEST");
        const g=service(ctx,ports),guestIds=g.isGuest()?await g.guestIds(type):null;
        const rows = (
          await ctx.c.query(
            `SELECT d.id,d.title FROM ${tables[type]} d WHERE d.organization_id=$1 AND (d.title ILIKE $2 ESCAPE '\\'${
              type === "agreement"
                ? ` OR EXISTS(SELECT 1 FROM gov_document_versions v WHERE v.organization_id=d.organization_id AND v.document_id=d.id AND v.number=d.draft_version AND v.content ILIKE $2 ESCAPE '\\')`
                : ""
            }) AND ($3::uuid[] IS NULL OR d.id=ANY($3::uuid[])) ORDER BY d.id`,
            [
              ctx.org.id,
              "%" +
                query
                  .replaceAll("\\", "\\\\")
                  .replaceAll("%", "\\%")
                  .replaceAll("_", "\\_") +
                "%",
              guestIds,
            ],
          )
        ).rows;
        const out = [];
        for (const row of rows) {
          if (await authorize(ctx, row.id, "read"))
            out.push({ type, id: row.id, title: row.title });
          if (out.length === limit) break;
        }
        return out;
      },
      async export(ctx, ids, kind) {
        if (kind !== type || !Array.isArray(ids) || ids.length > 100)
          fail(400, "INVALID_REQUEST");
        const records = [];
        for (const rid of ids) {
          if (!(await authorize(ctx, rid, "export")))
            fail(404, "RESOURCE_NOT_FOUND");
          const row = await read(ctx, rid);
          let data: any;
          if (type === "proposal") {
            const revision = (
              await ctx.c.query(
                "SELECT payload FROM gov_revisions WHERE organization_id=$1 AND proposal_id=$2 AND number=$3",
                [ctx.org.id, rid, row.revision],
              )
            ).rows[0];
            data = {
              title: row.title,
              circleId: row.circle_id,
              proposalKind: row.kind,
              payload: revision.payload,
            };
          } else if (type === "tension")
            data = {
              title: row.title,
              circleId: row.circle_id,
              ...(row.description_rich?{descriptionRich:row.description_rich}:{description:row.description}),
            };
          else {
            const content = (
              await ctx.c.query(
                "SELECT content,rich_content FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2 AND number=$3",
                [ctx.org.id, rid, row.draft_version],
              )
            ).rows[0];
            data = {
              title: row.title,
              ownerId: row.owner_id,
              workflow: row.workflow,
              visibility: row.visibility,
              ...(content.rich_content ? {richContent:agreementContent({richContent:content.rich_content}).richContent} : {content:content.content}),
            };
          }
          records.push({ schemaVersion: 1, kind: type, sourceId: rid, data });
        }
        return {
          records,
          coverage:
            "Selected authorized current drafts; historical lifecycle not transferable",
          estimated: false,
        };
      },
      validateImport,
      async applyImport(ctx, plan: any, kind) {
        if (
          plan?.schemaVersion !== 1 ||
          plan.kind !== kind ||
          !Array.isArray(plan.entries)
        )
          fail(400, "INVALID_REQUEST");
        const validated = await validateImport(
          ctx,
          plan.entries.map((e: any) => ({
            schemaVersion: 1,
            kind,
            sourceId: e.sourceId,
            data: e.data,
          })),
          kind,
        );
        const idMap: Record<string, string> = {};
        for (const entry of validated.plan.entries) {
          const g = service(ctx, ports);
          const result =
            type === "agreement"
              ? await g.document(entry.data)
              : type === "tension"
                ? await g.tension(entry.data)
                : await g.proposal({
                    ...entry.data,
                    kind: entry.data.proposalKind,
                  });
          idMap[entry.sourceId] = result.id;
          await event(
            ctx.c,
            ctx.org.id,
            ctx.account.id,
            result.id,
            "GovernanceResourceImported",
            uuid(),
          );
        }
        await ctx.c.query(
          "UPDATE organizations SET authorization_revision=authorization_revision+1 WHERE id=$1",
          [ctx.org.id],
        );
        return { idMap };
      },
    };
  };
  return {
    proposal: make("proposal"),
    tension: make("tension"),
    agreement: make("agreement"),
  };
}

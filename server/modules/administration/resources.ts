import type { Ctx } from "../../src/runtime.js";
import type { ResourceAccessPort } from "../platform/ports.js";
import { fail, id } from "../../src/core.js";
import { canManage } from "./index.js";
import { validate } from "./domain.js";
/** Directory identity is organizational. Private profile values never enter this adapter. */
export function memberResourceAdapter(): ResourceAccessPort {
  const readable = async (ctx: Ctx, rid: string) =>
    !!(
      await ctx.c.query(
        "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
        [ctx.org.id, id(rid)],
      )
    ).rowCount;
  return {
    authorize: async (ctx, rid, action) =>
      ["read", "export"].includes(action) && (await readable(ctx, rid)),
    lookup: async (ctx, rid) => {
      const entry = (await ctx.c.query(
        "SELECT m.id,a.display_name FROM members m JOIN accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND m.id=$2 AND m.status='ACTIVE'",
        [ctx.org.id, id(rid)],
      )).rows[0];
      return entry ? { id: entry.id, title: entry.display_name } : null;
    },
    search: async (ctx, query, limit) =>
      (
        await ctx.c.query(
          "SELECT m.id,a.display_name FROM members m JOIN accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND m.status='ACTIVE' AND a.display_name ILIKE $2 ORDER BY m.id LIMIT $3",
          [ctx.org.id, "%" + query + "%", Math.min(100, Math.max(1, limit))],
        )
      ).rows.map((row) => ({
        type: "member",
        id: row.id,
        title: row.display_name,
      })),
    export: async (ctx, ids, kind) => {
      if (kind !== "MEMBERS") fail(422, "EXPORT_KIND_REQUIRED");
      const records = [];
      for (const rid of ids) {
        if (!(await readable(ctx, rid))) fail(404, "RESOURCE_NOT_FOUND");
        const row = (
          await ctx.c.query(
            'SELECT m.id,m.version,a.display_name AS "displayName" FROM members m JOIN accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND m.id=$2',
            [ctx.org.id, rid],
          )
        ).rows[0];
        records.push(row);
      }
      return {
        records,
        coverage:
          "Authorized active directory identities only; profile values and account email excluded",
        estimated: false,
      };
    },
  };
}
/** Public-page identity does not expose drafts to a person who only knows its ID. */
export function publicPageResourceAdapter(): ResourceAccessPort {
  const row = async (ctx: Ctx, rid: string) =>
    (
      await ctx.c.query(
        "SELECT r.id,r.version,r.value,p.snapshot,p.active FROM administration_records r LEFT JOIN administration_publications p ON p.organization_id=r.organization_id AND p.id=r.id WHERE r.organization_id=$1 AND r.id=$2 AND r.kind='page'",
        [ctx.org.id, id(rid)],
      )
    ).rows[0];
  const allowed = async (ctx: Ctx, rid: string, action: string) => {
    if (!["read", "export"].includes(action)) return false;
    const page = await row(ctx, rid);
    return (
      !!page &&
      (page.active === true || (await canManage(ctx, "page.manage", rid)))
    );
  };
  return {
    authorize: allowed,
    lookup: async (ctx, rid) => {
      const page = await row(ctx, rid);
      if (!page) return null;
      const manage = await canManage(ctx, "page.manage", rid);
      if (!manage && !page.active) return null;
      const title = (manage ? page.value : page.snapshot)?.title;
      return typeof title === "string" ? { id: page.id, title } : null;
    },
    search: async (ctx, query, limit) => {
      const candidates = (
        await ctx.c.query(
          "SELECT r.id,r.value,p.snapshot,p.active FROM administration_records r LEFT JOIN administration_publications p ON p.organization_id=r.organization_id AND p.id=r.id WHERE r.organization_id=$1 AND r.kind='page' ORDER BY r.id",
          [ctx.org.id],
        )
      ).rows;
      const found = [];
      for (const page of candidates) {
        const manage = await canManage(ctx, "page.manage", page.id);
        if (!manage && !page.active) continue;
        const title = (manage ? page.value : page.snapshot).title;
        if (title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          found.push({ type: "public-page", id: page.id, title });
        if (found.length >= Math.min(100, Math.max(1, limit))) break;
      }
      return found;
    },
    export: async (ctx, ids, kind) => {
      if (kind !== "PAGES") fail(422, "EXPORT_KIND_REQUIRED");
      const records = [];
      for (const rid of ids) {
        if (!(await allowed(ctx, rid, "export")))
          fail(404, "RESOURCE_NOT_FOUND");
        const page = await row(ctx, rid);
        const manage = await canManage(ctx, "page.manage", rid);
        records.push({
          id: page.id,
          version: manage ? page.version : null,
          value: validate("page", manage ? page.value : page.snapshot),
          coverage: manage ? "draft" : "published-snapshot",
        });
      }
      return {
        records,
        coverage:
          "Explicit page allowlist only; no organization graph or private profiles",
        estimated: false,
      };
    },
  };
}

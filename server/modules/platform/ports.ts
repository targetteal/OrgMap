import type { Ctx } from "../../src/runtime.js";
import { fail, id } from "../../src/core.js";
import type { PdfBundlePayload } from "../meetings/export-contract.js";
import type { ExportWorkbook } from "./workbook.js";
import type { PublicationExportSnapshot } from "../administration/feed-source.js";

export type ResourceRef = { type: string; id: string };
export type ResourceAction =
  | "read"
  | "comment"
  | "attach"
  | "export"
  | "export-private"
  | "import"
  | "follow";
export type SearchItem = ResourceRef & { title: string; description?: string };
export type NotificationMailContent = { subject: string; text: string; html?: string };
/** Adapters own domain ACL, serialization and import commands. No table name or SQL supplied by callers. */
export interface ResourceAccessPort {
  /** Explicit opt-in. authorize(export-private) must recheck the current domain policy. */
  supportsPrivateExport?: boolean;
  exportKinds?: readonly string[];
  authorize(
    ctx: Ctx,
    resourceId: string,
    action: ResourceAction,
  ): Promise<boolean>;
  /** Recheck a recipient's current domain eligibility before delivering or listing a notification. */
  notificationEligible?(ctx: Ctx, resourceId: string): Promise<boolean>;
  /** Current read-authorized display data. Never a historical notification snapshot. */
  lookup?(ctx: Ctx, resourceId: string): Promise<{id:string;title:string;destination?:string} | null>;
  /** Optional domain-owned mail copy, resolved only after current read authorization. */
  notificationMail?(ctx: Ctx, resourceId: string, event: string): Promise<NotificationMailContent | undefined>;
  search?(ctx: Ctx, query: string, limit: number): Promise<SearchItem[]>;
  export?(
    ctx: Ctx,
    ids: string[],
    kind: string,
    options?: {
      includePrivate: boolean;
      format?: "JSON" | "CSV" | "XLSX" | "PDF" | "ZIP";
    },
  ): Promise<{
    records: unknown[];
    coverage: string;
    estimated: boolean;
    workbook?: ExportWorkbook;
    documentPackage?: PdfBundlePayload;
    publicationPackage?: PublicationExportSnapshot;
  }>;
  validateImport?(
    ctx: Ctx,
    records: unknown[],
    kind: string,
  ): Promise<{ plan: unknown; warnings: string[] }>;
  applyImport?(
    ctx: Ctx,
    plan: unknown,
    kind: string,
  ): Promise<{ idMap: Record<string, string> }>;
}
export class ResourceRegistry {
  private adapters = new Map<string, ResourceAccessPort>();
  constructor(
    private options: {
      /** Organization-owned master for notification emails, resolved inside the current tenant transaction. */
      notificationEmailEnabled?: (ctx: Ctx) => Promise<boolean>;
      notificationWorkspace?: (ctx: Ctx) => Promise<{name:string;locale:string;timeZone:string}>;
      /** Trusted host mapping to the original resource grant. Never supplied by HTTP DTOs. */
      guestAccess?: (
        ctx: Ctx,
        ref: ResourceRef,
        action: ResourceAction,
      ) => Promise<boolean>;
      /** Must filter original grants before domain reads, ordering and limits. No broad fallback for Guest. */
      guestSearch?: (
        ctx: Ctx,
        type: string,
        query: string,
        limit: number,
      ) => Promise<SearchItem[]>;
      /** Original-grant IDs only; registry intersects domain ACL before collection SQL. */
      guestResourceIds?: (
        ctx: Ctx,
        type: string,
        action: ResourceAction,
      ) => Promise<readonly string[]>;
    } = {},
  ) {}
  async notificationEmailEnabled(ctx: Ctx): Promise<boolean> {
    return this.options.notificationEmailEnabled ? this.options.notificationEmailEnabled(ctx) : true;
  }
  async notificationWorkspace(ctx: Ctx): Promise<{name:string;locale:string;timeZone:string}> {
    return this.options.notificationWorkspace ? this.options.notificationWorkspace(ctx) : {name:ctx.org.name??'OrgMap',locale:ctx.org.locale??'pt-BR',timeZone:ctx.org.time_zone??'UTC'};
  }
  registerResourceAdapter(type: string, adapter: ResourceAccessPort) {
    if (!/^[a-z][a-z0-9-]{0,49}$/.test(type) || this.adapters.has(type))
      throw Error("Invalid or duplicate resource adapter");
    this.adapters.set(type, adapter);
    return this;
  }
  get(type: string) {
    return this.adapters.get(type);
  }
  types() {
    return [...this.adapters.keys()];
  }
  async search(ctx: Ctx, type: string, query: string, limit: number) {
    if (!this.adapters.has(type)) return [];
    if (ctx.member.member_type === "GUEST")
      return (await this.options.guestSearch?.(ctx, type, query, limit)) ?? [];
    return (await this.adapters.get(type)?.search?.(ctx, query, limit)) ?? [];
  }
  async collectionScope(
    ctx: Ctx,
    action: ResourceAction,
  ): Promise<ResourceRef[] | null> {
    if (ctx.member.member_type !== "GUEST") return null;
    const refs: ResourceRef[] = [];
    for (const type of this.types()) {
      for (const resourceId of new Set(
        (await this.options.guestResourceIds?.(ctx, type, action)) ?? [],
      )) {
        const ref = { type, id: id(resourceId) };
        if (await this.allowed(ctx, ref, action)) refs.push(ref);
      }
    }
    return refs;
  }
  exportKinds(type: string): readonly string[] {
    return (
      this.adapters.get(type)?.exportKinds ??
      (
        {
          circle: ["STRUCTURE"],
          role: ["STRUCTURE"],
          member: ["MEMBERS"],
          "public-page": ["PAGES"],
          proposal: ["proposal"],
          tension: ["tension"],
          agreement: ["agreement"],
          task: ["TASKS", "STATISTICS"],
        } as Record<string, string[]>
      )[type] ?? ["RESOURCES"]
    );
  }
  async allowed(ctx: Ctx, ref: ResourceRef, action: ResourceAction) {
    // Platform is a wrapper, never a Guest grant namespace. Keep closed until
    // a trusted original-resource perimeter is composed by the host.
    if (
      ctx.member.member_type === "GUEST" &&
      (await this.options.guestAccess?.(ctx, ref, action)) !== true
    )
      return false;
    if (
      action === "export-private" &&
      (ctx.member.org_role !== "OWNER" ||
        this.adapters.get(ref.type)?.supportsPrivateExport !== true)
    )
      return false;
    return (
      (await this.adapters
        .get(ref.type)
        ?.authorize(ctx, id(ref.id), action)) === true
    );
  }
  async notificationAllowed(ctx: Ctx, ref: ResourceRef) {
    if (!(await this.allowed(ctx, ref, "read"))) return false;
    const adapter = this.adapters.get(ref.type);
    return adapter?.notificationEligible ? await adapter.notificationEligible(ctx, id(ref.id)) : true;
  }
  async require(ctx: Ctx, ref: ResourceRef, action: ResourceAction) {
    if (!(await this.allowed(ctx, ref, action)))
      fail(404, "RESOURCE_NOT_FOUND");
    return this.adapters.get(ref.type)!;
  }
}

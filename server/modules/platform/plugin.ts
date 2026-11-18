import type { FastifyRequest } from "fastify";
import type { OrgMapModule, Ctx } from "../../src/runtime.js";
import { Failure, body, camel, fail, id, text, uuid, version } from "../../src/core.js";
import {
  ResourceRegistry,
  type ResourceRef,
  type ResourceAction,
} from "./ports.js";
import { FilesystemBlobStore } from "./blob.js";
import { effectivePreference } from "./notifications.js";
import { validateDocument, planHash, decodeTransfer } from "./transfer.js";
import { notificationEvents } from "./catalog.js";
import {notificationPresentation,notificationHeading,notificationDescription,notificationDestination} from './notification-presentation.js';
import type { ReportPackageSerializer } from "./report-runtime.js";
import { createExportJobPort } from "./export-jobs.js";
import { createCommentThreadPort } from "./comments.js";
import type { CommentThreadPort } from "./comments-contract.js";
import { createCommentCursor } from "./comment-cursor.js";
import {
  createIncomingUploadService,
  assertIncomingUploadServiceBinding,
  type IncomingUploadService,
  type UploadPolicyProvider,
} from "./upload-policy.js";
import {
  inspectIncomingFile,
  type ValidatedIncomingFile,
} from "./incoming-file.js";
const base = "/api/v1/organizations/:organizationId/platform";
const ref = (r: FastifyRequest): ResourceRef => {
  const p = r.params as any;
  return { type: text(p.resourceType, 50), id: id(p.resourceId) };
};
const channel = (v: unknown) => {
  if (v !== "IN_APP" && v !== "EMAIL") fail(400, "INVALID_CHANNEL");
  return v as string;
};
const bool = (v: unknown) => {
  if (typeof v !== "boolean") fail(400, "INVALID_REQUEST");
  return v as boolean;
};
const eventName = (v: unknown) => {
  const s = text(v, 100);
  if (!/^[A-Za-z][A-Za-z0-9.]*$/.test(s)) fail(400, "INVALID_EVENT");
  return s;
};
const safeJob = (v: any) => ({
  id: v.id,
  requestId: v.request_id ?? null,
  kind: v.kind,
  includePrivate: v.include_private === true,
  state: v.state,
  attempts: v.attempts,
  version: v.version,
  errorCode: v.error_code,
  result: v.result,
  createdAt: v.created_at,
});
export function createPlatform(options: {
  registry: ResourceRegistry;
  blobs: FilesystemBlobStore;
  comments?: CommentThreadPort;
  uploadPolicyProvider?: UploadPolicyProvider;
  uploads?: IncomingUploadService;
  reportPackages?: ReportPackageSerializer;
}): OrgMapModule {
  const { registry, blobs } = options;
  const exportJobs = createExportJobPort(registry, {
    reportPackages: options.reportPackages,
  });
  const cursors = createCommentCursor();
  return async (app, core) => {
    const available = async (ctx: Ctx, type: string) => {
      try { await core.assertResourceAvailable(ctx, type); return true; }
      catch (error) {
        if (error instanceof Failure && error.code === "MODULE_DISABLED") return false;
        throw error;
      }
    };
    if (options.uploads && options.uploadPolicyProvider)
      throw Error("AMBIGUOUS_UPLOAD_SERVICE_BINDING");
    if (options.uploads)
      assertIncomingUploadServiceBinding(options.uploads, registry, blobs);
    const uploads =
      options.uploads ??
      createIncomingUploadService({
        core,
        registry,
        blobs,
        policyProvider: options.uploadPolicyProvider,
      });
    const comments =
      options.comments ??
      (registry.get("task")
        ? undefined
        : createCommentThreadPort({ core, registry }));
    const requireComments = () => {
      if (!comments) fail(503, "COMMENT_THREAD_UNAVAILABLE");
      return comments!;
    };

    const route = (
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string,
      keys: string[],
      handler: any,
    ) =>
      app.route({
        method,
        url: base + path,
        bodyLimit: 7_100_000,
        schema: {
          ...(method === "POST" || method === "PATCH"
            ? {
                body: {
                  type: "object",
                  additionalProperties: false,
                  properties: Object.fromEntries(keys.map((k) => [k, {}])),
                },
              }
            : {}),
        },
        preValidation:
          method === "POST" || method === "PATCH"
            ? async (request: FastifyRequest) => {
                body(request, keys);
              }
            : undefined,
        handler,
      });
    const access = (
      r: FastifyRequest,
      action: ResourceAction,
      write = false,
    ) => ({
      mode: write ? ("write" as const) : ("read" as const),
      authorize: (ctx: Ctx) => registry.allowed(ctx, ref(r), action),
    });
    const changed = async (
      ctx: Ctx,
      r: FastifyRequest,
      resource: string,
      action: string,
    ) => core.changed(ctx, r, resource, action);
    route("GET", "/capabilities", [], (r: FastifyRequest) =>
      core.tenant(r, false, async () => ({
        resourceTypes: registry.types(),
        formats: ["JSON", "CSV", "XLSX"],
        schemaVersion: "orgmap-transfer-v1",
      })),
    );
    route(
      "GET",
      "/resources/:resourceType/:resourceId/capabilities",
      [],
      (r: FastifyRequest) =>
        core.tenant(r, access(r, "read"), async (ctx) => {
          const upload = await uploads.capabilities(ctx);
          return {
            locale:(await registry.notificationWorkspace(ctx)).locale,
            upload,
            exportKinds: registry.exportKinds(ref(r).type),
            favorite:
              (
                await ctx.c.query(
                  "SELECT 1 FROM platform_favorites WHERE organization_id=$1 AND owner_id=$2 AND resource_type=$3 AND resource_id=$4",
                  [ctx.org.id, ctx.member.id, ref(r).type, ref(r).id],
                )
              ).rowCount === 1,
            following:
              (
                await ctx.c.query(
                  "SELECT enabled FROM platform_follows WHERE organization_id=$1 AND member_id=$2 AND resource_type=$3 AND resource_id=$4",
                  [ctx.org.id, ctx.member.id, ref(r).type, ref(r).id],
                )
              ).rows[0]?.enabled === true,
            actions: await (async () => {
              const actions: Record<string, boolean> = {};
              for (const action of [
                "read",
                "comment",
                "attach",
                "export",
                "export-private",
                "import",
                "follow",
              ] as ResourceAction[])
                actions[action] = await registry.allowed(ctx, ref(r), action);
              actions.attach =
                actions.attach &&
                upload.operational &&
                upload.policy?.mode !== "DISABLED";
              return actions;
            })(),
          };
        }),
    );
    route(
      "GET",
      "/resources/:resourceType/:resourceId/comments",
      [],
      (r: FastifyRequest) =>
        core.tenant(r, access(r, "read"), async (ctx) => {
          const q = r.query as Record<string, unknown>;
          if (Object.keys(q).some((k) => !["limit", "cursor"].includes(k)))
            fail(400, "INVALID_REQUEST");
          const limit = q.limit === undefined ? 100 : Number(q.limit);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            fail(400, "INVALID_PAGE_LIMIT");
          const resource = ref(r),
            binding = {
              organizationId: ctx.org.id,
              memberId: ctx.member.id,
              type: resource.type,
              id: resource.id,
              limit,
            };
          const after =
            q.cursor === undefined
              ? undefined
              : cursors.decode(q.cursor, binding);
          const result = await requireComments().list(ctx, {
            ref: resource,
            after,
            limit,
          });
          return {
            items: result.items,
            page: {
              hasMore: result.page.hasMore,
              nextCursor:
                result.page.hasMore && result.page.after
                  ? cursors.encode(binding, result.page.after)
                  : null,
            },
          };
        }),
    );
    route(
      "POST",
      "/resources/:resourceType/:resourceId/comments",
      ["content", "contentRich"],
      async (r: FastifyRequest, reply: any) => {
        const result = await core.tenant(
          r,
          access(r, "comment", true),
          async (ctx) => {
            const input = body(r, ["content", "contentRich"]);
            const row = await requireComments().append(ctx, {
              ref: ref(r),
              body: input as any,
            });
            await changed(ctx, r, row.id, "CommentAdded");
            return row;
          },
        );
        return reply.code(201).send(result);
      },
    );
    route(
      "GET",
      "/resources/:resourceType/:resourceId/files",
      [],
      (r: FastifyRequest) =>
        core.tenant(r, access(r, "read"), async (ctx) => ({
          items: (
            await ctx.c.query(
              "SELECT id,name,mime,size,state,created_at FROM platform_files WHERE organization_id=$1 AND resource_type=$2 AND resource_id=$3 AND state='READY' ORDER BY created_at,id LIMIT 100",
              [ctx.org.id, ref(r).type, ref(r).id],
            )
          ).rows.map(camel),
        })),
    );
    route(
      "POST",
      "/resources/:resourceType/:resourceId/uploads",
      ["name", "mime", "base64"],
      async (r: FastifyRequest, reply: any) => {
        let inspection: ValidatedIncomingFile;
        const result = await uploads.run((ingest) =>
          core.tenant(
            r,
            {
              mode: "write",
              authorize: async (ctx) => {
                await core.assertResourceAvailable(ctx, ref(r).type);
                await registry.require(ctx, ref(r), "attach");
                const input = body(r, ["name", "mime", "base64"]);
                inspection = inspectIncomingFile(
                  input.name,
                  input.mime,
                  input.base64,
                );
                await uploads.assertUserAttachment(ctx, {
                  resource: ref(r),
                  inspection,
                });
                return true;
              },
            },
            async (ctx) => {
              const file = await ingest(ctx, { resource: ref(r), inspection });
              await changed(ctx, r, file.id, "AttachmentReady");
              return file;
            },
          ),
        );
        return reply.code(201).send(result);
      },
    );
    route(
      "GET",
      "/files/:fileId/download",
      [],
      (r: FastifyRequest, reply: any) => {
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Content-Disposition", "attachment");
        return core.tenant(r, false, async (ctx) => {
          const file = (
            await ctx.c.query(
              "SELECT * FROM platform_files WHERE organization_id=$1 AND id=$2 AND state='READY'",
              [ctx.org.id, id((r.params as any).fileId)],
            )
          ).rows[0];
          if (!file) fail(404, "RESOURCE_NOT_FOUND");
          await registry.require(
            ctx,
            { type: file.resource_type, id: file.resource_id },
            "read",
          );
          return {
            name: file.name,
            mime: file.mime,
            downloadMime: "application/octet-stream",
            disposition: "attachment",
            preview: false,
            base64: (await blobs.read(file.blob_key, file.sha256)).toString(
              "base64",
            ),
          };
        });
      },
    );
    route("GET", "/search", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) => {
        const q = r.query as any,
          query = typeof q.q === "string" ? q.q.slice(0, 200) : "",
          types = q.type ? [text(q.type, 50)] : registry.types(),
          items = [];
        if (!query.trim())
          return {
            items: [],
            coverage: "registered-adapters",
            asOf: new Date().toISOString(),
          };
        for (const type of types) {
          const adapter = registry.get(type);
          if (!adapter || !(await available(ctx, type))) continue;
          for (const item of (
            await registry.search(ctx, type, query, 100)
          ).slice(0, 100)) {
            if (
              item.type === type &&
              (await registry.allowed(ctx, item, "read"))
            )
              items.push({
                type,
                id: item.id,
                title: text(item.title, 500),
                description: item.description?.slice(0, 1000),
              });
          }
        }
        return {
          items: items.slice(0, 100),
          coverage: "registered-adapters",
          asOf: new Date().toISOString(),
        };
      }),
    );
    route("GET", "/views", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) => ({
        items: (
          await ctx.c.query(
            "SELECT id,name,resource_type,config,version FROM platform_views WHERE organization_id=$1 AND owner_id=$2 ORDER BY name,id",
            [ctx.org.id, ctx.member.id],
          )
        ).rows.map(camel),
      })),
    );
    route(
      "POST",
      "/views",
      ["name", "resourceType", "config"],
      async (r: FastifyRequest, reply: any) => {
        const out = await core.tenant(
          r,
          { mode: "write", authorize: () => true },
          async (ctx) => {
            const b = body(r, ["name", "resourceType", "config"]),
              type = text(b.resourceType, 50);
            if (!registry.get(type)) fail(422, "ADAPTER_REQUIRED");
            const config = b.config;
            if (
              !config ||
              typeof config !== "object" ||
              Array.isArray(config) ||
              Object.keys(config).some(
                (k) => !["query", "layout", "sort"].includes(k),
              ) ||
              typeof config.query !== "string" ||
              config.query.length > 200 ||
              !["list", "grid"].includes(config.layout) ||
              !["title", "updated"].includes(config.sort)
            )
              fail(422, "INVALID_VIEW");
            const row = (
              await ctx.c.query(
                "INSERT INTO platform_views(organization_id,id,owner_id,name,resource_type,config) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,resource_type,config,version",
                [
                  ctx.org.id,
                  uuid(),
                  ctx.member.id,
                  text(b.name, 100),
                  type,
                  config,
                ],
              )
            ).rows[0];
            await changed(ctx, r, row.id, "ViewSaved");
            return camel(row);
          },
        );
        return reply.code(201).send(out);
      },
    );
    route("DELETE", "/views/:viewId", [], (r: FastifyRequest) =>
      core.tenant(r, { mode: "write", authorize: () => true }, async (ctx) => {
        const viewId = id((r.params as any).viewId),
          row = (
            await ctx.c.query(
              "SELECT version FROM platform_views WHERE organization_id=$1 AND id=$2 AND owner_id=$3",
              [ctx.org.id, viewId, ctx.member.id],
            )
          ).rows[0];
        if (!row) fail(404, "RESOURCE_NOT_FOUND");
        version(r, row.version);
        await ctx.c.query(
          "DELETE FROM platform_views WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, viewId],
        );
        await changed(ctx, r, viewId, "ViewRemoved");
        return { id: viewId };
      }),
    );
    route(
      "POST",
      "/resources/:resourceType/:resourceId/favorite",
      ["enabled"],
      (r: FastifyRequest) =>
        core.tenant(r, access(r, "read", true), async (ctx) => {
          const enabled = bool(body(r, ["enabled"]).enabled),
            f = ref(r);
          if (enabled)
            await ctx.c.query(
              "INSERT INTO platform_favorites(organization_id,id,owner_id,resource_type,resource_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
              [ctx.org.id, uuid(), ctx.member.id, f.type, f.id],
            );
          else
            await ctx.c.query(
              "DELETE FROM platform_favorites WHERE organization_id=$1 AND owner_id=$2 AND resource_type=$3 AND resource_id=$4",
              [ctx.org.id, ctx.member.id, f.type, f.id],
            );
          await changed(ctx, r, f.id, "FavoriteChanged");
          return { enabled };
        }),
    );
    route("GET", "/favorites", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) => {
        const scope = await registry.collectionScope(ctx, "read");
        const items = [];
        for (const row of (
          await ctx.c.query(
            "SELECT f.id,f.resource_type,f.resource_id FROM platform_favorites f WHERE f.organization_id=$1 AND f.owner_id=$2 AND ($3::jsonb IS NULL OR EXISTS(SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS allowed(type text,id uuid) WHERE allowed.type=f.resource_type AND allowed.id=f.resource_id))",
            [
              ctx.org.id,
              ctx.member.id,
              scope === null ? null : JSON.stringify(scope),
            ],
          )
        ).rows) {
          if (!(await available(ctx, row.resource_type))) continue;
          if (
            await registry.allowed(
              ctx,
              { type: row.resource_type, id: row.resource_id },
              "read",
            )
          ) {
            // Resolve only current domain data, in the same tenant transaction
            // and after both the original Guest grant and domain ACL checks.
            const adapter = registry.get(row.resource_type);
            const resource = adapter?.lookup ? await adapter.lookup(ctx, row.resource_id) : null;
            if (adapter?.lookup && (!resource || resource.id !== row.resource_id)) continue;
            const resourceTitle = resource && typeof resource.title === "string" && resource.title.trim()
              ? resource.title.slice(0, 500)
              : null;
            items.push({ ...camel(row), resourceTitle });
          }
        }
        return { items };
      }),
    );
    route(
      "POST",
      "/resources/:resourceType/:resourceId/follow",
      ["enabled"],
      (r: FastifyRequest) =>
        core.tenant(r, access(r, "follow", true), async (ctx) => {
          const enabled = bool(body(r, ["enabled"]).enabled),
            f = ref(r);
          await ctx.c.query(
            "INSERT INTO platform_follows VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,member_id,resource_type,resource_id) DO UPDATE SET enabled=excluded.enabled",
            [ctx.org.id, ctx.member.id, f.type, f.id, enabled],
          );
          await changed(ctx, r, f.id, "FollowChanged");
          return { enabled };
        }),
    );
    async function prefRevision(ctx: Ctx) {
      return (
        (
          await ctx.c.query(
            "SELECT version FROM platform_preference_revision WHERE organization_id=$1 AND member_id=$2",
            [ctx.org.id, ctx.member.id],
          )
        ).rows[0]?.version ?? 1
      );
    }
    async function bump(ctx: Ctx) {
      await ctx.c.query(
        "INSERT INTO platform_preference_revision VALUES($1,$2,2) ON CONFLICT(organization_id,member_id) DO UPDATE SET version=platform_preference_revision.version+1",
        [ctx.org.id, ctx.member.id],
      );
    }
    route("GET", "/preferences", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) => {
        const {locale}=await registry.notificationWorkspace(ctx);
        const rows = (
          await ctx.c.query(
            "SELECT event,channel,enabled,version FROM platform_preferences WHERE organization_id=$1 AND member_id=$2",
            [ctx.org.id, ctx.member.id],
          )
        ).rows;
        const policies = (
          await ctx.c.query(
            "SELECT event,channel,module_enabled,master_enabled,default_enabled,locked,version FROM platform_policy WHERE organization_id=$1",
            [ctx.org.id],
          )
        ).rows;
        const events = [];
        for (const item of notificationEvents) {
          const effective: Record<string, unknown> = {};
          for (const ch of ["EMAIL", "IN_APP"])
            effective[ch] = await effectivePreference(
              ctx,
              ctx.member.id,
              item.event,
              ch,
              registry,
            );
          events.push({ ...item,label:notificationHeading(locale,item.event),description:notificationDescription(locale,item.event), effective });
        }
        const follows=[];
        for(const follow of (await ctx.c.query('SELECT resource_type,resource_id,enabled FROM platform_follows WHERE organization_id=$1 AND member_id=$2 ORDER BY resource_type,resource_id LIMIT 100',[ctx.org.id,ctx.member.id])).rows){
          const resource={type:follow.resource_type,id:follow.resource_id};
          if(!await registry.allowed(ctx,resource,'follow'))continue;
          const current=await registry.get(resource.type)?.lookup?.(ctx,resource.id);
          follows.push({resourceType:resource.type,resourceId:resource.id,resourceTitle:current?.title??notificationHeading(locale,''),enabled:follow.enabled,destination:notificationDestination(resource.type,resource.id,ctx.org.id,current?.destination)});
        }
        return {
          locale,follows,
          items: rows.map(camel),
          policies: policies.map(camel),
          events,
          version: await prefRevision(ctx),
        };
      }),
    );
    route(
      "POST",
      "/preferences",
      ["event", "channel", "enabled"],
      (r: FastifyRequest) =>
        core.tenant(
          r,
          { mode: "write", authorize: () => true },
          async (ctx) => {
            version(r, await prefRevision(ctx));
            const b = body(r, ["event", "channel", "enabled"]),
              e = eventName(b.event),
              ch = channel(b.channel),
              enabled = bool(b.enabled);
            await ctx.c.query(
              "INSERT INTO platform_preferences VALUES($1,$2,$3,$4,$5,1) ON CONFLICT(organization_id,member_id,event,channel) DO UPDATE SET enabled=excluded.enabled,version=platform_preferences.version+1",
              [ctx.org.id, ctx.member.id, e, ch, enabled],
            );
            await bump(ctx);
            await changed(
              ctx,
              r,
              ctx.member.id,
              "NotificationPreferenceChanged",
            );
            return {
              version: await prefRevision(ctx),
              effective: await effectivePreference(ctx, ctx.member.id, e, ch, registry),
            };
          },
        ),
    );
    route("POST", "/preferences/reset", [], (r: FastifyRequest) =>
      core.tenant(r, { mode: "write", authorize: () => true }, async (ctx) => {
        version(r, await prefRevision(ctx));
        await ctx.c.query(
          "DELETE FROM platform_preferences WHERE organization_id=$1 AND member_id=$2",
          [ctx.org.id, ctx.member.id],
        );
        await bump(ctx);
        await changed(ctx, r, ctx.member.id, "NotificationPreferencesReset");
        return { version: await prefRevision(ctx) };
      }),
    );
    route(
      "POST",
      "/notification-policy",
      [
        "event",
        "channel",
        "moduleEnabled",
        "masterEnabled",
        "defaultEnabled",
        "locked",
      ],
      (r: FastifyRequest) =>
        core.tenant(r, { mode: "authorization_write" }, async (ctx) => {
          const b = body(r, [
              "event",
              "channel",
              "moduleEnabled",
              "masterEnabled",
              "defaultEnabled",
              "locked",
            ]),
            e = eventName(b.event),
            ch = channel(b.channel),
            row = (
              await ctx.c.query(
                "SELECT version FROM platform_policy WHERE organization_id=$1 AND event=$2 AND channel=$3",
                [ctx.org.id, e, ch],
              )
            ).rows[0];
          version(r, row?.version ?? 1);
          const vals = [
            b.moduleEnabled,
            b.masterEnabled,
            b.defaultEnabled,
            b.locked,
          ].map(bool);
          await ctx.c.query(
            "INSERT INTO platform_policy VALUES($1,$2,$3,$4,$5,$6,$7,2) ON CONFLICT(organization_id,event,channel) DO UPDATE SET module_enabled=excluded.module_enabled,master_enabled=excluded.master_enabled,default_enabled=excluded.default_enabled,locked=excluded.locked,version=platform_policy.version+1",
            [ctx.org.id, e, ch, ...vals],
          );
          await changed(ctx, r, ctx.org.id, "NotificationPolicyChanged");
          return { event: e, channel: ch };
        }),
    );
    route("GET", "/notifications", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) => {
        const {locale}=await registry.notificationWorkspace(ctx);
        const scope = await registry.collectionScope(ctx, "read");
        const items = [];
        for (const d of (
          await ctx.c.query(
            "SELECT d.id,d.event,d.resource_type,d.resource_id,d.read_at,d.available_at,d.context,d.created_at,d.actor_name FROM platform_deliveries d WHERE d.organization_id=$1 AND d.recipient_id=$2 AND d.channel='IN_APP' AND d.state='DELIVERED' AND ($3::jsonb IS NULL OR EXISTS(SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS allowed(type text,id uuid) WHERE allowed.type=d.resource_type AND allowed.id=d.resource_id)) ORDER BY d.available_at DESC,d.id DESC LIMIT 100",
            [
              ctx.org.id,
              ctx.member.id,
              scope === null ? null : JSON.stringify(scope),
            ],
          )
        ).rows) {
          if (
            await registry.notificationAllowed(
              ctx,
              { type: d.resource_type, id: d.resource_id },
            )
          ) {
            const resource=await registry.get(d.resource_type)?.lookup?.(ctx,d.resource_id);
            const resourceTitle=resource&&resource.id===d.resource_id&&typeof resource.title==='string'&&resource.title.trim()?resource.title:null;
            const {context,actor_name,...safe}=d;
            items.push({...camel(safe),resourceTitle,presentation:await notificationPresentation(ctx,registry,d)});
          }
        }
        return { items,locale };
      }),
    );
    route("POST", "/deliveries/:deliveryId/retry", [], (r: FastifyRequest) =>
      core.tenant(
        r,
        {
          mode: "write",
          authorize: async (ctx) => {
            const d = (
              await ctx.c.query(
                "SELECT resource_type,resource_id FROM platform_deliveries WHERE organization_id=$1 AND id=$2 AND recipient_id=$3",
                [ctx.org.id, id((r.params as any).deliveryId), ctx.member.id],
              )
            ).rows[0];
            if (!d) fail(404, "RESOURCE_NOT_FOUND");
            return registry.notificationAllowed(
              ctx,
              { type: d.resource_type, id: d.resource_id },
            );
          },
        },
        async (ctx) => {
          const d = (
            await ctx.c.query(
              "SELECT state,attempts FROM platform_deliveries WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, id((r.params as any).deliveryId)],
            )
          ).rows[0];
          version(r, d.attempts);
          if (d.state !== "FAILED") fail(409, "STATE_CONFLICT");
          await ctx.c.query(
            "UPDATE platform_deliveries SET state='PENDING',attempts=0,available_at=now(),lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, id((r.params as any).deliveryId)],
          );
          await changed(
            ctx,
            r,
            id((r.params as any).deliveryId),
            "DeliveryRetried",
          );
          return { state: "PENDING" };
        },
      ),
    );
    route("POST", "/notifications/:deliveryId/read", [], (r: FastifyRequest) =>
      core.tenant(r, { mode: "write", authorize: () => true }, async (ctx) => {
        const d = (
          await ctx.c.query(
            "SELECT * FROM platform_deliveries WHERE organization_id=$1 AND id=$2 AND recipient_id=$3",
            [ctx.org.id, id((r.params as any).deliveryId), ctx.member.id],
          )
        ).rows[0];
        if (!d) fail(404, "RESOURCE_NOT_FOUND");
        if (!(await registry.notificationAllowed(ctx, { type: d.resource_type, id: d.resource_id })))
          fail(404, "RESOURCE_NOT_FOUND");
        await ctx.c.query(
          "UPDATE platform_deliveries SET read_at=now() WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, d.id],
        );
        return { id: d.id };
      }),
    );
    const transferAccess = (r: FastifyRequest) => ({
      mode: "write" as const,
      authorize: async (ctx: Ctx) => {
        const b = r.body as any;
        if (
          !b ||
          typeof b.resourceType !== "string" ||
          !Array.isArray(b.resourceIds) ||
          b.resourceIds.length < 1 ||
          b.resourceIds.length > 1000
        )
          return false;
        if (
          b.includePrivate !== undefined &&
          typeof b.includePrivate !== "boolean"
        )
          return false;
        for (const rid of b.resourceIds)
          if (
            !(await registry.allowed(
              ctx,
              { type: b.resourceType, id: id(rid) },
              b.includePrivate === true ? "export-private" : "export",
            ))
          )
            return false;
        return true;
      },
    });
    route(
      "POST",
      "/exports",
      ["resourceType", "resourceIds", "kind", "format", "includePrivate"],
      async (r: FastifyRequest, reply: any) => {
        const out = await core.tenant(r, transferAccess(r), async (ctx) => {
          const b = body(r, [
            "resourceType",
            "resourceIds",
            "kind",
            "format",
            "includePrivate",
          ]);
          const job = await exportJobs.enqueue(ctx, {
            resourceType: b.resourceType,
            resourceIds: b.resourceIds,
            exportKind: b.kind,
            format: b.format,
            includePrivate: b.includePrivate,
            requestId: r.id,
          });
          await changed(
            ctx,
            r,
            job.id,
            b.includePrivate === true
              ? "ExportPrivateRequested"
              : "ExportRequested",
          );
          return job;
        });
        return reply.code(202).send(out);
      },
    );
    function importDocument(b: Record<string, any>) {
      return b.document
        ? validateDocument(b.document)
        : decodeTransfer(
            Buffer.from(text(b.base64, 7_000_000), "base64"),
            text(b.format),
          );
    }
    route(
      "POST",
      "/imports/targets",
      ["document", "format", "base64", "query"],
      (r: FastifyRequest) =>
        core.tenant(r, false, async (ctx) => {
          const b = body(r, ["document", "format", "base64", "query"]);
          const doc = importDocument(b),
            adapter = registry.get(doc.resourceType);
          if (
            !adapter?.validateImport ||
            !adapter.applyImport ||
            !adapter.search
          )
            return {
              supported: false,
              resourceType: doc.resourceType,
              items: [],
            };
          const query =
            b.query === undefined || b.query === "" ? "" : text(b.query, 200);
          const items = [];
          for (const item of (await adapter.search(ctx, query, 50)).slice(
            0,
            50,
          )) {
            const target = { type: doc.resourceType, id: id(item.id) };
            if (
              item.type === doc.resourceType &&
              (await registry.allowed(ctx, target, "read")) &&
              (await registry.allowed(ctx, target, "import"))
            )
              items.push({
                ...target,
                title: text(item.title, 500),
                canImport: true,
              });
          }
          return { supported: true, resourceType: doc.resourceType, items };
        }),
    );
    async function importPlan(ctx: Ctx, r: FastifyRequest) {
      const b = body(r, [
        "document",
        "format",
        "base64",
        "planHash",
        "resourceId",
      ]);
      const doc = importDocument(b);
      const target = { type: doc.resourceType, id: id(b.resourceId) },
        adapter = await registry.require(ctx, target, "import");
      if (!adapter.validateImport || !adapter.applyImport)
        fail(422, "ADAPTER_REQUIRED");
      const plan = await adapter.validateImport!(ctx, doc.records, doc.kind);
      return {
        doc,
        target,
        plan,
        hash: planHash({
          doc,
          target,
          plan,
          authorizationRevision: ctx.org.authorization_revision,
        }),
      };
    }
    const importAccess = (r: FastifyRequest) => ({
      mode: "write" as const,
      authorize: async (ctx: Ctx) => {
        const b = r.body as any;
        const doc =
          b?.document ??
          (b?.base64
            ? decodeTransfer(
                Buffer.from(text(b.base64, 7_000_000), "base64"),
                text(b.format),
              )
            : null);
        return (
          doc &&
          (await registry.allowed(
            ctx,
            { type: doc.resourceType, id: id(b.resourceId) },
            "import",
          ))
        );
      },
    });
    route(
      "POST",
      "/imports/preview",
      ["document", "format", "base64", "resourceId"],
      (r: FastifyRequest) =>
        core.tenant(r, importAccess(r), async (ctx) => {
          const p = await importPlan(ctx, r);
          return {
            planHash: p.hash,
            warnings: p.plan.warnings,
            recordCount: p.doc.records.length,
          };
        }),
    );
    route(
      "POST",
      "/imports",
      ["document", "format", "base64", "resourceId", "planHash"],
      async (r: FastifyRequest, reply: any) => {
        const out = await core.tenant(r, importAccess(r), async (ctx) => {
          const p = await importPlan(ctx, r);
          if ((r.body as any).planHash !== p.hash)
            fail(409, "IMPORT_PLAN_CHANGED");
          const jobId = uuid();
          await ctx.c.query(
            "INSERT INTO platform_jobs(organization_id,id,owner_id,kind,resource_type,resource_ids,export_kind,input,request_id) VALUES($1,$2,$3,'IMPORT',$4,$5,$6,$7,$8)",
            [
              ctx.org.id,
              jobId,
              ctx.member.id,
              p.target.type,
              [p.target.id],
              p.doc.kind,
              { document: p.doc, plan: p.plan.plan, planHash: p.hash },
              r.id,
            ],
          );
          await changed(ctx, r, jobId, "ImportRequested");
          return { id: jobId, state: "PENDING" };
        });
        return reply.code(202).send(out);
      },
    );
    async function requireJob(ctx: Ctx, jobId: string) {
      const j = (
        await ctx.c.query(
          "SELECT * FROM platform_jobs WHERE organization_id=$1 AND id=$2 AND owner_id=$3",
          [ctx.org.id, jobId, ctx.member.id],
        )
      ).rows[0];
      if (!j) fail(404, "RESOURCE_NOT_FOUND");
      for (const rid of j.resource_ids)
        await registry.require(
          ctx,
          { type: j.resource_type, id: rid },
          j.kind === "EXPORT"
            ? j.include_private
              ? "export-private"
              : "export"
            : "import",
        );
      return j;
    }
    route("GET", "/jobs", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) => {
        const items = [];
        for (const row of (
          await ctx.c.query(
            "SELECT * FROM platform_jobs WHERE organization_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 100",
            [ctx.org.id, ctx.member.id],
          )
        ).rows) {
          let allowed = true;
          for (const rid of row.resource_ids)
            if (
              !(await registry.allowed(
                ctx,
                { type: row.resource_type, id: rid },
                row.kind === "EXPORT"
                  ? row.include_private
                    ? "export-private"
                    : "export"
                  : "import",
              ))
            )
              allowed = false;
          if (allowed) items.push(safeJob(row));
        }
        return { items };
      }),
    );
    route("GET", "/jobs/:jobId", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) =>
        safeJob(await requireJob(ctx, id((r.params as any).jobId))),
      ),
    );
    route("GET", "/jobs/:jobId/attempts", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) => {
        const job = await requireJob(ctx, id((r.params as any).jobId));
        return {
          items: (
            await ctx.c.query(
              "SELECT trace_id,request_id,attempt,stage,error_code,retryable,created_at FROM platform_job_attempts WHERE organization_id=$1 AND job_id=$2 ORDER BY created_at,id",
              [ctx.org.id, job.id],
            )
          ).rows.map(camel),
        };
      }),
    );
    for (const action of ["cancel", "retry"])
      route("POST", "/jobs/:jobId/" + action, [], (r: FastifyRequest) =>
        core.tenant(
          r,
          {
            mode: "write",
            authorize: async (ctx) => {
              await requireJob(ctx, id((r.params as any).jobId));
              return true;
            },
          },
          async (ctx) => {
            const j = await requireJob(ctx, id((r.params as any).jobId));
            version(r, j.version);
            if (
              (action === "retry" && j.state !== "FAILED") ||
              (action === "cancel" && !["PENDING", "RUNNING"].includes(j.state))
            )
              fail(409, "STATE_CONFLICT");
            await ctx.c.query(
              "UPDATE platform_jobs SET state=$3,lease_token=NULL,lease_until=NULL,available_at=now(),attempts=0,version=version+1 WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, j.id, action === "cancel" ? "CANCELLED" : "PENDING"],
            );
            await changed(
              ctx,
              r,
              j.id,
              action === "cancel" ? "JobCancelled" : "JobRetried",
            );
            return {
              id: j.id,
              state: action === "cancel" ? "CANCELLED" : "PENDING",
            };
          },
        ),
      );
    route("GET", "/artifacts/:artifactId/download", [], (r: FastifyRequest) =>
      core.tenant(r, false, async (ctx) => {
        const a = (
          await ctx.c.query(
            "SELECT * FROM platform_artifacts WHERE organization_id=$1 AND id=$2 AND expires_at>now()",
            [ctx.org.id, id((r.params as any).artifactId)],
          )
        ).rows[0];
        if (!a) fail(404, "RESOURCE_NOT_FOUND");
        const j = await requireJob(ctx, a.job_id);
        if (j.state !== "COMPLETED") fail(404, "RESOURCE_NOT_FOUND");
        return {
          name: "orgmap-export." + j.format.toLowerCase(),
          mime:
            j.format === "JSON"
              ? "application/json"
              : j.format === "XLSX"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : j.format === "PDF"
                  ? "application/pdf"
                  : j.format === "ZIP"
                    ? "application/zip"
                    : "text/csv",
          manifest: a.manifest,
          base64: (await blobs.read(a.blob_key, a.sha256)).toString("base64"),
        };
      }),
    );
  };
}

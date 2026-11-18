import type { FastifyInstance } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import type { InteroperabilityPorts } from "./ports.js";
import { verifyWebhook } from "./webhook.js";
import { digest, fail, id, text, uuid } from "../../src/core.js";
export type WebhookConfiguration = {
  secrets: Record<string, string>;
  ports: InteroperabilityPorts;
};
export async function registerWebhooks(
  app: FastifyInstance,
  core: ModuleRuntime,
  base: string,
  configuration: WebhookConfiguration,
) {
  app.addContentTypeParser(
    "application/vnd.orgmap.webhook+json",
    { parseAs: "buffer" },
    (_req, bytes, done) => done(null, bytes),
  );
  app.post(base + "/connections/:connectionId/webhook", async (r) => {
    const org = id((r.params as any).organizationId),
      connection = id((r.params as any).connectionId),
      secret = configuration.secrets[org + ":" + connection];
    if (!secret || !configuration.ports.externalChange)
      fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
    if (!Buffer.isBuffer(r.body)) fail(415, "WEBHOOK_CONTENT_TYPE_REQUIRED");
    const bytes = r.body as Buffer,
      eventId = text(r.headers["x-orgmap-event-id"], 200),
      timestamp = Number(r.headers["x-orgmap-timestamp"]);
    verifyWebhook(
      secret,
      eventId,
      timestamp,
      bytes,
      String(r.headers["x-orgmap-signature"] ?? ""),
    );
    let payload: any;
    try {
      payload = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(400, "INVALID_WEBHOOK_PAYLOAD");
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).some(
        (k) => !["command", "origin", "data"].includes(k),
      ) ||
      payload.command !== "calendar.upsert" ||
      payload.origin === "orgmap" ||
      typeof payload.origin !== "string"
    )
      fail(400, "INVALID_WEBHOOK_COMMAND");
    return core.tenant(
      r,
      { mode: "write", requiredScopes: ["webhooks.receive"] },
      async (ctx) => {
        const row = (
          await ctx.c.query(
            "SELECT * FROM interop_connections WHERE organization_id=$1 AND id=$2 AND state<>'REVOKED'",
            [org, connection],
          )
        ).rows[0];
        if (!row) fail(404, "RESOURCE_NOT_FOUND");
        const previous = (
          await ctx.c.query(
            "SELECT * FROM interop_webhook_inbox WHERE organization_id=$1 AND connection_id=$2 AND event_id=$3",
            [org, connection, eventId],
          )
        ).rows[0];
        if (previous) {
          if (previous.payload_hash !== digest(bytes.toString("base64")))
            fail(409, "WEBHOOK_EVENT_CONFLICT");
          return { duplicate: true, eventId };
        }
        await configuration.ports.externalChange!.apply(ctx, {
          connectionId: connection,
          eventId,
          command: "calendar.upsert",
          data: payload.data,
        });
        await ctx.c.query(
          "INSERT INTO interop_webhook_inbox(organization_id,id,connection_id,event_id,payload_hash) VALUES($1,$2,$3,$4,$5)",
          [org, uuid(), connection, eventId, digest(bytes.toString("base64"))],
        );
        await core.changed(ctx, r, connection, "ExternalChangeReceived");
        return { duplicate: false, eventId };
      },
    );
  });
}

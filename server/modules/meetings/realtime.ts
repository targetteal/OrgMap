import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { body, id, text, uuid, digest, secret, fail } from "../../src/core.js";
import { access as domainAccess } from "./service.js";
import type { MeetingReadPolicy } from "./service.js";
import * as Y from "yjs";
import {
  documentWire,
  requireProtocol,
  candidate,
  LEGACY_PROTOCOL,
} from "./documents.js";
import { windowOpen } from "./domain.js";
export { Y };
const base = "/api/v1/organizations/:organizationId/meetings/:meetingId";
export async function document(ctx: Ctx, mid: string, section: string) {
  const d = (
    await ctx.c.query(
      "SELECT * FROM meeting_documents WHERE organization_id=$1 AND meeting_id=$2 AND section_id=$3 FOR UPDATE",
      [ctx.org.id, mid, section],
    )
  ).rows[0];
  if (!d) fail(404, "RESOURCE_NOT_FOUND");
  return d;
}
export const wire = documentWire;

export async function ingest(
  ctx: Ctx,
  r: FastifyRequest,
  b: any,
  core: ModuleRuntime,
  policy?: MeetingReadPolicy,
) {
  await core.assertResourceAvailable(ctx, "meeting");
  const mid = id((r.params as any).meetingId);
  await domainAccess(ctx, mid, "notes", policy);
  if (
    !b ||
    Object.keys(b).some(
      (k) =>
        ![
          "sectionId",
          "epoch",
          "updateId",
          "update",
          "protocol",
          "schemaVersion",
        ].includes(k),
    )
  )
    fail(400, "INVALID_REQUEST");
  const section = text(b.sectionId, 60),
    updateId = id(b.updateId),
    d = await document(ctx, mid, section);
  if (b.epoch !== d.epoch) fail(409, "STALE_EPOCH_RECOVERY_REQUIRED");
  requireProtocol(d, b);
  if (
    typeof b.update !== "string" ||
    b.update.length > 60000 ||
    !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      b.update,
    )
  )
    fail(400, "INVALID_UPDATE");
  const update = Buffer.from(b.update, "base64"),
    hash = digest(b.update);
  const old = (
    await ctx.c.query(
      "SELECT hash,sequence FROM meeting_updates WHERE organization_id=$1 AND meeting_id=$2 AND section_id=$3 AND epoch=$4 AND update_id=$5",
      [ctx.org.id, mid, section, d.epoch, updateId],
    )
  ).rows[0];
  if (old) {
    if (old.hash !== hash) fail(409, "UPDATE_ID_CONFLICT");
    return {
      type: "ack",
      updateId,
      epoch: d.epoch,
      sequence: old.sequence,
      durable: true,
      document: wire(d),
    };
  }
  const recent = (
    await ctx.c.query(
      `SELECT count(*)::int AS count FROM meeting_updates WHERE organization_id=$1 AND actor_id=$2 AND created_at>clock_timestamp()-interval '1 minute'`,
      [ctx.org.id, ctx.member.id],
    )
  ).rows[0].count;
  if (recent >= 600) fail(429, "RATE_LIMITED");
  const next = candidate(d, update);
  await ctx.c.query(
    "INSERT INTO meeting_updates(organization_id,meeting_id,section_id,epoch,update_id,sequence,hash,actor_id,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      ctx.org.id,
      mid,
      section,
      d.epoch,
      updateId,
      d.sequence + 1,
      hash,
      ctx.member.id,
      update,
    ],
  );
  await ctx.c.query(
    "UPDATE meeting_documents SET sequence=sequence+1,snapshot=$4 WHERE organization_id=$1 AND meeting_id=$2 AND section_id=$3",
    [ctx.org.id, mid, section, next!],
  );
  await core.changed(ctx, r, mid, "CollaborativeUpdateAccepted");
  return {
    type: "ack",
    updateId,
    epoch: d.epoch,
    sequence: d.sequence + 1,
    durable: true,
    document: wire({ ...d, sequence: d.sequence + 1, snapshot: next! }),
  };
}
export async function registerCollaboration(
  app: FastifyInstance,
  core: ModuleRuntime,
  policy?: MeetingReadPolicy,
) {
  const access = (ctx: Ctx, mid: string, action = "read") =>
    domainAccess(ctx, mid, action, policy);
  await app.register(websocket, {
    options: { maxPayload: 65536 },
    preClose: function (done) {
      for (const client of this.websocketServer.clients) client.terminate();
      this.websocketServer.close(done);
    },
  });
  app.post(base + "/collaboration/tickets", (r) =>
    core.tenant(
      r,
      {
        mode: "write",
        authorize: async (ctx) => {
          await core.assertResourceAvailable(ctx, "meeting");
          const b = body(r, [
              "sectionId",
              "epoch",
              "protocol",
              "schemaVersion",
            ]),
            mid = id((r.params as any).meetingId);
          await access(ctx, mid);
          const d = await document(ctx, mid, text(b.sectionId, 60));
          if (b.epoch !== d.epoch) fail(409, "STALE_EPOCH_RECOVERY_REQUIRED");
          requireProtocol(d, b);
          return true;
        },
      },
      async (ctx) => {
        const b = body(r, ["sectionId", "epoch", "protocol", "schemaVersion"]),
          mid = id((r.params as any).meetingId),
          d = await document(ctx, mid, text(b.sectionId, 60));
        if (d.epoch !== b.epoch) fail(409, "STALE_EPOCH_RECOVERY_REQUIRED");
        requireProtocol(d, b);
        const token = secret();
        await ctx.c.query(
          "DELETE FROM meeting_tickets WHERE organization_id=$1 AND expires_at<clock_timestamp()",
          [ctx.org.id],
        );
        await ctx.c.query(
          `INSERT INTO meeting_tickets(organization_id,token_hash,meeting_id,section_id,epoch,member_id,expires_at,protocol,schema_version) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '2 minutes',$7,$8)`,
          [
            ctx.org.id,
            digest(token),
            mid,
            d.section_id,
            d.epoch,
            ctx.member.id,
            d.protocol,
            d.schema_version,
          ],
        );
        return { ticket: token, expiresInSeconds: 120, document: wire(d) };
      },
    ),
  );
  app.post(base + "/collaboration/updates", (r) =>
    core.tenant(
      r,
      {
        mode: "write",
        authorize: async (ctx) => {
          await core.assertResourceAvailable(ctx, "meeting");
          const b = body(r, [
              "sectionId",
              "epoch",
              "updateId",
              "update",
              "protocol",
              "schemaVersion",
            ]),
            mid = id((r.params as any).meetingId);
          await domainAccess(ctx, mid, "notes", policy);
          const d = await document(ctx, mid, text(b.sectionId, 60));
          if (b.epoch !== d.epoch) fail(409, "STALE_EPOCH_RECOVERY_REQUIRED");
          requireProtocol(d, b);
          return true;
        },
      },
      (ctx) => ingest(ctx, r, r.body, core, policy),
    ),
  );
  app.get(base + "/collaboration/socket", { websocket: true }, (socket, r) => {
    const origins = (
      process.env.ALLOWED_ORIGINS ??
      "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001"
    ).split(",");
    if (!origins.includes(String(r.headers.origin))) {
      socket.close(4403, "Origin denied");
      return;
    }
    let token = "",
      ready = false,
      busy = false,
      closed = false,
      lastSeq = -1,
      section = "",
      epoch = 0,
      permissionSignature = "",
      clientProtocol = LEGACY_PROTOCOL,
      clientSchemaVersion: unknown = 1;
    const checked = async (ctx: Ctx) => {
      await core.assertResourceAvailable(ctx, "meeting");
      const t = (
        await ctx.c.query(
          "SELECT * FROM meeting_tickets WHERE organization_id=$1 AND token_hash=$2 AND meeting_id=$3 AND member_id=$4 AND expires_at>clock_timestamp()",
          [
            ctx.org.id,
            digest(token),
            id((r.params as any).meetingId),
            ctx.member.id,
          ],
        )
      ).rows[0];
      if (!t) fail(403, "TICKET_EXPIRED");
      const x = await access(ctx, t.meeting_id),
        signature = JSON.stringify([
          x.p.access,
          x.m.notetaker_id,
          x.m.policy.notesOnlyNoter,
          x.report?.effective_can_edit,
          windowOpen(x.report),
        ]);
      if (permissionSignature && signature !== permissionSignature)
        fail(403, "COLLABORATION_ACCESS_CHANGED");
      permissionSignature = signature;
      const d = await document(ctx, t.meeting_id, t.section_id);
      if (d.epoch !== t.epoch) fail(409, "STALE_EPOCH_RECOVERY_REQUIRED");
      requireProtocol(d, {
        protocol: clientProtocol,
        schemaVersion: clientSchemaVersion,
      });
      if (t.protocol !== d.protocol || t.schema_version !== d.schema_version)
        fail(409, "INCOMPATIBLE_DOCUMENT_PROTOCOL");
      section = t.section_id;
      epoch = t.epoch;
      return d;
    };
    const send = (v: any) => {
      if (!closed && socket.readyState === 1) socket.send(JSON.stringify(v));
    };
    const stop = (e: any) => {
      send({
        type: "error",
        code: e.code ?? "CONNECTION_FAILED",
        recoveryRequired: [
          "STALE_EPOCH_RECOVERY_REQUIRED",
          "INCOMPATIBLE_DOCUMENT_PROTOCOL",
        ].includes(e.code),
      });
      socket.close(e.status === 409 ? 4409 : 4403, "Reauthorize");
    };
    // Reads revalidate revocation/session/window on every poll, even when no client writes.
    const timer = setInterval(async () => {
      if (!ready || busy || closed) return;
      busy = true;
      try {
        const result = await core.tenant(r, { mode: "read" }, async (ctx) => {
          const d = await checked(ctx);
          return wire(d);
        });
        const d = result.data;
        if (d.sequence !== lastSeq) {
          lastSeq = d.sequence;
          send({ type: "sync", document: d });
        }
      } catch (e) {
        stop(e);
      } finally {
        busy = false;
      }
    }, 750);
    socket.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
    socket.on("message", async (raw) => {
      if (busy) {
        send({ type: "retry", code: "BUSY" });
        return;
      }
      busy = true;
      try {
        const b = JSON.parse(raw.toString());
        if (!ready) {
          if (b.type !== "hello" || typeof b.ticket !== "string")
            fail(400, "HANDSHAKE_REQUIRED");
          token = text(b.ticket, 100);
          clientProtocol = b.protocol ?? LEGACY_PROTOCOL;
          clientSchemaVersion =
            b.schemaVersion ??
            (clientProtocol === LEGACY_PROTOCOL ? 1 : undefined);
          const result = await core.tenant(r, { mode: "read" }, async (ctx) =>
            wire(await checked(ctx)),
          );
          ready = true;
          lastSeq = result.data.sequence;
          send({ type: "sync", document: result.data });
        } else if (b.type === "update") {
          // Ticket issued by CSRF-protected POST scopes this channel. Core still authenticates cookie/session,
          // active membership and resource ACL under the same org lock on each message.
          const result = await core.tenant(
            r,
            {
              mode: "write",
              authorize: async (ctx) => {
                await checked(ctx);
                await access(ctx, id((r.params as any).meetingId), "notes");
                return true;
              },
            },
            (ctx) =>
              ingest(
                ctx,
                r,
                {
                  sectionId: section,
                  epoch: b.epoch,
                  updateId: b.updateId,
                  update: b.update,
                  protocol: b.protocol,
                  schemaVersion: b.schemaVersion,
                },
                core,
                policy,
              ),
          );
          send(result.data);
          lastSeq = result.data.sequence;
        } else if (b.type === "awareness") {
          send({ type: "awareness", epoch });
        } else fail(400, "INVALID_REQUEST");
      } catch (e) {
        stop(e);
      } finally {
        busy = false;
      }
    });
  });
}

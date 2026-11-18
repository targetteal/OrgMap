import * as Y from "yjs";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type { GuestAccessAdapter } from "../../src/guest-contract.js";
import { fail, id, camel } from "../../src/core.js";
import {
  access,
  type MeetingPorts,
  type MeetingReadPolicy,
} from "./service.js";
import { cursor, pageInput } from "./pagination.js";
export type MeetingGuestPort = Pick<
  ModuleRuntime,
  "requireGuestResource" | "guestResourceIds" | "assertResourceAvailable"
>;
export const isMeetingGuest = (ctx: Ctx) => ctx.member.member_type === "GUEST";
export function createMeetingGuestAccessAdapter(
  core: ModuleRuntime,
  ports: MeetingPorts,
): GuestAccessAdapter {
  const base = "/api/v1/organizations/:organizationId";
  return {
    context: "meetings",
    routes: [
      {
        method: "GET",
        path: base + "/meetings",
        action: "read",
        collection: true,
      },
      {
        method: "GET",
        path: base + "/meetings/:meetingId",
        action: "read",
        resolve: async (_ctx, r) => ({
          context: "meetings",
          kind: "meeting",
          id: id((r.params as any).meetingId),
        }),
      },
      {
        method: "GET",
        path: base + "/meeting-reports",
        action: "read",
        collection: true,
      },
      {
        method: "GET",
        path: base + "/meeting-reports/:reportId",
        action: "read",
        resolve: async (_ctx, r) => ({
          context: "meetings",
          kind: "report",
          id: id((r.params as any).reportId),
        }),
      },
    ],
    async validateSharePlan(ctx, plan) {
      if (isMeetingGuest(ctx) || ctx.member.status !== "ACTIVE") return false;
      try {
        for (const item of plan) {
          const { resource, actions } = item;
          if (
            resource.context !== "meetings" ||
            !["meeting", "report"].includes(resource.kind) ||
            !actions.includes("read") ||
            actions.some((x) => x !== "read")
          )
            return false;
          await core.assertResourceAvailable(ctx, resource.kind);
          let mid = id(resource.id);
          if (resource.kind === "report") {
            const report = (
              await ctx.c.query(
                "SELECT meeting_id,state FROM meeting_reports WHERE organization_id=$1 AND id=$2",
                [ctx.org.id, mid],
              )
            ).rows[0];
            if (!report || report.state !== "PUBLISHED") return false;
            mid = report.meeting_id;
          }
          const { p, supervised } = await access(
            ctx,
            mid,
            "manage",
            ports.readPolicy,
          );
          if (supervised || !p.can_manage) return false;
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}
const bindings = new WeakMap<ModuleRuntime, MeetingPorts>();
/** Shared by HTTP and resource worker composition; exactly one registration/runtime. */
export function createMeetingRuntimePorts(
  core: ModuleRuntime,
  input: MeetingPorts,
): MeetingPorts {
  const prior = bindings.get(core);
  if (prior) return prior;
  const ports = {
    ...input,
    readPolicy: { ...input.readPolicy, guestAccess: core } as MeetingReadPolicy,
  };
  core.registerGuestAccessAdapter(createMeetingGuestAccessAdapter(core, ports));
  bindings.set(core, ports);
  return ports;
}
export function guestMeetingRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    start_at: row.start_at,
    end_at: row.end_at,
    duration_minutes: row.duration_minutes,
    time_zone: row.time_zone,
    version: row.version,
    sections: row.sections,
    current_step: row.current_step,
    method: row.method,
    policy: { notesOnlyNoter: true },
    shared_read_only: true,
  };
}
export function guestDocuments(docs: any[]) {
  return docs.map((d) => {
    const result = {
      sectionId: d.sectionId,
      epoch: d.epoch,
      sequence: d.sequence,
      protocol: d.protocol,
      schemaVersion: d.schemaVersion,
    };
    if (d.document) return { ...result, document: d.document };
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, Buffer.from(d.snapshot, "base64"));
      return { ...result, text: doc.getText("notes").toString() };
    } finally {
      doc.destroy();
    }
  });
}
export const guestAgendaRow = (a: any) => ({
  id: a.id,
  meetingId: null,
  title: a.title,
  status: a.status,
  skipped: a.skipped,
  durationMinutes: a.durationMinutes,
  version: a.version,
  sourceId: null,
  presenterId: null,
  transferredFrom: null,
});
export const guestActionRow = (a: any) => ({
  id: a.id,
  title: a.title,
  state: a.state,
  version: a.version,
  agendaId: a.agendaId,
  assigneeId: null,
});
export async function guestMeetingIds(ctx: Ctx, guest: MeetingGuestPort) {
  await guest.assertResourceAvailable(ctx, "meeting");
  return [
    ...(await guest.guestResourceIds(ctx, {
      context: "meetings",
      kind: "meeting",
      action: "read",
    })),
  ].sort();
}
export async function guestMeetingList(
  ctx: Ctx,
  b: any,
  policy: MeetingReadPolicy,
) {
  const guest = policy.guestAccess;
  if (!guest) fail(404, "RESOURCE_NOT_FOUND");
  const ids = await guestMeetingIds(ctx, guest!);
  const from = b.from ?? "0001-01-01T00:00:00Z",
    until = b.until ?? "9999-12-31T23:59:59Z";
  if (
    Object.keys(b).some(
      (k) => !["from", "until", "state", "limit", "cursor", "circleId"].includes(k),
    ) ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(until)) ||
    Date.parse(from) >= Date.parse(until) ||
    (b.state &&
      !["SCHEDULED", "RUNNING", "CLOSED", "CANCELLED"].includes(b.state))
  )
    fail(400, "INVALID_REQUEST");
  const circleId=b.circleId===undefined?null:id(b.circleId);
  const scope = JSON.stringify([
      ctx.org.id,
      ctx.member.id,
      "guest-meetings",
      ids,
      from,
      until,
      b.state ?? null,
      ctx.org.authorization_revision,
      ...(circleId?[circleId]:[]),
    ]),
    page = pageInput(b, scope);
  const items = (
    await ctx.c.query(
      `SELECT m.* FROM meeting_occurrences m WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND m.start_at>=$3 AND m.start_at<$4 AND ($5::timestamptz IS NULL OR (m.start_at,m.id)>($5::timestamptz,$6::uuid)) AND ($7::text IS NULL OR m.state=$7) AND NOT EXISTS(SELECT 1 FROM meeting_participants p WHERE p.organization_id=m.organization_id AND p.meeting_id=m.id AND p.member_id=$8 AND p.access='DENY') AND NOT EXISTS(SELECT 1 FROM meeting_reports rp JOIN meeting_report_access ra ON ra.organization_id=rp.organization_id AND ra.report_id=rp.id WHERE rp.organization_id=m.organization_id AND rp.meeting_id=m.id AND ra.member_id=$8 AND NOT ra.can_read) AND ($10::uuid IS NULL OR m.circle_id=$10) ORDER BY m.start_at,m.id LIMIT $9`,
      [
        ctx.org.id,
        ids,
        from,
        until,
        page.startAt,
        page.id,
        b.state ?? null,
        ctx.member.id,
        page.limit + 1,
        circleId,
      ],
    )
  ).rows.map((r) => camel(guestMeetingRow(r)));
  const hasMore = items.length > page.limit;
  if (hasMore) items.pop();
  const last = items.at(-1);
  return {
    items,
    page: {
      hasMore,
      nextCursor: hasMore
        ? cursor({ startAt: last!.startAt, id: last!.id }, scope)
        : null,
    },
    coverage: { limit: page.limit, scope: "EXPLICIT_MEETING_GRANTS_ONLY" },
    capabilities: { create: false },
  };
}
export async function guestReport(
  ctx: Ctx,
  rid: string,
  policy?: MeetingReadPolicy,
) {
  if (!isMeetingGuest(ctx)) fail(403, "ACTION_DENIED");
  const guest = policy?.guestAccess;
  if (!guest) fail(404, "RESOURCE_NOT_FOUND");
  await guest!.assertResourceAvailable(ctx, "report");
  await guest!.requireGuestResource(
    ctx,
    { context: "meetings", kind: "report", id: id(rid) },
    "read",
  );
  const report = (
    await ctx.c.query(
      "SELECT * FROM meeting_reports WHERE organization_id=$1 AND id=$2 AND state='PUBLISHED'",
      [ctx.org.id, rid],
    )
  ).rows[0];
  if (!report) fail(404, "RESOURCE_NOT_FOUND");
  const denied = await ctx.c.query(
    "SELECT 1 FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3 AND access='DENY' UNION ALL SELECT 1 FROM meeting_report_access WHERE organization_id=$1 AND report_id=$4 AND member_id=$3 AND NOT can_read",
    [ctx.org.id, report.meeting_id, ctx.member.id, rid],
  );
  if (denied.rowCount) fail(404, "RESOURCE_NOT_FOUND");
  const version = (
    await ctx.c.query(
      "SELECT snapshot,version FROM meeting_report_versions WHERE organization_id=$1 AND report_id=$2 AND publication_status='PUBLISHED' ORDER BY version DESC LIMIT 1",
      [ctx.org.id, rid],
    )
  ).rows[0];
  if (!version) fail(404, "RESOURCE_NOT_FOUND");
  const s = version.snapshot;
  const meeting = camel(
    guestMeetingRow(
      Object.fromEntries(
        Object.entries(s.meeting).map(([k, v]) => [
          k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()),
          v,
        ]),
      ),
    ),
  );
  meeting.id = null;
  return {
    report: {
      id: report.id,
      state: report.state,
      version: version.version,
      firstPublishedAt: report.first_published_at,
    },
    snapshot: {
      meeting,
      participants: [],
      agenda: (s.agenda ?? []).map(guestAgendaRow),
      actions: (s.actions ?? []).filter((a:any)=>!a.targetKind).map(guestActionRow),
      documents: guestDocuments(s.documents ?? []),
    },
    capabilities: {
      edit: false,
      notes: false,
      publish: false,
      restore: false,
      manage: false,
    },
    accessMode: "GUEST_READ",
  };
}

/** Resource-read worker boundary. Core checks the live grant first; the domain
 * then checks the recipient's current DENY/report restriction before callback.
 * Never use this read-only entry point for exports or mutation jobs.
 */
export function createMeetingGuestReadContext(
  core: ModuleRuntime,
  input: MeetingPorts,
) {
  const ports = createMeetingRuntimePorts(core, input);
  return async function withGuestReadContext<T>(
    organizationId: string,
    memberId: string,
    resources: readonly {
      context: "meetings";
      kind: "meeting" | "report";
      id: string;
    }[],
    callback: (ctx: Ctx) => Promise<T>,
  ): Promise<T> {
    if (
      !resources.length ||
      resources.length > 1000 ||
      resources.some(
        (r) =>
          r.context !== "meetings" || !["meeting", "report"].includes(r.kind),
      )
    )
      fail(400, "INVALID_REQUEST");
    return core.withResourceWorkerContext(
      organizationId,
      memberId,
      resources.map((resource) => ({ resource, action: "read" })),
      async (ctx) => {
        if (!isMeetingGuest(ctx)) fail(403, "ACTION_DENIED");
        for (const resource of resources) {
          if (resource.kind === "meeting")
            await access(ctx, id(resource.id), "read", ports.readPolicy);
          else await guestReport(ctx, id(resource.id), ports.readPolicy);
        }
        return callback(ctx);
      },
    );
  };
}

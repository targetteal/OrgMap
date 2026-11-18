import {readAgendaSource} from "./agenda-source.js";
import { publishMeetingScheduled, publishReportPublished } from "./notifications.js";
import type { FastifyRequest } from "fastify";
import type { OrgMapModule, Ctx } from "../../src/runtime.js";
import {
  body,
  id,
  text,
  optionalText,
  version,
  uuid,
  camel,
  fail,
  secret,
  digest,
  key,
} from "../../src/core.js";
import {parseMeetingOutcome} from './outcomes.js';
import {
  sections,
  participants,
  policy,
  integer,
  bool,
  windowOpen,
} from "./domain.js";
import { rule, occurrences } from "./calendar.js";
import {
  access as domainAccess,
  authorizeMeetingScope as domainScope,
  detail as domainDetail,
  insertOccurrence,
  insertParticipant,
  memberCheck,
  selfOnlyPorts,
  saveReportVersion,
  type MeetingPorts,
  supervisionRead,
} from "./service.js";
import { registerCollaboration } from "./realtime.js";
import { registerDocumentMigration } from "./migration.js";
import {
  protocol as documentProtocol,
  LEGACY_PROTOCOL,
  archiveEpoch,
  restoreSnapshot,
} from "./documents.js";
import { registerScheduling } from "./scheduling.js";
import { isMeetingGuest, guestMeetingList, guestReport } from "./guest.js";
import { cursor, pageInput } from "./pagination.js";
import {
  registerAgendaItems,
  agendaTarget,
  createAgendaIntention,
  placeAgendaItem,
  moveAgendaItem,
  releaseMeetingAgenda,
  completeAgendaItem,
} from "./agenda-items.js";
import {
  registerMeetingStatistics,
  captureFirstMeetingClose,
} from "./statistics.js";
import { registerMeetingExports } from "./exports.js";
import { o2Membership, registerO2Panel, authorizeO2Contribution, assertO2Completion } from "./o2-panel.js";
const base = "/api/v1/organizations/:organizationId";
const mid = (r: FastifyRequest) => id((r.params as any).meetingId);
export function createMeetings(
  ports: MeetingPorts = selfOnlyPorts,
): OrgMapModule {
  return async (app, core) => {
    ports = {...ports, readPolicy: {...ports.readPolicy, o2Member: async (ctx, circleId) =>
      o2Membership(core,ctx,circleId)}};
    await registerO2Panel(app, core, ports);
    const access = (ctx: Ctx, mid: string, action = "read") =>
      domainAccess(ctx, mid, action, ports.readPolicy);
    const detail = (ctx: Ctx, mid: string) =>
      domainDetail(ctx, mid, {...ports.readPolicy,outcomes:ports.outcomes});
    const authorizeMeetingScope = (ctx: Ctx, mid: string, scope: unknown) =>
      domainScope(ctx, mid, scope, ports.readPolicy);
    const read = (r: FastifyRequest, fn: (ctx: Ctx) => Promise<any>) =>
      core.tenant(r, { mode: "read" }, fn);
    const command = (
      r: FastifyRequest,
      action: string,
      fn: (ctx: Ctx) => Promise<any>,
    ) =>
      core.tenant(
        r,
        {
          mode: /\/(participants(?:\/remove)?|notetaker|facilitator|claim-secretary|access)$/.test(
            r.url.split("?")[0],
          )
            ? "authorization_write"
            : "write",
          authorize: async (ctx) => {
            await core.assertResourceAvailable(ctx, "meeting");
            if (r.url.includes("/report/"))
              await core.assertResourceAvailable(ctx, "report");
            await access(ctx, mid(r), action);
            if(r.url.split('?')[0].endsWith('/actions/claim-secretary')) {
              const {m}=await access(ctx,mid(r),'read');
              if(await o2Membership(core,ctx,m.circle_id)===false)fail(403,'ACTION_DENIED');
            }
            if (
              /\/agenda\/[^/]+\/actions\/transfer$/.test(r.url.split("?")[0])
            ) {
              await agendaTarget(ctx, mid(r), ports);
              await agendaTarget(
                ctx,
                id((r.body as any)?.targetMeetingId),
                ports,
              );
            }
            if (r.url.split("?")[0].endsWith("/actions/participants"))
              await authorizeMeetingScope(ctx, mid(r), (r.body as any)?.scope);
            return true;
          },
          ...(r.url.split("?")[0].endsWith("/actions/claim-secretary") ? {
            beforeReplay: async (ctx: Ctx) => {
              const { m, p, supervised } = await access(ctx, mid(r), "read");
              if (!['SCHEDULED','RUNNING'].includes(m.state) || m.method !== "HOLACRACY" ||
                  supervised || m.notetaker_id !== ctx.member.id || p.attendance !== "PRESENT")
                fail(403, "ACTION_DENIED");
            },
          } : {}),
        },
        fn,
      );
    app.get(base + "/meeting-templates", (r) =>
      read(r, async (ctx) => ({
        items: (
          await ctx.c.query(
            "SELECT * FROM meeting_templates WHERE organization_id=$1 ORDER BY name,id",
            [ctx.org.id],
          )
        ).rows.map(camel),
      })),
    );
    app.post(base + "/meeting-templates/:templateId/actions/revise", (r) =>
      core.tenant(r, { mode: "write" }, async (ctx) => {
        const tid = id((r.params as any).templateId),
          t = (
            await ctx.c.query(
              "SELECT * FROM meeting_templates WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, tid],
            )
          ).rows[0];
        if (!t) fail(404, "RESOURCE_NOT_FOUND");
        version(r, t.version);
        const b = body(r, ["name", "sections", "method"]);
        if (!["CUSTOM", "HOLACRACY"].includes(b.method))
          fail(400, "INVALID_REQUEST");
        const updated = (
          await ctx.c.query(
            "UPDATE meeting_templates SET name=$3,sections=$4,method=$5,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
            [
              ctx.org.id,
              tid,
              text(b.name),
              JSON.stringify(sections(b.sections)),
              b.method,
            ],
          )
        ).rows[0];
        await core.changed(ctx, r, tid, "MeetingTemplateRevised");
        return { template: camel(updated) };
      }),
    );
    app.post(base + "/meeting-templates", async (r, reply) => {
      const result = await core.tenant(r, { mode: "write" }, async (ctx) => {
        const b = body(r, ["name", "sections", "method"]),
          s = sections(b.sections),
          method = b.method ?? "CUSTOM";
        if (!["CUSTOM", "HOLACRACY"].includes(method))
          fail(400, "INVALID_REQUEST");
        const tid = uuid();
        await ctx.c.query(
          "INSERT INTO meeting_templates(organization_id,id,name,sections,method) VALUES($1,$2,$3,$4,$5)",
          [ctx.org.id, tid, text(b.name), JSON.stringify(s), method],
        );
        await core.changed(ctx, r, tid, "MeetingTemplateCreated");
        return {
          template: camel(
            (
              await ctx.c.query(
                "SELECT * FROM meeting_templates WHERE organization_id=$1 AND id=$2",
                [ctx.org.id, tid],
              )
            ).rows[0],
          ),
        };
      });
      reply.code(201);
      return result;
    });
    app.get(base+'/meetings/:meetingId/agenda/:agendaId/origin',r=>read(r,async ctx=>{
      await domainAccess(ctx,mid(r),'read',ports.readPolicy);
      if(isMeetingGuest(ctx))return {origin:null};
      const row=(await ctx.c.query("SELECT i.source_kind,i.source_id FROM meeting_agenda a JOIN meeting_agenda_items i ON i.organization_id=a.organization_id AND i.id=a.agenda_item_id WHERE a.organization_id=$1 AND a.meeting_id=$2 AND a.id=$3",[ctx.org.id,mid(r),id((r.params as any).agendaId)])).rows[0];
      if(!row)fail(404,'RESOURCE_NOT_FOUND');
      return {origin:await readAgendaSource(ctx,row.source_kind,row.source_id,ports.readPolicy?.trace)};
    }));
    app.get(base + "/meetings", (r) =>
      read(r, async (ctx) => {
        const b = r.query as any;
        if (isMeetingGuest(ctx))
          return guestMeetingList(ctx, b, ports.readPolicy ?? {});
        if (
          Object.keys(b).some(
            (k) => !["from", "until", "limit", "cursor", "state", "circleId"].includes(k),
          )
        )
          fail(400, "INVALID_REQUEST");
        const from = b.from ?? "0001-01-01T00:00:00Z",
          until = b.until ?? "9999-12-31T23:59:59Z";
        if (
          !Number.isFinite(Date.parse(from)) ||
          !Number.isFinite(Date.parse(until))
        )
          fail(400, "INVALID_REQUEST");
        if (Date.parse(from) >= Date.parse(until)) fail(400, "INVALID_REQUEST");
        if (
          b.state !== undefined &&
          !["SCHEDULED", "RUNNING", "CLOSED", "CANCELLED"].includes(b.state)
        )
          fail(400, "INVALID_REQUEST");
        const circleId=b.circleId===undefined?null:id(b.circleId);
        const scope = JSON.stringify([
            ctx.org.id,
            ctx.member.id,
            "meetings",
            from,
            until,
            b.state ?? null,
            await supervisionRead(ctx, ports.readPolicy),
            ...(circleId?[circleId]:[]),
          ]),
          page = pageInput(b, scope);
        const items = (
          await ctx.c.query(
            `SELECT m.*, (p.member_id IS NOT NULL AND p.access IN ('READ','EDIT')) AS is_participant FROM meeting_occurrences m LEFT JOIN meeting_participants p ON p.organization_id=m.organization_id AND p.meeting_id=m.id AND p.member_id=$2 WHERE m.organization_id=$1 AND (p.access IN ('READ','EDIT') OR (p.member_id IS NULL AND ($9 OR m.circle_id=ANY($11::uuid[])))) AND m.start_at>=$3 AND m.start_at<$4 AND ($5::timestamptz IS NULL OR (m.start_at,m.id)>($5::timestamptz,$6::uuid)) AND NOT EXISTS(SELECT 1 FROM meeting_reports rp JOIN meeting_report_access ra ON ra.organization_id=rp.organization_id AND ra.report_id=rp.id WHERE rp.organization_id=m.organization_id AND rp.meeting_id=m.id AND ra.member_id=$2 AND NOT ra.can_read) AND ($8::text IS NULL OR m.state=$8) AND ($10::uuid IS NULL OR m.circle_id=$10) ORDER BY m.start_at,m.id LIMIT $7`,
            [
              ctx.org.id,
              ctx.member.id,
              from,
              until,
              page.startAt,
              page.id,
              page.limit + 1,
              b.state ?? null,
              await supervisionRead(ctx, ports.readPolicy),
              circleId,
              await core.governanceModel()?.state(ctx) ? ((await core.foundationStructure()!.membershipReasons(ctx,ctx.member.id)) as {circles:string[]}).circles : [],
            ],
          )
        ).rows.map(camel);
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
          coverage: { limit: page.limit, from, until },
        };
      }),
    );
    app.get(base + "/meeting-agenda", (r) =>
      read(r, async (ctx) => {
        const b = r.query as any;
        if (Object.keys(b).some((k) => !["limit", "cursor"].includes(k)))
          fail(400, "INVALID_REQUEST");
        const scope = JSON.stringify([
            ctx.org.id,
            ctx.member.id,
            "agenda",
            await supervisionRead(ctx, ports.readPolicy),
          ]),
          page = pageInput(b, scope);
        const items = (
          await ctx.c.query(
            `SELECT a.*,m.title AS meeting_title,m.state AS meeting_state,m.start_at FROM meeting_agenda a JOIN meeting_occurrences m ON m.organization_id=a.organization_id AND m.id=a.meeting_id LEFT JOIN meeting_participants p ON p.organization_id=m.organization_id AND p.meeting_id=m.id AND p.member_id=$2 WHERE a.organization_id=$1 AND (p.access IN ('READ','EDIT') OR (p.member_id IS NULL AND $6)) AND ($3::timestamptz IS NULL OR (m.start_at,a.id)>($3::timestamptz,$4::uuid)) AND NOT EXISTS(SELECT 1 FROM meeting_reports rp JOIN meeting_report_access ra ON ra.organization_id=rp.organization_id AND ra.report_id=rp.id WHERE rp.organization_id=m.organization_id AND rp.meeting_id=m.id AND ra.member_id=$2 AND NOT ra.can_read) ORDER BY m.start_at,a.id LIMIT $5`,
            [
              ctx.org.id,
              ctx.member.id,
              page.startAt,
              page.id,
              page.limit + 1,
              await supervisionRead(ctx, ports.readPolicy),
            ],
          )
        ).rows.map(camel);
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
          coverage: { limit: page.limit },
        };
      }),
    );
    app.post(base + "/meeting-series", async (r, reply) => {
      const result = await core.tenant(r, { mode: "write", authorize: async ctx => {
        const modeled=await o2Membership(core,ctx,id((r.body as any)?.circleId));
        return modeled ?? ctx.member.org_role==='OWNER';
      } }, async (ctx) => {
        const b = body(r, [
          "title",
          "circleId",
          "localStart",
          "timeZone",
          "durationMinutes",
          "recurrence",
          "templateId",
          "sections",
          "method",
          "participants",
          "policy",
          "notesProtocol",
          "roster",
          "startNow",
        ]);
        await core.get(ctx.c, ctx.org.id, id(b.circleId), "CIRCLE");
        let snapshot: any;
        if (b.templateId) {
          const t = (
            await ctx.c.query(
              "SELECT * FROM meeting_templates WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, id(b.templateId)],
            )
          ).rows[0];
          if (!t) fail(404, "RESOURCE_NOT_FOUND");
          snapshot = {
            sections: t.sections,
            method: t.method,
            templateId: t.id,
            version: t.version,
          };
        } else {
          if (!["CUSTOM", "HOLACRACY"].includes(b.method ?? "CUSTOM"))
            fail(400, "INVALID_REQUEST");
          snapshot = {
            sections: sections(b.sections),
            method: b.method ?? "CUSTOM",
          };
        }
        if(await o2Membership(core,ctx,id(b.circleId)) === true) {
          snapshot.method='HOLACRACY';
          const local=(await ctx.c.query('SELECT sections,review_items FROM meeting_o2_circle_templates WHERE organization_id=$1 AND circle_id=$2',[ctx.org.id,id(b.circleId)])).rows[0];
          if(local&&!b.templateId){snapshot.sections=local.sections;snapshot.reviewItems=local.review_items;}
        }
        let ps = participants(b.participants ?? []);
        if (b.roster) {
          if (!ports.resolveRoster) fail(503, "ROSTER_PORT_UNAVAILABLE");
          if (
            typeof b.roster !== "object" ||
            Array.isArray(b.roster) ||
            Object.keys(b.roster).some(
              (k) => !["includeSubcircles", "roleIds"].includes(k),
            ) ||
            !Array.isArray(b.roster.roleIds ?? [])
          )
            fail(400, "INVALID_REQUEST");
          const resolved = await ports.resolveRoster!(ctx, {
            circleId: id(b.circleId),
            includeSubcircles: bool(b.roster.includeSubcircles ?? false),
            roleIds: (b.roster.roleIds ?? []).map(id),
          });
          const roster = new Map<string, (typeof resolved)[number]>();
          for (const entry of resolved) {
            const previous = roster.get(entry.memberId);
            roster.set(
              entry.memberId,
              previous
                ? {
                    ...previous,
                    access:
                      previous.access === "EDIT" || entry.access === "EDIT"
                        ? "EDIT"
                        : "READ",
                    participationRole:
                      previous.participationRole === "REQUIRED" ||
                      entry.participationRole === "REQUIRED"
                        ? "REQUIRED"
                        : "OPTIONAL",
                  }
                : entry,
            );
          }
          ps = [
            ...[...roster.values()]
              .filter((x) => !ps.some((p) => p.memberId === x.memberId))
              .map((x) => ({
                ...x,
                canManage: false,
                canPublish: false,
                canRestore: false,
              })),
            ...ps,
          ];
        }
        await memberCheck(
          ctx,
          ps.map((p) => p.memberId),
          ports,
        );
        if (!ps.some((p) => p.memberId === ctx.member.id))
          ps.push({
            memberId: ctx.member.id,
            access: "EDIT",
            canManage: true,
            canPublish: true,
            canRestore: true,
            participationRole: "REQUIRED",
            origin: "DIRECT",
          });
        const creator = ps.find((p) => p.memberId === ctx.member.id)!;
        if (creator.origin !== "DIRECT")
          Object.assign(creator, {
            access: "EDIT",
            canManage: true,
            canPublish: true,
            canRestore: true,
          });
        if (creator.access !== "EDIT" || !creator.canManage)
          fail(422, "MANAGER_REQUIRED");
        snapshot = {
          ...snapshot,
          notesProtocol: documentProtocol(b.notesProtocol ?? LEGACY_PROTOCOL),
        };
        const rr = rule(b.recurrence),
          os = occurrences(text(b.localStart), text(b.timeZone), rr),
          sid = uuid();
        const s = {
          id: sid,
          title: text(b.title),
          circle_id: id(b.circleId),
          local_start: text(b.localStart),
          time_zone: text(b.timeZone),
          duration_minutes: integer(b.durationMinutes, 1, 10080),
          recurrence: rr,
          template_snapshot: snapshot,
          participants: ps,
          policy: policy(b.policy ?? {}),
        };
        await ctx.c.query(
          `INSERT INTO meeting_series(organization_id,id,title,circle_id,local_start,time_zone,duration_minutes,recurrence,template_snapshot,participants,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            ctx.org.id,
            sid,
            s.title,
            s.circle_id,
            s.local_start,
            s.time_zone,
            s.duration_minutes,
            JSON.stringify(rr),
            JSON.stringify(snapshot),
            JSON.stringify(ps),
            JSON.stringify(s.policy),
          ],
        );
        const ids = [];
        for (const o of os) ids.push(await insertOccurrence(ctx, s, o));
        await core.changed(ctx, r, sid, "MeetingScheduled");
        await publishMeetingScheduled(core,ctx,ids);
        if (bool(b.startNow ?? false)) {
          await ctx.c.query(
            `UPDATE meeting_occurrences SET state='RUNNING',started_at=clock_timestamp(),current_step=$3,version=version+1 WHERE organization_id=$1 AND id=$2`,
            [ctx.org.id, ids[0], snapshot.sections[0].id],
          );
          await core.changed(ctx, r, ids[0], "MeetingStarted");
        }
        return { series: camel(s), occurrenceIds: ids };
      });
      reply.code(201);
      return result;
    });
    app.get(base + "/meeting-reports/:reportId", (r) =>
      read(r, async (ctx) => {
        if (!isMeetingGuest(ctx)) fail(404, "RESOURCE_NOT_FOUND");
        return guestReport(
          ctx,
          id((r.params as any).reportId),
          ports.readPolicy,
        );
      }),
    );
    app.get(base + "/meeting-reports", (r) =>
      read(r, async (ctx) => {
        if (!isMeetingGuest(ctx) || !ports.readPolicy?.guestAccess)
          fail(404, "RESOURCE_NOT_FOUND");
        const ids = await ports.readPolicy!.guestAccess!.guestResourceIds(ctx, {
          context: "meetings",
          kind: "report",
          action: "read",
        });
        const items = [];
        for (const rid of ids) {
          try {
            const result = await guestReport(ctx, rid, ports.readPolicy);
            items.push(result);
          } catch (e) {
            if ((e as any).status !== 404) throw e;
          }
        }
        return {
          items,
          coverage: "EXPLICIT_REPORT_GRANTS_ONLY",
          capabilities: { create: false },
        };
      }),
    );
    app.get(base + "/meetings/:meetingId", (r) =>
      read(r, (ctx) => detail(ctx, mid(r))),
    );
    app.get(base + "/meetings/:meetingId/linked-items", (r) =>
      read(r, async (ctx) => {
        const { m } = await access(ctx, mid(r));
        const q = r.query as any;
        if (
          Object.keys(q).some((k) => k !== "includeSubcircles") ||
          (q.includeSubcircles !== undefined &&
            !["true", "false"].includes(q.includeSubcircles))
        )
          fail(400, "INVALID_REQUEST");
        if (!ports.linkedItems) fail(503, "LINKED_ITEMS_PORT_UNAVAILABLE");
        return {
          items: await ports.linkedItems!(ctx, {
            circleId: m.circle_id,
            includeSubcircles: q.includeSubcircles === "true",
          }),
        };
      }),
    );
    app.post(base + "/meetings/:meetingId/report/actions/access", (r) =>
      command(r, "manage", async (ctx) => {
        const { m, report } = await access(ctx, mid(r), "manage"),
          b = body(r, ["memberId", "canRead", "canEdit"]);
        if (!report) fail(409, "STATE_CONFLICT");
        version(r, report.version);
        const member = id(b.memberId),
          canRead = bool(b.canRead),
          canEdit = bool(b.canEdit);
        if (!canRead && canEdit) fail(422, "DOMAIN_INVARIANT");
        await memberCheck(ctx, [member], ports);
        await ctx.c.query(
          "INSERT INTO meeting_report_access(organization_id,report_id,member_id,can_read,can_edit) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,report_id,member_id) DO UPDATE SET can_read=excluded.can_read,can_edit=excluded.can_edit",
          [ctx.org.id, report.id, member, canRead, canEdit],
        );
        await ctx.c.query(
          "UPDATE meeting_reports SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, report.id],
        );
        const rp = (
          await ctx.c.query(
            "SELECT * FROM meeting_reports WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, report.id],
          )
        ).rows[0];
        await saveReportVersion(ctx, rp, "Report access changed");
        await core.changed(ctx, r, report.id, "ReportAccessChanged");
        return { report: camel(rp) };
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/start", (r) =>
      command(r, "secretaryOperation", async (ctx) => {
        const { m } = await access(ctx, mid(r), "secretaryOperation");
        body(r, []);
        if (m.state === "RUNNING") return detail(ctx, m.id);
        version(r, m.version);
        if (m.state !== "SCHEDULED") fail(409, "STATE_CONFLICT");
        await ctx.c.query(
          `UPDATE meeting_occurrences SET state='RUNNING',started_at=clock_timestamp(),current_step=$3,version=version+1 WHERE organization_id=$1 AND id=$2`,
          [ctx.org.id, m.id, m.sections[0].id],
        );
        await core.changed(ctx, r, m.id, "MeetingStarted");
        return detail(ctx, m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/step", (r) =>
      command(r, "facilitatorOperation", async (ctx) => {
        const { m } = await access(ctx, mid(r), "facilitatorOperation"),
          b = body(r, ["sectionId"]);
        version(r, m.version);
        if (
          m.state !== "RUNNING" ||
          !m.sections.some((s: any) => s.id === b.sectionId)
        )
          fail(409, "STATE_CONFLICT");
        await ctx.c.query(
          "UPDATE meeting_occurrences SET current_step=$3,version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, m.id, b.sectionId],
        );
        await core.changed(ctx, r, m.id, "MeetingStepChanged");
        return detail(ctx, m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/facilitator", (r) =>
      command(r, "manage", async (ctx) => {
        const {m} = await access(ctx,mid(r),'manage');
        const b = body(r,['memberId']);
        version(r,m.version);
        if (m.method !== 'HOLACRACY' || !['SCHEDULED','RUNNING'].includes(m.state)) fail(409,'STATE_CONFLICT');
        const member = id(b.memberId);
        const participant = (await ctx.c.query("SELECT 1 FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3 AND access='EDIT'",[ctx.org.id,m.id,member])).rows[0];
        if (!participant) fail(422,'FACILITATOR_MUST_EDIT');
        await memberCheck(ctx,[member],ports);
        await ctx.c.query('UPDATE meeting_occurrences SET facilitator_id=$3,version=version+1 WHERE organization_id=$1 AND id=$2',[ctx.org.id,m.id,member]);
        await core.changed(ctx,r,m.id,'MeetingFacilitatorChanged');
        return detail(ctx,m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/claim-secretary", (r) =>
      command(r, "read", async (ctx) => {
        const { m, supervised } = await access(ctx, mid(r), "read");
        const b = body(r, ["confirmed"]);
        version(r, m.version);
        if (m.method !== "HOLACRACY" || !['SCHEDULED','RUNNING'].includes(m.state)) fail(409, "STATE_CONFLICT");
        if (b.confirmed !== true) fail(400, "SECRETARY_CONFIRMATION_REQUIRED");
        if (ctx.member.member_type === "GUEST" || supervised) fail(403, "ACTION_DENIED");
        if (m.notetaker_id === ctx.member.id) fail(409, "STATE_CONFLICT");
        const current = (await ctx.c.query(
          "SELECT attendance FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3",
          [ctx.org.id, m.id, m.notetaker_id],
        )).rows[0];
        if (current?.attendance === "PRESENT") fail(409, "SECRETARY_PRESENT");
        await ctx.c.query(
          "UPDATE meeting_participants SET attendance='PRESENT' WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3 AND access IN ('READ','EDIT')",
          [ctx.org.id, m.id, ctx.member.id],
        );
        await ctx.c.query(
          "UPDATE meeting_occurrences SET notetaker_id=$3,version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, m.id, ctx.member.id],
        );
        await core.changed(ctx, r, m.id, "MeetingSecretaryAssumed");
        return detail(ctx, m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/notetaker", (r) =>
      command(r, "manage", async (ctx) => {
        const { m } = await access(ctx, mid(r), "manage"),
          b = body(r, ["memberId", "notesOnlyNoter"]);
        version(r, m.version);
        if (m.state === "CANCELLED") fail(409, "STATE_CONFLICT");
        const member = id(b.memberId);
        const p = (
          await ctx.c.query(
            `SELECT * FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3 AND access='EDIT'`,
            [ctx.org.id, m.id, member],
          )
        ).rows[0];
        if (!p) fail(422, "NOTETAKER_MUST_EDIT");
        await memberCheck(ctx, [member], ports);
        await ctx.c.query(
          "UPDATE meeting_occurrences SET notetaker_id=$3,policy=$4,version=version+1 WHERE organization_id=$1 AND id=$2",
          [
            ctx.org.id,
            m.id,
            member,
            {
              ...m.policy,
              notesOnlyNoter: bool(b.notesOnlyNoter ?? m.policy.notesOnlyNoter),
            },
          ],
        );
        await core.changed(ctx, r, m.id, "MeetingNoteTakerChanged");
        return detail(ctx, m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/participants", (r) =>
      command(r, "manage", async (ctx) => {
        const { m } = await access(ctx, mid(r), "manage"),
          b = body(r, ["participants", "scope"]);
        version(r, m.version);
        const ps = participants(b.participants),
          scope = b.scope ?? "THIS";
        if (!["THIS", "FUTURE", "ALL"].includes(scope))
          fail(400, "INVALID_REQUEST");
        await memberCheck(
          ctx,
          ps.map((p) => p.memberId),
          ports,
        );
        const targets =
          scope === "THIS"
            ? [m]
            : (
                await ctx.c.query(
                  `SELECT * FROM meeting_occurrences WHERE organization_id=$1 AND series_id=$2 AND state='SCHEDULED' AND start_at>clock_timestamp() AND ($3='ALL' OR sequence>=$4) ORDER BY sequence`,
                  [ctx.org.id, m.series_id, scope, m.sequence],
                )
              ).rows;
        if (!targets.length) fail(409, "NO_FUTURE_OCCURRENCES");
        let futureSeries: string | undefined;
        if (scope === "FUTURE") {
          const original = (
            await ctx.c.query(
              "SELECT * FROM meeting_series WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, m.series_id],
            )
          ).rows[0];
          futureSeries = uuid();
          const merged = new Map(
            original.participants.map((p: any) => [p.memberId, p]),
          );
          for (const p of ps) merged.set(p.memberId, p);
          await ctx.c.query(
            `INSERT INTO meeting_series(organization_id,id,title,circle_id,local_start,time_zone,duration_minutes,recurrence,template_snapshot,participants,policy,split_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              ctx.org.id,
              futureSeries,
              original.title,
              original.circle_id,
              original.local_start,
              original.time_zone,
              original.duration_minutes,
              original.recurrence,
              original.template_snapshot,
              JSON.stringify([...merged.values()]),
              original.policy,
              original.id,
            ],
          );
        }
        for (const target of targets) {
          await access(ctx, target.id, "manage");
          const previouslyInvited=new Set((await ctx.c.query("SELECT member_id FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND access IN ('READ','EDIT')",[ctx.org.id,target.id])).rows.map(row=>row.member_id));
          for (const p of ps) await insertParticipant(ctx, target.id, p);
          target.newlyInvited=ps.filter(p=>p.access!=="DENY"&&!previouslyInvited.has(p.memberId)).map(p=>p.memberId);
          const managers = await ctx.c.query(
            `SELECT 1 FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND access='EDIT' AND can_manage`,
            [ctx.org.id, target.id],
          );
          if (!managers.rowCount) fail(422, "MANAGER_REQUIRED");
          await ctx.c.query(
            "UPDATE meeting_occurrences SET version=version+1,series_id=COALESCE($3,series_id) WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, target.id, futureSeries ?? null],
          );
        }
        if (scope === "ALL") {
          const s = (
              await ctx.c.query(
                "SELECT participants FROM meeting_series WHERE organization_id=$1 AND id=$2",
                [ctx.org.id, m.series_id],
              )
            ).rows[0],
            merged = new Map(s.participants.map((p: any) => [p.memberId, p]));
          for (const p of ps) merged.set(p.memberId, p);
          await ctx.c.query(
            "UPDATE meeting_series SET participants=$3,version=version+1 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, m.series_id, JSON.stringify([...merged.values()])],
          );
        }
        await core.changed(ctx, r, m.id, "MeetingParticipantChanged");
        // Targets are one command; each newly invited person receives one contextual invitation.
        const newInvitations=new Map<string,ReadonlySet<string>>(targets.map(target=>[target.id,new Set<string>(target.newlyInvited??[])]));
        await publishMeetingScheduled(core,ctx,targets.map(target=>target.id),newInvitations);
        return {
          affected: targets.map((t) => t.id),
          ...(await detail(ctx, m.id)),
        };
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/participants/remove", (r) =>
      command(r, "manage", async (ctx) => {
        const { m } = await access(ctx, mid(r), "manage"),
          b = body(r, ["memberId"]);
        version(r, m.version);
        const member = id(b.memberId),
          deleted = await ctx.c.query(
            "DELETE FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3 RETURNING member_id",
            [ctx.org.id, m.id, member],
          );
        if (!deleted.rowCount) fail(404, "RESOURCE_NOT_FOUND");
        const managers = await ctx.c.query(
          "SELECT 1 FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND access='EDIT' AND can_manage",
          [ctx.org.id, m.id],
        );
        if (!managers.rowCount) fail(422, "MANAGER_REQUIRED");
        await ctx.c.query(
          "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, m.id],
        );
        await core.changed(ctx, r, m.id, "MeetingParticipantRemoved");
        return { removed: member };
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/attendance", (r) =>
      command(r, "edit", async (ctx) => {
        const { m, p } = await access(ctx, mid(r), "edit"),
          b = body(r, ["memberId", "attendance"]);
        version(r, m.version);
        const member = id(b.memberId);
        if (member !== ctx.member.id && !p.can_manage)
          fail(403, "ACTION_DENIED");
        if (!["PRESENT", "ABSENT", "INVITED"].includes(b.attendance))
          fail(400, "INVALID_REQUEST");
        const changed = await ctx.c.query(
          `UPDATE meeting_participants SET attendance=$4 WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3 AND access<>'DENY' RETURNING member_id`,
          [ctx.org.id, m.id, member, b.attendance],
        );
        if (!changed.rowCount) fail(404, "RESOURCE_NOT_FOUND");
        await ctx.c.query(
          "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, m.id],
        );
        await core.changed(ctx, r, m.id, "MeetingAttendanceChanged");
        return detail(ctx, m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/agenda", (r) =>
      command(r, "edit", async (ctx) => {
        const { m, p } = await access(ctx, mid(r), "edit"),
          b = body(r, [
            "title",
            "description",
            "presenterId",
            "durationMinutes",
            "sourceId",
            "includeSubcircles",
          ]);
        version(r, m.version);
        if (!["SCHEDULED", "RUNNING"].includes(m.state))
          fail(409, "STATE_CONFLICT");
        if (m.method === "HOLACRACY" && m.state === "RUNNING" && !p.can_manage && m.facilitator_id !== ctx.member.id)
          fail(403, "AGENDA_FACILITATOR_REQUIRED");
        const presenter = id(b.presenterId ?? ctx.member.id);
        await memberCheck(ctx, [presenter], ports);
        let linkedSource: import('./service.js').LinkedMeetingItem | undefined;
        if (b.sourceId) {
          if (!ports.linkedItems) fail(503, "LINKED_ITEMS_PORT_UNAVAILABLE");
          const sources = await ports.linkedItems!(ctx, {
            circleId: m.circle_id,
            includeSubcircles: bool(b.includeSubcircles ?? false),
          });
          linkedSource = sources.find((s) => s.id === id(b.sourceId));
          if (!linkedSource) fail(404, "RESOURCE_NOT_FOUND");
          if (linkedSource!.kind === 'PROPOSAL' && linkedSource!.circleId !== m.circle_id) fail(422, 'MEETING_CIRCLE_MISMATCH');
          if ((await ctx.c.query('SELECT 1 FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND source_id=$3 AND status NOT IN (\'TRANSFERRED\',\'WITHDRAWN\')',[ctx.org.id,m.id,id(b.sourceId)])).rowCount) fail(409, 'SOURCE_ALREADY_ON_AGENDA');
        }
        const item = await createAgendaIntention(ctx, {
          title: b.title,
          description: b.description,
          expectedDurationMinutes: b.durationMinutes ?? 5,
        }, linkedSource ? {kind:linkedSource.kind,id:linkedSource.id,circleId:m.circle_id} : undefined);
        const aid = await placeAgendaItem(ctx, item, m, presenter, ports);
        await core.changed(ctx, r, aid, "AgendaItemCreated");
        return detail(ctx, m.id);
      }),
    );
    app.post(
      base + "/meetings/:meetingId/agenda/:agendaId/actions/:action",
      (r) =>
        command(r, "edit", async (ctx) => {
          const { m } = await access(ctx, mid(r), "edit"),
            b = body(r, ["targetMeetingId"]),
            params = r.params as any,
            action = params.action;
          const a = (
            await ctx.c.query(
              "SELECT * FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND id=$3",
              [ctx.org.id, m.id, id(params.agendaId)],
            )
          ).rows[0];
          if (!a) fail(404, "RESOURCE_NOT_FOUND");
          version(r, a.version);
          if (a.status !== "OPEN") fail(409, "STATE_CONFLICT");
          if (action === "transfer") {
            const target = await access(ctx, id(b.targetMeetingId), "edit");
            if (target.m.state !== "SCHEDULED" || target.m.id === m.id)
              fail(409, "STATE_CONFLICT");
            const item = (
              await ctx.c.query(
                "SELECT * FROM meeting_agenda_items WHERE organization_id=$1 AND id=$2",
                [ctx.org.id, a.agenda_item_id],
              )
            ).rows[0];
            if (!a.is_active || item.current_placement_id !== a.id)
              fail(409, "STATE_CONFLICT");
            await moveAgendaItem(ctx, item, target.m, undefined, ports);
          } else if (action === "skip" || action === "complete") {
            if (
              m.state !== "RUNNING" ||
              (m.method === "HOLACRACY" &&
                m.sections.find((s: any) => s.id === m.current_step)?.kind !==
                  "AGENDA")
            )
              fail(409, "STATE_CONFLICT");
            await ctx.c.query(
              "UPDATE meeting_agenda SET status=$3,skipped=$4,version=version+1 WHERE organization_id=$1 AND id=$2",
              [
                ctx.org.id,
                a.id,
                action === "complete" ? "COMPLETED" : "OPEN",
                action === "skip",
              ],
            );
            if (action === "complete") { await assertO2Completion(ctx,m.id,a.id); await completeAgendaItem(ctx, a.id); }
          } else fail(400, "INVALID_REQUEST");
          await core.changed(
            ctx,
            r,
            a.id,
            action === "transfer"
              ? "AgendaItemPostponed"
              : action === "skip"
                ? "AgendaItemSkipped"
                : "AgendaItemCompleted",
          );
          return detail(ctx, m.id);
        }),
    );
    app.post(
      base + "/meetings/:meetingId/work-items/:actionId/actions/complete",
      (r) =>
        command(r, "edit", async (ctx) => {
          const { m, p } = await access(ctx, mid(r), "edit");
          body(r, []);
          const aid = id((r.params as any).actionId),
            a = (
              await ctx.c.query(
                "SELECT * FROM meeting_actions WHERE organization_id=$1 AND meeting_id=$2 AND id=$3",
                [ctx.org.id, m.id, aid],
              )
            ).rows[0];
          if (!a) fail(404, "RESOURCE_NOT_FOUND");
          if (a.target_kind) fail(409, "MEETING_OUTPUT_MANAGED_EXTERNALLY");
          if (a.assignee_id !== ctx.member.id && !p.can_manage)
            fail(403, "ACTION_DENIED");
          version(r, a.version);
          if (a.state !== "OPEN") fail(409, "STATE_CONFLICT");
          await ctx.c.query(
            `UPDATE meeting_actions SET state='DONE',version=version+1 WHERE organization_id=$1 AND id=$2`,
            [ctx.org.id, aid],
          );
          await core.changed(ctx, r, aid, "MeetingActionCompleted");
          return detail(ctx, m.id);
        }),
    );
    app.get(base+'/meetings/:meetingId/outcomes',r=>read(r,async ctx=>{
      await access(ctx,mid(r));if(isMeetingGuest(ctx))fail(404,'RESOURCE_NOT_FOUND');
      if(!ports.outcomes)fail(503,'MEETING_OUTCOMES_UNAVAILABLE');
      const rows=(await ctx.c.query('SELECT target_kind,target_id FROM meeting_actions WHERE organization_id=$1 AND meeting_id=$2 AND target_kind IS NOT NULL ORDER BY id',[ctx.org.id,mid(r)])).rows;
      const items=[];for(const row of rows){const target=await ports.outcomes!.read(ctx,{kind:row.target_kind,id:row.target_id});if(target)items.push(target);}return {items};
    }));
    app.get(base+'/meetings/:meetingId/outcomes/role-occupants', r => read(r, async ctx => {
      await core.assertResourceAvailable(ctx, 'meeting');
      const { m } = await access(ctx, mid(r), 'edit');
      if (m.state !== 'RUNNING') fail(409, 'STATE_CONFLICT');
      if (!ports.outcomes?.roleOccupants) fail(503, 'MEETING_OUTCOMES_UNAVAILABLE');
      const { kind, roleId, projectId, ...extra } = r.query as Record<string, unknown>;
      if ((kind !== 'TASK' && kind !== 'PROJECT') || (projectId !== undefined && kind !== 'TASK') || Object.keys(extra).length) fail(400, 'INVALID_REQUEST');
      return ports.outcomes!.roleOccupants!(ctx, {
        kind:kind as 'TASK'|'PROJECT', roleId:id(roleId).toLowerCase(), ...(projectId !== undefined ? {projectId:id(projectId)} : {}),
      });
    }));
    app.post(base+'/meetings/:meetingId/outcomes',r=>core.tenant(r,{
      mode:'write',
      authorize:async ctx=>{await core.assertResourceAvailable(ctx,'meeting');const {m}=await authorizeO2Contribution(ctx,mid(r),r,ports);if(m.state!=='RUNNING')fail(409,'STATE_CONFLICT');if(!ports.outcomes)fail(503,'MEETING_OUTCOMES_UNAVAILABLE');const input=parseMeetingOutcome(r,m);if(input.agendaId&&!(await ctx.c.query('SELECT 1 FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND id=$3',[ctx.org.id,m.id,input.agendaId])).rowCount)fail(404,'RESOURCE_NOT_FOUND');await ports.outcomes!.authorize(ctx,input);return true;},
      beforeReplay:async ctx=>{const {m}=await authorizeO2Contribution(ctx,mid(r),r,ports);const input=parseMeetingOutcome(r,m);await ports.outcomes!.authorize(ctx,input);const row=(await ctx.c.query('SELECT target_kind,target_id FROM meeting_actions WHERE organization_id=$1 AND meeting_id=$2 AND output_created_by=$3 AND output_command_key=$4',[ctx.org.id,m.id,ctx.member.id,key(r)])).rows[0];if(!row||!await ports.outcomes!.read(ctx,{kind:row.target_kind,id:row.target_id}))fail(404,'RESOURCE_NOT_FOUND');},
    },async ctx=>{
      const {m}=await authorizeO2Contribution(ctx,mid(r),r,ports);const input=parseMeetingOutcome(r,m);version(r,m.version);if(m.state!=='RUNNING')fail(409,'STATE_CONFLICT');
      if(input.agendaId&&!(await ctx.c.query('SELECT 1 FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND id=$3',[ctx.org.id,m.id,input.agendaId])).rowCount)fail(404,'RESOURCE_NOT_FOUND');
      const target=await ports.outcomes!.create(ctx,input);if(!['TASK','PROJECT','GOAL','PROPOSAL'].includes(target.kind)||target.kind!==(input.kind==='POLICY'?'PROPOSAL':input.kind))fail(500,'INVALID_MEETING_OUTCOME');id(target.id);text(target.title);
      const aid=uuid();await ctx.c.query('INSERT INTO meeting_actions(organization_id,id,meeting_id,agenda_id,title,assignee_id,target_kind,target_id,output_created_by,output_command_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[ctx.org.id,aid,m.id,input.agendaId,input.title,ctx.member.id,target.kind,target.id,ctx.member.id,key(r)]);
      await ctx.c.query('UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2',[ctx.org.id,m.id]);await core.changed(ctx,r,aid,'MeetingOutcomeCreated');return {actionId:aid,target};
    }));
    app.post(base + "/meetings/:meetingId/actions/work-item", (r) =>
      command(r, "edit", async (ctx) => {
        const { m } = await access(ctx, mid(r), "edit"),
          b = body(r, ["title", "assigneeId", "agendaId"]);
        version(r, m.version);
        if (m.state !== "RUNNING") fail(409, "STATE_CONFLICT");
        const assignee = id(b.assigneeId ?? ctx.member.id);
        await memberCheck(ctx, [assignee], ports);
        if (b.agendaId) {
          const a = (
            await ctx.c.query(
              "SELECT 1 FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND id=$3",
              [ctx.org.id, m.id, id(b.agendaId)],
            )
          ).rowCount;
          if (!a) fail(404, "RESOURCE_NOT_FOUND");
        }
        const aid = uuid();
        await ctx.c.query(
          "INSERT INTO meeting_actions(organization_id,id,meeting_id,agenda_id,title,assignee_id) VALUES($1,$2,$3,$4,$5,$6)",
          [ctx.org.id, aid, m.id, b.agendaId ?? null, text(b.title), assignee],
        );
        await ctx.c.query(
          "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, m.id],
        );
        await core.changed(ctx, r, aid, "MeetingActionRecorded");
        return detail(ctx, m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/actions/close", (r) =>
      command(r, "secretaryOperation", async (ctx) => {
        const { m, report } = await access(ctx, mid(r), "secretaryOperation");
        body(r, []);
        if (m.state === "CLOSED" && report) return detail(ctx, m.id);
        version(r, m.version);
        if (m.state !== "RUNNING") fail(409, "STATE_CONFLICT");
        await ctx.c.query(
          `UPDATE meeting_occurrences SET state='CLOSED',closed_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2`,
          [ctx.org.id, m.id],
        );
        // Shared org lock serializes every durable update; snapshot includes all prior committed ACKs.
        const rp = (
          await ctx.c.query(
            "INSERT INTO meeting_reports(organization_id,id,meeting_id,window_days) VALUES($1,$2,$3,$4) RETURNING *",
            [ctx.org.id, uuid(), m.id, m.policy.windowDays],
          )
        ).rows[0];
        await saveReportVersion(ctx, rp, "Meeting closed");
        await captureFirstMeetingClose(ctx, m.id);
        await releaseMeetingAgenda(ctx, m.id);
        await core.changed(ctx, r, m.id, "MeetingClosed");
        return detail(ctx, m.id);
      }),
    );
    app.get(base + "/meetings/:meetingId/report/versions", (r) =>
      read(r, async (ctx) => {
        const { report } = await access(ctx, mid(r));
        if (!report) fail(404, "RESOURCE_NOT_FOUND");
          const versions=(
            await ctx.c.query(
              "SELECT * FROM meeting_report_versions WHERE organization_id=$1 AND report_id=$2 ORDER BY version DESC",
              [ctx.org.id, report.id],
            )
          ).rows.map(row=>{
            const v=camel(row);
            // Historical snapshots are not authority for the current source ACL.
            if(v.snapshot && Array.isArray(v.snapshot.agenda)) v.snapshot={...v.snapshot,agenda:v.snapshot.agenda.map((a:any)=>({...a,sourceId:null}))};
            return v;
          });
          for(const v of versions){if(!Array.isArray(v.snapshot?.actions))continue;const allowed=[];for(const action of v.snapshot.actions){delete action.outputCommandKey;delete action.outputCreatedBy;if(action.targetKind&&action.targetId&&(isMeetingGuest(ctx)||!await ports.outcomes?.read(ctx,{kind:action.targetKind,id:action.targetId})))continue;allowed.push(action);}v.snapshot.actions=allowed;}
          return {items:versions};
      }),
    );
    app.post(base + "/meetings/:meetingId/report/actions/publish", (r) =>
      command(r, "publish", async (ctx) => {
        const { m, report } = await access(ctx, mid(r), "publish");
        body(r, []);
        if (!report) fail(409, "STATE_CONFLICT");
        version(r, report.version);
        if (!windowOpen(report)) fail(403, "EDIT_WINDOW_CLOSED");
        const rp = (
          await ctx.c.query(
            `UPDATE meeting_reports SET state='PUBLISHED',first_published_at=COALESCE(first_published_at,clock_timestamp()),version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *`,
            [ctx.org.id, report.id],
          )
        ).rows[0];
        await saveReportVersion(ctx, rp, "Published", "PUBLISHED");
        await core.changed(ctx, r, report.id, "ReportPublished");
        if(report.state!=="PUBLISHED")await publishReportPublished(core,ctx,m,rp);
        return detail(ctx, m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/report/actions/restore", (r) =>
      command(r, "restore", async (ctx) => {
        const { m, report } = await access(ctx, mid(r), "restore"),
          b = body(r, ["restoreVersion", "reason"]);
        if (!report) fail(409, "STATE_CONFLICT");
        version(r, report.version);
        const reason = text(b.reason, 1000),
          rv = integer(b.restoreVersion, 1, report.version);
        const old = (
          await ctx.c.query(
            "SELECT * FROM meeting_report_versions WHERE organization_id=$1 AND report_id=$2 AND version=$3",
            [ctx.org.id, report.id, rv],
          )
        ).rows[0];
        if (!old) fail(404, "RESOURCE_NOT_FOUND");
        const currentDocs = (
          await ctx.c.query(
            "SELECT * FROM meeting_documents WHERE organization_id=$1 AND meeting_id=$2 ORDER BY section_id FOR UPDATE",
            [ctx.org.id, m.id],
          )
        ).rows;
        if (
          !Array.isArray(old.snapshot.documents) ||
          old.snapshot.documents.length !== currentDocs.length ||
          currentDocs.some(
            (d) =>
              !old.snapshot.documents.some(
                (e: any) => e.sectionId === d.section_id,
              ),
          )
        )
          fail(409, "INVALID_REPORT_VERSION");
        const restored = currentDocs.map((d) => ({
          before: d,
          after: restoreSnapshot(
            d,
            old.snapshot.documents.find(
              (e: any) => e.sectionId === d.section_id,
            ),
          ),
        }));
        for (const { before, after } of restored) {
          await archiveEpoch(ctx, before, reason);
          await ctx.c.query(
            "UPDATE meeting_documents SET epoch=epoch+1,sequence=0,snapshot=$4,protocol=$5,schema_version=1 WHERE organization_id=$1 AND meeting_id=$2 AND section_id=$3",
            [
              ctx.org.id,
              m.id,
              before.section_id,
              after.snapshot,
              after.protocol,
            ],
          );
        }
        const rp = (
          await ctx.c.query(
            "UPDATE meeting_reports SET epoch=epoch+1,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
            [ctx.org.id, report.id],
          )
        ).rows[0];
        await saveReportVersion(ctx, rp, reason);
        await core.changed(ctx, r, report.id, "ReportRestored");
        return detail(ctx, m.id);
      }),
    );
    app.post(base + "/meetings/:meetingId/report/actions/reopen", (r) =>
      command(r, "restore", async (ctx) => {
        const { m, report } = await access(ctx, mid(r), "restore"),
          b = body(r, ["reason"]);
        if (!report) fail(409, "STATE_CONFLICT");
        version(r, report.version);
        const reason = text(b.reason, 1000);
        const currentDocs = (
          await ctx.c.query(
            "SELECT * FROM meeting_documents WHERE organization_id=$1 AND meeting_id=$2 ORDER BY section_id FOR UPDATE",
            [ctx.org.id, m.id],
          )
        ).rows;
        for (const d of currentDocs) await archiveEpoch(ctx, d, reason);
        // Explicit reopening grants a new unlimited edit interval; historical first publication is immutable.
        const rp = (
          await ctx.c.query(
            "UPDATE meeting_reports SET epoch=epoch+1,version=version+1,window_days=0 WHERE organization_id=$1 AND id=$2 RETURNING *",
            [ctx.org.id, report.id],
          )
        ).rows[0];
        await ctx.c.query(
          "UPDATE meeting_documents SET epoch=epoch+1,sequence=0 WHERE organization_id=$1 AND meeting_id=$2",
          [ctx.org.id, m.id],
        );
        await saveReportVersion(ctx, rp, reason);
        await core.changed(ctx, r, report.id, "ReportReopened");
        return detail(ctx, m.id);
      }),
    );
    await registerAgendaItems(app, core, ports);
    await registerMeetingStatistics(app, core, ports.readPolicy);
    await registerMeetingExports(app, core, {
      ...ports.exports,
      readPolicy: ports.readPolicy,
      assertAvailable: async (ctx) => {
        await core.assertResourceAvailable(ctx, "meeting");
        await core.assertResourceAvailable(ctx, "report");
      },
    });
    await registerDocumentMigration(app, core, ports.readPolicy);
    await registerScheduling(app, core, ports.readPolicy);
    await registerCollaboration(app, core, ports.readPolicy);
  };
}
export const registerMeetings = createMeetings();

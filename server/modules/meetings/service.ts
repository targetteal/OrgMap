import { snapshotO2 } from "./o2-panel.js";
import { readAgendaSource } from "./agenda-source.js";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { fail, id, camel, uuid } from "../../src/core.js";
import {
  isMeetingGuest,
  guestMeetingRow,
  guestAgendaRow,
  guestActionRow,
  guestDocuments,
  type MeetingGuestPort,
} from "./guest.js";
import { windowOpen } from "./domain.js";
import { documentWire, initialDocument, LEGACY_PROTOCOL } from "./documents.js";
export type LinkedMeetingItem = {
  id: string;
  kind: "PROJECT" | "TASK" | "GOAL" | "PROPOSAL";
  title: string;
  circleId: string;
  url?: string;
};
export type MeetingPorts = {
  canContributeAgenda?: (ctx: Ctx, circleId: string) => Promise<boolean>;
  outcomes?: import('./outcomes.js').MeetingOutcomePort;
  exports?: Omit<
    import("./exports.js").MeetingExportPorts,
    "readPolicy" | "assertAvailable"
  >;
  readPolicy?: MeetingReadPolicy;
  validateMembers: (ctx: Ctx, ids: string[]) => Promise<boolean>;
  resolveRoster?: (
    ctx: Ctx,
    input: { circleId: string; includeSubcircles: boolean; roleIds: string[] },
  ) => Promise<
    {
      memberId: string;
      origin: "CIRCLE" | "ROLE" | "UMBRELLA";
      participationRole: "REQUIRED" | "OPTIONAL";
      access: "READ" | "EDIT";
    }[]
  >;
  linkedItems?: (
    ctx: Ctx,
    input: { circleId: string; includeSubcircles: boolean },
  ) => Promise<LinkedMeetingItem[]>;
};
export type MeetingReadPolicy = {
  o2Member?: (ctx: Ctx, circleId: string) => Promise<boolean | null>;
  outcomes?: import('./outcomes.js').MeetingOutcomePort;
  trace?: import('../../src/traceability.js').TraceabilityPort;
  guestAccess?: MeetingGuestPort;
  oversight?: (
    ctx: Ctx,
    action: "readMeeting" | "privateOperationalExport",
  ) => Promise<boolean>;
};
export type MeetingExportIntent = { includePrivate?: boolean };
export async function supervisionRead(ctx: Ctx, policy?: MeetingReadPolicy) {
  return (
    ctx.member.org_role === "OWNER" &&
    (await policy?.oversight?.(ctx, "readMeeting")) === true
  );
}
export async function supervisionExport(ctx: Ctx, policy?: MeetingReadPolicy) {
  return (
    ctx.member.org_role === "OWNER" &&
    (await policy?.oversight?.(ctx, "privateOperationalExport")) === true
  );
}
type AccessPurpose = "read" | "private-export";
export const selfOnlyPorts: MeetingPorts = {
  validateMembers: async (ctx, ids) => ids.every((id) => id === ctx.member.id),
};
export async function memberCheck(
  ctx: Ctx,
  ids: string[],
  ports: MeetingPorts,
) {
  if (!(await ports.validateMembers(ctx, ids)))
    fail(422, "INVALID_PARTICIPANT");
}
export async function load(
  ctx: Ctx,
  meetingId: string,
  policy?: MeetingReadPolicy,
  purpose: AccessPurpose = "read",
) {
  const m = (
    await ctx.c.query(
      "SELECT * FROM meeting_occurrences WHERE organization_id=$1 AND id=$2",
      [ctx.org.id, id(meetingId)],
    )
  ).rows[0];
  if (!m) fail(404, "RESOURCE_NOT_FOUND");
  let p = (
    await ctx.c.query(
      "SELECT * FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3",
      [ctx.org.id, m.id, ctx.member.id],
    )
  ).rows[0];
  if (p?.access === "DENY") fail(404, "RESOURCE_NOT_FOUND");
  const guest = isMeetingGuest(ctx);
  if (guest) {
    if (!policy?.guestAccess || purpose !== "read")
      fail(404, "RESOURCE_NOT_FOUND");
    await policy!.guestAccess!.assertResourceAvailable(ctx, "meeting");
    await policy!.guestAccess!.requireGuestResource(
      ctx,
      { context: "meetings", kind: "meeting", id: m.id },
      "read",
    );
    p = {
      organization_id: ctx.org.id,
      meeting_id: m.id,
      member_id: ctx.member.id,
      access: "READ",
      can_manage: false,
      can_publish: false,
      can_restore: false,
    };
  }
  const modeledMember = guest ? null : await policy?.o2Member?.(ctx,m.circle_id);
  if (!guest && !p && modeledMember === true) p = {
    organization_id:ctx.org.id,meeting_id:m.id,member_id:ctx.member.id,
    access:'READ',can_manage:false,can_publish:false,can_restore:false,attendance:'INVITED',
  };
  const supervised = !guest && !p && (await (purpose === 'private-export' ? supervisionExport(ctx,policy) : supervisionRead(ctx,policy)));
  if (!p && !supervised) fail(404, "RESOURCE_NOT_FOUND");
  if (supervised)
    p = {
      organization_id: ctx.org.id,
      meeting_id: m.id,
      member_id: ctx.member.id,
      access: "READ",
      can_manage: false,
      can_publish: false,
      can_restore: false,
    };
  const report = (
    await ctx.c.query(
      "SELECT * FROM meeting_reports WHERE organization_id=$1 AND meeting_id=$2",
      [ctx.org.id, m.id],
    )
  ).rows[0];
  if (report) {
    const override = (
      await ctx.c.query(
        "SELECT * FROM meeting_report_access WHERE organization_id=$1 AND report_id=$2 AND member_id=$3",
        [ctx.org.id, report.id, ctx.member.id],
      )
    ).rows[0];
    if (override && !override.can_read) fail(404, "RESOURCE_NOT_FOUND");
    report.effective_can_edit =
      p.access === "EDIT" && override?.can_edit !== false;
  }
  return { m, p, report, supervised, o2Member:modeledMember };
}
export async function access(
  ctx: Ctx,
  mid: string,
  action = "read",
  policy?: MeetingReadPolicy,
  purpose: AccessPurpose = "read",
) {
  if (purpose === "private-export" && action !== "read")
    fail(403, "ACTION_DENIED");
  if (isMeetingGuest(ctx) && action !== "read") fail(403, "ACTION_DENIED");
  const x = await load(ctx, mid, policy, purpose),
    { m, p, report } = x;
  const edit = p.access === "EDIT",
    manage = edit && p.can_manage,
    actingSecretary = !isMeetingGuest(ctx) && !x.supervised && p.access !== 'DENY' &&
      m.state === 'RUNNING' && m.notetaker_id === ctx.member.id;
  if (
    (action === 'secretaryOperation'  && !(manage || (!isMeetingGuest(ctx) && !x.supervised && p.access !== 'DENY' && m.notetaker_id === ctx.member.id))) ||
    (action === 'facilitatorOperation' && !(manage || (!isMeetingGuest(ctx) && !x.supervised && edit && m.facilitator_id === ctx.member.id))) ||
    (action === "manage" && !manage) ||
    (action === "publish" &&
      !(edit && p.can_publish && report?.effective_can_edit !== false)) ||
    (action === "restore" &&
      !(edit && p.can_restore && report?.effective_can_edit !== false)) ||
    (action === "edit" && !edit)
  )
    fail(403, "ACTION_DENIED");
  if (action === "notes") {
    if (
      (!edit && !actingSecretary) ||
      report?.effective_can_edit === false ||
      (m.policy.notesOnlyNoter && m.notetaker_id !== ctx.member.id)
    )
      fail(403, "ACTION_DENIED");
    if (
      m.state === "SCHEDULED" ||
      m.state === "CANCELLED" ||
      (m.state === "CLOSED" && !report)
    )
      fail(409, "STATE_CONFLICT");
    if (report && !windowOpen(report)) fail(403, "EDIT_WINDOW_CLOSED");
  }
  return x;
}
export async function authorizeMeetingScope(
  ctx: Ctx,
  mid: string,
  scope: unknown,
  policy?: MeetingReadPolicy,
) {
  const { m } = await access(ctx, mid, "manage", policy);
  if (scope === undefined || scope === "THIS") return;
  if (scope !== "FUTURE" && scope !== "ALL") fail(400, "INVALID_REQUEST");
  const rows = (
    await ctx.c.query(
      "SELECT id FROM meeting_occurrences WHERE organization_id=$1 AND series_id=$2 AND state='SCHEDULED' AND start_at>clock_timestamp() AND ($3='ALL' OR sequence>=$4)",
      [ctx.org.id, m.series_id, scope, m.sequence],
    )
  ).rows;
  for (const row of rows) await access(ctx, row.id, "manage", policy);
}
export async function detail(
  ctx: Ctx,
  mid: string,
  policy?: MeetingReadPolicy,
  purpose: AccessPurpose = "read",
) {
  const { m, p, report, supervised, o2Member } = await load(ctx, mid, policy, purpose);
  const query = async (t: string) =>
    (
      await ctx.c.query(
        `SELECT * FROM ${t} WHERE organization_id=$1 AND meeting_id=$2 ${t==="meeting_agenda"?"ORDER BY (SELECT created_at FROM meeting_agenda_items i WHERE i.organization_id=meeting_agenda.organization_id AND i.id=meeting_agenda.agenda_item_id),id":""}`,
        [ctx.org.id, mid],
      )
    ).rows.map(camel);
  const docs = (
    await ctx.c.query(
      "SELECT * FROM meeting_documents WHERE organization_id=$1 AND meeting_id=$2 ORDER BY section_id",
      [ctx.org.id, mid],
    )
  ).rows.map((d) => documentWire(d));
  if (isMeetingGuest(ctx))
    return {
      accessMode: "GUEST_READ",
      meeting: camel(guestMeetingRow(m)),
      participants: [],
      agenda: (await query("meeting_agenda")).map(guestAgendaRow),
      actions: (await query("meeting_actions")).filter(a=>!a.targetKind).map(guestActionRow),
      report: null,
      documents: m.state === "CLOSED" ? [] : guestDocuments(docs),
      capabilities: {
        manage: false,
        publish: false,
        restore: false,
        edit: false,
        notes: false,
      },
    };
  const manage = p.access === "EDIT" && p.can_manage;
  const agenda=await query('meeting_agenda');
  for(const entry of agenda){
    if(!entry.sourceId)continue;
    const source=(await ctx.c.query('SELECT source_kind FROM meeting_agenda_items WHERE organization_id=$1 AND id=$2',[ctx.org.id,entry.agendaItemId])).rows[0];
    const readable = await readAgendaSource(ctx, source?.source_kind, entry.sourceId, policy?.trace);
    if(!readable)entry.sourceId=null;
    else entry.sourceKind=readable.kind;
  }
  const actions=[];
  for(const action of await query('meeting_actions')){
    delete action.outputCommandKey;delete action.outputCreatedBy;
    if(action.targetKind&&action.targetId){
      const target=await policy?.outcomes?.read(ctx,{kind:action.targetKind,id:action.targetId});
      if(!target)continue;
      action.targetKind=target.kind;action.targetId=target.id;
      if(target.proposal)action.targetProposal=target.proposal;
    }
    actions.push(action);
  }
  return {
    accessMode: supervised
      ? purpose === "private-export"
        ? "PRIVATE_EXPORT"
        : "SUPERVISED_READ"
      : "PARTICIPANT",
    o2: (await policy?.o2Member?.(ctx,m.circle_id)) !== null && !!policy?.o2Member && (await policy.o2Member(ctx,m.circle_id)) !== undefined,
    meeting: camel(m),
    participants: await query("meeting_participants"),
    agenda,
    actions,
    report: report ? camel(report) : null,
    documents: docs,
    capabilities: {
      proposeGovernance:o2Member===true&&!supervised&&m.state==='RUNNING'&&p.attendance==='PRESENT',
      manage,
      secretaryOperation: manage || (!isMeetingGuest(ctx) && !supervised && p.access !== 'DENY' && m.notetaker_id === ctx.member.id),
      facilitatorOperation: manage || (p.access === 'EDIT' && !supervised && m.facilitator_id === ctx.member.id),
      publish:
        p.access === "EDIT" &&
        p.can_publish &&
        report?.effective_can_edit !== false,
      restore:
        p.access === "EDIT" &&
        p.can_restore &&
        report?.effective_can_edit !== false,
      edit: p.access === "EDIT",
      notes:
        ["RUNNING", "CLOSED"].includes(m.state) &&
        (p.access === "EDIT" || (!isMeetingGuest(ctx) && m.method === 'HOLACRACY' && m.state === 'RUNNING' && m.notetaker_id === ctx.member.id)) &&
        report?.effective_can_edit !== false &&
        (!m.policy.notesOnlyNoter || m.notetaker_id === ctx.member.id) &&
        windowOpen(report),
    },
  };
}
export async function insertParticipant(ctx: Ctx, mid: string, p: any) {
  await ctx.c.query(
    `INSERT INTO meeting_participants(organization_id,meeting_id,member_id,access,can_manage,can_publish,can_restore,participation_role,origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organization_id,meeting_id,member_id) DO UPDATE SET access=excluded.access,can_manage=excluded.can_manage,can_publish=excluded.can_publish,can_restore=excluded.can_restore,participation_role=excluded.participation_role,origin=excluded.origin`,
    [
      ctx.org.id,
      mid,
      p.memberId,
      p.access,
      p.canManage ?? false,
      p.canPublish ?? false,
      p.canRestore ?? false,
      p.participationRole ?? "REQUIRED",
      p.origin ?? "DIRECT",
    ],
  );
}
export async function insertOccurrence(ctx: Ctx, series: any, o: any) {
  const mid = uuid(),
    s = series.template_snapshot;
  await ctx.c.query(
    `INSERT INTO meeting_occurrences(organization_id,id,series_id,sequence,start_at,local_start,time_zone,duration_minutes,title,circle_id,sections,method,policy,notetaker_id,facilitator_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
    [
      ctx.org.id,
      mid,
      series.id,
      o.sequence,
      o.startAt,
      o.localStart,
      series.time_zone,
      series.duration_minutes,
      series.title,
      series.circle_id,
      JSON.stringify(s.sections),
      s.method,
      series.policy,
      ctx.member.id,
    ],
  );
  for (const p of series.participants) await insertParticipant(ctx, mid, p);
  if(s.reviewItems?.length)await ctx.c.query('INSERT INTO meeting_o2_reviews(organization_id,meeting_id,items) VALUES($1,$2,$3)',[ctx.org.id,mid,JSON.stringify(s.reviewItems)]);
  for (const section of s.sections) {
    const format = s.notesProtocol ?? LEGACY_PROTOCOL;
    await ctx.c.query(
      "INSERT INTO meeting_documents(organization_id,meeting_id,section_id,snapshot,protocol,schema_version) VALUES($1,$2,$3,$4,$5,1)",
      [ctx.org.id, mid, section.id, initialDocument(format), format],
    );
  }
  return mid;
}
export async function snapshot(ctx: Ctx, mid: string) {
  const docs = (
    await ctx.c.query(
      "SELECT * FROM meeting_documents WHERE organization_id=$1 AND meeting_id=$2 ORDER BY section_id FOR UPDATE",
      [ctx.org.id, mid],
    )
  ).rows;
  const m = (
    await ctx.c.query(
      "SELECT * FROM meeting_occurrences WHERE organization_id=$1 AND id=$2",
      [ctx.org.id, mid],
    )
  ).rows[0];
  const participants = (
    await ctx.c.query(
      "SELECT member_id,access,attendance,participation_role,origin FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2",
      [ctx.org.id, mid],
    )
  ).rows;
  const agenda = (
    await ctx.c.query(
      "SELECT * FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2",
      [ctx.org.id, mid],
    )
  ).rows;
  const actions = (
    await ctx.c.query(
      "SELECT * FROM meeting_actions WHERE organization_id=$1 AND meeting_id=$2",
      [ctx.org.id, mid],
    )
  ).rows;
  return {
    o2: await snapshotO2(ctx,mid),
    meeting: camel(m),
    participants: participants.map(camel),
    agenda: agenda.map(camel),
    actions: actions.map(camel),
    documents: docs.map((d) => documentWire(d, true)),
  };
}
export async function saveReportVersion(ctx: Ctx, report: any, reason: string, publicationStatus: "PUBLISHED" | "NOT_PUBLISHED" = "NOT_PUBLISHED") {
  const s = await snapshot(ctx, report.meeting_id);
  await ctx.c.query(
    "INSERT INTO meeting_report_versions(organization_id,report_id,version,epoch,snapshot,actor_id,reason,publication_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      ctx.org.id,
      report.id,
      report.version,
      report.epoch,
      JSON.stringify(s),
      ctx.member.id,
      reason,
      publicationStatus,
    ],
  );
  return s;
}

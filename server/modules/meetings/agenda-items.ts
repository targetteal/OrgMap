import {readAgendaSource} from "./agenda-source.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import {
  body,
  id,
  text,
  uuid,
  version,
  camel,
  fail,
  Failure,
} from "../../src/core.js";
import {
  fromPlainText,
  toPlainText,
  validateRichDocument,
} from "@orgmap/content";
import {
  access,
  memberCheck,
  supervisionRead,
  type MeetingPorts,
} from "./service.js";
import { isMeetingGuest } from "./guest.js";
import { cursor, pageInput } from "./pagination.js";
import { integer } from "./domain.js";
import type { ResourceAccessPort } from "../platform/ports.js";

const base = "/api/v1/organizations/:organizationId/meeting-agenda-items";
const states = [
  "PARKED",
  "ASSIGNED",
  "NEEDS_RESCHEDULE",
  "COMPLETED",
  "ARCHIVED",
];
type Command =
  "REVISE" | "SCHEDULE" | "RESCHEDULE" | "UNSCHEDULE" | "ARCHIVE" | "ADOPT";
export async function agendaActor(ctx: Ctx) {
  if (isMeetingGuest(ctx)) fail(404, "RESOURCE_NOT_FOUND");
  const active = await ctx.c.query(
    "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND account_id=$3 AND status='ACTIVE' AND member_type='MEMBER'",
    [ctx.org.id, ctx.member.id, ctx.account.id],
  );
  if (!active.rowCount) fail(403, "ACTION_DENIED");
}
async function agendaMeetingAuthority(
  ctx: Ctx,
  mid: string,
  ports: MeetingPorts,
) {
  const result = await access(ctx, id(mid), "edit", ports.readPolicy);
  if (
    result.m.method === "HOLACRACY" &&
    result.m.state === "RUNNING" &&
    !result.p.can_manage && result.m.facilitator_id !== ctx.member.id
  )
    fail(403, "AGENDA_FACILITATOR_REQUIRED");
  return result;
}
export async function agendaTarget(ctx: Ctx, mid: string, ports: MeetingPorts) {
  const result = await agendaMeetingAuthority(ctx, mid, ports);
  if (!["SCHEDULED", "RUNNING"].includes(result.m.state))
    fail(409, "STATE_CONFLICT");
  if (
    result.m.method === "HOLACRACY" &&
    result.m.state === "RUNNING" &&
    !result.p.can_manage && result.m.facilitator_id !== ctx.member.id
  )
    fail(403, "AGENDA_FACILITATOR_REQUIRED");
  return result;
}
async function itemRow(ctx: Ctx, itemId: string) {
  const row = (
    await ctx.c.query(
      "SELECT * FROM meeting_agenda_items WHERE organization_id=$1 AND id=$2",
      [ctx.org.id, id(itemId)],
    )
  ).rows[0];
  if (!row) fail(404, "RESOURCE_NOT_FOUND");
  return row;
}
async function placementRow(ctx: Ctx, item: any) {
  const pid = item.current_placement_id ?? item.last_placement_id;
  return pid
    ? (
        await ctx.c.query(
          "SELECT * FROM meeting_agenda WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, pid],
        )
      ).rows[0]
    : null;
}
async function activeOwner(ctx: Ctx, item: any) {
  return (
    !!item.owner_id &&
    !!(
      await ctx.c.query(
        "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type='MEMBER'",
        [ctx.org.id, item.owner_id],
      )
    ).rowCount
  );
}
export async function authorizeAgendaItem(
  ctx: Ctx,
  itemId: string,
  command: Command | "READ",
  ports: MeetingPorts,
  targetId?: string,
  execution = true,
) {
  await agendaActor(ctx);
  const item = await itemRow(ctx, itemId),
    placement = await placementRow(ctx, item);
  if (command === "ADOPT") {
    if (!placement) fail(404, "RESOURCE_NOT_FOUND");
    await access(ctx, placement.meeting_id, "manage", ports.readPolicy);
    if (execution && (await activeOwner(ctx, item)))
      fail(409, "AGENDA_OWNER_ALREADY_KNOWN");
    return item;
  }
  if (item.state === "ASSIGNED") {
    if (!placement || !item.current_placement_id) fail(409, "STATE_CONFLICT");
    if (command === "READ")
      await access(ctx, placement.meeting_id, "read", ports.readPolicy);
    else if (execution) await agendaTarget(ctx, placement.meeting_id, ports);
    else await agendaMeetingAuthority(ctx, placement.meeting_id, ports);
  } else if (["PARKED", "NEEDS_RESCHEDULE"].includes(item.state)) {
    if (
      !execution &&
      command === "UNSCHEDULE" &&
      item.owner_id !== ctx.member.id &&
      placement
    ) {
      await agendaMeetingAuthority(ctx, placement.meeting_id, ports);
    } else if (item.owner_id !== ctx.member.id) {
      // Unadopted legacy records stay behind their meeting ACL; they never become public parking.
      if (command !== "READ" || item.owner_id || !placement)
        fail(404, "RESOURCE_NOT_FOUND");
      await access(ctx, placement.meeting_id, "read", ports.readPolicy);
    }
  } else if (
    item.state === "ARCHIVED" &&
    item.owner_id === ctx.member.id &&
    command === "READ"
  ) {
    // The owner can still inspect an archived personal intention.
  } else if (!execution && command !== "READ") {
    if (!(item.state === "ARCHIVED" && item.owner_id === ctx.member.id)) {
      if (!placement) fail(404, "RESOURCE_NOT_FOUND");
      await agendaMeetingAuthority(ctx, placement.meeting_id, ports);
    }
  } else {
    if (command !== "READ" || !placement) fail(409, "STATE_CONFLICT");
    await access(ctx, placement.meeting_id, "read", ports.readPolicy);
  }
  if (execution) {
    if (
      command === "SCHEDULE" &&
      !["PARKED", "NEEDS_RESCHEDULE"].includes(item.state)
    )
      fail(409, "STATE_CONFLICT");
    if (
      ["RESCHEDULE", "UNSCHEDULE"].includes(command) &&
      item.state !== "ASSIGNED"
    )
      fail(409, "STATE_CONFLICT");
    if (
      command === "ARCHIVE" &&
      !["PARKED", "NEEDS_RESCHEDULE"].includes(item.state)
    )
      fail(409, "STATE_CONFLICT");
    if (command === "UNSCHEDULE" && !(await activeOwner(ctx, item)))
      fail(409, "AGENDA_ADOPTION_REQUIRED");
  }
  if (["SCHEDULE", "RESCHEDULE"].includes(command)) {
    const { m } = execution
      ? await agendaTarget(ctx, id(targetId), ports)
      : await agendaMeetingAuthority(ctx, id(targetId), ports);
    if (item.circle_id && item.circle_id !== m.circle_id)
      fail(422, "MEETING_CIRCLE_MISMATCH");
    if (
      execution &&
      placement?.meeting_id === m.id &&
      item.state === "ASSIGNED"
    )
      fail(409, "STATE_CONFLICT");
  }
  return item;
}
const unavailable = (e: unknown) =>
  e instanceof Failure && [403, 404, 409, 422].includes(e.status);
export async function agendaItemResult(
  ctx: Ctx,
  itemId: string,
  ports: MeetingPorts,
) {
  const item = await authorizeAgendaItem(ctx, itemId, "READ", ports),
    p = await placementRow(ctx, item);
  let placement: any,
    redacted = false;
  if (p) {
    try {
      const { m } = await access(ctx, p.meeting_id, "read", ports.readPolicy);
      placement = {
        id: p.id,
        meetingId: m.id,
        meetingTitle: m.title,
        meetingVersion: m.version,
        presenterId: p.presenter_id,
        status: p.status,
        version: p.version,
      };
    } catch (e) {
      if (!unavailable(e)) throw e;
      redacted = true;
    }
  }
  const capabilities = {
    edit: false,
    schedule: false,
    reschedule: false,
    unschedule: false,
    archive: false,
    adopt: false,
  };
  for (const [key, command] of Object.entries({
    edit: "REVISE",
    unschedule: "UNSCHEDULE",
    archive: "ARCHIVE",
    adopt: "ADOPT",
  }) as [keyof typeof capabilities, Command][]) {
    try {
      await authorizeAgendaItem(ctx, itemId, command, ports);
      capabilities[key] = true;
    } catch (e) {
      if (!unavailable(e)) throw e;
    }
  }
  capabilities.schedule =
    ["PARKED", "NEEDS_RESCHEDULE"].includes(item.state) &&
    item.owner_id === ctx.member.id;
  capabilities.reschedule = item.state === "ASSIGNED" && capabilities.edit;
  // Previous meeting identifiers and provenance never escape a revoked historical ACL.
  const value = camel(item);
  delete value.currentPlacementId;
  delete value.lastPlacementId;
  if (redacted || !await readAgendaSource(ctx,value.sourceKind,value.sourceId,ports.readPolicy?.trace)) {
    delete value.sourceId;
  }
  return {
    item: value,
    ...(placement ? { placement } : {}),
    capabilities,
    coverage: {
      identityCoverage: item.identity_coverage,
      creatorCoverage: item.creator_coverage,
      historyRedacted: redacted,
    },
  };
}
function content(input: any) {
  try {
    if (input.descriptionRich !== undefined && input.description !== undefined)
      fail(400, "INVALID_REQUEST");
    const rich =
      input.descriptionRich === undefined
        ? fromPlainText(input.description ?? "")
        : validateRichDocument(input.descriptionRich);
    const plain = toPlainText(rich);
    if ([...plain].length > 20000) fail(400, "INVALID_REQUEST");
    return { rich, plain };
  } catch (e) {
    if (e instanceof Failure) throw e;
    return fail(400, "INVALID_RICH_DOCUMENT");
  }
}
function title(value: unknown) {
  const v = text(value, 800);
  if ([...v].length > 200) fail(400, "INVALID_REQUEST");
  return v;
}
function duration(value: unknown) {
  return value === undefined || value === null ? null : integer(value, 0, 1440);
}
function expected(value: unknown, actual: number) {
  if (!Number.isSafeInteger(value) || value !== actual)
    fail(409, "VERSION_CONFLICT");
}
export async function createAgendaIntention(
  ctx: Ctx,
  input: any,
  source?: { kind: import("./agenda-source.js").AgendaSourceKind; id: string; circleId: string },
) {
  await agendaActor(ctx);
  const iid = uuid(),
    c = content(input);
  await ctx.c.query(
    `INSERT INTO meeting_agenda_items(organization_id,id,title,description_rich,description,state,creator_id,owner_id,circle_id,expected_duration_minutes,source_kind,source_id,identity_coverage,creator_coverage,created_at)
    VALUES($1,$2,$3,$4,$5,'PARKED',$6,$6,$7,$8,$9,$10,'NATIVE','KNOWN',clock_timestamp())`,
    [
      ctx.org.id,
      iid,
      title(input.title),
      JSON.stringify(c.rich),
      c.plain,
      ctx.member.id,
      source?.circleId ?? null,
      duration(input.expectedDurationMinutes),
      source?.kind ?? "MANUAL",
      source?.id ?? null,
    ],
  );
  return itemRow(ctx, iid);
}
/** The only placement INSERT writer, shared by new commands, old routes and Governance. */
export async function placeAgendaItem(
  ctx: Ctx,
  item: any,
  target: any,
  presenter: string,
  ports: MeetingPorts,
  transferredFrom?: string,
) {
  await memberCheck(ctx, [presenter], ports);
  const active = await ctx.c.query(
    "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type='MEMBER'",
    [ctx.org.id, presenter],
  );
  if (!active.rowCount) fail(422, "INVALID_PARTICIPANT");
  if (item.circle_id && item.circle_id !== target.circle_id)
    fail(422, "MEETING_CIRCLE_MISMATCH");
  const pid = uuid();
  await ctx.c.query(
    "INSERT INTO meeting_agenda(organization_id,id,meeting_id,title,presenter_id,duration_minutes,source_id,transferred_from,agenda_item_id,is_active,description_rich) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)",
    [
      ctx.org.id,
      pid,
      target.id,
      item.title,
      presenter,
      item.expected_duration_minutes,
      item.source_id,
      transferredFrom ?? null,
      item.id,
      JSON.stringify(item.description_rich),
    ],
  );
  await ctx.c.query(
    "UPDATE meeting_agenda_items SET state='ASSIGNED',circle_id=COALESCE(circle_id,$3),current_placement_id=$4,last_placement_id=$4,version=version+1 WHERE organization_id=$1 AND id=$2",
    [ctx.org.id, item.id, target.circle_id, pid],
  );
  await ctx.c.query(
    "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
    [ctx.org.id, target.id],
  );
  return pid;
}
export async function moveAgendaItem(
  ctx: Ctx,
  item: any,
  target: any,
  presenter: string | undefined,
  ports: MeetingPorts,
) {
  const p = await placementRow(ctx, item);
  await ctx.c.query(
    "UPDATE meeting_agenda SET status='TRANSFERRED',is_active=false,version=version+1 WHERE organization_id=$1 AND id=$2",
    [ctx.org.id, p.id],
  );
  await ctx.c.query(
    "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
    [ctx.org.id, p.meeting_id],
  );
  return placeAgendaItem(
    ctx,
    item,
    target,
    presenter ?? p.presenter_id,
    ports,
    p.id,
  );
}
/** Close/cancel preserve the placement and all immutable report snapshots. */
export async function releaseMeetingAgenda(ctx: Ctx, mid: string) {
  await ctx.c.query(
    "UPDATE meeting_agenda_items i SET state='NEEDS_RESCHEDULE',current_placement_id=NULL,version=i.version+1 FROM meeting_agenda a WHERE i.organization_id=$1 AND a.organization_id=i.organization_id AND a.meeting_id=$2 AND a.is_active AND a.status='OPEN' AND i.id=a.agenda_item_id AND i.current_placement_id=a.id",
    [ctx.org.id, mid],
  );
  await ctx.c.query(
    "UPDATE meeting_agenda SET is_active=false WHERE organization_id=$1 AND meeting_id=$2 AND is_active",
    [ctx.org.id, mid],
  );
}
export async function completeAgendaItem(ctx: Ctx, placementId: string) {
  const pending=await ctx.c.query(`SELECT 1 FROM meeting_actions a JOIN gov_proposals p ON p.organization_id=a.organization_id AND p.id=a.target_id WHERE a.organization_id=$1 AND a.agenda_id=$2 AND a.target_kind='PROPOSAL' AND p.verdict='ADOPT' AND p.apply_state<>'APPLIED' LIMIT 1`,[ctx.org.id,placementId]);
  if(pending.rowCount)fail(409,'GOVERNANCE_APPLICATION_PENDING');
  await ctx.c.query(
    "UPDATE meeting_agenda_items i SET state='COMPLETED',current_placement_id=NULL,version=i.version+1 FROM meeting_agenda a WHERE i.organization_id=$1 AND a.organization_id=i.organization_id AND a.id=$2 AND i.id=a.agenda_item_id AND i.current_placement_id=a.id",
    [ctx.org.id, placementId],
  );
  await ctx.c.query(
    "UPDATE meeting_agenda SET is_active=false WHERE organization_id=$1 AND id=$2",
    [ctx.org.id, placementId],
  );
}
export async function registerAgendaItems(
  app: FastifyInstance,
  core: ModuleRuntime,
  ports: MeetingPorts,
) {
  async function perimeter(ctx: Ctx) {
    await core.assertResourceAvailable(ctx, "meeting");
    await agendaActor(ctx);
  }
  app.get(base + "/targets", (r) =>
    core.tenant(r, { mode: "read" }, async (ctx) => {
      await perimeter(ctx);
      const rows = (
        await ctx.c.query(
          "SELECT m.id FROM meeting_occurrences m JOIN meeting_participants p ON p.organization_id=m.organization_id AND p.meeting_id=m.id AND p.member_id=$2 WHERE m.organization_id=$1 AND p.access='EDIT' AND m.state IN ('SCHEDULED','RUNNING') ORDER BY m.start_at,m.id",
          [ctx.org.id, ctx.member.id],
        )
      ).rows;
      const items = [];
      for (const row of rows) {
        try {
          const { m } = await agendaTarget(ctx, row.id, ports);
          items.push({
            id: m.id,
            title: m.title,
            version: m.version,
            circleId: m.circle_id,
            state: m.state,
          });
        } catch (e) {
          if (!unavailable(e)) throw e;
        }
      }
      return { items };
    }),
  );
  app.get(base, (r) =>
    core.tenant(r, { mode: "read" }, async (ctx) => {
      await perimeter(ctx);
      const q = r.query as any;
      if (
        Object.keys(q).some(
          (k) =>
            !["state", "search", "circleId", "limit", "cursor"].includes(k),
        ) ||
        (q.state && !states.includes(q.state)) ||
        (q.search !== undefined &&
          (typeof q.search !== "string" || q.search.length > 200))
      )
        fail(400, "INVALID_REQUEST");
      const circle = q.circleId ? id(q.circleId) : null,
        search = q.search ?? "";
      const scope = JSON.stringify([
        ctx.org.id,
        ctx.member.id,
        q.state ?? null,
        circle,
        search,
      ]);
      const page = pageInput(q, scope);
      // Filter current rights in SQL before ordering/page. Domain checks below are defense in depth.
      const rows = (
        await ctx.c.query(
          `SELECT i.*,to_char(COALESCE(i.created_at,'1970-01-01'::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM meeting_agenda_items i
      LEFT JOIN meeting_agenda a ON a.organization_id=i.organization_id AND a.id=COALESCE(i.current_placement_id,i.last_placement_id)
      LEFT JOIN meeting_participants p ON p.organization_id=i.organization_id AND p.meeting_id=a.meeting_id AND p.member_id=$2
      LEFT JOIN meeting_reports rp ON rp.organization_id=i.organization_id AND rp.meeting_id=a.meeting_id
      LEFT JOIN meeting_report_access ra ON ra.organization_id=i.organization_id AND ra.report_id=rp.id AND ra.member_id=$2
      WHERE i.organization_id=$1 AND ($3::text IS NULL OR i.state=$3) AND ($4::uuid IS NULL OR i.circle_id=$4) AND i.title ILIKE $5
      AND ((i.state IN ('PARKED','NEEDS_RESCHEDULE','ARCHIVED') AND i.owner_id=$2) OR
       ((i.state NOT IN ('PARKED','NEEDS_RESCHEDULE') OR i.owner_id IS NULL) AND
        (p.access IN ('READ','EDIT') OR (p.member_id IS NULL AND $8)) AND COALESCE(ra.can_read,true)))
      AND ($6::timestamptz IS NULL OR (COALESCE(i.created_at,'1970-01-01'::timestamptz),i.id)>($6::timestamptz,$7::uuid))
      ORDER BY COALESCE(i.created_at,'1970-01-01'::timestamptz),i.id LIMIT $9`,
          [
            ctx.org.id,
            ctx.member.id,
            q.state ?? null,
            circle,
            "%" + search.replace(/[\\%_]/g, "\\$&") + "%",
            page.startAt,
            page.id,
            await supervisionRead(ctx, ports.readPolicy),
            page.limit + 1,
          ],
        )
      ).rows;
      const more = rows.length > page.limit,
        visible = rows.slice(0, page.limit),
        items = [];
      for (const row of visible)
        items.push(await agendaItemResult(ctx, row.id, ports));
      const last = visible.at(-1);
      return {
        items,
        page: {
          hasMore: more,
          nextCursor:
            more && last
              ? cursor({ startAt: last.cursor_at, id: last.id }, scope)
              : null,
        },
      };
    }),
  );
  app.get(base + "/:itemId", (r) =>
    core.tenant(r, { mode: "read" }, async (ctx) => {
      await perimeter(ctx);
      return agendaItemResult(ctx, id((r.params as any).itemId), ports);
    }),
  );
  app.post(base, async (r, reply) => {
    const result = await core.tenant(
      r,
      {
        mode: "write",
        authorize: async (ctx) => {
          await perimeter(ctx);
          return true;
        },
        beforeReplay: async (ctx, result: any) => {
          await authorizeAgendaItem(ctx, result.item.id, "READ", ports);
        },
      },
      async (ctx) => {
        const b = body(r, [
            "title",
            "descriptionRich",
            "description",
            "expectedDurationMinutes",
          ]),
          item = await createAgendaIntention(ctx, b);
        await core.changed(ctx, r, item.id, "AgendaIntentionCreated");
        return agendaItemResult(ctx, item.id, ports);
      },
    );
    reply.code(201);
    return result;
  });
  const mutation = (
    r: FastifyRequest,
    command: Command,
    fn: (ctx: Ctx, item: any, b: any) => Promise<void>,
    fields: string[],
  ) =>
    core.tenant(
      r,
      {
        mode: "write",
        authorize: async (ctx) => {
          await perimeter(ctx);
          await authorizeAgendaItem(
            ctx,
            id((r.params as any).itemId),
            command,
            ports,
            (r.body as any)?.targetMeetingId,
            false,
          );
          return true;
        },
        beforeReplay: async (ctx, result: any) => {
          // Cached transitions still require current authority over the original source and destination.
          const pid = result?.placement?.id ?? result?.sourcePlacementId;
          if (!pid) return;
          const p = (
            await ctx.c.query(
              "SELECT meeting_id,transferred_from FROM meeting_agenda WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, pid],
            )
          ).rows[0];
          if (!p) fail(404, "RESOURCE_NOT_FOUND");
          if (["RESCHEDULE", "UNSCHEDULE"].includes(command))
            await agendaMeetingAuthority(ctx, p.meeting_id, ports);
          else await access(ctx, p.meeting_id, "read", ports.readPolicy);
          if (command === "RESCHEDULE" && p.transferred_from) {
            const source = (
              await ctx.c.query(
                "SELECT meeting_id FROM meeting_agenda WHERE organization_id=$1 AND id=$2",
                [ctx.org.id, p.transferred_from],
              )
            ).rows[0];
            if (!source) fail(404, "RESOURCE_NOT_FOUND");
            await agendaMeetingAuthority(ctx, source.meeting_id, ports);
          }
        },
      },
      async (ctx) => {
        const item = await authorizeAgendaItem(
            ctx,
            id((r.params as any).itemId),
            command,
            ports,
            (r.body as any)?.targetMeetingId,
          ),
          b = body(r, fields);
        version(r, item.version);
        await fn(ctx, item, b);
        await core.changed(ctx, r, item.id, "AgendaIntention" + command);
        if (command === "UNSCHEDULE" && item.owner_id !== ctx.member.id)
          return {
            unscheduled: true,
            itemId: item.id,
            sourcePlacementId: item.current_placement_id,
          };
        if (
          command === "ADOPT" &&
          b.ownerMemberId !== ctx.member.id &&
          item.state === "NEEDS_RESCHEDULE"
        )
          return {
            adopted: true,
            itemId: item.id,
            ownerMemberId: b.ownerMemberId,
          };
        return agendaItemResult(ctx, item.id, ports);
      },
    );
  app.patch(base + "/:itemId", (r) =>
    mutation(
      r,
      "REVISE",
      async (ctx, item, b) => {
        if (!Object.keys(b).length) fail(400, "INVALID_REQUEST");
        const c =
          b.descriptionRich !== undefined || b.description !== undefined
            ? content(b)
            : { rich: item.description_rich, plain: item.description };
        const nextTitle = b.title === undefined ? item.title : title(b.title),
          nextDuration =
            b.expectedDurationMinutes === undefined
              ? item.expected_duration_minutes
              : duration(b.expectedDurationMinutes);
        await ctx.c.query(
          "UPDATE meeting_agenda_items SET title=$3,description_rich=$4,description=$5,expected_duration_minutes=$6,version=version+1 WHERE organization_id=$1 AND id=$2",
          [
            ctx.org.id,
            item.id,
            nextTitle,
            JSON.stringify(c.rich),
            c.plain,
            nextDuration,
          ],
        );
        if (item.current_placement_id) {
          await ctx.c.query(
            "UPDATE meeting_agenda SET title=$3,description_rich=$4,duration_minutes=$5,version=version+1 WHERE organization_id=$1 AND id=$2",
            [
              ctx.org.id,
              item.current_placement_id,
              nextTitle,
              JSON.stringify(c.rich),
              nextDuration,
            ],
          );
          const p = await placementRow(ctx, item);
          await ctx.c.query(
            "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, p.meeting_id],
          );
        }
      },
      ["title", "descriptionRich", "description", "expectedDurationMinutes"],
    ),
  );
  for (const action of ["schedule", "reschedule"] as const)
    app.post(base + "/:itemId/actions/" + action, (r) =>
      mutation(
        r,
        action === "schedule" ? "SCHEDULE" : "RESCHEDULE",
        async (ctx, item, b) => {
          const { m } = await agendaTarget(ctx, id(b.targetMeetingId), ports);
          expected(b.expectedTargetVersion, m.version);
          if (action === "reschedule") {
            const p = await placementRow(ctx, item),
              source = await agendaTarget(ctx, p.meeting_id, ports);
            expected(b.expectedSourceVersion, source.m.version);
            await moveAgendaItem(
              ctx,
              item,
              m,
              b.presenterMemberId === undefined
                ? undefined
                : id(b.presenterMemberId),
              ports,
            );
          } else
            await placeAgendaItem(
              ctx,
              item,
              m,
              id(b.presenterMemberId ?? ctx.member.id),
              ports,
              item.last_placement_id ?? undefined,
            );
        },
        [
          "targetMeetingId",
          "expectedTargetVersion",
          "expectedSourceVersion",
          "presenterMemberId",
        ],
      ),
    );
  app.post(base + "/:itemId/actions/unschedule", (r) =>
    mutation(
      r,
      "UNSCHEDULE",
      async (ctx, item, b) => {
        const reason = text(b.reason, 1000),
          p = await placementRow(ctx, item);
        await ctx.c.query(
          "UPDATE meeting_agenda SET status='WITHDRAWN',is_active=false,version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, p.id],
        );
        await ctx.c.query(
          "UPDATE meeting_agenda_items SET state='PARKED',current_placement_id=NULL,withdrawal_reason=$3,version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, item.id, reason],
        );
        await ctx.c.query(
          "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, p.meeting_id],
        );
      },
      ["reason"],
    ),
  );
  app.post(base + "/:itemId/actions/archive", (r) =>
    mutation(
      r,
      "ARCHIVE",
      async (ctx, item, b) => {
        await ctx.c.query(
          "UPDATE meeting_agenda_items SET state='ARCHIVED',archive_reason=$3,version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, item.id, text(b.reason, 1000)],
        );
      },
      ["reason"],
    ),
  );
  app.post(base + "/:itemId/actions/adopt", (r) =>
    mutation(
      r,
      "ADOPT",
      async (ctx, item, b) => {
        const owner = id(b.ownerMemberId),
          reason = text(b.reason, 1000);
        const active = await ctx.c.query(
          "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND member_type='MEMBER'",
          [ctx.org.id, owner],
        );
        if (!active.rowCount) fail(422, "INVALID_PARTICIPANT");
        await ctx.c.query(
          "UPDATE meeting_agenda_items SET owner_id=$3,adopted_by=$4,adopted_at=clock_timestamp(),adoption_reason=$5,version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, item.id, owner, ctx.member.id, reason],
        );
      },
      ["ownerMemberId", "reason"],
    ),
  );
}
export function createAgendaItemResourceAdapter(
  ports: MeetingPorts,
  assertAvailable: (ctx: Ctx) => Promise<void>,
): ResourceAccessPort {
  return {
    authorize: async (ctx, itemId, action) => {
      if (!["read", "attach", "comment", "follow"].includes(action))
        return false;
      try {
        await assertAvailable(ctx);
        await authorizeAgendaItem(
          ctx,
          itemId,
          action === "attach" || action === "comment" ? "REVISE" : "READ",
          ports,
        );
        return true;
      } catch (e) {
        if (unavailable(e)) return false;
        throw e;
      }
    },
  };
}

import type { FastifyRequest } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { fail, Failure, id, text, uuid } from "../../src/core.js";
import {
  agendaActor,
  agendaTarget,
  createAgendaIntention,
  placeAgendaItem,
} from "./agenda-items.js";
import { integer } from "./domain.js";
import { access, memberCheck, type MeetingPorts } from "./service.js";

/** Governance resolves and authorizes the current source in this same ctx.c.
 * The source command owns idempotency, source linkage and the outer transaction.
 * This destination never opens a transaction or reads governance tables.
 */
export type TensionAgendaInput = {
  meetingId: string;
  expectedMeetingVersion: number;
  source: { kind: "TENSION"; id: string; circleId: string; title: string; authorId?: string };
  presenterId?: string;
  durationMinutes?: number;
};
export interface MeetingAgendaCommandPort {
  /** Resolve a proposal's agenda source only through a currently readable meeting. */
  proposalSourceTension?(ctx: Ctx, proposalId: string): Promise<string|null>;
  proposalPlacements?(ctx: Ctx, proposalIds: string[]): Promise<{proposalId:string;meetingId:string;agendaId:string;circleId:string;title:string;startAt:string;state:string;version:number}[]>;
  /** Call from the source command authorize hook, before idempotent replay. */
  authorize(ctx: Ctx, meetingId: string, sourceCircleId?: string): Promise<void>;
  targets?(ctx: Ctx, circleId: string, sourceOwn: boolean, cursor?: string): Promise<{items: {id:string;circleId:string;title:string;state:string;startAt:string;version:number;method:string}[];page:{hasMore:boolean;nextCursor:string|null}}> ;
  addTension(
    ctx: Ctx,
    request: FastifyRequest,
    input: TensionAgendaInput,
  ): Promise<{
    agendaId: string;
    meetingId: string;
    meetingVersion: number;
    sourceId: string;
    itemId: string;
  }>;
}
export function createMeetingAgendaCommandPort(
  core: ModuleRuntime,
  ports: MeetingPorts,
): MeetingAgendaCommandPort {
  async function target(ctx: Ctx, meetingId: string, sourceCircleId?: string) {
    await core.assertResourceAvailable(ctx, "meeting");
    await agendaActor(ctx);
    const m=(await ctx.c.query("SELECT * FROM meeting_occurrences WHERE organization_id=$1 AND id=$2",[ctx.org.id,id(meetingId)])).rows[0];
    if(!m)fail(404,"RESOURCE_NOT_FOUND");
    const p=(await ctx.c.query("SELECT access FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3",[ctx.org.id,m.id,ctx.member.id])).rows[0];
    if(p?.access==='DENY')fail(404,"RESOURCE_NOT_FOUND");
    if(sourceCircleId && ports.canContributeAgenda) {
      const member=await ports.canContributeAgenda(ctx,m.circle_id);
      if(member){
        if(id(sourceCircleId)!==m.circle_id)fail(422,"MEETING_CIRCLE_MISMATCH");
        if(!["SCHEDULED","RUNNING"].includes(m.state))fail(409,"STATE_CONFLICT");
        return {m};
      }
    }
    const legacy=await agendaTarget(ctx,meetingId,ports);
    if(sourceCircleId&&id(sourceCircleId)!==legacy.m.circle_id)fail(422,"MEETING_CIRCLE_MISMATCH");
    return legacy;
  }
  return {
    async proposalSourceTension(ctx, proposalId) {
      if(ctx.member.member_type==='GUEST')return null;
      try {
        await core.assertResourceAvailable(ctx,'meeting');
        const rows=(await ctx.c.query(`SELECT agenda.source_id,a.meeting_id FROM meeting_actions a
          JOIN meeting_agenda agenda ON agenda.organization_id=a.organization_id AND agenda.id=a.agenda_id AND agenda.meeting_id=a.meeting_id
          WHERE a.organization_id=$1 AND a.target_kind='PROPOSAL' AND a.target_id=$2 AND agenda.source_id IS NOT NULL ORDER BY a.id`,[ctx.org.id,id(proposalId)])).rows;
        for(const row of rows){
          try {await access(ctx,row.meeting_id,'read',ports.readPolicy);return row.source_id;}
          catch(error){if(error instanceof Failure && [403,404].includes(error.status))continue;throw error;}
        }
        return null;
      } catch(error){if(error instanceof Failure && [403,404].includes(error.status))return null;throw error;}
    },
    async proposalPlacements(ctx, proposalIds) {
      if (!Array.isArray(proposalIds) || proposalIds.length > 1000) fail(400, "INVALID_REQUEST");
      const ids=[...new Set(proposalIds.map(id))];
      if (!ids.length) return [];
      await core.assertResourceAvailable(ctx, "meeting");
      const rows=(await ctx.c.query(`SELECT a.id AS agenda_id,a.source_id,o.id AS meeting_id,o.circle_id,o.title,o.start_at,o.state,o.version
        FROM meeting_agenda a JOIN meeting_agenda_items i ON i.organization_id=a.organization_id AND i.id=a.agenda_item_id
        JOIN meeting_occurrences o ON o.organization_id=a.organization_id AND o.id=a.meeting_id
        WHERE a.organization_id=$1 AND a.source_id=ANY($2::uuid[]) AND i.source_kind='PROPOSAL'
          AND a.is_active AND a.status NOT IN ('TRANSFERRED','WITHDRAWN') AND o.state IN ('SCHEDULED','RUNNING') ORDER BY o.start_at,o.id,a.id`,[ctx.org.id,ids])).rows;
      const visible=[];
      for(const row of rows){
        try {await access(ctx,row.meeting_id,"read",ports.readPolicy)}
        catch(error:any){if([403,404].includes(error.statusCode??error.status))continue;throw error}
        visible.push({proposalId:row.source_id,meetingId:row.meeting_id,agendaId:row.agenda_id,circleId:row.circle_id,title:row.title,startAt:new Date(row.start_at).toISOString(),state:row.state,version:row.version});
      }
      return visible;
    },
    async authorize(ctx, meetingId, sourceCircleId) {
      await target(ctx, meetingId, sourceCircleId);
    },
    async targets(ctx,circleId,sourceOwn,cursor) {
      await core.assertResourceAvailable(ctx,'meeting');await agendaActor(ctx);id(circleId);
      const after=cursor?id(cursor):'00000000-0000-0000-0000-000000000000';
      const rows=(await ctx.c.query("SELECT id FROM meeting_occurrences WHERE organization_id=$1 AND circle_id=$2 AND state IN ('SCHEDULED','RUNNING') AND id>$3 ORDER BY id LIMIT 101",[ctx.org.id,circleId,after])).rows;
      const items=[];
      for(const row of rows.slice(0,100)){
        try {const {m}=await target(ctx,row.id,sourceOwn?circleId:undefined);items.push({id:m.id,circleId:m.circle_id,title:m.title,state:m.state,startAt:new Date(m.start_at).toISOString(),version:m.version,method:m.method});}
        catch(e:any){if(![403,404,409,422].includes(e.statusCode??e.status))throw e;}
      }
      const hasMore=rows.length>100;
      return {items,page:{hasMore,nextCursor:hasMore?rows[99].id:null}};
    },
    async addTension(ctx, request, input) {
      const own=input.source?.authorId===ctx.member.id;
      const { m } = await target(ctx, input.meetingId, own?input.source.circleId:undefined);
      if (input.expectedMeetingVersion !== m.version)
        fail(409, "VERSION_CONFLICT");
      if (input.source?.kind !== "TENSION") fail(400, "INVALID_REQUEST");
      const sourceId = id(input.source.id);
      // A tension is dispatched to its own circle's meeting. The source supplies
      // this value from its authorized row, never directly from the HTTP body.
      if (id(input.source.circleId) !== m.circle_id)
        fail(422, "MEETING_CIRCLE_MISMATCH");
      const presenter = id(input.presenterId ?? ctx.member.id);
      await memberCheck(ctx, [presenter], ports);
      const duplicate = await ctx.c.query(
        "SELECT 1 FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND source_id=$3",
        [ctx.org.id, m.id, sourceId],
      );
      if (duplicate.rowCount) fail(409, "SOURCE_ALREADY_ON_AGENDA");
      const item = await createAgendaIntention(
        ctx,
        {
          title: input.source.title,
          expectedDurationMinutes: input.durationMinutes ?? 5,
        },
        { kind: "TENSION", id: sourceId, circleId: m.circle_id },
      );
      const agendaId = await placeAgendaItem(ctx, item, m, presenter, ports);
      await core.changed(
        ctx,
        request,
        agendaId,
        "AgendaItemCreatedFromTension",
      );
      return {
        agendaId,
        itemId: item.id,
        meetingId: m.id,
        meetingVersion: m.version + 1,
        sourceId,
      };
    },
  };
}

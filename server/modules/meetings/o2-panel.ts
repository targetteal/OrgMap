import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { completeAgendaItem } from "./agenda-items.js";
import { Governance } from "../governance/service.js";
import { createMeetingAgendaCommandPort } from "./agenda-port.js";
import { sections } from "./domain.js";
import { initialDocument } from "./documents.js";
import {
  body,
  camel,
  fail,
  id,
  key,
  text,
  uuid,
  version,
} from "../../src/core.js";
import { access, memberCheck, type MeetingPorts } from "./service.js";

export async function o2Membership(
  core: ModuleRuntime,
  ctx: Ctx,
  circleId: string,
): Promise<boolean | null> {
  if (!(await core.governanceModel()?.state(ctx))) return null;
  if (ctx.member.member_type !== "MEMBER" || ctx.member.status !== "ACTIVE")
    return false;
  const reasons = (await core
    .foundationStructure()!
    .membershipReasons(ctx, ctx.member.id)) as { circles: string[] };
  return reasons.circles.includes(circleId);
}
export const stages = [
  "PRESENT",
  "REACT",
  "ADJUST",
  "OBJECT",
  "INTEGRATE",
  "APPROVED",
] as const;
export function nextStage(stage: string, action: string, pending: number) {
  if (action === "integrate" && stage === "OBJECT") return "INTEGRATE";
  if (action === "advance") {
    if (stage === "INTEGRATE") {
      if (pending) fail(409, "VALID_OBJECTIONS_PENDING");
      return "OBJECT";
    }
    if (stage === "OBJECT") {
      if (pending) fail(409, "VALID_OBJECTIONS_PENDING");
      return "APPROVED";
    }
    const n = ["PRESENT", "REACT", "ADJUST", "OBJECT"];
    if (n.includes(stage) && stage !== "OBJECT") return n[n.indexOf(stage) + 1];
  }
  fail(409, "PROCESS_TRANSITION_DENIED");
}
export async function authorizeO2Contribution(
  ctx: Ctx,
  mid: string,
  r: FastifyRequest,
  ports: MeetingPorts,
) {
  const x = await access(ctx, mid, "read", ports.readPolicy);
  const kind = (r.body as any)?.kind;
  const membership = await ports.readPolicy?.o2Member?.(ctx, x.m.circle_id);
  if (
    membership === null ||
    membership === undefined ||
    !["PROPOSAL", "POLICY"].includes(kind)
  )
    return access(ctx, mid, "edit", ports.readPolicy);
  if (!membership || x.supervised || x.p.attendance !== "PRESENT")
    fail(403, "ACTION_DENIED");
  return x;
}
export async function assertO2Completion(ctx: Ctx, mid: string, aid: string) {
  // Only a governance proposal already approved binds this completion guard.
  const pending = await ctx.c.query(
    `SELECT 1 FROM meeting_actions a JOIN gov_proposals p ON p.organization_id=a.organization_id AND p.id=a.target_id
    WHERE a.organization_id=$1 AND a.meeting_id=$2 AND a.agenda_id=$3 AND a.target_kind='PROPOSAL' AND p.verdict='ADOPT' AND p.apply_state<>'APPLIED'`,
    [ctx.org.id, mid, aid],
  );
  if (pending.rowCount) fail(409, "GOVERNANCE_APPLICATION_PENDING");
}
export async function snapshotO2(ctx: Ctx, mid: string) {
  const rows = async (t: string) =>
    (
      await ctx.c.query(
        `SELECT * FROM ${t} WHERE organization_id=$1 AND meeting_id=$2`,
        [ctx.org.id, mid],
      )
    ).rows.map(camel);
  const decisions = (
    await ctx.c.query(
      `SELECT p.id,p.title,p.revision,p.state,p.verdict,p.apply_state, a.agenda_id,v.payload FROM meeting_actions a JOIN gov_proposals p ON p.organization_id=a.organization_id AND p.id=a.target_id JOIN gov_revisions v ON v.organization_id=p.organization_id AND v.proposal_id=p.id AND v.number=p.revision WHERE a.organization_id=$1 AND a.meeting_id=$2 AND a.target_kind='PROPOSAL'`,
      [ctx.org.id, mid],
    )
  ).rows.map(camel);
  for (const decision of decisions) {
    if (decision.applyState === "APPLIED") {
      decision.changes = decision.payload?.changes ?? [];
      const restrictions = [];
      for (const part of decision.payload?.documents ?? (decision.payload?.documentId ? [decision.payload] : [])) {
        const doc = (
          await ctx.c.query(
            "SELECT v.document_id,v.number,d.title,v.content,v.rich_content FROM gov_document_versions v JOIN gov_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id WHERE v.organization_id=$1 AND v.document_id=$2 AND v.number=$3 AND d.visibility='ORGANIZATION'",
            [
              ctx.org.id,
              part.documentId,
              part.documentVersion,
            ],
          )
        ).rows[0];
        if (doc) restrictions.push({...camel(doc),...(part.documentAction?{documentAction:part.documentAction}:{})});
      }
      decision.restrictions = restrictions;
      decision.restriction = restrictions[0] ?? null;
    }
    delete decision.payload;
  }
  return {
    decisions,
    panels: await rows("meeting_o2_panels"),
    processes: await rows("meeting_o2_processes"),
    treatments: await rows("meeting_o2_treatments"),
    reviews: await rows("meeting_o2_reviews"),
  };
}
export async function registerO2Panel(
  app: FastifyInstance,
  core: ModuleRuntime,
  ports: MeetingPorts,
) {
  const base =
    "/api/v1/organizations/:organizationId/meetings/:meetingId/panel";
  async function auth(ctx: Ctx, mid: string, present = false) {
    await core.assertResourceAvailable(ctx, "meeting");
    const x = await access(ctx, mid, "read", ports.readPolicy);
    const member = await o2Membership(core, ctx, x.m.circle_id);
    if (member === null || member === undefined) fail(409, "O2_MODEL_REQUIRED");
    if (
      present &&
      ((!member &&
        !(
          (x.p.access === "EDIT" && x.p.can_manage) ||
          [x.m.notetaker_id, x.m.facilitator_id].includes(ctx.member.id)
        )) ||
        x.supervised ||
        x.p.attendance !== "PRESENT" ||
        x.m.state !== "RUNNING")
    )
      fail(403, "ACTION_DENIED");
    return { ...x, member };
  }
  app.get(base, (r) =>
    core.tenant(r, { mode: "read" }, async (ctx) => {
      const mid = id((r.params as any).meetingId),
        x = await auth(ctx, mid);
      const panel = (
        await ctx.c.query(
          "SELECT * FROM meeting_o2_panels WHERE organization_id=$1 AND meeting_id=$2",
          [ctx.org.id, mid],
        )
      ).rows[0] ?? { version: 1, notes: "", focus_id: null };
      const processes = (
        await ctx.c.query(
          "SELECT * FROM meeting_o2_processes WHERE organization_id=$1 AND meeting_id=$2",
          [ctx.org.id, mid],
        )
      ).rows.map(camel);
      const treatments = (
        await ctx.c.query(
          "SELECT * FROM meeting_o2_treatments WHERE organization_id=$1 AND meeting_id=$2",
          [ctx.org.id, mid],
        )
      ).rows.map(camel);
      const proposals = [];
      const links = (
        await ctx.c.query(
          "SELECT target_id,agenda_id FROM meeting_actions WHERE organization_id=$1 AND meeting_id=$2 AND target_kind='PROPOSAL'",
          [ctx.org.id, mid],
        )
      ).rows;
      for (const link of links) {
        if (link.agenda_id !== panel.focus_id && x.m.state !== "SCHEDULED")
          continue;
        const p = (
          await ctx.c.query(
            "SELECT id,title,circle_id,state,revision,version,kind,apply_state,verdict,author_id FROM gov_proposals WHERE organization_id=$1 AND id=$2 AND circle_id=$3 AND kind IN ('GOVERNANCE','DOCUMENT')",
            [ctx.org.id, link.target_id, x.m.circle_id],
          )
        ).rows[0];
        if (!p || (x.m.state === "SCHEDULED" && p.author_id !== ctx.member.id))
          continue;
        const revision = (
          await ctx.c.query(
            "SELECT payload FROM gov_revisions WHERE organization_id=$1 AND proposal_id=$2 AND number=$3",
            [ctx.org.id, p.id, p.revision],
          )
        ).rows[0];
        const documents = [];
        const documentParts = revision?.payload?.documents ?? (revision?.payload?.documentId ? [revision.payload] : []);
        for (const documentPart of documentParts) {
          if (!documentPart?.documentId || !documentPart?.documentVersion) continue;
          const document = (
            await ctx.c.query(
              `SELECT v.document_id,v.number,d.title,v.content,v.rich_content FROM gov_document_versions v JOIN gov_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id WHERE v.organization_id=$1 AND v.document_id=$2 AND v.number=$3 AND d.visibility='ORGANIZATION'`,
              [
                ctx.org.id,
                documentPart.documentId,
                documentPart.documentVersion,
              ],
            )
          ).rows[0];
          if (document) documents.push({...camel(document),...(documentPart.documentAction?{documentAction:documentPart.documentAction}:{})});
        }
        const target = await ports.outcomes?.read(ctx, { kind: 'PROPOSAL', id: p.id });
        proposals.push({
          proposal: { ...camel(p), payload: revision?.payload },
          agendaId: link.agenda_id,
          documents,
          document: documents[0] ?? null,
          ...(target?.proposal ? { detail: target.proposal } : {}),
        });
      }
      const canConfigure =
        (await core
          .governanceModel()
          ?.hasFunction(ctx, x.m.circle_id, "SCRIBE")) === true;
      const review =
        (
          await ctx.c.query(
            "SELECT items FROM meeting_o2_reviews WHERE organization_id=$1 AND meeting_id=$2",
            [ctx.org.id, mid],
          )
        ).rows[0]?.items ?? [];
      const reviewCandidates = x.member
        ? [
            ...((await ports.linkedItems?.(ctx, {
              circleId: x.m.circle_id,
              includeSubcircles: true,
            })) ?? []),
            ...(
              await ctx.c.query(
                `SELECT i.id,i.name AS title,'INDICATOR' AS kind FROM structure_indicators i JOIN entities e ON e.organization_id=i.organization_id AND e.id=i.entity_id WHERE i.organization_id=$1 AND NOT e.archived AND NOT i.archived AND i.subject_kind IN ('CIRCLE','ROLE')`,
                [ctx.org.id],
              )
            ).rows,
          ]
        : [];
      const minutes =
        x.m.state === "CLOSED"
          ? (
              await ctx.c.query(
                "SELECT v.snapshot FROM meeting_report_versions v JOIN meeting_reports r ON r.organization_id=v.organization_id AND r.id=v.report_id WHERE r.organization_id=$1 AND r.meeting_id=$2 ORDER BY v.version DESC LIMIT 1",
                [ctx.org.id, mid],
              )
            ).rows[0]?.snapshot
          : null;
      const attendees = (
        await ctx.c.query(
          "SELECT * FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND attendance='PRESENT' AND access<>'DENY'",
          [ctx.org.id, mid],
        )
      ).rows.map(camel);
      for (const attendee of attendees) {
        if(x.m.state==='CLOSED')continue;
        try {
          const reasons = (await core.foundationStructure()!.membershipReasons(ctx, attendee.memberId)) as { circles: string[] };
          attendee.isCircleMember = reasons.circles.includes(x.m.circle_id);
        } catch(error:any) {
          if(error?.code!=='MEMBER_INACTIVE')throw error;
          attendee.isCircleMember=null;
        }
      }
      return {
        attendees,
        minutes,
        canConfigure,
        review,
        reviewCandidates,
        proposals,
        panel: camel(panel),
        processes,
        treatments,
        member: x.member,
        present: x.p.attendance === "PRESENT",
        canConduct:
          x.p.attendance === "PRESENT" &&
          ((x.p.access === "EDIT" && x.p.can_manage) ||
            [x.m.notetaker_id, x.m.facilitator_id].includes(
              ctx.member.id,
            )),
      };
    }),
  );
  app.post(base + "/actions/:action", (r) =>
    core.tenant(
      r,
      {
        mode: "write",
        authorize: async (ctx) => {
          const x = await auth(ctx, id((r.params as any).meetingId)),
            a = (r.params as any).action;
          if (!["RUNNING", "SCHEDULED"].includes(x.m.state))
            fail(409, "STATE_CONFLICT");
          if (a === "presence")
            return (
              !x.supervised &&
              ctx.member.member_type === "MEMBER" &&
              x.p.access !== "DENY"
            );
          if (a === "template")
            return (
              (await core
                .governanceModel()
                ?.hasFunction(ctx, x.m.circle_id, "SCRIBE")) === true
            );
          const authority =
            (x.p.access === "EDIT" && x.p.can_manage) ||
            [x.m.notetaker_id, x.m.facilitator_id].includes(ctx.member.id);
          if ((!x.member && !authority) || x.supervised)
            fail(403, "ACTION_DENIED");
          if (a === "invite") return true;
          if (a === "attach" && x.m.state === "SCHEDULED") return true;
          if (x.p.attendance !== "PRESENT" || x.m.state !== "RUNNING")
            fail(403, "ACTION_DENIED");
          if (["tension", "assume", "attach"].includes(a)) return true;
          if (a === "notes") return authority;
          return authority;
        },
      },
      async (ctx) => {
        const mid = id((r.params as any).meetingId),
          action = (r.params as any).action;
        const x = await auth(ctx, mid),
          { m } = x;
        if (!["RUNNING", "SCHEDULED"].includes(m.state))
          fail(409, "STATE_CONFLICT");
        version(r, m.version);
        const b = body(r, [
          "agendaId",
          "proposalId",
          "revision",
          "action",
          "reason",
          "objectionId",
          "valid",
          "confirmed",
          "role",
          "memberId",
          "attendance",
          "title",
          "description",
          "mode",
          "notes",
          "sectionId",
          "sections",
          "items",
        ]);
        const conduct =
          x.p.attendance === "PRESENT" &&
          ((x.p.access === "EDIT" && x.p.can_manage) ||
            [m.notetaker_id, m.facilitator_id].includes(ctx.member.id));
        if (action === "template" || action === "sections") {
          if (
            action === "template"
              ? !(await core
                  .governanceModel()
                  ?.hasFunction(ctx, m.circle_id, "SCRIBE"))
              : !conduct
          )
            fail(403, "ACTION_DENIED");
          const parsed = sections(b.sections);
          if (action === "template") {
            await ctx.c.query(
              `INSERT INTO meeting_o2_circle_templates(organization_id,circle_id,sections,review_items) VALUES($1,$2,$3,COALESCE((SELECT items FROM meeting_o2_reviews WHERE organization_id=$1 AND meeting_id=$4),'[]'::jsonb)) ON CONFLICT(organization_id,circle_id) DO UPDATE SET sections=$3,review_items=excluded.review_items,version=meeting_o2_circle_templates.version+1`,
              [ctx.org.id, m.circle_id, JSON.stringify(parsed), mid],
            );
          } else {
            if (!parsed.some((s) => s.id === m.current_step))
              fail(409, "CURRENT_SECTION_REQUIRED");
            for (const s of parsed)
              await ctx.c.query(
                `INSERT INTO meeting_documents(organization_id,meeting_id,section_id,snapshot,protocol,schema_version) VALUES($1,$2,$3,$4,'orgmap-richtext-yjs-v1',1) ON CONFLICT DO NOTHING`,
                [
                  ctx.org.id,
                  mid,
                  s.id,
                  initialDocument("orgmap-richtext-yjs-v1"),
                ],
              );
            await ctx.c.query(
              "UPDATE meeting_occurrences SET sections=$3 WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, mid, JSON.stringify(parsed)],
            );
          }
        } else if (action === "review") {
          if (!conduct || !Array.isArray(b.items) || b.items.length > 100)
            fail(403, "ACTION_DENIED");
          const candidates =
            (await ports.linkedItems?.(ctx, {
              circleId: m.circle_id,
              includeSubcircles: true,
            })) ?? [];
          const indicators = (
            await ctx.c.query(
              `SELECT i.id,i.name AS title,i.kind FROM structure_indicators i JOIN entities e ON e.organization_id=i.organization_id AND e.id=i.entity_id WHERE i.organization_id=$1 AND NOT e.archived AND NOT i.archived AND i.subject_kind IN ('CIRCLE','ROLE')`,
              [ctx.org.id],
            )
          ).rows;
          const allowed = [
            ...candidates,
            ...indicators.map((i) => ({ ...i, kind: "INDICATOR" })),
          ];
          const items = b.items.map((item: any) => {
            const source = allowed.find(
              (a) => a.id === item.id && a.kind === item.kind,
            );
            if (!source) fail(404, "RESOURCE_NOT_FOUND");
            return { id: source!.id, kind: source!.kind, title: source!.title };
          });
          await ctx.c.query(
            `INSERT INTO meeting_o2_reviews(organization_id,meeting_id,items) VALUES($1,$2,$3) ON CONFLICT(organization_id,meeting_id) DO UPDATE SET items=$3,version=meeting_o2_reviews.version+1`,
            [ctx.org.id, mid, JSON.stringify(items)],
          );
        } else if (action === "presence") {
          if (
            x.supervised ||
            ctx.member.member_type !== "MEMBER" ||
            x.p.access === "DENY"
          )
            fail(403, "ACTION_DENIED");
          if (!["PRESENT", "ABSENT"].includes(b.attendance))
            fail(400, "INVALID_REQUEST");
          await ctx.c.query(
            `INSERT INTO meeting_participants(organization_id,meeting_id,member_id,access,attendance) VALUES($1,$2,$3,'READ',$4)
        ON CONFLICT(organization_id,meeting_id,member_id) DO UPDATE SET attendance=excluded.attendance`,
            [ctx.org.id, mid, ctx.member.id, b.attendance],
          );
        } else if (action === "invite") {
          if (!x.member && !(x.p.access === "EDIT" && x.p.can_manage))
            fail(403, "ACTION_DENIED");
          const member = id(b.memberId);
          await memberCheck(ctx, [member], ports);
          if (
            !(
              await ctx.c.query(
                "SELECT 1 FROM members WHERE organization_id=$1 AND id=$2 AND member_type='MEMBER' AND status='ACTIVE'",
                [ctx.org.id, member],
              )
            ).rowCount
          )
            fail(422, "INVALID_PARTICIPANT");
          // Do not overwrite ACLs or reset an existing presence.
          await ctx.c.query(
            `INSERT INTO meeting_participants(organization_id,meeting_id,member_id,access,origin,participation_role)
        VALUES($1,$2,$3,'READ','DIRECT','OPTIONAL') ON CONFLICT DO NOTHING`,
            [ctx.org.id, mid, member],
          );
        } else if (action === "assume") {
          await auth(ctx, mid, true);
          if (
            b.confirmed !== true ||
            !["SCRIBE", "FACILITATOR"].includes(b.role)
          )
            fail(400, "CONFIRM_ABSENCE_OF_OBJECTIONS");
          await ctx.c.query(
            `UPDATE meeting_occurrences SET ${b.role === "SCRIBE" ? "notetaker_id" : "facilitator_id"}=$3 WHERE organization_id=$1 AND id=$2`,
            [ctx.org.id, mid, ctx.member.id],
          );
        } else if (action === "tension") {
          await auth(ctx, mid, true);
          if (!["SYNC", "ADAPT"].includes(b.mode)) fail(400, "INVALID_REQUEST");
          const governance = new Governance(ctx, r, {
            agenda: createMeetingAgendaCommandPort(core, ports),
          });
          const tension = await governance.tension({
            circleId: m.circle_id,
            title: b.title,
            description: b.description ?? "",
          });
          // Reuse the owning tension dispatch command with its own entity version.
          const dispatchRequest = {
            id: r.id,
            headers: { ...r.headers, "if-match": `"${tension.version}"` },
          } as FastifyRequest;
          const dispatched = await new Governance(ctx, dispatchRequest, {
            agenda: createMeetingAgendaCommandPort(core, ports),
          }).processTension(tension.id, {
            targetKind: "AGENDA",
            meetingId: mid,
            meetingVersion: m.version,
          });
          const aid = dispatched.targetId;
          await ctx.c.query(
            "INSERT INTO meeting_o2_treatments(organization_id,meeting_id,agenda_id,mode,description) VALUES($1,$2,$3,$4,$5)",
            [
              ctx.org.id,
              mid,
              aid,
              b.mode,
              b.description ? text(b.description, 10000) : "",
            ],
          );
        } else if (action === "complete") {
          if (!conduct) fail(403, "ACTION_DENIED");
          const aid = id(b.agendaId);
          const entry = (
            await ctx.c.query(
              "SELECT * FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND id=$3 AND status='OPEN'",
              [ctx.org.id, mid, aid],
            )
          ).rows[0];
          if (!entry) fail(404, "RESOURCE_NOT_FOUND");
          await completeAgendaItem(ctx, aid);
          await ctx.c.query(
            "UPDATE meeting_agenda SET status='COMPLETED',version=version+1 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, aid],
          );
        } else if (action === "attach") {
          await auth(ctx, mid, m.state === "RUNNING");
          const pid = id(b.proposalId),
            aid = id(b.agendaId);
          if (
            !ports.outcomes ||
            !(await ports.outcomes.read(ctx, { kind: "PROPOSAL", id: pid }))
          )
            fail(404, "RESOURCE_NOT_FOUND");
          const p = (
            await ctx.c.query(
              "SELECT * FROM gov_proposals WHERE organization_id=$1 AND id=$2 AND circle_id=$3 AND state='DRAFT' AND author_id=$4 AND kind IN ('GOVERNANCE','DOCUMENT')",
              [ctx.org.id, pid, m.circle_id, ctx.member.id],
            )
          ).rows[0];
          const agenda = (
            await ctx.c.query(
              "SELECT 1 FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND id=$3 AND presenter_id=$4",
              [ctx.org.id, mid, aid, ctx.member.id],
            )
          ).rows[0];
          if (!p || !agenda) fail(403, "ACTION_DENIED");
          if (
            (
              await ctx.c.query(
                "SELECT 1 FROM meeting_actions WHERE organization_id=$1 AND target_kind='PROPOSAL' AND target_id=$2",
                [ctx.org.id, pid],
              )
            ).rowCount
          )
            fail(409, "PROPOSAL_ALREADY_IN_MEETING");
          await ctx.c.query(
            "INSERT INTO meeting_actions(organization_id,id,meeting_id,agenda_id,title,assignee_id,target_kind,target_id,output_created_by,output_command_key) VALUES($1,$2,$3,$4,$5,$6,'PROPOSAL',$7,$6,$8)",
            [ctx.org.id, uuid(), mid, aid, p.title, ctx.member.id, pid, key(r)],
          );
          await ctx.c.query(
            "INSERT INTO meeting_o2_treatments(organization_id,meeting_id,agenda_id,mode) VALUES($1,$2,$3,'ADAPT') ON CONFLICT(organization_id,meeting_id,agenda_id) DO NOTHING",
            [ctx.org.id, mid, aid],
          );
        } else if (action === "focus") {
          if (!conduct) fail(403, "ACTION_DENIED");
          const aid = id(b.agendaId);
          if (
            !(
              await ctx.c.query(
                "SELECT 1 FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2 AND id=$3",
                [ctx.org.id, mid, aid],
              )
            ).rowCount
          )
            fail(404, "RESOURCE_NOT_FOUND");
          await ctx.c.query(
            `INSERT INTO meeting_o2_panels(organization_id,meeting_id,focus_id) VALUES($1,$2,$3) ON CONFLICT(organization_id,meeting_id) DO UPDATE SET focus_id=$3,version=meeting_o2_panels.version+1`,
            [ctx.org.id, mid, aid],
          );
        } else if (action === "notes") {
          if (
            x.p.attendance !== "PRESENT" ||
            !(
              (x.p.access === "EDIT" && x.p.can_manage) ||
              [m.notetaker_id, m.facilitator_id].includes(ctx.member.id)
            )
          )
            fail(403, "ACTION_DENIED");
          await ctx.c.query(
            `INSERT INTO meeting_o2_panels(organization_id,meeting_id,notes) VALUES($1,$2,$3) ON CONFLICT(organization_id,meeting_id) DO UPDATE SET notes=$3,version=meeting_o2_panels.version+1`,
            [
              ctx.org.id,
              mid,
              typeof b.notes === "string" && b.notes === ""
                ? ""
                : text(b.notes, 10000),
            ],
          );
        } else if (action === "step") {
          if (!conduct) fail(403, "ACTION_DENIED");
          if (!m.sections.some((s: any) => s.id === b.sectionId))
            fail(400, "INVALID_REQUEST");
          await ctx.c.query(
            "UPDATE meeting_occurrences SET current_step=$3 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, mid, b.sectionId],
          );
        } else if (action === "process") {
          if (!conduct || m.state !== "RUNNING") fail(403, "ACTION_DENIED");
          const pid = id(b.proposalId);
          const p = (
            await ctx.c.query(
              `SELECT p.* FROM gov_proposals p JOIN meeting_actions a ON a.organization_id=p.organization_id AND a.target_id=p.id AND a.target_kind='PROPOSAL'
        JOIN meeting_o2_panels panel ON panel.organization_id=a.organization_id AND panel.meeting_id=a.meeting_id AND panel.focus_id=a.agenda_id
        WHERE p.organization_id=$1 AND p.id=$2 AND a.meeting_id=$3 AND p.circle_id=$4`,
              [ctx.org.id, pid, mid, m.circle_id],
            )
          ).rows[0];
          if (
            !p ||
            !["GOVERNANCE", "DOCUMENT"].includes(p.kind) ||
            p.state !== "DRAFT"
          )
            fail(409, "PROPOSAL_NOT_IN_TREATMENT");
          let proc = (
            await ctx.c.query(
              "SELECT * FROM meeting_o2_processes WHERE organization_id=$1 AND meeting_id=$2 AND proposal_id=$3",
              [ctx.org.id, mid, pid],
            )
          ).rows[0];
          if (!proc || proc.revision !== p.revision) {
            if (b.action !== "start")
              fail(409, "PROPOSAL_CHANGED_RESTART_REQUIRED");
            if (b.revision !== p.revision) fail(409, "VERSION_CONFLICT");
            await ctx.c.query(
              `INSERT INTO meeting_o2_processes(organization_id,meeting_id,proposal_id,revision) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,meeting_id,proposal_id) DO UPDATE SET revision=$4,stage='PRESENT',objections='[]',version=meeting_o2_processes.version+1`,
              [ctx.org.id, mid, pid, p.revision],
            );
          } else {
            if (b.revision !== p.revision) fail(409, "VERSION_CONFLICT");
            let obs = proc.objections,
              stage = proc.stage;
            if (b.action === "objection") {
              if (!["OBJECT", "INTEGRATE"].includes(stage))
                fail(409, "STATE_CONFLICT");
              obs = [
                ...obs,
                {
                  id: uuid(),
                  reason: text(b.reason, 10000),
                  valid: true,
                  resolved: false,
                  recordedBy: ctx.member.id,
                },
              ];
            } else if (b.action === "resolve") {
              if (stage !== "INTEGRATE") fail(409, "STATE_CONFLICT");
              const ob = obs.find((o: any) => o.id === b.objectionId);
              if (!ob) fail(404, "RESOURCE_NOT_FOUND");
              if (typeof b.valid !== "boolean") fail(400, "INVALID_REQUEST");
              obs = obs.map((o: any) =>
                o.id === ob.id
                  ? {
                      ...o,
                      valid: b.valid,
                      resolved: true,
                      resolution: text(b.reason, 10000),
                    }
                  : o,
              );
            } else {
              if (
                b.action === "advance" &&
                stage === "OBJECT" &&
                b.confirmed !== true
              )
                fail(400, "CONFIRM_ABSENCE_OF_OBJECTIONS");
              stage = nextStage(
                stage,
                b.action,
                obs.filter((o: any) => o.valid && !o.resolved).length,
              );
            }
            await ctx.c.query(
              "UPDATE meeting_o2_processes SET stage=$4,objections=$5,version=version+1 WHERE organization_id=$1 AND meeting_id=$2 AND proposal_id=$3",
              [ctx.org.id, mid, pid, stage, JSON.stringify(obs)],
            );
          }
        } else fail(400, "INVALID_REQUEST");
        await ctx.c.query(
          "UPDATE meeting_occurrences SET version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, mid],
        );
        await core.changed(ctx, r, mid, "O2Meeting" + action);
        return { updated: true };
      },
    ),
  );
}

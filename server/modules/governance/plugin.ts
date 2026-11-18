import {validateRoleMentions} from "../../content/role-mentions.js";
import {proposalEntityReferences} from './entity-references.js';
import { cursor, pageInput } from "./pagination.js";
import {
  responseSchema,
  agendaMeetingsResponseSchema,
  policySchema,
  payloadSchema,
  changeSchema,
} from "./schemas.js";
import type { OrgMapModule, Ctx } from "../../src/runtime.js";
import type { FastifyRequest } from "fastify";
import { body, camel, fail, id, text, version, Failure } from "../../src/core.js";
import { Governance, type GovernancePorts } from "./service.js";
import { tensionDestinations } from './trace.js';
import {createGovernanceRuntimePorts} from "./guest.js";
const str = { type: "string" },
  guid = { type: "string", format: "uuid" },
  obj = { type: "object", additionalProperties: true };
const fields: Record<string, unknown> = {
  typeId: guid,
  name: str,
  active: { type: "boolean" },
  targetKind: { type: "string", enum: ["TASK", "GOAL","AGENDA"] },
  meetingId:guid,
  projectId:{anyOf:[guid,{type:"null"}]},
  meetingVersion:{type:"integer",minimum:1},
  revision:{type:"integer",minimum:1},
  confirmed:{type:"boolean"},
  draftOnly:{type:"boolean"},
  title: str,
  description: str,
  descriptionRich: obj,
  circleId: guid,
  ownerId: guid,
  tensionId: guid,
  newTension: {type:'object',additionalProperties:false,required:['title'],properties:{title:str,description:str,descriptionRich:obj}},
  tensionRevision: {type:'object',additionalProperties:false,required:['version','descriptionRich'],properties:{version:{type:'integer',minimum:1},descriptionRich:obj}},
  newDocument: {type:'object',additionalProperties:false,required:['title','richContent'],properties:{title:str,richContent:obj}},
  documentRevision: {type:'object',additionalProperties:false,required:['documentId','version','richContent'],properties:{documentId:guid,version:{type:'integer',minimum:1},richContent:obj}},
  reviewDurationHours: {type:'number',exclusiveMinimum:0,maximum:8760},
  branchId: guid,
  kind: { type: "string", enum: ["GOVERNANCE", "DOCUMENT", "ELECTION"] },
  payload: payloadSchema,
  changes: { type: "array", items: changeSchema },
  configuration: policySchema,
  choice: { type: "string", enum: ["CONSENT", "ABSTAIN", "OBJECT"] },
  rationale: str,
  state: str,
  reason: str,
  verdict: str,
  workflow: { type: "string", enum: ["DIRECT", "GOVERNANCE"] },
  visibility: { type: "string", enum: ["ORGANIZATION", "AUTHOR"] },
  content: str,
  richContent: obj,
  number: { type: "integer", minimum: 1 },
  candidateId: guid,
  step: str,
};
export function createGovernanceModule(
  inputPorts: GovernancePorts = {},
): OrgMapModule {
  return async (app, core) => {
    const ports=createGovernanceRuntimePorts(core,inputPorts);
    const base = "/api/v1/organizations/:organizationId";
    const params = {
      type: "object",
      required: ["organizationId"],
      properties: { organizationId: guid, id: guid },
      additionalProperties: false,
    };
    async function authorized(ctx: Ctx, r: FastifyRequest, action: string) {
      const g = new Governance(ctx, r, ports);
      if (action === 'meeting-consent') {
        const proposal = await g.row('gov_proposals', (r.params as any).id);
        const authority = await g.meetingConsentAuthority(proposal, true);
        if (authority?.ready === false) fail(409,'INTEGRATIVE_PROCESS_REQUIRED');
        return !!authority;
      }
      if (action === "policy") {
        await g.authorizePolicy(r.body);
        return true;
      }
      if (["decide", "apply", "step"].includes(action)) {
        const proposal=await g.row("gov_proposals", (r.params as any).id);
        const modeled=await ports.modelParticipation?.(ctx,proposal.circle_id);
        return ctx.member.org_role === "OWNER" && modeled !== false;
      }
      if (
        [
          "policy",
          "branch",
          "decide",
          "apply",
          "step",
          "document-type",
        ].includes(action)
      )
        return ctx.member.org_role === "OWNER";
      const p = r.params as any;
      const input = (r.body ?? {}) as any;
      if (action === "tension" || action === "proposal")
        return g.participates(id(input.circleId));
      if (action === "document") {
        const e = await g.entity(input.ownerId);
        return g.participates(e.kind === "CIRCLE" ? e.id : e.parent_id);
      }
      if (action.startsWith("document:")) {
        const d = await g.documentRow(p.id);
        return d.author_id === g.actor || ctx.member.org_role === "OWNER";
      }
      if (action === "end" || action === "process-tension") {
        const t = await g.row("gov_tensions", p.id);
        const allowed=t.author_id === g.actor || ctx.member.org_role === "OWNER";
        if(!allowed)return false;
        if(action==='end') {
          const pending=await ctx.c.query(`SELECT 1 FROM gov_proposals p WHERE p.organization_id=$1 AND p.verdict='ADOPT' AND p.apply_state<>'APPLIED'
            AND (p.tension_id=$2 OR EXISTS(SELECT 1 FROM meeting_actions a JOIN meeting_agenda agenda ON agenda.organization_id=a.organization_id AND agenda.id=a.agenda_id AND agenda.meeting_id=a.meeting_id
              WHERE a.organization_id=p.organization_id AND a.target_kind='PROPOSAL' AND a.target_id=p.id AND agenda.source_id=$2)) LIMIT 1`,[ctx.org.id,t.id]);
          if(pending.rowCount)fail(409,'GOVERNANCE_APPLICATION_PENDING');
        }
        if(action==='process-tension' && input.projectId!==undefined && input.targetKind!=='TASK')fail(400,'INVALID_REQUEST');
        if(action==='process-tension' && input.targetKind==='TASK' && input.projectId!=null){
          if(!ports.authorizeTensionTaskProject)fail(503,'TENSION_TARGET_SERVICE_REQUIRED');
          await ports.authorizeTensionTaskProject!(ctx,id(input.projectId));
        }
        if(action==='process-tension'&&input.targetKind==='AGENDA'){
          if(t.state==='CLOSED')fail(409,'STATE_CONFLICT');
          if(!ports.agenda)fail(503,'TENSION_AGENDA_SERVICE_REQUIRED');
          await ports.agenda!.authorize(ctx,id(input.meetingId),t.author_id===g.actor?t.circle_id:undefined);
        }
        return true;
      }
      if (action === "objection") {
        const o = await g.row("gov_objections", p.id);
        return ctx.member.org_role === "OWNER" || o.author_id === g.actor;
      }
      const proposal = await g.row("gov_proposals", p.id);
      if (action === 'amend') return g.canAmendProposal(proposal);
      if (["submit","nominate"].includes(action)) return g.canEditProposal(proposal);
      if (action === "vote" || action === "escalate") {
        const round = (
          await ctx.c.query(
            "SELECT electorate FROM gov_rounds WHERE organization_id=$1 AND proposal_id=$2 AND revision=$3",
            [ctx.org.id, proposal.id, proposal.revision],
          )
        ).rows[0];
        return (
          !!round?.electorate.includes(g.actor) &&
          (g.isGuest()?await g.hasGuestResource("proposal",proposal.id,"vote"):await g.participates(proposal.circle_id))
        );
      }
      return (
        (proposal.author_id === g.actor || ctx.member.org_role === "OWNER") &&
        (await g.participates(proposal.circle_id))
      );
    }
    function post(
      path: string,
      action: string,
      keys: string[],
      required: string[],
      work: (g: Governance, r: FastifyRequest, b: any) => Promise<any>,
      created = false,
    ) {
      app.post(
        base + path,
        {
          schema: {
            response: responseSchema,
            params,
            body: {
              type: "object",
              properties: Object.fromEntries(keys.map((k) => [k, fields[k]])),
              required,
              additionalProperties: false,
            },
          },
          bodyLimit: /^\/(documents|proposals|tensions|governance\/branches)(\/|$)/.test(path)?1048576:65536,
        },
        async (r, reply) => {
          const result = await core.tenant(
            r,
            {
              mode: action === "policy" ? "authorization_write" : "write",
              authorize: (ctx) => authorized(ctx, r, action),
            },
            async (ctx) => {
              const g = new Governance(ctx, r, ports);
              const input = body(r, keys);
              await validateRoleMentions(ctx, input);
              const result = await work(g, r, input);
              const resource = result.id ?? (r.params as any).id ?? ctx.org.id;
              await core.changed(ctx, r, resource, "Governance." + action);
              return result;
            },
          );
          // A replay must not return a source identifier whose independent
          // authorization or module availability has since been revoked.
          const projection=result.data?.proposal ?? result.data;
          if(projection && typeof projection.tensionId==='string') {
            const visible=await core.tenant(r,{mode:'read'},async ctx=>ctx.member.member_type!=='GUEST' && !!ports.trace && !!await ports.trace.tension(ctx,projection.tensionId));
            if(!visible.data) projection.tensionId=null;
          }
          if(action==='process-tension' && typeof result.data?.targetId==='string') {
            const targetId=result.data.targetId,kind=result.data.targetKind;
            const visible=await core.tenant(r,{mode:'read'},async ctx=>ctx.member.member_type!=='GUEST' && !!ports.trace && ['TASK','GOAL','AGENDA'].includes(kind) && !!await ports.trace.destination(ctx,kind,targetId));
            if(!visible.data)result.data.targetId=null;
          }
          result.meta.resourceVersion =
            result.data?.version ??
            result.data?.proposal?.version ??
            result.data?.document?.version ??
            null;
          if (result.data?.applyState === "APPLY_CONFLICT") {
            reply.code(409);
            return {
              error: {
                code: "APPLY_CONFLICT",
                message:
                  "A evolução aprovada conflita com os dados atuais. Revise e abra uma nova rodada.",
                fieldErrors: [],
                retryable: false,
                conflictDetails: {applyState:result.data.applyState,conflictCode:result.data.conflictCode},
              },
              meta: { requestId: r.id },
            };
          }
          if (created) reply.code(201);
          return result;
        },
      );
    }
    for (const action of ["revise", "close"])
      post(
        "/governance/branches/:id/actions/" + action,
        "branch",
        action === "revise" ? ["title", "changes"] : [],
        action === "revise" ? ["title", "changes"] : [],
        async (g, r, b) => {
          const branch = await g.row("gov_branches", (r.params as any).id);
          version(r, branch.version);
          if (branch.state !== "OPEN") fail(409, "STATE_CONFLICT");
          if (
            (
              await g.c.query(
                "SELECT 1 FROM gov_proposals WHERE organization_id=$1 AND branch_id=$2 AND (state IN ('DRAFT','REVIEW','ESCALATED') OR (verdict='ADOPT' AND apply_state<>'APPLIED'))",
                [g.org, branch.id],
              )
            ).rowCount
          )
            fail(409, "ACTIVE_PROPOSAL");
          const row = (
            await g.c.query(
              action === "revise"
                ? "UPDATE gov_branches SET title=$3,changes=$4,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *"
                : "UPDATE gov_branches SET state='CLOSED',version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
              action === "revise"
                ? [
                    g.org,
                    branch.id,
                    text(b.title),
                    JSON.stringify(await g.validateChanges(b.changes)),
                  ]
                : [g.org, branch.id],
            )
          ).rows[0];
          await g.history(branch.id, "Branch" + action, row);
          return camel(row);
        },
      );
    post(
      "/document-types",
      "document-type",
      ["name", "workflow"],
      ["name", "workflow"],
      (g, r, b) => g.documentType(b),
      true,
    );
    post(
      "/document-types/:id/actions/configure",
      "document-type",
      ["name", "workflow", "active"],
      ["name", "workflow"],
      (g, r, b) => g.documentType(b, (r.params as any).id),
    );
    post(
      "/tensions/:id/actions/process",
      "process-tension",
      ["targetKind","meetingId","meetingVersion","projectId"],
      ["targetKind"],
      (g, r, b) => g.processTension((r.params as any).id, b),
    );
    post(
      "/governance/policies",
      "policy",
      ["circleId", "configuration"],
      ["circleId", "configuration"],
      (g, r, b) => g.setPolicy(b),
    );
    post(
      "/tensions",
      "tension",
      ["title", "description", "descriptionRich", "circleId"],
      ["title", "circleId"],
      (g, r, b) => g.tension(b),
      true,
    );
    post("/tensions/:id/actions/close", "end", [], [], (g, r) =>
      g.endTension((r.params as any).id),
    );
    post(
      "/governance/branches",
      "branch",
      ["title", "changes"],
      ["title", "changes"],
      (g, r, b) => g.branch(b),
      true,
    );
    post(
      "/proposals",
      "proposal",
      ["title", "circleId", "kind", "payload", "tensionId", "newTension", "tensionRevision", "newDocument", "documentRevision", "branchId"],
      ["title", "circleId", "kind"],
      (g, r, b) => g.proposal(b),
      true,
    );
    post(
      "/proposals/:id/revisions",
      "amend",
      ["payload","documentRevision","draftOnly"],
      [],
      (g, r, b) => g.amend((r.params as any).id, b),
      true,
    );
    post("/proposals/:id/actions/submit", "submit", ["reviewDurationHours"], [], (g, r, b) =>
      g.submit((r.params as any).id,b),
    );
    post(
      "/proposals/:id/votes",
      "vote",
      ["choice", "rationale"],
      ["choice"],
      (g, r, b) => g.vote((r.params as any).id, b),
    );
    post(
      "/proposals/:id/actions/escalate",
      "escalate",
      ["reason"],
      ["reason"],
      (g, r, b) => g.escalate((r.params as any).id, b),
    );
    post(
      "/governance/objections/:id/actions/review",
      "objection",
      ["state", "reason"],
      ["state", "reason"],
      (g, r, b) => g.objection((r.params as any).id, b),
    );
    post(
      "/proposals/:id/actions/decide",
      "decide",
      ["verdict", "reason"],
      ["reason"],
      (g, r, b) => g.decide((r.params as any).id, b),
    );
    post("/proposals/:id/actions/apply", "apply", [], [], (g, r) =>
      g.apply((r.params as any).id),
    );
    post('/proposals/:id/actions/meeting-consent', 'meeting-consent', ['meetingVersion','revision','confirmed','reason'], ['meetingVersion','revision','confirmed','reason'], (g,r,b) =>
      g.recordMeetingConsent((r.params as any).id,b),
    );
    post(
      "/proposals/:id/actions/withdraw",
      "withdraw",
      ["reason"],
      ["reason"],
      async (g, r, b) => {
        const p = await g.row("gov_proposals", (r.params as any).id);
        version(r, p.version);
        if (!["DRAFT", "REVIEW"].includes(p.state)) fail(409, "STATE_CONFLICT");
        await g.c.query(
          "UPDATE gov_rounds SET state='SUPERSEDED' WHERE organization_id=$1 AND proposal_id=$2 AND state='OPEN'",
          [g.org, p.id],
        );
        const row = (
          await g.c.query(
            "UPDATE gov_proposals SET state='WITHDRAWN',version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
            [g.org, p.id],
          )
        ).rows[0];
        await g.history(p.id, "ProposalWithdrawn", {
          ...row,
          reason: text(b.reason, 10000),
        });
        return camel(row);
      },
    );
    post(
      "/proposals/:id/actions/step",
      "step",
      ["step"],
      ["step"],
      async (g, r, b) => {
        const { p, r: round } = await g.roundFor((r.params as any).id);
        version(r, p.version);
        const steps = round.policy.workflowSteps as string[];
        if (steps.indexOf(b.step) !== steps.indexOf(round.step) + 1)
          fail(409, "WORKFLOW_STEP_CONFLICT");
        await g.c.query(
          "UPDATE gov_rounds SET step=$3 WHERE organization_id=$1 AND id=$2",
          [g.org, round.id, b.step],
        );
        await g.history(p.id, "ProposalStepChanged", {
          roundId: round.id,
          step: b.step,
        });
        return { roundId: round.id, step: b.step };
      },
    );
    post(
      "/proposals/:id/nominations",
      "nominate",
      ["candidateId", "rationale"],
      ["candidateId", "rationale"],
      async (g, r, b) => {
        const p = await g.row("gov_proposals", (r.params as any).id);
        version(r, p.version);
        if (p.kind !== "ELECTION" || p.state !== "DRAFT")
          fail(409, "STATE_CONFLICT");
        await g.member(b.candidateId);
        const row = (
          await g.c.query(
            "INSERT INTO gov_nominations(organization_id,id,proposal_id,candidate_id,author_id,rationale) VALUES($1,gen_random_uuid(),$2,$3,$4,$5) RETURNING *",
            [g.org, p.id, b.candidateId, g.actor, text(b.rationale, 10000)],
          )
        ).rows[0];
        await g.history(p.id, "CandidateNominated", row);
        return camel(row);
      },
      true,
    );
    post(
      "/documents",
      "document",
      ["title", "ownerId", "workflow", "visibility", "content", "richContent", "typeId"],
      ["title", "ownerId", "workflow", "visibility"],
      (g, r, b) => g.document(b),
      true,
    );
    for (const action of ["draft", "publish", "restore", "archive"])
      post(
        "/documents/:id/actions/" + action,
        "document:" + action,
        action === "draft"
          ? ["content","richContent"]
          : action === "restore"
            ? ["number"]
            : [],
        action === "draft"
          ? []
          : action === "restore"
            ? ["number"]
            : [],
        (g, r, b) => g.documentAction((r.params as any).id, action, b),
      );
    app.get(base + '/proposals/:id/origin', {schema:{params,response:responseSchema}}, r => core.tenant(r,{mode:'read'},async ctx=>{
      const pid=id((r.params as any).id);
      if(ctx.member.member_type==='GUEST')fail(404,'RESOURCE_NOT_FOUND');
      const g=new Governance(ctx,r,ports),p=await g.row('gov_proposals',pid);
      const trace=ports.trace;
      if(!trace||!await trace.destination(ctx,'PROPOSAL',pid))fail(404,'RESOURCE_NOT_FOUND');
      return {origin:p.tension_id ? await trace!.tension(ctx,p.tension_id) : await trace!.meetingOrigin?.(ctx,'PROPOSAL',pid)??null};
    }));
    app.get(base + '/tensions/:id/agenda-meetings', {schema:{params,response:agendaMeetingsResponseSchema}}, r => core.tenant(r,{mode:'read'},async ctx=>{
      const g=new Governance(ctx,r,ports),t=await g.row('gov_tensions',id((r.params as any).id));
      if(g.isGuest() || (t.author_id!==g.actor && ctx.member.org_role!=='OWNER'))fail(404,'RESOURCE_NOT_FOUND');
      if(t.state==='CLOSED')fail(409,'STATE_CONFLICT');
      if(!ports.agenda?.targets)fail(503,'TENSION_AGENDA_SERVICE_REQUIRED');
      const q=r.query as Record<string,string>;if(Object.keys(q).some(k=>!['cursor','limit'].includes(k)) || (q.limit!==undefined && q.limit!=='100'))fail(400,'INVALID_REQUEST');
      return ports.agenda!.targets!(ctx,t.circle_id,t.author_id===g.actor,q.cursor);
    }));
    app.get(base + '/tensions/:id/trace', {schema:{params,response:responseSchema}}, r => core.tenant(r,{mode:'read'},async ctx=>{
      const tid=id((r.params as any).id);
      const trace=ports.trace;
      if(ctx.member.member_type==='GUEST'||!trace||!await trace.tension(ctx,tid))fail(404,'RESOURCE_NOT_FOUND');
      return {items:await tensionDestinations(ctx,tid,trace!)};
    }));
    app.get(base + '/governance/proposal-circles', {schema:{response:responseSchema}}, r => core.tenant(r,{mode:'read'},async ctx=>{
      const g=new Governance(ctx,r,ports);
      if(g.isGuest())fail(404,'RESOURCE_NOT_FOUND');
      const circles=(await ctx.c.query("SELECT id,name FROM entities WHERE organization_id=$1 AND kind='CIRCLE' AND NOT archived ORDER BY name,id",[ctx.org.id])).rows;
      const items=[];
      // Use the exact command authority, including the active governance model.
      // Ownership of the organization is not an implicit O2 circle membership.
      for(const circle of circles)if(await g.participates(circle.id))items.push({id:circle.id,name:circle.name});
      return {items};
    }));
    app.get(base + '/governance/election-roles', {schema:{response:responseSchema}}, r => core.tenant(r,{mode:'read'},async ctx=>{
      const circleId=id((r.query as any).circleId),g=new Governance(ctx,r,ports);
      if(g.isGuest())fail(404,'RESOURCE_NOT_FOUND');
      await g.entity(circleId,'CIRCLE');
      const rows=(await ctx.c.query("SELECT id,name FROM entities WHERE organization_id=$1 AND parent_id=$2 AND kind='ROLE' AND archived=false ORDER BY name,id",[ctx.org.id,circleId])).rows;
      const items=[];
      for(const role of rows){try{await ports.validateModelElection?.(ctx,{circleId,roleId:role.id});items.push({id:role.id,title:role.name});}catch(e:any){if(e?.status===422)continue;throw e;}}
      return {items};
    }));
    app.get(base + "/governance/policies/:id/effective", {
      schema: {params, response: responseSchema},
    }, r => core.tenant(r, {mode:"read"}, async ctx => {
      const g = new Governance(ctx,r,ports);
      const circleId = id((r.params as any).id);
      if (!(await g.participates(circleId))) fail(404,"RESOURCE_NOT_FOUND");
      return g.policyResolution(circleId);
    }));
    for (const family of [
      "document-types",
      "tensions",
      "proposals",
      "documents",
      "governance/branches",
      "governance/policies",
    ])
      app.get(
        base + "/" + family,
        {
          schema: {
            params,
            response: responseSchema,
            querystring: {
              type: "object",
              additionalProperties: false,
              properties: {
                limit: { type: "integer", minimum: 1, maximum: 100 },
                cursor: { type: "string", maxLength: 2000 },
              },
            },
          },
        },
        async (r) =>
          core.tenant(r, { mode: "read" }, async (ctx) => {
            const g = new Governance(ctx, r, ports);
            const table = {
              "document-types": "gov_document_types",
              tensions: "gov_tensions",
              proposals: "gov_proposals",
              documents: "gov_documents",
              "governance/branches": "gov_branches",
              "governance/policies": "gov_policies",
            }[family]!;
            const scope = ctx.org.id + ":" + ctx.member.id + ":" + family;
            const { limit, after } = pageInput(r.query, scope);
            const guestKind=({proposals:"proposal",tensions:"tension",documents:"agreement"} as Record<string,string>)[family];
            const guestIds=g.isGuest()?await g.guestIds(guestKind??""):null;
            let scan = after;
            const items: any[] = [];
            let exhausted = false;
            while (items.length <= limit && !exhausted) {
              const rows = (
                await ctx.c.query(
                  family === "proposals"
                    ? `SELECT p.*,
                  ARRAY(SELECT DISTINCT part_kind FROM (
                    SELECT coalesce(change->>'entityKind',e.kind) AS part_kind
                    FROM gov_revisions v CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.payload->'changes','[]'::jsonb)) change
                    LEFT JOIN entities e ON e.organization_id=v.organization_id AND e.id::text=change->>'entityId'
                    WHERE v.organization_id=p.organization_id AND v.proposal_id=p.id AND v.number=p.revision
                    UNION ALL
                    SELECT 'DOCUMENT' FROM gov_revisions v2
                    WHERE v2.organization_id=p.organization_id AND v2.proposal_id=p.id AND v2.number=p.revision
                      AND jsonb_array_length(coalesce(v2.payload->'documents','[]'::jsonb))>0
                  ) parts WHERE part_kind IN ('ROLE','CIRCLE','DOCUMENT')) AS change_kinds,
                  coalesce(nullif((SELECT coalesce(jsonb_array_length(v.payload->'changes'),0)+coalesce(jsonb_array_length(v.payload->'documents'),0) FROM gov_revisions v WHERE v.organization_id=p.organization_id AND v.proposal_id=p.id AND v.number=p.revision),0),1) AS evolution_count,
                  (SELECT count(DISTINCT b.member_id)::int FROM gov_rounds r JOIN gov_ballots b ON b.organization_id=r.organization_id AND b.round_id=r.id WHERE r.organization_id=p.organization_id AND r.proposal_id=p.id AND r.revision=p.revision) AS response_count,
                  coalesce((SELECT cardinality(r.electorate) FROM gov_rounds r WHERE r.organization_id=p.organization_id AND r.proposal_id=p.id AND r.revision=p.revision),0) AS electorate_count,
                  (SELECT r.deadline FROM gov_rounds r WHERE r.organization_id=p.organization_id AND r.proposal_id=p.id AND r.revision=p.revision) AS deadline,
                  (SELECT b.choice FROM gov_rounds r JOIN gov_ballots b ON b.organization_id=r.organization_id AND b.round_id=r.id WHERE r.organization_id=p.organization_id AND r.proposal_id=p.id AND r.revision=p.revision AND b.member_id=$3 ORDER BY b.number DESC LIMIT 1) AS own_vote,
                  EXISTS(SELECT 1 FROM gov_rounds r WHERE r.organization_id=p.organization_id AND r.proposal_id=p.id AND r.revision=p.revision AND r.state='OPEN' AND $3=ANY(r.electorate) AND NOT (coalesce(r.policy->>'decisionProcess','STANDARD')='HOLACRACY_O2' AND r.policy->>'method'='CONSENT_WINDOW' AND r.deadline IS NULL) AND (r.deadline IS NULL OR r.deadline>clock_timestamp()) AND ((r.policy->>'allowRevote')::boolean OR NOT EXISTS(SELECT 1 FROM gov_ballots b WHERE b.organization_id=r.organization_id AND b.round_id=r.id AND b.member_id=$3))) AS can_vote
                  FROM gov_proposals p WHERE p.organization_id=$1 AND p.id>$2 AND ($4::uuid[] IS NULL OR p.id=ANY($4::uuid[])) ORDER BY p.id LIMIT 101`
                    : family === 'documents'
                    ? `SELECT d.*, v.content, v.rich_content FROM gov_documents d LEFT JOIN gov_document_versions v ON v.organization_id=d.organization_id AND v.document_id=d.id AND v.number=coalesce(d.published_version,d.draft_version) WHERE d.organization_id=$1 AND d.id>$2 AND ($3::uuid[] IS NULL OR d.id=ANY($3::uuid[])) ORDER BY d.id LIMIT 101`
                    : `SELECT * FROM ${table} WHERE organization_id=$1 AND id>$2 AND ($3::uuid[] IS NULL OR id=ANY($3::uuid[])) ORDER BY id LIMIT 101`,
                  family === "proposals"
                    ? [ctx.org.id, scan, g.actor,guestIds]
                    : [ctx.org.id, scan,guestIds],
                )
              ).rows;
              exhausted = rows.length < 101;
              for (const row of rows) {
                scan = row.id;
                if (
                  family === "documents" &&
                  row.visibility === "AUTHOR" &&
                  row.author_id !== g.actor
                )
                  continue;
                if (
                  family === "governance/branches" &&
                  row.author_id !== g.actor &&
                  ctx.member.org_role !== "OWNER"
                )
                  continue;
                if (
                  family === "proposals" &&
                  await g.isDraftHidden(row)
                )
                  continue;
                if (
                  row.circle_id &&
                  family !== "proposals" && family !== "tensions" &&
                  !g.isGuest() &&
                  !(await g.participates(row.circle_id)) &&
                  row.author_id !== g.actor
                )
                  continue;
                if (family === "proposals" && row.can_vote)
                  row.can_vote = g.isGuest()?await g.hasGuestResource("proposal",row.id,"vote"):await g.participates(row.circle_id);
                items.push({
                  ...camel(row),
                  ...(family === 'proposals' ? {tensionId:row.tension_id && ctx.member.member_type!=='GUEST' && await ports.trace?.tension(ctx,row.tension_id) ? row.tension_id : null} : {}),
                  ...(family === "tensions"
                    ? { canProcess: !g.isGuest()&&row.state!=='CLOSED'&&(row.author_id===g.actor||ctx.member.org_role==='OWNER')&&!!ports.createFromTension,canProcessAgenda:!g.isGuest()&&row.state!=='CLOSED'&&(row.author_id===g.actor||ctx.member.org_role==='OWNER')&&!!ports.agenda }
                    : {}),
                });
                if (items.length > limit) break;
              }
            }
            const hasMore = items.length > limit;
            const visible = items.slice(0, limit);
            if(family==='proposals' && !g.isGuest() && ports.agenda?.proposalPlacements){
              try {
                const drafts=visible.filter(item=>item.state==='DRAFT');
                const placements=await ports.agenda.proposalPlacements(ctx,drafts.map(item=>item.id));
                for(const item of drafts){const placement=placements.find(entry=>entry.proposalId===item.id && entry.circleId===item.circleId);if(placement)item.scheduledMeeting=placement;}
              } catch(error){if(!(error instanceof Failure && error.code==='MODULE_DISABLED'))throw error;}
            }
            return {
              items: visible,
              page: {
                nextCursor: hasMore ? cursor(visible.at(-1).id, scope) : null,
                hasMore,
              },
            };
          }),
      );
    app.get(
      base + "/proposals/:id",
      {
        schema: {
          params,
          response: responseSchema,
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              limit: { type: "integer", minimum: 1, maximum: 100 },
              cursor: { type: "string", maxLength: 2000 },
              documentRevision: { type: "integer", minimum: 1 },
            },
          },
        },
      },
      async (r) =>
        core.tenant(r, { mode: "read" }, async (ctx) => {
          const g = new Governance(ctx, r, ports);
          const p = await g.row("gov_proposals", (r.params as any).id);
          const meetingAccess = await g.meetingConsentAuthority(p, true);
          const meetingConsent = p.state === 'DRAFT' && meetingAccess?.ready !== false ? meetingAccess : null;
          const canAmend = await g.canAmendProposal(p);
          if (await g.isDraftHidden(p))
            fail(404, "RESOURCE_NOT_FOUND");
          const rows = async (table: string) => {
            const all = (
              await ctx.c.query(
                `SELECT * FROM ${table} WHERE organization_id=$1 AND proposal_id=$2 ORDER BY ${table === "gov_revisions" ? "number" : "id"}`,
                [g.org, p.id],
              )
            ).rows;
            return all.map((row) =>
              table === "gov_commits"
                ? {
                    id: row.id,
                    revision: row.revision,
                    branchId: row.branch_id,
                    at: row.at.toISOString(),
                  }
                : camel(row),
            );
          };
          const revisions = await rows("gov_revisions");
          const meetingDocuments: {documentId:string;title:string;number:number;content:string;richContent:unknown;proposalRevision:number;documentAction?:string;editableDocumentVersion?:number}[] = [];
          let editableDocumentVersion: number|undefined;
          if (!g.isGuest() && (p.kind === 'DOCUMENT' || p.kind === 'GOVERNANCE')) {
            const proposalRevision = (r.query as {documentRevision?:number}).documentRevision ?? p.revision;
            const payload = revisions.find(revision => revision.number === proposalRevision)?.payload;
            const parts = payload?.documents ?? (payload?.documentId ? [payload] : []);
            for (const part of parts) {
              if (!part?.documentId || !part?.documentVersion) continue;
              const document = (await ctx.c.query(
                `SELECT d.title,d.version,d.draft_version,d.archived,v.number,v.content,v.rich_content
                 FROM gov_documents d JOIN gov_document_versions v ON v.organization_id=d.organization_id AND v.document_id=d.id
                 WHERE d.organization_id=$1 AND d.id=$2 AND v.number=$3 AND d.visibility='ORGANIZATION'
                   AND (d.workflow='GOVERNANCE' OR EXISTS(SELECT 1 FROM entities e WHERE e.organization_id=d.organization_id AND e.id=d.owner_id AND e.kind='CIRCLE'))`,
                [ctx.org.id,part.documentId,part.documentVersion],
              )).rows[0];
              if (document) {
                const editable = canAmend && p.state==='DRAFT' && proposalRevision===p.revision && part.documentAction!=='ARCHIVE' && !document.archived && document.draft_version===document.number;
                meetingDocuments.push({documentId:part.documentId,title:document.title,number:document.number,content:document.content,richContent:document.rich_content,proposalRevision,
                  ...(part.documentAction?{documentAction:part.documentAction}:{}),...(editable?{editableDocumentVersion:document.version}:{})});
              }
            }
            editableDocumentVersion=meetingDocuments[0]?.editableDocumentVersion;
          }
          const entityReferences = await proposalEntityReferences(ctx,p.circle_id,revisions);
          const rounds = await rows("gov_rounds");
          const roundIds = rounds.map((x) => x.id);
          const objections = (
            await ctx.c.query(
              "SELECT * FROM gov_objections WHERE organization_id=$1 AND round_id=ANY($2::uuid[]) ORDER BY id",
              [g.org, roundIds],
            )
          ).rows.map(camel);
          const ballots = (
            await ctx.c.query(
              "SELECT * FROM gov_ballots WHERE organization_id=$1 AND round_id=ANY($2::uuid[]) ORDER BY at",
              [g.org, roundIds],
            )
          ).rows.map(camel);
          const history=(await ctx.c.query(`SELECT id,actor_id,action,at,snapshot FROM gov_history WHERE organization_id=$1 AND (resource_id=$2 OR resource_id=ANY($3::uuid[])) ORDER BY at,id`,[g.org,p.id,objections.map(o=>o.id)])).rows.map(row=>({id:row.id,actorId:row.actor_id,action:row.action,at:row.at.toISOString(),...(typeof row.snapshot.reason==='string'?{reason:row.snapshot.reason}:{}),...(typeof row.snapshot.source==='string'?{source:row.snapshot.source}:{}),...(typeof row.snapshot.verdict==='string'?{verdict:row.snapshot.verdict}:{}),...(typeof row.snapshot.choice==='string'?{choice:row.snapshot.choice}:{}),...(typeof row.snapshot.revision==='number'?{revision:row.snapshot.revision}:{}),...(typeof row.snapshot.commitId==='string'?{commitId:row.snapshot.commitId}:{})}));
          const current=rounds.find(round=>round.revision===p.revision);
          const canVote=!!current&&p.state==='REVIEW'&&current.state==='OPEN'&&current.electorate.includes(g.actor)&&!(current.policy.decisionProcess==='HOLACRACY_O2'&&current.policy.method==='CONSENT_WINDOW'&&!current.deadline)&&(!current.deadline||new Date(current.deadline)>await g.now())&&(current.policy.allowRevote||!ballots.some(ballot=>ballot.roundId===current.id&&ballot.memberId===g.actor))&&(g.isGuest()?await g.hasGuestResource('proposal',p.id,'vote'):await g.participates(p.circle_id));
          let originTensionId=p.tension_id??null;
          if(!originTensionId && !g.isGuest() && ports.trace?.tension)
            originTensionId=await ports.agenda?.proposalSourceTension?.(ctx,p.id)??null;
          const originTension=originTensionId && !g.isGuest() && await ports.trace?.tension(ctx,originTensionId) ? camel(await g.row('gov_tensions',originTensionId)) : null;
          const policyResolution = await g.policyResolution(p.circle_id);
          return {
            proposal: {...camel(p),tensionId:originTension?originTensionId:null,canEdit:await g.canEditProposal(p),canAmend,canVote,
              policy: policyResolution.configuration,
              allowOverride: policyResolution.allowOverride,
              meetingConsentRequired:await g.meetingConsentRequired(p),
              ...(editableDocumentVersion!==undefined?{editableDocumentVersion}:{}),
              ...(p.state==='DRAFT' && meetingAccess?.ready===false?{meetingConsentPending:true}:{}),
              ...(meetingConsent?{consentMeetingId:meetingConsent.meetingId,consentMeetingVersion:meetingConsent.meetingVersion}:{})},
            ...(originTension?{originTension}:{}),
            revisions,
            entityReferences,
            rounds,
            objections,
            ballots,
            nominations: await rows("gov_nominations"),
            commits: await rows("gov_commits"),
            history,
            ...(meetingDocuments.length ? {meetingDocuments,meetingDocument:meetingDocuments[0]} : {}),
          };
        }),
    );
    app.get(
      base + "/documents/:id",
      {
        schema: {
          params,
          response: responseSchema,
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              limit: { type: "integer", minimum: 1, maximum: 100 },
              cursor: { type: "string", maxLength: 2000 },
            },
          },
        },
      },
      async (r) =>
        core.tenant(r, { mode: "read" }, async (ctx) => {
          const g = new Governance(ctx, r, ports);
          const d = await g.documentRow((r.params as any).id);
          const versions = (
            await ctx.c.query(
              "SELECT number,content,rich_content,created_at,created_by FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2 ORDER BY number DESC",
              [g.org, d.id],
            )
          ).rows.map(camel);
          // Publication evidence is revision-bound and stays in Governance.
          // Resolve each destination through its owning domain's current ACL.
          const commits = (await ctx.c.query(
            `SELECT c.proposal_id,c.revision,part->>'documentVersion' AS published_version FROM gov_commits c
             CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.changes->'payload'->'documents')='array'
               THEN c.changes->'payload'->'documents' ELSE jsonb_build_array(c.changes->'payload') END) part
             CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.changes->'outcome'->'documents')='array'
               THEN c.changes->'outcome'->'documents' ELSE jsonb_build_array(jsonb_build_object(
                 'documentId',c.changes->'payload'->>'documentId','publishedVersion',c.changes->'outcome'->'publishedVersion',
                 'archived',c.changes->'outcome'->'archived')) END) result
             WHERE c.organization_id=$1 AND c.proposal_id IS NOT NULL AND c.revision IS NOT NULL
               AND part->>'documentId'=$2 AND result->>'documentId'=part->>'documentId'
               AND part->>'documentAction' IS DISTINCT FROM 'ARCHIVE' AND result->>'archived' IS DISTINCT FROM 'true'
               AND part->>'documentVersion' IS NOT NULL AND result->>'publishedVersion'=part->>'documentVersion'
             ORDER BY c.at DESC,c.id DESC`, [g.org, d.id],
          )).rows;
          const direct = d.workflow === 'DIRECT' ? (await ctx.c.query(
            `SELECT snapshot FROM gov_history WHERE organization_id=$1 AND resource_id=$2 AND action='Documentpublish'`,
            [g.org, d.id],
          )).rows : [];
          for (const version of versions) {
            if (direct.some((item: any) => item.snapshot?.published_version === version.number)) {
              version.origin = { kind: 'direct' };
              continue;
            }
            const commit = commits.find((item: any) => item.published_version === String(version.number));
            if (!commit) continue;
            const proposal = await ports.trace?.destination(ctx, 'PROPOSAL', commit.proposal_id) ?? null;
            if (!proposal) { version.origin = { kind: 'unavailable' }; continue; }
            const decisions = (await ctx.c.query(
              `SELECT snapshot->>'meetingId' AS meeting_id FROM gov_history
               WHERE organization_id=$1 AND resource_id=$2 AND action='ProposalDecided'
                 AND snapshot->>'source'='MEETING_CONSENT' AND snapshot->>'revision'=$3
               ORDER BY at DESC,id DESC LIMIT 1`, [g.org, commit.proposal_id, String(commit.revision)],
            )).rows;
            const mid = decisions[0]?.meeting_id;
            const meeting = typeof mid === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(mid)
              ? await ports.trace?.destination(ctx, 'MEETING', mid) ?? null : null;
            version.origin = { kind: 'governed', proposal, proposalRevision: commit.revision, ...(meeting ? { meeting } : {}) };
          }
          return { document: camel(d), versions };
        }),
    );
  };
}
export const exportOrgMapModule = createGovernanceModule();
export { createGovernancePolicyPorts, validateOrgPolicy } from "./service.js";
export {createGovernanceRuntimePorts,createGovernanceGuestAccessAdapter} from "./guest.js";
export const registerContext = exportOrgMapModule;
export default exportOrgMapModule;

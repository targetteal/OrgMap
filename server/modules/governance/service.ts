import type { Ctx,ModuleRuntime } from "../../src/runtime.js";
import { agreementContent,tensionDescription } from "./content.js";
import type {MeetingAgendaCommandPort} from "../meetings/agenda-port.js";
import type { FastifyRequest } from "fastify";
import type { NotificationContext } from "../../../packages/contracts/notifications.js";
import {
  fail,
  id,
  text,
  optionalText,
  uuid,
  version,
  camel,
} from "../../src/core.js";
import {
  changes,
  draftIsHidden as defaultDraftIsHidden,
  defaultPolicy,
  policy,
  mayVote,
  verdict,
  type Change,
  type DocumentPart,
  type Policy,
} from "./domain.js";
/** Admin supplies its tenant-scoped root record, never a client-selected override. */
export type OrganizationalGovernancePolicy = {
  key: "governance.method";
  value: Policy["method"];
  allowOverride: boolean;
};
export function organizationalGovernancePolicy(input: OrganizationalGovernancePolicy): Policy {
  if (input.key !== "governance.method" || typeof input.allowOverride !== "boolean")
    fail(422, "INVALID_GOVERNANCE_POLICY");
  return policy({ ...defaultPolicy, method: input.value });
}
function samePolicy(a: Policy, b: Policy) {
  return Object.keys(defaultPolicy).filter(key => key !== 'decisionProcess').every(key =>
    JSON.stringify(a[key as keyof Policy]) === JSON.stringify(b[key as keyof Policy]),
  );
}
/** Admin calls before saving its root policy, inside the same ctx.c transaction. */
export async function validateOrgPolicy(
  ctx: Ctx,
  input: { key: string; value: unknown; allowOverride: boolean },
): Promise<void> {
  if (input.key !== "governance.method") return;
  if (ctx.mode !== "write" && ctx.mode !== "authorization_write")
    fail(403, "READ_ONLY_TRANSACTION");
  const next = organizationalGovernancePolicy(input as OrganizationalGovernancePolicy);
  if (!input.allowOverride) {
    const locals = await ctx.c.query(
      "SELECT configuration FROM gov_policies WHERE organization_id=$1",
      [ctx.org.id],
    );
    if (locals.rows.some(row => !samePolicy(policy(row.configuration), next)))
      fail(409, "GOVERNANCE_POLICY_RECONCILIATION_REQUIRED");
  }
}
export function createGovernancePolicyPorts() {
  return { validateOrgPolicy };
}
export interface GovernancePorts {
  modelGovernancePolicy?(ctx:Ctx):Promise<{configuration:Partial<Policy>;packageId:string;packageVersion:string;modelRevision:number}|null>;
  modelParticipation?(ctx:Ctx,circleId:string):Promise<boolean|null>;
  validateModelElection?(ctx:Ctx,input:{circleId:string;roleId:string;winnerId?:string|null;mandateEnd?:string}):Promise<void>;
  validateModelDocument?(ctx:Ctx,input:{circleId:string;documentId:string}):Promise<void>;
  /** True when the org's governance model is OPERATING and agreement changes must go through proposals. */
  modelGovernedChanges?(ctx:Ctx):Promise<boolean>;
  validateModelChanges?(ctx:Ctx,input:{circleId:string;changes:Change[]}):Promise<void>;
  meetingConsent?(ctx: Ctx, input: {proposalId:string;circleId:string;revision:number}): Promise<{meetingId:string;meetingVersion:number;ready?:boolean}|null>;
  holacracyMeetingOrigin?(ctx:Ctx,input:{proposalId:string;circleId:string;runningOnly?:boolean}):Promise<boolean>;
  scheduleConsent?(ctx:Ctx, availableAt?:Date):Promise<void>;
  consentDistributionReady?(ctx:Ctx, input:{eventId:string;proposalId:string;electorate:string[];submitterId:string}):Promise<boolean>;
  /** Same transaction as the governance event; recipients are current authorized members of its captured electorate. */
  notifyProposal?(ctx:Ctx,input:{eventId:string;event:'ProposalSubmitted'|'ProposalDecided'|'ConsentWindowOpened';proposalId:string;recipients:{memberId:string;nominal:true}[];context?:NotificationContext;includeActor?:boolean;actorName?:string}):Promise<void>;
  trace?: import('../../src/traceability.js').TraceabilityPort;
  /** MEETINGS owns target authorization/version/module availability, using the SAME ctx.c. */
  agenda?:MeetingAgendaCommandPort;
  guestAccess?:Pick<ModuleRuntime,"guestResourceIds"|"requireGuestResource">;
  /** Explicit role semantics from STRUCTURE; never infer lead-link from ADMIN/DECISION. */
  isLeadLink?(ctx: Ctx, input: {circleId:string;memberId:string}): Promise<boolean>;
  organizationalPolicy?(ctx: Ctx): Promise<OrganizationalGovernancePolicy | null>;
  applyField?(
    ctx: Ctx,
    input: {
      entityId: string;
      fieldId: string;
      baseVersion: number;
      value: unknown;
    },
  ): Promise<unknown>;
  membershipReasons?(
    ctx: Ctx,
    memberId: string,
  ): Promise<{ reasons: { circleId: string; capability: string }[] }>;
  createFromTension?(
    ctx: Ctx,
    input: {
      kind: "TASK" | "GOAL";
      title: string;
      circleId: string;
      tensionId: string;
      projectId?: string | null;
    },
  ): Promise<{ id: string }>;
  authorizeTensionTaskProject?(ctx: Ctx, projectId: string): Promise<void>;
  verifyTensionTaskProject?(ctx: Ctx, taskId: string, projectId: string, tensionId: string): Promise<void>;
  /** Same ctx.c transaction; validate final graph and versions before mutation. */
  applyStructure?(
    ctx: Ctx,
    input: {
      changes: Change[];
      proposalId: string;
      revision: number;
      branchId?: string;
    },
  ): Promise<unknown>;
  applyElection?(
    ctx: Ctx,
    input: {
      proposalId: string;
      revision: number;
      roleId: string;
      winnerId: string;
      mandateEnd: string;
    },
  ): Promise<unknown>;
}
export class Governance {
  constructor(
    readonly ctx: Ctx,
    readonly request: FastifyRequest,
    readonly ports: GovernancePorts = {},
  ) {}
  get c() {
    return this.ctx.c;
  }
  get org() {
    return this.ctx.org.id;
  }
  get actor() {
    return this.ctx.member.id;
  }
  owner() {
    if (this.isGuest() || this.ctx.member.org_role !== "OWNER") fail(403, "ACTION_DENIED");
  }
  writable(guestVote=false) {
    if (this.isGuest() && !guestVote) fail(403,"ACTION_DENIED");
    if (this.ctx.mode !== "write" && this.ctx.mode !== "authorization_write")
      fail(403, "READ_ONLY_TRANSACTION");
  }
  isGuest(){return this.ctx.member.member_type === "GUEST";}
  async guestIds(kind:string,action="read"):Promise<readonly string[]>{
    if (!this.ports.guestAccess) return [];
    return this.ports.guestAccess.guestResourceIds(this.ctx,{context:"governance",kind,action});
  }
  async hasGuestResource(kind:string,rid:string,action="read"){
    return this.isGuest() && (await this.guestIds(kind,action)).includes(rid);
  }
  async requireGuest(kind:string,rid:string,action="read"){
    if (!this.isGuest()) return;
    if (!this.ports.guestAccess) fail(404,"RESOURCE_NOT_FOUND");
    await this.ports.guestAccess!.requireGuestResource(this.ctx,{context:"governance",kind,id:rid},action);
  }
  async now() {
    return (await this.c.query("SELECT clock_timestamp() AS now")).rows[0]
      .now as Date;
  }
  async row(table: string, rid: string) {
    const kind=({gov_proposals:"proposal",gov_tensions:"tension",gov_documents:"agreement"} as Record<string,string>)[table];
    if (kind) await this.requireGuest(kind,id(rid));
    if (
      ![
        "gov_tensions",
        "gov_proposals",
        "gov_rounds",
        "gov_objections",
        "gov_documents",
        "gov_branches",
      ].includes(table)
    )
      throw Error("Internal table");
    const row = (
      await this.c.query(
        `SELECT * FROM ${table} WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [this.org, id(rid)],
      )
    ).rows[0];
    if (!row) fail(404, "RESOURCE_NOT_FOUND");
    if (
      table === "gov_proposals" &&
      await this.isDraftHidden(row)
    )
      fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  async draftAccessAllows(p: any) {
    if (p.author_id === this.actor || (p.kind === "ELECTION" && this.ctx.member.org_role === "OWNER")) return true;
    const access = (await this.effectivePolicy(p.circle_id)).draftAccess ?? "AUTHOR_ONLY";
    if (access === "CIRCLE_MEMBERS") return !!(await this.participates(p.circle_id));
    if (access === "AUTHOR_AND_LEAD_LINKS")
      return (await this.participates(p.circle_id)) && (await this.ports.isLeadLink?.(this.ctx,{circleId:p.circle_id,memberId:this.actor})) === true;
    return false;
  }
  async isDraftHidden(p: any) {
    if (!defaultDraftIsHidden(p,this.actor,this.ctx.member.org_role === "OWNER")) return false;
    if (await this.meetingConsentAuthority(p)) return false;
    return !(await this.draftAccessAllows(p));
  }
  async meetingConsentAuthority(p: any, allowDecided = false) {
    if (this.isGuest() || !(p.state === 'DRAFT' || (allowDecided && p.state === 'DECIDED')) || !['GOVERNANCE','DOCUMENT'].includes(p.kind) || !this.ports.meetingConsent) return null;
    if ((await this.effectivePolicy(p.circle_id)).decisionProcess !== 'HOLACRACY_O2') return null;
    return this.ports.meetingConsent(this.ctx,{proposalId:p.id,circleId:p.circle_id,revision:p.revision});
  }
  async meetingConsentRequired(p:any) {
    if (p.state !== 'DRAFT' || !['GOVERNANCE','DOCUMENT'].includes(p.kind) || !this.ports.holacracyMeetingOrigin) return false;
    const config = await this.effectivePolicy(p.circle_id);
    return config.decisionProcess === 'HOLACRACY_O2' && config.method !== 'CONSENT_WINDOW' &&
      await this.ports.holacracyMeetingOrigin(this.ctx,{proposalId:p.id,circleId:p.circle_id});
  }
  private async assertConsentScope(p:any, payload:any) {
    const rows = (await this.c.query(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM entities WHERE organization_id=$1 AND id=$2 AND kind='CIRCLE'
         UNION SELECT e.id FROM entities e JOIN subtree s ON e.parent_id=s.id WHERE e.organization_id=$1
       ) SELECT id FROM subtree`, [this.org,p.circle_id],
    )).rows;
    const allowed = new Set<string>(rows.map(row=>row.id));
    if (!allowed.has(p.circle_id)) fail(409,'CONSENT_SCOPE_CONFLICT');
    if (p.kind === 'DOCUMENT') {
      const document = (await this.c.query('SELECT owner_id FROM gov_documents WHERE organization_id=$1 AND id=$2',[this.org,payload.documentId])).rows[0];
      if (!document || !allowed.has(document.owner_id)) fail(409,'CONSENT_SCOPE_CONFLICT');
      return;
    }
    if (p.kind !== 'GOVERNANCE') fail(409,'CONSENT_SCOPE_CONFLICT');
    for (const part of (payload.documents ?? []) as DocumentPart[]) {
      const document = (await this.c.query('SELECT owner_id FROM gov_documents WHERE organization_id=$1 AND id=$2',[this.org,part.documentId])).rows[0];
      if (!document || !allowed.has(document.owner_id)) fail(409,'CONSENT_SCOPE_CONFLICT');
    }
    const pending = (payload.changes ?? []).filter((change:Change)=>change.kind==='CREATE');
    while (pending.length) {
      const index = pending.findIndex((change:Extract<Change,{kind:'CREATE'}>)=>allowed.has(change.parentCircleId));
      if (index < 0) fail(409,'CONSENT_SCOPE_CONFLICT');
      allowed.add(pending[index].entityId);
      pending.splice(index,1);
    }
    for (const change of (payload.changes ?? []) as Change[]) {
      if (!allowed.has(change.entityId) || (change.kind === 'MOVE' && !allowed.has(change.parentCircleId)))
        fail(409,'CONSENT_SCOPE_CONFLICT');
    }
  }
  async canEditProposal(p: any) {
    if (this.isGuest()) return false;
    if (!(await this.participates(p.circle_id))) return false;
    if (p.state === "DRAFT") return this.draftAccessAllows(p);
    return p.author_id === this.actor || this.ctx.member.org_role === "OWNER";
  }
  async canAmendProposal(p: any) {
    if (p.state !== 'DRAFT' || !['GOVERNANCE','DOCUMENT'].includes(p.kind)) return this.canEditProposal(p);
    if (await this.meetingConsentAuthority(p)) return true;
    if ((await this.effectivePolicy(p.circle_id)).decisionProcess === 'HOLACRACY_O2' &&
        await this.ports.holacracyMeetingOrigin?.(this.ctx,{proposalId:p.id,circleId:p.circle_id,runningOnly:true})) {
      return p.author_id === this.actor && await this.canEditProposal(p) &&
        !!await this.ports.trace?.meetingOrigin?.(this.ctx,'PROPOSAL',p.id);
    }
    return this.canEditProposal(p);
  }
  async entity(eid: string, kind?: string) {
    const e = (
      await this.c.query(
        "SELECT * FROM entities WHERE organization_id=$1 AND id=$2 AND NOT archived",
        [this.org, id(eid)],
      )
    ).rows[0];
    if (!e || (kind && e.kind !== kind)) fail(404, "RESOURCE_NOT_FOUND");
    return e;
  }
  async member(mid: string) {
    if (
      !(
        await this.c.query(
          "SELECT id FROM members WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
          [this.org, id(mid)],
        )
      ).rowCount
    )
      fail(404, "RESOURCE_NOT_FOUND");
  }
  async participates(circleId: string) {
    if (this.isGuest()) return false;
    await this.entity(circleId, "CIRCLE");
    const modeled = await this.ports.modelParticipation?.(this.ctx, circleId);
    if (typeof modeled === 'boolean') return modeled;
    if (this.ctx.member.org_role === "OWNER") return true;
    if (this.ports.membershipReasons)
      return (
        await this.ports.membershipReasons(this.ctx, this.actor)
      ).reasons.some(
        (reason) =>
          reason.circleId === circleId &&
          ["MEMBER", "DECISION", "ADMIN"].includes(reason.capability),
      );
    return !!(
      await this.c.query(
        `SELECT 1 FROM circle_memberships WHERE organization_id=$1 AND circle_id=$2 AND member_id=$3 AND starts_at<=clock_timestamp() AND (ends_at IS NULL OR ends_at>clock_timestamp()) UNION ALL SELECT 1 FROM occupancies o JOIN entities e ON e.organization_id=o.organization_id AND e.id=o.role_id WHERE o.organization_id=$1 AND e.parent_id=$2 AND o.member_id=$3 AND NOT e.archived AND o.starts_at<=clock_timestamp() AND (o.ends_at IS NULL OR o.ends_at>clock_timestamp())`,
        [this.org, circleId, this.actor],
      )
    ).rowCount;
  }
  async history(resource: string, action: string, snapshot: unknown) {
    const model=await this.ports.modelGovernancePolicy?.(this.ctx);
    if(model)snapshot={...(snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)?snapshot:{value:snapshot}),governanceModel:{packageId:model.packageId,packageVersion:model.packageVersion,revision:model.modelRevision}};
    const eventId=uuid();
    await this.c.query(
      "INSERT INTO gov_history(organization_id,id,resource_id,actor_id,action,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
      [
        this.org,
        eventId,
        resource,
        this.actor,
        action,
        JSON.stringify(snapshot),
      ],
    );
    return eventId;
  }
  private async notifyRound(event:'ProposalSubmitted'|'ProposalDecided'|'ConsentWindowOpened',eventId:string,p:any,electorate:string[],includeActor=false) {
    if(!this.ports.notifyProposal)return;
    const circle=(await this.c.query("SELECT name,archived FROM entities WHERE organization_id=$1 AND id=$2 AND kind='CIRCLE'",[this.org,p.circle_id])).rows[0];
    if(!circle||circle.archived)return; // The decision remains valid if its own perimeter was archived by the applier.
    const candidates=includeActor?[...new Set([...electorate,p.author_id])]:electorate;
    const members=(await this.c.query("SELECT * FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",[this.org,candidates])).rows;
    const recipients:{memberId:string;nominal:true}[]=[];
    for(const member of members){
      if(member.id===this.actor&&!includeActor)continue;
      const g=new Governance({...this.ctx,member},this.request,this.ports);
      const readable=g.isGuest()?await g.hasGuestResource('proposal',p.id,'read'):member.id===p.author_id||await g.participates(p.circle_id);
      if(readable)recipients.push({memberId:member.id,nominal:true});
    }
    const round = (await this.c.query("SELECT deadline FROM gov_rounds WHERE organization_id=$1 AND proposal_id=$2 AND revision=$3",[this.org,p.id,p.revision])).rows[0];
    const details: NonNullable<NotificationContext['details']> = [{key:'circle',value:circle.name}];
    if(round?.deadline)details.push({key:'deadline',value:new Date(round.deadline).toISOString()});
    if(p.verdict)details.push({key:'decision',value:p.verdict});
    if(event==='ProposalDecided'&&p.apply_state)details.push({key:'application',value:p.apply_state});
    await this.ports.notifyProposal(this.ctx,{eventId,event,proposalId:p.id,recipients,includeActor,...(includeActor?{actorName:'OrgMap'}:{}),context:{
      resourceTitle:p.title,
      ...(p.notificationReason&&!['ASYNC_OBJECTION_PENDING','ASYNC_NO_OBJECTIONS'].includes(p.notificationReason)?{excerpt:String(p.notificationReason).slice(0,1000)}:{}),
      details,
    }});
  }
  private async currentElectorate(p:any) {
    const electorate:string[]=[];
    const members=(await this.c.query("SELECT * FROM members WHERE organization_id=$1 AND status='ACTIVE' ORDER BY id",[this.org])).rows;
    for(const member of members) {
      const g=new Governance({...this.ctx,member},this.request,this.ports);
      const eligible=g.isGuest()
        ? await g.hasGuestResource('proposal',p.id,'read') && await g.hasGuestResource('proposal',p.id,'vote')
        : await g.participates(p.circle_id);
      if(eligible)electorate.push(member.id);
    }
    return electorate;
  }
  async tension(input: any) {
    this.writable();
    await this.entity(input.circleId, "CIRCLE");
    const description=tensionDescription(input);
    const row = (
      await this.c.query(
        "INSERT INTO gov_tensions(organization_id,id,author_id,circle_id,title,description,description_rich) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          this.org,
          uuid(),
          this.actor,
          input.circleId,
          text(input.title),
          description.description,
          description.descriptionRich,
        ],
      )
    ).rows[0];
    await this.history(row.id, "TensionCreated", row);
    return camel(row);
  }
  async endTension(tid: string) {
    this.writable();
    const t = await this.row("gov_tensions", tid);
    version(this.request, t.version);
    if (t.author_id !== this.actor) this.owner();
    if (
      (
        await this.c.query(
          "SELECT 1 FROM gov_proposals WHERE organization_id=$1 AND tension_id=$2 AND state IN ('DRAFT','REVIEW','ESCALATED')",
          [this.org, tid],
        )
      ).rowCount
    )
      fail(409, "ACTIVE_PROPOSAL");
    const row = (
      await this.c.query(
        "UPDATE gov_tensions SET state='CLOSED',version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
        [this.org, tid],
      )
    ).rows[0];
    await this.history(tid, "TensionClosed", row);
    return camel(row);
  }
  async effectivePolicy(circleId: string): Promise<Policy> {
    return (await this.policyResolution(circleId)).configuration;
  }
  async policyResolution(circleId: string) {
    await this.entity(circleId, "CIRCLE");
    const local = (await this.c.query(
      "SELECT configuration,version FROM gov_policies WHERE organization_id=$1 AND circle_id=$2",
      [this.org, circleId],
    )).rows[0];
    const organizational = await this.ports.organizationalPolicy?.(this.ctx);
    const orgDefault = organizational ? organizationalGovernancePolicy(organizational) : undefined;
    const packaged=await this.ports.modelGovernancePolicy?.(this.ctx);
    const packageDefault=packaged?policy({...defaultPolicy,...packaged.configuration}):defaultPolicy;
    const rootPolicy = (await this.c.query(
      `SELECT p.configuration FROM entities e LEFT JOIN gov_policies p ON p.organization_id=e.organization_id AND p.circle_id=e.id
       WHERE e.organization_id=$1 AND e.parent_id IS NULL`, [this.org],
    )).rows[0]?.configuration;
    const decisionProcess = local?.configuration?.decisionProcess ?? rootPolicy?.decisionProcess ?? packageDefault.decisionProcess ?? 'STANDARD';
    if (local) {
      const config = policy(local.configuration);
      if (organizational && !organizational.allowOverride && !samePolicy(config, orgDefault!))
        fail(409, "GOVERNANCE_POLICY_RECONCILIATION_REQUIRED");
      return { configuration: policy({...config,decisionProcess}), policySource: "LOCAL", packageSource:packaged??null, allowOverride: organizational?.allowOverride ?? true, localVersion:local.version as number, leadLinkAccessAvailable:!!this.ports.isLeadLink };
    }
    return { configuration: policy({...packageDefault,...(orgDefault?{method:orgDefault.method}:{}),decisionProcess}), policySource: organizational ? "ORGANIZATION" : packaged ? "PACKAGE" : "DOMAIN", packageSource:packaged??null, allowOverride: organizational?.allowOverride ?? true, leadLinkAccessAvailable:!!this.ports.isLeadLink };
  }
  async authorizePolicy(input: any) {
    this.owner();
    await this.entity(input.circleId, "CIRCLE");
    const config = policy(input.configuration);
    if (config.draftAccess === "AUTHOR_AND_LEAD_LINKS" && !this.ports.isLeadLink)
      fail(503,"DRAFT_LEAD_LINK_SERVICE_REQUIRED");
    const organizational = await this.ports.organizationalPolicy?.(this.ctx);
    const orgDefault = organizational ? organizationalGovernancePolicy(organizational) : undefined;
    if (organizational && !organizational.allowOverride && !samePolicy(config, orgDefault!))
      fail(409, "GOVERNANCE_OVERRIDE_DENIED");
    return config;
  }
  async setPolicy(input: any) {
    this.writable();
    const config = await this.authorizePolicy(input);
    const old = (
      await this.c.query(
        "SELECT * FROM gov_policies WHERE organization_id=$1 AND circle_id=$2",
        [this.org, input.circleId],
      )
    ).rows[0];
    if (old) version(this.request, old.version);
    const row = (
      await this.c.query(
        "INSERT INTO gov_policies(organization_id,id,circle_id,configuration) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,circle_id) DO UPDATE SET configuration=EXCLUDED.configuration,version=gov_policies.version+1 RETURNING *",
        [this.org, uuid(), input.circleId, config],
      )
    ).rows[0];
    await this.history(row.id, "GovernancePolicyChanged", row);
    return camel(row);
  }
  async branch(input: any) {
    this.writable();
    this.owner();
    const list = await this.validateChanges(input.changes);
    const row = (
      await this.c.query(
        "INSERT INTO gov_branches(organization_id,id,author_id,title,changes,base_structure_revision) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          this.org,
          uuid(),
          this.actor,
          text(input.title),
          JSON.stringify(list),
          this.ctx.org.structure_revision,
        ],
      )
    ).rows[0];
    await this.history(row.id, "BranchCreated", row);
    return camel(row);
  }
  /** A restriction part resolves to a pinned document revision (publish) or an archive instruction. */
  private async validateDocumentPart(input: any, circleId: string, amendableVersions?:Map<string,number>): Promise<DocumentPart> {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail(400, "INVALID_REQUEST");
    if (input.newDocument) {
      if (Object.keys(input).some((k) => k !== "newDocument"))
        fail(400, "INVALID_REQUEST");
      const d = await this.document({...input.newDocument,ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION'});
      return {documentId:d.id,documentVersion:d.draftVersion};
    }
    if (input.documentRevision) {
      if (Object.keys(input).some((k) => k !== "documentRevision"))
        fail(400, "INVALID_REQUEST");
      const change=input.documentRevision, existing=await this.documentRow(change.documentId);
      if(existing.archived || existing.visibility!=='ORGANIZATION' || (existing.workflow!=='GOVERNANCE' && !(await this.circleDocument(existing))))fail(409,'STATE_CONFLICT');
      // Proposal amendment authority includes its pinned drafts, as in legacy
      // DOCUMENT amendments. It does not grant general document editing rights.
      if (amendableVersions?.has(existing.id)) {
        if (existing.version!==change.version || existing.draft_version!==amendableVersions.get(existing.id)) fail(409,'VERSION_CONFLICT');
        await this.activeDocumentType(existing);
        await this.ports.validateModelDocument?.(this.ctx,{circleId,documentId:existing.id});
        const value=agreementContent({richContent:change.richContent},true);
        if (!value.content.trim()) fail(422,'DOCUMENT_CONTENT_REQUIRED');
        const number=await this.appendDocumentDraft(existing,value);
        await this.history(existing.id,'Documentdraft',{...existing,draft_version:number,version:existing.version+1});
        return {documentId:existing.id,documentVersion:number};
      }
      const scopedRequest={...this.request,headers:{...this.request.headers,'if-match':`"${change.version}"`}} as FastifyRequest;
      const revised=await new Governance(this.ctx,scopedRequest,this.ports).documentAction(change.documentId,'draft',{richContent:change.richContent});
      return {documentId:revised.id,documentVersion:revised.draftVersion};
    }
    if (
      Object.keys(input).some(
        (k) => !["documentId", "documentVersion", "documentAction", "documentBaseVersion"].includes(k),
      )
    )
      fail(400, "INVALID_REQUEST");
    const archive = input.documentAction === "ARCHIVE";
    if (input.documentAction !== undefined && !archive || !archive && input.documentBaseVersion !== undefined || archive && (!Number.isInteger(input.documentBaseVersion) || input.documentBaseVersion < 1)) fail(400, "INVALID_REQUEST");
    const d = await this.documentRow(input.documentId);
    await this.activeDocumentType(d);
    if (
      d.archived ||
      d.visibility !== "ORGANIZATION" ||
      (d.workflow !== "GOVERNANCE" && !(await this.circleDocument(d)))
    )
      fail(422, "DOMAIN_INVARIANT");
    if (
      !Number.isInteger(input.documentVersion) ||
      (
        await this.c.query(
          "SELECT 1 FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2 AND number=$3",
          [this.org, d.id, input.documentVersion],
        )
      ).rowCount !== 1
    )
      fail(404, "RESOURCE_NOT_FOUND");
    if (archive) {
      if (d.version !== input.documentBaseVersion) fail(409, "VERSION_CONFLICT");
      if (d.published_version === null || d.published_version !== input.documentVersion) fail(409, "DOCUMENT_REVISION_CONFLICT");
      return {documentId:d.id,documentVersion:input.documentVersion,documentAction:"ARCHIVE",documentBaseVersion:input.documentBaseVersion};
    }
    return { documentId: d.id, documentVersion: input.documentVersion };
  }
  async validateDocumentParts(value: unknown, circleId: string, amendableVersions?:Map<string,number>): Promise<DocumentPart[]> {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20)
      fail(400, "INVALID_REQUEST");
    const parts: DocumentPart[] = [], seen = new Set<string>();
    for (const item of value as any[]) {
      const part = await this.validateDocumentPart(item, circleId, amendableVersions);
      if (seen.has(part.documentId)) fail(422, "DUPLICATE_ENTITY_CHANGE");
      seen.add(part.documentId);
      parts.push(part);
    }
    return parts;
  }
  async payload(kind: string, payload: any, circleId: string, amendableVersions?:Map<string,number>) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      fail(400, "INVALID_REQUEST");
    // Existing DOCUMENT proposals retain their revision contract when amended.
    // New proposal requests are normalized to GOVERNANCE.
    if (kind === "DOCUMENT") return this.validateDocumentPart(payload, circleId);
    if (kind === "GOVERNANCE") {
      if (Object.keys(payload).some((k) => !["changes","documents"].includes(k)))
        fail(400, "INVALID_REQUEST");
      const structural = payload.changes === undefined ? [] : await this.validateChanges(payload.changes);
      const documents = payload.documents === undefined ? [] : await this.validateDocumentParts(payload.documents, circleId, amendableVersions);
      if (!structural.length && !documents.length) fail(400, "INVALID_REQUEST");
      const result: any = {};
      if (structural.length) result.changes = structural;
      if (documents.length) result.documents = documents;
      return result;
    }
    if (kind === "ELECTION") {
      if (
        Object.keys(payload).some(
          (k) => !["roleId", "winnerId", "mandateEnd"].includes(k),
        )
      )
        fail(400, "INVALID_REQUEST");
      await this.entity(payload.roleId, "ROLE");
      if (payload.winnerId) {
        this.owner();
        await this.member(payload.winnerId);
      }
      if (
        typeof payload.mandateEnd !== "string" ||
        !Number.isFinite(Date.parse(payload.mandateEnd)) ||
        Date.parse(payload.mandateEnd) <= Date.now()
      )
        fail(422, "DOMAIN_INVARIANT");
      return {
        roleId: payload.roleId,
        winnerId: payload.winnerId ?? null,
        mandateEnd: new Date(payload.mandateEnd).toISOString(),
      };
    }
    fail(400, "INVALID_REQUEST");
  }
  async validateChanges(value: unknown) {
    const list = changes(value),
      created = new Map(
        list
          .filter(
            (c): c is Extract<Change, { kind: "CREATE" }> =>
              c.kind === "CREATE",
          )
          .map((c) => [c.entityId, c]),
      );
    if (created.size !== list.filter((c) => c.kind === "CREATE").length)
      fail(422, "DUPLICATE_ENTITY_CHANGE");
    for (const change of list) {
      if (change.kind !== "CREATE") {
        if (change.kind === "RESTORE") {
          if (
            !(
              await this.c.query(
                "SELECT 1 FROM entities WHERE organization_id=$1 AND id=$2",
                [this.org, change.entityId],
              )
            ).rowCount
          )
            fail(404, "RESOURCE_NOT_FOUND");
        } else await this.entity(change.entityId);
      }
      if (change.kind === "CREATE" || change.kind === "MOVE") {
        const parent = created.get(change.parentCircleId);
        if (parent) {
          if (parent.entityKind !== "CIRCLE") fail(422, "INVALID_PARENT");
        } else await this.entity(change.parentCircleId, "CIRCLE");
      }
    }
    return list;
  }
  async proposal(input: any) {
    this.writable();
    await this.entity(input.circleId, "CIRCLE");
    if (input.newTension && input.tensionId) fail(422, "INVALID_REQUEST");
    if (input.tensionRevision && (!input.tensionId || input.newTension)) fail(422, "INVALID_REQUEST");
    if (input.newTension) {
      const source = await this.tension({...input.newTension,circleId:input.circleId});
      input = {...input,tensionId:source.id};
    }
    // A legacy single-restriction input becomes a governance proposal with one document part.
    if (input.kind === 'DOCUMENT') {
      if (input.payload && (input.newDocument || input.documentRevision)) fail(422,'INVALID_REQUEST');
      if (input.newDocument && input.documentRevision) fail(422,'INVALID_REQUEST');
      const part = input.payload ?? (input.newDocument ? {newDocument:input.newDocument} : input.documentRevision ? {documentRevision:input.documentRevision} : undefined);
      if (!part) fail(422,'INVALID_REQUEST');
      input = {...input,kind:'GOVERNANCE',payload:{documents:[part]},newDocument:undefined,documentRevision:undefined};
    }
    if (input.newDocument || input.documentRevision) fail(422,'INVALID_REQUEST');
    if (input.tensionId) {
      const t = await this.row("gov_tensions", input.tensionId);
      if (t.author_id !== this.actor) fail(403, "ACTION_DENIED");
      if (t.state === "CLOSED" || t.circle_id !== input.circleId)
        fail(409, "STATE_CONFLICT");
      if (input.tensionRevision) {
        if (t.version !== input.tensionRevision.version) fail(409, "VERSION_CONFLICT");
        if (t.description.trim()) fail(409, "TENSION_DESCRIPTION_EXISTS");
        const description = tensionDescription({descriptionRich:input.tensionRevision.descriptionRich});
        if (!description.description.trim()) fail(422, "TENSION_DESCRIPTION_REQUIRED");
        const revised = (await this.c.query(
          "UPDATE gov_tensions SET description=$3,description_rich=$4,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [this.org,t.id,description.description,description.descriptionRich],
        )).rows[0];
        await this.history(t.id, "TensionDescriptionCompleted", revised);
      }
    }
    let payload = input.payload;
    if (input.branchId) {
      const b = await this.row("gov_branches", input.branchId);
      if (b.author_id !== this.actor) this.owner();
      if (b.state !== "OPEN" || input.kind !== "GOVERNANCE")
        fail(409, "STATE_CONFLICT");
      payload = { changes: b.changes };
    }
    payload = await this.payload(input.kind, payload, input.circleId);
    if (input.kind === 'ELECTION') await this.ports.validateModelElection?.(this.ctx, {circleId:input.circleId,...payload});
    if (input.kind === 'GOVERNANCE') {
      if ((payload as any).changes) await this.ports.validateModelChanges?.(this.ctx, {circleId:input.circleId,changes:(payload as any).changes});
      for (const part of (payload as any).documents ?? []) await this.ports.validateModelDocument?.(this.ctx,{circleId:input.circleId,documentId:part.documentId});
    }
    const pid = uuid();
    const row = (
      await this.c.query(
        "INSERT INTO gov_proposals(organization_id,id,circle_id,author_id,tension_id,branch_id,title,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          this.org,
          pid,
          input.circleId,
          this.actor,
          input.tensionId ?? null,
          input.branchId ?? null,
          text(input.title),
          input.kind,
        ],
      )
    ).rows[0];
    await this.c.query(
      "INSERT INTO gov_revisions(organization_id,proposal_id,number,payload) VALUES($1,$2,1,$3)",
      [this.org, pid, payload],
    );
    if (input.tensionId)
      await this.c.query(
        "UPDATE gov_tensions SET state='PROCESSED',version=version+1 WHERE organization_id=$1 AND id=$2",
        [this.org, input.tensionId],
      );
    await this.history(pid, "ProposalCreated", row);
    return camel(row);
  }
  async amend(pid: string, input: any) {
    this.writable();
    const p = await this.row("gov_proposals", pid);
    version(this.request, p.version);
    if (!(await this.canAmendProposal(p))) fail(403,"ACTION_DENIED");
    if (p.state === "WITHDRAWN" || p.apply_state === "APPLIED" || (input.draftOnly && p.state !== 'DRAFT'))
      fail(409, "STATE_CONFLICT");
    let nextPayload = input.payload;
    if (p.kind === 'DOCUMENT' && !input.documentRevision && !(await this.canEditProposal(p))) fail(403,'ACTION_DENIED');
    if (input.documentRevision) {
      if (p.kind !== 'DOCUMENT' || p.state !== 'DRAFT' || input.payload) fail(422,'INVALID_REQUEST');
      const current = (await this.c.query('SELECT payload FROM gov_revisions WHERE organization_id=$1 AND proposal_id=$2 AND number=$3',[this.org,p.id,p.revision])).rows[0].payload;
      const change = input.documentRevision;
      if (current.documentAction === 'ARCHIVE' || current.documentId !== id(change.documentId)) fail(422,'INVALID_REQUEST');
      const document = await this.documentRow(current.documentId);
      if (document.archived || document.visibility !== 'ORGANIZATION' || (document.workflow !== 'GOVERNANCE' && !(await this.circleDocument(document)))) fail(409,'STATE_CONFLICT');
      if (document.version !== change.version || document.draft_version !== current.documentVersion) fail(409,'VERSION_CONFLICT');
      await this.activeDocumentType(document);
      await this.ports.validateModelDocument?.(this.ctx,{circleId:p.circle_id,documentId:document.id});
      const value = agreementContent({richContent:change.richContent},true);
      if (!value.content.trim()) fail(422,'DOCUMENT_CONTENT_REQUIRED');
      const number = await this.appendDocumentDraft(document,value);
      await this.history(document.id,'Documentdraft',{...document,draft_version:number,version:document.version+1});
      nextPayload = {documentId:document.id,documentVersion:number};
    }
    const currentPayload = p.kind==='GOVERNANCE' && p.state==='DRAFT'
      ? (await this.c.query('SELECT payload FROM gov_revisions WHERE organization_id=$1 AND proposal_id=$2 AND number=$3',[this.org,p.id,p.revision])).rows[0]?.payload : null;
    const amendableVersions = currentPayload ? new Map<string,number>((currentPayload.documents??[])
      .filter((part:DocumentPart)=>part.documentAction!=='ARCHIVE').map((part:DocumentPart)=>[part.documentId,part.documentVersion])) : undefined;
    const payload = await this.payload(p.kind, nextPayload, p.circle_id, amendableVersions);
    if (p.kind === 'ELECTION') await this.ports.validateModelElection?.(this.ctx, {circleId:p.circle_id,roleId:(payload as any).roleId,winnerId:(payload as any).winnerId,mandateEnd:(payload as any).mandateEnd});
    if (p.kind === 'DOCUMENT') await this.ports.validateModelDocument?.(this.ctx,{circleId:p.circle_id,documentId:(payload as any).documentId});
    if (p.kind === 'GOVERNANCE') {
      if ((payload as any).changes) await this.ports.validateModelChanges?.(this.ctx, {circleId:p.circle_id,changes:(payload as any).changes});
      for (const part of (payload as any).documents ?? []) await this.ports.validateModelDocument?.(this.ctx,{circleId:p.circle_id,documentId:part.documentId});
    }
    await this.c.query(
      "UPDATE gov_rounds SET state='SUPERSEDED' WHERE organization_id=$1 AND proposal_id=$2 AND state='OPEN'",
      [this.org, pid],
    );
    await this.c.query(
      "INSERT INTO gov_revisions(organization_id,proposal_id,number,payload) VALUES($1,$2,$3,$4)",
      [this.org, pid, p.revision + 1, payload],
    );
    const row = (
      await this.c.query(
        "UPDATE gov_proposals SET revision=revision+1,version=version+1,state='DRAFT',verdict=null,apply_state='PENDING' WHERE organization_id=$1 AND id=$2 RETURNING *",
        [this.org, pid],
      )
    ).rows[0];
    await this.history(pid, "ProposalRevised", row);
    return camel(row);
  }
  async submit(pid: string, input: {reviewDurationHours?:number} = {}) {
    this.writable();
    const p = await this.row("gov_proposals", pid);
    version(this.request, p.version);
    if (!(await this.canEditProposal(p))) fail(403,"ACTION_DENIED");
    if (p.state !== "DRAFT") fail(409, "STATE_CONFLICT");
    if (await this.meetingConsentRequired(p)) fail(409,'MEETING_CONSENT_REQUIRED');
    const payload = (
      await this.c.query(
        "SELECT payload FROM gov_revisions WHERE organization_id=$1 AND proposal_id=$2 AND number=$3",
        [this.org, pid, p.revision],
      )
    ).rows[0].payload;
    if (p.kind === "ELECTION" && !payload.winnerId)
      fail(422, "ELECTION_CANDIDATE_REQUIRED");
    const resolution = await this.policyResolution(p.circle_id);
    const baseConfig = resolution.configuration;
    if (input.reviewDurationHours !== undefined && (!Number.isFinite(input.reviewDurationHours) || input.reviewDurationHours <= 0 || input.reviewDurationHours > 8760)) fail(422,'INVALID_REQUEST');
    if (input.reviewDurationHours !== undefined && baseConfig.method !== 'CONSENT_WINDOW' && !resolution.allowOverride) fail(409,'GOVERNANCE_OVERRIDE_DENIED');
    // An explicit response period selects asynchronous conduction for this round only.
    // The circle policy and immutable snapshots of earlier rounds remain unchanged.
    const config = input.reviewDurationHours === undefined ? baseConfig : {...baseConfig,method:'CONSENT_WINDOW' as const,reviewDurationHours:input.reviewDurationHours};
    const organicAsync = config.decisionProcess === 'HOLACRACY_O2' && config.method === 'CONSENT_WINDOW' && ['GOVERNANCE','DOCUMENT'].includes(p.kind);
    if (organicAsync) await this.assertConsentScope(p,payload);
    if (organicAsync && (!this.ports.scheduleConsent || !this.ports.consentDistributionReady || !this.ports.notifyProposal))
      fail(503, 'CONSENT_AUTOMATION_UNAVAILABLE');
    const electorate = await this.currentElectorate(p);
    if (!electorate.length) fail(422, "EMPTY_ELECTORATE");
    const round = (
      await this.c.query(
        `INSERT INTO gov_rounds(organization_id,id,proposal_id,revision,policy,electorate,deadline,step) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN clock_timestamp()+$8*interval '1 hour' ELSE NULL END,$9) RETURNING *`,
        [
          this.org,
          uuid(),
          pid,
          p.revision,
          config,
          electorate,
          config.method === "CONSENT_WINDOW" && !organicAsync,
          config.reviewDurationHours,
          organicAsync ? config.workflowSteps.at(-1) : config.workflowSteps[0],
        ],
      )
    ).rows[0];
    const row = (
      await this.c.query(
        "UPDATE gov_proposals SET state='REVIEW',version=version+1,first_submitted_at=coalesce(first_submitted_at,clock_timestamp()) WHERE organization_id=$1 AND id=$2 RETURNING *",
        [this.org, pid],
      )
    ).rows[0];
    const eventId=await this.history(pid, "ProposalSubmitted", { proposal: row, round });
    await this.notifyRound('ProposalSubmitted',eventId,row,round.electorate);
    if (organicAsync) await this.ports.scheduleConsent!(this.ctx);
    return { proposal: camel(row), round: camel(round) };
  }
  async roundFor(pid: string) {
    const p = await this.row("gov_proposals", pid);
    const r = (
      await this.c.query(
        "SELECT * FROM gov_rounds WHERE organization_id=$1 AND proposal_id=$2 AND revision=$3 FOR UPDATE",
        [this.org, pid, p.revision],
      )
    ).rows[0];
    if (!r || p.state !== "REVIEW") fail(409, "STATE_CONFLICT");
    return { p, r };
  }
  async escalate(pid: string, input: any) {
    this.writable(true);
    await this.requireGuest("proposal", pid, "vote");
    const { p, r } = await this.roundFor(pid);
    version(this.request, p.version);
    if (r.policy.method !== "CONSENT_WINDOW" || !r.deadline)
      fail(409, "STATE_CONFLICT");
    mayVote(r, this.actor, await this.now());
    const reason = text(input.reason, 10000);
    const prior = await this.c.query(
      "SELECT 1 FROM gov_ballots WHERE organization_id=$1 AND round_id=$2 AND member_id=$3 LIMIT 1",
      [this.org, r.id, this.actor],
    );
    if (prior.rowCount && !policy(r.policy).allowRevote) fail(409, "ALREADY_VOTED");
    await this.c.query(
      "UPDATE gov_rounds SET state='INTERRUPTED' WHERE organization_id=$1 AND id=$2",
      [this.org, r.id],
    );
    const row = (await this.c.query(
      "UPDATE gov_proposals SET state='ESCALATED',version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
      [this.org, pid],
    )).rows[0];
    await this.history(pid, "ProposalEscalated", { roundId:r.id, revision:p.revision, reason, deadline:r.deadline });
    return camel(row);
  }
  async vote(pid: string, input: any) {
    this.writable(true);
    await this.requireGuest("proposal",pid,"vote");
    const { p, r } = await this.roundFor(pid);
    version(this.request, p.version);
    if (r.policy.decisionProcess === 'HOLACRACY_O2' && r.policy.method === 'CONSENT_WINDOW' && ['GOVERNANCE','DOCUMENT'].includes(p.kind) && !r.deadline)
      fail(409, 'CONSENT_DISTRIBUTION_PENDING');
    mayVote(r, this.actor, await this.now());
    const config = policy(r.policy);
    if (
      !["CONSENT", "ABSTAIN", "OBJECT"].includes(input.choice) ||
      (input.choice === "ABSTAIN" && !config.allowAbstain)
    )
      fail(422, "DOMAIN_INVARIANT");
    const prior =
      (
        await this.c.query(
          "SELECT max(number) AS n FROM gov_ballots WHERE organization_id=$1 AND round_id=$2 AND member_id=$3",
          [this.org, r.id, this.actor],
        )
      ).rows[0].n ?? 0;
    if (prior && !config.allowRevote) fail(409, "ALREADY_VOTED");
    const rationale = optionalText(input.rationale);
    if (input.choice === "OBJECT" && !rationale.trim())
      fail(422, "OBJECTION_REASON_REQUIRED");
    await this.c.query(
      "INSERT INTO gov_ballots(organization_id,round_id,member_id,number,choice,rationale) VALUES($1,$2,$3,$4,$5,$6)",
      [this.org, r.id, this.actor, prior + 1, input.choice, rationale],
    );
    if (input.choice === "OBJECT")
      await this.c.query(
        "INSERT INTO gov_objections(organization_id,id,round_id,author_id,rationale) VALUES($1,$2,$3,$4,$5)",
        [this.org, uuid(), r.id, this.actor, rationale],
      );
    await this.history(pid, "BallotRecorded", {
      roundId: r.id,
      memberId: this.actor,
      number: prior + 1,
      choice: input.choice,
    });
    return { roundId: r.id, number: prior + 1, choice: input.choice };
  }
  async objection(oid: string, input: any) {
    this.writable();
    const o = await this.row("gov_objections", oid);
    version(this.request, o.version);
    const r = await this.row("gov_rounds", o.round_id);
    if (r.state !== "OPEN") fail(409, "STATE_CONFLICT");
    if (!(input.state === "WITHDRAWN" && o.author_id === this.actor))
      this.owner();
    if (
      !["TESTING", "VALID", "INTEGRATED", "INVALID", "WITHDRAWN"].includes(
        input.state,
      ) ||
      ["INTEGRATED", "INVALID", "WITHDRAWN"].includes(o.state)
    )
      fail(409, "STATE_CONFLICT");
    const row = (
      await this.c.query(
        "UPDATE gov_objections SET state=$3,resolution=$4,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
        [this.org, oid, input.state, text(input.reason, 10000)],
      )
    ).rows[0];
    await this.history(oid, "ObjectionReviewed", row);
    return camel(row);
  }
  async decide(pid: string, input: any) {
    this.writable();
    this.owner();
    const { p, r } = await this.roundFor(pid);
    version(this.request, p.version);
    if (r.policy.decisionProcess === 'HOLACRACY_O2' && r.policy.method === 'CONSENT_WINDOW' && ['GOVERNANCE','DOCUMENT'].includes(p.kind))
      fail(409, 'AUTOMATIC_CONSENT_REQUIRED');
    if (r.step !== r.policy.workflowSteps.at(-1))
      fail(409, "WORKFLOW_INCOMPLETE");
    const reason = text(input.reason, 10000);
    const participation = Number(
      (
        await this.c.query(
          "SELECT count(DISTINCT member_id) AS n FROM gov_ballots WHERE organization_id=$1 AND round_id=$2",
          [this.org, r.id],
        )
      ).rows[0].n,
    );
    const objections = Number(
      (
        await this.c.query(
          "SELECT count(*) AS n FROM gov_objections WHERE organization_id=$1 AND round_id=$2 AND state IN ('RAISED','TESTING','VALID')",
          [this.org, r.id],
        )
      ).rows[0].n,
    );
    let result: string = verdict(
      r,
      participation,
      objections,
      await this.now(),
    );
    if (r.policy.method === "MANUAL_FACILITATED") {
      if (!["ADOPT", "REJECT", "REVIEW_REQUIRED"].includes(input.verdict))
        fail(400, "INVALID_REQUEST");
      if (input.verdict === "ADOPT" && result !== "ADOPT")
        fail(409, "CONSENT_REQUIREMENTS_UNMET");
      result = input.verdict;
    }
    await this.c.query(
      "UPDATE gov_rounds SET state='CLOSED',decision_reason=$3 WHERE organization_id=$1 AND id=$2",
      [this.org, r.id, reason],
    );
    const row = (
      await this.c.query(
        "UPDATE gov_proposals SET state='DECIDED',verdict=$3,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
        [this.org, pid, result],
      )
    ).rows[0];
    const eventId=await this.history(pid, "ProposalDecided", { ...row, reason });
    await this.notifyRound('ProposalDecided',eventId,{...row,notificationReason:reason},r.electorate);
    return camel(row);
  }
  async recordMeetingConsent(pid: string, input: any) {
    this.writable();
    const p = await this.row('gov_proposals', pid);
    version(this.request, p.version);
    const authority = await this.meetingConsentAuthority(p);
    if (!authority) fail(403, 'ACTION_DENIED');
    if (authority!.ready === false) fail(409, 'INTEGRATIVE_PROCESS_REQUIRED');
    if (input.confirmed !== true) fail(400, 'CONSENT_CONFIRMATION_REQUIRED');
    if (input.revision !== p.revision) fail(409, 'VERSION_CONFLICT');
    if (input.meetingVersion !== authority!.meetingVersion) fail(409, 'VERSION_CONFLICT');
    const reason = text(input.reason, 10000);
    const row = (await this.c.query(
      "UPDATE gov_proposals SET state='DECIDED',verdict='ADOPT',version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
      [this.org, pid],
    )).rows[0];
    const decisionEvent=await this.history(pid, 'ProposalDecided', { ...row, reason, revision:p.revision, meetingId:authority!.meetingId, source:'MEETING_CONSENT' });
    const electorate = await this.currentElectorate(row);
    if(!electorate.includes(row.author_id))electorate.push(row.author_id);
    const application = await this.applyApproved(pid, row, true);
    const proposal = await this.row('gov_proposals', pid);
    await this.notifyRound('ProposalDecided',decisionEvent,{...proposal,notificationReason:reason},electorate);
    return { ...application, proposal:camel(proposal) };
  }
  /** Called by the scoped worker, never from a user-selected approval endpoint. */
  async processAsyncConsent(pid:string, eventId:string) {
    this.writable();
    const {p,r} = await this.roundFor(pid);
    const config = policy(r.policy);
    if (config.decisionProcess !== 'HOLACRACY_O2' || config.method !== 'CONSENT_WINDOW' || !['GOVERNANCE','DOCUMENT'].includes(p.kind)) return false;
    const submitted = (await this.c.query(
      `SELECT actor_id FROM gov_history WHERE organization_id=$1 AND id=$2 AND resource_id=$3 AND action='ProposalSubmitted' AND snapshot->'round'->>'id'=$4`,
      [this.org,id(eventId),pid,r.id],
    )).rows[0];
    if (!submitted || submitted.actor_id !== this.actor || !(await this.participates(p.circle_id))) fail(403,'ACTION_DENIED');
    if (!this.ports.scheduleConsent || !this.ports.consentDistributionReady) fail(503,'CONSENT_AUTOMATION_UNAVAILABLE');
    const now = await this.now();
    if (!r.deadline) {
      const ready = await this.ports.consentDistributionReady!(this.ctx,{eventId,proposalId:p.id,electorate:r.electorate,submitterId:submitted.actor_id});
      if (!ready) {
        await this.notifyRound('ProposalSubmitted',eventId,p,r.electorate);
        await this.ports.scheduleConsent!(this.ctx,new Date(now.getTime()+5*60_000));
        return false;
      }
      const deadline = (await this.c.query(
        "UPDATE gov_rounds SET deadline=clock_timestamp()+$3*interval '1 hour' WHERE organization_id=$1 AND id=$2 RETURNING deadline",
        [this.org,r.id,config.reviewDurationHours],
      )).rows[0].deadline as Date;
      const opened = await this.history(pid,'ConsentWindowOpened',{roundId:r.id,revision:p.revision,deadline:deadline.toISOString(),source:'ASYNC_CONSENT'});
      await this.notifyRound('ConsentWindowOpened',opened,p,r.electorate,true);
      await this.ports.scheduleConsent!(this.ctx,deadline);
      return true;
    }
    if (new Date(r.deadline).getTime() > now.getTime()) {
      await this.ports.scheduleConsent!(this.ctx,new Date(r.deadline));
      return false;
    }
    const objections = Number((await this.c.query(
      "SELECT count(*) AS n FROM gov_objections WHERE organization_id=$1 AND round_id=$2 AND state IN ('RAISED','TESTING','VALID')",
      [this.org,r.id],
    )).rows[0].n);
    const result = objections ? 'REVIEW_REQUIRED' : 'ADOPT';
    const reason = objections ? 'ASYNC_OBJECTION_PENDING' : 'ASYNC_NO_OBJECTIONS';
    await this.c.query("UPDATE gov_rounds SET state='CLOSED',decision_reason=$3 WHERE organization_id=$1 AND id=$2",[this.org,r.id,reason]);
    const row = (await this.c.query(
      "UPDATE gov_proposals SET state='DECIDED',verdict=$3,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
      [this.org,pid,result],
    )).rows[0];
    const decisionEvent = await this.history(pid,'ProposalDecided',{...row,reason,revision:p.revision,source:'ASYNC_CONSENT',roundId:r.id});
    if (result === 'ADOPT') await this.applyApproved(pid,row,true);
    const notified = await this.row('gov_proposals',pid);
    await this.notifyRound('ProposalDecided',decisionEvent,{...notified,notificationReason:reason},r.electorate,true);
    return true;
  }
  async apply(pid: string) {
    this.writable();
    this.owner();
    const p = await this.row("gov_proposals", pid);
    version(this.request, p.version);
    const organicDecision = !!(await this.c.query(
      `SELECT 1 FROM gov_history WHERE organization_id=$1 AND resource_id=$2 AND action='ProposalDecided'
       AND snapshot->>'source' IN ('MEETING_CONSENT','ASYNC_CONSENT') AND snapshot->>'revision'=$3 LIMIT 1`,
      [this.org,pid,String(p.revision)],
    )).rowCount;
    return this.applyApproved(pid, p, organicDecision);
  }
  /** Apply a previously authorized decision within the caller's transaction. */
  private async applyApproved(pid: string, p: any, recordValidationConflict = false) {
    if (
      p.state !== "DECIDED" ||
      p.verdict !== "ADOPT" ||
      p.apply_state === "APPLIED"
    )
      fail(409, "STATE_CONFLICT");
    const payload = (
      await this.c.query(
        "SELECT payload FROM gov_revisions WHERE organization_id=$1 AND proposal_id=$2 AND number=$3",
        [this.org, pid, p.revision],
      )
    ).rows[0].payload;
    await this.c.query("SAVEPOINT governance_apply");
    try {
      if (p.kind === 'GOVERNANCE') {
        if (payload.changes?.length) await this.ports.validateModelChanges?.(this.ctx,{circleId:p.circle_id,changes:payload.changes});
        for (const part of payload.documents ?? []) await this.ports.validateModelDocument?.(this.ctx,{circleId:p.circle_id,documentId:part.documentId});
      }
      if (p.kind === 'DOCUMENT') await this.ports.validateModelDocument?.(this.ctx,{circleId:p.circle_id,documentId:payload.documentId});
      if (recordValidationConflict) await this.assertConsentScope(p,payload);
      let outcome: unknown;
      if (p.kind === "GOVERNANCE") {
        const structural = (payload.changes ?? []).filter(
            (c: Change) => c.kind !== "FIELD",
          ),
          fields = (payload.changes ?? []).filter((c: Change) => c.kind === "FIELD");
        if (structural.length && !this.ports.applyStructure)
          fail(503, "STRUCTURE_APPLIER_REQUIRED");
        if (fields.length && !this.ports.applyField)
          fail(503, "FIELD_APPLIER_REQUIRED");
        const structure = structural.length
          ? await this.ports.applyStructure!(this.ctx, {
              changes: structural,
              proposalId: pid,
              revision: p.revision,
              branchId: p.branch_id ?? undefined,
            })
          : null;
        const values = [];
        for (const field of fields)
          values.push(await this.ports.applyField!(this.ctx, field));
        const documents = [];
        for (const part of payload.documents ?? [])
          documents.push(await this.applyDocumentPart(part, pid, p.revision));
        outcome = { structure, fields: values, documents };
        await this.c.query(
          "UPDATE organizations SET structure_revision=structure_revision+1 WHERE id=$1",
          [this.org],
        );
      } else if (p.kind === "ELECTION") {
        if (!this.ports.applyElection) fail(503, "ELECTION_APPLIER_REQUIRED");
        await this.member(payload.winnerId);
        if (Date.parse(payload.mandateEnd) <= Date.now())
          fail(409, "MANDATE_EXPIRED");
        outcome = await this.ports.applyElection!(this.ctx, {
          proposalId: pid,
          revision: p.revision,
          ...payload,
        });
      } else {
        outcome = await this.applyDocumentPart(payload, pid, p.revision);
      }
      const commitId = uuid();
      await this.c.query(
        "INSERT INTO gov_commits(organization_id,id,proposal_id,revision,branch_id,changes) VALUES($1,$2,$3,$4,$5,$6)",
        [
          this.org,
          commitId,
          pid,
          p.revision,
          p.branch_id,
          JSON.stringify({ payload, outcome }),
        ],
      );
      if (p.branch_id)
        await this.c.query(
          "UPDATE gov_branches SET state='APPLIED',version=version+1 WHERE organization_id=$1 AND id=$2",
          [this.org, p.branch_id],
        );
      await this.c.query(
        "UPDATE gov_proposals SET apply_state='APPLIED',version=version+1 WHERE organization_id=$1 AND id=$2",
        [this.org, pid],
      );
      await this.history(pid, "StructureCommitted", {
        commitId,
        payload,
        outcome,
      });
      await this.c.query("RELEASE SAVEPOINT governance_apply");
      return { commitId, applyState: "APPLIED" };
    } catch (e: any) {
      await this.c.query("ROLLBACK TO SAVEPOINT governance_apply");
      const modeled=await this.ports.modelGovernancePolicy?.(this.ctx);
      const modelConflict = ['GOVERNANCE_CIRCLE_SCOPE','ESSENTIAL_ROLE_PROTECTED','ESSENTIAL_DEFINITION_REQUIRES_MODEL_ADAPTATION','ELECTION_MEMBER_REQUIRED','ROLE_INCOMPATIBILITY','ROLE_NOT_ELECTABLE'].includes(e.code) || !!modeled&&e.code==='RESOURCE_NOT_FOUND';
      if (e.status !== 409 && !modelConflict && !(recordValidationConflict &&
          ['INVALID_PARENT','STRUCTURE_CYCLE','ROOT_PROTECTED','RESOURCE_NOT_FOUND'].includes(e.code))) throw e;
      await this.c.query(
        "UPDATE gov_proposals SET apply_state='APPLY_CONFLICT',version=version+1 WHERE organization_id=$1 AND id=$2",
        [this.org, pid],
      );
      await this.history(pid, "ProposalApplicationConflicted", {
        code: e.code,
      });
      return { applyState: "APPLY_CONFLICT", conflictCode: e.code };
    }
  }
  private async applyDocumentPart(part: DocumentPart, pid: string, revision: number) {
    const d = await this.documentRow(part.documentId);
    await this.activeDocumentType(d,true);
    const circleOwned = await this.circleDocument(d);
    if (part.documentAction === "ARCHIVE") {
      if (d.archived || d.visibility !== "ORGANIZATION" || (!circleOwned && d.workflow !== "GOVERNANCE") || d.version !== part.documentBaseVersion || d.published_version === null || d.published_version !== part.documentVersion) fail(409, "DOCUMENT_REVISION_CONFLICT");
      await this.c.query("UPDATE gov_documents SET archived=true,version=version+1 WHERE organization_id=$1 AND id=$2",[this.org,d.id]);
      await this.history(d.id,"DocumentArchivedByProposal",{proposalId:pid,revision,documentVersion:part.documentVersion});
      return {documentId:d.id,archived:true,publishedVersion:part.documentVersion};
    }
    if (d.archived || (!circleOwned && d.workflow !== "GOVERNANCE") || d.draft_version !== part.documentVersion) fail(409, "DOCUMENT_REVISION_CONFLICT");
    await this.c.query("UPDATE gov_documents SET published_version=$3,version=version+1 WHERE organization_id=$1 AND id=$2",[this.org,d.id,part.documentVersion]);
    return {documentId:d.id,publishedVersion:part.documentVersion};
  }
  async documentRow(did: string) {
    const d = await this.row("gov_documents", did);
    if (d.visibility === "AUTHOR" && d.author_id !== this.actor)
      fail(404, "RESOURCE_NOT_FOUND");
    return d;
  }
  async activeDocumentType(document:any,conflict=false){if(document.type_id&&!(await this.c.query('SELECT 1 FROM gov_document_types WHERE organization_id=$1 AND id=$2 AND active',[this.org,document.type_id])).rowCount)fail(conflict?409:422,'DOCUMENT_TYPE_INACTIVE');}
  /** A circle-owned agreement is a restriction: it changes only through governance proposals. */
  private async circleDocument(d: any) {
    return (
      await this.c.query(
        "SELECT 1 FROM entities WHERE organization_id=$1 AND id=$2 AND kind='CIRCLE'",
        [this.org, d.owner_id],
      )
    ).rowCount === 1;
  }
  /** While OPERATING under a governed model, restrictions cannot change directly. */
  private async governedRestriction(d: any) {
    return (
      (await this.circleDocument(d)) &&
      (await this.ports.modelGovernedChanges?.(this.ctx)) === true
    );
  }
  async document(input: any) {
    this.writable();
    await this.entity(input.ownerId);
    if (input.typeId) {
      const type = (
        await this.c.query(
          "SELECT * FROM gov_document_types WHERE organization_id=$1 AND id=$2 AND active",
          [this.org, id(input.typeId)],
        )
      ).rows[0];
      if (!type) fail(404, "RESOURCE_NOT_FOUND");
      input = { ...input, workflow: type.workflow };
    }
    if (
      !["DIRECT", "GOVERNANCE"].includes(input.workflow) ||
      !["ORGANIZATION", "AUTHOR"].includes(input.visibility)
    )
      fail(400, "INVALID_REQUEST");
    const did = uuid();
    const value = agreementContent(input);
    const row = (
      await this.c.query(
        "INSERT INTO gov_documents(organization_id,id,owner_id,title,workflow,visibility,author_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          this.org,
          did,
          input.ownerId,
          text(input.title),
          input.workflow,
          input.visibility,
          this.actor,
        ],
      )
    ).rows[0];
    await this.c.query(
      "INSERT INTO gov_document_versions(organization_id,document_id,number,content,created_by,rich_content) VALUES($1,$2,1,$3,$4,$5)",
      [this.org, did, value.content, this.actor, value.richContent],
    );
    await this.history(did, "DocumentDrafted", row);
    if (input.typeId) {
      await this.c.query(
        "UPDATE gov_documents SET type_id=$3 WHERE organization_id=$1 AND id=$2",
        [this.org, did, input.typeId],
      );
      row.type_id = input.typeId;
    }
    return camel(row);
  }
  async documentType(input: any, tid?: string) {
    this.writable();
    this.owner();
    if (!["DIRECT", "GOVERNANCE"].includes(input.workflow))
      fail(400, "INVALID_REQUEST");
    let row;
    if (tid) {
      const old = (
        await this.c.query(
          "SELECT * FROM gov_document_types WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [this.org, id(tid)],
        )
      ).rows[0];
      if (!old) fail(404, "RESOURCE_NOT_FOUND");
      version(this.request, old.version);
      if (input.active !== undefined && typeof input.active !== "boolean")
        fail(400, "INVALID_REQUEST");
      row = (
        await this.c.query(
          "UPDATE gov_document_types SET name=$3,workflow=$4,active=$5,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *",
          [
            this.org,
            tid,
            text(input.name),
            input.workflow,
            input.active ?? old.active,
          ],
        )
      ).rows[0];
    } else
      row = (
        await this.c.query(
          "INSERT INTO gov_document_types(organization_id,id,name,workflow) VALUES($1,$2,$3,$4) RETURNING *",
          [this.org, uuid(), text(input.name), input.workflow],
        )
      ).rows[0];
    await this.history(row.id, "DocumentTypeChanged", row);
    return camel(row);
  }
  async processTension(tid: string, input: any) {
    this.writable();
    const t = await this.row("gov_tensions", tid);
    if(t.author_id!==this.actor)this.owner();
    version(this.request, t.version);
    if (t.state === "CLOSED") fail(409, "STATE_CONFLICT");
    if (!["TASK", "GOAL","AGENDA"].includes(input.targetKind))
      fail(400, "INVALID_REQUEST");
    if(input.projectId!==undefined && input.targetKind!=='TASK')fail(400,'INVALID_REQUEST');
    let target:{id:string};
    if(input.targetKind==='AGENDA'){
      const meetingId=id(input.meetingId);
      if(!Number.isInteger(input.meetingVersion)||input.meetingVersion<1)fail(400,'INVALID_REQUEST');
      if(!this.ports.agenda)fail(503,'TENSION_AGENDA_SERVICE_REQUIRED');
      const result=await this.ports.agenda!.addTension(this.ctx,this.request,{meetingId,expectedMeetingVersion:input.meetingVersion,source:{kind:'TENSION',id:t.id,circleId:t.circle_id,title:t.title,authorId:t.author_id}});
      target={id:result.agendaId};
    }else{
      if(input.meetingId!==undefined||input.meetingVersion!==undefined)fail(400,'INVALID_REQUEST');
      if (!this.ports.createFromTension)fail(503, "TENSION_TARGET_SERVICE_REQUIRED");
      target = await this.ports.createFromTension!(this.ctx, {
      kind: input.targetKind,
      title: t.title,
      circleId: t.circle_id,
      tensionId: t.id,
      ...(input.targetKind==='TASK' && input.projectId!==undefined ? {projectId:input.projectId===null ? null : id(input.projectId)} : {}),
    });
    }
    id(target.id);
    if(input.targetKind==='TASK' && input.projectId!=null){
      if(!this.ports.verifyTensionTaskProject)fail(503,'TENSION_TARGET_SERVICE_REQUIRED');
      await this.ports.verifyTensionTaskProject!(this.ctx,target.id,id(input.projectId),t.id);
    }
    await this.c.query(
      "INSERT INTO gov_tension_links(organization_id,id,tension_id,target_kind,target_id) VALUES($1,$2,$3,$4,$5)",
      [this.org, uuid(), tid, input.targetKind, target.id],
    );
    await this.c.query(
      "UPDATE gov_tensions SET state='PROCESSED',version=version+1 WHERE organization_id=$1 AND id=$2",
      [this.org, tid],
    );
    await this.history(tid, "TensionProcessed", {
      targetKind: input.targetKind,
      targetId: target.id,
    });
    return { id: tid, targetKind: input.targetKind, targetId: target.id,version:t.version+1 };
  }
  private async appendDocumentDraft(document:any, value:ReturnType<typeof agreementContent>) {
    const number = document.draft_version + 1;
    await this.c.query(
      'INSERT INTO gov_document_versions(organization_id,document_id,number,content,created_by,rich_content) VALUES($1,$2,$3,$4,$5,$6)',
      [this.org, document.id, number, value.content, this.actor, value.richContent],
    );
    await this.c.query('UPDATE gov_documents SET version=version+1,draft_version=$3 WHERE organization_id=$1 AND id=$2',[this.org,document.id,number]);
    return number;
  }
  async documentAction(did: string, action: string, input: any) {
    this.writable();
    const d = await this.documentRow(did);
    if (d.author_id !== this.actor) this.owner();
    version(this.request, d.version);
    if (d.archived) fail(409, "STATE_CONFLICT");
    if (action === "publish") {
      await this.activeDocumentType(d);
      if (d.workflow !== "DIRECT" || (await this.governedRestriction(d))) fail(422, "FIELD_GOVERNED");
      await this.c.query(
        "UPDATE gov_documents SET published_version=draft_version,version=version+1 WHERE organization_id=$1 AND id=$2",
        [this.org, did],
      );
    } else if (action === "archive") {
      if (d.workflow !== "DIRECT" || (await this.governedRestriction(d))) fail(422, "FIELD_GOVERNED");
      await this.c.query(
        "UPDATE gov_documents SET archived=true,version=version+1 WHERE organization_id=$1 AND id=$2",
        [this.org, did],
      );
    } else {
      let value: ReturnType<typeof agreementContent>;
      if (action === "restore") {
        if (!Number.isInteger(input.number)) fail(400, "INVALID_REQUEST");
        const old = (
          await this.c.query(
            "SELECT content,rich_content FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2 AND number=$3",
            [this.org, did, input.number],
          )
        ).rows[0];
        if (!old) fail(404, "RESOURCE_NOT_FOUND");
        value = agreementContent(old.rich_content ? {richContent:old.rich_content} : {content:old.content});
      } else value = agreementContent(input,true);
      await this.appendDocumentDraft(d,value);
    }
    const row = await this.documentRow(did);
    await this.history(did, "Document" + action, row);
    return camel(row);
  }
}

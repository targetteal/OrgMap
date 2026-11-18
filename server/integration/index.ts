import { resolve } from 'node:path';
import { createGovernanceModelModule, createGovernanceModelPort } from '../modules/o2/plugin.js';
import type { Ctx, ModuleRuntime, OrgMapModule } from '../src/runtime.js';
import { createRuntime } from '../src/runtime.js';
import { Failure } from '../src/core.js';
import { pool } from '../src/db.js';
import { lockActiveOrganization } from '../src/organization-lifecycle.js';
import { createPublicationExportSource } from '../modules/administration/feed-source.js';
import { registerAdministrationFeed } from '../modules/administration/feed.js';
import { publicationExportResourceAdapter } from '../modules/administration/feed-platform.js';
import { createBrandingServices } from '../modules/administration/branding.js';
import { createAssistantAdministration } from '../modules/administration/assistant.js';
import { createBrandingDecoder, createBrandingStorage } from '../modules/administration/branding-image.js';
import { createStructureModule } from '../modules/structure/plugin.js';
import { createStructurePorts } from '../modules/structure/applier.js';
import { defaultCollectivePolicy, type StructurePortsOptions } from '../modules/structure/ports.js';
import { createStructureResourceAdapters } from '../modules/structure/platform.js';
import { createStructureGuestAccessAdapter } from '../modules/structure/guest.js';
import { createGovernanceModule } from '../modules/governance/plugin.js';
import { organizationalGovernancePolicy, validateOrgPolicy, type GovernancePorts, type OrganizationalGovernancePolicy } from '../modules/governance/service.js';
import { createGovernanceResourceAdapters } from '../modules/governance/ports.js';
import { createGovernanceRuntimePorts } from '../modules/governance/guest.js';
import { createGovernanceMeetingItems } from '../modules/governance/meeting-items.js';
import { createGovernanceTraceReader } from '../modules/governance/trace.js';
import { createWorkModule, createWorkResourceAdapters, createWorkGuestAccessAdapter, createWorkLegacyCommentSource, createWorkTraceReader, type WorkOptions } from '../modules/work/index.js';
import { createWorkApplicationPorts } from '../modules/work/application.js';
import {createWorkActivityPort} from './work-activity.js';
import { createWorkMeetingOutcomePort } from '../modules/work/meeting-outcomes.js';
import { createGoalsMeetingOutcomePort } from '../modules/goals/meeting-outcomes.js';
import { createGovernanceMeetingOutcomePort } from '../modules/governance/meeting-outcomes.js';
import { originForMeetingOutput, type MeetingOutcomeInput, type MeetingOutcomePort, type MeetingOutcomeTargetKind } from '../modules/meetings/outcomes.js';
import { createGoalsModule } from '../modules/goals/plugin.js';
import { createGoalsGuestAccessAdapter } from '../modules/goals/guest.js';
import { createGoalResourceAdapters, createRegistryGoalLinkResolver } from '../modules/goals/ports.js';
import { createGoalFromTension, listMeetingItems as listGoalMeetingItems } from '../modules/goals/services.js';
import { createMeetings } from '../modules/meetings/plugin.js';
import type { MeetingPorts } from '../modules/meetings/service.js';
import { createMeetingResourceAdapters } from '../modules/meetings/platform.js';
import { createMeetingCalendarPort } from '../modules/meetings/calendar-port.js';
import { createMeetingRuntimePorts } from '../modules/meetings/guest.js';
import { createMeetingTraceReader, createMeetingReferenceReader } from '../modules/meetings/trace.js';
import type { TraceabilityPort } from '../src/traceability.js';
import { createAgendaItemResourceAdapter } from '../modules/meetings/agenda-items.js';
import { createMeetingExportResourceAdapter } from '../modules/meetings/exports.js';
import { formatsByKind } from '../modules/meetings/export-contract.js';
import { createLocalReportPackageSerializer } from '../modules/platform/report-runtime.js';
import { createMeetingAgendaCommandPort } from '../modules/meetings/agenda-port.js';
import { createMeetingGovernanceConsentPort, createHolacracyProposalOriginPort } from '../modules/meetings/governance-consent.js';
import { createGovernanceConsentWorker } from '../modules/governance/consent-worker.js';
import { createAdministration, canManage, organizationSettings, oversight, readOrganizationalPolicy, readCredentialPolicy, readAdmissionPolicy, readUploadPolicy, createMemberIndicatorAuthority } from '../modules/administration/index.js';
import { memberResourceAdapter, publicPageResourceAdapter } from '../modules/administration/resources.js';
import { createAdministrationGuestAccessAdapter } from '../modules/administration/guest.js';
import { createInteroperability } from '../modules/interoperability/index.js';
import { registerInteroperabilityWorkerAuthorization } from '../modules/interoperability/worker-authorization.js';
import { localCalendarAdapter } from '../modules/interoperability/local-calendar-adapter.js';
import { InteroperabilityDeliveryWorker } from '../modules/interoperability/delivery-worker.js';
import {
  createPlatform, ResourceRegistry, FilesystemBlobStore,
  PlatformWorker, LocalSmtpTransport, ScopedDeliveryWorker,
  PlatformDispatcher, createPlatformScheduling,
  createExportJobPort, createPlatformGuestAccessAdapter, createCommentThreadPort, createIncomingUploadService, createLocalAccountMediaProvider,
  enqueueNotification, effectivePreference,
} from '../modules/platform/index.js';
import type { DeliveryMetadataPort, ReadResourceWorkerContextPort } from '../modules/platform/index.js';
import { BrevoNotificationTransport } from '../modules/platform/brevo.js';
import type { ResourceAccessPort, SearchItem } from '../modules/platform/ports.js';
import type { PendingScopeDispatchPort } from '../modules/platform/dispatcher.js';

type ModuleName = 'work' | 'goals' | 'governance' | 'meetings';
const base = '/api/v1/organizations/:organizationId';
async function moduleEnabled(core: ModuleRuntime, ctx: Parameters<ModuleRuntime['assertModuleAvailable']>[0], module: ModuleName) {
  try { await core.assertModuleAvailable(ctx, module); return true; }
  catch (error) { if (error instanceof Failure && error.code === 'MODULE_DISABLED') return false; throw error; }
}
function availableAdapter(core: ModuleRuntime, type: string, adapter: ResourceAccessPort): ResourceAccessPort {
  const enabled = async (ctx: Parameters<ResourceAccessPort['authorize']>[0]) => {
    try { await core.assertResourceAvailable(ctx, type); return true; }
    catch (error) { if (error instanceof Failure && error.code === 'MODULE_DISABLED') return false; throw error; }
  };
  return {
    ...adapter,
    authorize: async (ctx, id, action) => await enabled(ctx) && await adapter.authorize(ctx, id, action),
    ...(adapter.lookup ? {lookup:async(ctx,id)=>await enabled(ctx)?adapter.lookup!(ctx,id):null}:{}),
    ...(adapter.search ? { search: async (ctx, query, limit) => await enabled(ctx) ? adapter.search!(ctx, query, limit) : [] } : {}),
    ...(adapter.export ? { export: async (ctx, ids, kind, intent) => { await core.assertResourceAvailable(ctx, type); return adapter.export!(ctx, ids, kind, intent); } } : {}),
    ...(adapter.validateImport ? { validateImport: async (ctx, records, kind) => { await core.assertResourceAvailable(ctx, type); return adapter.validateImport!(ctx, records, kind); } } : {}),
    ...(adapter.applyImport ? { applyImport: async (ctx, plan, kind) => { await core.assertResourceAvailable(ctx, type); return adapter.applyImport!(ctx, plan, kind); } } : {}),
  };
}

/** Configuration is supplied by the host, never inferred from research credentials. */
export interface IntegrationOptions {
  blobsDirectory?: string;
  smtp?: { port: number; host?: string };
  oidc?: Parameters<typeof createInteroperability>[0];
  webhooks?: Parameters<typeof createInteroperability>[1];
  saml?: Parameters<typeof createInteroperability>[2];
  deliveries?: Parameters<typeof createInteroperability>[3];
  enrollment?: Parameters<typeof createInteroperability>[5];
  createFromTension?: GovernancePorts['createFromTension'];
  linkedMeetingItems?: MeetingPorts['linkedItems'];
}

/** One environment per runtime; every domain owns its SQL and resource policy. */
export function createIntegrationEnvironment(core: ModuleRuntime, options: IntegrationOptions = {}, runtimeKind: 'HTTP' | 'WORKER' = 'WORKER') {
  core.registerGovernanceModel(createGovernanceModelPort(core));
  if (runtimeKind === 'WORKER') registerInteroperabilityWorkerAuthorization(core, options);
  core.registerOrganizationSettings(organizationSettings);
  core.registerCredentialPolicyResolver(readCredentialPolicy);
  core.registerAdmissionPolicyProvider({ resolve: readAdmissionPolicy });
  if (options.smtp) core.registerAdmissionMailTransport({ host: options.smtp.host ?? '127.0.0.1', port: options.smtp.port });
  for (const scope of [
    { module: 'work' as const, routePrefixes: [`${base}/work`], resourceTypes: ['project', 'task', 'work-export'] },
    { module: 'goals' as const, routePrefixes: [`${base}/goals`, `${base}/goal-periods`], resourceTypes: ['goal', 'key-result'] },
    { module: 'governance' as const, routePrefixes: ['governance', 'tensions', 'proposals', 'document-types', 'documents'].map(path => `${base}/${path}`), resourceTypes: ['proposal', 'tension', 'agreement'] },
    { module: 'meetings' as const, routePrefixes: ['meetings', 'meeting-series', 'meeting-templates', 'meeting-agenda', 'meeting-reports', 'meeting-agenda-items'].map(path => `${base}/${path}`), resourceTypes: ['meeting', 'report', 'agenda-item', 'meeting-export'] },
  ]) core.registerModuleScope(scope);
  const work = createWorkApplicationPorts(core);
  const structureOptions: StructurePortsOptions = {
    memberIndicatorAuthority: createMemberIndicatorAuthority(),
    guestStructureScope: ctx => core.guestStructureScope(ctx),
    organizationPolicy: async ctx => {
      const source = await readOrganizationalPolicy(ctx, 'structure.collectiveManagement');
      if (!source) return { ...defaultCollectivePolicy };
      if (typeof source.value !== 'boolean') throw new Failure(503, 'POLICY_CONFIGURATION_INVALID');
      return { enabled: source.value, allowCircleOverride: source.allowOverride, revision: source.revision };
    },
    onCircleCreated: async (ctx, input) => {
      await core.governanceModel()!.ensureCircle(ctx, input.circleId);
      if (await moduleEnabled(core, ctx, 'work')) return work.onCircleCreated(ctx, input);
    },
  };
  core.registerGuestAccessAdapter(createStructureGuestAccessAdapter(core, structureOptions));
  core.registerGuestAccessAdapter(createGoalsGuestAccessAdapter(core));
  core.registerGuestAccessAdapter(createWorkGuestAccessAdapter(core));
  core.registerGuestAccessAdapter(createAdministrationGuestAccessAdapter());
  const structure = createStructurePorts(core, structureOptions);
  core.registerFoundationStructure(structure);
  const governance: GovernancePorts = createGovernanceRuntimePorts(core, {
    organizationalPolicy: async ctx => {
      const source = await readOrganizationalPolicy(ctx, 'governance.method');
      if (!source) return null;
      const input: OrganizationalGovernancePolicy = { key: 'governance.method', value: source.value as OrganizationalGovernancePolicy['value'], allowOverride: source.allowOverride };
      organizationalGovernancePolicy(input);
      return input;
    },
    modelParticipation: (ctx, circleId) => core.governanceModel()!.participates(ctx, circleId),
    modelGovernancePolicy: ctx=>core.governanceModel()!.governancePolicy(ctx),
    validateModelElection: (ctx, input) => core.governanceModel()!.validateElection(ctx, input),
    validateModelChanges: (ctx, input) => core.governanceModel()!.validateChanges(ctx, input),
    validateModelDocument: (ctx,input)=>core.governanceModel()!.validateDocument(ctx,input),
    modelGovernedChanges: ctx=>core.governanceModel()!.governedChanges(ctx),
    membershipReasons: structure.membershipReasons,
    isLeadLink: structure.isLeadLink,
    applyStructure: structure.applyStructure,
    applyElection: structure.applyElection,
    applyField: structure.applyField,
    authorizeTensionTaskProject: (ctx, projectId) => work.authorizeTensionTaskProject(ctx, projectId),
    verifyTensionTaskProject: (ctx, taskId, projectId, tensionId) => work.verifyTensionTaskProject(ctx, taskId, projectId, tensionId),
    createFromTension: async (ctx, input) => {
      await core.assertModuleAvailable(ctx, input.kind === 'TASK' ? 'work' : 'goals');
      if (options.createFromTension) return options.createFromTension(ctx, input);
      return input.kind === 'TASK' ? work.createTaskFromTension(ctx, input) : createGoalFromTension(ctx, input);
    },
  });
  const guestResourceOwners = new Map([
    ['circle', { context: 'structure', kind: 'circle' }],
    ['role', { context: 'structure', kind: 'role' }],
    ['goal', { context: 'goals', kind: 'goal' }],
    ['key-result', { context: 'goals', kind: 'key-result' }],
    ['proposal', { context: 'governance', kind: 'proposal' }],
    ['tension', { context: 'governance', kind: 'tension' }],
    ['agreement', { context: 'governance', kind: 'agreement' }],
    ['project', { context: 'work', kind: 'project' }],
    ['task', { context: 'work', kind: 'task' }],
    ['meeting', { context: 'meetings', kind: 'meeting' }],
    ['report', { context: 'meetings', kind: 'report' }],
  ]);
  const originalResourceMapping = {
    resolveOriginalResource: async (_ctx: Parameters<ResourceAccessPort['authorize']>[0], ref: { type: string; id: string }) => {
      const owner = guestResourceOwners.get(ref.type);
      return owner ? { ...owner, id: ref.id } : undefined;
    },
  };
  core.registerGuestAccessAdapter(createPlatformGuestAccessAdapter(core, originalResourceMapping));
  const registry: ResourceRegistry = new ResourceRegistry({
    notificationWorkspace: async ctx => {
      const {settings}=await organizationSettings(ctx);
      return {name:settings.name,locale:settings.locale,timeZone:settings.timezone??settings.timeZone??'UTC'};
    },
    notificationEmailEnabled: async ctx => {
      const enabled = (await organizationSettings(ctx)).settings.notifications.emailEnabled;
      if (typeof enabled !== 'boolean') throw new Failure(503, 'NOTIFICATION_CONFIGURATION_INVALID');
      return enabled;
    },
    guestResourceIds: async (ctx, type, action) => {
      const owner = guestResourceOwners.get(type);
      if (!owner) return [];
      try { await core.assertResourceAvailable(ctx, type); }
      catch (error) { if (error instanceof Failure && error.code === 'MODULE_DISABLED') return []; throw error; }
      return core.guestResourceIds(ctx, { ...owner, action });
    },
    guestSearch: async (ctx, type, query, limit): Promise<SearchItem[]> => {
      const owner = guestResourceOwners.get(type);
      if (!owner) return [];
      try { await core.assertResourceAvailable(ctx, type); }
      catch (error) { if (error instanceof Failure && error.code === 'MODULE_DISABLED') return []; throw error; }
      const ids = await core.guestResourceIds(ctx, { ...owner, action: 'read' });
      if (!ids.length) return [];
      // Published domain adapters filter exact grant IDs before matching, ordering and limiting.
      return await registry.get(type)?.search?.(ctx, query, limit) ?? [];
    },
    guestAccess: async (ctx, ref, action) => {
      // Only published domain perimeters belong here; Platform grants no ambient access.
      const resource = await originalResourceMapping.resolveOriginalResource(ctx, ref);
      if (!resource) return false;
      try {
        await core.requireGuestResource(ctx, resource, action);
        return true;
      } catch (error) {
        if (error instanceof Failure && [403, 404].includes(error.status)) return false;
        throw error;
      }
    },
  });
  const reportPackages = createLocalReportPackageSerializer();
  registry.registerResourceAdapter('invitation', {
    authorize: async (ctx, invitationId, action) => action === 'read' && !!(await core.invitationResource(ctx, invitationId)),
    lookup: async (ctx, invitationId) => {
      const resource = await core.invitationResource(ctx, invitationId);
      return resource ? {id: resource.id, title: resource.title} : null;
    },
  });
  core.registerInvitationLifecycleNotifier(async (ctx, notice) => {
    if(ctx.member.id !== notice.recipientMemberId)throw new Failure(403,'ACTION_DENIED');
    await enqueueNotification(ctx,registry,{eventId:notice.eventId,event:notice.event,ref:{type:'invitation',id:notice.invitationId},recipients:[{memberId:notice.recipientMemberId,nominal:true}],includeActor:true,actorName:notice.actorName??'OrgMap'});
  });
  core.registerNotificationPublisher((ctx,input)=>enqueueNotification(ctx,registry,input));
  const publicationGate = async (ctx: Ctx) => { await lockActiveOrganization(ctx.c, ctx.org.id); };
  const publicationSource = createPublicationExportSource(publicationGate);
  registry.registerResourceAdapter('publication-export', publicationExportResourceAdapter(publicationSource));
  const exportJobs = createExportJobPort(registry, { reportPackages });
  const workOptions: WorkOptions = {
    publishNotification:core.publishNotification,
    activity:createWorkActivityPort(),
    guest: core,
    roleCapacity: { resolveRoleCapacity: structure.resolveRoleCapacity },
    principalTransfers: true,
    tabularExports: true,
    privateOperationalExport: ctx => oversight(ctx, 'privateOperationalExport'),
    exportJobs,
  };
  const meetings = createMeetingRuntimePorts(core, {
    readPolicy: { oversight },
    validateMembers: (ctx, ids) => core.validateActiveMembers(ctx, ids),
    resolveRoster: structure.resolveMeetingRoster,
    canContributeAgenda: async (ctx, circleId) => {
      if (ctx.member.status !== 'ACTIVE' || ctx.member.member_type !== 'MEMBER') return false;
      const roster = await structure.resolveMeetingRoster(ctx, {circleId, includeSubcircles:false, roleIds:[]});
      return roster.some(item => item.memberId === ctx.member.id);
    },
    linkedItems: options.linkedMeetingItems ?? (async (ctx, input) => {
      const circleIds = await structure.circleScope(ctx, input);
      // Same transaction client: keep queries ordered, never parallelize one pg client.
      const projectsAndTasks = await moduleEnabled(core, ctx, 'work') ? await work.listMeetingItems(ctx, { circleIds }) : [];
      const goals = await moduleEnabled(core, ctx, 'goals') ? await listGoalMeetingItems(ctx, { circleIds }) : [];
      const proposals = await moduleEnabled(core, ctx, 'governance') ? await createGovernanceMeetingItems(governance)(ctx, { circleIds }) : [];
      return [...projectsAndTasks, ...goals, ...proposals];
    }),
  });
  const meetingReadPolicy = meetings.readPolicy!;
  const outcomePorts={work:createWorkMeetingOutcomePort(core,workOptions.roleCapacity),goals:createGoalsMeetingOutcomePort(),governance:createGovernanceMeetingOutcomePort(governance)};
  const outcomeModule=(kind:MeetingOutcomeInput['kind'])=>kind==='TASK'||kind==='PROJECT'?'work':kind==='GOAL'?'goals':'governance';
  const outcomes:MeetingOutcomePort={
    async roleOccupants(ctx,input){await core.assertModuleAvailable(ctx,'work');return outcomePorts.work.roleOccupants!(ctx,input);},
    async authorize(ctx,input){const module=outcomeModule(input.kind);await core.assertModuleAvailable(ctx,module);await outcomePorts[module].authorize(ctx,input);},
    async create(ctx,input){
      const module=outcomeModule(input.kind);await core.assertModuleAvailable(ctx,module);
      const result=await outcomePorts[module].create(ctx,input);
      const expected=input.kind==='POLICY'?'PROPOSAL':input.kind;
      if(result.kind!==expected || !await outcomePorts[module].read(ctx,result))throw new Failure(409,'MEETING_OUTCOME_TARGET_MISMATCH');
      return result;
    },
    async read(ctx,input){
      if(ctx.member.member_type==='GUEST')return null;
      const module=outcomeModule(input.kind);
      return await moduleEnabled(core,ctx,module)?outcomePorts[module].read(ctx,input):null;
    },
  };
  meetings.outcomes=outcomes;meetingReadPolicy.outcomes=outcomes;
  meetings.exports = { exportJobs, formatsByKind: async () => {
    try { await reportPackages.assertAvailable(); return formatsByKind; }
    catch (error) {
      if (!(error instanceof Failure && error.status === 503)) throw error;
      return { MEETING_ROWS: ["XLSX"] as const, MEETING_MONTHLY_STATISTICS: ["XLSX"] as const };
    }
  } };
  const assertMeetings = (ctx: Parameters<ModuleRuntime['assertModuleAvailable']>[0]) => core.assertModuleAvailable(ctx, 'meetings');
  governance.agenda = createMeetingAgendaCommandPort(core, meetings);
  governance.meetingConsent = createMeetingGovernanceConsentPort(core, meetingReadPolicy);
  governance.holacracyMeetingOrigin = createHolacracyProposalOriginPort();
  const governanceTrace = createGovernanceTraceReader(core, governance);
  const workTrace = createWorkTraceReader(core);
  const meetingTrace = createMeetingTraceReader(core, meetings);
  const meetingReference = createMeetingReferenceReader(core, meetings);
  const goalTrace = createGoalResourceAdapters({ guest: core }).goal;
  const trace: TraceabilityPort = {
    goalOrigin: async(ctx,id)=>await governanceTrace.goalOrigin(ctx,id)??(await moduleEnabled(core,ctx,'meetings')?await originForMeetingOutput(ctx,{kind:'GOAL',id},meetingReadPolicy):null),
    meetingOrigin: async(ctx,kind,id)=>await moduleEnabled(core,ctx,'meetings')?originForMeetingOutput(ctx,{kind,id},meetingReadPolicy):null,
    tension: async (ctx, id) => await moduleEnabled(core, ctx, 'governance') ? governanceTrace.tension(ctx, id) : null,
    destination: async (ctx, kind, id) => {
      if (ctx.member.member_type === 'GUEST') return null;
      if (kind === 'TASK') return await moduleEnabled(core, ctx, 'work') ? workTrace(ctx, id) : null;
      if (kind === 'PROJECT') return outcomes.read(ctx,{kind,id});
      if (kind === 'AGENDA') return await moduleEnabled(core, ctx, 'meetings') ? meetingTrace(ctx, id) : null;
      if (kind === 'MEETING') return await moduleEnabled(core, ctx, 'meetings') ? meetingReference(ctx, id) : null;
      if (kind === 'PROPOSAL') return await moduleEnabled(core, ctx, 'governance') ? governanceTrace.proposal(ctx, id) : null;
      if (kind !== 'GOAL') return null;
      if (!(await moduleEnabled(core, ctx, 'goals'))) return null;
      if (!goalTrace.lookup) throw new Failure(503, 'TRACE_AUTHORITY_UNAVAILABLE');
      const goal = await goalTrace.lookup(ctx, id);
      return goal ? { kind: 'GOAL', id: goal.id, title: goal.title } : null;
    },
  };
  governance.trace = trace;
  meetingReadPolicy.trace = trace;
  workOptions.trace = trace;
  const adapters = {
    ...createStructureResourceAdapters(core, structureOptions),
    ...createGovernanceResourceAdapters(governance),
    ...createWorkResourceAdapters(workOptions),
    ...createGoalResourceAdapters({ guest: core }),
    ...createMeetingResourceAdapters(meetingReadPolicy),
    'agenda-item': createAgendaItemResourceAdapter(meetings, assertMeetings),
    'meeting-export': createMeetingExportResourceAdapter({ ...meetings.exports, readPolicy: meetingReadPolicy, assertAvailable: assertMeetings }),
    member: memberResourceAdapter(),
    'public-page': publicPageResourceAdapter(),
  };
  for (const [type, adapter] of Object.entries(adapters)) registry.registerResourceAdapter(type, availableAdapter(core, type, adapter));
  governance.notifyProposal = async (ctx, input) => {
    await core.assertModuleAvailable(ctx,'governance');
    await enqueueNotification(ctx,registry,{eventId:input.eventId,event:input.event,ref:{type:'proposal',id:input.proposalId},recipients:input.recipients,context:input.context,includeActor:input.includeActor,actorName:input.actorName});
  };
  workOptions.requireMemberProfileRead = async (ctx, memberId) => {
    const adapter = registry.get('member');
    if (!adapter) throw new Failure(503, 'MEMBER_PROFILE_AUTHORITY_UNAVAILABLE');
    if (!(await adapter.authorize(ctx, memberId, 'read'))) throw new Failure(404, 'RESOURCE_NOT_FOUND');
  };
  const comments = createCommentThreadPort({ core, registry, legacyTaskComments: createWorkLegacyCommentSource({ guest: core }) });
  workOptions.comments = comments;
  const blobs = new FilesystemBlobStore(options.blobsDirectory ?? resolve('.orgmap/blobs'));
  const branding = createBrandingServices({
    authorize: ctx => canManage(ctx, 'settings.manage'),
    appearance: async ctx => {
      const branding = (await organizationSettings(ctx)).settings.branding;
      return { color: branding.color, colorTheme: branding.colorTheme, showOrganizationName: branding.showOrganizationName !== false };
    },
    lifecycle: {
      assertTenantReadable: publicationGate,
      assertTenantWritable: publicationGate,
      assertPublicReadable: async (c, organizationId) => { await lockActiveOrganization(c, organizationId); },
    },
    decoder: createBrandingDecoder(),
    storage: createBrandingStorage(resolve(blobs.root, 'organization-branding')),
  });
  try { core.registerAccountMediaProvider(createLocalAccountMediaProvider({ directory: blobs.root })); }
  catch (error) { if (!(error instanceof Failure && error.code === 'ACCOUNT_IMAGE_DECODER_UNAVAILABLE')) throw error; }
  const uploads = createIncomingUploadService({ core, registry, blobs, policyProvider: { resolve: readUploadPolicy } });
  const transport = process.env.BREVO_API_KEY
    ? new BrevoNotificationTransport()
    : new LocalSmtpTransport(options.smtp?.port ?? Number(process.env.SMTP_PORT ?? 1025), options.smtp?.host ?? '127.0.0.1');
  const worker = new PlatformWorker({
    withContext: (organizationId, memberId, fn) => core.withWorkerContext(organizationId, memberId, fn),
    registry,
    blobs,
    transport,
    notificationBranding: branding.emailInline,
    reportPackages,
  });
  const deliveryResourceOwners = new Map([
    ...guestResourceOwners,
    ['member', { context: 'administration', kind: 'member' }],
    ['public-page', { context: 'administration', kind: 'public-page' }],
    ['invitation', { context: 'foundation', kind: 'invitation' }],
  ]);
  const withReadResourceContext: ReadResourceWorkerContextPort = async (organizationId, memberId, ref, callback) => {
    const owner = deliveryResourceOwners.get(ref.type);
    if (!owner) throw new Failure(404, 'RESOURCE_NOT_FOUND');
    return core.withResourceWorkerContext(organizationId, memberId,
      [{ resource: { ...owner, id: ref.id }, action: 'read' }], callback);
  };
  const configureScopedDeliveries = (metadata: DeliveryMetadataPort) => {
    worker.configureScopedDeliveries(new ScopedDeliveryWorker({ metadata, registry, transport, withReadResourceContext, notificationBranding: branding.emailInline }));
  };
  const deliveryScheduling = createPlatformScheduling('interoperability');
  const consentScheduling = createPlatformScheduling('governance-consent');
  governance.scheduleConsent = (ctx,availableAt) => consentScheduling.schedule(ctx,{availableAt});
  governance.consentDistributionReady = async (ctx,input) => {
    const recipients = input.electorate.filter(memberId => memberId !== input.submitterId);
    if (!recipients.length) return true;
    for(const memberId of recipients){
      const member=(await ctx.c.query('SELECT * FROM members WHERE organization_id=$1 AND id=$2 AND status=\'ACTIVE\'',[ctx.org.id,memberId])).rows[0];
      if(!member)continue;
      const account=(await ctx.c.query('SELECT * FROM accounts WHERE id=$1',[member.account_id])).rows[0];
      if(!account)continue;
      const recipientCtx={...ctx,member,account,principal:undefined};
      if(!await registry.notificationAllowed(recipientCtx,{type:'proposal',id:input.proposalId}))continue;
      const enabled=await Promise.all(['IN_APP','EMAIL'].map(channel=>effectivePreference(ctx,memberId,'ProposalSubmitted',channel,registry)));
      if(!enabled.some(preference=>preference.enabled))continue;
      const deliveries=(await ctx.c.query('SELECT state FROM platform_deliveries WHERE organization_id=$1 AND event_id=$2 AND recipient_id=$3',[ctx.org.id,input.eventId,memberId])).rows;
      if(deliveries.some(delivery=>delivery.state==='DELIVERED'))continue;
      // A recorded opt-out is final for that event, even if preferences change again.
      if(deliveries.length&&deliveries.every(delivery=>delivery.state==='SUPPRESSED'))continue;
      return false;
    }
    return true;
  };
  const governanceConsentWorker = createGovernanceConsentWorker(core,governance);
  const interoperabilityWorker = new InteroperabilityDeliveryWorker({
    withContext: (organizationId, memberId, fn) => core.withWorkerContext(organizationId, memberId, fn),
    configuration: options.deliveries ?? {},
    scheduling: deliveryScheduling,
  });

  return { structure, structureOptions, governance, registry, comments, uploads, blobs, worker, reportPackages, configureScopedDeliveries, meetings, meetingReadPolicy, workOptions, deliveryScheduling, interoperabilityWorker, governanceConsentWorker, publicationSource, publicationGate, exportJobs, branding };
}

/** Pass as the single composition plugin to buildApp([createOrgMapIntegration(...)], {migrationMaxPrefix:999}). */
export function createOrgMapIntegration(options: IntegrationOptions = {}): OrgMapModule {
  return async (app, core) => {
    const environment = createIntegrationEnvironment(core, options, 'HTTP');
    const webhookOptions = options.webhooks ?? { secrets: {}, ports: {} };
    const interop = createInteroperability(
      options.oidc ?? {},
      {
        ...webhookOptions,
        ports: {
          externalChange: localCalendarAdapter,
          ...webhookOptions.ports,
          calendar: createMeetingCalendarPort(environment.meetingReadPolicy),
        },
      },
      options.saml ?? {},
      options.deliveries ?? {},
      environment.deliveryScheduling,
      options.enrollment ?? {},
    );
    const plugins = [
      createGovernanceModelModule(),
      createStructureModule(environment.structureOptions),
      createAdministration({
        admissionPolicyConsumer: core.admissionPolicyConsumer,
        uploadPolicyConsumer: environment.uploads,
        credentialPolicyReadiness: (ctx, policy) => core.credentialPolicyReadiness(ctx, policy),
        validateGovernancePolicyChange: validateOrgPolicy,
        validateOrganizationPolicyChange: async (ctx, next) => {
          await environment.structure.validateOrganizationPolicyChange(ctx, next);
        },
      }),
      createGovernanceModule(environment.governance),
      createWorkModule(environment.workOptions),
      createGoalsModule({ resolveLink: createRegistryGoalLinkResolver(environment.registry), requireMemberProfileRead: environment.workOptions.requireMemberProfileRead, trace: environment.governance.trace }),
      createMeetings(environment.meetings),
      interop,
      createPlatform({ registry: environment.registry, blobs: environment.blobs, comments: environment.comments, uploads: environment.uploads, reportPackages: environment.reportPackages }),
    ];
    for (const plugin of plugins) await plugin(app, core);
    environment.branding.register(app, core);
    createAssistantAdministration({ canManageSettings: ctx => canManage(ctx, 'settings.manage') }).register(app, core);
    registerAdministrationFeed(app, core, {
      gate: environment.publicationGate,
      enqueue: { enqueue: (ctx, input) => environment.exportJobs.enqueue(ctx, {
        resourceType: 'publication-export', resourceIds: [input.selectionId], exportKind: 'PUBLICATIONS', format: 'ZIP', requestId: ctx.requestId ?? 'publication-export',
      }) },
    });
  };
}

/** Standalone worker CLI entry; no browser identity, debug headers or bypass role. */
export async function createPlatformWorker(options: IntegrationOptions = {}) {
  const environment = createIntegrationEnvironment(createRuntime(), options);
  return Object.assign(environment.worker,{runGovernanceConsent:environment.governanceConsentWorker.runDelivery});
}

/** The discovery credential has no resource access; each worker reacquires current IAM/tenant policy. */
export function createIntegratedDispatcher(scopes: PendingScopeDispatchPort, options: IntegrationOptions = {}) {
  const environment = createIntegrationEnvironment(createRuntime(), options);
  if (scopes.deliveryMetadata) environment.configureScopedDeliveries(scopes.deliveryMetadata());
  return new PlatformDispatcher(scopes, environment.worker, [{
    name: 'interoperability',
    runDelivery: (organizationId, memberId) => environment.interoperabilityWorker.runDelivery(organizationId, memberId),
  }, {
    name: 'governance-consent',
    runDelivery: (organizationId, memberId) => environment.governanceConsentWorker.runDelivery(organizationId, memberId),
  }]);
}

/** Only for the standalone worker process, never an HTTP handler. */
export async function closePlatformWorker() { await pool.end(); }

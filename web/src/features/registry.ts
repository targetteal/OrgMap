import { invitationTrackingFeature } from "./administration/InvitationTracking";
import {memberIndicatorConsentFeature} from "./administration/member-indicator-consents";
import type { FeatureDefinition } from "../feature-contract";
import { deferredFeature } from "./deferred-feature";
import { governanceMetadata } from "./governance/metadata";
import { workMetadata } from "./work/metadata";
import { meetingsMetadata } from "./meetings/metadata";
import { MeetingsHeaderActions } from "./meetings/header-actions";
import { goalsMetadata } from "./goals/metadata";
import { administrationMetadata } from "./administration/metadata";
import { publicationsMetadata } from "./publications/metadata";
import { interoperabilityMetadata } from "./interoperability/metadata";
// Integration owned by shell; feature workers export definitions from their own directory.
import { feature as structureAdvanced } from "./structure-advanced";
import { feature as platform } from "./platform";
import { feature as account } from "../account";
import { AssistantSettings } from "./administration/assistant-settings";
import { feature as governanceModel } from "./o2";
const governance: FeatureDefinition = {
  ...governanceMetadata,
  Component: deferredFeature(() => import("./governance")),
};
const work: FeatureDefinition = {
  ...workMetadata,
  Component: deferredFeature(() => import("./work")),
};
const meetings: FeatureDefinition = {
  ...meetingsMetadata,
  HeaderActions: MeetingsHeaderActions,
  Component: deferredFeature(() => import("./meetings")),
};
const goals: FeatureDefinition = {
  ...goalsMetadata,
  Component: deferredFeature(() => import("./goals")),
  sidebar: deferredFeature(() => import("./goals"), "sidebar"),
};
const administration: FeatureDefinition = {
  ...administrationMetadata,
  Component: deferredFeature(() => import("./administration")),
  sidebar: deferredFeature(() => import("./administration"), "sidebar"),
};
const interoperability: FeatureDefinition = {
  ...interoperabilityMetadata,
  Component: deferredFeature(() => import("./interoperability")),
};
const publicationsFeature: FeatureDefinition = {
  ...publicationsMetadata,
  Component: deferredFeature(() => import("./publications").then(({publicationsFeature}) => ({feature:publicationsFeature}))),
};
export const features: FeatureDefinition[] = [
  governance,
  interoperability,
  structureAdvanced,
  work,
  goals,
  meetings,
  administration,
  governanceModel,
  publicationsFeature,
  {
    id: 'assistant-settings', module: 'administration', label: 'Assistente',
    matches: path => path.split(/[?#]/, 1)[0] === '/assistant',
    Component: AssistantSettings,
    navigation: [{ path: '/assistant', label: 'Configurações do assistente', location: 'identity', visible: context => context.bootstrap.membership.memberType !== 'GUEST' }],
  },
  memberIndicatorConsentFeature,
  invitationTrackingFeature,
  { ...platform, ownsSidebarNavigation: true },
  account,
];

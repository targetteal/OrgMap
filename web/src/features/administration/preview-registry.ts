import type { FeatureDefinition } from "../../feature-contract";
import { feature } from "./index";
import { memberIndicatorConsentFeature } from "./member-indicator-consents";
import { invitationManagementFeature } from "./invitation-management";
export const features: FeatureDefinition[] = [
  invitationManagementFeature,
  memberIndicatorConsentFeature,
  feature,
];

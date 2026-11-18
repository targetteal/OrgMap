import type { ComponentType, ReactNode } from "react";
import type {
  Bootstrap,
  Session,
  Structure,
  Member,
  StructureNode,
} from "./api";
import { request } from "./api";
export type FeatureContext = {
  organizationId: string;
  selectedEntity?: StructureNode;
  session: Session;
  bootstrap: Bootstrap;
  structure: Structure;
  members: Member[];
  path: string;
  hash?: string;
  navigate: (path: string) => void;
  api: typeof request;
  refresh: () => void;
  notify: (message: string) => void;
  accountPreferences?: import("./account/formatting").RegionalPreferences;
  formatDate?: (value: string | Date, includeTime?: boolean) => string;
  refreshSession?: () => Promise<void>;
  onOrganizationClosed?: (result: {organizationId:string;jobId:string;reauthenticationRequired:boolean}) => Promise<void>;
  registerNavigationGuard?: (guard: () => string | null) => () => void;
};
export type FeatureModule =
  | "structure"
  | "goals"
  | "projects"
  | "meetings"
  | "members"
  | "administration"
  | "account"
  | "settings"
  | "platform"
  | "interoperability";
export type FeatureComponent = ComponentType<{ context: FeatureContext }>;
export type FeatureDefinition = {
  id: string;
  module: FeatureModule;
  label: string;
  matches: (path: string) => boolean;
  Component: FeatureComponent;
  sidebar?: FeatureComponent;
  /** The sidebar already renders this feature's declared sidebar links. */
  ownsSidebarNavigation?: boolean;
  collapseSidebar?: (path: string) => boolean;
  settingsPath?: string;
  EntitySections?: FeatureComponent;
  HeaderActions?: FeatureComponent;
  GlobalSearch?: FeatureComponent;
  navigation?: {
    path: string;
    label: string;
    location: "identity" | "sidebar";
    visible?: (context: FeatureContext) => boolean;
  }[];
};
export type FormFieldProps = {
  label: string;
  name: string;
  value?: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  children?: ReactNode;
};

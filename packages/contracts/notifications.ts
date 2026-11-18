/** Domain-owned, transaction-bound intent. This contract never carries HTML or secrets. */
export type NotificationEvent =
  | "InvitationAccepted" | "InvitationDeliveryFailed"
  | "ProposalSubmitted" | "ConsentWindowOpened" | "ProposalDecided"
  | "RoleAssigned" | "RoleScopeUpdated" | "RoleUnassigned"
  | "CircleAssigned" | "CircleUnassigned"
  | "CommentAdded" | "StructureCommentAdded" | "GoalCommentAdded" | "ProjectCommentAdded" | "MeetingCommentAdded"
  | "GoalAssigned" | "KRAssigned" | "GoalUpdated"
  | "TaskAssigned" | "ProjectUpdated" | "MeetingScheduled" | "ReportPublished";

export type NotificationDetailKey =
  | "person" | "role" | "circle" | "scope" | "previousScope"
  | "startsAt" | "endsAt" | "deadline" | "decision" | "status"
  | "assignee" | "dueAt" | "location" | "occurrences" | "project" | "application";

export type NotificationContext = {
  resourceTitle?: string;
  excerpt?: string;
  details?: { key: NotificationDetailKey; value: string }[];
};

export type NotificationIntent = {
  eventId: string;
  event: NotificationEvent;
  ref: { type: string; id: string };
  recipients: { memberId: string; nominal: boolean }[];
  /** Platform expands current opt-in followers; domains never read platform tables. */
  followers?: boolean;
  /** Related resources whose opt-in also covers this event, e.g. a meeting's report. */
  followersOf?: { type: string; id: string }[];
  context?: NotificationContext;
  /** Actual actor for delegated/system outcomes; omitted uses the command account. */
  actorName?: string;
  includeActor?: boolean;
};

import type { Ctx } from "./runtime.js";

/** Stable, persisted domain outcome; the recipient is always the current inviter. */
export type InvitationLifecycleNotice = {
  eventId: string;
  event: "InvitationAccepted" | "InvitationDeliveryFailed";
  invitationId: string;
  recipientMemberId: string;
  actorName?: string;
  outcome?: "FAILED" | "OUTCOME_UNKNOWN";
};
export type InvitationLifecycleNotifier = (
  ctx: Ctx,
  notice: InvitationLifecycleNotice,
) => Promise<void>;

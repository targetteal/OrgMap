import type { Ctx } from "../../src/runtime.js";
/** No generic SQL/resource writer. Implementations own their resource ACL. */
export type InteroperabilityPorts = {
  calendar?: {
    list(ctx: Ctx, options?: {includePrivate:boolean}): Promise<import("./calendar.js").CalendarEvent[]>;
  };
  externalChange?: {
    apply(
      ctx: Ctx,
      input: {
        connectionId: string;
        eventId: string;
        command: "calendar.upsert";
        data: unknown;
      },
    ): Promise<void>;
  };
};

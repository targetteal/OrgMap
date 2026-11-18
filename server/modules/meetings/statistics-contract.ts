import type { Ctx } from "../../src/runtime.js";
import type {
  MeetingStatistics,
  MeetingStatisticsInput,
  MeetingStatisticsSelection,
  MeetingStatisticsSelectionOptions,
} from "./statistics-types.js";
export * from "./statistics-types.js";

export interface MeetingStatisticsPort {
  compute(ctx: Ctx, input: MeetingStatisticsInput): Promise<MeetingStatistics>;
  /** Internal export selection; IDs never appear in the HTTP statistics DTO. */
  computeSelection(
    ctx: Ctx,
    input: MeetingStatisticsInput,
    options?: MeetingStatisticsSelectionOptions,
  ): Promise<MeetingStatisticsSelection>;
}

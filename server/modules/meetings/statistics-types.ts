/** Browser-safe statistics DTOs. No runtime, authentication or database imports. */
export const MEETING_METRIC_NAMES = [
  "totalDuration",
  "averageDuration",
  "averageParticipants",
  "attendanceRate",
  "actionCompletionRate",
  "agendaCompletionRate",
  "activeOrganizers",
] as const;
export type MeetingMetricName = (typeof MEETING_METRIC_NAMES)[number];
export type MeetingMetric = {
  value: number | null;
  numerator: number;
  denominator: number | null;
  known: number;
  eligible: number;
  unit: "COUNT" | "SECONDS" | "RATIO";
};
export const MEETING_DISTRIBUTION_NAMES = [
  "state",
  "method",
  "circle",
  "template",
] as const;
export type MeetingDistributionName =
  (typeof MEETING_DISTRIBUTION_NAMES)[number];
export type MeetingStatisticsInput = {
  month: string;
  circleIds?: readonly string[];
};
export type MeetingStatistics = {
  period: {
    month: string;
    start: string;
    end: string;
    asOf: string;
    timezone: string;
  };
  selection: {
    basis: "AUTHORIZED_OCCURRENCES_BY_PLANNED_START";
    scopeHash: string;
  };
  counts: {
    observed: number | null;
    realized: number | null;
    running: number | null;
    cancelled: number | null;
  };
  metrics: Record<MeetingMetricName, MeetingMetric>;
  distributions: Record<
    MeetingDistributionName,
    { key: string | null; label: string; count: number }[]
  >;
  coverage: {
    state: "OBSERVED" | "PARTIAL" | "UNAVAILABLE";
    coveredFrom: string | null;
    snapshotKnown: number;
    snapshotMissing: number;
    durationMissing: number;
    source: "NATIVE_OBSERVATION" | "IMPORTED_PROVENANCE" | "MIXED";
    estimated: boolean;
  };
};
/** Trusted internal consumer intent, never accepted from the statistics HTTP query. */
export type MeetingStatisticsSelectionOptions = {
  excludeSupervised?: boolean;
  purpose?: "read" | "private-export";
};
export type MeetingStatisticsSelection = {
  statistics: MeetingStatistics;
  authorizedMeetingIds: string[];
};

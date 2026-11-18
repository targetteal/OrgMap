import type { RichDocument } from "@orgmap/content";

/** Native LF08 ABI. These are closed kinds, never aliases for RESOURCES. */
export const formatsByKind = {
  MEETING_ROWS: ["XLSX"],
  MEETING_REPORT_PDF: ["PDF"],
  MEETING_REPORT_BUNDLE: ["ZIP"],
  MEETING_MONTHLY_STATISTICS: ["XLSX"],
} as const;
export type MeetingExportKind = keyof typeof formatsByKind;
export type MeetingExportFormat = "XLSX" | "PDF" | "ZIP";
export type MeetingReportSource = "PUBLISHED" | "CURRENT_AUTHORIZED";
export interface MeetingExportRequest {
  kind: MeetingExportKind;
  format: MeetingExportFormat;
  circleIds?: string[];
  fromDate?: string;
  toDate?: string;
  endMonth?: string;
  includePrivate?: boolean;
  reportSource?: MeetingReportSource;
}
export interface AuthorizedRosterRow {
  memberId: string;
  label: string;
  attendance: "INVITED" | "PRESENT" | "ABSENT";
  participationRole: "REQUIRED" | "OPTIONAL";
}
export interface AuthorizedAgendaRow {
  id: string;
  title: string;
  presenterId: string;
  durationMinutes: number | null;
  status: "OPEN" | "COMPLETED" | "TRANSFERRED" | "WITHDRAWN";
  skipped: boolean;
}
export interface AuthorizedActionRow {
  id: string;
  agendaId: string | null;
  title: string;
  assigneeId: string;
  state: "OPEN" | "DONE";
}
export interface ReportRenderDocument {
  schemaVersion: 1;
  ref: {
    reportId: string;
    meetingId: string;
    reportVersion: number | null;
    publishedVersion: number | null;
    epoch: number;
    notesSeq: Record<string, number>;
  };
  title: string;
  circle: { id: string; label: string };
  state: "DRAFT" | "PUBLISHED";
  meeting: {
    plannedStart: string;
    actualStart: string | null;
    actualEnd: string | null;
    timezone: string;
  };
  sections: readonly { id: string; heading: string; body: RichDocument }[];
  roster: readonly AuthorizedRosterRow[];
  agenda: readonly AuthorizedAgendaRow[];
  actions: readonly AuthorizedActionRow[];
  capturedAt: string;
  coverage: string;
}
export interface PdfBundlePayload {
  schema: "orgmap-meeting-pdf-bundle-v1";
  documents: readonly ReportRenderDocument[];
  selectionId: string;
  asOf: string;
  timezone: string;
  reportSource: MeetingReportSource;
  coverage: string;
  notices: readonly ("EMPTY_AUTHORIZED_SELECTION" | "NO_PUBLISHED_REPORT")[];
}
export interface ReportPdfRenderer {
  render(document: ReportRenderDocument): Promise<{
    bytes: Uint8Array;
    pages: number;
    rendererVersion: string;
  }>;
}
export interface MeetingExportRow {
  meetingId: string;
  title: string;
  circleId: string;
  circleLabel: string;
  type: "CUSTOM" | "HOLACRACY";
  status: "CLOSED";
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  agendaCount: number;
  meetingUrl: string;
  reportUrl: string | null;
}
export const meetingExportBudgets = {
  maxReports: 100,
  maxPagesPerPdf: 50,
  maxArtifactBytes: 5 * 1024 * 1024,
} as const;

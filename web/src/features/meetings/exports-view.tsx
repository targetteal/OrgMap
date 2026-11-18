import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  ChartNoAxesColumn,
  Download,
  FileSpreadsheet,
  FileText,
  FolderArchive,
} from "lucide-react";
import type { FeatureContext } from "../../feature-contract";
import { useLocalization } from "../../localization";
import { Button, Notice } from "../../ui";
import type {
  MeetingExportFormat,
  MeetingExportKind,
  MeetingExportRequest,
  MeetingReportSource,
} from "../../../../server/modules/meetings/export-contract";
import {
  meetingExportTranslator,
  type MeetingExportMessageKey,
} from "./exports-messages";
type Capabilities = {
  formatsByKind: Partial<Record<MeetingExportKind, MeetingExportFormat[]>>;
  privateAvailable: boolean;
  queueAvailable: boolean;
};
type ExportJob = {
  id: string;
  state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  version: number;
  result?: { artifactId?: string };
  errorCode?: string;
};
type ExportResponse = {
  job: ExportJob;
  selectionSummary: {
    id: string;
    meetings: number;
    reports: number;
    months: number;
    excludedUnpublished: number;
    timezone: string;
    asOf: string;
  };
};
const labels: Record<MeetingExportKind, MeetingExportMessageKey> = {
  MEETING_ROWS: "rows",
  MEETING_REPORT_PDF: "pdf",
  MEETING_REPORT_BUNDLE: "bundle",
  MEETING_MONTHLY_STATISTICS: "statistics",
};

const icons = {
  MEETING_ROWS: FileSpreadsheet,
  MEETING_REPORT_PDF: FileText,
  MEETING_REPORT_BUNDLE: FolderArchive,
  MEETING_MONTHLY_STATISTICS: ChartNoAxesColumn,
};

export function MeetingExportsView({
  context: c,
}: {
  context: FeatureContext;
}) {
  const { locale, formatError, formatInstant, formatNumber, dateAtInstant } =
      useLocalization(),
    t = meetingExportTranslator(locale);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<MeetingExportKind>("MEETING_ROWS"),
    [format, setFormat] = useState<MeetingExportFormat>("XLSX");
  const [circleIds, setCircleIds] = useState<string[]>([]),
    [fromDate, setFromDate] = useState(""),
    [toDate, setToDate] = useState("");
  const [endMonth, setEndMonth] = useState(
      () => dateAtInstant(new Date())?.slice(0, 7) ?? "",
    ),
    [source, setSource] = useState<MeetingReportSource>("PUBLISHED"),
    [includePrivate, setIncludePrivate] = useState(false);
  const [sending, setSending] = useState(false),
    [selection, setSelection] = useState<
      ExportResponse["selectionSummary"] | null
    >(null),
    [job, setJob] = useState<ExportJob | null>(null),
    [revision, setRevision] = useState(0);
  const command = useRef<{ signature: string; key: string } | null>(null);
  const prefix = `/organizations/${c.organizationId}`,
    report = kind === "MEETING_REPORT_PDF" || kind === "MEETING_REPORT_BUNDLE",
    statistics = kind === "MEETING_MONTHLY_STATISTICS";
  const kinds = Object.keys(
    capabilities?.formatsByKind ?? {},
  ) as MeetingExportKind[];
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setCapabilities(null);
    setJob(null);
    setSelection(null);
    c.api<Capabilities>(prefix + "/meetings/exports/capabilities", {
      signal: abort.signal,
    })
      .then(({ data }) => {
        if (abort.signal.aborted) return;
        setCapabilities(data);
        const first = (
          Object.keys(data.formatsByKind) as MeetingExportKind[]
        )[0];
        if (first) {
          setKind(first);
          setFormat(data.formatsByKind[first]![0]);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(formatError(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [c.api, c.organizationId, locale]);
  useEffect(() => {
    if (!job) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      c
        .api<ExportJob>(prefix + "/platform/jobs/" + job.id, {
          signal: abort.signal,
        })
        .then(({ data }) => {
          if (abort.signal.aborted) return;
          setJob(data);
          if (["PENDING", "RUNNING"].includes(data.state))
            timer = setTimeout(poll, 2000);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(formatError(e));
        });
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [job?.id, revision, c.organizationId, c.api, locale]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending || !capabilities?.formatsByKind[kind]?.includes(format)) return;
    const request: MeetingExportRequest = {
      kind,
      format,
      ...(statistics
        ? { endMonth }
        : {
            ...(circleIds.length ? { circleIds } : {}),
            ...(fromDate ? { fromDate } : {}),
            ...(toDate ? { toDate } : {}),
          }),
      ...(report ? { reportSource: source } : {}),
      ...(capabilities.privateAvailable && includePrivate
        ? { includePrivate: true }
        : {}),
    };
    const signature = JSON.stringify(request);
    if (command.current?.signature !== signature)
      command.current = { signature, key: crypto.randomUUID() };
    setSending(true);
    setError("");
    try {
      const { data } = await c.api<ExportResponse>(
        prefix + "/meetings/exports",
        { method: "POST", body: request, key: command.current!.key },
      );
      setJob(data.job);
      setSelection(data.selectionSummary);
      command.current = null;
    } catch (e) {
      setError(formatError(e));
    } finally {
      setSending(false);
    }
  }
  async function download() {
    if (!job?.result?.artifactId) return;
    try {
      const { data } = await c.api<{
        name: string;
        mime: string;
        base64: string;
      }>(prefix + "/platform/artifacts/" + job.result.artifactId + "/download");
      const url = URL.createObjectURL(
          new Blob(
            [
              Uint8Array.from(atob(data.base64), (letter) =>
                letter.charCodeAt(0),
              ),
            ],
            { type: data.mime },
          ),
        ),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(formatError(e));
    }
  }
  return (
    <section className="meetings-page mare-meetings-report meetings-export">
      <header className="mare-meetings-report-heading">
        <h2>{t("exports")}</h2>
        <Button onClick={() => c.navigate("/platform/jobs")}>
          {t("jobs")} <ArrowUpRight size={16} aria-hidden="true" />
        </Button>
      </header>
      {error && <Notice>{error}</Notice>}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : !kinds.length ? (
        <p className="empty-state">{t("unavailable")}</p>
      ) : (
        <form className="mare-exports-form" onSubmit={submit}>
          <div className="mare-exports-content">
            <fieldset className="mare-export-kinds">
              <legend>{t("kind")}</legend>
              {kinds.map((value) => {
                const Icon = icons[value];
                return (
                  <label key={value}>
                    <Icon size={19} aria-hidden="true" />
                    <span>{t(labels[value])}</span>
                    <input
                      type="radio"
                      name="meeting-export-kind"
                      checked={kind === value}
                      onChange={() => {
                        setKind(value);
                        setFormat(capabilities!.formatsByKind[value]![0]);
                      }}
                    />
                  </label>
                );
              })}
            </fieldset>
            <label className="field">
              {t("format")}
              <select
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as MeetingExportFormat)
                }
              >
                {capabilities?.formatsByKind[kind]?.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mare-exports-scope">
            {statistics ? (
              <>
                <label className="field">
                  {t("endMonth")}
                  <input
                    type="month"
                    required
                    value={endMonth}
                    onChange={(e) => setEndMonth(e.target.value)}
                  />
                </label>
                <p className="muted">{t("statisticsHint")}</p>
              </>
            ) : (
              <>
                <div className="mare-exports-dates">
                  <label className="field">
                    {t("from")}
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    {t("until")}
                    <input
                      type="date"
                      value={toDate}
                      min={fromDate || undefined}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  </label>
                </div>
                <fieldset className="mare-export-circles">
                  <legend>{t("circles")}</legend>
                  <p>{t("circlesHint")}</p>
                  <div className="mare-export-circle-list">
                    {c.structure.nodes
                      .filter((node) => node.kind === "CIRCLE")
                      .map((node) => (
                        <label key={node.nodeId}>
                          <input
                            type="checkbox"
                            checked={circleIds.includes(node.entityId)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setCircleIds((current) =>
                                checked
                                  ? [...current, node.entityId]
                                  : current.filter(
                                      (id) => id !== node.entityId,
                                    ),
                              );
                            }}
                          />
                          {node.name}
                        </label>
                      ))}
                  </div>
                </fieldset>
                {report && (
                  <>
                    <label className="field">
                      {t("source")}
                      <select
                        value={source}
                        onChange={(e) =>
                          setSource(e.target.value as MeetingReportSource)
                        }
                      >
                        <option value="PUBLISHED">{t("published")}</option>
                        <option value="CURRENT_AUTHORIZED">
                          {t("current")}
                        </option>
                      </select>
                    </label>
                    <p className="muted">{t("sourceHint")}</p>
                  </>
                )}
                {kind === "MEETING_REPORT_PDF" && (
                  <p className="muted">{t("singleHint")}</p>
                )}
              </>
            )}
            {capabilities?.privateAvailable && (
              <label className="mare-export-private">
                <input
                  type="checkbox"
                  checked={includePrivate}
                  onChange={(e) => setIncludePrivate(e.target.checked)}
                />{" "}
                {t("private")}
              </label>
            )}
          </div>
          <footer className="mare-exports-footer">
            <p>{t("frozenHint")}</p>
            <button
              className="primary"
              type="submit"
              disabled={sending || !capabilities?.queueAvailable}
            >
              <Download size={17} aria-hidden="true" />{" "}
              {t(sending ? "requesting" : "request")}
            </button>
          </footer>
        </form>
      )}
      {job && (
        <section className="mare-export-job" aria-live="polite">
          <h3>{t("queued")}</h3>
          {selection && (
            <>
              <p>
                {t("selectionSummary", {
                  meetings: formatNumber(selection.meetings),
                  reports: formatNumber(selection.reports),
                  months: formatNumber(selection.months),
                })}
              </p>
              {selection.excludedUnpublished > 0 && (
                <p>
                  {t("unpublishedExcluded", {
                    count: formatNumber(selection.excludedUnpublished),
                  })}
                </p>
              )}
            </>
          )}
          <p>
            {t(job.state)}
            {selection
              ? " · " +
                formatInstant(selection.asOf) +
                " · " +
                selection.timezone
              : ""}
          </p>
          {job.state === "FAILED" && <Notice>{t("failedHint")}</Notice>}
          <Button onClick={() => setRevision((value) => value + 1)}>
            {t("refresh")}
          </Button>
          {job.state === "COMPLETED" && job.result?.artifactId && (
            <Button onClick={() => void download()}>{t("download")}</Button>
          )}
        </section>
      )}
    </section>
  );
}

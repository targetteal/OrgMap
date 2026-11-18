import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { FeatureContext } from "../../feature-contract";
import { Button, Dialog, Field, Notice } from "../../ui";
import { RichTextEditor } from "../../editor";
import { RichTextView } from "../../editor/RichTextView";
import { ResourcePanel } from "../platform/index";
import { useLocalization } from "../../localization";
import {
  emptyRichDocument,
  toPlainText,
  type RichDocument,
} from "../../../../packages/content/index.js";
import { agendaTranslator, type AgendaMessageKey } from "./agenda-messages";

export type AgendaItemState =
  "PARKED" | "ASSIGNED" | "NEEDS_RESCHEDULE" | "COMPLETED" | "ARCHIVED";
export type AgendaResult = {
  item: {
    id: string;
    title: string;
    descriptionRich: RichDocument;
    state: AgendaItemState;
    ownerId: string | null;
    circleId: string | null;
    expectedDurationMinutes: number | null;
    version: number;
    identityCoverage: "NATIVE" | "LEGACY_PLACEMENT";
  };
  placement?: {
    id: string;
    meetingId: string;
    meetingTitle: string;
    meetingVersion: number;
    presenterId: string | null;
    status: string;
    version: number;
  };
  capabilities: {
    edit: boolean;
    schedule: boolean;
    reschedule: boolean;
    unschedule: boolean;
    archive: boolean;
    adopt: boolean;
  };
  coverage: {
    identityCoverage: "NATIVE" | "LEGACY_PLACEMENT";
    historyRedacted: boolean;
  };
};
export type AgendaTarget = {
  id: string;
  title: string;
  version: number;
  circleId: string;
  state: string;
};
type AgendaPage = {
  items: AgendaResult[];
  page: { hasMore: boolean; nextCursor: string | null };
};
type DialogKind =
  | "create"
  | "edit"
  | "schedule"
  | "reschedule"
  | "unschedule"
  | "archive"
  | "adopt";
type DialogState = { kind: DialogKind; source?: AgendaResult };
type Filters = { state: string; search: string; circleId: string };
const stateLabels: Record<AgendaItemState, AgendaMessageKey> = {
  PARKED: "parked",
  ASSIGNED: "assigned",
  NEEDS_RESCHEDULE: "needsReschedule",
  COMPLETED: "completed",
  ARCHIVED: "archived",
};
const initialFilters: Filters = { state: "PARKED", search: "", circleId: "" };

/** Targets are server-authorized; local filtering only narrows that result. */
export function eligibleAgendaTargets(
  targets: AgendaTarget[],
  source?: AgendaResult,
  reschedule = false,
) {
  return targets.filter(
    (target) =>
      ["SCHEDULED", "RUNNING"].includes(target.state) &&
      (!source?.item.circleId || target.circleId === source.item.circleId) &&
      (!reschedule || target.id !== source?.placement?.meetingId),
  );
}
function useAgendaLocalization() {
  const localization = useLocalization();
  const t = useMemo(
    () => agendaTranslator(localization.locale),
    [localization.locale],
  );
  return { ...localization, t };
}
function circleName(
  context: FeatureContext,
  id: string | null,
  fallback: string,
) {
  if (!id) return fallback;
  const circle = context.structure.circles.find((entry) => entry.id === id);
  return (
    context.structure.nodes.find(
      (node) => node.entityId === id || node.nodeId === circle?.nodeId,
    )?.name ?? fallback
  );
}

export function AgendaItemsView({ context }: { context: FeatureContext }) {
  const { t } = useAgendaLocalization();
  if (context.bootstrap.membership.memberType === "GUEST")
    return (
      <div className="meetings-page">
        <header className="page-heading">
          <h1>{t("agendaItems")}</h1>
        </header>
        <Notice>{t("unavailableGuest")}</Notice>
      </div>
    );
  return (
    <AgendaItemsConsumer
      key={`${context.organizationId}:${context.bootstrap.membership.id}`}
      context={context}
    />
  );
}

function AgendaItemsConsumer({ context }: { context: FeatureContext }) {
  const { t, formatNumber, formatError } = useAgendaLocalization();
  const base = `/organizations/${context.organizationId}/meeting-agenda-items`;
  const [filters, setFilters] = useState(initialFilters);
  const [filterDraft, setFilterDraft] = useState(initialFilters);
  const [items, setItems] = useState<AgendaResult[]>([]);
  const [page, setPage] = useState<AgendaPage["page"]>({
    hasMore: false,
    nextCursor: null,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgendaResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const moreController = useRef<AbortController | null>(null);

  function listPath(cursor?: string | null) {
    const query = new URLSearchParams({ limit: "50" });
    if (filters.state) query.set("state", filters.state);
    if (filters.search) query.set("search", filters.search);
    if (filters.circleId) query.set("circleId", filters.circleId);
    if (cursor) query.set("cursor", cursor);
    return `${base}?${query}`;
  }
  useEffect(() => {
    const controller = new AbortController();
    moreController.current?.abort();
    setLoading(true);
    setLoadingMore(false);
    setListError(null);
    setItems([]);
    setPage({ hasMore: false, nextCursor: null });
    void context
      .api<AgendaPage>(listPath(), { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setItems(response.data.items);
        setPage(response.data.page);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      moreController.current?.abort();
    };
  }, [base, filters, revision]);
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    void context
      .api<AgendaResult>(`${base}/${encodeURIComponent(selectedId)}`, {
        signal: controller.signal,
      })
      .then((response) => {
        if (!controller.signal.aborted) setDetail(response.data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [base, selectedId, detailRevision]);

  async function loadMore() {
    if (loading || loadingMore || !page.hasMore || !page.nextCursor) return;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = controller;
    setLoadingMore(true);
    setListError(null);
    try {
      const response = await context.api<AgendaPage>(
        listPath(page.nextCursor),
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setItems((previous) => {
        const seen = new Set(previous.map((result) => result.item.id));
        return [
          ...previous,
          ...response.data.items.filter((result) => !seen.has(result.item.id)),
        ];
      });
      setPage(response.data.page);
    } catch (error) {
      if (!controller.signal.aborted) setListError(error);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }
  function refresh() {
    setRevision((value) => value + 1);
    setDetailRevision((value) => value + 1);
  }
  function saved(result?: AgendaResult) {
    setDialog(null);
    setSelectedId(result?.item.id ?? null);
    setDetail(result ?? null);
    setDetailError(null);
    context.notify(t("changed"));
    refresh();
  }
  const ownerName = (ownerId: string | null) =>
    ownerId
      ? (context.members.find((member) => member.id === ownerId)?.displayName ??
        t("memberUnavailable"))
      : t("unknownOwner");
  const duration = (minutes: number | null) =>
    minutes === null
      ? t("undefinedDuration")
      : t("minutes", { count: formatNumber(minutes) });
  const legacy =
    detail &&
    (detail.coverage.identityCoverage === "LEGACY_PLACEMENT" ||
      detail.item.identityCoverage === "LEGACY_PLACEMENT");
  return (
    <div className="meetings-page">
      <header className="page-heading">
        <div>
          <h1>{t("agendaItems")}</h1>
          <p className="muted">{t("parkingHelp")}</p>
        </div>
        <Button
          className="primary"
          onClick={() => setDialog({ kind: "create" })}
        >
          <Plus size={16} aria-hidden="true" />
          {t("create")}
        </Button>
      </header>
      <form
        className="collection-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSelectedId(null);
          setFilters({ ...filterDraft, search: filterDraft.search.trim() });
        }}
      >
        <Field label={t("state")} name="state">
          <select
            name="state"
            value={filterDraft.state}
            onChange={(event) =>
              setFilterDraft((value) => ({
                ...value,
                state: event.target.value,
              }))
            }
          >
            <option value="">{t("allStates")}</option>
            {Object.entries(stateLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("search")} name="search">
          <input
            name="search"
            type="search"
            maxLength={200}
            value={filterDraft.search}
            onChange={(event) =>
              setFilterDraft((value) => ({
                ...value,
                search: event.target.value,
              }))
            }
          />
        </Field>
        <Field label={t("circle")} name="circleId">
          <select
            name="circleId"
            value={filterDraft.circleId}
            onChange={(event) =>
              setFilterDraft((value) => ({
                ...value,
                circleId: event.target.value,
              }))
            }
          >
            <option value="">{t("allCircles")}</option>
            {context.structure.circles.map((circle) => (
              <option key={circle.id} value={circle.id}>
                {circleName(context, circle.id, t("unavailableCircle"))}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit">{t("applyFilters")}</button>
        <Button onClick={refresh} disabled={loading || loadingMore}>
          <RefreshCw size={15} aria-hidden="true" />
          {t("refresh")}
        </Button>
      </form>
      {listError != null && (
        <Notice>
          {formatError(listError)}{" "}
          <Button onClick={() => setRevision((value) => value + 1)}>
            {t("retry")}
          </Button>
        </Notice>
      )}
      {loading ? (
        <div className="meetings-loading" role="status">
          {t("loading")}
        </div>
      ) : (
        <div className="meetings-list">
          {!listError && !items.length && (
            <div className="empty-state">
              <h2>{t("emptyTitle")}</h2>
              <p>{t("emptyHelp")}</p>
            </div>
          )}
          {items.map((result) => (
            <button
              type="button"
              key={result.item.id}
              className={`meetings-agenda-row meetings-list-row ${selectedId === result.item.id ? "meetings-selected" : ""}`}
              aria-label={t("openItem", { title: result.item.title })}
              aria-pressed={selectedId === result.item.id}
              onClick={() => setSelectedId(result.item.id)}
            >
              <div>
                <strong>{result.item.title}</strong>
                <small>
                  {circleName(
                    context,
                    result.item.circleId,
                    t(result.item.circleId ? "unavailableCircle" : "personal"),
                  )}{" "}
                  · {duration(result.item.expectedDurationMinutes)}
                </small>
              </div>
              <span className="badge">{t(stateLabels[result.item.state])}</span>
            </button>
          ))}
          {page.hasMore && page.nextCursor && (
            <div className="meetings-pagination">
              <Button disabled={loadingMore} onClick={() => void loadMore()}>
                {t(loadingMore ? "loading" : "loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
      {selectedId && (
        <section
          className="meetings-stage"
          aria-label={t("itemDetails")}
          aria-busy={detailLoading}
        >
          {detailLoading && <p role="status">{t("detailLoading")}</p>}
          {detailError != null && (
            <Notice>
              {formatError(detailError)}{" "}
              <Button onClick={() => setDetailRevision((value) => value + 1)}>
                {t("retry")}
              </Button>
            </Notice>
          )}
          {detail && (
            <>
              <div className="meetings-stage-heading">
                <h2>{detail.item.title}</h2>
                <Button onClick={() => setSelectedId(null)}>
                  {t("close")}
                </Button>
              </div>
              <span className="badge">{t(stateLabels[detail.item.state])}</span>
              <dl>
                <dt>{t("owner")}</dt>
                <dd>{ownerName(detail.item.ownerId)}</dd>
                <dt>{t("circle")}</dt>
                <dd>
                  {circleName(
                    context,
                    detail.item.circleId,
                    t(detail.item.circleId ? "unavailableCircle" : "personal"),
                  )}
                </dd>
                <dt>{t("expectedDuration")}</dt>
                <dd>{duration(detail.item.expectedDurationMinutes)}</dd>
              </dl>
              {legacy && <Notice>{t("legacyCoverage")}</Notice>}
              {detail.coverage.historyRedacted && (
                <Notice>{t("historyRedacted")}</Notice>
              )}
              {detail.placement && (
                <p>
                  {t(
                    detail.item.state === "ASSIGNED"
                      ? "meeting"
                      : "previousMeeting",
                  )}
                  : {detail.placement.meetingTitle}{" "}
                  <Button
                    onClick={() =>
                      context.navigate(
                        `/meetings/${encodeURIComponent(detail.placement!.meetingId)}`,
                      )
                    }
                  >
                    {t("openMeeting")}
                  </Button>
                </p>
              )}
              <div className="meetings-notes">
                <h3>{t("description")}</h3>
                <RichTextView
                  value={detail.item.descriptionRich}
                  label={t("description")}
                  emptyText={t("noDescription")}
                />
              </div>
              <div className="meetings-inline-actions">
                {(
                  [
                    "edit",
                    "schedule",
                    "reschedule",
                    "unschedule",
                    "archive",
                    "adopt",
                  ] as const
                ).map(
                  (kind) =>
                    detail.capabilities[kind] && (
                      <Button
                        key={kind}
                        onClick={() => setDialog({ kind, source: detail })}
                      >
                        {t(kind)}
                      </Button>
                    ),
                )}
              </div>
              <ResourcePanel
                context={context}
                type="agenda-item"
                resourceId={detail.item.id}
              />
            </>
          )}
        </section>
      )}
      {dialog && (
        <AgendaItemDialog
          key={`${dialog.kind}:${dialog.source?.item.id ?? "new"}`}
          context={context}
          state={dialog}
          onClose={() => setDialog(null)}
          onSuccess={saved}
        />
      )}
    </div>
  );
}

function AgendaItemDialog({
  context,
  state,
  onClose,
  onSuccess,
}: {
  context: FeatureContext;
  state: DialogState;
  onClose: () => void;
  onSuccess: (result?: AgendaResult) => void;
}) {
  const { t, formatError } = useAgendaLocalization();
  const base = `/organizations/${context.organizationId}/meeting-agenda-items`;
  const kind = state.kind;
  const editing = kind === "create" || kind === "edit";
  const scheduling = kind === "schedule" || kind === "reschedule";
  const needsReason = ["unschedule", "archive", "adopt"].includes(kind);
  const [source, setSource] = useState(state.source);
  const [title, setTitle] = useState(state.source?.item.title ?? "");
  const [description, setDescription] = useState(
    () => state.source?.item.descriptionRich ?? emptyRichDocument(),
  );
  const [duration, setDuration] = useState(
    String(state.source?.item.expectedDurationMinutes ?? ""),
  );
  const [reason, setReason] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [presenterId, setPresenterId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [targets, setTargets] = useState<AgendaTarget[]>([]);
  const [targetLoading, setTargetLoading] = useState(scheduling);
  const [targetError, setTargetError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<AgendaMessageKey | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reviewedSource, setReviewedSource] = useState(false);
  const [changed, setChanged] = useState(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const targetController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const members = context.members.filter(
    (member) => member.status === "ACTIVE" && member.memberType === "MEMBER",
  );
  const availableTargets = eligibleAgendaTargets(
    targets,
    source,
    kind === "reschedule",
  );
  const selectedTarget = availableTargets.find(
    (target) => target.id === targetId,
  );
  const unavailable =
    kind !== "create" && (!source || !source.capabilities[kind]);
  const blocked = busy || refreshing;

  useEffect(() => {
    mounted.current = true;
    if (scheduling) {
      const controller = new AbortController();
      targetController.current = controller;
      void context
        .api<{ items: AgendaTarget[] }>(`${base}/targets`, {
          signal: controller.signal,
        })
        .then((response) => {
          if (!controller.signal.aborted) setTargets(response.data.items);
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setTargetError(failure);
        })
        .finally(() => {
          if (!controller.signal.aborted) setTargetLoading(false);
        });
    }
    return () => {
      mounted.current = false;
      targetController.current?.abort();
    };
  }, [base, scheduling]);
  useEffect(
    () =>
      context.registerNavigationGuard?.(() =>
        changed || busy ? t("draftGuard") : null,
      ),
    [context.registerNavigationGuard, changed, busy, t],
  );
  useEffect(() => {
    if (!changed) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [changed]);

  async function refreshReferences() {
    if (blocked) return;
    setRefreshing(true);
    setError(null);
    setTargetError(null);
    setValidation(null);
    targetController.current?.abort();
    const controller = new AbortController();
    targetController.current = controller;
    try {
      // Read fresh versions without replacing any title, description, reason, or member draft.
      const [itemResponse, targetResponse] = await Promise.all([
        source
          ? context.api<AgendaResult>(
              `${base}/${encodeURIComponent(source.item.id)}`,
              { signal: controller.signal },
            )
          : Promise.resolve(null),
        scheduling
          ? context.api<{ items: AgendaTarget[] }>(`${base}/targets`, {
              signal: controller.signal,
            })
          : Promise.resolve(null),
      ]);
      if (!mounted.current || controller.signal.aborted) return;
      if (itemResponse) {
        setSource(itemResponse.data);
        setReviewedSource(true);
      }
      if (targetResponse) {
        setTargets(targetResponse.data.items);
        if (
          !eligibleAgendaTargets(
            targetResponse.data.items,
            itemResponse?.data ?? source,
            kind === "reschedule",
          ).some((target) => target.id === targetId)
        )
          setTargetId("");
      }
      setConflict(false);
      setTargetLoading(false);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(failure);
    } finally {
      if (mounted.current && !controller.signal.aborted) setRefreshing(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || unavailable || conflict) return;
    setValidation(null);
    setError(null);
    let body: Record<string, unknown>;
    if (editing) {
      if (!title.trim() || Array.from(title.trim()).length > 200) {
        setValidation("invalidTitle");
        return;
      }
      const minutes = duration.trim() === "" ? null : Number(duration);
      if (
        minutes !== null &&
        (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)
      ) {
        setValidation("invalidDuration");
        return;
      }
      if (Array.from(toPlainText(description)).length > 20_000) {
        setValidation("invalidDescription");
        return;
      }
      body = {
        title: title.trim(),
        descriptionRich: description,
        expectedDurationMinutes: minutes,
      };
    } else if (scheduling) {
      if (!selectedTarget) {
        setValidation("invalidTarget");
        return;
      }
      if (
        kind === "schedule" &&
        presenterId &&
        !members.some((member) => member.id === presenterId)
      ) {
        setValidation("invalidMember");
        return;
      }
      if (kind === "reschedule" && !source?.placement) {
        setValidation("invalidTarget");
        return;
      }
      body = {
        targetMeetingId: selectedTarget.id,
        expectedTargetVersion: selectedTarget.version,
        ...(kind === "reschedule"
          ? { expectedSourceVersion: source!.placement!.meetingVersion }
          : {}),
        ...(kind === "schedule" && presenterId
          ? { presenterMemberId: presenterId }
          : {}),
      };
    } else {
      if (!reason.trim()) {
        setValidation("invalidReason");
        return;
      }
      if (
        kind === "adopt" &&
        !members.some((member) => member.id === ownerId)
      ) {
        setValidation("invalidMember");
        return;
      }
      body = {
        reason: reason.trim(),
        ...(kind === "adopt" ? { ownerMemberId: ownerId } : {}),
      };
    }
    const version = source?.item.version;
    const signature = JSON.stringify({
      kind,
      id: source?.item.id,
      version,
      body,
    });
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const response = await context.api<AgendaResult | { itemId: string }>(
        kind === "create"
          ? base
          : `${base}/${encodeURIComponent(source!.item.id)}${kind === "edit" ? "" : `/actions/${kind}`}`,
        {
          method: kind === "edit" ? "PATCH" : "POST",
          body,
          version,
          key: attempt.current!.key,
        },
      );
      if (mounted.current)
        onSuccess("item" in response.data ? response.data : undefined);
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure);
      const code = (failure as { code?: string } | null)?.code;
      if (
        [
          "VERSION_CONFLICT",
          "STATE_CONFLICT",
          "PRECONDITION_REQUIRED",
        ].includes(code ?? "")
      )
        setConflict(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const help: Partial<Record<DialogKind, AgendaMessageKey>> = {
    create: "createHelp",
    unschedule: "unscheduleHelp",
    archive: "archiveHelp",
    adopt: "adoptHelp",
  };
  return (
    <Dialog
      title={t(kind)}
      hideClose={blocked}
      onClose={() => {
        if (!blocked) onClose();
      }}
    >
      <form className="edit-form" onSubmit={(event) => void submit(event)}>
        {help[kind] && <p>{t(help[kind]!)}</p>}
        {state.source && (
          <p>
            <strong>{state.source.item.title}</strong>
          </p>
        )}
        {validation && <Notice>{t(validation)}</Notice>}
        {error != null && !conflict && <Notice>{formatError(error)}</Notice>}
        {conflict && <Notice>{t("conflict")}</Notice>}
        {(conflict || targetError != null) && (
          <Button disabled={blocked} onClick={() => void refreshReferences()}>
            {t("refreshDraft")}
          </Button>
        )}
        {targetError != null && <Notice>{formatError(targetError)}</Notice>}
        {unavailable && <Notice>{t("actionUnavailable")}</Notice>}
        {reviewedSource && source && (
          <details className="meetings-history">
            <summary>{t("serverVersion")}</summary>
            <p>
              {source.item.title} · {t(stateLabels[source.item.state])}
            </p>
            <RichTextView
              value={source.item.descriptionRich}
              emptyText={t("noDescription")}
            />
          </details>
        )}
        <fieldset
          disabled={blocked || unavailable}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          onChange={() => setChanged(true)}
        >
          {editing && (
            <>
              <Field label={t("titleField")} name="title">
                <input
                  name="title"
                  required
                  maxLength={400}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoComplete="off"
                />
              </Field>
              <RichTextEditor
                label={t("description")}
                value={description}
                onChange={(document) => {
                  setDescription(document);
                  setChanged(true);
                }}
                readOnly={blocked || unavailable}
                pending={busy}
              />
              <Field
                label={t("expectedDuration")}
                name="expectedDurationMinutes"
              >
                <input
                  name="expectedDurationMinutes"
                  type="number"
                  min={0}
                  max={1440}
                  step={1}
                  value={duration}
                  placeholder={t("undefinedDuration")}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </Field>
              <p>{t("durationHelp")}</p>
            </>
          )}
          {scheduling && (
            <>
              {targetLoading ? (
                <p role="status">{t("loading")}</p>
              ) : (
                <>
                  <Field label={t("targetMeeting")} name="targetMeetingId">
                    <select
                      name="targetMeetingId"
                      required
                      value={targetId}
                      onChange={(event) => setTargetId(event.target.value)}
                    >
                      <option value="">{t("chooseTarget")}</option>
                      {availableTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {!availableTargets.length && !targetError && (
                    <p>{t("noTargets")}</p>
                  )}
                </>
              )}
              {kind === "schedule" && (
                <Field label={t("presenter")} name="presenterMemberId">
                  <select
                    name="presenterMemberId"
                    value={presenterId}
                    onChange={(event) => setPresenterId(event.target.value)}
                  >
                    <option value="">{t("presenterDefault")}</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          {kind === "adopt" && (
            <Field label={t("owner")} name="ownerMemberId">
              <select
                name="ownerMemberId"
                required
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                <option value="">{t("chooseOwner")}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {needsReason && (
            <Field label={t("reason")} name="reason">
              <textarea
                name="reason"
                rows={3}
                required
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
        </fieldset>
        <div className="form-actions">
          <Button disabled={blocked} onClick={onClose}>
            {t("cancel")}
          </Button>
          <button
            type="submit"
            className="primary"
            disabled={
              blocked ||
              unavailable ||
              conflict ||
              (scheduling && (targetLoading || !selectedTarget))
            }
          >
            {t(busy ? "saving" : editing ? "save" : "confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

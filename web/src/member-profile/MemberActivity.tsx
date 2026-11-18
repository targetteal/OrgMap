import { useEffect, useRef, useState } from "react";
import { FolderKanban, RefreshCw, Target } from "lucide-react";
import type { FeatureContext } from "../feature-contract";
import { RequestError } from "../api";
import { parseInstant, useLocalization } from "../localization";
import {
  memberActivityTranslator,
  type MemberActivityMessageKey,
} from "./messages";
import "./member-activity.css";

export type MemberActivityKind = "PROJECT" | "GOAL";
export type MemberActivityItem = {
  id: string;
  title: string;
  href: string;
  status?: string;
  reasons: string[];
};
export type MemberActivityPage = {
  items: MemberActivityItem[];
  nextCursor: string | null;
  asOf: string;
  coverage: {
    scope: "CURRENT_VIEWER_AUTHORIZED_RELATIONS";
    completeness: "COMPLETE" | "PARTIAL";
    limitations: "ROLE_CAPACITY_UNAVAILABLE"[];
  };
};
export type MemberActivityProps = {
  context: FeatureContext;
  memberId: string;
  kind: MemberActivityKind;
};
type ReadError =
  | { kind: "semantic"; key: MemberActivityMessageKey }
  | { kind: "shared"; code: string };
type State = {
  items: MemberActivityItem[] | null;
  nextCursor: string | null;
  coverage: MemberActivityPage["coverage"] | null;
  asOf: string | null;
  loading: boolean;
  error: ReadError | null;
  failedCursor: string | null;
};
const initialState: State = {
  items: null,
  nextCursor: null,
  coverage: null,
  asOf: null,
  loading: true,
  error: null,
  failedCursor: null,
};
const PAGE_SIZE = 50;
const statusKeys: Record<string, MemberActivityMessageKey> = {
  ACTIVE: "active",
  OPEN: "active",
  IN_PROGRESS: "active",
  DRAFT: "draft",
  PLANNED: "planned",
  NOT_STARTED: "planned",
  PAUSED: "paused",
  ON_HOLD: "paused",
  FROZEN: "frozen",
  COMPLETED: "completed",
  DONE: "completed",
  CLOSED: "closed",
  CANCELLED: "cancelled",
  CANCELED: "cancelled",
  ARCHIVED: "archived",
  ON_TRACK: "onTrack",
  AT_RISK: "atRisk",
  OFF_TRACK: "offTrack",
};
const reasonKeys: Record<string, MemberActivityMessageKey> = {
  PROJECT_PARTICIPANT: "projectParticipant",
  TASK_ASSIGNEE: "taskAssignee",
  GOAL_RESPONSIBLE: "goalResponsible",
  RESULT_RESPONSIBLE: "resultResponsible",
};

/** Profile visibility never grants access to a linked resource. The readers apply both ACLs. */
export function MemberActivity(props: MemberActivityProps) {
  const c = props.context;
  return (
    <ActivityList
      key={JSON.stringify([
        c.organizationId,
        props.memberId,
        props.kind,
        c.session.account.id,
        c.bootstrap.membership.id,
        c.bootstrap.authorizationRevision,
      ])}
      {...props}
    />
  );
}

/** Always derive the local route from the resource identity; supplied href is never navigated. */
export function memberActivityPath(
  kind: MemberActivityKind,
  id: string,
): string | null {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(id)
    ? `/${kind === "PROJECT" ? "projects" : "goals"}/${encodeURIComponent(id)}`
    : null;
}

function readError(error: unknown): ReadError {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "REQUEST_FAILED";
  if (
    [
      "ACTION_DENIED",
      "PROFILE_READ_DENIED",
      "MEMBER_PROFILE_READ_DENIED",
    ].includes(code)
  )
    return { kind: "semantic", key: "denied" };
  if (
    ["RESOURCE_NOT_FOUND", "MEMBER_NOT_FOUND", "PROFILE_NOT_FOUND"].includes(
      code,
    )
  )
    return { kind: "semantic", key: "notFound" };
  if (code === "MODULE_DISABLED")
    return { kind: "semantic", key: "moduleUnavailable" };
  if (
    code.endsWith("AUTHORITY_UNAVAILABLE") ||
    code.endsWith("PROVIDER_UNAVAILABLE") ||
    [
      "SERVICE_UNAVAILABLE",
      "MODULE_CONFIGURATION_UNAVAILABLE",
      "MEMBER_ACTIVITY_UNAVAILABLE",
      "PROFILE_READER_UNAVAILABLE",
    ].includes(code)
  )
    return { kind: "semantic", key: "unavailable" };
  if (code === "INVALID_RESPONSE")
    return { kind: "semantic", key: "invalidResponse" };
  return { kind: "shared", code };
}
function discardsPrevious(error: ReadError): boolean {
  return (
    (error.kind === "semantic" &&
      ["denied", "notFound", "unavailable", "moduleUnavailable"].includes(
        error.key,
      )) ||
    (error.kind === "shared" &&
      ["UNAUTHENTICATED", "ORG_CREDENTIAL_REQUIREMENT_UNMET"].includes(
        error.code,
      ))
  );
}
function parsePage(
  value: unknown,
  kind: MemberActivityKind,
): MemberActivityPage {
  if (!value || typeof value !== "object")
    throw new RequestError("INVALID_RESPONSE", "INVALID_RESPONSE");
  const page = value as Partial<MemberActivityPage>;
  if (
    !Array.isArray(page.items) ||
    page.items.length > 100 ||
    !(
      page.nextCursor === null ||
      (typeof page.nextCursor === "string" && page.nextCursor.length > 0)
    ) ||
    typeof page.asOf !== "string" ||
    !parseInstant(page.asOf) ||
    page.coverage?.scope !== "CURRENT_VIEWER_AUTHORIZED_RELATIONS" ||
    !["COMPLETE", "PARTIAL"].includes(page.coverage.completeness) ||
    !Array.isArray(page.coverage.limitations) ||
    page.coverage.limitations.some(
      (value) => value !== "ROLE_CAPACITY_UNAVAILABLE",
    ) ||
    !page.items.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        memberActivityPath(kind, item.id) &&
        typeof item.title === "string" &&
        item.title.trim().length > 0 &&
        typeof item.href === "string" &&
        (item.status === undefined || typeof item.status === "string") &&
        Array.isArray(item.reasons) &&
        item.reasons.every((reason) => typeof reason === "string"),
    )
  )
    throw new RequestError("INVALID_RESPONSE", "INVALID_RESPONSE");
  return page as MemberActivityPage;
}

function ActivityList({ context: c, memberId, kind }: MemberActivityProps) {
  const { locale, formatNumber, formatInstant, formatError } =
    useLocalization();
  const t = memberActivityTranslator(locale);
  const [state, setState] = useState<State>(initialState);
  const requestRef = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const seenCursors = useRef(new Set<string>());
  const endpoint = `/organizations/${encodeURIComponent(c.organizationId)}/${kind === "PROJECT" ? "work" : "goals"}/members/${encodeURIComponent(memberId)}/${kind === "PROJECT" ? "projects" : "goals"}`;

  async function loadPage(cursor: string | null, replace = false) {
    if (busy.current) return;
    busy.current = true;
    if (replace) seenCursors.current.clear();
    const controller = new AbortController();
    requestRef.current = controller;
    setState((previous) => ({
      ...(replace ? initialState : previous),
      loading: true,
      error: null,
    }));
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor !== null) query.set("cursor", cursor);
      const response = await c.api<unknown>(`${endpoint}?${query}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const page = parsePage(response.data, kind);
      if (
        page.nextCursor &&
        (page.nextCursor === cursor || seenCursors.current.has(page.nextCursor))
      )
        throw new RequestError("INVALID_RESPONSE", "INVALID_RESPONSE");
      if (cursor) seenCursors.current.add(cursor);
      setState((previous) => {
        const items = new Map(
          (replace ? [] : (previous.items ?? [])).map((item) => [
            item.id,
            item,
          ]),
        );
        for (const item of page.items) items.set(item.id, item);
        const partial =
          page.coverage.completeness === "PARTIAL" ||
          (!replace && previous.coverage?.completeness === "PARTIAL");
        return {
          items: [...items.values()],
          nextCursor: page.nextCursor,
          asOf: page.asOf,
          coverage: {
            ...page.coverage,
            completeness: partial ? "PARTIAL" : "COMPLETE",
            limitations: [
              ...new Set([
                ...(replace ? [] : (previous.coverage?.limitations ?? [])),
                ...page.coverage.limitations,
              ]),
            ],
          },
          loading: false,
          error: null,
          failedCursor: null,
        };
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const semanticError = readError(error);
      const clear = discardsPrevious(semanticError);
      if (clear) seenCursors.current.clear();
      setState((previous) => ({
        ...previous,
        ...(clear
          ? { items: null, nextCursor: null, coverage: null, asOf: null }
          : {}),
        loading: false,
        error: semanticError,
        failedCursor: clear ? null : cursor,
      }));
    } finally {
      if (requestRef.current === controller) {
        busy.current = false;
        requestRef.current = null;
      }
    }
  }

  useEffect(() => {
    seenCursors.current.clear();
    void loadPage(null, true);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      busy.current = false;
    };
  }, [endpoint, c.api]);

  const title = t(kind === "PROJECT" ? "projects" : "goals");
  const ResourceIcon = kind === "PROJECT" ? FolderKanban : Target;
  const errorText =
    state.error?.kind === "semantic"
      ? t(state.error.key)
      : state.error
        ? formatError({ code: state.error.code })
        : "";
  return (
    <section
      className="member-activity"
      aria-label={title}
      aria-busy={state.loading}
    >
      <div className="member-activity-heading">
        <h3>{title}</h3>
        {state.items && (
          <span className="member-activity-count">
            {t("loaded", { count: formatNumber(state.items.length) })}
          </span>
        )}
        <button
          type="button"
          className="member-activity-reload"
          disabled={state.loading}
          onClick={() => void loadPage(null, true)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {t("reload")}
        </button>
      </div>
      {errorText && (
        <div className="member-activity-error" role="alert">
          <p>{errorText}</p>
          <button
            type="button"
            disabled={state.loading}
            onClick={() =>
              void loadPage(state.failedCursor, state.items === null)
            }
          >
            {t("retry")}
          </button>
        </div>
      )}
      {state.loading && state.items === null && (
        <div className="member-activity-loading" role="status">
          <span className="member-activity-loading-label">{t("loading")}</span>
          {[0, 1, 2].map((index) => (
            <div
              className="member-activity-skeleton"
              key={index}
              aria-hidden="true"
            />
          ))}
        </div>
      )}
      {state.coverage?.completeness === "PARTIAL" && (
        <p className="member-activity-partial" role="status">
          {t(
            state.coverage.limitations.includes("ROLE_CAPACITY_UNAVAILABLE")
              ? "partialRoles"
              : "partial",
          )}
        </p>
      )}
      {state.items?.length === 0 && !state.error && (
        <div className="member-activity-empty">
          <ResourceIcon size={28} aria-hidden="true" />
          <h4>{t(kind === "PROJECT" ? "noProjects" : "noGoals")}</h4>
          <p>{t(kind === "PROJECT" ? "emptyProjects" : "emptyGoals")}</p>
        </div>
      )}
      {!!state.items?.length && (
        <>
          <ul className="member-activity-list">
            {state.items.map((item) => {
              const path = memberActivityPath(kind, item.id)!;
              const reasons = [
                ...new Set(
                  item.reasons.map((reason) =>
                    Object.hasOwn(reasonKeys, reason)
                      ? reasonKeys[reason]
                      : "currentLink",
                  ),
                ),
              ];
              return (
                <li key={item.id} className="member-activity-row">
                  <ResourceIcon
                    size={18}
                    className="member-activity-icon"
                    aria-hidden="true"
                  />
                  <div className="member-activity-content">
                    <a
                      href={path}
                      onClick={(event) => {
                        if (
                          event.button === 0 &&
                          !event.metaKey &&
                          !event.ctrlKey &&
                          !event.altKey &&
                          !event.shiftKey
                        ) {
                          event.preventDefault();
                          c.navigate(path);
                        }
                      }}
                    >
                      {item.title}
                    </a>
                    {reasons.length > 0 && (
                      <p className="member-activity-reasons">
                        {reasons.map((reason) => t(reason)).join(" · ")}
                      </p>
                    )}
                  </div>
                  {item.status && (
                    <span className="member-activity-status">
                      {t(
                        Object.hasOwn(statusKeys, item.status)
                          ? statusKeys[item.status]
                          : "unknownStatus",
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="member-activity-scope">{t("scope")}</p>
        </>
      )}
      {state.asOf && (
        <p className="member-activity-asof">
          {t("asOf", { time: formatInstant(state.asOf) })}
        </p>
      )}
      {state.items && state.nextCursor && !state.error && (
        <div className="member-activity-pagination">
          <button
            type="button"
            disabled={state.loading}
            onClick={() => void loadPage(state.nextCursor)}
          >
            {t(state.loading ? "loading" : "loadMore")}
          </button>
          <p role="status">{t("moreAvailable")}</p>
        </div>
      )}
    </section>
  );
}

export default MemberActivity;

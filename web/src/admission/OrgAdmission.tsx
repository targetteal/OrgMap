import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { request, RequestError } from "../api";
import { Button } from "../ui";
import { useLocalization } from "../localization";
import { admissionMessages } from "./messages";
import "./org-admission.css";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type AdmissionResult = {
  state: "JOINED" | "ALREADY_MEMBER";
  membership: { id: string; [key: string]: unknown };
};
export type OrgAdmissionProps = {
  orgId: string;
  /** Capability received from the URL fragment, which the shell must immediately clear. */
  linkToken?: string;
  /** Non-secret request UUID; the shell may retain this in its route for reloads. */
  initialRequestId?: string;
  organizationName?: string;
  accountEmail?: string;
  onJoined: (result: AdmissionResult) => void | Promise<void>;
  onSignIn: () => void;
  onCancel?: () => void;
  onRequestIdChange?: (requestId: string | null) => void;
  onLinkTokenConsumed?: () => void;
  api?: typeof request;
};
type Operation = "start" | "complete";
type Issue = {
  message: Parameters<ReturnType<typeof admissionMessages>>[0];
  kind: "retry" | "auth" | "invalid" | "policy" | "blocked";
  operation?: Operation;
};
function issueFor(error: unknown, operation: Operation): Issue {
  const code = error instanceof RequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return { message: "auth", kind: "auth" };
    case "CSRF_INVALID":
    case "REAUTHENTICATION_REQUIRED":
      return { message: "session", kind: "auth" };
    case "ADMISSION_INVALID":
      return { message: "invalid", kind: "invalid" };
    case "POLICY_CHANGED":
      return { message: "policy", kind: "policy" };
    case "MEMBERSHIP_SUSPENDED":
      return { message: "suspended", kind: "blocked" };
    case "TYPE_CHANGE_REQUIRED":
      return { message: "typeConflict", kind: "blocked" };
    case "ADMISSION_ALREADY_COMPLETED":
    case "IDEMPOTENCY_CONFLICT":
    case "STATE_CONFLICT":
    case "VERSION_CONFLICT":
      return { message: "conflict", kind: "blocked" };
    case "RESOURCE_NOT_FOUND":
    case "ACTION_DENIED":
    case "ADMISSION_LINK_DISABLED":
      return { message: "blocked", kind: "blocked" };
    case "POLICY_CONSUMER_UNAVAILABLE":
    case "EXTERNAL_CONFIGURATION_REQUIRED":
      return { message: "unavailable", kind: "retry", operation };
    case "RATE_LIMITED":
      return { message: "rate", kind: "retry", operation };
    default:
      return { message: "generic", kind: "retry", operation };
  }
}

/** Account-authenticated admission before tenant membership. No bootstrap or member endpoint is called here. */
export function OrgAdmission(props: OrgAdmissionProps) {
  // A different organization must never inherit an intention, in-flight request or proof.
  return <AdmissionFlow key={props.orgId} {...props} />;
}
function AdmissionFlow({
  orgId,
  linkToken,
  initialRequestId,
  organizationName,
  accountEmail,
  onJoined,
  onSignIn,
  onCancel,
  onRequestIdChange,
  onLinkTokenConsumed,
  api = request,
}: OrgAdmissionProps) {
  const { locale } = useLocalization(),
    t = admissionMessages(locale),
    id = useId();
  const [requestId, setRequestId] = useState(() =>
    initialRequestId && uuid.test(initialRequestId) ? initialRequestId : null,
  );
  const [linked] = useState(!!linkToken);
  const [canStartAgain] = useState(
    () => !initialRequestId || !uuid.test(initialRequestId) || !!linkToken,
  );
  const [busy, setBusy] = useState<Operation | "open" | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [result, setResult] = useState<AdmissionResult | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    codeInput = useRef<HTMLInputElement>(null),
    alert = useRef<HTMLDivElement>(null),
    success = useRef<HTMLDivElement>(null);
  const bindCodeInput = useCallback((element: HTMLInputElement | null) => {
    // React detaches DOM refs before passive cleanup, so wipe the native value at detachment too.
    if (!element && codeInput.current) codeInput.current.value = "";
    codeInput.current = element;
  }, []);
  const linkSecret = useRef(linkToken ?? ""),
    startAttempt = useRef<string | null>(null),
    completeAttempt = useRef<{
      requestId: string;
      token: string;
      key: string;
    } | null>(null);
  const controller = useRef<AbortController | null>(null),
    alive = useRef(true),
    inFlight = useRef(false);
  const latest = useRef({
    onJoined,
    onSignIn,
    onCancel,
    onRequestIdChange,
    onLinkTokenConsumed,
  });
  latest.current = {
    onJoined,
    onSignIn,
    onCancel,
    onRequestIdChange,
    onLinkTokenConsumed,
  };
  function clearSecrets() {
    linkSecret.current = "";
    startAttempt.current = null;
    completeAttempt.current = null;
    if (codeInput.current) codeInput.current.value = "";
  }
  useEffect(() => {
    alive.current = true;
    // Restore only for React's development effect replay; prop removal must not erase the live ref.
    if (linkToken && !linkSecret.current) linkSecret.current = linkToken;
    if (linkToken) latest.current.onLinkTokenConsumed?.();
    heading.current?.focus();
    return () => {
      alive.current = false;
      controller.current?.abort();
      clearSecrets();
    };
  }, []);
  useEffect(() => {
    if (issue) alert.current?.focus();
    else if (result) success.current?.focus();
    else if (requestId && !busy) codeInput.current?.focus();
  }, [issue, result, requestId, busy]);

  async function openOrganization(joined: AdmissionResult) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("open");
    setIssue(null);
    try {
      await latest.current.onJoined(joined);
    } catch {
      if (alive.current) setIssue({ message: "openFailure", kind: "blocked" });
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  }
  async function start(newRequest = false) {
    if (inFlight.current || cancelled || result) return;
    if (!uuid.test(orgId)) {
      setIssue({ message: "blocked", kind: "blocked" });
      return;
    }
    if (linked && !linkSecret.current) {
      setIssue({ message: "missingLink", kind: "blocked" });
      return;
    }
    inFlight.current = true;
    setBusy("start");
    setIssue(null);
    if (newRequest) startAttempt.current = null;
    startAttempt.current ??= crypto.randomUUID();
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const response = await api<{ requestId: string; state: "PENDING_PROOF" }>(
        `/organizations/${orgId}/admission/${linked ? "link-requests" : "requests"}`,
        {
          method: "POST",
          body: linked ? { linkToken: linkSecret.current } : {},
          key: startAttempt.current,
          signal: ctrl.signal,
        },
      );
      if (!alive.current || ctrl.signal.aborted) return;
      if (
        response.data.state !== "PENDING_PROOF" ||
        !uuid.test(response.data.requestId)
      )
        throw new RequestError("INVALID_RESPONSE", "INVALID_RESPONSE");
      completeAttempt.current = null;
      if (codeInput.current) codeInput.current.value = "";
      setRequestId(response.data.requestId);
      latest.current.onRequestIdChange?.(response.data.requestId);
    } catch (error) {
      if (alive.current && !ctrl.signal.aborted)
        setIssue(issueFor(error, "start"));
    } finally {
      inFlight.current = false;
      if (alive.current && !ctrl.signal.aborted) setBusy(null);
    }
  }
  async function complete(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (inFlight.current || !requestId || cancelled || result) return;
    if (issue && ["auth", "policy", "blocked"].includes(issue.kind)) return;
    const token = codeInput.current?.value.trim() ?? "";
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      setIssue({ message: "invalidInput", kind: "invalid" });
      codeInput.current?.focus();
      return;
    }
    if (!uuid.test(orgId)) {
      setIssue({ message: "blocked", kind: "blocked" });
      return;
    }
    if (
      completeAttempt.current?.requestId !== requestId ||
      completeAttempt.current.token !== token
    )
      completeAttempt.current = { requestId, token, key: crypto.randomUUID() };
    inFlight.current = true;
    setBusy("complete");
    setIssue(null);
    const ctrl = new AbortController();
    controller.current = ctrl;
    let joined: AdmissionResult | undefined;
    try {
      const response = await api<AdmissionResult>(
        `/organizations/${orgId}/admission/requests/${requestId}/complete`,
        {
          method: "POST",
          body: { mailboxToken: token },
          key: completeAttempt.current.key,
          signal: ctrl.signal,
        },
      );
      if (!alive.current || ctrl.signal.aborted) return;
      if (
        !["JOINED", "ALREADY_MEMBER"].includes(response.data.state) ||
        !uuid.test(response.data.membership?.id)
      )
        throw new RequestError("INVALID_RESPONSE", "INVALID_RESPONSE");
      joined = response.data;
      clearSecrets();
      setResult(joined);
      setRequestId(null);
      latest.current.onRequestIdChange?.(null);
    } catch (error) {
      if (alive.current && !ctrl.signal.aborted)
        setIssue(issueFor(error, "complete"));
    } finally {
      inFlight.current = false;
      if (alive.current && !ctrl.signal.aborted) setBusy(null);
    }
    if (joined && alive.current) await openOrganization(joined);
  }
  function leave(signIn = false) {
    controller.current?.abort();
    inFlight.current = false;
    clearSecrets();
    setBusy(null);
    setIssue(null);
    setCancelled(true);
    if (!signIn) latest.current.onRequestIdChange?.(null);
    if (signIn) latest.current.onSignIn();
    else latest.current.onCancel?.();
  }
  const auth = issue?.kind === "auth",
    blocked = issue?.kind === "blocked",
    pending = !!requestId;
  const canRequest =
    canStartAgain && !auth && !blocked && (!issue || issue.kind !== "retry");
  const canConfirm = !auth && !blocked && issue?.kind !== "policy";
  return (
    <section
      className="org-admission"
      aria-labelledby={`${id}-title`}
      aria-busy={!!busy}
    >
      <h1 id={`${id}-title`} tabIndex={-1} ref={heading}>
        {organizationName
          ? t("namedTitle", { organization: organizationName })
          : t("title")}
      </h1>
      {!cancelled && !result && (
        <>
          <p>{t(linked ? "linkIntro" : "publicIntro")}</p>
          {accountEmail && (
            <p className="org-admission-account">
              {t("email", { email: accountEmail })}
            </p>
          )}
        </>
      )}
      {issue && (
        <div
          className="notice org-admission-notice"
          role="alert"
          tabIndex={-1}
          ref={alert}
        >
          {t(issue.message)}
        </div>
      )}
      {cancelled ? (
        <p role="status">{t("cancelled")}</p>
      ) : result ? (
        <>
          <div
            className="org-admission-success"
            role="status"
            tabIndex={-1}
            ref={success}
          >
            {t(result.state === "JOINED" ? "joined" : "existing")}
          </div>
          <div className="org-admission-actions">
            <Button
              className="primary"
              disabled={!!busy}
              onClick={() => void openOrganization(result)}
            >
              {t("open")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {pending && (
            <div className="org-admission-proof">
              <h2>{t("pendingTitle")}</h2>
              <p>{t("pending")}</p>
              <form onSubmit={complete}>
                <label className="field" htmlFor={`${id}-code`}>
                  {t("code")}
                </label>
                <input
                  ref={bindCodeInput}
                  id={`${id}-code`}
                  name="mailboxToken"
                  type="password"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={64}
                  pattern="[a-fA-F0-9]{64}"
                  readOnly={!!busy}
                  disabled={!canConfirm}
                  aria-describedby={`${id}-code-help`}
                  aria-invalid={issue?.kind === "invalid" || undefined}
                  onInput={(event) => event.currentTarget.setCustomValidity("")}
                  onInvalid={(event) =>
                    event.currentTarget.setCustomValidity(t("invalidInput"))
                  }
                />
                <p id={`${id}-code-help`} className="org-admission-help">
                  {t("codeHelp")}
                </p>
                {canConfirm && (
                  <div className="org-admission-actions">
                    <button className="primary" type="submit" disabled={!!busy}>
                      {t(busy === "complete" ? "confirming" : "confirm")}
                    </button>
                  </div>
                )}
              </form>
            </div>
          )}
          {!pending && !auth && !blocked && (
            <p className="org-admission-help">{t("proofNote")}</p>
          )}
          <div className="org-admission-actions">
            {auth ? (
              <Button
                className="primary"
                disabled={!!busy}
                onClick={() => leave(true)}
              >
                {t("signIn")}
              </Button>
            ) : issue?.kind === "retry" ? (
              <Button
                disabled={!!busy}
                onClick={() =>
                  void (issue.operation === "complete" ? complete() : start())
                }
              >
                {t("retry")}
              </Button>
            ) : (
              canRequest && (
                <Button
                  className={pending ? "" : "primary"}
                  disabled={!!busy}
                  onClick={() => void start(pending)}
                >
                  {t(
                    busy === "start"
                      ? "starting"
                      : pending
                        ? "newCode"
                        : "start",
                  )}
                </Button>
              )
            )}
            <Button onClick={() => leave()}>{t("cancel")}</Button>
          </div>
          {pending && canRequest && (
            <p className="org-admission-help org-admission-new-help">
              {t("newCodeHelp")}
            </p>
          )}
          {pending && !canStartAgain && !auth && !blocked && (
            <p className="org-admission-help org-admission-new-help">
              {t("resumeHelp")}
            </p>
          )}
          {busy && (
            <p className="org-admission-progress" role="status">
              {t(busy === "start" ? "starting" : "confirming")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

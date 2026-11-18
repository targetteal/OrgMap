import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { FeatureContext } from "../../feature-contract";
import { RequestError } from "../../api";
import { Button, Field, Notice } from "../../ui";
import { useLocalization } from "../../localization";
import { invitationComposerTranslator, type InvitationComposerMessage } from "./invitation-composer-messages";
import "./invitation-composer.css";
import { invitationTrackingTranslator } from "./invitation-tracking-messages";

export type InvitationComposerProps = {
  context: FeatureContext;
  /** Refresh the caller after a confirmed API result; result details remain visible here. */
  onComplete?: () => void;
  onAdvanced?: () => void;
  onTrack?: () => void;
};
type Result = { clientRef: string; status: string; email: string };
const resultStatuses = new Set(["QUEUED", "EXISTING_PENDING", "ALREADY_MEMBER", "DUPLICATE_IN_BATCH", "INVALID", "DENIED", "CONFLICT"]);
export const invitationEmails = (value: string) => value.split(/[\s,;]+/u).map(email => email.trim()).filter(Boolean);

/** Account and organization switches never reuse recipients, receipts or command keys. */
export function InvitationComposer(props: InvitationComposerProps) {
  return <Composer key={props.context.organizationId + ":" + (props.context.session?.account.id ?? "")} {...props} />;
}
function Composer({ context: c, onComplete, onAdvanced, onTrack }: InvitationComposerProps) {
  const { locale } = useLocalization(), t = invitationComposerTranslator(locale), helpId = useId();
  const [addresses, setAddresses] = useState(""), [personalMessage, setPersonalMessage] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<InvitationComposerMessage | null>(null), [results, setResults] = useState<Result[]>([]);
  const active = useRef(true), inFlight = useRef(false), controller = useRef<AbortController | null>(null);
  const submission = useRef<{ fingerprint: string; key: string; items: { clientRef: string; email: string; memberType: "MEMBER" }[] } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => c.registerNavigationGuard?.(() => busy ? t("navigationBusy") : null), [busy, locale, c.registerNavigationGuard]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const emails = invitationEmails(addresses);
    if (!emails.length) { setError("required"); return; }
    if (emails.length > 100) { setError("tooMany"); return; }
    if (Array.from(personalMessage).length > 2000) { setError("messageTooLong"); return; }
    const fingerprint = JSON.stringify([emails, personalMessage]);
    if (submission.current?.fingerprint !== fingerprint) submission.current = {
      fingerprint, key: crypto.randomUUID(), items: emails.map(email => ({ clientRef: crypto.randomUUID(), email, memberType: "MEMBER" })),
    };
    const command = submission.current;
    inFlight.current = true; setBusy(true); setError(null); setResults([]);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await c.api<{ results: { clientRef: string; status: string }[] }>("/organizations/" + c.organizationId + "/invitations/batch", {
        method: "POST", body: { items: command.items, personalMessage }, key: command.key, signal: abort.signal,
      });
      if (!active.current || abort.signal.aborted) return;
      setResults(response.data.results.map(result => ({ ...result, email: command.items.find(item => item.clientRef === result.clientRef)?.email ?? "" })));
      submission.current = null;
      c.notify(t("processed"));
      // The API receipt is confirmed even if a caller's refresh fails.
      try { onComplete?.(); } catch { /* caller owns its refresh state */ }
    } catch (failure) {
      if (!active.current || abort.signal.aborted) return;
      setError(failure instanceof RequestError && failure.code === "ACTION_DENIED" ? "denied" : failure instanceof RequestError && ["POLICY_CONSUMER_UNAVAILABLE", "EXTERNAL_CONFIGURATION_REQUIRED"].includes(failure.code) ? "unavailable" : "failed");
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  return <div className="invitation-composer">
    <p className="invitation-composer-intro">{t("intro", { organization: c.bootstrap.organization?.name ?? t("organization") })}</p>
    {error && <Notice>{t(error)}</Notice>}
    <form onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <Field label={t("emails")} name="invitation-emails">
          <textarea name="invitation-emails" rows={3} required value={addresses} inputMode="email" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={helpId + "-emails"} onChange={event => { setAddresses(event.target.value); setResults([]); }} />
        </Field>
        <p className="muted invitation-composer-help" id={helpId + "-emails"}>{t("emailHelp")}</p>
        <p className="muted invitation-composer-language">{t("languageHelp")}</p>
        <details className="invitation-composer-message">
          <summary>{t("optionalMessage")}</summary>
          <Field label={t("personalMessage")} name="invitation-personal-message">
            <textarea name="invitation-personal-message" rows={3} value={personalMessage} maxLength={4000} onChange={event => { setPersonalMessage(event.target.value); setResults([]); }} />
          </Field>
          <p className="muted invitation-composer-help">{t("messageCount", { count: Array.from(personalMessage).length })}</p>
        </details>
        <div className="invitation-composer-actions"><button className="primary" type="submit" disabled={busy}>{t(busy ? "sending" : "send")}</button></div>
      </fieldset>
    </form>
    {results.length > 0 && <div className="invitation-composer-results" role="status" aria-live="polite">
      <h3>{t("results")}</h3>
      <ul>{results.map(result => <li key={result.clientRef}><strong>{result.email}</strong><span>{t(resultStatuses.has(result.status) ? result.status as InvitationComposerMessage : "UNKNOWN")}</span></li>)}</ul>
      <p className="muted">{t("queueHelp")}</p>
    </div>}
    <Button disabled={busy} onClick={() => onTrack ? onTrack() : c.navigate("/organization-invitations")}>{invitationTrackingTranslator(locale)("track")}</Button>
    {onAdvanced && <Button className="invitation-composer-advanced" disabled={busy} onClick={onAdvanced}>{t("advanced")}</Button>}
  </div>;
}

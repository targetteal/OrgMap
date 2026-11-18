import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorMessage, request, RequestError, setCsrf } from "../api";
import { useLocalization, formatError } from "../localization";
import { emailTranslator } from "./email-messages";
import { AlertCircle, CheckCircle2 } from "lucide-react";

type Pending = { requestId: string; state: string; expiresAt: string };
type Account = { id: string; email: string; version: number; passwordEnabled: boolean };

/** Account-global email proof; credentials and mailbox token stay in memory. */
export function EmailChange({ account, onChanged, disabled = false }: { account: Account; onChanged: () => Promise<void>; disabled?: boolean }) {
  const { formatInstant, locale } = useLocalization(), t = emailTranslator(locale);
  const localizedError = (error:unknown) => locale === 'pt-BR' ? errorMessage(error) : formatError(error,locale);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false); setPending(null); setError(""); setMessage("");
    setNewEmail(""); setPassword(""); setTotp(""); setToken(""); attempt.current = null;
    request<{ items: Pending[] }>("/account/email-change/requests", { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) { setPending(r.data.items.find((item) => item.state === "PENDING_PROOF") ?? null); setLoaded(true); } })
      .catch((e) => { if (!controller.signal.aborted) setError(localizedError(e)); });
    return () => controller.abort();
  }, [account.id, reload]);

  function keyFor(fingerprint: string) {
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    return attempt.current.key;
  }
  function credentials() {
    return {
      ...(password ? { currentPassword: password } : {}),
      ...(totp ? { totpCode: totp } : {}),
    };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!pending) {
        const body = { newEmail: newEmail.trim(), ...credentials() };
        const r = await request<Pending>("/account/email-change/requests", {
          method: "POST", body, version: account.version,
          key: keyFor("request:" + body.newEmail),
        });
        setPending(r.data); setNewEmail("");
        setMessage(t('requestCreated'));
      } else {
        const body = { mailboxToken: token.trim(), ...credentials() };
        const r = await request<{ csrfToken?: string }>(`/account/email-change/requests/${pending.requestId}/complete`, {
          method: "POST", body, version: account.version,
          key: keyFor("complete:" + pending.requestId + ":" + body.mailboxToken),
        });
        if (r.data.csrfToken) setCsrf(r.data.csrfToken);
        setPending(null); setToken("");
        try {
          await onChanged();
          setMessage(t('changed'));
        } catch {
          setMessage(t('changedRefresh'));
        }
      }
      attempt.current = null; setPassword(""); setTotp("");
    } catch (e) {
      setError(e instanceof RequestError && e.code === "NETWORK_ERROR" && pending
        ? t('resultUnknown')
        : localizedError(e));
    }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!pending || disabled || busy) return;
    setBusy(true); setError("");
    try {
      await request(`/account/email-change/requests/${pending.requestId}/revoke`, {
        method: "POST", body: {}, version: account.version,
        key: keyFor("revoke:" + pending.requestId),
      });
      setPending(null); setToken(""); setPassword(""); setTotp(""); attempt.current = null;
      setMessage(t('cancelled'));
    } catch (e) { setError(localizedError(e)); }
    finally { setBusy(false); }
  }
  return <section className="account-section" aria-labelledby="account-email-change-title">
    <h2 id="account-email-change-title">{t('title')}</h2>
    <p>{t('help')}</p>
    {disabled && <p className="account-hint">{t('saveNameFirst')}</p>}
    {message && <p className="account-success" role="status"><CheckCircle2 size={18} aria-hidden="true" />{message}</p>}
    {error && <p className="account-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
    {!loaded ? (error ? <button type="button" onClick={() => setReload((n) => n + 1)}>{t('retry')}</button> : <p role="status" className="muted">{t('loading')}</p>) : <form className="edit-form" onSubmit={submit}>
      <fieldset className="account-fieldset" disabled={disabled || busy}>
      {pending ? <>
        <p>{t('pending',{time:formatInstant(pending.expiresAt)})}</p>
        <label className="field">{t('mailboxCode')}<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required /></label>
      </> : <label className="field">{t('newEmail')}<input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" required /></label>}
      {account.passwordEnabled ? <label className="field">{t('currentPassword')}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        : <p>{t('recentProvider')}</p>}
      <label className="field">{t('totpCode')}<input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" /></label>
      <div className="form-actions">
        {pending && <button type="button" disabled={busy} onClick={() => setReload((n) => n + 1)}>{t('refreshRequest')}</button>}
        {pending && <button type="button" disabled={busy} onClick={() => void cancel()}>{t('cancelRequest')}</button>}
        <button className="primary" disabled={busy}>{busy ? t('wait') : pending ? t('confirmChange') : t('sendConfirmation')}</button>
      </div>
      </fieldset>
    </form>}
  </section>;
}

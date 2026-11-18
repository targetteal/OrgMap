import { useLocalization, formatError } from "../localization";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { User, Shield, Settings2, Monitor, ArrowLeft, Accessibility, Building2, CheckCircle2, KeyRound, ShieldCheck, Clock3, CircleSlash } from "lucide-react";
import type { FeatureContext, FeatureDefinition } from "../feature-contract";
import { formatAccountDate, preferencesPayload } from "./formatting";
import { MfaSettings } from "./MfaSettings";
import { EmailChange } from "./EmailChange";
import { OrganizationDeletionReceipts } from "../organization-deletion/Receipts";
import { deletionTranslator } from "../organization-deletion/messages";
import { request, errorMessage, setCsrf } from "../api";
import { Button, Dialog, Field, Notice } from "../ui";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "../../../packages/i18n";
import { createTranslator } from "../../../packages/i18n";
import { accountUiTranslator } from "./ui-messages";
import { accountFormTranslator } from "./form-messages";
import {publicAuthTranslator} from './public-auth-messages';
import {AuthLayout,AuthNotice,AuthPasswordField,AuthSubmit,AuthTextField} from './AuthLayout';
type Account = {
  id: string;
  email: string;
  displayName: string;
  version: number;
  passwordEnabled: boolean;
};
type Preferences = {
  locale: string;
  timeZone: string;
  dateFormat: string;
  theme: string;
  reducedMotion: boolean;
  version: number;
};
type SessionItem = {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
  version: number;
};
type Props = { context: FeatureContext };
export function AccountNavigation({
  context,
}: {
  context: Pick<FeatureContext, "navigate" | "path">;
}) {
  const { t, locale } = useLocalization(), a = accountUiTranslator(locale);
  const activeSection = context.path.split(/[?#]/, 1)[0].split('/')[2] || 'general';
  const sections = [
    ['general', a('general'), User],
    ['preferences', t('nav.preferences'), Settings2],
    ['security', t('nav.security'), Shield],
    ['sessions', t('nav.sessions'), Monitor],
    ['accessibility', t('a11y.title'), Accessibility],
    ['organization-deletions', deletionTranslator(locale)('closures'), Building2],
  ] as const;
  return sections.map(([section, label, Icon]) => (
    <Button
      key={section}
      className={'nav-item' + (activeSection === section ? ' selected' : '')}
      ariaCurrent={activeSection === section ? 'page' : undefined}
      onClick={() => context.navigate('/account/' + section)}
    >
      <Icon size={16} />
      {label}
    </Button>
  ));
}
export function AccountPage({
  navigate,
  refreshSession,
  notify,
  path,
  registerNavigationGuard,
  accountId,
}: {
  registerNavigationGuard?: FeatureContext["registerNavigationGuard"];
  navigate: FeatureContext["navigate"];
  refreshSession?: () => Promise<void>;
  notify: (message: string) => void;
  path: string;
  accountId?: string;
}) {
  const { t, locale } = useLocalization(), a = accountUiTranslator(locale), f = accountFormTranslator(locale);
  const localizedError = (error:unknown) => locale === 'pt-BR' ? errorMessage(error) : formatError(error,locale);
  const unsavedGuard = a('unsavedGuard');
  const [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(
    () =>
      registerNavigationGuard?.(() =>
        dirty ? unsavedGuard : null,
      ),
    [registerNavigationGuard, dirty, unsavedGuard],
  );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const announce = (text: string) => {
    setMessage(text);
    notify(text);
  };
  const [account, setAccount] = useState<Account | null>(null),
    [methods, setMethods] = useState<
      {
        id: string;
        kind: string;
        label: string;
        enabled: boolean;
        verified: boolean;
      }[]
    >([]),
    [preferences, setPreferences] = useState<Preferences | null>(null),
    [sessions, setSessions] = useState<SessionItem[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState<"password" | "disable" | null>(null),
    [formError, setFormError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const sectionId = useId();
  const attempt = useRef<{ body: string; key: string } | null>(null),
    section = path.split("/")[2]?.split("?")[0] ?? "general";
  useEffect(() => setMessage(""), [section]);
  useEffect(() => {
    const ctrl = new AbortController();
    setError("");
    Promise.all([
      request<{ account: Account; authMethods: typeof methods }>("/account", {
        signal: ctrl.signal,
      }),
      request<{ preferences: Preferences }>("/account/preferences", {
        signal: ctrl.signal,
      }),
      request<{ items: SessionItem[] }>("/auth/sessions", {
        signal: ctrl.signal,
      }),
    ])
      .then(([a, p, s]) => {
        if (ctrl.signal.aborted) return;
        setAccount(a.data.account);
        setMethods(a.data.authMethods);
        setPreferences(p.data.preferences);
        setSessions(s.data.items);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(localizedError(e));
      });
    return () => ctrl.abort();
  }, [refresh]);
  async function command(
    url: string,
    body: unknown,
    version: number,
    method = "POST",
  ) {
    const serialized = JSON.stringify({ url, body, version });
    if (attempt.current?.body !== serialized)
      attempt.current = { body: serialized, key: crypto.randomUUID() };
    return request<Record<string, any>>(url, {
      method,
      body,
      version,
      key: attempt.current.key,
    });
  }
  async function profile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!account || busy) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await command(
        "/account",
        { displayName: String(data.get("displayName")) },
        account.version,
        "PATCH",
      );
      setDirty(false);
      setRefresh((v) => v + 1);
      await refreshSession?.();
      announce(f('profileUpdated'));
    } catch (e) {
      setError(localizedError(e));
    } finally {
      setBusy(false);
    }
  }
  async function savePreferences(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!preferences || busy) return;
    setBusy(true);
    setError("");
    try {
      const version = preferences.version,
        payload = preferencesPayload(preferences);
      await command("/account/preferences", payload, version, "PATCH");
      document.documentElement.dataset.reducedMotion = String(
        preferences.reducedMotion,
      );
      window.dispatchEvent(new Event("orgmap:preferences-changed"));
      setDirty(false);
      setRefresh((v) => v + 1);
      announce(createTranslator(preferences.locale).t("common.saved"));
    } catch (e) {
      setError(localizedError(e));
    } finally {
      setBusy(false);
    }
  }
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!account || busy) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setFormError("");
    try {
      const result = await command(
        dialog === "disable" ? "/auth/password/disable" : "/auth/password",
        {
          currentPassword: String(data.get("currentPassword")),
          ...(dialog === "password"
            ? { newPassword: String(data.get("newPassword")) }
            : {}),
        },
        account.version,
      );
      if (result.data.csrfToken) setCsrf(result.data.csrfToken);
      setDialog(null);
      setRefresh((v) => v + 1);
      await refreshSession?.();
      announce(
        dialog === "disable"
          ? f('localPasswordDisabled')
          : f('passwordChanged'),
      );
    } catch (e) {
      setFormError(localizedError(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(item: SessionItem) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await command("/auth/sessions/" + item.id + "/revoke", {}, item.version);
      if (item.current) {
        await refreshSession?.();
        navigate("/login");
      } else {
        setRefresh((v) => v + 1);
        announce(f('sessionEnded'));
      }
    } catch (e) {
      setError(localizedError(e));
    } finally {
      setBusy(false);
    }
  }
  const federated = methods.some(
    (m) =>
      m.kind !== "PASSWORD" && m.kind !== "LOCAL" && m.enabled && m.verified,
  );
  if(section==='organization-deletions')return <OrganizationDeletionReceipts accountId={accountId??account?.id??''} path={path} navigate={navigate} />;
  return (
    <>
      <div className="page-heading account-page-heading">
        <p>{section === "general" ? a('introGeneral') : section === "preferences" ? a('introPreferences') : section === "sessions" ? a('introSessions') : a('introSecurity')}</p>
      </div>
      <article className="entity-content account-content" aria-busy={!account || !preferences ? true : undefined}>
        {message && (
          <p className="account-success" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            {message}
          </p>
        )}
        {error && (
          <Notice>
            {error}
            <Button onClick={() => setRefresh((v) => v + 1)}>
              {a('refreshData')}
            </Button>
          </Notice>
        )}
        {!account || !preferences ? (
          error ? null : <div className="account-loading">
            <p role="status" className="account-visually-hidden">{a('loadingAccount')}</p>
            <div className="mare-loading" aria-hidden="true"><i/><i/><i/><i/><i/></div>
          </div>
        ) : section === "general" ? (<div className="account-sections">
          <form
            key={account.version + "-" + refresh}
            className="edit-form account-section"
            aria-labelledby={sectionId + "-profile"}
            onInput={() => setDirty(true)}
            onSubmit={profile}
          >
            <h2 id={sectionId + "-profile"}>{f('personalInformation')}</h2>
            <Field
              label={f('name')}
              name="displayName"
              value={account.displayName}
              required
              maxLength={200}
            />
            <label className="field">
              {f('email')}
              <input value={account.email} readOnly />
              <small>{f('emailChangeHelp')}</small>
            </label>
            <div className="form-actions">
              {dirty && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDirty(false);
                    setRefresh((v) => v + 1);
                  }}
                >
                  {a('discardChanges')}
                </Button>
              )}
              <button className="primary" disabled={busy}>
                {busy ? f('saving') : f('save')}
              </button>
            </div>
          </form>
          <EmailChange key={account.id} account={account} disabled={dirty || busy} onChanged={async () => {
            await refreshSession?.();
            setRefresh((v) => v + 1);
          }} />
          </div>
        ) : section === "preferences" ? (
          <form
            className="edit-form account-sections"
            aria-label={t("nav.preferences")}
            onInput={() => setDirty(true)}
            onSubmit={savePreferences}
          >
            <section className="account-section" aria-labelledby={sectionId + "-region"}>
            <h2 id={sectionId + "-region"}>{a('regionTitle')}</h2>
            <div className="account-field-grid">
            <label className="field">
              {t("account.language")}
              <select
                value={preferences.locale}
                onChange={(e) =>
                  setPreferences({ ...preferences, locale: e.target.value })
                }
              >
                {SUPPORTED_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>{LOCALE_LABELS[locale]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("account.dateFormat")}
              <select
                value={preferences.dateFormat}
                onChange={(e) =>
                  setPreferences({ ...preferences, dateFormat: e.target.value })
                }
              >
                <option value="DD/MM/YYYY">DD/MM/AAAA</option>
                <option value="MM/DD/YYYY">MM/DD/AAAA</option>
                <option value="YYYY-MM-DD">AAAA-MM-DD</option>
              </select>
            </label>
            <label className="field account-field-wide">
              {t("account.timeZone")}
              <input
                value={preferences.timeZone}
                onChange={(e) =>
                  setPreferences({ ...preferences, timeZone: e.target.value })
                }
                required
                placeholder="America/Sao_Paulo"
              />
            </label>
            </div>
            <p className="muted">{a('regionalNote')}</p>
            </section>
            <section className="account-section" aria-labelledby={sectionId + "-appearance"}>
            <h2 id={sectionId + "-appearance"}>{a('appearanceTitle')}</h2>
            <label className="field">
              {a('theme')}
              <select value={preferences.theme} onChange={event => {
                setPreferences({ ...preferences, theme: event.target.value });
                setDirty(true);
              }}>
                <option value="system">{a('system')}</option>
                <option value="light">{a('light')}</option>
                <option value="dark">{a('dark')}</option>
              </select>
              <small>{a('themeHelp')}</small>
            </label>
            <label className="account-check">
              <input
                type="checkbox"
                checked={preferences.reducedMotion}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    reducedMotion: e.target.checked,
                  })
                }
              />
              {a('reducedMotion')}
            </label>
            </section>
            <div className="form-actions account-sections-actions">
              {dirty && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDirty(false);
                    setRefresh((v) => v + 1);
                  }}
                >
                  {a('discardChanges')}
                </Button>
              )}
              <button className="primary" disabled={busy}>
                {busy ? t("common.loading") : t("common.save")}
              </button>
            </div>
          </form>
        ) : section === "sessions" ? (
          <div className="account-sections">
          <section className="account-section" aria-labelledby={sectionId + "-sessions"}>
            <h2 id={sectionId + "-sessions"}>{f('sessionsTitle')}</h2>
            <p className="muted">{f('sessionsHelp')}</p>
            <ul className="account-session-list">
            {[...sessions].sort((x, y) => Number(y.current) - Number(x.current)).map((item) => (
              <li className={"account-session" + (item.current ? " current" : "")} key={item.id}>
                <span className="account-session-icon" aria-hidden="true"><Monitor size={18} /></span>
                <div>
                  <strong>
                    {item.current ? f('currentSession') : f('otherSession')}
                  </strong>
                  <p>
                    <span>{f('startedAt')}{" "}
                    {formatAccountDate(item.createdAt, preferences, true)}</span>
                    <span>{f('expiresAt')}{" "}
                    {formatAccountDate(item.expiresAt, preferences, true)}</span>
                  </p>
                </div>
                <Button disabled={busy} onClick={() => void revoke(item)}>
                  {item.current ? f('signOutCurrent') : f('revokeSession')}
                </Button>
              </li>
            ))}
            </ul>
            {!sessions.some((item) => !item.current) && (
              <p className="account-empty">{a('noOtherSessions')}</p>
            )}
          </section>
          </div>
        ) : (
          <div className="account-sections">
            <section className="account-section" aria-labelledby={sectionId + "-methods"}>
            <h2 id={sectionId + "-methods"}>{f('methodsTitle')}</h2>
            <ul className="account-method-list">
            {methods.map((method) => {
              const state = method.enabled && method.verified ? "active" : method.enabled ? "pending" : "inactive";
              const StateIcon = state === "active" ? ShieldCheck : state === "pending" ? Clock3 : CircleSlash;
              return (
              <li className="entity-row" key={method.id}>
                <Shield size={18} aria-hidden="true" />
                <span>
                  {method.kind === "PASSWORD" ? f('password') : method.label}
                </span>
                <small className={"account-state account-state-" + state}>
                  <StateIcon size={14} aria-hidden="true" />
                  {state === "active"
                    ? f('verifiedActive')
                    : state === "pending"
                      ? f('awaitingVerification')
                      : f('inactive')}
                </small>
              </li>
            );})}
            </ul>
            </section>
            <section className="account-section" aria-labelledby={sectionId + "-password"}>
              <h2 id={sectionId + "-password"}>{f('password')}</h2>
              <p>
                {account.passwordEnabled
                  ? f('passwordEnabled')
                  : f('passwordDisabled')}
              </p>
              {!federated && (
                <p className="muted">
                  {f('keepPassword')}
                </p>
              )}
              <div className="entity-actions">
                <Button
                  disabled={busy || !account.passwordEnabled}
                  onClick={() => {
                    setFormError("");
                    setDialog("password");
                  }}
                >
                  {f('changePassword')}
                </Button>
                <Button
                  disabled={busy || !account.passwordEnabled || !federated}
                  title={
                    !federated
                      ? f('alternateMethodRequired')
                      : undefined
                  }
                  onClick={() => {
                    setFormError("");
                    setDialog("disable");
                  }}
                >
                  {f('disablePassword')}
                </Button>
              </div>
            </section>
            <MfaSettings
              key={account.id}
              passwordEnabled={account.passwordEnabled}
            />
          </div>
        )}
      </article>
      {dialog && (
        <Dialog
          title={
            dialog === "password" ? f('changePassword') : f('disableLocalPassword')
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
          closeLabel={f('close')}
        >
          <form className="edit-form" onSubmit={password}>
            {formError && <Notice>{formError}</Notice>}
            <label className="field">
              {f('currentPassword')}
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {dialog === "password" && (
              <label className="field">
                {f('newPassword')}
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
                <small>{f('passwordLength')}</small>
              </label>
            )}
            <div className="form-actions">
              <Button disabled={busy} onClick={() => setDialog(null)}>
                {f('cancel')}
              </Button>
              <button className="primary" disabled={busy}>
                {busy
                  ? f('saving')
                  : dialog === "password"
                    ? f('changePassword')
                    : f('disablePassword')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
function AccountFeature({ context }: Props) {
  return (
    <AccountPage
      accountId={context.session.account.id}
      path={context.path}
      navigate={context.navigate}
      notify={context.notify}
      refreshSession={context.refreshSession}
      registerNavigationGuard={context.registerNavigationGuard}
    />
  );
}
export const feature: FeatureDefinition = {
  id: "account",
  module: "account",
  label: "Conta",
  matches: (path) => path === "/account" || path.startsWith("/account/"),
  Component: AccountFeature,
  sidebar: AccountNavigation,
  navigation: [
    { path: "/account/general", label: "Minha conta", location: "identity" },
  ],
};
export function RecoveryPage({
  reset,
  navigate,
  locale,
  onLocaleChange,
}: {
  reset: boolean;
  navigate: (path: string) => void;
  locale:Locale;
  onLocaleChange:(locale:Locale)=>void;
}) {
  const a=publicAuthTranslator(locale);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [done, setDone] = useState(false);
  const key = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await request(
        reset ? "/auth/recovery/complete" : "/auth/recovery/request",
        {
          method: "POST",
          key: key.current,
          body: reset
            ? {
                token: String(data.get("token")),
                newPassword: String(data.get("newPassword")),
              }
            : { email: String(data.get("email")) },
        },
      );
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout locale={locale} onLocaleChange={onLocaleChange}>
      <form className="auth-form" onSubmit={submit}>
        <Button className="auth-link auth-back" onClick={() => navigate("/login")}>
          <ArrowLeft size={16} aria-hidden="true" />
          {a('backToSignIn')}
        </Button>
        <header className="auth-heading">
          <h1>{reset ? a('resetTitle') : a('recoverTitle')}</h1>
          {!done && <p>{reset ? a('resetIntro') : a('recoverIntro')}</p>}
        </header>
        {error !== null && <AuthNotice>{locale==='pt-BR'?errorMessage(error):formatError(error,locale)}</AuthNotice>}
        {done ? (
          <div className="auth-notice auth-notice-success">
            <CheckCircle2 size={18} aria-hidden="true" />
            <p role="status">
              {reset
                ? a('resetDone')
                : a('requestDone')}
            </p>
          </div>
        ) : reset ? (
          <>
            <AuthTextField label={a('recoveryCode')} name="token" autoComplete="one-time-code" />
            <AuthPasswordField
              label={a('newPassword')}
              showLabel={a('showPassword')}
              name="newPassword"
              minLength={12}
              maxLength={1024}
              help={a('passwordPolicy')}
              autoComplete="new-password"
            />
          </>
        ) : (
          <AuthTextField label={a('email')} name="email" type="email" autoComplete="email" inputMode="email" />
        )}
        {!done && (
          <AuthSubmit busy={busy} label={reset ? a('resetAction') : a('requestAction')} waitLabel={a('wait')} />
        )}
        {done && reset && (
          <Button className="primary auth-submit" onClick={() => navigate("/login")}>
            {a('signIn')}
          </Button>
        )}
        {!reset && (
          <div className="auth-alternatives">
            <Button className="auth-secondary" onClick={() => navigate("/reset-password")}>
              <KeyRound size={18} aria-hidden="true" />
              {a('haveCode')}
            </Button>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}

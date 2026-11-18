import { useEffect, useRef, useState, type FormEvent } from "react";
import { request, errorMessage, RequestError } from "../../api";
import { Button } from "../../ui";
import { OrgMapBrand } from "../../OrgMapBrand";
import {formatError,type Locale} from '../../localization';
import {PublicLanguageSelector} from '../../account/PublicLanguageSelector';
import {enrollmentTranslator,type EnrollmentMessage} from './enrollment-messages';
import "./interoperability.css";
type EnrollmentFlow = {
  flowId: string;
  organizationId: string;
  connectionId: string;
  enrollmentId: string;
  version: number;
};
export type EnrollmentPageProps = {
  navigate: (path: string) => void;
  api?: typeof request;
  locale:Locale;
  onLocaleChange:(locale:Locale)=>void;
};
const errorKeys:Record<string,EnrollmentMessage>={
  ENROLLMENT_SUSPENDED:'errorSuspended',ENROLLMENT_INVALID:'errorInvalid',
  ENROLLMENT_IDENTITY_MISMATCH:'errorMismatch',ACTIVATION_CONFIRMATION_REQUIRED:'errorConfirmation',
  IDENTITY_CONFIRMATION_FAILED:'errorIdentityFailed',ENROLLMENT_CANCELLED:'errorCancelled',
  ENROLLMENT_TOKEN_INVALID:'errorTokenInvalid',ENROLLMENT_TOKEN_EXPIRED:'errorTokenExpired',
  ENROLLMENT_VERSION_CONFLICT:'errorVersion',REAUTHENTICATION_REQUIRED:'errorReauth',
  EXISTING_ACCOUNT_REAUTH_REQUIRED:'errorExistingReauth',PROVISIONING_MAPPING_REQUIRED:'errorMapping',
  EXTERNAL_CONFIGURATION_REQUIRED:'errorExternalConfig',
};
function enrollmentError(error: unknown,locale:Locale) {
  const t=enrollmentTranslator(locale);
  if (error instanceof RequestError) {
    const key=errorKeys[error.code];
    return key?t(key):locale==='pt-BR'?errorMessage(error):formatError(error,locale);
  }
  return locale==='pt-BR'?errorMessage(error):formatError(error,locale);
}
/** Public route. Proof tokens stay in POST bodies and ephemeral component state, never URL/history/storage. */
export function EnrollmentPage({
  navigate,
  api = request,
  locale,
  onLocaleChange,
}: EnrollmentPageProps) {
  const t=enrollmentTranslator(locale);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown|null>(() => {
      const code = new URLSearchParams(window.location.search).get("error");
      return code
        ? new RequestError(code,t('errorIdentityDefault'))
        : null;
    }),
    [linkExisting, setLinkExisting] = useState(false),
    [flow, setFlow] = useState<EnrollmentFlow | null>(null),
    [redirectUrl, setRedirectUrl] = useState("");
  const errorRef = useRef<HTMLDivElement>(null),
    formRef = useRef<HTMLFormElement>(null);
  const errorText=error===null?'':enrollmentError(error,locale);
  useEffect(() => {
    if (errorText) errorRef.current?.focus();
  }, [errorText]);
  async function continueFlow(prepared: EnrollmentFlow) {
    const result = await api<{ authorizationUrl: string }>(
      `/organizations/${prepared.organizationId}/interoperability/connections/${prepared.connectionId}/enrollment/start`,
      { method: "POST", body: {} },
    );
    setRedirectUrl(result.data.authorizationUrl);
    window.location.assign(result.data.authorizationUrl);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget),
      token = String(values.get("token") ?? "");
    setBusy(true);
    setError(null);
    try {
      let existingAccountReauth: string | undefined;
      if (linkExisting) {
        const currentPassword = String(values.get("currentPassword") ?? "");
        const confirmed = await api<{ existingAccountReauth: string }>(
          "/enrollments/reauthenticate",
          {
            method: "POST",
            body: {
              token,
              confirmAccountLink: values.get("confirmAccountLink") === "on",
              ...(currentPassword ? { currentPassword } : {}),
            },
          },
        );
        existingAccountReauth = confirmed.data.existingAccountReauth;
      }
      const prepared = await api<EnrollmentFlow>("/enrollments/prepare", {
        method: "POST",
        body: {
          token,
          ...(existingAccountReauth ? { existingAccountReauth } : {}),
        },
      });
      setFlow(prepared.data);
      formRef.current?.reset();
      await continueFlow(prepared.data);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  async function retry() {
    if (!flow) return;
    setBusy(true);
    setError(null);
    try {
      await continueFlow(flow);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <main className="interop-enrollment">
      <div className="interop-enrollment-head"><OrgMapBrand/><PublicLanguageSelector locale={locale} onChange={onLocaleChange}/></div>
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>
      {errorText && (
        <div className="notice" role="alert" tabIndex={-1} ref={errorRef}>
          {errorText}
        </div>
      )}
      {!flow ? (
        <form ref={formRef} className="edit-form" onSubmit={submit}>
          <label className="field">
            {t('token')}
            <input
              name="token"
              type="password"
              autoComplete="one-time-code"
              required
              pattern="[a-fA-F0-9]{64}"
              maxLength={64}
              aria-describedby="enrollment-code-help"
            />
          </label>
          <p id="enrollment-code-help" className="muted">
            {t('tokenHelp')}
          </p>
          <label className="interop-check">
            <input
              type="checkbox"
              checked={linkExisting}
              onChange={(e) => setLinkExisting(e.target.checked)}
            />
            {t('linkExisting')}
          </label>
          {linkExisting && (
            <>
              <p className="muted">
                {t('linkHelp')}
              </p>
              <label className="field">
                {t('currentPassword')}
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  maxLength={1024}
                />
              </label>
              <label className="interop-check">
                <input type="checkbox" name="confirmAccountLink" required />
                {t('confirmLink')}
              </label>
              <Button onClick={() => navigate("/login")}>
                {t('signInExisting')}
              </Button>
            </>
          )}
          <div className="form-actions">
            <Button disabled={busy} onClick={() => navigate("/login")}>
              {t('back')}
            </Button>
            <button className="primary" disabled={busy}>
              {busy ? t('preparing') : t('continueProvider')}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p role="status">
            {busy
              ? t('openingProvider')
              : t('providerPending')}
          </p>
          {redirectUrl && (
            <p>
              <a href={redirectUrl}>{t('continueProvider')}</a>
            </p>
          )}
          <div className="form-actions">
            <Button disabled={busy} onClick={() => navigate("/login")}>
              {t('back')}
            </Button>
            <Button className="primary" disabled={busy} onClick={retry}>
              {t('resume')}
            </Button>
          </div>
        </div>
      )}
      <p className="muted">
        {t('finalHelp')}
      </p>
    </main>
  );
}

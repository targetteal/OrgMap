import { createHash, randomBytes } from "node:crypto";
import { TRELLO_SCOPES, type TrelloCredential } from "./trello.js";
export type TrelloOAuthConfiguration = {
  clientId: string;
  clientSecret: string;
  callbackUri: string;
  authOrigin?: string;
  allowLocalHttp?: boolean;
};
export type TrelloTokens = TrelloCredential & { refreshToken: string };
const requestedScopes = [TRELLO_SCOPES.read, TRELLO_SCOPES.write, "offline_access"] as const;
const bearer = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 8192 && /^[A-Za-z0-9._~+/=-]+$/.test(v);
function local(url: URL) { return url.protocol === "http:" && (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost")); }
export class TrelloOAuthProtocol {
  private origin: URL;
  constructor(private configuration: TrelloOAuthConfiguration) {
    this.origin = new URL(configuration.authOrigin ?? "https://auth.atlassian.com");
    const callback = new URL(configuration.callbackUri);
    if (this.origin.username || this.origin.password || this.origin.pathname !== "/" || this.origin.search || this.origin.hash ||
      !((this.origin.origin === "https://auth.atlassian.com") || (configuration.allowLocalHttp === true && local(this.origin))) ||
      callback.username || callback.password || callback.search || callback.hash ||
      !(callback.protocol === "https:" || (configuration.allowLocalHttp === true && local(callback))) ||
      !configuration.clientId || configuration.clientId.length > 512 || !configuration.clientSecret || configuration.clientSecret.length > 4096)
      throw Error("INVALID_TRELLO_OAUTH_CONFIGURATION");
  }
  /** Caller persists state digest + verifier, actor/tenant/connection, expiry and one-use cookie binding. */
  begin() {
    const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    const url = new URL("authorize", this.origin);
    for (const [key, value] of Object.entries({ client_id: this.configuration.clientId, redirect_uri: this.configuration.callbackUri,
      response_type: "code", prompt: "consent", scope: requestedScopes.join(" "), state,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") })) url.searchParams.set(key, value);
    return { authorizationUrl: url.href, state, verifier };
  }
  /** State/cookie/tenant/actor/connection must already have been checked and consumed by the caller. */
  async exchange(code: string, verifier: string): Promise<TrelloTokens> {
    if (typeof code !== "string" || !code || code.length > 4096 || typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw Error("INVALID_TRELLO_AUTHORIZATION_CODE");
    return this.tokens({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: this.configuration.callbackUri });
  }
  /** Refresh tokens rotate. Caller serializes and persists the returned pair atomically; no blind retry. */
  async refresh(refreshToken: string): Promise<TrelloTokens> {
    if (typeof refreshToken !== "string" || !refreshToken || refreshToken.length > 8192 || /[\x00-\x1f\x7f]/.test(refreshToken)) throw Error("INVALID_TRELLO_REFRESH_TOKEN");
    return this.tokens({ grant_type: "refresh_token", refresh_token: refreshToken });
  }
  private async tokens(grant: Record<string, string>): Promise<TrelloTokens> {
    try {
      const response = await fetch(new URL("oauth/token", this.origin), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: this.configuration.clientId, client_secret: this.configuration.clientSecret, ...grant }),
      });
      if (response.status !== 200) { await response.body?.cancel(); throw Error(); }
      const reader = response.body?.getReader();
      if (!reader) throw Error();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 32768) throw Error(); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const scopes: string[] = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : [];
      if (!bearer(data.access_token) || typeof data.refresh_token !== "string" || !data.refresh_token || data.refresh_token.length > 8192 ||
        /[\x00-\x1f\x7f]/.test(data.refresh_token) || !Number.isSafeInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 86400 ||
        (data.token_type !== undefined && (typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer")) ||
        ![TRELLO_SCOPES.read, TRELLO_SCOPES.write].every(scope => scopes.includes(scope)) || scopes.some(scope => !(requestedScopes as readonly string[]).includes(scope))) throw Error();
      return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + data.expires_in * 1000), scopes: [...new Set(scopes)] };
    } catch { throw Error("TRELLO_AUTHORIZATION_FAILED"); }
  }
}

/** Trello OAuth2 wire adapter. Domain authorization, consent and durable dedup stay with the caller. */
export type TrelloCredential = {
  accessToken: string;
  scopes: readonly string[];
  expiresAt: Date;
};
type Blocked = { kind: "BLOCKED"; code: "AUTHORIZATION_REQUIRED" | "SCOPE_REQUIRED" | "DESTINATION_UNAVAILABLE" | "REMOTE_REQUEST_REJECTED" | "REMOTE_RESPONSE_INVALID" };
type Retryable = { kind: "RETRYABLE"; code: "RATE_LIMITED" | "REMOTE_UNAVAILABLE"; retryAfterMs: number };
type Unknown = { kind: "OUTCOME_UNKNOWN"; code: "REMOTE_OUTCOME_UNKNOWN" };
export type TrelloResult<T> = ({ kind: "CONFIRMED" } & T) | Blocked | Retryable | Unknown;
export const TRELLO_SCOPES = { read: "read:board:trello", write: "write:board:trello" } as const;
const remoteId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

async function json(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw Error("invalid response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw Error("response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}

export class TrelloProtocol {
  private base: URL;
  private timeoutMs: number;
  constructor(private options: {
    /** Resolve current grant/expiry/revocation for every request; never a browser supplied token. */
    credential: () => Promise<TrelloCredential | null>;
    apiBaseUrl?: string;
    allowLocalHttp?: boolean;
    timeoutMs?: number;
  }) {
    this.base = new URL(options.apiBaseUrl ?? "https://api.trello.com/1/");
    if (this.base.username || this.base.password || this.base.search || this.base.hash ||
      this.base.pathname !== "/1/" ||
      !((this.base.protocol === "https:" && this.base.hostname === "api.trello.com" && !this.base.port) ||
        (options.allowLocalHttp === true && this.base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(this.base.hostname))))
      throw Error("INVALID_TRELLO_ENDPOINT");
    this.timeoutMs = options.timeoutMs ?? 8000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 250 || this.timeoutMs > 10000)
      throw Error("INVALID_TRELLO_TIMEOUT");
  }

  private async request(method: "GET" | "POST", path: string, scope: string, payload?: unknown): Promise<TrelloResult<{ data: any }>> {
    let credential: TrelloCredential | null;
    try { credential = await this.options.credential(); } catch { credential = null; }
    if (!credential || !Number.isFinite(+credential.expiresAt) || +credential.expiresAt <= Date.now() ||
      typeof credential.accessToken !== "string" || credential.accessToken.length > 8192 || !/^[A-Za-z0-9._~+/=-]+$/.test(credential.accessToken))
      return { kind: "BLOCKED", code: "AUTHORIZATION_REQUIRED" };
    if (!Array.isArray(credential.scopes) || !credential.scopes.includes(scope)) return { kind: "BLOCKED", code: "SCOPE_REQUIRED" };
    try {
      const response = await fetch(new URL(path, this.base), {
        method, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Authorization: "Bearer " + credential.accessToken, Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) return { kind: "BLOCKED", code: "AUTHORIZATION_REQUIRED" };
        if (response.status === 404) return { kind: "BLOCKED", code: "DESTINATION_UNAVAILABLE" };
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 60;
          return { kind: "RETRYABLE", code: "RATE_LIMITED", retryAfterMs: Math.max(1000, Math.min(3600000, seconds * 1000)) };
        }
        if (response.status >= 500) return method === "POST" ? { kind: "OUTCOME_UNKNOWN", code: "REMOTE_OUTCOME_UNKNOWN" } : { kind: "RETRYABLE", code: "REMOTE_UNAVAILABLE", retryAfterMs: 30000 };
        if (method === "POST" && response.status >= 200 && response.status < 300) return { kind: "OUTCOME_UNKNOWN", code: "REMOTE_OUTCOME_UNKNOWN" };
        return { kind: "BLOCKED", code: "REMOTE_REQUEST_REJECTED" };
      }
      return { kind: "CONFIRMED", data: await json(response) };
    } catch {
      // POST may already have committed remotely. Never automatically repeat it on an ambiguous response.
      return method === "POST" ? { kind: "OUTCOME_UNKNOWN", code: "REMOTE_OUTCOME_UNKNOWN" } : { kind: "RETRYABLE", code: "REMOTE_UNAVAILABLE", retryAfterMs: 30000 };
    }
  }

  async probeList(listId: string, expectedBoardId?: string): Promise<TrelloResult<{ listId: string; boardId: string; name: string }>> {
    if (!remoteId(listId) || (expectedBoardId !== undefined && !remoteId(expectedBoardId))) throw Error("INVALID_TRELLO_DESTINATION");
    const response = await this.request("GET", `lists/${listId}?fields=id,name,idBoard,closed`, TRELLO_SCOPES.read);
    if (response.kind !== "CONFIRMED") return response;
    const value = response.data;
    if (!value || value.id !== listId || !remoteId(value.idBoard) || typeof value.name !== "string" || typeof value.closed !== "boolean")
      return { kind: "BLOCKED", code: "REMOTE_RESPONSE_INVALID" };
    if (value.closed || (expectedBoardId && value.idBoard !== expectedBoardId)) return { kind: "BLOCKED", code: "DESTINATION_UNAVAILABLE" };
    return { kind: "CONFIRMED", listId, boardId: value.idBoard, name: value.name };
  }

  async createCard(input: { listId: string; title: string; description: string; correlationId: string }): Promise<TrelloResult<{ remoteId: string; listId: string }>> {
    if (!remoteId(input.listId) || !uuid.test(input.correlationId) || typeof input.title !== "string" || !input.title.trim() || input.title.length > 200 || typeof input.description !== "string" || input.description.length > 16000)
      throw Error("INVALID_TRELLO_CARD_INPUT");
    const response = await this.request("POST", "cards", TRELLO_SCOPES.write, {
      idList: input.listId, name: input.title,
      desc: `${input.description}\n\n[OrgMap:${input.correlationId}]`,
    });
    if (response.kind !== "CONFIRMED") return response;
    if (!response.data || !remoteId(response.data.id) || response.data.idList !== input.listId)
      return { kind: "OUTCOME_UNKNOWN", code: "REMOTE_OUTCOME_UNKNOWN" };
    return { kind: "CONFIRMED", remoteId: response.data.id, listId: input.listId };
  }
  async findCorrelation(listId: string, correlationId: string): Promise<TrelloResult<{ matches: string[] }>> {
    if (!remoteId(listId) || !uuid.test(correlationId)) throw Error("INVALID_TRELLO_DESTINATION");
    const response = await this.request("GET", `lists/${listId}/cards`, TRELLO_SCOPES.read);
    if (response.kind !== "CONFIRMED") return response;
    if (!Array.isArray(response.data) || response.data.some(card => !card || !remoteId(card.id) || card.idList !== listId || typeof card.desc !== "string"))
      return { kind: "BLOCKED", code: "REMOTE_RESPONSE_INVALID" };
    const marker = `[OrgMap:${correlationId}]`;
    return { kind: "CONFIRMED", matches: response.data.filter(card => card.desc.split(/\r?\n/).includes(marker)).map(card => card.id) };
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { TrelloProtocol, TRELLO_SCOPES, type TrelloCredential } from "../../server/modules/interoperability/providers/trello.js";
import { TrelloOAuthProtocol } from "../../server/modules/interoperability/providers/trello-oauth.js";
import { createHash } from "node:crypto";

test("Trello OAuth2 HTTP fixture proves list/card wire shape, scopes, rate-limit retry, revocation and ambiguous POST without blind retry", async () => {
  const listId = "5abbe4b7ddc1b351ef961414", boardId = "5abbe4b7ddc1b351ef961415", cardId = "5abbe4b7ddc1b351ef961416";
  let credential: TrelloCredential | null = { accessToken: "synthetic-private-access-token", expiresAt: new Date(Date.now() + 3600000), scopes: Object.values(TRELLO_SCOPES) };
  let status = 200, closed = false, invalidResponse = false, redirected = 0, remotelyCreated = 0;
  const received: { method: string; url: string; auth?: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    const bytes: Buffer[] = [];
    for await (const bytesPart of req) bytes.push(Buffer.from(bytesPart));
    const body = bytes.length ? JSON.parse(Buffer.concat(bytes).toString()) : undefined;
    received.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
    if (req.url === "/leak") { redirected++; res.end("unexpected"); return; }
    if (status === 302) { res.writeHead(302, { Location: "/leak" }); res.end(); return; }
    if (req.method === "POST" && status !== 429 && status !== 401 && status !== 403 && status !== 404) remotelyCreated++;
    if (status !== 200) { res.writeHead(status, { "Content-Type": "application/json", "Retry-After": "2" }); res.end(JSON.stringify({ error: "synthetic-private-access-token must never escape via error" })); return; }
    res.setHeader("Content-Type", "application/json");
    if (invalidResponse) { res.end('{"unexpected":true}'); return; }
    if (req.method === "GET") {
      assert.equal(req.url, `/1/lists/${listId}?fields=id,name,idBoard,closed`);
      res.end(JSON.stringify({ id: listId, idBoard: boardId, name: "Synthetic destination", closed }));
    } else {
      assert.equal(req.url, "/1/cards");
      res.end(JSON.stringify({ id: cardId, idList: listId }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const protocol = new TrelloProtocol({ credential: async () => credential, apiBaseUrl: `http://127.0.0.1:${(server.address() as any).port}/1/`, allowLocalHttp: true });
  const input = { listId, title: "A real protocol fixture task", description: "Plain text from the authorized task snapshot", correlationId: randomUUID() };
  try {
    assert.deepEqual(await protocol.probeList(listId, boardId), { kind: "CONFIRMED", listId, boardId, name: "Synthetic destination" });
    assert.deepEqual(await protocol.createCard(input), { kind: "CONFIRMED", remoteId: cardId, listId });
    assert.deepEqual(received[1].body, { idList: listId, name: input.title, desc: `${input.description}\n\n[OrgMap:${input.correlationId}]` });
    assert.ok(received.every(r => r.auth === "Bearer synthetic-private-access-token" && !r.url.includes("token")));
    status = 429;
    const beforeLimited = remotelyCreated;
    assert.deepEqual(await protocol.createCard(input), { kind: "RETRYABLE", code: "RATE_LIMITED", retryAfterMs: 2000 });
    assert.equal(remotelyCreated, beforeLimited);
    status = 200;
    assert.equal((await protocol.createCard(input)).kind, "CONFIRMED");
    assert.equal(remotelyCreated, beforeLimited + 1);
    const attemptsBeforeUnknown = received.length;
    status = 503;
    assert.deepEqual(await protocol.createCard(input), { kind: "OUTCOME_UNKNOWN", code: "REMOTE_OUTCOME_UNKNOWN" });
    assert.equal(received.length, attemptsBeforeUnknown + 1);
    assert.equal(remotelyCreated, beforeLimited + 2, "fixture committed before returning 503; client must reconcile, not blindly resend");
    assert.deepEqual(await protocol.probeList(listId), { kind: "RETRYABLE", code: "REMOTE_UNAVAILABLE", retryAfterMs: 30000 });
    status = 401;
    const authFailure = await protocol.createCard(input);
    assert.deepEqual(authFailure, { kind: "BLOCKED", code: "AUTHORIZATION_REQUIRED" });
    assert.ok(!JSON.stringify(authFailure).includes("synthetic-private-access-token"));
    status = 200; closed = true;
    assert.deepEqual(await protocol.probeList(listId), { kind: "BLOCKED", code: "DESTINATION_UNAVAILABLE" });
    closed = false; invalidResponse = true;
    assert.equal((await protocol.createCard(input)).kind, "OUTCOME_UNKNOWN");
    invalidResponse = false; status = 302;
    assert.equal((await protocol.createCard(input)).kind, "OUTCOME_UNKNOWN");
    assert.equal(redirected, 0);
    const beforeBlocked = received.length;
    credential = { ...credential!, scopes: [TRELLO_SCOPES.read] };
    assert.deepEqual(await protocol.createCard(input), { kind: "BLOCKED", code: "SCOPE_REQUIRED" });
    credential = null;
    assert.deepEqual(await protocol.probeList(listId), { kind: "BLOCKED", code: "AUTHORIZATION_REQUIRED" });
    assert.equal(received.length, beforeBlocked, "missing scopes and revoked grant never perform I/O");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("Trello endpoint cannot become arbitrary HTTP, credentials in URL or caller-selected path", async () => {
  const credential = async () => null;
  for (const apiBaseUrl of ["http://api.trello.com/1/", "https://outside.example/1/", "https://api.trello.com.evil.test/1/", "https://api.trello.com/other/", "https://secret@api.trello.com/1/", "https://api.trello.com/1/?token=secret"]) {
    assert.throws(() => new TrelloProtocol({ credential, apiBaseUrl }));
  }
  const protocol = new TrelloProtocol({ credential });
  await assert.rejects(() => protocol.probeList("../../members/me"));
  await assert.rejects(() => protocol.createCard({ listId: "5abbe4b7ddc1b351ef961414", title: "", description: "", correlationId: randomUUID() }));
});

test("Trello OAuth2 local code/PKCE and rotating refresh exchange preserve explicit scopes and redact provider errors", async () => {
  let challenge = "", usedCode = false, currentRefresh = "synthetic-refresh-1", invalidScope = false;
  const grants: any[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.url, "/oauth/token");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const data = JSON.parse(Buffer.concat(chunks).toString());
    grants.push(data);
    assert.equal(data.client_id, "synthetic-client");
    assert.equal(data.client_secret, "synthetic-client-private");
    const authorized = data.grant_type === "authorization_code"
      ? !usedCode && data.code === "synthetic-code" && createHash("sha256").update(data.code_verifier).digest("base64url") === challenge
      : data.grant_type === "refresh_token" && data.refresh_token === currentRefresh;
    if (!authorized) { res.writeHead(400); res.end(JSON.stringify({ error_description: "synthetic-client-private provider details" })); return; }
    if (data.grant_type === "authorization_code") usedCode = true;
    currentRefresh = "synthetic-refresh-" + randomUUID();
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ access_token: "synthetic-access-token", refresh_token: currentRefresh, expires_in: 3600, token_type: "Bearer", scope: invalidScope ? "read:board:trello" : Object.values(TRELLO_SCOPES).join(" ") + " offline_access" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const protocol = new TrelloOAuthProtocol({ clientId: "synthetic-client", clientSecret: "synthetic-client-private", callbackUri: "http://interoperability.localhost:5197/callback", authOrigin: `http://127.0.0.1:${(server.address() as any).port}`, allowLocalHttp: true });
  try {
    const flow = protocol.begin(), url = new URL(flow.authorizationUrl);
    challenge = url.searchParams.get("code_challenge")!;
    assert.equal(url.searchParams.get("state"), flow.state);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.deepEqual(new Set(url.searchParams.get("scope")!.split(" ")), new Set([...Object.values(TRELLO_SCOPES), "offline_access"]));
    assert.ok(!url.href.includes("synthetic-client-private"));
    await assert.rejects(() => protocol.exchange("synthetic-code", "x".repeat(43)), { message: "TRELLO_AUTHORIZATION_FAILED" });
    const tokens = await protocol.exchange("synthetic-code", flow.verifier);
    assert.equal(tokens.accessToken, "synthetic-access-token");
    assert.ok(+tokens.expiresAt > Date.now());
    assert.equal(grants[1].redirect_uri, "http://interoperability.localhost:5197/callback");
    await assert.rejects(() => protocol.exchange("synthetic-code", flow.verifier), { message: "TRELLO_AUTHORIZATION_FAILED" });
    const rotated = await protocol.refresh(tokens.refreshToken);
    assert.notEqual(rotated.refreshToken, tokens.refreshToken);
    await assert.rejects(() => protocol.refresh(tokens.refreshToken), { message: "TRELLO_AUTHORIZATION_FAILED" });
    invalidScope = true;
    await assert.rejects(() => protocol.refresh(rotated.refreshToken), { message: "TRELLO_AUTHORIZATION_FAILED" });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

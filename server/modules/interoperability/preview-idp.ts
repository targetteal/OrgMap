// Local-only synthetic provider for CUA acceptance. Never imported by product composition.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { pkceChallenge } from "./oidc.js";
export async function startPreviewIdp() {
  const keys = await generateKeyPair("RS256"),
    jwk = await exportJWK(keys.publicKey);
  jwk.kid = "orgmap-cua-preview";
  const pending = new Map<
      string,
      { redirect: string; state: string; nonce: string; challenge: string }
    >(),
    codes = new Map<
      string,
      { redirect: string; nonce: string; challenge: string }
    >();
  let base = "";
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, base);
      if (url.pathname === "/jwks") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/authorize") {
        if (
          url.searchParams.get("client_id") !== "orgmap-cua" ||
          url.searchParams.get("code_challenge_method") !== "S256"
        )
          throw Error();
        const redirect = url.searchParams.get("redirect_uri")!;
        if (
          !redirect.startsWith(
            "http://interoperability.localhost:5197/api/v1/organizations/",
          )
        )
          throw Error();
        const handle = randomUUID();
        pending.set(handle, {
          redirect,
          state: url.searchParams.get("state")!,
          nonce: url.searchParams.get("nonce")!,
          challenge: url.searchParams.get("code_challenge")!,
        });
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IdP local sintético — OrgMap QA</title><body style="font:16px system-ui;max-width:480px;margin:40px auto;padding:16px"><h1>Confirmar identidade sintética</h1><p>Provedor local de teste. Nenhuma conta ou credencial externa é utilizada.</p><form method="post" action="/confirm"><input type="hidden" name="handle" value="${handle}"><label>Usuário sintético<input name="user" required autocomplete="off" style="display:block;width:100%;padding:10px;margin:8px 0 16px"></label><label>Senha sintética<input name="password" type="password" required autocomplete="off" style="display:block;width:100%;padding:10px;margin:8px 0 16px"></label><button>Confirmar identidade</button></form></body></html>`,
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/confirm") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 4096) throw Error();
        }
        const values = new URLSearchParams(raw),
          flow = pending.get(values.get("handle") ?? "");
        if (
          !flow ||
          values.get("user") !== "synthetic-enrollee" ||
          values.get("password") !== "synthetic-idp-pass-123"
        )
          throw Error();
        pending.delete(values.get("handle")!);
        const code = randomUUID();
        codes.set(code, flow);
        const redirect = new URL(flow.redirect);
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", flow.state);
        res.writeHead(303, { Location: redirect.href }).end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/token") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const values = new URLSearchParams(raw),
          flow = codes.get(values.get("code") ?? "");
        if (
          !flow ||
          values.get("client_id") !== "orgmap-cua" ||
          pkceChallenge(values.get("code_verifier") ?? "") !== flow.challenge ||
          values.get("redirect_uri") !== flow.redirect
        )
          throw Error();
        codes.delete(values.get("code")!);
        const jwt = await new SignJWT({ nonce: flow.nonce })
          .setProtectedHeader({ alg: "RS256", kid: "orgmap-cua-preview" })
          .setIssuer(base)
          .setSubject("immutable-cua-enrollee")
          .setAudience("orgmap-cua")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(keys.privateKey);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ id_token: jwt }));
        return;
      }
      res.writeHead(404).end();
    } catch {
      res
        .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
        .end("Confirmação sintética recusada.");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + (server.address() as any).port;
  return { base, server };
}

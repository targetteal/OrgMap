import { lockActiveOrganization } from "../../src/organization-lifecycle.js";
import type { FastifyInstance } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import { transaction } from "../../src/db.js";
import { body, digest, fail, id, text, uuid } from "../../src/core.js";
import { federationErrorHandler } from "./federation-error.js";
import { assertLinkAccountStamp, captureLinkAccountStamp, type LinkAccountStamp } from "./link-account-proof.js";
import { registerAccountFederatedReauthentication } from "./account-reauth.js";
import {
  exchangeOidcCode,
  oidcAuthorization,
  type OidcConfiguration,
} from "./oidc.js";
export type FederationConfiguration = Record<string, OidcConfiguration>;
export async function registerFederation(
  app: FastifyInstance,
  core: ModuleRuntime,
  base: string,
  configuration: FederationConfiguration,
  configured: (
    organizationId: string,
    connectionId: string,
    provider: string,
  ) => boolean = () => false,
  trustedIssuer: (organizationId: string, connectionId: string, provider: string) => string | undefined = (org, connection, provider) => provider === "OIDC" ? configuration[org + ":" + connection]?.issuer : undefined,
) {
  registerAccountFederatedReauthentication(core, trustedIssuer);
  core.registerAccountAuthMethods(async (c, accountId) => {
    const priorOrg =
      (
        await c.query(
          "SELECT current_setting('orgmap.organization_id',true) AS value",
        )
      ).rows[0].value ?? "";
    const priorAccount =
      (
        await c.query(
          "SELECT current_setting('orgmap.account_id',true) AS value",
        )
      ).rows[0].value ?? "";
    await c.query("SELECT set_config('orgmap.account_id',$1,true)", [
      accountId,
    ]);
    try {
      const identities = (
        await c.query(
          "SELECT id,organization_id,connection_id FROM interop_federated_identities WHERE account_id=$1",
          [accountId],
        )
      ).rows;
      const methods = [];
      for (const identity of identities) {
        await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
          identity.organization_id,
        ]);
        const row = (
          await c.query(
            "SELECT c.provider,c.label FROM interop_connections c JOIN members m ON m.organization_id=c.organization_id JOIN organization_lifecycle l ON l.organization_id=c.organization_id AND l.state='ACTIVE' WHERE c.organization_id=$1 AND c.id=$2 AND c.state<>'REVOKED' AND m.account_id=$3 AND m.status='ACTIVE'",
            [identity.organization_id, identity.connection_id, accountId],
          )
        ).rows[0];
        if (row)
          methods.push({
            id: identity.id,
            kind: row.provider,
            label: row.label,
            enabled: configured(
              identity.organization_id,
              identity.connection_id,
              row.provider,
            ),
            verified: true,
            ...(["OIDC", "SAML"].includes(row.provider) ? { reauthenticationUrl: `/api/v1/organizations/${identity.organization_id}/interoperability/connections/${identity.connection_id}/${row.provider.toLowerCase()}/login?reauth=1` } : {}),
          });
      }
      return methods;
    } finally {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        priorOrg,
      ]);
      await c.query("SELECT set_config('orgmap.account_id',$1,true)", [
        priorAccount,
      ]);
    }
  });
  type Proof = {
    claims: Record<string, unknown>;
    verifiedAt: Date;
    amr?: readonly string[];
    authTime?: Date;
    linkStamp?: LinkAccountStamp;
    provider: "OIDC" | "SAML";
    organizationId: string;
    connectionId: string;
    accountId: string | null;
    issuer: string;
    subject: string;
  };
  const proofs = new WeakSet<object>();
  core.registerFederatedIdentityResolver(async (unknownProof, c) => {
    if (
      !unknownProof ||
      typeof unknownProof !== "object" ||
      !proofs.has(unknownProof)
    )
      return null;
    proofs.delete(unknownProof);
    const proof = unknownProof as Proof;
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      proof.organizationId,
    ]);
    await lockActiveOrganization(c, proof.organizationId);
    if (proof.accountId) await assertLinkAccountStamp(core, c, proof.accountId, proof.linkStamp);
    const connection = (
      await c.query(
        "SELECT * FROM interop_connections WHERE organization_id=$1 AND id=$2 AND state<>'REVOKED' AND provider=$3",
        [proof.organizationId, proof.connectionId, proof.provider],
      )
    ).rows[0];
    if (!connection) return null;
    let identity = (
      await c.query(
        "SELECT * FROM interop_federated_identities WHERE organization_id=$1 AND connection_id=$2 AND issuer=$3 AND subject=$4",
        [proof.organizationId, proof.connectionId, proof.issuer, proof.subject],
      )
    ).rows[0];
    if (proof.accountId) {
      if (identity && identity.account_id !== proof.accountId)
        fail(409, "FEDERATED_IDENTITY_ALREADY_LINKED");
      if (!identity) {
        identity = (
          await c.query(
            "INSERT INTO interop_federated_identities(organization_id,id,connection_id,issuer,subject,account_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              proof.organizationId,
              uuid(),
              proof.connectionId,
              proof.issuer,
              proof.subject,
              proof.accountId,
            ],
          )
        ).rows[0];
      }
    }
    if (!identity) fail(401, "FEDERATED_IDENTITY_NOT_LINKED");
    const member = (
      await c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE'",
        [proof.organizationId, identity.account_id],
      )
    ).rows[0];
    if (!member) return null;
    return {
      accountId: identity.account_id,
      provenance: {
        method: "FEDERATED" as const,
        organizationId: proof.organizationId,
        connectionId: proof.connectionId,
        issuer: proof.issuer,
        subject: proof.subject,
        verifiedAt: proof.verifiedAt,
        amr: proof.amr,
        authTime: proof.authTime,
      },
    };
  });
  async function start(
    organizationId: string,
    connectionId: string,
    accountId: string | null,
    enrollmentFlowId?: string,
    linkStamp?: LinkAccountStamp,
    forceReauthentication = false,
  ) {
    const config = configuration[organizationId + ":" + connectionId];
    if (!config) fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
    const flow = oidcAuthorization(config, { forceReauthentication });
    await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        organizationId,
      ]);
      await lockActiveOrganization(c, organizationId);
      if (accountId) await assertLinkAccountStamp(core, c, accountId, linkStamp);
      const conn = (
        await c.query(
          "SELECT * FROM interop_connections WHERE organization_id=$1 AND id=$2 AND provider='OIDC' AND state<>'REVOKED'",
          [organizationId, connectionId],
        )
      ).rows[0];
      if (!conn) fail(404, "RESOURCE_NOT_FOUND");
      await c.query(
        "DELETE FROM interop_auth_flows WHERE organization_id=$1 AND expires_at<now()",
        [organizationId],
      );
      await c.query(
        "INSERT INTO interop_auth_flows(organization_id,id,connection_id,state_hash,nonce,verifier,link_account_id,expires_at,flow_kind,enrollment_flow_id,initiating_session_id,account_email_revision) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes',$8,$9,$10,$11)",
        [
          organizationId,
          uuid(),
          connectionId,
          digest(flow.state),
          flow.nonce,
          flow.verifier,
          accountId,
          enrollmentFlowId ? "ENROLLMENT" : accountId ? "LINK" : "LOGIN",
          enrollmentFlowId ?? null,
          linkStamp?.sessionId ?? null,
          linkStamp?.emailRevision ?? null,
        ],
      );
    });
    return { authorizationUrl: flow.url, browserState: flow.state };
  }
  const browserFlow = (
    reply: any,
    flow: { authorizationUrl: string; browserState: string },
  ) => {
    reply.header("Cache-Control", "no-store");
    reply.setCookie("orgmap_oidc_flow", flow.browserState, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: 300,
    });
    return { authorizationUrl: flow.authorizationUrl };
  };
  app.post(base + "/connections/:connectionId/oidc/link", async (r, reply) => {
    body(r, []);
    const result = await core.tenant(r, { mode: "read" }, async (ctx) => {
      if (ctx.principal) fail(403, "COOKIE_SESSION_REQUIRED");
      return { accountId: ctx.account.id, org: ctx.org.id, linkStamp: await captureLinkAccountStamp(core, ctx) };
    });
    return core.envelope(
      r,
      browserFlow(
        reply,
        await start(
          result.data.org,
          id((r.params as any).connectionId),
          result.data.accountId,
          undefined,
          result.data.linkStamp,
        ),
      ),
    );
  });
  app.get(base + "/connections/:connectionId/oidc/login", async (r, reply) => {
    const q = r.query as Record<string, unknown>;
    if (Object.keys(q).some(key => key !== "reauth") || (q.reauth !== undefined && q.reauth !== "1")) fail(400, "INVALID_REQUEST");
    return browserFlow(
      reply,
      await start(
        id((r.params as any).organizationId),
        id((r.params as any).connectionId),
        null,
        undefined,
        undefined,
        q.reauth === "1",
      ),
    );
  });
  app.post(
    base + "/connections/:connectionId/oidc/enrollment/start",
    async (r, reply) => {
      body(r, []);
      const org = id((r.params as any).organizationId),
        connection = id((r.params as any).connectionId),
        iam = core;
      const enrollment = await iam.getProvisionedEnrollmentRequest(r, {
        organizationId: org,
        connectionId: connection,
      });
      return core.envelope(
        r,
        browserFlow(
          reply,
          await start(org, connection, null, enrollment.flowId),
        ),
      );
    },
  );
  app.get(
    base + "/connections/:connectionId/oidc/callback",
    { errorHandler: federationErrorHandler },
    async (r, reply) => {
      const organizationId = id((r.params as any).organizationId),
        connectionId = id((r.params as any).connectionId),
        q = r.query as any;
      if (
        Object.keys(q).some(
          (k) =>
            !["state", "code", "iss", "error", "error_description"].includes(k),
        ) ||
        q.error
      )
        fail(401, "OIDC_AUTHORIZATION_FAILED");
      const state = text(q.state, 200),
        code = text(q.code, 4096),
        config = configuration[organizationId + ":" + connectionId];
      if (!config) fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
      if (r.cookies.orgmap_oidc_flow !== state)
        fail(401, "OIDC_BROWSER_STATE_INVALID");
      reply.clearCookie("orgmap_oidc_flow", { path: "/" });
      if (q.iss && q.iss !== config.issuer) fail(401, "OIDC_ISSUER_INVALID");
      const flow = await transaction(async (c) => {
        await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
          organizationId,
        ]);
        await lockActiveOrganization(c, organizationId);
        const row = (
          await c.query(
            "UPDATE interop_auth_flows SET consumed_at=now() WHERE organization_id=$1 AND connection_id=$2 AND state_hash=$3 AND consumed_at IS NULL AND expires_at>now() RETURNING *",
            [organizationId, connectionId, digest(state)],
          )
        ).rows[0];
        if (!row) fail(401, "OIDC_STATE_INVALID");
        return row;
      });
      const linkStamp = flow.flow_kind === "LINK" ? { sessionId: flow.initiating_session_id, emailRevision: Number(flow.account_email_revision) } : undefined;
      if (flow.flow_kind === "LINK") await transaction(c => assertLinkAccountStamp(core, c, flow.link_account_id, linkStamp, { token: r.cookies.orgmap_session }));
      const claims = await exchangeOidcCode(
        config,
        code,
        flow.verifier,
        flow.nonce,
      );
      const proof: Proof = {
        claims: claims as Record<string, unknown>,
        amr: Array.isArray(claims.amr) ? [...claims.amr] as string[] : undefined,
        authTime: typeof claims.auth_time === "number" ? new Date(claims.auth_time * 1000) : undefined,
        verifiedAt: new Date(),
        provider: "OIDC",
        organizationId,
        connectionId,
        accountId: flow.link_account_id,
        issuer: config.issuer,
        subject: claims.sub!,
        linkStamp,
      };
      proofs.add(proof);
      reply.header("Cache-Control", "no-store");
      if (flow.flow_kind === "ENROLLMENT") {
        const iam = core;
        const result = await iam.completeProvisionedEnrollmentRequest(
          r,
          reply,
          proof,
          flow.enrollment_flow_id,
        );
        if (!reply.sent && r.headers.accept?.includes("text/html"))
          return reply.redirect("/structure");
        return result;
      }
      const result = await core.issueFederatedSession(r, reply, proof);
      if (!reply.sent && r.headers.accept?.includes("text/html"))
        return reply.redirect("/structure");
      return result;
    },
  );
  return {
    consumeProvisioningProof(proof: unknown) {
      if (!proof || typeof proof !== "object" || !proofs.has(proof))
        return null;
      proofs.delete(proof);
      const verified = proof as Proof;
      if (Date.now() - verified.verifiedAt.getTime() > 300000) return null;
      return {
        organizationId: verified.organizationId,
        connectionId: verified.connectionId,
        issuer: verified.issuer,
        subject: verified.subject,
        claims: verified.claims,
        verifiedAt: verified.verifiedAt,
        amr: verified.amr,
        authTime: verified.authTime,
      };
    },
    verifiedIdentity(proof: Proof) {
      proofs.add(proof);
      return proof;
    },
  };
}

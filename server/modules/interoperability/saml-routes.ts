import { lockActiveOrganization } from "../../src/organization-lifecycle.js";
import type { FastifyInstance } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import { transaction } from "../../src/db.js";
import { body, digest, fail, id, secret, text, uuid } from "../../src/core.js";
import { federationErrorHandler } from "./federation-error.js";
import { assertLinkAccountStamp, captureLinkAccountStamp, type LinkAccountStamp } from "./link-account-proof.js";
import {
  consumeSamlAssertion,
  persistentSamlCache,
  samlAdapter,
  type SamlConfiguration,
} from "./saml.js";
export type SamlConfigurations = Record<string, SamlConfiguration>;
type VerifiedIdentity = {
  claims: Record<string, unknown>;
  verifiedAt: Date;
  amr?: readonly string[];
  authTime?: Date;
  linkStamp?: LinkAccountStamp;
  provider: "SAML";
  organizationId: string;
  connectionId: string;
  accountId: string | null;
  issuer: string;
  subject: string;
};
export async function registerSaml(
  app: FastifyInstance,
  core: ModuleRuntime,
  base: string,
  configuration: SamlConfigurations,
  verifiedIdentity: (identity: VerifiedIdentity) => unknown,
) {
  const enrollmentProofs = new WeakMap<object, string>();
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded"))
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 150000 },
      (_r, body, done) => {
        try {
          const form = new URLSearchParams(body as string);
          const keys = [...form.keys()];
          if (new Set(keys).size !== keys.length) throw Error();
          done(null, Object.fromEntries(form));
        } catch {
          done(Error("INVALID_FORM"));
        }
      },
    );
  async function start(
    org: string,
    connection: string,
    account: string | null,
    reply: any,
    enrollmentFlowId?: string,
    linkStamp?: LinkAccountStamp,
    forceReauthentication = false,
  ) {
    const config = configuration[org + ":" + connection];
    if (!config) fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
    const state = secret();
    await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        org,
      ]);
      await lockActiveOrganization(c, org);
      if (account) await assertLinkAccountStamp(core, c, account, linkStamp);
      const row = (
        await c.query(
          "SELECT * FROM interop_connections WHERE organization_id=$1 AND id=$2 AND provider='SAML' AND state<>'REVOKED'",
          [org, connection],
        )
      ).rows[0];
      if (!row) fail(404, "RESOURCE_NOT_FOUND");
      await c.query(
        "INSERT INTO interop_auth_flows(organization_id,id,connection_id,state_hash,nonce,verifier,link_account_id,expires_at,flow_kind,enrollment_flow_id,initiating_session_id,account_email_revision) VALUES($1,$2,$3,$4,'','',$5,now()+interval '5 minutes',$6,$7,$8,$9)",
        [
          org,
          uuid(),
          connection,
          digest(state),
          account,
          enrollmentFlowId ? "ENROLLMENT" : account ? "LINK" : "LOGIN",
          enrollmentFlowId ?? null,
          linkStamp?.sessionId ?? null,
          linkStamp?.emailRevision ?? null,
        ],
      );
    });
    const url = await samlAdapter(
      config,
      persistentSamlCache(org, connection),
      forceReauthentication,
    ).authorize(state);
    reply.setCookie("orgmap_saml_flow", state, {
      httpOnly: true,
      sameSite: config.allowLocalHttp ? "lax" : "none",
      secure: !config.allowLocalHttp,
      path: "/",
      maxAge: 300,
    });
    reply.header("Cache-Control", "no-store");
    return { authorizationUrl: url };
  }
  app.post(base + "/connections/:connectionId/saml/link", async (r, reply) => {
    body(r, []);
    const result = await core.tenant(r, { mode: "read" }, async (ctx) => {
      if (ctx.principal) fail(403, "COOKIE_SESSION_REQUIRED");
      return { account: ctx.account.id, org: ctx.org.id, linkStamp: await captureLinkAccountStamp(core, ctx) };
    });
    return core.envelope(
      r,
      await start(
        result.data.org,
        id((r.params as any).connectionId),
        result.data.account,
        reply,
        undefined,
        result.data.linkStamp,
      ),
    );
  });
  app.get(base + "/connections/:connectionId/saml/login", (r, reply) => {
    const q = r.query as Record<string, unknown>;
    if (Object.keys(q).some(key => key !== "reauth") || (q.reauth !== undefined && q.reauth !== "1")) fail(400, "INVALID_REQUEST");
    return start(
      id((r.params as any).organizationId),
      id((r.params as any).connectionId),
      null,
      reply,
      undefined,
      undefined,
      q.reauth === "1",
    );
  });
  const callback = base + "/connections/:connectionId/saml/acs";
  app.post(
    base + "/connections/:connectionId/saml/enrollment/start",
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
        await start(org, connection, null, reply, enrollment.flowId),
      );
    },
  );
  core.registerFederatedCallback({
    method: "POST",
    path: callback,
    verify: async (r) => {
      const org = id((r.params as any).organizationId),
        connection = id((r.params as any).connectionId),
        config = configuration[org + ":" + connection];
      if (!config) fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
      if (
        r.headers.origin &&
        r.headers.origin !== new URL(config.entryPoint).origin
      )
        fail(403, "ORIGIN_DENIED");
      const b = r.body as any;
      if (
        !b ||
        typeof b !== "object" ||
        Object.keys(b).some((k) => !["SAMLResponse", "RelayState"].includes(k))
      )
        fail(401, "SAML_ASSERTION_INVALID");
      const state = text(b.RelayState, 200);
      if (r.cookies.orgmap_saml_flow !== state)
        fail(401, "SAML_BROWSER_STATE_INVALID");
      const flow = await transaction(async (c) => {
        await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
          org,
        ]);
        await lockActiveOrganization(c, org);
        const row = (
          await c.query(
            "UPDATE interop_auth_flows SET consumed_at=now() WHERE organization_id=$1 AND connection_id=$2 AND state_hash=$3 AND consumed_at IS NULL AND expires_at>now() RETURNING *",
            [org, connection, digest(state)],
          )
        ).rows[0];
        if (!row) fail(401, "SAML_STATE_INVALID");
        return row;
      });
      const linkStamp = flow.flow_kind === "LINK" ? { sessionId: flow.initiating_session_id, emailRevision: Number(flow.account_email_revision) } : undefined;
      if (flow.flow_kind === "LINK") await transaction(c => assertLinkAccountStamp(core, c, flow.link_account_id, linkStamp, { token: r.cookies.orgmap_session }));
      const assertion = await samlAdapter(
        config,
        persistentSamlCache(org, connection),
      ).verify(text(b.SAMLResponse, 131072));
      await consumeSamlAssertion(org, connection, assertion.assertionId);
      const proof = verifiedIdentity({
        claims: assertion.claims,
        amr: assertion.amr,
        authTime: assertion.authTime,
        verifiedAt: new Date(),
        provider: "SAML",
        organizationId: org,
        connectionId: connection,
        accountId: flow.link_account_id,
        issuer: assertion.issuer,
        subject: assertion.subject,
        linkStamp,
      });
      if (flow.flow_kind === "ENROLLMENT" && proof && typeof proof === "object")
        enrollmentProofs.set(proof, flow.enrollment_flow_id);
      return proof;
    },
  });
  app.post(
    callback,
    { bodyLimit: 150000, errorHandler: federationErrorHandler },
    async (r, reply) => {
      const proof = core.federatedCallbackProof(r);
      reply.clearCookie("orgmap_saml_flow", { path: "/" });
      reply.header("Cache-Control", "no-store");
      const enrollmentFlowId =
        proof && typeof proof === "object"
          ? enrollmentProofs.get(proof)
          : undefined;
      if (enrollmentFlowId) {
        enrollmentProofs.delete(proof as object);
        const iam = core;
        const result = await iam.completeProvisionedEnrollmentRequest(
          r,
          reply,
          proof,
          enrollmentFlowId,
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
}

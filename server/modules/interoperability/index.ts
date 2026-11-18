import { createLifecycleAuthMethodsPort } from "./lifecycle.js";
import type { OrgMapModule } from "../../src/runtime.js";
import {
  body,
  camel,
  digest,
  fail,
  id,
  secret,
  text,
  uuid,
  version,
} from "../../src/core.js";
import { calendar, validInstant } from "./calendar.js";
import { registerEnrollmentScim } from "./scim-enrollment.js";
import { registerMcp } from "./mcp.js";
import {
  businessCommand,
  businessScopes,
  commandForHttp,
} from "./business-catalog.js";
import { registerBusinessApi } from "./business-dispatch.js";
import {
  registerFederation,
  type FederationConfiguration,
} from "./federation.js";
import {
  registerWebhooks,
  type WebhookConfiguration,
} from "./webhook-routes.js";
import { localCalendarAdapter } from "./local-calendar-adapter.js";
import { registerSaml, type SamlConfigurations } from "./saml-routes.js";
import { registerDeliveries, type DeliveryConfigurations } from "./delivery.js";
import type { DeliverySchedulingPort } from "./delivery-worker.js";
import type { EnrollmentConfiguration } from "./enrollment-ports.js";
import { registerEnrollmentAuthority } from "./enrollment-authority.js";
import { createInteroperabilityGuestAccessAdapter } from "./guest.js";
const base = "/api/v1/organizations/:organizationId/interoperability";
const metadata =
  "id,member_id,label,kind,scopes,expires_at,revoked_at,version,created_at,connection_id";
export function createInteroperability(
  configuration: FederationConfiguration = {},
  webhooks: WebhookConfiguration = {
    secrets: {},
    ports: { externalChange: localCalendarAdapter },
  },
  saml: SamlConfigurations = {},
  deliveries: DeliveryConfigurations = {},
  deliveryScheduling?: DeliverySchedulingPort,
  enrollment: EnrollmentConfiguration = {},
): OrgMapModule {
  return async (app, core) => {
    core.registerGuestAccessAdapter(createInteroperabilityGuestAccessAdapter());
    core.registerLifecycleAuthMethods(createLifecycleAuthMethodsPort((org, connection, provider) =>
      provider === "OIDC" ? !!configuration[org + ":" + connection]
        : provider === "SAML" ? !!saml[org + ":" + connection] : false));
    await registerWebhooks(app, core, base, webhooks);
    await registerDeliveries(app, core, base, deliveries, deliveryScheduling);
    const federation = await registerFederation(
      app,
      core,
      base,
      configuration,
      (org, connection, provider) =>
        provider === "OIDC"
          ? !!configuration[org + ":" + connection]
          : provider === "SAML"
            ? !!saml[org + ":" + connection]
            : false,
      (org, connection, provider) => provider === "OIDC" ? configuration[org + ":" + connection]?.issuer : provider === "SAML" ? saml[org + ":" + connection]?.idpIssuer : undefined,
    );
    registerEnrollmentAuthority(
      core,
      enrollment,
      configuration,
      saml,
      federation,
    );
    await registerSaml(app, core, base, saml, federation.verifiedIdentity);
    app.post(
      base + "/connections/:connectionId/enrollment/start",
      async (r, reply) => {
        body(r, []);
        const org = id((r.params as any).organizationId),
          connection = id((r.params as any).connectionId),
          key = org + ":" + connection,
          protocol = configuration[key] ? "oidc" : saml[key] ? "saml" : null;
        if (!protocol) fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
        const headers: Record<string, string> = {};
        if (r.headers.cookie) headers.cookie = r.headers.cookie;
        if (typeof r.headers.origin === "string")
          headers.origin = r.headers.origin;
        const response = await app.inject({
          method: "POST",
          url: `/api/v1/organizations/${org}/interoperability/connections/${connection}/${protocol}/enrollment/start`,
          headers,
          payload: {},
        });
        if (response.headers["set-cookie"])
          reply.header("set-cookie", response.headers["set-cookie"]);
        return reply.code(response.statusCode).send(response.json());
      },
    );
    await registerEnrollmentScim(app, core, base, enrollment);
    await registerMcp(app, core, base, webhooks.ports);
    await registerBusinessApi(app, core, base);
    core.registerPrincipalResolver(
      async ({ token, organizationId, request, c }) => {
        const row = (
          await c.query(
            `SELECT k.*,m.account_id FROM interop_credentials k JOIN members m ON m.organization_id=k.organization_id AND m.id=k.member_id WHERE k.organization_id=$1 AND k.token_hash=$2 AND k.revoked_at IS NULL AND k.expires_at>now() AND m.status='ACTIVE'`,
            [organizationId, digest(token)],
          )
        ).rows[0];
        if (!row) return null;
        if (
          row.connection_id &&
          !(
            await c.query(
              "SELECT 1 FROM interop_connections WHERE organization_id=$1 AND id=$2 AND state<>'REVOKED'",
              [organizationId, row.connection_id],
            )
          ).rowCount
        )
          return null;
        const path = request.url.split("?")[0],
          prefix = `/api/v1/organizations/${organizationId}/interoperability`;
        const target = commandForHttp(
          request.method,
          request.url,
          organizationId,
        );
        const commandPath = path.startsWith(prefix + "/commands/")
          ? businessCommand(path.slice((prefix + "/commands/").length))
          : undefined;
        if (row.kind === "API" && (target || commandPath)) {
          const command = target ?? commandPath!;
          if (!row.scopes.includes(command.scope)) return null;
          return {
            accountId: row.account_id,
            organizationId,
            credentialId: row.id,
            scopes: [
              ...row.scopes,
              "orgmap:read",
              ...(target && target.method !== "GET" ? ["orgmap:write"] : []),
            ],
          };
        }
        const allowed =
          row.kind === "API"
            ? (request.method === "GET" &&
                [
                  prefix,
                  prefix + "/calendar",
                  prefix + "/calendar.ics",
                  prefix + "/commands",
                ].includes(path)) ||
              (request.method === "POST" &&
                (path === prefix + "/mcp" ||
                  new RegExp(
                    "^" + prefix + "/connections/[a-f0-9-]+/webhook$",
                  ).test(path)))
            : row.kind === "CALENDAR"
              ? request.method === "GET" && path === prefix + "/calendar.ics"
              : path.startsWith(prefix + "/scim/v2/");
        if (!allowed) return null;
        return {
          accountId: row.account_id,
          organizationId,
          credentialId: row.id,
          scopes: row.scopes,
        };
      },
    );
    app.get(base, (r) =>
      core.tenant(
        r,
        { mode: "read", requiredScopes: ["interop.read"] },
        async (ctx) => ({
          credentials: (
            await ctx.c.query(
              `SELECT ${metadata} FROM interop_credentials WHERE organization_id=$1 AND member_id=$2 ORDER BY created_at DESC`,
              [ctx.org.id, ctx.member.id],
            )
          ).rows.map(camel),
          connections: (
            await ctx.c.query(
              "SELECT * FROM interop_connections WHERE organization_id=$1 ORDER BY label",
              [ctx.org.id],
            )
          ).rows.map((row) => ({
            ...camel(row),
            configured:
              !!configuration[ctx.org.id + ":" + row.id] ||
              !!saml[ctx.org.id + ":" + row.id] ||
              !!webhooks.secrets[ctx.org.id + ":" + row.id],
          })),
          capabilities: {
            manage: !ctx.principal,
            manageConnections:
              ctx.member.org_role === "OWNER" && !ctx.principal,
            bearerAuthentication: true,
            federatedLogin:
              Object.keys(configuration).some((k) =>
                k.startsWith(ctx.org.id + ":"),
              ) ||
              Object.keys(saml).some((k) => k.startsWith(ctx.org.id + ":")),
          },
          missingPorts: webhooks.ports.calendar ? [] : ["meetings.calendar"],
          credentialScopes: businessScopes,
        }),
      ),
    );
    app.post(base + "/credentials", async (r) => {
      let once: string | undefined;
      const result = await core.tenant(
        r,
        {
          mode: "write",
          authorize: (ctx) => {
            const b = body(r, [
              "label",
              "kind",
              "scopes",
              "expiresAt",
              "connectionId",
            ]);
            return (
              ctx.member.org_role === "OWNER" ||
              (["API", "CALENDAR"].includes(b.kind) &&
                Array.isArray(b.scopes) &&
                b.scopes.length > 0 &&
                b.scopes.length <= 64 &&
                b.scopes.every(
                  (scope: unknown) =>
                    typeof scope === "string" &&
                    [
                      "interop.read",
                      "calendar.read",
                      ...businessScopes,
                    ].includes(scope),
                ))
            );
          },
        },
        async (ctx) => {
          const b = body(r, [
            "label",
            "kind",
            "scopes",
            "expiresAt",
            "connectionId",
          ]);
          if (
            !["API", "SCIM", "CALENDAR"].includes(b.kind) ||
            !Array.isArray(b.scopes) ||
            b.scopes.length < 1 ||
            b.scopes.length > 64 ||
            new Set(b.scopes).size !== b.scopes.length ||
            !b.scopes.every((scope: unknown) =>
              (
                ({
                  API: [
                    "interop.read",
                    "calendar.read",
                    "webhooks.receive",
                    ...businessScopes,
                  ],
                  SCIM: ["members.provision"],
                  CALENDAR: ["calendar.read"],
                }) as Record<string, string[]>
              )[b.kind]?.includes(scope as string),
            )
          )
            fail(400, "INVALID_SCOPE");
          let connectionId: string | null = null;
          if (b.kind === "SCIM" && b.connectionId === undefined)
            fail(400, "SCIM_CONNECTION_REQUIRED");
          if (b.connectionId !== undefined) {
            if (b.kind !== "SCIM") fail(400, "INVALID_CREDENTIAL_CONNECTION");
            connectionId = id(b.connectionId);
            if (
              !(
                await ctx.c.query(
                  "SELECT 1 FROM interop_connections WHERE organization_id=$1 AND id=$2 AND provider IN ('OIDC','SAML') AND state<>'REVOKED'",
                  [ctx.org.id, connectionId],
                )
              ).rowCount
            )
              fail(404, "RESOURCE_NOT_FOUND");
          }
          const expires = validInstant(b.expiresAt);
          if (
            expires.getTime() <= Date.now() ||
            expires.getTime() > Date.now() + 366 * 86400000
          )
            fail(400, "INVALID_EXPIRY");
          once = secret();
          const keyId = uuid();
          const row = (
            await ctx.c.query(
              `INSERT INTO interop_credentials(organization_id,id,member_id,label,kind,token_hash,scopes,expires_at,connection_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${metadata}`,
              [
                ctx.org.id,
                keyId,
                ctx.member.id,
                text(b.label),
                b.kind,
                digest(once),
                b.scopes,
                expires,
                connectionId,
              ],
            )
          ).rows[0];
          await core.changed(ctx, r, keyId, "IntegrationCredentialIssued");
          return { credential: camel(row) };
        },
      );
      // Idempotency persists metadata only. The secret exists only in this first committed response.
      return {
        ...result,
        data: {
          ...result.data,
          ...(once ? { secret: once } : { secretUnavailable: true }),
        },
      };
    });
    app.post(base + "/credentials/:credentialId/revoke", (r) =>
      core.tenant(
        r,
        { mode: "authorization_write", authorize: () => true },
        async (ctx) => {
          const row = (
            await ctx.c.query(
              "SELECT * FROM interop_credentials WHERE organization_id=$1 AND id=$2 AND member_id=$3",
              [ctx.org.id, id((r.params as any).credentialId), ctx.member.id],
            )
          ).rows[0];
          if (!row) fail(404, "RESOURCE_NOT_FOUND");
          version(r, row.version);
          await ctx.c.query(
            "UPDATE interop_credentials SET revoked_at=now(),version=version+1 WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, row.id],
          );
          await core.changed(ctx, r, row.id, "IntegrationCredentialRevoked");
          return { revoked: true };
        },
      ),
    );
    app.post(base + "/connections", (r) =>
      core.tenant(r, true, async (ctx) => {
        const b = body(r, ["provider", "label"]);
        if (
          !["GOOGLE", "OUTLOOK", "SLACK", "OIDC", "SAML", "LOCAL"].includes(
            b.provider,
          )
        )
          fail(400, "INVALID_PROVIDER");
        const row = (
          await ctx.c.query(
            "INSERT INTO interop_connections(organization_id,id,provider,label) VALUES($1,$2,$3,$4) RETURNING *",
            [ctx.org.id, uuid(), b.provider, text(b.label)],
          )
        ).rows[0];
        await core.changed(ctx, r, row.id, "IntegrationConfigurationCreated");
        return {
          connection: camel(row),
          missingConfiguration:
            b.provider === "LOCAL"
              ? ["adapterPort"]
              : ["providerRegistration", "credentials", "verifiedCallback"],
        };
      }),
    );
    app.post(base + "/connections/:connectionId/revoke", (r) =>
      core.tenant(r, {
        mode: "write",
        accountLocks: async (c, org, request) => (await c.query(
          "SELECT DISTINCT account_id FROM interop_federated_identities WHERE organization_id=$1 AND connection_id=$2 ORDER BY account_id LIMIT 101",
          [org, id((request.params as any).connectionId)],
        )).rows.map(row => row.account_id as string),
      }, async (ctx) => {
        const connectionId = id((r.params as any).connectionId),
          row = (
            await ctx.c.query(
              "SELECT * FROM interop_connections WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, connectionId],
            )
          ).rows[0];
        if (!row) fail(404, "RESOURCE_NOT_FOUND");
        version(r, row.version);
        const affected = (
          await ctx.c.query(
            "SELECT DISTINCT account_id FROM interop_federated_identities WHERE organization_id=$1 AND connection_id=$2 ORDER BY account_id",
            [ctx.org.id, connectionId],
          )
        ).rows;
        for (const identity of affected) {
          await core.assertTargetAccountLocked(ctx, identity.account_id);
          const account = (
            await ctx.c.query(
              "SELECT id,password_enabled FROM accounts WHERE id=$1",
              [identity.account_id],
            )
          ).rows[0];
          if (account && !account.password_enabled) {
            const alternatives = await core.accountAuthMethods(
              ctx.c,
              account.id,
              false,
            );
            const currentIdentities = (
              await ctx.c.query(
                "SELECT id FROM interop_federated_identities WHERE organization_id=$1 AND connection_id=$2 AND account_id=$3",
                [ctx.org.id, connectionId, account.id],
              )
            ).rows.map((x) => x.id);
            if (
              !alternatives.some(
                (method) =>
                  method.enabled &&
                  method.verified &&
                  !currentIdentities.includes(method.id),
              )
            )
              fail(422, "LAST_LOGIN_METHOD_PROTECTED");
          }
        }
        await ctx.c.query(
          "UPDATE interop_connections SET state='REVOKED',version=version+1 WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, connectionId],
        );
        await ctx.c.query(
          "UPDATE interop_deliveries SET state='REVOKED',version=version+1 WHERE organization_id=$1 AND connection_id=$2 AND state<>'DELIVERED'",
          [ctx.org.id, connectionId],
        );
        await ctx.c.query(
          "UPDATE interop_auth_flows SET consumed_at=now() WHERE organization_id=$1 AND connection_id=$2 AND consumed_at IS NULL",
          [ctx.org.id, connectionId],
        );
        await core.changed(
          ctx,
          r,
          connectionId,
          "IntegrationConnectionRevoked",
        );
        return { revoked: true };
      }),
    );
    app.get(base + "/calendar.ics", async (r, reply) => {
      const query=r.query as Record<string,unknown>;
      if(Object.keys(query).some(key=>key!=='includePrivate')||query.includePrivate!==undefined&&query.includePrivate!=='true'&&query.includePrivate!=='false')fail(400,'INVALID_REQUEST');
      const includePrivate=query.includePrivate==='true';
      if(includePrivate&&!webhooks.ports.calendar)fail(422,'PRIVATE_EXPORT_UNSUPPORTED');
      const result = await core.tenant(
        r,
        { mode: "read", requiredScopes: ["calendar.read"] },
        async (ctx) =>
          calendar([
            ...(
              await ctx.c.query(
                "SELECT * FROM interop_calendar_events WHERE organization_id=$1 ORDER BY starts_at,id",
                [ctx.org.id],
              )
            ).rows,
            ...(webhooks.ports.calendar
              ? await webhooks.ports.calendar.list(ctx,{includePrivate})
              : []),
          ]),
      );
      return reply
        .header("Cache-Control", "no-store")
        .type("text/calendar; charset=utf-8")
        .send(result.data);
    });
    app.get(base + "/calendar", (r) =>
      core.tenant(
        r,
        { mode: "read", requiredScopes: ["calendar.read"] },
        async (ctx) => ({
          events: (
            await ctx.c.query(
              "SELECT * FROM interop_calendar_events WHERE organization_id=$1 ORDER BY starts_at,id LIMIT 200",
              [ctx.org.id],
            )
          ).rows.map(camel),
        }),
      ),
    );
    // Named local event command: never accepts SQL or arbitrary destination resources.
    app.post(base + "/calendar-events", (r) =>
      core.tenant(r, true, async (ctx) => {
        const b = body(r, [
          "uid",
          "sequence",
          "summary",
          "startsAt",
          "endsAt",
          "source",
          "cancelled",
        ]);
        if (
          !Number.isSafeInteger(b.sequence) ||
          b.sequence < 0 ||
          typeof b.cancelled !== "boolean" ||
          b.source !== "LOCAL"
        )
          fail(400, "INVALID_REQUEST");
        const start = validInstant(b.startsAt),
          end = validInstant(b.endsAt);
        if (end <= start) fail(400, "INVALID_INTERVAL");
        const uid = text(b.uid, 255);
        const prior = (
          await ctx.c.query(
            "SELECT * FROM interop_calendar_events WHERE organization_id=$1 AND uid=$2",
            [ctx.org.id, uid],
          )
        ).rows[0];
        if (prior && prior.source !== "LOCAL")
          fail(409, "SYNC_SOURCE_CONFLICT");
        if (prior && b.sequence <= prior.sequence)
          fail(409, "STALE_CALENDAR_SEQUENCE");
        const row = (
          await ctx.c.query(
            `INSERT INTO interop_calendar_events(organization_id,id,uid,sequence,summary,starts_at,ends_at,source,cancelled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organization_id,uid) DO UPDATE SET sequence=excluded.sequence,summary=excluded.summary,starts_at=excluded.starts_at,ends_at=excluded.ends_at,cancelled=excluded.cancelled,version=interop_calendar_events.version+1 RETURNING *`,
            [
              ctx.org.id,
              prior?.id ?? uuid(),
              uid,
              b.sequence,
              text(b.summary, 1000),
              start,
              end,
              b.source,
              b.cancelled,
            ],
          )
        ).rows[0];
        await core.changed(ctx, r, row.id, "CalendarEventRecorded");
        return { event: camel(row) };
      }),
    );
  };
}
export const interoperability = createInteroperability();
export default interoperability;

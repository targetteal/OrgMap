import type { Ctx } from "../../src/runtime.js";
import { fail, uuid } from "../../src/core.js";
import type { ProjectOutputOptions } from "./project-output-contract.js";
import { TrelloOAuthProtocol, type TrelloTokens } from "./providers/trello-oauth.js";
import { TrelloProtocol, type TrelloCredential } from "./providers/trello.js";
import { openProviderToken, sealProviderToken, type ProviderSecretScope } from "./providers/secrets.js";
export type ProjectOutputContext = <T>(fn: (ctx: Ctx) => Promise<T>) => Promise<T>;
export class ProjectOutputGrants {
  constructor(readonly options: ProjectOutputOptions) {}
  app(organizationId: string) {
    const app = this.options.configuration[organizationId];
    if (!app) fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
    return app!;
  }
  async key() {
    try { const key = await this.options.encryptionKey(); if (!Buffer.isBuffer(key) || key.length !== 32) throw Error(); return key; }
    catch { return fail(503, "PROVIDER_ENCRYPTION_CONFIGURATION_REQUIRED"); }
  }
  scope(row: any): ProviderSecretScope { return { organizationId: row.organization_id, grantId: row.id, memberId: row.owner_member_id, provider: "TRELLO" }; }
  async get(ctx: Ctx, grantId: string, authorized = true) {
    const row = (await ctx.c.query("SELECT g.*,c.state AS connection_state FROM interop_provider_grants g JOIN interop_connections c ON c.organization_id=g.organization_id AND c.id=g.id WHERE g.organization_id=$1 AND g.id=$2 AND g.owner_member_id=$3 FOR UPDATE OF g", [ctx.org.id, grantId, ctx.member.id])).rows[0];
    if (!row || (authorized && (row.state !== "AUTHORIZED" || row.connection_state === "REVOKED"))) fail(404, "RESOURCE_NOT_FOUND");
    return row;
  }
  metadata(row: any) { return { connectionId: row.id, provider: "TRELLO", state: row.state, scopes: row.scopes, expiresAt: row.expires_at, version: row.version }; }
  async saveTokens(ctx: Ctx, row: any, tokens: TrelloTokens, key: Buffer, mode: "CONSENT" | "REFRESH", lease?: string) {
    const scope = this.scope(row), access = sealProviderToken(key, scope, "ACCESS_TOKEN", tokens.accessToken), refresh = sealProviderToken(key, scope, "REFRESH_TOKEN", tokens.refreshToken);
    const result = await ctx.c.query("UPDATE interop_provider_grants SET state='AUTHORIZED',scopes=$4,access_encrypted=$5,refresh_encrypted=$6,expires_at=$7,refresh_lease=NULL,refresh_lease_until=NULL,version=version+1,authorization_revision=authorization_revision+$8 WHERE organization_id=$1 AND id=$2 AND authorization_revision=$3 AND ($9::uuid IS NULL OR refresh_lease=$9) RETURNING *", [ctx.org.id, row.id, row.authorization_revision, tokens.scopes, access, refresh, tokens.expiresAt, mode === "CONSENT" ? 1 : 0, lease ?? null]);
    if (!result.rowCount) fail(409, "PROVIDER_GRANT_CHANGED");
    return result.rows[0];
  }
  /** All callbacks authorize the current actor/resource. HTTP refresh happens between transactions. */
  async ready(grantId: string, context: ProjectOutputContext, key: Buffer): Promise<"READY" | "RETRY" | "REAUTHORIZE"> {
    const prepared = await context(async ctx => {
      const row = await this.get(ctx, grantId);
      if (row.expires_at && +new Date(row.expires_at) > Date.now() + 30000) return { kind: "READY" as const };
      if (row.refresh_lease && +new Date(row.refresh_lease_until) > Date.now()) return { kind: "RETRY" as const };
      if (!row.refresh_encrypted) return { kind: "REAUTHORIZE" as const };
      const lease = uuid();
      await ctx.c.query("UPDATE interop_provider_grants SET refresh_lease=$3,refresh_lease_until=clock_timestamp()+interval '30 seconds' WHERE organization_id=$1 AND id=$2", [ctx.org.id, grantId, lease]);
      return { kind: "REFRESH" as const, row, lease, token: openProviderToken(key, this.scope(row), "REFRESH_TOKEN", row.refresh_encrypted) };
    });
    if (prepared.kind !== "REFRESH") return prepared.kind;
    let tokens: TrelloTokens;
    try { tokens = await new TrelloOAuthProtocol(this.app(prepared.row.organization_id)).refresh(prepared.token); }
    catch {
      await context(async ctx => {
        await ctx.c.query("UPDATE interop_provider_grants SET state='REAUTHORIZATION_REQUIRED',access_encrypted=NULL,refresh_encrypted=NULL,refresh_lease=NULL,refresh_lease_until=NULL,version=version+1 WHERE organization_id=$1 AND id=$2 AND refresh_lease=$3 AND authorization_revision=$4 AND state='AUTHORIZED'", [ctx.org.id, grantId, prepared.lease, prepared.row.authorization_revision]);
      });
      return "REAUTHORIZE";
    }
    await context(async ctx => {
      const row = await this.get(ctx, grantId);
      if (row.refresh_lease !== prepared.lease || row.authorization_revision !== prepared.row.authorization_revision) fail(409, "PROVIDER_GRANT_CHANGED");
      await this.saveTokens(ctx, row, tokens, key, "REFRESH", prepared.lease);
    });
    return "READY";
  }
  protocol(organizationId: string, grantId: string, context: ProjectOutputContext, key: Buffer) {
    const config = this.app(organizationId);
    return new TrelloProtocol({ apiBaseUrl: config.apiBaseUrl, allowLocalHttp: config.allowLocalHttp, credential: () => context(async ctx => {
      const row = await this.get(ctx, grantId);
      if (!row.expires_at || +new Date(row.expires_at) <= Date.now()) return null;
      return { accessToken: openProviderToken(key, this.scope(row), "ACCESS_TOKEN", row.access_encrypted), scopes: row.scopes, expiresAt: new Date(row.expires_at) } satisfies TrelloCredential;
    }) });
  }
}

import type { LifecycleAuthMethodsPort, LifecycleFederatedMethod } from "../../src/organization-lifecycle-contract.js";
import type { PoolClient } from "pg";

/** The caller holds Org during discovery, then Account during method inspection.
 * This port never takes a second organization lock and restores both RLS scopes.
 */
export function createLifecycleAuthMethodsPort(
  configured: (organizationId: string, connectionId: string, provider: string) => boolean,
): LifecycleAuthMethodsPort {
  return {
    async affectedAccountIds(c, organizationId) {
      return (await c.query(
        "SELECT DISTINCT account_id FROM interop_federated_identities WHERE organization_id=$1 ORDER BY account_id",
        [organizationId],
      )).rows.map((row) => row.account_id as string);
    },
    async methodsForAccount(c: PoolClient, accountId: string) {
      const scope = (await c.query(`SELECT current_setting('orgmap.organization_id',true) AS org,
        current_setting('orgmap.account_id',true) AS account`)).rows[0];
      try {
        await c.query("SELECT set_config('orgmap.account_id',$1,true)", [accountId]);
        const identities = (await c.query(
          "SELECT organization_id,connection_id FROM interop_federated_identities WHERE account_id=$1",
          [accountId],
        )).rows;
        const methods: LifecycleFederatedMethod[] = [];
        for (const identity of identities) {
          await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [identity.organization_id]);
          const row = (await c.query(
            `SELECT c.provider FROM interop_connections c JOIN members m ON m.organization_id=c.organization_id
             WHERE c.organization_id=$1 AND c.id=$2 AND c.state<>'REVOKED'
             AND c.provider IN ('OIDC','SAML') AND m.account_id=$3 AND m.status='ACTIVE'`,
            [identity.organization_id, identity.connection_id, accountId],
          )).rows[0];
          if (row) methods.push({ organizationId: identity.organization_id, kind: row.provider,
            enabled: configured(identity.organization_id, identity.connection_id, row.provider), verified: true });
        }
        return methods;
      } finally {
        await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [scope.org ?? ""]);
        await c.query("SELECT set_config('orgmap.account_id',$1,true)", [scope.account ?? ""]);
      }
    },
  };
}

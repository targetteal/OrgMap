import { assertPlatformDispatchReady } from "./dispatch-readiness.js";
import type { Pool } from "pg";
import { id, uuid } from "../../src/core.js";
import type { ResourceRef } from "./ports.js";
export type DeliveryScope = {
  organizationId: string;
  memberId: string;
  token: string;
};
export type DeliveryClaim = {
  scope: DeliveryScope;
  id: string;
  token: string;
  resource: ResourceRef;
};
export interface DeliveryMetadataPort {
  hasDueJobs(scope: DeliveryScope): Promise<boolean>;
  claim(scope: DeliveryScope): Promise<DeliveryClaim | null>;
  finish(
    claim: DeliveryClaim,
    outcome: "DELIVERED" | "SUPPRESSED" | "RETRY" | "UNKNOWN",
  ): Promise<boolean>;
}
/** The only pre-resource authorization operations; no arbitrary context/SQL callback. */
export function createDeliveryMetadataPort(pool: Pool): DeliveryMetadataPort {
  let verified = false;
  const verify = async () => {
    if (verified) return;
    const row = (
      await pool.query(
        "SELECT current_user AS actor,session_user AS session_actor,pg_has_role(current_user,'orgmap_platform_dispatcher','USAGE') AS allowed,(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass",
      )
    ).rows[0];
    if (
      !row?.allowed ||
      row.bypass ||
      row.actor !== row.session_actor ||
      ["orgmap_app", "orgmap_migrator"].includes(row.actor)
    )
      throw Error("DEDICATED_DISPATCH_CREDENTIAL_REQUIRED");
    verified = true;
  };
  const scopeArgs = (scope: DeliveryScope) => [
    id(scope.organizationId),
    id(scope.memberId),
    id(scope.token),
  ];
  return {
    async hasDueJobs(scope) {
      await assertPlatformDispatchReady();
      await verify();
      return (
        (
          await pool.query(
            "SELECT public.platform_scope_due_jobs($1,$2,$3) AS due",
            scopeArgs(scope),
          )
        ).rows[0].due === true
      );
    },
    async claim(scope) {
      await assertPlatformDispatchReady();
      await verify();
      const token = uuid();
      const row = (
        await pool.query(
          "SELECT * FROM public.platform_claim_delivery_metadata($1,$2,$3,$4)",
          [...scopeArgs(scope), token],
        )
      ).rows[0];
      return row
        ? {
            scope: { ...scope },
            id: row.delivery_id,
            token: row.claim_token,
            resource: { type: row.resource_type, id: row.resource_id },
          }
        : null;
    },
    async finish(claim, outcome) {
      await assertPlatformDispatchReady();
      await verify();
      return (
        (
          await pool.query(
            "SELECT public.platform_finish_delivery_metadata($1,$2,$3,$4,$5) AS finished",
            [
              id(claim.scope.organizationId),
              id(claim.scope.memberId),
              id(claim.id),
              id(claim.token),
              outcome,
            ],
          )
        ).rows[0].finished === true
      );
    },
  };
}

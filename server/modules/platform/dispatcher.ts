import { assertPlatformDispatchReady } from "./dispatch-readiness.js";
import { transaction } from "../../src/db.js";
import { assertManagedWriter } from "../../src/managed-writer.js";
import { assertManagedDispatchTarget } from "../../src/managed-dispatch-target.js";
import pg, { type Pool } from "pg";
import { uuid } from "../../src/core.js";
import type { PlatformWorker } from "./worker.js";
import {
  createDeliveryMetadataPort,
  type DeliveryMetadataPort,
} from "./delivery-metadata.js";
export type PendingScope = {
  organizationId: string;
  memberId: string;
  token: string;
  /** Consumers whose due wakes belong to this lease. Omitted only by legacy custom ports. */
  participants?: readonly string[];
};
/** Only scope metadata. Implementations must not return resource IDs, titles, emails or payloads. */
export interface PendingScopeDispatchPort {
  deliveryMetadata?(): DeliveryMetadataPort;
  claim(participants?: readonly string[]): Promise<PendingScope | null>;
  release(
    scope: PendingScope,
    failed: boolean,
    repeat?: readonly string[],
  ): Promise<boolean>;
  heartbeat(scope: PendingScope): Promise<boolean>;
}
/** Fail closed on absent service configuration; never fall back to localhost:5432 or the web pool. */
export function createConfiguredScopeDispatch(
  connectionString = process.env.PLATFORM_DISPATCH_DATABASE_URL,
) {
  if (!connectionString) throw Error("PLATFORM_DISPATCH_DATABASE_URL_REQUIRED");
  const parsed = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.username ||
    !parsed.hostname ||
    !parsed.pathname.slice(1)
  )
    throw Error("INVALID_PLATFORM_DISPATCH_DATABASE_URL");
  const pool = new pg.Pool({ connectionString });
  return { port: new PostgresScopeDispatch(pool), close: () => pool.end() };
}
export class PostgresScopeDispatch implements PendingScopeDispatchPort {
  private verified = false;
  constructor(private dedicatedPool: Pool) {}
  deliveryMetadata() {
    return createDeliveryMetadataPort(this.dedicatedPool);
  }
  private async verify() {
    await assertManagedDispatchTarget(this.dedicatedPool);
    if (this.verified) return;
    const r = (
      await this.dedicatedPool.query(
        "SELECT current_user AS actor,pg_has_role(current_user,'orgmap_platform_dispatcher','USAGE') AS allowed,(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass",
      )
    ).rows[0];
    if (!r?.allowed || r.bypass || r.actor === "orgmap_app")
      throw Error("DEDICATED_DISPATCH_CREDENTIAL_REQUIRED");
    this.verified = true;
  }
  async claim(participants: readonly string[] = []) {
    await assertPlatformDispatchReady();
    await this.verify();
    const token = uuid(),
      r = (
        await this.dedicatedPool.query(
          "SELECT * FROM platform_claim_scope($1,$2::text[])",
          [token, participants],
        )
      ).rows[0];
    if (!r) return null;
    const wakes = await this.dedicatedPool.query(
      "SELECT participant FROM platform_claimed_participants($1,$2,$3)",
      [r.organization_id, r.member_id, token],
    );
    return {
      organizationId: r.organization_id,
      memberId: r.member_id,
      token,
      participants: wakes.rows.map((wake) => wake.participant as string),
    };
  }
  async release(
    s: PendingScope,
    failed: boolean,
    repeat: readonly string[] = [],
  ) {
    await assertPlatformDispatchReady();
    await this.verify();
    return (
      (
        await this.dedicatedPool.query(
          "SELECT platform_release_scope($1,$2,$3,$4,$5::text[]) AS released",
          [s.organizationId, s.memberId, s.token, failed, repeat],
        )
      ).rows[0].released === true
    );
  }
  async heartbeat(s: PendingScope) {
    await assertPlatformDispatchReady();
    await this.verify();
    return (
      (
        await this.dedicatedPool.query(
          "SELECT platform_heartbeat_scope($1,$2,$3) AS renewed",
          [s.organizationId, s.memberId, s.token],
        )
      ).rows[0].renewed === true
    );
  }
}
export interface ScopeWorkParticipant {
  name: string;
  /** true processed an item: dispatcher durably wakes again. Domain retry schedules availableAt in its own transaction. */
  runDelivery(organizationId: string, memberId: string): Promise<boolean>;
}
export class PlatformDispatcher {
  constructor(
    private scopes: PendingScopeDispatchPort,
    private worker: PlatformWorker,
    private participants: readonly ScopeWorkParticipant[] = [],
  ) {
    if (
      new Set(participants.map((p) => p.name)).size !== participants.length ||
      participants.some((p) => !/^[a-z][a-z0-9-]{0,49}$/.test(p.name))
    )
      throw Error("Invalid or duplicate work participant");
  }
  async runOnce() {
    await transaction(assertManagedWriter);
    const scope = await this.scopes.claim(this.participants.map((p) => p.name));
    if (!scope) return false;
    let failed = false;
    const repeat: string[] = [];
    const heartbeat = setInterval(() => {
      void this.scopes.heartbeat(scope).catch(() => {});
    }, 20000);
    heartbeat.unref();
    try {
      await this.worker.runJob(scope.organizationId, scope.memberId, scope);
      await this.worker.runDelivery(
        scope.organizationId,
        scope.memberId,
        scope,
      );
      for (const participant of this.participants)
        if (
          scope.participants === undefined ||
          scope.participants.includes(participant.name)
        )
          if (
            await participant.runDelivery(scope.organizationId, scope.memberId)
          )
            repeat.push(participant.name);
    } catch {
      failed = true;
    } finally {
      clearInterval(heartbeat);
      await this.scopes.release(scope, failed, repeat);
    }
    return true;
  }
}

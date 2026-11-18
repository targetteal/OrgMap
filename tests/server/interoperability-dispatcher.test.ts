import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import {
  createOrgMapIntegration,
  createIntegratedDispatcher,
} from "../../server/integration/index.js";
import { PostgresScopeDispatch } from "../../server/modules/platform/dispatcher.js";
import { createPlatformScheduling } from "../../server/modules/platform/scheduling.js";
import type { DeliveryConfigurations } from "../../server/modules/interoperability/delivery.js";
const directory = await mkdtemp(join(tmpdir(), "orgmap-interop-dispatch-")),
  configuration: DeliveryConfigurations = {};
let core!: ModuleRuntime;
const app = await buildApp(
  [
    createOrgMapIntegration({
      deliveries: configuration,
      blobsDirectory: directory,
    }),
    async (_app, runtime) => {
      core = runtime;
    },
  ],
  { migrationMaxPrefix: 999 },
);
after(async () => {
  await app.close();
  await pool.end();
  await rm(directory, { recursive: true, force: true });
});
async function request(
  method: string,
  path: string,
  user?: any,
  payload?: any,
  headers: any = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...headers,
    },
    payload,
  });
}
test("dedicated dispatcher retains unknown HTTP outcome and does not resend after restart", async () => {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (
    !migrationUrl ||
    !/^\/orgmap_(?:interop_|test_)[a-f0-9]+$/.test(
      new URL(migrationUrl).pathname,
    )
  )
    throw Error("Exclusive disposable DB required");
  const admin = new pg.Pool({ connectionString: migrationUrl }),
    role = "interop_dispatch_" + randomUUID().replaceAll("-", ""),
    password = randomUUID().replaceAll("-", ""),
    url = new URL(migrationUrl);
  await admin.query(
    'CREATE ROLE "' +
      role +
      '" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ' +
      "'" +
      password +
      "'",
  );
  await admin.query('GRANT orgmap_platform_dispatcher TO "' + role + '"');
  url.username = role;
  url.password = password;
  const discoveryPool = new pg.Pool({ connectionString: url.href });
  let calls = 0;
  const receiver = createServer(async (req, res) => {
    for await (const _chunk of req) {
    }
    calls++;
    res.writeHead(calls === 1 ? 503 : 204).end();
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  try {
    await assert.rejects(
      discoveryPool.query("SELECT * FROM interop_deliveries"),
    );
    const registered = await request("POST", "/auth/register", undefined, {
      email: randomUUID() + "@example.test",
      password: "dispatch-synthetic-test-123",
      displayName: "Dispatcher synthetic",
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const u = {
      cookie: registered.cookies[0].name + "=" + registered.cookies[0].value,
      csrf: registered.json().data.csrfToken,
    };
    const org = await request("POST", "/organizations", u, {
      name: "Automatic interop dispatch",
    });
    assert.equal(org.statusCode, 201, org.body);
    const orgId = org.json().data.organization.id,
      memberId = org.json().data.membership.id,
      p = "/organizations/" + orgId + "/interoperability";
    const connection = await request("POST", p + "/connections", u, {
      provider: "LOCAL",
      label: "Dispatcher receiver",
    });
    assert.equal(connection.statusCode, 200, connection.body);
    const cid = connection.json().data.connection.id;
    configuration[orgId + ":" + cid] = {
      endpoint:
        "http://127.0.0.1:" + (receiver.address() as any).port + "/receive",
      secret: "synthetic-dispatch-signature",
      allowLocalHttp: true,
    };
    const event = await request("POST", p + "/calendar-events", u, {
      uid: randomUUID() + "@local",
      sequence: 0,
      summary: "Auto event",
      startsAt: "2030-10-20T13:00:00Z",
      endsAt: "2030-10-20T14:00:00Z",
      source: "LOCAL",
      cancelled: false,
    });
    assert.equal(event.statusCode, 200, event.body);
    const queued = await request(
      "POST",
      p + "/connections/" + cid + "/deliveries",
      u,
      { calendarEventId: event.json().data.event.id },
    );
    assert.equal(queued.statusCode, 200, queued.body);
    const deliveryId = queued.json().data.delivery.id;
    const dispatcher = createIntegratedDispatcher(
      new PostgresScopeDispatch(discoveryPool),
      { deliveries: configuration, blobsDirectory: directory },
    );
    for (let attempt = 0; attempt < 10 && calls === 0; attempt++)
      await dispatcher.runOnce();
    assert.equal(calls, 1);
    let state = await core.withWorkerContext(
      orgId,
      memberId,
      async (ctx) =>
        (
          await ctx.c.query(
            "SELECT state,last_error FROM interop_deliveries WHERE organization_id=$1 AND id=$2",
            [orgId, deliveryId],
          )
        ).rows[0],
    );
    assert.equal(state.state, "OUTCOME_UNKNOWN");
    assert.equal(state.last_error, "REMOTE_HTTP_503");
    const effect = await core.withWorkerContext(orgId, memberId, async (ctx) =>
      (await ctx.c.query("SELECT state FROM organization_effects WHERE organization_id=$1 AND owner='INTEROP' AND effect_key=$2", [orgId, 'delivery:' + deliveryId])).rows[0],
    );
    assert.equal(effect.state, "OUTCOME_UNKNOWN");
    await core.withWorkerContext(orgId, memberId, async (ctx) => {
      await ctx.c.query(
        "UPDATE interop_deliveries SET available_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [orgId, deliveryId],
      );
      await createPlatformScheduling("interoperability").schedule(ctx, {
        availableAt: new Date(Date.now() - 1000),
      });
    });
    const restarted = createIntegratedDispatcher(
      new PostgresScopeDispatch(discoveryPool),
      { deliveries: configuration, blobsDirectory: directory },
    );
    for (let attempt = 0; attempt < 10; attempt++) await restarted.runOnce();
    assert.equal(calls, 1);
    state = await core.withWorkerContext(
      orgId,
      memberId,
      async (ctx) =>
        (
          await ctx.c.query(
            "SELECT state,attempts FROM interop_deliveries WHERE organization_id=$1 AND id=$2",
            [orgId, deliveryId],
          )
        ).rows[0],
    );
    assert.equal(state.state, "OUTCOME_UNKNOWN");
    assert.equal(state.attempts, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      receiver.close((e) => (e ? reject(e) : resolve())),
    );
    await discoveryPool.end();
    await admin.query('DROP ROLE "' + role + '"');
    await admin.end();
  }
});

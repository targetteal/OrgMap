import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import { createInteroperability } from "../../server/modules/interoperability/index.js";
import { InteroperabilityDeliveryWorker } from "../../server/modules/interoperability/delivery-worker.js";
import { verifyWebhook } from "../../server/modules/interoperability/webhook.js";
import type { DeliveryConfigurations } from "../../server/modules/interoperability/delivery.js";
const configuration: DeliveryConfigurations = {};
let core!: ModuleRuntime;
const app = await buildApp([foundationDefaultAdmissionPolicy,
  createInteroperability({}, undefined, {}, configuration),
  async (_app, runtime) => {
    core = runtime;
  },
]);
after(async () => {
  await app.close();
  await pool.end();
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
test("IAM-authorized delivery worker durable retry/backoff, parallel lease, remote signature and queued revocation", async () => {
  let calls = 0,
    failFirst = true;
  const secret = "worker-synthetic-only";
  const receiver = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    verifyWebhook(
      secret,
      String(req.headers["x-orgmap-event-id"]),
      Number(req.headers["x-orgmap-timestamp"]),
      Buffer.concat(chunks),
      String(req.headers["x-orgmap-signature"]),
    );
    calls++;
    res.writeHead(failFirst ? 503 : 204).end();
    failFirst = false;
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  try {
    const registered = await request("POST", "/auth/register", undefined, {
      email: randomUUID() + "@example.test",
      password: "worker-synthetic-test-123",
      displayName: "Worker synthetic",
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const u = {
      cookie: registered.cookies[0].name + "=" + registered.cookies[0].value,
      csrf: registered.json().data.csrfToken,
    };
    const org = await request("POST", "/organizations", u, {
      name: "Interop worker synthetic",
    });
    assert.equal(org.statusCode, 201, org.body);
    const orgId = org.json().data.organization.id,
      memberId = org.json().data.membership.id,
      p = "/organizations/" + orgId + "/interoperability";
    const connection = await request("POST", p + "/connections", u, {
      provider: "LOCAL",
      label: "Durable delivery",
    });
    assert.equal(connection.statusCode, 200, connection.body);
    const connectionId = connection.json().data.connection.id;
    configuration[orgId + ":" + connectionId] = {
      endpoint:
        "http://127.0.0.1:" + (receiver.address() as any).port + "/receive",
      secret,
      allowLocalHttp: true,
    };
    const e = await request("POST", p + "/calendar-events", u, {
      uid: randomUUID() + "@local",
      sequence: 0,
      summary: "Worker event",
      startsAt: "2030-10-20T13:00:00Z",
      endsAt: "2030-10-20T14:00:00Z",
      source: "LOCAL",
      cancelled: false,
    });
    assert.equal(e.statusCode, 200, e.body);
    const queued = await request(
      "POST",
      p + "/connections/" + connectionId + "/deliveries",
      u,
      { calendarEventId: e.json().data.event.id },
    );
    assert.equal(queued.statusCode, 200, queued.body);
    let deliveryId = queued.json().data.delivery.id;
    const worker = new InteroperabilityDeliveryWorker({
      withContext: core.withWorkerContext,
      configuration,
    });
    assert.equal(await worker.runDelivery(orgId, memberId), true);
    assert.equal(calls, 1);
    let persisted = await core.withWorkerContext(
      orgId,
      memberId,
      async (ctx) =>
        (
          await ctx.c.query(
            "SELECT * FROM interop_deliveries WHERE organization_id=$1 AND id=$2",
            [orgId, deliveryId],
          )
        ).rows[0],
    );
    assert.equal(persisted.state, "OUTCOME_UNKNOWN");
    assert.equal(persisted.attempts, 1);
    assert.equal(persisted.last_error, "REMOTE_HTTP_503");
    assert.equal(persisted.owner_member_id, memberId);
    assert.equal(await worker.runDelivery(orgId, memberId), false);
    assert.equal(calls, 1);
    const nextEvent = await request("POST", p + "/calendar-events", u, {
      uid: randomUUID()+"@local", sequence: 0, summary: "Known preconnect failure", startsAt:"2030-10-20T13:00:00Z", endsAt:"2030-10-20T14:00:00Z", source:"LOCAL", cancelled:false,
    });
    assert.equal(nextEvent.statusCode, 200, nextEvent.body);
    const nextDelivery = await request("POST", p + "/connections/" + connectionId + "/deliveries", u, {calendarEventId:nextEvent.json().data.event.id});
    assert.equal(nextDelivery.statusCode, 200, nextDelivery.body);
    deliveryId = nextDelivery.json().data.delivery.id;
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as any).port;
    await new Promise<void>((resolve,reject) => closed.close(error => error ? reject(error) : resolve()));
    const key = orgId + ":" + connectionId, endpoint = configuration[key].endpoint;
    configuration[key].endpoint = `http://127.0.0.1:${closedPort}/receive`;
    try { assert.equal(await worker.runDelivery(orgId,memberId), true); }
    finally { configuration[key].endpoint = endpoint; }
    persisted = await core.withWorkerContext(orgId,memberId, async ctx =>
      (await ctx.c.query("SELECT * FROM interop_deliveries WHERE organization_id=$1 AND id=$2",[orgId,deliveryId])).rows[0]);
    assert.equal(persisted.state, "FAILED");
    assert.equal(calls, 1);
    await core.withWorkerContext(orgId, memberId, async (ctx) => {
      await ctx.c.query(
        "UPDATE interop_deliveries SET available_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [orgId, deliveryId],
      );
    });
    const parallel = await Promise.all([
      worker.runDelivery(orgId, memberId),
      worker.runDelivery(orgId, memberId),
    ]);
    assert.equal(parallel.filter(Boolean).length, 1);
    assert.equal(calls, 2);
    persisted = await core.withWorkerContext(
      orgId,
      memberId,
      async (ctx) =>
        (
          await ctx.c.query(
            "SELECT * FROM interop_deliveries WHERE organization_id=$1 AND id=$2",
            [orgId, deliveryId],
          )
        ).rows[0],
    );
    assert.equal(persisted.state, "DELIVERED");
    assert.equal(persisted.attempts, 2);
    assert.equal(persisted.lease_token, null);
    const revoke = await request(
      "POST",
      p + "/connections/" + connectionId + "/revoke",
      u,
      {},
      { "if-match": '"1"' },
    );
    assert.equal(revoke.statusCode, 200, revoke.body);
    assert.equal(await worker.runDelivery(orgId, memberId), false);
    assert.equal(calls, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      receiver.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

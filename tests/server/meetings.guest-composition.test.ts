import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createOrgMapIntegration } from "../../server/integration/index.js";
if (
  !/^\/orgmap_meetings_test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("Disposable DB required");
const blobs = await mkdtemp(join(tmpdir(), "orgmap-meetings-guest-root-"));
const app = await buildApp(
  [createOrgMapIntegration({ blobsDirectory: blobs })],
  { migrationMaxPrefix: 999 },
);
after(async () => {
  await app.close();
  await pool.end();
  await rm(blobs, { recursive: true, force: true });
});
type User = { id: string; cookie: string; csrf: string };
async function call(method: string, path: string, payload?: any, u?: User) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
    },
  });
}
function ok(r: any, status = 200) {
  assert.equal(r.statusCode, status, r.body);
  return r.json().data;
}
async function user(): Promise<User> {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "Guest-root-meetings-123",
    displayName: "Synthetic root",
  });
  const d = ok(r, 201);
  return {
    id: d.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
test("actual root composition registers Meetings Guest and passes the bound policy to the HTTP consumer", async () => {
  const owner = await user(),
    guest = await user(),
    A = ok(
      await call(
        "POST",
        "/organizations",
        { name: "Guest root meetings" },
        owner,
      ),
      201,
    ),
    base = "/organizations/" + A.organization.id;
  async function meeting(title: string) {
    return ok(
      await call(
        "POST",
        base + "/meeting-series",
        {
          title,
          circleId: A.rootCircle.id,
          localStart: "2030-01-01T10:00",
          timeZone: "America/Sao_Paulo",
          durationMinutes: 60,
          recurrence: { frequency: "ONCE" },
          sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
          participants: [],
          policy: { notesOnlyNoter: false, windowDays: 7 },
        },
        owner,
      ),
      201,
    ).occurrenceIds[0];
  }
  const shared = await meeting("Shared through root"),
    hidden = await meeting("Private root sentinel");
  ok(
    await call(
      "POST",
      base + "/members",
      {
        accountId: guest.id,
        memberType: "GUEST",
        accessPlan: [
          {
            resource: { context: "meetings", kind: "meeting", id: shared },
            actions: ["read"],
          },
        ],
      },
      owner,
    ),
    201,
  );
  const read = ok(
    await call("GET", base + "/meetings/" + shared, undefined, guest),
  );
  assert.equal(read.accessMode, "GUEST_READ");
  assert.deepEqual(read.participants, []);
  assert.ok(Object.values(read.capabilities).every((v) => v === false));
  const list = ok(
    await call("GET", base + "/meetings?limit=1", undefined, guest),
  );
  assert.deepEqual(
    list.items.map((x: any) => x.id),
    [shared],
  );
  assert.equal(list.page.hasMore, false);
  assert.equal(
    (await call("GET", base + "/meetings/" + hidden, undefined, guest))
      .statusCode,
    404,
  );
});

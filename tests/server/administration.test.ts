import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import {
  organizationSettings,
  oversight,
  effectivePolicy,
  createAdministration,
  readCredentialPolicy,
  readAdmissionPolicy,
  canonicalAdmissionDomain,
  readUploadPolicy,
  createMemberIndicatorAuthority,
} from "../../server/modules/administration/index.js";
import { deliverLocalInvitations } from "../../server/src/mail.js";
import { startSmtpSink } from "../../server/src/smtp.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool, transaction } from "../../server/src/db.js";
import { fail } from "../../server/src/core.js";
import { createAdministrationGuestAccessAdapter } from "../../server/modules/administration/guest.js";
import {
  createPlatform,
  createIncomingUploadService,
  ResourceRegistry,
  FilesystemBlobStore,
} from "../../server/modules/platform/index.js";
import type { ResourceAction } from "../../server/modules/platform/ports.js";
import type { ModuleRuntime, OrgMapModule } from "../../server/src/runtime.js";
import {
  memberResourceAdapter,
  publicPageResourceAdapter,
} from "../../server/modules/administration/resources.js";
const requests: any[] = [];
let syntheticRegistrationAddress = 1;
let rejectAdmissionCandidate = false;
let useActualAdmissionConsumer = false;
let rejectUploadCandidate = false;
let useActualUploadConsumer = false;
const includeUploadPlatform =
  process.env.ADMINISTRATION_INCLUDE_PLATFORM === "1";
const uploadBlobDirectory = includeUploadPlatform
  ? await mkdtemp(join(tmpdir(), "orgmap-admin-upload-integration-"))
  : null;
const uploadBlobs = uploadBlobDirectory
  ? new FilesystemBlobStore(uploadBlobDirectory)
  : null;
const uploadRegistry = new ResourceRegistry();
uploadRegistry.registerResourceAdapter("admin-upload-probe", {
  async authorize(ctx, resourceId, action) {
    return (
      ctx.member.org_role === "OWNER" &&
      resourceId === ctx.org.id &&
      ["read", "attach"].includes(action)
    );
  },
});
let actualUploadService: ReturnType<typeof createIncomingUploadService> | null =
  null;
const admissionCandidateRevisions: number[] = [];
let administrationRuntime: ModuleRuntime;
const app = await buildApp([
  async (app, core) => {
    administrationRuntime = core;
    app.get(
      "/api/v1/organizations/:organizationId/admin-test-member-indicator-authority/:memberId/:action",
      (r) =>
        core.tenant(r, false, (ctx) =>
          createMemberIndicatorAuthority().authorize(ctx, {
            memberId: (r.params as any).memberId,
            action: (r.params as any).action,
          }),
        ),
    );
    if (uploadBlobs)
      actualUploadService = createIncomingUploadService({
        core,
        registry: uploadRegistry,
        blobs: uploadBlobs,
        policyProvider: { resolve: readUploadPolicy },
      });
    core.registerCredentialPolicyResolver(readCredentialPolicy);
    core.registerAdmissionPolicyProvider({
      resolve: readAdmissionPolicy,
    });
    core.registerGuestAccessAdapter(createAdministrationGuestAccessAdapter());
    app.get(
      "/api/v1/organizations/:organizationId/admin-test-policy/:key",
      (r) =>
        core.tenant(r, false, async (ctx) => ({
          policy: await effectivePolicy(
            ctx,
            (r.params as any).key,
            (r.query as any).overrideId,
          ),
        })),
    );
    app.get(
      "/api/v1/organizations/:organizationId/admin-test-supervision",
      (r) =>
        core.tenant(r, false, async (ctx) => ({
          readMeeting: await oversight(ctx, "readMeeting"),
          privateOperationalExport: await oversight(
            ctx,
            "privateOperationalExport",
          ),
        })),
    );
    app.get(
      "/api/v1/organizations/:organizationId/admin-resources/:type/:id/:action",
      (r) =>
        core.tenant(r, false, async (ctx) => {
          const params = r.params as {
            type: string;
            id: string;
            action: ResourceAction;
          };
          const adapter =
            params.type === "member"
              ? memberResourceAdapter()
              : publicPageResourceAdapter();
          if (!(await adapter.authorize(ctx, params.id, params.action)))
            fail(404, "RESOURCE_NOT_FOUND");
          return params.action === "export"
            ? adapter.export!(
                ctx,
                [params.id],
                String((r.query as any).kind ?? ""),
              )
            : { authorized: true };
        }),
    );
    core.registerOrganizationSettings(organizationSettings);
    core.registerModuleScope({
      module: "goals",
      routePrefixes: [
        "/api/v1/organizations/:organizationId/admin-module-probe",
      ],
      resourceTypes: ["administration-test-goal", "admin-upload-probe"],
    });
    app.post("/api/v1/organizations/:organizationId/admin-module-probe", (r) =>
      core.tenant(r, { mode: "write" }, async (ctx) => {
        const probeId = randomUUID();
        await core.changed(ctx, r, probeId, "AdministrationModuleProbe");
        return { probeId };
      }),
    );
    app.get(
      "/api/v1/organizations/:organizationId/admin-module-resource-probe",
      (r) =>
        core.tenant(r, false, async (ctx) => {
          await core.assertResourceAvailable(ctx, "administration-test-goal");
          return { available: true };
        }),
    );
    return createAdministration({
      uploadPolicyConsumer: {
        async validateChange(ctx, { previous, next }) {
          assert.equal(ctx.mode, "authorization_write");
          assert.deepEqual(
            await readUploadPolicy({ c: ctx.c, organizationId: ctx.org.id }),
            previous,
          );
          if (rejectUploadCandidate) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
          if (useActualUploadConsumer) {
            if (!actualUploadService)
              throw Error("ADMINISTRATION_INCLUDE_PLATFORM_REQUIRED");
            await actualUploadService.validateChange(ctx, { previous, next });
          }
        },
      },
      admissionPolicyConsumer: {
        async validateChange(ctx, { previous, next }) {
          assert.deepEqual(
            await readAdmissionPolicy({ c: ctx.c, organizationId: ctx.org.id }),
            previous,
          );
          if (rejectAdmissionCandidate)
            fail(503, "POLICY_CONSUMER_UNAVAILABLE");
          if (useActualAdmissionConsumer)
            return core.admissionPolicyConsumer.validateChange(ctx, {
              previous,
              next,
            });
          admissionCandidateRevisions.push(next.revision);
        },
      },
      credentialPolicyReadiness: (ctx, policy) =>
        core.credentialPolicyReadiness(ctx, policy),
    })(app, {
      ...core,
      changed: async (ctx, r, rid, action, structure) => {
        await core.changed(ctx, r, rid, action, structure);
        if (r.headers["x-administration-test-failure"] === "true")
          throw Error("Injected post-event failure");
      },
    });
  },
  async (app, core) => {
    app.get(
      "/api/v1/organizations/:organizationId/admin-resources/:type",
      (r) =>
        core.tenant(r, false, async (ctx) => {
          const adapter =
            (r.params as any).type === "member"
              ? memberResourceAdapter()
              : publicPageResourceAdapter();
          return { items: await adapter.search!(ctx, "", 100) };
        }),
    );
  },
  ...(uploadBlobs
    ? [
        (async (app, core) =>
          createPlatform({
            registry: uploadRegistry,
            blobs: uploadBlobs,
            uploads: actualUploadService!,
          })(app, core)) satisfies OrgMapModule,
      ]
    : []),
]);
if(process.env.ADMINISTRATION_DEBUG_ERRORS==="1")app.addHook("onError",async(_request,_reply,error)=>{process.stderr.write("ADMINISTRATION_TEST_ERROR "+error.message+"\n");});
after(async () => {
  await app.close();
  await pool.end();
  if (uploadBlobDirectory)
    await rm(uploadBlobDirectory, { recursive: true, force: true });
  if (process.env.ADMINISTRATION_EVIDENCE_FILE)
    await writeFile(
      process.env.ADMINISTRATION_EVIDENCE_FILE,
      JSON.stringify(
        { capturedAt: new Date().toISOString(), requests },
        null,
        2,
      ),
    );
});
const call = async (
  method: string,
  path: string,
  b?: any,
  u?: any,
  version?: number,
  extra: any = {},
) => {
  const response = await app.inject({
    ...(path === "/auth/register"
      ? { remoteAddress: "127.0.1." + syntheticRegistrationAddress++ }
      : {}),
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:5173",
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(version !== undefined ? { "if-match": `"${version}"` } : {}),
      ...extra,
    },
    payload: b,
  });
  const meta = response.json().meta;
  requests.push({
    method,
    path,
    status: response.statusCode,
    requestId: meta?.requestId ?? null,
    inputVersion: version ?? null,
    resourceVersion: meta?.resourceVersion ?? null,
    organizationId: meta?.organizationId ?? null,
  });
  return response;
};
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "a-secure-password-123",
    displayName: "Admin test",
  });
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return {
    id: r.json().data.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    email: r.json().data.account.email,
    csrf: r.json().data.csrfToken,
  };
}
const data = (r: any) => {
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return r.json().data;
};
test("Mare organization palette persists and only the owner may change it, including delegated managers", async () => {
  const owner=await user(), manager=await user(), outsider=await user();
  const org=data(await call('POST','/organizations',{name:'Palette A'},owner));
  const other=data(await call('POST','/organizations',{name:'Palette B'},outsider));
  const base='/organizations/'+org.organization.id+'/administration';
  const otherBase='/organizations/'+other.organization.id+'/administration';
  const membership=data(await call('POST','/organizations/'+org.organization.id+'/members',{accountId:manager.id,memberType:'MEMBER'},owner)).membership;
  data(await call('POST',base+'/grants',{memberId:membership.id,action:'settings.manage'},owner));
  const original=data(await call('GET',base+'/settings',undefined,owner));
  assert.equal(original.settings.branding.colorTheme,'mare');
  assert.equal(original.capabilities.manageTheme,true);
  original.settings.branding.colorTheme='cobalto';
  data(await call('PUT',base+'/settings',{settings:original.settings},owner,0));
  const delegated=data(await call('GET',base+'/settings',undefined,manager));
  assert.equal(delegated.capabilities.manage,true);
  assert.equal(delegated.capabilities.manageTheme,false);
  assert.equal(delegated.settings.branding.colorTheme,'cobalto');
  delegated.settings.branding.colorTheme='grafite';
  assert.equal((await call('PUT',base+'/settings',{settings:delegated.settings},manager,1)).statusCode,403);
  delete delegated.settings.branding.colorTheme;
  delegated.settings.name='Palette A revised';
  data(await call('PUT',base+'/settings',{settings:delegated.settings},manager,1));
  assert.equal(data(await call('GET',base+'/settings',undefined,owner)).settings.branding.colorTheme,'cobalto');
  original.settings.branding.colorTheme='invalid';
  assert.equal((await call('PUT',base+'/settings',{settings:original.settings},owner,2)).statusCode,422);
  assert.equal((await call('GET',base+'/settings',undefined,outsider)).statusCode,404);
  assert.equal(data(await call('GET',otherBase+'/settings',undefined,outsider)).settings.branding.colorTheme,'mare');
});
test("administration real PG: versions, schema, isolation, publication and RLS", async () => {
  const a = await user(),
    b = await user();
  const A = data(await call("POST", "/organizations", { name: "Aurora" }, a)),
    B = data(await call("POST", "/organizations", { name: "Horizonte" }, b));
  const p = "/organizations/" + A.organization.id + "/administration",
    q = "/organizations/" + B.organization.id + "/administration";
  assert.equal(
    (await call("GET", q + "/settings", undefined, a)).statusCode,
    404,
  );
  const s = data(await call("GET", p + "/settings", undefined, a));
  s.settings.vocabulary.role = "Responsabilidade";
  assert.equal(
    data(await call("PUT", p + "/settings", { settings: s.settings }, a, 0))
      .version,
    1,
  );
  assert.equal(
    (await call("PUT", p + "/settings", { settings: s.settings }, a, 0))
      .statusCode,
    409,
  );
  s.settings.oversight.readMeeting = true;
  assert.equal(
    (await call("PUT", p + "/settings", { settings: s.settings }, a, 1))
      .statusCode,
    422,
  );
  data(
    await call(
      "PUT",
      p + "/settings",
      { settings: s.settings, oversightAcknowledged: true },
      a,
      1,
    ),
  );
  const field = {
    key: "skills",
    label: "Competências",
    type: "text",
    required: false,
    locked: false,
    options: [],
    visibility: "organization",
  };
  const f = data(await call("POST", p + "/fields", { value: field }, a));
  const mid =
    A.membership?.id ??
    A.member?.id ??
    data(
      await call(
        "GET",
        "/organizations/" + A.organization.id + "/members",
        undefined,
        a,
      ),
    ).items?.[0]?.id;
  assert.ok(mid, JSON.stringify(A));
  const profile = data(
    await call(
      "POST",
      p + "/profiles",
      {
        value: {
          memberId: mid,
          managerId: null,
          visibility: "organization",
          values: { skills: "Escuta" },
        },
      },
      a,
    ),
  );
  const plan = data(
    await call(
      "POST",
      p + "/fields/" + f.id + "/plan",
      { value: { ...field, type: "number" } },
      a,
      1,
    ),
  );
  assert.equal(plan.canApply, false);
  assert.equal(plan.incompatible.length, 1);
  assert.equal(
    (
      await call(
        "PUT",
        p + "/fields/" + f.id,
        { value: { ...field, type: "number" } },
        a,
        1,
      )
    ).statusCode,
    422,
  );
  data(
    await call(
      "PUT",
      p + "/fields/" + f.id,
      { value: { ...field, locked: true } },
      a,
      1,
    ),
  );
  assert.equal(
    (
      await call(
        "PUT",
        p + "/profiles/" + profile.id,
        { value: { ...profile.value, values: { skills: "Troca" } } },
        a,
        1,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "PUT",
        p + "/profiles/" + profile.id,
        { value: { ...profile.value, managerId: mid } },
        a,
        1,
      )
    ).statusCode,
    422,
  );
  const unavailablePolicy = await call(
    "POST",
    p + "/policies",
    {
      value: {
        key: "governance.method",
        value: "MANUAL_FACILITATED",
        allowOverride: false,
        parentId: null,
      },
    },
    a,
  );
  assert.equal(unavailablePolicy.statusCode, 422);
  assert.equal(unavailablePolicy.json().error.code, "POLICY_UNSUPPORTED");
  const page = data(
    await call(
      "POST",
      p + "/pages",
      {
        value: {
          title: "Conheça Aurora",
          slug: "aurora",
          sections: [{ heading: "Propósito", text: "Cooperar", link: null }],
        },
      },
      a,
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/pages",
        { value: { ...page.value, privateData: "secret" } },
        a,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await call("PUT", q + "/pages/" + page.id, { value: page.value }, b, 1))
      .statusCode,
    404,
  );
  assert.equal(
    data(await call("POST", p + "/pages/" + page.id + "/preview", {}, a, 1))
      .public,
    false,
  );
  const published = data(
    await call(
      "POST",
      p + "/pages/" + page.id + "/publish",
      { approvedRevision: 1 },
      a,
      1,
    ),
  );
  let publicResult = await app.inject({ url: published.apiUrl });
  assert.equal(publicResult.statusCode, 200, publicResult.body);
  assert.equal(publicResult.json().data.title, "Conheça Aurora");
  data(
    await call(
      "PUT",
      p + "/pages/" + page.id,
      { value: { ...page.value, title: "Rascunho novo" } },
      a,
      2,
    ),
  );
  assert.equal(
    (await app.inject({ url: published.apiUrl })).json().data.title,
    "Conheça Aurora",
  );
  data(await call("POST", p + "/pages/" + page.id + "/unpublish", {}, a, 3));
  assert.equal((await app.inject({ url: published.apiUrl })).statusCode, 404);
  await transaction(async (c) => {
    assert.equal(
      (await c.query("SELECT * FROM administration_records")).rowCount,
      0,
    );
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      B.organization.id,
    ]);
    assert.equal(
      (
        await c.query("SELECT * FROM administration_records WHERE id=$1", [
          page.id,
        ])
      ).rowCount,
      0,
    );
  });
});

test("member grants revoke before replay; administration never reads another private profile", async () => {
  const owner = await user(),
    person = await user();
  const org = data(
    await call("POST", "/organizations", { name: "Permissões" }, owner),
  );
  const orgPath = "/organizations/" + org.organization.id,
    p = orgPath + "/administration";
  const invitation = data(
    await call(
      "POST",
      orgPath + "/invitations",
      { email: person.email },
      owner,
    ),
  );
  const dir = await mkdtemp(join(tmpdir(), "orgmap-admin-mail-"));
  let accepted: any;
  try {
    await deliverLocalInvitations(
      org.organization.id,
      dir,
      undefined,
      administrationRuntime.validateInvitationDelivery,
    );
    const mail = JSON.parse(
      await readFile(join(dir, invitation.deliveryJobId + ".json"), "utf8"),
    );
    accepted = data(
      await call("POST", "/invitations/accept", { token: mail.token }, person),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const mid = accepted.membership.id;
  assert.deepEqual(
    data(
      await call("GET", orgPath + "/admin-test-supervision", undefined, owner),
    ),
    { readMeeting: false, privateOperationalExport: false },
  );
  const supervision = data(
    await call("GET", p + "/settings", undefined, owner),
  );
  supervision.settings.oversight.readMeeting = true;
  data(
    await call(
      "PUT",
      p + "/settings",
      { settings: supervision.settings, oversightAcknowledged: true },
      owner,
      0,
    ),
  );
  assert.deepEqual(
    data(
      await call("GET", orgPath + "/admin-test-supervision", undefined, owner),
    ),
    { readMeeting: true, privateOperationalExport: false },
  );
  assert.deepEqual(
    data(
      await call("GET", orgPath + "/admin-test-supervision", undefined, person),
    ),
    { readMeeting: false, privateOperationalExport: false },
  );
  supervision.settings.oversight.privateOperationalExport = true;
  data(
    await call(
      "PUT",
      p + "/settings",
      { settings: supervision.settings, oversightAcknowledged: true },
      owner,
      1,
    ),
  );
  assert.deepEqual(
    data(
      await call("GET", orgPath + "/admin-test-supervision", undefined, owner),
    ),
    { readMeeting: true, privateOperationalExport: true },
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/pages",
        { value: { title: "Tentativa", slug: "tentativa", sections: [] } },
        person,
      )
    ).statusCode,
    403,
  );
  const privateField = data(
    await call(
      "POST",
      p + "/fields",
      {
        value: {
          key: "secret",
          label: "Privado",
          type: "text",
          required: false,
          locked: false,
          options: [],
          visibility: "private",
        },
      },
      owner,
    ),
  );
  const privateProfile = data(
    await call(
      "POST",
      p + "/profiles",
      {
        value: {
          memberId: mid,
          managerId: null,
          visibility: "private",
          values: { secret: "Somente minha pessoa" },
        },
      },
      person,
    ),
  );
  assert.equal(
    data(await call("GET", p + "/profiles", undefined, owner)).items.length,
    0,
  );
  const directory = data(
    await call("GET", orgPath + "/admin-resources/member", undefined, owner),
  );
  assert.equal(directory.items.length, 2);
  assert.ok(!JSON.stringify(directory).includes("Somente minha pessoa"));
  assert.equal(
    (
      await call(
        "GET",
        p + "/profiles/" + privateProfile.id + "/history",
        undefined,
        owner,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PUT",
        p + "/profiles/" + privateProfile.id,
        { value: privateProfile.value },
        owner,
        1,
      )
    ).statusCode,
    404,
  );
  data(
    await call(
      "PUT",
      p + "/profiles/" + privateProfile.id,
      { value: { ...privateProfile.value, visibility: "organization" } },
      person,
      1,
    ),
  );
  assert.deepEqual(
    data(await call("GET", p + "/profiles", undefined, owner)).items[0].value
      .values,
    {},
  );
  assert.equal(
    data(await call("GET", p + "/profiles", undefined, person)).items[0].value
      .values.secret,
    "Somente minha pessoa",
  );
  const visible = data(await call("GET", p + "/profiles", undefined, owner))
    .items[0];
  assert.equal(visible.capabilities.update, true);
  assert.equal(visible.capabilities.history, false);
  const edited = data(
    await call(
      "PUT",
      p + "/profiles/" + visible.id,
      { value: visible.value },
      owner,
      2,
    ),
  );
  assert.deepEqual(edited.value.values, {});
  assert.ok(!JSON.stringify(edited).includes("Somente minha pessoa"));
  const preserved = data(await call("GET", p + "/profiles", undefined, person))
    .items[0];
  assert.equal(preserved.value.values.secret, "Somente minha pessoa");
  assert.equal(preserved.capabilities.update, true);
  assert.equal(preserved.capabilities.history, true);
  for (const attempted of [null, "Sobrescrita"])
    assert.equal(
      (
        await call(
          "PUT",
          p + "/profiles/" + visible.id,
          { value: { ...visible.value, values: { secret: attempted } } },
          owner,
          3,
        )
      ).statusCode,
      403,
    );
  const fieldReadOnly = data(
    await call("GET", p + "/fields", undefined, person),
  ).items.find((f: any) => f.id === privateField.id);
  assert.equal(fieldReadOnly.capabilities.update, false);
  const privatePlan = data(
    await call(
      "POST",
      p + "/fields/" + privateField.id + "/plan",
      { value: { ...privateField.value, type: "number" } },
      owner,
      1,
    ),
  );
  assert.deepEqual(privatePlan.incompatible, ["RESTRICTED_PROFILE"]);
  assert.ok(!JSON.stringify(privatePlan).includes(privateProfile.id));
  assert.equal(
    (
      await call(
        "PUT",
        p + "/fields/" + privateField.id,
        {
          value: {
            key: "secret",
            label: "Privado",
            type: "text",
            required: false,
            locked: false,
            options: [],
            visibility: "organization",
          },
        },
        owner,
        1,
      )
    ).statusCode,
    403,
  );
  const grant = data(
    await call(
      "POST",
      p + "/grants",
      { memberId: mid, action: "page.manage", resourceId: null },
      owner,
    ),
  );
  const key = randomUUID();
  const command = {
    value: {
      title: "Página autorizada",
      slug: "autorizada",
      sections: [
        {
          heading: "<script>alert(1)</script>",
          text: "Texto <b>literal</b>",
          link: "https://example.test",
        },
      ],
    },
  };
  const page = data(
    await call("POST", p + "/pages", command, person, undefined, {
      "idempotency-key": key,
    }),
  );
  assert.equal(
    data(
      await call("POST", p + "/pages", command, person, undefined, {
        "idempotency-key": key,
      }),
    ).id,
    page.id,
  );
  assert.equal(
    data(
      await call(
        "GET",
        orgPath + "/admin-resources/public-page",
        undefined,
        person,
      ),
    ).items.length,
    1,
  );
  const result = await Promise.all([
    call(
      "PUT",
      p + "/pages/" + page.id,
      { value: { ...page.value, title: "A" } },
      person,
      1,
    ),
    call(
      "PUT",
      p + "/pages/" + page.id,
      { value: { ...page.value, title: "B" } },
      person,
      1,
    ),
  ]);
  assert.deepEqual(result.map((r) => r.statusCode).sort(), [200, 409]);
  const pub = data(
    await call(
      "POST",
      p + "/pages/" + page.id + "/publish",
      { approvedRevision: 2 },
      person,
      2,
    ),
  );
  const html = await app.inject({ url: pub.url });
  assert.equal(html.statusCode, 200);
  assert.ok(html.body.includes("&lt;script&gt;"));
  assert.ok(!html.body.includes("<script>"));
  assert.equal(html.headers["cache-control"], "no-store");
  data(await call("POST", p + "/grants/" + grant.id + "/revoke", {}, owner, 1));
  const pagePort = orgPath + "/admin-resources/public-page/" + page.id;
  data(await call("GET", pagePort + "/read", undefined, person));
  for (const action of ["comment", "attach", "follow", "import"])
    assert.equal(
      (await call("GET", pagePort + "/" + action, undefined, person))
        .statusCode,
      404,
    );
  assert.equal(
    (await call("GET", pagePort + "/export", undefined, person)).statusCode,
    422,
  );
  const approved = data(
    await call("GET", pagePort + "/export?kind=PAGES", undefined, person),
  );
  assert.deepEqual(approved.records[0].value, pub.page.value);
  data(
    await call(
      "PUT",
      p + "/pages/" + page.id,
      {
        value: { ...pub.page.value, title: "Rascunho confidencial posterior" },
      },
      owner,
      3,
    ),
  );
  const snapshotOnly = data(
    await call("GET", pagePort + "/export?kind=PAGES", undefined, person),
  );
  assert.deepEqual(snapshotOnly.records[0].value, pub.page.value);
  assert.ok(
    !JSON.stringify(snapshotOnly).includes("Rascunho confidencial posterior"),
  );
  const publicSearch = data(
    await call(
      "GET",
      orgPath + "/admin-resources/public-page",
      undefined,
      person,
    ),
  );
  assert.ok(
    !JSON.stringify(publicSearch).includes("Rascunho confidencial posterior"),
  );
  const memberExport = data(
    await call(
      "GET",
      orgPath + "/admin-resources/member/" + mid + "/export?kind=MEMBERS",
      undefined,
      owner,
    ),
  );
  assert.equal(memberExport.records[0].id, mid);
  assert.ok(!JSON.stringify(memberExport).includes("Somente minha pessoa"));
  assert.ok(!JSON.stringify(memberExport).includes(person.email));
  assert.equal(
    (
      await call("POST", p + "/pages", command, person, undefined, {
        "idempotency-key": key,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("POST", p + "/pages/" + page.id + "/unpublish", {}, person, 3))
      .statusCode,
    403,
  );
  const scoped = data(
    await call(
      "POST",
      p + "/grants",
      { memberId: mid, action: "page.manage", resourceId: page.id },
      owner,
    ),
  );
  data(
    await call("POST", p + "/pages/" + page.id + "/unpublish", {}, person, 4),
  );
  const revoked = await app.inject({ url: pub.url });
  assert.equal(revoked.statusCode, 404);
  assert.equal(revoked.headers["cache-control"], "no-store");
  assert.ok(revoked.body.includes("Página indisponível"));
  assert.equal(
    (await call("POST", p + "/pages", command, person)).statusCode,
    403,
  );
  data(
    await call("POST", p + "/grants/" + scoped.id + "/revoke", {}, owner, 1),
  );
  assert.equal(
    (await call("GET", pagePort + "/export?kind=PAGES", undefined, person))
      .statusCode,
    404,
  );
  assert.equal(
    data(
      await call(
        "GET",
        orgPath + "/admin-resources/public-page",
        undefined,
        person,
      ),
    ).items.length,
    0,
  );
  assert.ok(privateField.id && scoped.id);
});

test("schema plans preserve values, detect stale coverage and require review; legal/onboarding/display persisted", async () => {
  const a = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Schema Aurora" }, a),
  );
  const orgPath = "/organizations/" + A.organization.id,
    p = orgPath + "/administration";
  const mid = data(await call("GET", orgPath + "/members", undefined, a))
    .items[0].id;
  const field = {
    key: "optional",
    label: "Opcional",
    type: "number",
    required: false,
    locked: false,
    options: [],
    visibility: "organization",
  };
  const f = data(await call("POST", p + "/fields", { value: field }, a));
  assert.equal(
    (
      await call(
        "POST",
        p + "/profiles",
        {
          value: {
            memberId: mid,
            managerId: null,
            visibility: "organization",
            values: { optional: "12" },
          },
        },
        a,
      )
    ).statusCode,
    422,
  );
  const changed = { ...field, type: "text" };
  assert.equal(
    (await call("PUT", p + "/fields/" + f.id, { value: changed }, a, 1))
      .statusCode,
    409,
  );
  const plan = data(
    await call(
      "POST",
      p + "/fields/" + f.id + "/plan",
      { value: changed },
      a,
      1,
    ),
  );
  assert.equal(plan.canApply, true);
  const profile = data(
    await call(
      "POST",
      p + "/profiles",
      {
        value: {
          memberId: mid,
          managerId: null,
          visibility: "organization",
          values: {},
        },
      },
      a,
    ),
  );
  assert.equal(
    (
      await call(
        "PUT",
        p + "/fields/" + f.id,
        { value: changed, planId: plan.planId },
        a,
        1,
      )
    ).statusCode,
    409,
  );
  const current = data(
    await call(
      "POST",
      p + "/fields/" + f.id + "/plan",
      { value: changed },
      a,
      1,
    ),
  );
  data(
    await call(
      "PUT",
      p + "/fields/" + f.id,
      { value: changed, planId: current.planId },
      a,
      1,
    ),
  );
  assert.deepEqual(
    data(await call("GET", p + "/profiles", undefined, a)).items[0].value
      .values,
    {},
  );
  const s = data(await call("GET", p + "/settings", undefined, a));
  s.settings.onboarding = {
    enabled: true,
    title: "Bem-vindas",
    body: "Aprendemos juntos",
  };
  s.settings.legal.name = "Aurora Cooperativa";
  s.settings.display.directoryFields = ["optional"];
  data(await call("PUT", p + "/settings", { settings: s.settings }, a, 0));
  assert.equal(
    data(await call("GET", p + "/settings", undefined, a)).settings.onboarding
      .body,
    "Aprendemos juntos",
  );
  s.settings.display.directoryFields = ["a", "b", "c"];
  assert.equal(
    (await call("PUT", p + "/settings", { settings: s.settings }, a, 1))
      .statusCode,
    400,
  );
  assert.ok(profile.id);
});

test("group hierarchy, composite foreign keys, rollback after events and idempotent recovery", async () => {
  const a = await user(),
    b = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Atomic Aurora" }, a),
    ),
    B = data(
      await call("POST", "/organizations", { name: "Atomic Horizonte" }, b),
    );
  const p = "/organizations/" + A.organization.id + "/administration";
  const ma = data(
    await call(
      "GET",
      "/organizations/" + A.organization.id + "/members",
      undefined,
      a,
    ),
  ).items[0].id;
  const mb = data(
    await call(
      "GET",
      "/organizations/" + B.organization.id + "/members",
      undefined,
      b,
    ),
  ).items[0].id;
  const group = data(
    await call(
      "POST",
      p + "/groups",
      { value: { name: "Pesquisa", parentId: null, memberIds: [ma] } },
      a,
    ),
  );
  const child = data(
    await call(
      "POST",
      p + "/groups",
      { value: { name: "Núcleo", parentId: group.id, memberIds: [] } },
      a,
    ),
  );
  assert.equal(
    (
      await call(
        "PUT",
        p + "/groups/" + group.id,
        { value: { ...group.value, parentId: child.id } },
        a,
        1,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/groups",
        { value: { name: "IDOR", parentId: null, memberIds: [mb] } },
        a,
      )
    ).statusCode,
    404,
  );
  await assert.rejects(
    transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        B.organization.id,
      ]);
      const rid = randomUUID();
      await c.query(
        "INSERT INTO administration_records VALUES($1,$2,'profile',1,$3)",
        [
          B.organization.id,
          rid,
          { memberId: ma, managerId: null, visibility: "private", values: {} },
        ],
      );
      await c.query(
        "INSERT INTO administration_profile_relations VALUES($1,$2,$3,NULL)",
        [B.organization.id, rid, ma],
      );
    }),
    (e: any) => e.code === "23503",
  );
  const command = {
      value: { title: "Atomic page", slug: "atomic-page", sections: [] },
    },
    key = randomUUID();
  const failed = await call("POST", p + "/pages", command, a, undefined, {
    "idempotency-key": key,
    "x-administration-test-failure": "true",
  });
  assert.equal(failed.statusCode, 500);
  assert.ok(!failed.body.includes("Injected"));
  assert.equal(
    data(await call("GET", p + "/pages", undefined, a)).items.length,
    0,
  );
  const page = data(
    await call("POST", p + "/pages", command, a, undefined, {
      "idempotency-key": key,
    }),
  );
  assert.equal(
    data(
      await call("POST", p + "/pages", command, a, undefined, {
        "idempotency-key": key,
      }),
    ).id,
    page.id,
  );
  assert.equal(
    data(await call("GET", p + "/pages", undefined, a)).items.length,
    1,
  );
});

test("profile and field visibility revocation are rechecked before an owner's creation replay", async () => {
  const owner = await user(),
    person = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Privacy replay" }, owner),
  );
  const base = "/organizations/" + A.organization.id,
    p = base + "/administration";
  const invitation = data(
    await call("POST", base + "/invitations", { email: person.email }, owner),
  );
  const dir = await mkdtemp(join(tmpdir(), "orgmap-admin-replay-"));
  let mid: string;
  try {
    await deliverLocalInvitations(
      A.organization.id,
      dir,
      undefined,
      administrationRuntime.validateInvitationDelivery,
    );
    const mail = JSON.parse(
      await readFile(join(dir, invitation.deliveryJobId + ".json"), "utf8"),
    );
    mid = data(
      await call("POST", "/invitations/accept", { token: mail.token }, person),
    ).membership.id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const definition = {
    key: "shared_before",
    label: "Campo inicialmente organizacional",
    type: "text",
    required: false,
    locked: false,
    options: [],
    visibility: "organization",
  };
  const field = data(
    await call("POST", p + "/fields", { value: definition }, owner),
  );
  const command = {
      value: {
        memberId: mid!,
        managerId: null,
        visibility: "organization",
        values: { shared_before: "Valor antes visível" },
      },
    },
    key = randomUUID();
  const profile = data(
    await call("POST", p + "/profiles", command, owner, undefined, {
      "idempotency-key": key,
    }),
  );
  data(
    await call(
      "PUT",
      p + "/fields/" + field.id,
      { value: { ...definition, visibility: "private" } },
      owner,
      1,
    ),
  );
  assert.equal(
    (
      await call("POST", p + "/profiles", command, owner, undefined, {
        "idempotency-key": key,
      })
    ).statusCode,
    403,
  );
  assert.deepEqual(
    data(await call("GET", p + "/profiles", undefined, owner)).items[0].value
      .values,
    {},
  );
  assert.equal(
    data(await call("GET", p + "/profiles", undefined, person)).items[0].value
      .values.shared_before,
    "Valor antes visível",
  );
  data(
    await call(
      "PUT",
      p + "/profiles/" + profile.id,
      { value: { ...profile.value, visibility: "private" } },
      person,
      1,
    ),
  );
  assert.equal(
    (
      await call("POST", p + "/profiles", command, owner, undefined, {
        "idempotency-key": key,
      })
    ).statusCode,
    404,
  );
});

test("settings fallback inherits organization locale/timezone, then respects explicit revisions per tenant", async () => {
  const a = await user();
  const A = data(
      await call(
        "POST",
        "/organizations",
        { name: "London Aurora", locale: "en-GB", timeZone: "Europe/London" },
        a,
      ),
    ),
    B = data(
      await call(
        "POST",
        "/organizations",
        { name: "Tokyo Horizonte", locale: "ja-JP", timeZone: "Asia/Tokyo" },
        a,
      ),
    );
  const p = "/organizations/" + A.organization.id,
    q = "/organizations/" + B.organization.id;
  const first = data(
    await call("GET", p + "/administration/settings", undefined, a),
  );
  assert.equal(first.version, 0);
  assert.equal(first.settings.locale, "en-GB");
  assert.equal(first.settings.timezone, "Europe/London");
  const boot = data(await call("GET", p + "/bootstrap", undefined, a));
  assert.equal(boot.organization.locale, "en-GB");
  assert.equal(boot.organization.timeZone, "Europe/London");
  let second = data(
    await call("GET", q + "/administration/settings", undefined, a),
  );
  assert.equal(second.settings.locale, "ja-JP");
  assert.equal(second.settings.timezone, "Asia/Tokyo");
  first.settings.name = "London renamed";
  data(
    await call(
      "PUT",
      p + "/administration/settings",
      { settings: first.settings },
      a,
      0,
    ),
  );
  const preserved = data(await call("GET", p + "/bootstrap", undefined, a));
  assert.equal(preserved.organization.locale, "en-GB");
  assert.equal(preserved.organization.timeZone, "Europe/London");
  first.settings.locale = "fr-FR";
  first.settings.timezone = "Europe/Paris";
  data(
    await call(
      "PUT",
      p + "/administration/settings",
      { settings: first.settings },
      a,
      1,
    ),
  );
  const changed = data(await call("GET", p + "/bootstrap", undefined, a));
  assert.equal(changed.organization.locale, "fr-FR");
  assert.equal(changed.organization.timeZone, "Europe/Paris");
  second = data(
    await call("GET", q + "/administration/settings", undefined, a),
  );
  assert.equal(second.version, 0);
  assert.equal(second.settings.locale, "ja-JP");
  assert.equal(second.settings.timezone, "Asia/Tokyo");
});

test("real administration settings drive foundation availability before replay and leave recovery reachable", async () => {
  const a = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Availability Aurora" }, a),
  );
  const base = "/organizations/" + A.organization.id,
    p = base + "/administration",
    key = randomUUID();
  const enabled = data(await call("GET", p + "/settings", undefined, a));
  enabled.settings.modules.goals = true;
  data(await call("PUT", p + "/settings", { settings: enabled.settings }, a, enabled.version));
  const original = data(
    await call("POST", base + "/admin-module-probe", {}, a, undefined, {
      "idempotency-key": key,
    }),
  );
  const s = data(await call("GET", p + "/settings", undefined, a));
  s.settings.modules.goals = false;
  data(await call("PUT", p + "/settings", { settings: s.settings }, a, s.version));
  const replay = await call(
    "POST",
    base + "/admin-module-probe",
    {},
    a,
    undefined,
    { "idempotency-key": key },
  );
  assert.equal(replay.statusCode, 403);
  assert.equal(replay.json().error.code, "MODULE_DISABLED");
  const resource = await call(
    "GET",
    base + "/admin-module-resource-probe",
    undefined,
    a,
  );
  assert.equal(resource.statusCode, 403);
  assert.equal(resource.json().error.code, "MODULE_DISABLED");
  const recovery = data(await call("GET", p + "/settings", undefined, a));
  assert.equal(recovery.settings.modules.goals, false);
  recovery.settings.modules.goals = true;
  data(
    await call("PUT", p + "/settings", { settings: recovery.settings }, a, recovery.version),
  );
  assert.deepEqual(
    data(
      await call("POST", base + "/admin-module-probe", {}, a, undefined, {
        "idempotency-key": key,
      }),
    ),
    original,
  );
  assert.equal(
    data(await call("GET", base + "/admin-module-resource-probe", undefined, a))
      .available,
    true,
  );
});

test("typed profile fields preserve zero/false/list types and reject empty required lists or invalid dates", async () => {
  const a = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Typed Aurora" }, a),
  );
  const base = "/organizations/" + A.organization.id,
    p = base + "/administration";
  const mid = data(await call("GET", base + "/members", undefined, a)).items[0]
    .id;
  for (const type of ["text", "number", "boolean", "date", "select", "multi"])
    data(
      await call(
        "POST",
        p + "/fields",
        {
          value: {
            key: "typed_" + type,
            label: type,
            type,
            required: true,
            locked: false,
            options: ["select", "multi"].includes(type) ? ["A", "B"] : [],
            visibility: "organization",
          },
        },
        a,
      ),
    );
  const values = {
    typed_text: "Olá",
    typed_number: 0,
    typed_boolean: false,
    typed_date: "2026-02-28",
    typed_select: "A",
    typed_multi: ["A", "B"],
  };
  const profile = data(
    await call(
      "POST",
      p + "/profiles",
      {
        value: {
          memberId: mid,
          managerId: null,
          visibility: "organization",
          values,
        },
      },
      a,
    ),
  );
  assert.deepEqual(profile.value.values, values);
  for (const [key, value] of [
    ["typed_text", "   "],
    ["typed_number", "0"],
    ["typed_boolean", "false"],
    ["typed_date", "2026-02-30"],
    ["typed_select", "C"],
    ["typed_multi", []],
    ["typed_multi", ["A", "A"]],
  ])
    assert.equal(
      (
        await call(
          "PUT",
          p + "/profiles/" + profile.id,
          {
            value: {
              ...profile.value,
              values: { ...values, [key as string]: value },
            },
          },
          a,
          1,
        )
      ).statusCode,
      422,
    );
  const saved = data(await call("GET", p + "/profiles", undefined, a)).items[0];
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.value.values, values);
});

test("policies without consumers reject mutations without creating records", async () => {
  const a = await user();
  const A = data(await call("POST", "/organizations", { name: "Policies" }, a));
  const p = "/organizations/" + A.organization.id + "/administration";
  for (const [key, value] of [
    ["governance.method", "MANUAL_FACILITATED"],
    ["structure.collectiveManagement", false],
    ["organization.allowGuests", true],
    ["member.profileVisibility", "organization"],
    ["security.minimumPasswordLength", 12],
  ]) {
    const result = await call(
      "POST",
      p + "/policies",
      { value: { key, value, allowOverride: false, parentId: null } },
      a,
    );
    assert.equal(result.statusCode, 422);
    assert.equal(result.json().error.code, "POLICY_UNSUPPORTED");
  }
  assert.equal(
    data(await call("GET", p + "/policies", undefined, a)).items.length,
    0,
  );
});

test("profile templates persist field identity, reject foreign references and preserve versioned history", async () => {
  const a = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Template Aurora" }, a),
    ),
    B = data(
      await call("POST", "/organizations", { name: "Template Horizonte" }, a),
    );
  const p = "/organizations/" + A.organization.id + "/administration",
    q = "/organizations/" + B.organization.id + "/administration";
  const definition = {
    key: "bio",
    label: "Apresentação",
    type: "text",
    required: false,
    locked: false,
    options: [],
    visibility: "organization",
  };
  const field = data(
      await call("POST", p + "/fields", { value: definition }, a),
    ),
    foreign = data(await call("POST", q + "/fields", { value: definition }, a));
  const template = data(
    await call(
      "POST",
      p + "/templates",
      { value: { name: "Perfil colaborativo", fields: [field.id] } },
      a,
    ),
  );
  const loaded = data(
    await call("GET", p + "/templates", undefined, a),
  ).items.find((r: any) => r.id === template.id);
  assert.deepEqual(loaded.value.fields, [field.id]);
  assert.equal(loaded.capabilities.update, true);
  const changed = data(
    await call(
      "PUT",
      p + "/templates/" + template.id,
      { value: { ...template.value, name: "Perfil da equipe" } },
      a,
      1,
    ),
  );
  assert.equal(changed.version, 2);
  assert.deepEqual(changed.value.fields, [field.id]);
  assert.equal(
    (
      await call(
        "PUT",
        p + "/templates/" + template.id,
        { value: template.value },
        a,
        1,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/templates",
        { value: { name: "Referência de outra org", fields: [foreign.id] } },
        a,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/templates",
        { value: { name: "Duplicação", fields: [field.id, field.id] } },
        a,
      )
    ).statusCode,
    422,
  );
  const history = data(
    await call(
      "GET",
      p + "/templates/" + template.id + "/history",
      undefined,
      a,
    ),
  ).items;
  assert.deepEqual(
    history.map((r: any) => r.value.name),
    ["Perfil da equipe", "Perfil colaborativo"],
  );
});

test("rich administration content roundtrips through PostgreSQL, safe publication and revocation", async () => {
  const a = await user();
  const A = data(await call("POST", "/organizations", { name: "Conteúdo" }, a));
  const p = "/organizations/" + A.organization.id + "/administration";
  const rich = {
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Olá 🌱 <script>",
              marks: [{ type: "bold" }, { type: "italic" }],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Conheça",
                      marks: [
                        {
                          type: "link",
                          attrs: { href: "https://example.org/about" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const originalSettings = data(
    await call("GET", p + "/settings", undefined, a),
  );
  const saved = data(
    await call(
      "PUT",
      p + "/settings",
      {
        settings: {
          ...originalSettings.settings,
          onboarding: { enabled: true, title: "Bem-vinda", body: rich },
        },
      },
      a,
      originalSettings.version,
    ),
  );
  assert.deepEqual(saved.settings.onboarding.body, rich);
  assert.deepEqual(
    data(await call("GET", p + "/settings", undefined, a)).settings.onboarding
      .body,
    rich,
  );
  const page = data(
    await call(
      "POST",
      p + "/pages",
      {
        value: {
          title: "Pessoas",
          slug: "pessoas",
          sections: [{ heading: "Sobre", text: rich, link: null }],
        },
      },
      a,
    ),
  );
  assert.deepEqual(page.value.sections[0].text, rich);
  const preview = data(
    await call("POST", p + "/pages/" + page.id + "/preview", {}, a, 1),
  );
  assert.deepEqual(preview.snapshot.sections[0].text, rich);
  const published = data(
    await call(
      "POST",
      p + "/pages/" + page.id + "/publish",
      { approvedRevision: 1 },
      a,
      1,
    ),
  );
  const html = await app.inject({ url: published.url });
  assert.equal(html.statusCode, 200);
  assert.match(html.body, /<strong>/);
  assert.match(html.body, /<ul>/);
  assert.match(html.body, /https:\/\/example.org\/about/);
  assert.match(html.body, /&lt;script&gt;/);
  assert.doesNotMatch(html.body, /<script>/);
  assert.deepEqual(
    (await app.inject({ url: published.apiUrl })).json().data.sections[0].text,
    rich,
  );
  const unsafe = structuredClone(rich);
  (
    unsafe.doc.content[1] as any
  ).content[0].content[0].content[0].marks[0].attrs.href =
    "javascript:alert(1)";
  assert.equal(
    (
      await call(
        "PUT",
        p + "/pages/" + page.id,
        {
          value: {
            ...page.value,
            sections: [{ heading: "Sobre", text: unsafe, link: null }],
          },
        },
        a,
        2,
      )
    ).statusCode,
    422,
  );
  const unknown = structuredClone(rich);
  (unknown.doc.content[0] as any).attrs = { style: "color:red" };
  assert.equal(
    (
      await call(
        "POST",
        p + "/pages",
        {
          value: {
            title: "Inválida",
            slug: "invalid",
            sections: [{ heading: "Sobre", text: unknown, link: null }],
          },
        },
        a,
      )
    ).statusCode,
    422,
  );
  assert.deepEqual(
    (await app.inject({ url: published.apiUrl })).json().data.sections[0].text,
    rich,
  );
  data(await call("POST", p + "/pages/" + page.id + "/unpublish", {}, a, 2));
  assert.equal((await app.inject({ url: published.url })).statusCode, 404);
});

test("entry projection is minimal, versioned and acknowledgement survives relogin without crossing organizations", async () => {
  const a = await user(),
    outsider = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Entrada Aurora" }, a),
  );
  const B = data(
    await call("POST", "/organizations", { name: "Entrada Horizonte" }, a),
  );
  const org = "/organizations/" + A.organization.id;
  const other = "/organizations/" + B.organization.id;
  const initial = data(await call("GET", org + "/entry", undefined, a));
  assert.equal(initial.welcome.mode, "DEFAULT");
  assert.equal(initial.acknowledged, false);
  assert.equal(initial.destination, "HOME");
  assert.deepEqual(Object.keys(initial).sort(), [
    "acknowledged",
    "destination",
    "legal",
    "revision",
    "welcome",
  ]);
  const original = data(
    await call("GET", org + "/administration/settings", undefined, a),
  );
  const configured = {
    ...original.settings,
    branding: { ...original.settings.branding, showOrganizationName: false },
    onboarding: {
      ...original.settings.onboarding,
      enabled: true,
      title: "Mensagem exclusiva A",
      body: "Olá A",
      audience: "GUEST",
      destination: "GOALS",
      videoUrl: "https://example.org/welcome.mp4",
      attachmentUrl: "https://example.org/guide.pdf",
    },
    legal: {
      ...original.settings.legal,
      contactName: "Equipe de privacidade",
      contactEmail: "privacy@example.org",
      contactPhone: "+55 11 0000-0000",
    },
  };
  data(
    await call(
      "PUT",
      org + "/administration/settings",
      { settings: configured },
      a,
      0,
    ),
  );
  assert.equal(
    data(await call("GET", org + "/entry", undefined, a)).welcome.mode,
    "DEFAULT",
  );
  configured.onboarding.audience = "MEMBER";
  configured.modules.goals = false;
  data(
    await call(
      "PUT",
      org + "/administration/settings",
      { settings: configured },
      a,
      1,
    ),
  );
  const entry = data(await call("GET", org + "/entry", undefined, a));
  assert.equal(entry.welcome.title, "Mensagem exclusiva A");
  assert.equal(entry.welcome.videoMode, "CUSTOM");
  assert.equal(entry.destination, "HOME");
  assert.equal(entry.legal.contactEmail, "privacy@example.org");
  assert.equal(
    data(await call("GET", org + "/administration/settings", undefined, a))
      .settings.branding.showOrganizationName,
    false,
  );
  assert.equal(
    data(await call("GET", other + "/administration/settings", undefined, a))
      .settings.branding.showOrganizationName,
    true,
  );
  assert.equal(
    (await call("POST", org + "/entry/acknowledge", {}, a, 1)).statusCode,
    409,
  );
  assert.equal(
    data(await call("GET", org + "/entry", undefined, a)).acknowledged,
    false,
  );
  data(await call("POST", org + "/entry/acknowledge", {}, a, 2));
  assert.equal(
    data(await call("GET", other + "/entry", undefined, a)).acknowledged,
    false,
  );
  assert.equal(
    data(await call("GET", other + "/entry", undefined, a)).welcome.mode,
    "DEFAULT",
  );
  const login = await call("POST", "/auth/login", {
    email: a.email,
    password: "a-secure-password-123",
  });
  assert.equal(login.statusCode, 200, login.body);
  const again = {
    cookie: login.cookies[0].name + "=" + login.cookies[0].value,
    csrf: login.json().data.csrfToken,
  };
  assert.equal(
    data(await call("GET", org + "/entry", undefined, again)).acknowledged,
    true,
  );
  assert.equal(
    (await call("GET", org + "/entry", undefined, outsider)).statusCode,
    404,
  );
  for (const onboarding of [
    {
      ...configured.onboarding,
      videoUrl: "https://example.org/not-a-video.pdf",
    },
    { ...configured.onboarding, attachmentUrl: "javascript:alert(1)" },
    { ...configured.onboarding, destination: "https://evil.example" },
  ])
    assert.equal(
      (
        await call(
          "PUT",
          org + "/administration/settings",
          { settings: { ...configured, onboarding } },
          a,
          2,
        )
      ).statusCode,
      onboarding.destination === "https://evil.example" ? 400 : 422,
    );
});

test("Guest entry requires explicit grants, filters member-only welcome and revokes before replay", async () => {
  const owner = await user(),
    guest = await user(),
    denied = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Guest entry A" }, owner),
  );
  const B = data(
    await call("POST", "/organizations", { name: "Guest owner B" }, guest),
  );
  const base = "/organizations/" + A.organization.id;
  const settings = data(
    await call("GET", base + "/administration/settings", undefined, owner),
  ).settings;
  settings.onboarding = {
    ...settings.onboarding,
    enabled: true,
    audience: "MEMBER",
    title: "MEMBER ONLY TITLE",
    body: "MEMBER ONLY BODY",
    videoUrl: "https://example.org/member-secret.mp4",
    attachmentUrl: "https://example.org/member-secret.pdf",
  };
  data(
    await call(
      "PUT",
      base + "/administration/settings",
      { settings },
      owner,
      0,
    ),
  );
  const plan = [
    {
      resource: {
        context: "administration",
        kind: "entry",
        id: A.organization.id,
      },
      actions: ["read", "acknowledge"],
    },
  ];
  const membership = data(
    await call(
      "POST",
      base + "/members",
      { accountId: guest.id, memberType: "GUEST", accessPlan: plan },
      owner,
    ),
  ).membership;
  data(
    await call(
      "POST",
      base + "/members",
      { accountId: denied.id, memberType: "GUEST", accessPlan: [] },
      owner,
    ),
  );
  assert.equal(
    (await call("GET", base + "/entry", undefined, denied)).statusCode,
    404,
  );
  const entry = data(await call("GET", base + "/entry", undefined, guest));
  assert.equal(entry.destination, "SHARED");
  assert.equal(entry.welcome.mode, "DEFAULT");
  assert.doesNotMatch(JSON.stringify(entry), /MEMBER ONLY|member-secret/);
  assert.equal(
    (await call("GET", base + "/administration/settings", undefined, guest))
      .statusCode,
    404,
  );
  assert.equal(
    data(
      await call(
        "GET",
        "/organizations/" + B.organization.id + "/entry",
        undefined,
        guest,
      ),
    ).destination,
    "HOME",
  );
  const replayKey = randomUUID();
  data(
    await call("POST", base + "/entry/acknowledge", {}, guest, 1, {
      "idempotency-key": replayKey,
    }),
  );
  assert.equal(
    data(await call("GET", base + "/entry", undefined, guest)).acknowledged,
    true,
  );
  settings.onboarding.audience = "GUEST";
  data(
    await call(
      "PUT",
      base + "/administration/settings",
      { settings },
      owner,
      1,
    ),
  );
  assert.equal(
    data(await call("GET", base + "/entry", undefined, guest)).welcome.mode,
    "CUSTOM",
  );
  const grants = data(
    await call(
      "GET",
      base + "/members/" + membership.id + "/access-grants",
      undefined,
      owner,
    ),
  );
  data(
    await call(
      "POST",
      base +
        "/members/" +
        membership.id +
        "/access-grants/" +
        grants.items[0].id +
        "/revoke",
      {},
      owner,
      1,
    ),
  );
  assert.equal(
    (await call("GET", base + "/entry", undefined, guest)).statusCode,
    404,
  );
  assert.equal(
    (
      await call("POST", base + "/entry/acknowledge", {}, guest, 1, {
        "idempotency-key": replayKey,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    data(
      await call(
        "GET",
        "/organizations/" + B.organization.id + "/entry",
        undefined,
        guest,
      ),
    ).destination,
    "HOME",
  );
});

test("persisted administration credential policy drives real core gate and exact-revision attestation", async () => {
  const a = await user(),
    b = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Credential A" }, a),
  );
  const B = data(
    await call("POST", "/organizations", { name: "Credential B" }, a),
  );
  const base = "/organizations/" + A.organization.id,
    path = base + "/administration/security-policy";
  const absent = data(await call("GET", path, undefined, a));
  assert.equal(absent.enabled, false);
  assert.equal(absent.supported, true);
  const config = {
    complexity: false,
    strength: "LOW",
    expirationDays: null,
    mfaEnforced: false,
  };
  const active = data(
    await call("PUT", path, { enabled: true, configuration: config }, a, 0),
  );
  assert.equal(active.version, 1);
  assert.equal(active.state, "ACTIVE");
  assert.equal(
    (await call("GET", base + "/entry", undefined, a)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/organizations/" + B.organization.id + "/entry",
        undefined,
        a,
      )
    ).statusCode,
    200,
  );
  const required = data(
    await call("GET", base + "/security/requirements", undefined, a),
  );
  assert.equal(required.policy.revision, 1);
  data(
    await call(
      "POST",
      base + "/security/attest",
      { password: "a-secure-password-123" },
      a,
    ),
  );
  assert.equal(
    (await call("GET", base + "/entry", undefined, a)).statusCode,
    200,
  );
  assert.equal((await call("GET", path, undefined, b)).statusCode, 404);
  const updated = data(
    await call(
      "PUT",
      path,
      { enabled: true, configuration: { ...config, expirationDays: 90 } },
      a,
      1,
    ),
  );
  assert.equal(updated.id, active.id);
  assert.equal(updated.version, 2);
  assert.equal(
    (await call("GET", base + "/entry", undefined, a)).statusCode,
    403,
  );
  data(
    await call(
      "POST",
      base + "/security/attest",
      { password: "a-secure-password-123" },
      a,
    ),
  );
  assert.equal(
    (await call("GET", base + "/entry", undefined, a)).statusCode,
    200,
  );
  const rolledBack = await call(
    "PUT",
    path,
    { enabled: false, configuration: config },
    a,
    2,
    { "x-administration-test-failure": "true" },
  );
  assert.equal(rolledBack.statusCode, 500);
  assert.equal(data(await call("GET", path, undefined, a)).version, 2);
  const rejected = await call(
    "PUT",
    path,
    {
      enabled: true,
      configuration: { ...config, password: "must-not-persist" },
    },
    a,
    2,
  );
  assert.equal(rejected.statusCode, 400);
  assert.equal(data(await call("GET", path, undefined, a)).version, 2);
  assert.equal(
    (await call("PUT", path, { enabled: false, configuration: config }, a, 1))
      .statusCode,
    409,
  );
  const disabled = data(
    await call("PUT", path, { enabled: false, configuration: config }, a, 2),
  );
  assert.equal(disabled.version, 3);
  const history = data(await call("GET", path + "/history", undefined, a));
  assert.deepEqual(
    history.items.map((r: any) => r.version),
    [3, 2, 1],
  );
  assert.doesNotMatch(
    JSON.stringify(history),
    /must-not-persist|a-secure-password/,
  );
  assert.equal(
    (await call("GET", base + "/entry", undefined, a)).statusCode,
    200,
  );
});

test("admission policy boundary canonicalizes exact domains and preserves revisions on consumer/transaction failure", async () => {
  assert.equal(
    canonicalAdmissionDomain("MÜNICH.Example"),
    "xn--mnich-kva.example",
  );
  for (const invalid of [
    "*.example.org",
    "person@example.org",
    "https://example.org",
    " example.org",
    "example.org.",
    "127.0.0.1",
    "example.org/path",
    "ex%61mple.org",
  ])
    assert.throws(() => canonicalAdmissionDomain(invalid));
  const a = await user(),
    foreign = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Admission A" }, a),
  );
  const B = data(
    await call("POST", "/organizations", { name: "Admission B" }, a),
  );
  const path =
      "/organizations/" +
      A.organization.id +
      "/administration/admission-policy",
    other =
      "/organizations/" +
      B.organization.id +
      "/administration/admission-policy";
  const before = data(await call("GET", path, undefined, a)).policy;
  assert.equal(before.registrationMode, "DISABLED");
  assert.equal(before.revision, 0);
  assert.equal(before.policyId, null);
  useActualAdmissionConsumer = true;
  try {
    const unavailable = await call(
      "PUT",
      path,
      {
        registrationMode: "DISABLED",
        allowedDomains: [],
        membersMayInvite: true,
        limitMemberInvitesToDomains: false,
        invitationLinkEnabled: false,
      },
      a,
      0,
    );
    assert.equal(unavailable.statusCode, 503, unavailable.body);
    assert.equal(unavailable.json().error.code, "POLICY_CONSUMER_UNAVAILABLE");
  } finally {
    useActualAdmissionConsumer = false;
  }
  assert.equal(data(await call("GET", path, undefined, a)).policy.revision, 0);
  assert.equal((await call("GET", path, undefined, foreign)).statusCode, 404);
  const candidate = {
    registrationMode: "DOMAIN_RESTRICTED",
    allowedDomains: ["MÜNICH.Example", "Sub.Example.org"],
    membersMayInvite: true,
    limitMemberInvitesToDomains: true,
    invitationLinkEnabled: true,
  };
  const saved = data(await call("PUT", path, candidate, a, 0)).policy;
  assert.deepEqual(saved.allowedDomains, [
    "sub.example.org",
    "xn--mnich-kva.example",
  ]);
  assert.equal(saved.revision, 1);
  assert.ok(saved.policyId);
  const connection = await pool.connect();
  try {
    await assert.rejects(
      readAdmissionPolicy({ c: connection, organizationId: A.organization.id }),
      /ADMISSION_CONTEXT_REQUIRED/,
    );
    await connection.query("BEGIN");
    await connection.query(
      "SELECT set_config('orgmap.organization_id',$1,true)",
      [A.organization.id],
    );
    await assert.rejects(
      readAdmissionPolicy({ c: connection, organizationId: A.organization.id }),
      /ADMISSION_CONTEXT_REQUIRED/,
    );
    await connection.query(
      "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
      [A.organization.id],
    );
    assert.equal(
      (
        await readAdmissionPolicy({
          c: connection,
          organizationId: A.organization.id,
        })
      ).revision,
      1,
    );
    await connection.query(
      "SELECT set_config('orgmap.organization_id',$1,true)",
      [B.organization.id],
    );
    await assert.rejects(
      readAdmissionPolicy({ c: connection, organizationId: A.organization.id }),
      /ADMISSION_CONTEXT_REQUIRED/,
    );
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
  }
  assert.equal(data(await call("GET", other, undefined, a)).policy.revision, 0);
  rejectAdmissionCandidate = true;
  try {
    assert.equal(
      (
        await call(
          "PUT",
          path,
          { ...candidate, registrationMode: "OPEN" },
          a,
          1,
        )
      ).statusCode,
      503,
    );
  } finally {
    rejectAdmissionCandidate = false;
  }
  assert.equal(data(await call("GET", path, undefined, a)).policy.revision, 1);
  assert.equal(
    (
      await call(
        "PUT",
        path,
        { ...candidate, registrationMode: "OPEN" },
        a,
        1,
        { "x-administration-test-failure": "true" },
      )
    ).statusCode,
    500,
  );
  assert.equal(data(await call("GET", path, undefined, a)).policy.revision, 1);
  assert.equal((await call("PUT", path, candidate, a, 0)).statusCode, 409);
  assert.equal(
    (await call("PUT", path, { ...candidate, source: "ADMIN_ADD" }, a, 1))
      .statusCode,
    400,
  );
  assert.equal(
    (await call("PUT", path, { ...candidate, allowedDomains: [] }, a, 1))
      .statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "PUT",
        path,
        { ...candidate, allowedDomains: ["EXAMPLE.org", "example.org"] },
        a,
        1,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "PUT",
        path,
        { ...candidate, registrationMode: "DISABLED" },
        a,
        1,
      )
    ).statusCode,
    422,
  );
  const history = data(
    await call("GET", path + "/history", undefined, a),
  ).items;
  assert.deepEqual(
    history.map((h: any) => h.version),
    [1],
  );
  assert.equal(history[0].snapshot.policyId, saved.policyId);
  assert.ok(admissionCandidateRevisions.includes(1));
});

test("real admission consumer revokes links atomically when Admin disables admission", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "orgmap-admin-admission-smtp-"),
  );
  const smtp = await startSmtpSink({ port: 0, directory });
  administrationRuntime.registerAdmissionMailTransport({
    host: "127.0.0.1",
    port: (smtp.address() as { port: number }).port,
  });
  useActualAdmissionConsumer = true;
  try {
    const owner = await user(),
      applicant = await user();
    const A = data(
      await call(
        "POST",
        "/organizations",
        { name: "Admission revoke UoW" },
        owner,
      ),
    );
    const base = "/organizations/" + A.organization.id,
      path = base + "/administration/admission-policy";
    const open = {
      registrationMode: "OPEN",
      allowedDomains: [],
      membersMayInvite: false,
      limitMemberInvitesToDomains: false,
      invitationLinkEnabled: true,
    };
    assert.equal(
      data(await call("PUT", path, open, owner, 0)).policy.revision,
      1,
    );
    const issueKey = randomUUID();
    const link = data(
      await call("POST", base + "/invitation-links", {}, owner, 0, {
        "idempotency-key": issueKey,
      }),
    );
    assert.ok(link.linkToken);
    const disabled = {
      ...open,
      registrationMode: "DISABLED",
      invitationLinkEnabled: false,
    };
    assert.equal(
      (
        await call("PUT", path, disabled, owner, 1, {
          "x-administration-test-failure": "true",
        })
      ).statusCode,
      500,
    );
    assert.equal(
      data(await call("GET", path, undefined, owner)).policy.revision,
      1,
    );
    assert.equal(
      data(await call("GET", base + "/invitation-links", undefined, owner)).link
        .revokedAt,
      null,
    );
    const result = data(await call("PUT", path, disabled, owner, 1));
    assert.equal(result.policy.revision, 2);
    assert.ok(
      data(await call("GET", base + "/invitation-links", undefined, owner)).link
        .revokedAt,
    );
    assert.equal(
      (
        await call("POST", base + "/invitation-links", {}, owner, 0, {
          "idempotency-key": issueKey,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      data(await call("PUT", path, open, owner, 2)).policy.revision,
      3,
    );
    assert.equal(
      (
        await call(
          "POST",
          base + "/admission/link-requests",
          { linkToken: link.linkToken },
          applicant,
        )
      ).statusCode,
      404,
    );
    assert.deepEqual(
      data(await call("GET", path + "/history", undefined, owner)).items.map(
        (row: any) => row.version,
      ),
      [3, 2, 1],
    );
  } finally {
    useActualAdmissionConsumer = false;
    await new Promise<void>((resolve, reject) =>
      smtp.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("upload policy boundary preserves ANY semantics, closed classes, tenant context and revision rollback", async () => {
  const owner = await user(),
    foreign = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Upload policy A" }, owner),
  );
  const B = data(
    await call("POST", "/organizations", { name: "Upload policy B" }, owner),
  );
  const path =
      "/organizations/" + A.organization.id + "/administration/upload-policy",
    other =
      "/organizations/" + B.organization.id + "/administration/upload-policy";
  const initial = data(await call("GET", path, undefined, owner)).policy;
  assert.equal(initial.mode, "ANY");
  assert.equal(initial.policyId, null);
  assert.equal(initial.revision, 0);
  assert.equal((await call("GET", path, undefined, foreign)).statusCode, 404);
  const connection = await pool.connect();
  try {
    await assert.rejects(
      readUploadPolicy({ c: connection, organizationId: A.organization.id }),
      /UPLOAD_POLICY_CONTEXT_REQUIRED/,
    );
  } finally {
    connection.release();
  }
  for (const payload of [
    { mode: "ALLOWLIST", allowedKinds: [] },
    { mode: "ALLOWLIST", allowedKinds: ["OPAQUE"] },
    { mode: "ALLOWLIST", allowedKinds: ["PNG", "PNG"] },
    { mode: "ANY", allowedKinds: ["PNG"] },
    { mode: "ANY_SUPPORTED", allowedKinds: [] },
  ])
    assert.equal((await call("PUT", path, payload, owner, 0)).statusCode, 422);
  assert.equal(
    (
      await call(
        "PUT",
        path,
        { mode: "ANY", allowedKinds: [], purpose: "GENERATED_EXPORT" },
        owner,
        0,
      )
    ).statusCode,
    400,
  );
  const saved = data(
    await call(
      "PUT",
      path,
      { mode: "ALLOWLIST", allowedKinds: ["UTF8_TEXT", "PNG"] },
      owner,
      0,
    ),
  ).policy;
  assert.deepEqual(saved.allowedKinds, ["PNG", "UTF8_TEXT"]);
  assert.equal(saved.revision, 1);
  rejectUploadCandidate = true;
  try {
    assert.equal(
      (await call("PUT", path, { mode: "ANY", allowedKinds: [] }, owner, 1))
        .statusCode,
      503,
    );
  } finally {
    rejectUploadCandidate = false;
  }
  assert.equal(
    data(await call("GET", path, undefined, owner)).policy.revision,
    1,
  );
  assert.equal(
    (
      await call(
        "PUT",
        path,
        { mode: "DISABLED", allowedKinds: [] },
        owner,
        1,
        { "x-administration-test-failure": "true" },
      )
    ).statusCode,
    500,
  );
  assert.equal(
    data(await call("GET", path, undefined, owner)).policy.mode,
    "ALLOWLIST",
  );
  assert.equal(
    data(await call("GET", other, undefined, owner)).policy.revision,
    0,
  );
  assert.equal(
    (await call("PUT", path, { mode: "ANY", allowedKinds: [] }, owner, 0))
      .statusCode,
    409,
  );
  const any = data(
    await call("PUT", path, { mode: "ANY", allowedKinds: [] }, owner, 1),
  ).policy;
  assert.equal(any.policyId, saved.policyId);
  assert.equal(any.revision, 2);
  assert.equal(any.mode, "ANY");
  assert.deepEqual(
    data(await call("GET", path + "/history", undefined, owner)).items.map(
      (row: any) => row.version,
    ),
    [2, 1],
  );
});

test(
  "Admin upload policy drives real Platform opaque ingest, replay guard and download-only",
  { skip: !includeUploadPlatform },
  async () => {
    useActualUploadConsumer = true;
    try {
      const owner = await user(),
        other = await user();
      const A = data(
        await call(
          "POST",
          "/organizations",
          { name: "Actual upload A" },
          owner,
        ),
      );
      const B = data(
        await call(
          "POST",
          "/organizations",
          { name: "Actual upload B" },
          owner,
        ),
      );
      const base = "/organizations/" + A.organization.id,
        path = base + "/administration/upload-policy";
      data(
        await call("PUT", path, { mode: "ANY", allowedKinds: [] }, owner, 0),
      );
      const bytes = Buffer.from([0, 255, 128, 42]),
        payload = {
          name: "opaque.bin",
          mime: "application/octet-stream",
          base64: bytes.toString("base64"),
        };
      const endpoint =
          base +
          "/platform/resources/admin-upload-probe/" +
          A.organization.id +
          "/uploads",
        key = randomUUID();
      const uploaded = data(
        await call("POST", endpoint, payload, owner, undefined, {
          "idempotency-key": key,
        }),
      );
      assert.equal(uploaded.state, "READY");
      const download = await call(
        "GET",
        base + "/platform/files/" + uploaded.id + "/download",
        undefined,
        owner,
      );
      const dto = data(download);
      assert.equal(dto.downloadMime, "application/octet-stream");
      assert.equal(dto.disposition, "attachment");
      assert.equal(dto.preview, false);
      assert.equal(dto.base64, payload.base64);
      assert.equal(download.headers["x-content-type-options"], "nosniff");
      data(
        await call(
          "PUT",
          path,
          { mode: "ALLOWLIST", allowedKinds: ["JSON"] },
          owner,
          1,
        ),
      );
      assert.equal(
        (await call("POST", endpoint, payload, owner)).statusCode,
        403,
      );
      assert.equal(
        (
          await call("POST", endpoint, payload, owner, undefined, {
            "idempotency-key": key,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await call(
            "GET",
            base + "/platform/files/" + uploaded.id + "/download",
            undefined,
            owner,
          )
        ).statusCode,
        200,
      );
      const json = {
        name: "data.json",
        mime: "application/json",
        base64: Buffer.from('{"learning":"ação 🌿"}').toString("base64"),
      };
      assert.equal((await call("POST", endpoint, json, owner)).statusCode, 201);
      assert.equal(
        (
          await call(
            "POST",
            endpoint,
            { ...payload, name: "fake.png", mime: "image/png" },
            owner,
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await call(
            "POST",
            endpoint,
            { ...payload, purpose: "GENERATED_EXPORT" },
            owner,
          )
        ).statusCode,
        400,
      );
      data(
        await call(
          "PUT",
          path,
          { mode: "DISABLED", allowedKinds: [] },
          owner,
          2,
        ),
      );
      assert.equal((await call("POST", endpoint, json, owner)).statusCode, 403);
      assert.equal(
        (
          await call(
            "GET",
            base + "/platform/files/" + uploaded.id + "/download",
            undefined,
            owner,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await call(
            "GET",
            base + "/platform/files/" + uploaded.id + "/download",
            undefined,
            other,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await call(
            "GET",
            "/organizations/" +
              B.organization.id +
              "/platform/files/" +
              uploaded.id +
              "/download",
            undefined,
            owner,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        data(
          await call(
            "GET",
            "/organizations/" +
              B.organization.id +
              "/administration/upload-policy",
            undefined,
            owner,
          ),
        ).policy.revision,
        0,
      );
    } finally {
      useActualUploadConsumer = false;
    }
  },
);

test("member indicator consent requires subject confirmation and keeps DEFINE separate from SELF read/record", async () => {
  const owner = await user(),
    subject = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Consent A" }, owner),
  );
  const B = data(
    await call("POST", "/organizations", { name: "Consent B" }, subject),
  );
  const base = "/organizations/" + A.organization.id,
    path = base + "/administration/member-indicator-consents";
  const member = data(
    await call(
      "POST",
      base + "/members",
      { accountId: subject.id, memberType: "MEMBER" },
      owner,
    ),
  ).membership;
  const ownBook = data(await call("GET", path + "/me", undefined, subject)),
    ownerBook = data(await call("GET", path + "/me", undefined, owner));
  assert.equal(ownBook.revision, 0);
  assert.equal(ownBook.consents.length, 0);
  assert.equal(ownBook.capabilities.consentOwn, true);
  assert.equal(ownBook.subjectMemberId, member.id);
  const authority = async (actor: any, action: string) =>
    data(
      await call(
        "GET",
        base +
          "/admin-test-member-indicator-authority/" +
          member.id +
          "/" +
          action,
        undefined,
        actor,
      ),
    );
  assert.equal((await authority(subject, "READ")).allowed, true);
  assert.equal((await authority(subject, "RECORD")).allowed, true);
  assert.equal((await authority(subject, "DEFINE")).allowed, false);
  assert.equal((await authority(owner, "READ")).allowed, false);
  assert.equal((await authority(owner, "DEFINE")).allowed, false);
  const payload = {
    delegateMemberId: ownerBook.subjectMemberId,
    actions: ["DEFINE"],
    confirmation: "AUTHORIZE_DEFINE_ON_MY_INDICATORS",
  };
  assert.equal(
    (
      await call(
        "POST",
        path,
        { ...payload, subjectMemberId: member.id },
        owner,
        0,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await call("POST", path, { ...payload, confirmation: "" }, subject, 0))
      .statusCode,
    422,
  );
  assert.equal(
    (await call("POST", path, { ...payload, actions: ["READ"] }, subject, 0))
      .statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        path,
        { ...payload, expiresAt: "2026-02-31T00:00:00Z" },
        subject,
        0,
      )
    ).statusCode,
    422,
  );
  const key = randomUUID(),
    granted = data(
      await call("POST", path, payload, subject, 0, { "idempotency-key": key }),
    );
  assert.equal(granted.revision, 1);
  assert.equal(granted.consent.subjectMemberId, member.id);
  assert.equal(granted.consent.delegateMemberId, ownerBook.subjectMemberId);
  assert.equal(
    data(
      await call("POST", path, payload, subject, 0, { "idempotency-key": key }),
    ).consent.id,
    granted.consent.id,
  );
  assert.equal(
    data(await call("GET", path + "/me", undefined, subject)).consents.length,
    1,
  );
  const allowed = await authority(owner, "DEFINE");
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.reasons, [
    { kind: "EXPLICIT_GRANT", grantId: granted.consent.id, grantRevision: 1 },
  ]);
  assert.equal(allowed.subjectVersion, member.version);
  assert.equal((await authority(owner, "READ")).allowed, false);
  assert.equal((await authority(owner, "RECORD")).allowed, false);
  const received = data(
    await call("GET", path + "/received", undefined, owner),
  );
  assert.equal(received.consents.length, 1);
  assert.doesNotMatch(JSON.stringify(received), /email|values|profile/);
  assert.equal(
    (await call("PUT", path + "/" + granted.consent.id, payload, owner, 0))
      .statusCode,
    404,
  );
  assert.equal(
    data(
      await call(
        "GET",
        "/organizations/" +
          B.organization.id +
          "/administration/member-indicator-consents/me",
        undefined,
        subject,
      ),
    ).revision,
    0,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/" + granted.consent.id + "/revoke",
        {},
        subject,
        0,
      )
    ).statusCode,
    409,
  );
  const revokeKey = randomUUID();
  const revoked = data(
    await call(
      "POST",
      path + "/" + granted.consent.id + "/revoke",
      {},
      subject,
      1,
      { "idempotency-key": revokeKey },
    ),
  );
  assert.equal(revoked.revision, 2);
  assert.equal((await authority(owner, "DEFINE")).allowed, false);
  assert.equal(
    data(await call("GET", path + "/received", undefined, owner)).consents
      .length,
    0,
  );
  assert.equal(
    data(
      await call(
        "POST",
        path + "/" + granted.consent.id + "/revoke",
        {},
        subject,
        1,
        { "idempotency-key": revokeKey },
      ),
    ).revision,
    2,
  );
  assert.equal(
    data(
      await call(
        "POST",
        path + "/" + granted.consent.id + "/revoke",
        {},
        subject,
        2,
      ),
    ).revision,
    2,
  );
  const before = data(await call("GET", path + "/me", undefined, subject));
  assert.equal(
    (
      await call("POST", path, payload, subject, 2, {
        "x-administration-test-failure": "true",
      })
    ).statusCode,
    500,
  );
  const after = data(await call("GET", path + "/me", undefined, subject));
  assert.equal(after.revision, before.revision);
  assert.equal(after.consents.length, before.consents.length);
  const results = await Promise.all([
    call("POST", path, payload, subject, 2),
    call("POST", path, { ...payload, delegateMemberId: member.id }, subject, 2),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal(
    data(await call("GET", path + "/me", undefined, subject)).revision,
    3,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { request, setCsrf, errorMessage, RequestError, credentialBlockedOrganization } from "../src/api.ts";
test("browser API carries session credentials, CSRF, idempotency and version without leaking secrets into query", async () => {
  const original = globalThis.fetch;
  let seen: RequestInit | undefined;
  let url = "";
  globalThis.fetch = async (u, o) => {
    url = String(u);
    seen = o;
    return new Response(
      JSON.stringify({ data: { saved: true }, meta: {}, capabilities: {} }),
      { status: 200 },
    );
  };
  try {
    setCsrf("csrf-test");
    await request("/organizations/test/roles/role", {
      method: "PATCH",
      version: 7,
      key: "test-command",
      body: { name: "Novo nome" },
    });
    assert.equal(url, "/api/v1/organizations/test/roles/role");
    assert.equal(seen?.credentials, "same-origin");
    assert.equal(
      (seen?.headers as Record<string, string>)["X-CSRF-Token"],
      "csrf-test",
    );
    assert.equal((seen?.headers as Record<string, string>)["If-Match"], '"7"');
    assert.equal(
      (seen?.headers as Record<string, string>)["Idempotency-Key"],
      "test-command",
    );
    assert.equal(seen?.body, JSON.stringify({ name: "Novo nome" }));
  } finally {
    globalThis.fetch = original;
    setCsrf("");
  }
});
test("version conflicts remain actionable and do not report success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: "VERSION_CONFLICT", message: "VERSION_CONFLICT" },
        meta: { requestId: "trace" },
      }),
      { status: 409 },
    );
  try {
    await assert.rejects(
      () => request("/resource", { method: "PATCH", version: 1, body: {} }),
      (e: unknown) =>
        e instanceof RequestError &&
        e.code === "VERSION_CONFLICT" &&
        errorMessage(e).includes("outra pessoa"),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('credential challenges identify only the affected tenant and never recurse on proof endpoints',()=>{
 assert.equal(credentialBlockedOrganization('/organizations/org-a/roles/r?token=discarded',403,'ORG_CREDENTIAL_REQUIREMENT_UNMET'),'org-a');
 for(const path of ['/account','/organizations/org-a/security/attest','/organizations/org-a/security/requirements']) assert.equal(credentialBlockedOrganization(path,403,'ORG_CREDENTIAL_REQUIREMENT_UNMET'),null);
 assert.equal(credentialBlockedOrganization('/organizations/org-a/roles',404,'RESOURCE_NOT_FOUND'),null);
 assert.equal(credentialBlockedOrganization('/organizations/org-a/roles',401,'UNAUTHENTICATED'),null);
});

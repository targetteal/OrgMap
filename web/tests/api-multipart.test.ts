import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { File } from "node:buffer";
import { request, requestBlob, setCsrf, RequestError } from "../src/api.ts";
import { createBrandingTransport } from "../src/features/administration/branding-transport.ts";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://multipart.localhost",
});
for (const key of ["window", "Event", "CustomEvent"])
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom.window : (dom.window as any)[key],
    configurable: true,
  });
const original = globalThis.fetch;
after(() => {
  globalThis.fetch = original;
  setCsrf("");
  dom.window.close();
});
test("multipart is sent as FormData with CSRF and no manually declared boundary", async () => {
  let requestUrl = "",
    seen: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    seen = init;
    return new Response(
      JSON.stringify({
        data: { asset: { id: "asset" } },
        meta: {},
        capabilities: {},
      }),
      { status: 200 },
    );
  };
  try {
    setCsrf("csrf-test");
    const form = new FormData();
    form.append(
      "file",
      new File(["image"], "brand.png", { type: "image/png" }),
    );
    form.append("publish", "true");
    await request(
      "/organizations/a/administration/branding-assets/login-background",
      { method: "POST", body: form, version: 3, key: "command-1" },
    );
    const headers = seen!.headers as Record<string, string>;
    assert.equal(
      requestUrl,
      "/api/v1/organizations/a/administration/branding-assets/login-background",
    );
    assert.equal(seen!.credentials, "same-origin");
    assert.equal(seen!.body, form);
    assert.equal(headers["X-CSRF-Token"], "csrf-test");
    assert.equal(
      headers["If-Match"],
      String.fromCharCode(34) + "3" + String.fromCharCode(34),
    );
    assert.equal(headers["Idempotency-Key"], "command-1");
    assert.ok(
      !Object.keys(headers).some((k) => k.toLowerCase() === "content-type"),
    );
  } finally {
    globalThis.fetch = original;
    setCsrf("");
  }
});
test("blob reads use same-origin no-store and propagate scoped session and credential failures", async () => {
  let seen: RequestInit | undefined,
    expired = 0;
  const challenged: string[] = [];
  const onExpired = () => expired++,
    onCredential = (e: Event) =>
      challenged.push((e as CustomEvent).detail.organizationId);
  window.addEventListener("orgmap:session-expired", onExpired);
  window.addEventListener("orgmap:credential-required", onCredential);
  setCsrf("csrf-test");
  try {
    globalThis.fetch = async (_url, init) => {
      seen = init;
      return new Response(new Blob(["bytes"], { type: "image/png" }), {
        status: 200,
      });
    };
    const b = await requestBlob("/organizations/a/branding/workspace-logo");
    assert.equal(await b.text(), "bytes");
    assert.equal(seen!.credentials, "same-origin");
    assert.equal(seen!.cache, "no-store");
    assert.equal(
      (seen!.headers as Record<string, string>).Accept,
      "image/png, application/octet-stream",
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "UNAUTHENTICATED" },
        }),
        { status: 401 },
      );
    await assert.rejects(
      () => requestBlob("/organizations/a/branding/workspace-logo"),
      (e: unknown) => e instanceof RequestError && e.code === "UNAUTHENTICATED",
    );
    assert.equal(expired, 1);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "ORG_CREDENTIAL_REQUIREMENT_UNMET",
            message: "blocked",
          },
        }),
        { status: 403 },
      );
    await assert.rejects(
      () => requestBlob("/organizations/a/branding/workspace-logo"),
      (e: unknown) =>
        e instanceof RequestError &&
        e.code === "ORG_CREDENTIAL_REQUIREMENT_UNMET",
    );
    assert.deepEqual(challenged, ["a"]);
  } finally {
    window.removeEventListener("orgmap:session-expired", onExpired);
    window.removeEventListener("orgmap:credential-required", onCredential);
    globalThis.fetch = original;
    setCsrf("");
  }
});
test("branding preview rejects foreign or malformed reader URLs before any network request", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw Error("unexpected network");
  };
  const transport = createBrandingTransport("a", request);
  const asset = {
    readUrl: "/api/v1/organizations/b/branding/workspace-logo",
  } as any;
  try {
    await assert.rejects(
      () =>
        transport.read("WORKSPACE_LOGO", asset, new AbortController().signal),
      (e: unknown) =>
        e instanceof RequestError && e.code === "INVALID_RESPONSE",
    );
    await assert.rejects(() =>
      transport.read(
        "LOGIN_BACKGROUND",
        { readUrl: "https://outside.test/image.png" } as any,
        new AbortController().signal,
      ),
    );
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("branding upload forwards the original file and explicit publication choice", async () => {
  let seen: RequestInit | undefined,
    path = "";
  globalThis.fetch = async (url, init) => {
    path = String(url);
    seen = init;
    return new Response(
      JSON.stringify({
        data: { asset: { origin: "UPLOADED", revision: 2 } },
        meta: {},
        capabilities: {},
      }),
      { status: 200 },
    );
  };
  try {
    setCsrf("csrf-test");
    const transport = createBrandingTransport("a", request);
    const file = new File(["image"], "brand.png", { type: "image/png" });
    await transport.upload(
      "LOGIN_BACKGROUND",
      file as unknown as globalThis.File,
      1,
      true,
      "upload-key",
      new AbortController().signal,
    );
    const body = seen!.body as FormData;
    assert.equal(
      path,
      "/api/v1/organizations/a/administration/branding-assets/login-background",
    );
    assert.equal(body.get("publish"), "true");
    assert.equal((body.get("file") as File).name, "brand.png");
    assert.equal(await (body.get("file") as File).text(), "image");
    assert.equal(
      (seen!.headers as Record<string, string>)["Idempotency-Key"],
      "upload-key",
    );
    assert.ok(
      !Object.keys(seen!.headers as Record<string, string>).some(
        (k) => k.toLowerCase() === "content-type",
      ),
    );
  } finally {
    globalThis.fetch = original;
    setCsrf("");
  }
});

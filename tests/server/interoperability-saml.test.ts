import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { startSmtpSink, sendLocalMail } from "../../server/src/smtp.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import type { EnrollmentConfiguration } from "../../server/modules/interoperability/enrollment-ports.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createInteroperability } from "../../server/modules/interoperability/index.js";
import type { SamlConfigurations } from "../../server/modules/interoperability/saml-routes.js";
import pg from "pg";
const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const configs: SamlConfigurations = {};
const enrollments: EnrollmentConfiguration = {};
let core!: ModuleRuntime;
const app = await buildApp([foundationDefaultAdmissionPolicy,
  createInteroperability({}, undefined, configs, {}, undefined, enrollments),
  async (_app, runtime) => {
    core = runtime;
  },
]);
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
});
test("SAML signed response and assertion roundtrip, explicit account binding, recipient/tamper/replay and Origin guards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orgmap-saml-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-sha256",
        "-days",
        "1",
        "-nodes",
        "-subj",
        "/CN=OrgMap synthetic IdP",
      ],
      { stdio: "ignore" },
    );
    const privateKey = await readFile(join(dir, "key.pem"), "utf8"),
      publicCert = await readFile(join(dir, "cert.pem"), "utf8");
    const origin = "http://localhost:5173";
    async function req(
      method: string,
      path: string,
      payload?: any,
      headers: any = {},
    ) {
      return app.inject({
        method: method as any,
        url: "/api/v1" + path,
        headers: { origin, "idempotency-key": randomUUID(), ...headers },
        payload,
      });
    }
    const registered = await req("POST", "/auth/register", {
      email: randomUUID() + "@example.test",
      password: "saml-test-password-123",
      displayName: "SAML local",
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const account = registered.json().data.account.id,
      auth = {
        cookie: registered.cookies[0].name + "=" + registered.cookies[0].value,
        "x-csrf-token": registered.json().data.csrfToken,
      };
    const org = await req(
      "POST",
      "/organizations",
      { name: "SAML synthetic" },
      auth,
    );
    assert.equal(org.statusCode, 201, org.body);
    const orgId = org.json().data.organization.id,
      path = "/organizations/" + orgId + "/interoperability";
    const conn = await req(
      "POST",
      path + "/connections",
      { provider: "SAML", label: "Local SAML IdP" },
      auth,
    );
    assert.equal(conn.statusCode, 200, conn.body);
    const cid = conn.json().data.connection.id,
      prefix = path + "/connections/" + cid + "/saml",
      callback = "http://localhost:3001/api/v1" + prefix + "/acs";
    configs[orgId + ":" + cid] = {
      entryPoint: "http://localhost:9191/sso",
      issuer: "urn:orgmap:synthetic:sp",
      idpIssuer: "urn:orgmap:synthetic:idp",
      callbackUrl: callback,
      idpCert: publicCert,
      allowLocalHttp: true,
      authnContextAmr: { "urn:orgmap:test:mfa": ["mfa"] },
    };
    function sign(xml: string, name: string) {
      const signer = new SignedXml({
        privateKey,
        publicCert,
        signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
        canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
      });
      signer.addReference({
        xpath: `//*[local-name()='${name}']`,
        transforms: [
          "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
          "http://www.w3.org/2001/10/xml-exc-c14n#",
        ],
        digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
      });
      signer.computeSignature(xml, {
        location: {
          reference: `//*[local-name()='${name}']/*[local-name()='Issuer']`,
          action: "after",
        },
      });
      return signer.getSignedXml();
    }
    async function flow(
      link: boolean,
      recipient = callback,
      prepared?: any,
      subject = "stable-subject",
      authnContext = "urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport",
      authnInstant?: string,
    ) {
      const enrollmentCookie = prepared?.cookies.find(
        (c: any) => c.name === "orgmap_enrollment_flow",
      );
      const start = prepared
        ? await req(
            "POST",
            prefix + "/enrollment/start",
            {},
            { cookie: enrollmentCookie.name + "=" + enrollmentCookie.value },
          )
        : await req(
            link ? "POST" : "GET",
            prefix + (link ? "/link" : "/login"),
            link ? {} : undefined,
            link ? auth : {},
          );
      assert.equal(start.statusCode, 200, start.body);
      const url = new URL((start.json().data ?? start.json()).authorizationUrl),
        raw = inflateRawSync(
          Buffer.from(url.searchParams.get("SAMLRequest")!, "base64"),
        ).toString(),
        requestId = raw.match(/ID="([^"]+)"/)![1],
        state = url.searchParams.get("RelayState")!,
        cookie = start.cookies.find((x) => x.name === "orgmap_saml_flow")!;
      const now = new Date().toISOString(),
        before = new Date(Date.now() - 30000).toISOString(),
        after = new Date(Date.now() + 120000).toISOString();
      let assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${randomUUID()}" Version="2.0" IssueInstant="${now}"><saml:Issuer>urn:orgmap:synthetic:idp</saml:Issuer><saml:Subject><saml:NameID>${subject}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="${recipient}" NotOnOrAfter="${after}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${before}" NotOnOrAfter="${after}"><saml:AudienceRestriction><saml:Audience>urn:orgmap:synthetic:sp</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${authnInstant ?? now}" SessionIndex="synthetic"><saml:AuthnContext><saml:AuthnContextClassRef>${authnContext}</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="amr"><saml:AttributeValue>mfa</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
      assertion = sign(assertion, "Assertion");
      const response = sign(
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${randomUUID()}" Version="2.0" IssueInstant="${now}" Destination="${callback}" InResponseTo="${requestId}"><saml:Issuer>urn:orgmap:synthetic:idp</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`,
        "Response",
      );
      return {
        response,
        headers: {
          origin: "http://localhost:9191",
          cookie:
            cookie.name +
            "=" +
            cookie.value +
            (link ? "; " + auth.cookie : "") +
            (enrollmentCookie
              ? "; " + enrollmentCookie.name + "=" + enrollmentCookie.value
              : ""),
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: new URLSearchParams({
          SAMLResponse: Buffer.from(response).toString("base64"),
          RelayState: state,
        }).toString(),
      };
    }
    const staleEpoch = await flow(true);
    await admin.query("UPDATE accounts SET email_revision=email_revision+2 WHERE id=$1", [account]);
    const epochDenied = await req("POST", prefix + "/acs", staleEpoch.payload, staleEpoch.headers);
    assert.equal(epochDenied.statusCode, 403, epochDenied.body);
    assert.equal(epochDenied.json().error.code, "ACCOUNT_PROOF_STALE");
    const unstamped = await flow(true);
    const unstampedState = new URLSearchParams(unstamped.payload).get("RelayState")!;
    await admin.query("UPDATE interop_auth_flows SET initiating_session_id=NULL,account_email_revision=NULL WHERE organization_id=$1 AND state_hash=$2", [orgId, createHash("sha256").update(unstampedState).digest("hex")]);
    const legacyDenied = await req("POST", prefix + "/acs", unstamped.payload, unstamped.headers);
    assert.equal(legacyDenied.statusCode, 403, legacyDenied.body);
    assert.equal(legacyDenied.json().error.code, "ACCOUNT_PROOF_STALE");
    const linked = await flow(true);
    const success = await req(
      "POST",
      prefix + "/acs",
      linked.payload,
      linked.headers,
    );
    assert.equal(success.statusCode, 200, success.body);
    assert.equal(success.json().data.account.id, account);
    const replay = await req(
      "POST",
      prefix + "/acs",
      linked.payload,
      linked.headers,
    );
    assert.equal(replay.statusCode, 401, replay.body);
    const login = await flow(false);
    const result = await req(
      "POST",
      prefix + "/acs",
      login.payload,
      login.headers,
    );
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().data.account.id, account);
    async function sessionEvidence(response: any) {
      const token = response.cookies.find((c: any) => c.name === "orgmap_session")!.value;
      return (await admin.query("SELECT auth_amr,auth_time FROM sessions WHERE token_hash=$1", [createHash("sha256").update(token).digest("hex")])).rows[0];
    }
    assert.deepEqual((await sessionEvidence(result)).auth_amr, []);
    assert.equal((await sessionEvidence(result)).auth_time, null);
    const mapped = await flow(false, callback, undefined, "stable-subject", "urn:orgmap:test:mfa");
    const mappedResult = await req("POST", prefix + "/acs", mapped.payload, mapped.headers);
    assert.equal(mappedResult.statusCode, 200, mappedResult.body);
    const evidence = await sessionEvidence(mappedResult);
    assert.deepEqual(evidence.auth_amr, ["mfa"]);
    assert.ok(Math.abs(Date.now() - +new Date(evidence.auth_time)) < 30000);
    const futureEvidence = await flow(false, callback, undefined, "stable-subject", "urn:orgmap:test:mfa", new Date(Date.now() + 3600000).toISOString());
    const futureResult = await req("POST", prefix + "/acs", futureEvidence.payload, futureEvidence.headers);
    assert.equal(futureResult.statusCode, 401, futureResult.body);
    const badRecipient = await flow(false, "http://localhost:3001/wrong");
    assert.equal(
      (
        await req(
          "POST",
          prefix + "/acs",
          badRecipient.payload,
          badRecipient.headers,
        )
      ).statusCode,
      401,
    );
    const tamper = await flow(false);
    const tampered = new URLSearchParams(tamper.payload);
    tampered.set(
      "SAMLResponse",
      Buffer.from(
        tamper.response.replace("stable-subject", "attacker-subject"),
      ).toString("base64"),
    );
    assert.equal(
      (await req("POST", prefix + "/acs", tampered.toString(), tamper.headers))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await req(
          "POST",
          "/auth/login",
          { email: "x@example.test", password: "synthetic" },
          { origin: "http://attacker.invalid" },
        )
      ).statusCode,
      403,
    );
    const badOrigin = await flow(false);
    assert.equal(
      (
        await req("POST", prefix + "/acs", badOrigin.payload, {
          ...badOrigin.headers,
          origin: "http://attacker.invalid",
        })
      ).statusCode,
      403,
    );
    const mailDirectory = join(dir, "smtp"),
      smtp = await startSmtpSink({ port: 0, directory: mailDirectory });
    try {
      const currentCookie = result.cookies.find(
          (c) => c.name === "orgmap_session",
        )!,
        currentAuth = {
          cookie: currentCookie.name + "=" + currentCookie.value,
          "x-csrf-token": result.json().data.csrfToken,
        };
      const source = "saml-opaque-enrollment",
        email = randomUUID() + "@example.test";
      enrollments[orgId + ":" + cid] = {
        issuer: "urn:orgmap:synthetic:idp",
        claim: "nameID",
        mappingRevision: 1,
        externalIdToValue: { [source]: "enrollment-subject" },
      };
      const credential = await req(
        "POST",
        path + "/credentials",
        {
          label: "SAML enrollment provisioning",
          kind: "SCIM",
          connectionId: cid,
          scopes: ["members.provision"],
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        currentAuth,
      );
      assert.equal(credential.statusCode, 200, credential.body);
      const pending = await req(
        "POST",
        path + "/scim/v2/Users",
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          externalId: source,
          userName: "saml-enrollment-user",
          emails: [{ value: email, primary: true }],
          active: true,
        },
        { authorization: "Bearer " + credential.json().data.secret },
      );
      assert.equal(pending.statusCode, 201, pending.body);
      assert.equal(
        await core.deliverProvisionedEnrollmentMail(orgId, (message) =>
          sendLocalMail(message, (smtp.address() as any).port),
        ),
        1,
      );
      const mail = await readFile(
          join(mailDirectory, (await readdir(mailDirectory))[0]),
          "utf8",
        ),
        token = mail.match(/\r?\n([a-f0-9]{64})(?:\r?\n|$)/)![1];
      const prepared = await req("POST", "/enrollments/prepare", { token });
      assert.equal(prepared.statusCode, 200, prepared.body);
      const enrollmentFlow = await flow(
        false,
        callback,
        prepared,
        "enrollment-subject",
      );
      const activated = await req(
        "POST",
        prefix + "/acs",
        enrollmentFlow.payload,
        enrollmentFlow.headers,
      );
      assert.equal(activated.statusCode, 200, activated.body);
      assert.equal(activated.json().data.account.email, email);
      assert.notEqual(activated.json().data.account.id, account);
      assert.equal(
        activated.json().data.enrollment.provisioningState,
        "ACTIVE",
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        smtp.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

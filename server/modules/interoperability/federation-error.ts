import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { Failure } from "../../src/core.js";
const publicCodes = new Set([
  "ENROLLMENT_INVALID",
  "ENROLLMENT_IDENTITY_MISMATCH",
  "ACTIVATION_CONFIRMATION_REQUIRED",
  "SSO_REQUIRED",
  "OIDC_STATE_INVALID",
  "OIDC_BROWSER_STATE_INVALID",
  "SAML_STATE_INVALID",
  "SAML_BROWSER_STATE_INVALID",
  "SAML_ASSERTION_INVALID",
  "SAML_RECIPIENT_INVALID",
  "PROVISIONING_MAPPING_REQUIRED",
  "EXTERNAL_CONFIGURATION_REQUIRED",
]);
/** Redirect only safe status codes. No token, claim, email or provider diagnostic reaches URL/history. */
export function federationErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const failure =
    error instanceof Failure
      ? error
      : { status: 500, code: "IDENTITY_CONFIRMATION_FAILED" };
  if (request.headers.accept?.includes("text/html"))
    return reply.redirect(
      "/enrollment?error=" +
        (publicCodes.has(failure.code)
          ? failure.code
          : "IDENTITY_CONFIRMATION_FAILED"),
    );
  return reply
    .code(failure.status)
    .send({
      error: {
        code: failure.code,
        message: failure.code,
        fieldErrors: [],
        retryable: failure.status === 503,
        conflictDetails: null,
      },
      meta: { requestId: request.id },
    });
}

import { readFile, stat } from 'node:fs/promises';
import { Ajv } from 'ajv';
import type { IntegrationOptions } from './index.js';

type HostConfiguration = Pick<IntegrationOptions, 'blobsDirectory' | 'smtp' | 'oidc' | 'saml' | 'deliveries' | 'enrollment'> & {
  webhookSecrets?: Record<string, string>;
};

const text = { type: 'string', minLength: 1 };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const providers = (schema: object) => ({
  type: 'object', patternProperties: { '^[a-f0-9-]{36}:[a-f0-9-]{36}$': schema }, additionalProperties: false,
});
const validate = new Ajv({ allErrors: false }).compile<HostConfiguration>(object({
  blobsDirectory: text,
  smtp: object({ host: text, port: { type: 'integer', minimum: 1, maximum: 65535 } }, ['port']),
  oidc: providers(object({
    issuer: text, clientId: text, clientSecret: text, authorizationEndpoint: text,
    tokenEndpoint: text, jwksUri: text, redirectUri: text, allowLocalHttp: { type: 'boolean' },
  }, ['issuer', 'clientId', 'authorizationEndpoint', 'tokenEndpoint', 'jwksUri', 'redirectUri'])),
  saml: providers(object({
    entryPoint: text, issuer: text, idpIssuer: text, callbackUrl: text, idpCert: text, allowLocalHttp: { type: 'boolean' },
    authnContextAmr: { type: 'object', additionalProperties: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 100 } } },
  }, ['entryPoint', 'issuer', 'idpIssuer', 'callbackUrl', 'idpCert'])),
  deliveries: providers(object({ endpoint: text, secret: text, allowLocalHttp: { type: 'boolean' } }, ['endpoint', 'secret'])),
  enrollment: providers(object({
    issuer: text,
    claim: { ...text, not: { enum: ['email', 'email_verified', 'preferred_username', 'userName'] } },
    mappingRevision: { type: 'integer', minimum: 1 },
    externalIdToValue: { type: 'object', additionalProperties: text },
    ssoRequired: { type: 'boolean' },
    requestedMemberType: { type: 'string', enum: ['MEMBER', 'GUEST'] },
  }, ['issuer', 'claim', 'mappingRevision', 'externalIdToValue'])),
  webhookSecrets: providers(text),
}));

/** Operator-owned configuration shared by HTTP and background processes; no credentials in the repository. */
export async function loadIntegrationOptions(path = process.env.ORGMAP_INTEGRATION_CONFIG): Promise<IntegrationOptions> {
  if (!path) return {};
  let document: unknown;
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 1024 * 1024 || (metadata.mode & 0o077) !== 0)
      throw Error('invalid configuration file');
    document = JSON.parse(await readFile(path, 'utf8'));
    if (!validate(document)) throw Error('invalid configuration document');
  } catch {
    // File paths, provider secrets and raw validation values never enter diagnostics.
    throw Error('INTEGRATION_CONFIG_INVALID');
  }
  const { webhookSecrets, ...options } = document;
  return {
    ...options,
    ...(webhookSecrets ? { webhooks: { secrets: webhookSecrets, ports: {} } } : {}),
  };
}

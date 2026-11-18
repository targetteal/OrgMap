import type {RichDocument} from "../../packages/content";
import type {EntityDefinition} from "./structure-definition";
import type {
  Account,
  Envelope,
  StructureNode,
} from "../../packages/contracts/index";
export type { Account, StructureNode };
export type Organization = {
  id: string;
  name: string;
  memberId: string;
  orgRole: string;
};
export type Session = {
  account: Account;
  organizations: Organization[];
  csrfToken: string;
};
export type Member = {
  id: string;
  accountId?: string;
  displayName: string;
  status?: string;
  orgRole?: string;
  memberType?: string;
  version?: number;
};
export type Relation = {
  id: string;
  memberId: string;
  circleId?: string;
  roleId?: string;
  origin?: string;
  kind?: string;
  scope?: string;
  startsAt: string;
  endsAt?: string | null;
  version?: number;
};
export type VisibleStructureNode = StructureNode & {pathRedacted?: boolean};
export type Structure = {
  structureRevision: number;
  nodes: VisibleStructureNode[];
  circles: ({ id: string; nodeId: string; purpose: string | null; purposeRich?: RichDocument | null } & EntityDefinition)[];
  roles: ({ id: string; nodeId: string; purpose: string | null; purposeRich?: RichDocument | null } & EntityDefinition)[];
  memberships: Relation[];
  occupancies: Relation[];
  coverage: {
    complete: boolean;
    depthLimited: boolean;
    degradedReasons: string[];
  };
};
export type Bootstrap = {
  governanceModel?: {phase:'PREPARATION'|'OPERATING';rules:{membership:'OCCUPANCY'|'LEGACY';structureChanges:'GOVERNANCE'|'LEGACY'}} | null;
  organization: { id: string; name: string; version: number;vocabulary?:{circle?:string;role?:string;member?:string} };
  membership: { id: string; orgRole: string; memberType?: "MEMBER" | "GUEST" };
  rootCircleId: string | null;
  capabilities: Record<string, boolean>;
  modules: Record<string, boolean>;
  sharedResources?: { context: string; kind: string; id: string }[];
  authorizationRevision?: number;
  policies: unknown;
};
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
let csrf = "";
export function setCsrf(token: string) {
  csrf = token;
}
export async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    version?: number;
    signal?: AbortSignal;
    key?: string;
  } = {},
): Promise<Envelope<T>> {
  const method = options.method ?? "GET";
  const multipart = typeof FormData !== "undefined" && options.body instanceof FormData;
  const binary = typeof Blob !== "undefined" && options.body instanceof Blob;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    if (options.body !== undefined && !multipart)
      headers["Content-Type"] = binary
        ? (options.body as Blob).type || "application/octet-stream"
        : "application/json";
    if (csrf) headers["X-CSRF-Token"] = csrf;
    headers["Idempotency-Key"] = options.key ?? crypto.randomUUID();
  }
  if (options.version !== undefined)
    headers["If-Match"] = `"${options.version}"`;
  let response: Response;
  try {
    response = await fetch("/api/v1" + path, {
      method,
      headers,
      credentials: "same-origin",
      body:
        options.body === undefined ? undefined : multipart || binary ? options.body as FormData : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new RequestError(
      "NETWORK_ERROR",
      "Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new RequestError(
      "INVALID_RESPONSE",
      "O servidor não respondeu como esperado. Tente novamente.",
    );
  }
  if (
    response.status === 401 &&
    csrf &&
    result.error?.code === "UNAUTHENTICATED" &&
    typeof window !== "undefined"
  )
    window.dispatchEvent(new Event("orgmap:session-expired"));
  const blockedOrganization = credentialBlockedOrganization(path, response.status, result.error?.code);
  if (blockedOrganization && typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("orgmap:credential-required", {detail:{organizationId:blockedOrganization}}));
  if (!response.ok)
    throw new RequestError(
      result.error?.code ?? "REQUEST_FAILED",
      result.error?.message ?? "Não foi possível concluir a ação.",
      result.meta?.requestId,
    );
  return result as Envelope<T>;
}
/** Private raster/download bytes use the same session and current authorization as JSON reads. */
export async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch('/api/v1' + path, { credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'image/png, application/octet-stream' } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new RequestError('NETWORK_ERROR', 'Não foi possível conectar ao servidor. Tente novamente.');
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && csrf && result.error?.code === 'UNAUTHENTICATED' && typeof window !== 'undefined')
      window.dispatchEvent(new Event('orgmap:session-expired'));
    const blockedOrganization = credentialBlockedOrganization(path, response.status, result.error?.code);
    if (blockedOrganization && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('orgmap:credential-required', { detail: { organizationId: blockedOrganization } }));
    throw new RequestError(result.error?.code ?? 'REQUEST_FAILED', result.error?.message ?? 'Não foi possível carregar o arquivo.', result.meta?.requestId);
  }
  return response.blob();
}
const messages: Record<string, string> = {
  AUTH_CONTINUITY_REQUIRED: 'Esta alteração deixaria uma conta sem acesso. O titular precisa configurar um método de entrada independente antes de continuar.',
  CAPABILITY_UNAVAILABLE: 'Esta capacidade ainda não está disponível. As configurações salvas foram preservadas.',
  UNAUTHENTICATED:
    "Sua sessão expirou. Entre novamente para continuar.",
  ACTION_DENIED: "Você não tem permissão para realizar esta ação.",
  ORG_CREDENTIAL_REQUIREMENT_UNMET: "Confirme o acesso à organização e tente novamente. Sua alteração ainda não foi salva.",
  RESOURCE_NOT_FOUND:
    "O registro não existe ou não está disponível para sua conta nesta organização.",
  STATE_CONFLICT:
    "A ação conflita com o estado atual. Verifique relações existentes antes de tentar novamente.",
  IDEMPOTENCY_CONFLICT:
    "Esta tentativa já foi registrada com outros dados. Feche e reabra o formulário antes de tentar novamente.",
  PRECONDITION_REQUIRED: "Atualize os dados antes de salvar esta alteração.",
  LAST_OWNER_PROTECTED:
    "O proprietário da organização não pode ser suspenso por este comando.",
  FIELD_GOVERNED:
    "Esta alteração exige um processo de governança. Registre uma proposta para continuar.",
  MODULE_DISABLED:
    "Este módulo foi desativado pela organização. Uma pessoa administradora pode reativá-lo nas configurações.",
  MODULE_CONFIGURATION_UNAVAILABLE:
    "A configuração deste módulo ainda não está disponível. Tente novamente após a integração da organização.",
  STRUCTURE_CYCLE:
    "O destino criaria um ciclo na estrutura. Escolha outro círculo.",
  ANCHOR_PROTECTED:
    "O círculo raiz da organização não pode ser movido ou arquivado.",
  INTERIM_END_REQUIRED: "Defina uma data final para a ocupação interina.",
  DOMAIN_INVARIANT:
    "Os dados não atendem às regras desta organização. Revise o formulário.",
  INVALID_REQUEST: "Revise os campos preenchidos e tente novamente.",
  RATE_LIMITED:
    "Muitas tentativas. Aguarde um minuto antes de tentar novamente.",
  CSRF_INVALID:
    "Sua sessão precisa ser atualizada. Recarregue a página e entre novamente.",
  REAUTHENTICATION_REQUIRED:
    "Confirme sua senha atual para continuar. Se a senha não for aceita, solicite a recuperação de acesso.",
  RECOVERY_INVALID:
    "O código de recuperação é inválido ou expirou. Solicite um novo código.",
  INVALID_PASSWORD:
    "Use uma senha com pelo menos 12 e no máximo 1024 caracteres.",
  LAST_AUTH_METHOD_PROTECTED:
    "Mantenha pelo menos um método de autenticação verificado e operacional.",
  PASSWORD_TOO_SHORT: "Use uma senha com pelo menos 12 caracteres.",
  INTERNAL_ERROR: "O servidor não conseguiu concluir a ação. Tente novamente.",
  PAGINATION_NOT_YET_SUPPORTED:
    "Este diretório excede a capacidade de paginação disponível nesta versão.",
};
export function errorMessage(error: unknown) {
  if (error instanceof RequestError && error.code === "VERSION_CONFLICT")
    return "Este registro foi alterado por outra pessoa. Feche este formulário, atualize a página e revise os dados antes de salvar novamente.";
  if (error instanceof RequestError && messages[error.code])
    return messages[error.code];
  if (error instanceof RequestError && /^[A-Z][A-Z0-9_]+$/.test(error.message))
    return "Não foi possível concluir a ação. Revise os dados e tente novamente.";
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a ação.";
}

export function credentialBlockedOrganization(path:string,status:number,code:unknown):string|null {
  if(status!==403 || code!=='ORG_CREDENTIAL_REQUIREMENT_UNMET')return null;
  const route=path.split('?')[0];
  const match=/^\/organizations\/([a-zA-Z0-9-]+)(?:\/|$)/.exec(route);
  return match && !route.includes('/security/attest') && !route.includes('/security/requirements') ? match[1] : null;
}

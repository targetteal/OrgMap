import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import { Failure, fail, id } from "../../src/core.js";
import {
  businessCommand,
  businessCommands,
  validateBusinessInput,
  type BusinessCommand,
} from "./business-catalog.js";
/** Explicit, in-process application adapter. No caller controls a URL, header or SQL statement. */
export function createBusinessDispatch(app: FastifyInstance) {
  return async (
    request: FastifyRequest,
    command: BusinessCommand,
    input: unknown,
  ) => {
    validateBusinessInput(command, input);
    const organizationId = id((request.params as any).organizationId),
      built = command.build(input);
    let path =
      "/api/v1/organizations/" +
      organizationId +
      command.path.replace(/:([A-Za-z]+)/g, (_all, key) =>
        encodeURIComponent(input[key]),
      );
    if (built.query) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(built.query))
        query.set(key, String(value));
      if (query.size) path += "?" + query;
    }
    const headers: Record<string, string> = {};
    if (request.headers.authorization)
      headers.authorization = request.headers.authorization;
    else {
      if (request.headers.cookie) headers.cookie = request.headers.cookie;
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf === "string") headers["x-csrf-token"] = csrf;
    }
    if (typeof request.headers.origin === "string")
      headers.origin = request.headers.origin;
    if (input.version !== undefined) headers["if-match"] = `"${input.version}"`;
    if (input.idempotencyKey !== undefined)
      headers["idempotency-key"] = input.idempotencyKey;
    const response = await app.inject({
      method: command.method,
      url: path,
      headers,
      payload: built.body,
    });
    let result;
    try {
      result = response.json();
    } catch {
      fail(502, "COMMAND_RESPONSE_INVALID");
    }
    if (response.statusCode >= 400)
      throw new Failure(
        response.statusCode,
        result.error?.code ?? "BUSINESS_COMMAND_FAILED",
      );
    return result;
  };
}
export async function registerBusinessApi(
  app: FastifyInstance,
  core: ModuleRuntime,
  base: string,
) {
  const dispatch = createBusinessDispatch(app);
  app.get(base + "/commands", (r) =>
    core.tenant(
      r,
      { mode: "read", requiredScopes: ["interop.read"] },
      async (ctx) => ({
        commands: businessCommands.filter(command => !ctx.principal || ctx.principal.scopes.includes(command.scope)).map(
          ({ name, scope, method, inputSchema }) => ({
            name,
            scope,
            method,
            inputSchema,
          }),
        ),
      }),
    ),
  );
  app.post(base + "/commands/:commandName", async (r) => {
    const command = businessCommand((r.params as any).commandName);
    if (!command) fail(404, "COMMAND_NOT_FOUND");
    await core.tenant(
      r,
      { mode: "read", requiredScopes: [command!.scope] },
      async () => null,
    );
    return dispatch(r, command!, r.body);
  });
}

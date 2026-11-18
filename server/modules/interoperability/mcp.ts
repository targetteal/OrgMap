import type { FastifyInstance } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fail, Failure } from "../../src/core.js";
import { businessCommand, businessCommands } from "./business-catalog.js";
import { createBusinessDispatch } from "./business-dispatch.js";
import { calendar } from "./calendar.js";
import type { InteroperabilityPorts } from "./ports.js";
export async function registerMcp(
  app: FastifyInstance,
  core: ModuleRuntime,
  base: string,
  ports: InteroperabilityPorts = {},
) {
  const dispatch = createBusinessDispatch(app);
  app.post(base + "/mcp", async (r, reply) => {
    // All requests, including initialize/list, authenticate anew; no durable unauthenticated stream.
    const transportAccess = await core.tenant(
      r,
      { mode: "read", requiredScopes: ["interop.read"] },
      async (ctx) => ({ guest: core.isGuest(ctx), scopes: ctx.principal?.scopes }),
    );
    const server = new Server(
      { name: "orgmap-interoperability", version: "1.0.0" },
      { capabilities: { tools: { listChanged: false } } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        ...(!transportAccess.data.guest ? [
        {
          name: "orgmap_integration_status",
          description:
            "Read current organization integration configuration states. Secrets are excluded.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: "orgmap_calendar_export",
          description:
            "Export the current authorized calendar as RFC5545 iCalendar; requires calendar.read scope.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        ] : []),
        ...businessCommands.filter(command => !transportAccess.data.scopes || transportAccess.data.scopes.includes(command.scope)).map((command) => ({
          name: command.name,
          description: `OrgMap business command; required scope ${command.scope}. Reuses current tenant/resource authorization.`,
          inputSchema: command.inputSchema as { type: "object" },
          annotations: {
            readOnlyHint: command.method === "GET",
            destructiveHint: command.name.endsWith("_archive"),
          },
        })),
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const command = businessCommand(req.params.name);
      if (command) {
        try {
          await core.tenant(
            r,
            { mode: "read", requiredScopes: [command.scope] },
            async () => null,
          );
          const result = await dispatch(r, command, req.params.arguments ?? {});
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          if (error instanceof Failure)
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: { code: error.code, status: error.status },
                  }),
                },
              ],
            };
          throw error;
        }
      }
      if (
        !["orgmap_integration_status", "orgmap_calendar_export"].includes(
          req.params.name,
        ) ||
        Object.keys(req.params.arguments ?? {}).length
      )
        fail(400, "INVALID_MCP_COMMAND");
      if (transportAccess.data.guest)
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: { code: "RESOURCE_NOT_FOUND", status: 404 } }) }],
        };
      if (req.params.name === "orgmap_calendar_export") {
        const result = await core.tenant(
          r,
          { mode: "read", requiredScopes: ["calendar.read"] },
          async (ctx) =>
            calendar([
              ...(
                await ctx.c.query(
                  "SELECT * FROM interop_calendar_events WHERE organization_id=$1 ORDER BY starts_at,id",
                  [ctx.org.id],
                )
              ).rows,
              ...(ports.calendar ? await ports.calendar.list(ctx) : []),
            ]),
        );
        return { content: [{ type: "text", text: result.data }] };
      }
      const result = await core.tenant(
        r,
        { mode: "read", requiredScopes: ["interop.read"] },
        async (ctx) => ({
          connections: (
            await ctx.c.query(
              "SELECT id,provider,label,state,version FROM interop_connections WHERE organization_id=$1 ORDER BY id",
              [ctx.org.id],
            )
          ).rows,
        }),
      );
      return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const headers = new Headers();
      for (const [key, value] of Object.entries(r.headers))
        if (typeof value === "string") headers.set(key, value);
      const response = await transport.handleRequest(
        new Request("http://localhost" + r.url, {
          method: "POST",
          headers,
          body: JSON.stringify(r.body),
        }),
      );
      for (const [key, value] of response.headers) reply.header(key, value);
      return reply.code(response.status).send(await response.text());
    } finally {
      await server.close();
    }
  });
}

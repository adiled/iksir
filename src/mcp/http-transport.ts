/**
 * MCP HTTP Transport
 *
 * Serves PM-MCP over HTTP using Streamable HTTP transport.
 * Handles JSON-RPC 2.0 requests via POST, returns JSON responses.
 *
 *   POST /pm → PM-MCP server
 *
 * OpenCode connects via type: "remote" with url: "http://localhost:3100/"
 */

interface McpServer {
  handleRequest(request: {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
  }): Promise<{
    jsonrpc: "2.0";
    id: number | string;
    result?: unknown;
    error?: { code: number; message: string };
  }>;
}

interface McpHttpServerOptions {
  port: number;
  pmServer: McpServer;
}

/**
 * Start the MCP HTTP server.
 * Returns the Deno.HttpServer instance for lifecycle management.
 */
export function startMcpHttpServer(options: McpHttpServerOptions): Deno.HttpServer {
  const { port, pmServer } = options;

  const server = Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method !== "POST") {
      if (req.method === "GET" && path === "/") {
        return Response.json({
          name: "munadi-mcp",
          version: "0.1.0",
          servers: ["/pm"],
        });
      }

      return new Response("Method not allowed", { status: 405 });
    }

    if (path !== "/pm") {
      return new Response("Not found", { status: 404 });
    }

    try {
      const body = await req.json();

      if (Array.isArray(body)) {
        const responses = await Promise.all(
          body.map((msg: Record<string, unknown>) =>
            pmServer.handleRequest(msg as Parameters<McpServer["handleRequest"]>[0])
          )
        );
        return Response.json(responses, {
          headers: { "Content-Type": "application/json" },
        });
      }

      /** Single request */
      const response = await pmServer.handleRequest(body);
      return Response.json(response, {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      /** JSON parse error or unexpected error */
      const errorResponse = {
        jsonrpc: "2.0" as const,
        id: null,
        error: { code: -32700, message: `Parse error: ${error}` },
      };
      return Response.json(errorResponse, { status: 400 });
    }
  });

  return server;
}

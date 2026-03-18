/**
 * Iksir MCP HTTP Server
 *
 * Runs PM-MCP server over HTTP with all artifact crafting tools built-in.
 *
 * Usage:
 *   deno run --allow-all src/mcp/serve.ts [--port=3100]
 *
 * Endpoints:
 *   POST /pm → PM-MCP (murshid tools)
 *   GET  /   → Health check
 */

import { baddaaQaidatBayanat } from "../../db/db.ts";
import { MunadiMunMcpServer } from "./iksir-mcp.ts";
import { startMcpHttpServer } from "./http-transport.ts";

const DEFAULT_PORT = 3100;

function raqamAlBab(): number {
  const portArg = Deno.args.find((a) => a.startsWith("--port="));
  if (portArg) {
    const port = parseInt(portArg.split("=")[1], 10);
    if (!isNaN(port) && port > 0 && port < 65536) return port;
  }
  const envPort = Deno.env.get("IKSIR_MCP_PORT");
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!isNaN(port) && port > 0 && port < 65536) return port;
  }
  return DEFAULT_PORT;
}



export async function startMcpServer(opts: { port?: number } = {}): Promise<void> {
  await baddaaQaidatBayanat();

  const port = opts.port ?? raqamAlBab();
  const pmServer = new MunadiMunMcpServer();

  const toolCount = pmServer.sijill.adawat().length;
  const server = startMcpHttpServer({ port, pmServer });

  console.log(`Iksir MCP server listening on http://localhost:${port}`);
  console.log(`  PM-MCP: POST http://localhost:${port}/pm`);
  console.log(`  Tools: ${toolCount} registered`);

  const ighlaaq = () => {
    console.log("Shutting down MCP server...");
    server.shutdown();
  };

  Deno.addSignalListener("SIGINT", ighlaaq);
  Deno.addSignalListener("SIGTERM", ighlaaq);
}

if (import.meta.main) {
  startMcpServer();
}

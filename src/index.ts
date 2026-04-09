import { createRequire } from "node:module";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json") as { version: string };

import { getConfig, ensureSetup, shutdown, type EngineConfig } from "./engine/index.js";
import { registerTools } from "./tools/index.js";

function createServer(config: EngineConfig): McpServer {
  const server = new McpServer({
    name: "backlog",
    version: PKG_VERSION,
  });

  registerTools(server, config);

  return server;
}

async function main(): Promise<void> {
  const config = await getConfig();
  await ensureSetup(config);
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("backlog-engine MCP server running on stdio");

  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
}

// Only run when executed directly, not when imported as a module
const isEntryPoint =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/dist/index.js");

if (isEntryPoint) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createServer };

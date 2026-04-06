import { McpServer } from "@modelcontextprotocol/server";
import { type EngineConfig } from "./engine/index.js";
declare function createServer(config: EngineConfig): McpServer;
export { createServer };

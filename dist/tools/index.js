import { registerQueryTools } from "./query.js";
import { registerLifecycleTools } from "./lifecycle.js";
import { registerModifyTools } from "./modify.js";
import { registerDocTools } from "./docs.js";
import { registerArchiveTools } from "./archive.js";
export function registerTools(server, config) {
    registerQueryTools(server, config);
    registerLifecycleTools(server, config);
    registerModifyTools(server, config);
    registerDocTools(server, config);
    registerArchiveTools(server, config);
}

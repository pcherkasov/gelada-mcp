import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GeladaServerComponents } from '../server.js';
import { registerDelegateTaskTool } from './delegate-task.js';
import { registerReviseTaskTool } from './revise-task.js';
import { registerInspectTaskTool } from './inspect-task.js';
import { registerDiscardTaskTool } from './discard-task.js';
import { registerDoctorTool } from './doctor.js';
import { registerCancelTaskTool } from './cancel-task.js';
import { registerListWorkersTool } from './list-workers.js';

export * from './delegate-task.js';
export * from './revise-task.js';
export * from './inspect-task.js';
export * from './discard-task.js';
export * from './doctor.js';
export * from './cancel-task.js';
export * from './list-workers.js';

export function registerAllTools(mcpServer: McpServer, components: GeladaServerComponents): void {
  registerDelegateTaskTool(mcpServer, components);
  registerReviseTaskTool(mcpServer, components);
  registerInspectTaskTool(mcpServer, components);
  registerDiscardTaskTool(mcpServer, components);
  registerDoctorTool(mcpServer, components);
  registerCancelTaskTool(mcpServer, components);
  registerListWorkersTool(mcpServer, components);
}

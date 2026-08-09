import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GeladaServerComponents } from '../server.js';

export function registerListWorkersTool(
  mcpServer: McpServer,
  _components: GeladaServerComponents,
): void {
  mcpServer.tool(
    'list_workers',
    'List available local worker drivers and their statuses.',
    {},
    async () => {
      // Currently, AntigravityDriver is the primary hardcoded driver.
      // Future improvements will dynamically check available binaries via the doctor or driver registry.
      const workers = [
        {
          id: 'agy',
          name: 'Antigravity CLI',
          status: 'available',
          description: 'Local Google Antigravity CLI worker for code generation tasks.',
        },
      ];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ workers }, null, 2),
          },
        ],
      };
    },
  );
}
